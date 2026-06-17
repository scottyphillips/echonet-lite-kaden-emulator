import dotenv from "dotenv";
dotenv.config();

import express from "express";
import EL, { eldata, InitializeOptions, rinfo } from "echonet-lite";
import { Controller, EchoObject, EchoStatus, ILogger } from "./controller";
import os from "os";
import ip from "ip";
import fs from "fs";
import { Settings } from "./Settings";
import { InspectOptions } from "util";

// ---------------------------------------------------------------------------
// TID (Transaction ID) Management
// ECHONET Lite requires responses to use the same TID as the incoming request.
// The echonet-lite library blindly increments TID on every sendOPC1 call,
// so we patch it at startup to preserve incoming TIDs for response ESV types.
// ---------------------------------------------------------------------------

/**
 * Cached TID from the most recently received ECHONET packet.
 */
let lastReceivedTid: number[] = [0x00, 0x00];

/**
 * Per-request TID cache keyed by "ip|deoj".
 * Used to preserve the original request's TID against race conditions where
 * intermediate packets arrive between patchReturner capturing the TID and
 * flushGetResBuffer using it (which would overwrite lastReceivedTid).
 */
const tidByRequestGroup = new Map<string, string>();

/**
 * Updates the cached TID from raw UDP packet bytes.
 * ECHONET Lite packet layout: [EHD0=0x10, EHD1=0x81, TID0, TID1, SEOJ0-2, DEOJ0-2, ...]
 * TID is at bytes 2-3 (0-indexed).
 */
function updateLastTidFromBytes(buffer: Buffer): void {
  lastReceivedTid[0] = buffer[2];
  lastReceivedTid[1] = buffer[3];
}

/**
 * Updates the cached TID from a parsed eldata object.
 * Called for non-NodeProfile packets where the library doesn't handle responses internally.
 */
function updateLastTid(els: eldata): void {
  const tidBytes = EL.toHexArray(els.TID);
  lastReceivedTid[0] = tidBytes[0];
  lastReceivedTid[1] = tidBytes[1];
}

/**
 * ECHONET Lite ESV types that are RESPONSES (must echo the request's TID).
 * These include: SET_RES(0x71), GET_RES(0x72), INF(0x73), INFC_RES(0x7a), SETGET_RES(0x7e)
 * Also error responses: SETI_SNA(0x50), SETC_SNA(0x51), GET_SNA(0x52), INF_SNA(0x53), SETGET_SNA(0x5e)
 */
const RESPONSE_ESV = new Set([
  "50", "51", "52", "53", "5e", // error responses
  "71", "72", "73", "7a", "7e"  // success responses
]);

/**
 * Buffer key format: "ip|seoj" - uniquely identifies a GET/SETC request group.
 * Note: We use ip+seoj (source EOJ of incoming request) because that's the requester
 * we need to send responses TO. The library increments TID between each sendOPC1 call
 * in the Node Profile handler loop, so packets from the same GET request will have
 * different TIDs.
 */
type GetResBufferKey = string;

/**
 * Maps buffer keys ("ip|seoj") to the actual requester EOJ (els.SEOJ) for response routing.
 */
const requesterEojByBufferKey = new Map<string, string>();

/**
 * Buffer for aggregating GET_RES/SETGET_RES/SET_RES/GET_SNA/SETC_SNA/INF_SNA responses into single packets.
 * Key: "ip|deoj", Value: array of {esv, epc, edt} tuples to include in one aggregated response.
 * ESV is included because SETC requests may need SET_RES for success and SETC_SNA for failure per EPC.
 */
interface BufferedResponse {
  esv: number;  // ESV type for the response
  epc: string;  // EPC code
  edt: number[]; // EDT data
  seoj?: string; // Optional SEOJ (source EOJ) - if not provided, defaults to Node Profile
}

const getResBuffers = new Map<GetResBufferKey, BufferedResponse[]>();
const getResTimers = new Map<GetResBufferKey, ReturnType<typeof setTimeout>>();

/**
 * Cache of the first TID seen for each request group.
 * Used to preserve the original request's TID in aggregated responses.
 */
const firstTidByGroup = new Map<GetResBufferKey, string>();

/**
 * PATCH: Wrap EL.returner to capture TID from raw UDP bytes BEFORE the library's
 * internal Node Profile handler sends responses.
 *
 * The echonet-lite library processes Node Profile GET requests internally in its
 * returner function (lines 676-685 of index.js) - it iterates over each requested EPC
 * and calls sendOPC1 for each response BEFORE calling userFunc. Since our userFunc is
 * where updateLastTid gets called, the TID would already be stale by the time we update it.
 *
 * This patch intercepts ALL incoming packets at the raw buffer level and:
 * 1. Updates lastReceivedTid for non-Node-Profile requests
 * 2. Caches the TID per request group (ip|deoj) for Node Profile GET requests BEFORE
 *    the library's internal handler processes them, preventing race conditions where
 *    intermediate packets could overwrite lastReceivedTid before flushGetResBuffer runs.
 */
function patchReturner(): void {
  const originalReturner = EL.returner.bind(EL);

  EL.returner = function (bytes: number[], rinfo: rinfo, userfunc: any): void {
    // Capture TID from raw bytes BEFORE any internal processing
    // ECHONET Lite packet layout: [EHD0=0x10, EHD1=0x81, TID0, TID1, SEOJ0-2, DEOJ0-2, ...]
    if (bytes.length >= 13 && bytes[0] === 0x10 && bytes[1] === 0x81) {
      const tidBytes: number[] = [bytes[2], bytes[3]];
      lastReceivedTid[0] = tidBytes[0];
      lastReceivedTid[1] = tidBytes[1];

      // For Node Profile GET requests (DEOJ starts with 0ef0, ESV = 0x62),
      // cache the TID per request group IMMEDIATELY before library processing.
      // This prevents race conditions where intermediate packets could overwrite
      // lastReceivedTid between now and when flushGetResBuffer runs.
      const deoj = EL.toHexString(bytes[7]) + EL.toHexString(bytes[8]) + EL.toHexString(bytes[9]);
      const esv = bytes[10];

      if (deoj.startsWith("0ef0") && esv === 0x62) {
        // GET request for Node Profile - cache TID immediately
        const key: GetResBufferKey = `${rinfo.address}|${deoj}`;
        const tidHex = EL.toHexString(tidBytes[0]) + EL.toHexString(tidBytes[1]);
        if (!tidByRequestGroup.has(key)) {
          tidByRequestGroup.set(key, tidHex);
        }
      }
    }

    // Call the original returner which will handle Node Profile internally then call userfunc
    originalReturner(bytes, rinfo, userfunc);
  };
}

/**
 * Flushes buffered responses for a given key into a single aggregated packet.
 * ECHONET Lite spec: multiple properties in one packet use OPC=count, then each EPC/PDC/EDT tuple.
 * Handles mixed ESV types (GET_RES, SET_RES, GET_SNA, etc.) by grouping same-ESV responses together.
 */
function flushGetResBuffer(key: GetResBufferKey): void {
  const buffer = getResBuffers.get(key);
  if (!buffer || buffer.length === 0) return;

  getResBuffers.delete(key);
  const timer = getResTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    getResTimers.delete(key);
  }

  // Parse key to extract ip and requester EOJ (els.SEOJ from incoming request)
  let idx = key.indexOf("|");
  const ipAddr = key.substring(0, idx);
  const deoj = requesterEojByBufferKey.get(key) || key.substring(idx + 1);

  // Look up the cached TID for this request group.
  // Priority: firstTidByGroup (from patchSendBase buffer) > tidByRequestGroup (from patchReturner).
  // tidByRequestGroup is set IMMEDIATELY when the request arrives, before any library processing.
  // firstTidByGroup is set from lastReceivedTid which could be stale if intermediate packets arrived.
  let resolvedTid = tidByRequestGroup.get(key);
  if (!resolvedTid) {
    resolvedTid = firstTidByGroup.get(key) || "0000";
  }

  // Clear from all caches
  tidByRequestGroup.delete(key);
  firstTidByGroup.delete(key);
  requesterEojByBufferKey.delete(key);

  // Convert hex string back to bytes — toHexArray expects a number, not a string
  const tidBytes = [
    parseInt(resolvedTid.substring(0, 2), 16),
    parseInt(resolvedTid.substring(2, 4), 16)
  ];

  // Group responses by ESV type (multiple EPCs with same ESV go in one packet)
  const responsesByEsv = new Map<number, Array<{ epc: string; edt: number[] }>>();
  for (const b of buffer) {
    if (!responsesByEsv.has(b.esv)) {
      responsesByEsv.set(b.esv, []);
    }
    responsesByEsv.get(b.esv)!.push({ epc: b.epc, edt: b.edt });
  }

  // Determine SEOJ from the first buffered response (all responses in a buffer share the same source)
  const firstSeoj = buffer[0]?.seoj || "0ef001"; // Default to Node Profile if not specified
  const seojHex = EL.toHexArray(firstSeoj);      // Source EOJ (response originates FROM us)
  const deojHex = EL.toHexArray(deoj);           // Requester's EOJ (response goes TO them)

  // Send one aggregated packet per ESV type
  for (const [esv, props] of responsesByEsv) {
    const propCount = props.length;

    const packet = Buffer.from([
      0x10, 0x81,
      tidBytes[0], tidBytes[1], // Use cached original TID
      ...seojHex,               // SEJO (source EOJ - response originates FROM us)
      ...deojHex,               // DEOJ (requester's EOJ - response goes TO them)
      esv,                      // ESV type (GET_RES, SET_RES, etc.)
      propCount,                // OPC (number of EPCs in the payload)
      ...props.flatMap((p) => {
        const edtBytes = p.edt.length > 0 ? p.edt : [];
        return [
          parseInt(p.epc, 16),           // EPC
          edtBytes.length,               // PDC
          ...edtBytes                    // EDT
        ];
      })
    ]);

    // Send using the ORIGINAL (unpatched) sendBase to avoid re-entering patchSendBase
    if (directSendBase) {
      directSendBase(ipAddr, packet);
    }
  }

  if (debugLog) {
    const esvTypes = Array.from(responsesByEsv.keys()).map(e => "0x" + e.toString(16).toUpperCase()).join(", ");
    logger.log(`Aggregated responses: ${buffer.length} total properties, ESV types: ${esvTypes} for ${deoj}`);
  }
}

/**
 * Intercepts sendBase to:
 * 1. Buffer and aggregate Node Profile GET_RES/GET_SNA responses into single packets
 * 2. Fix up TID bytes for non-aggregated response packets (library increments TID at start of sendOPC1)
 */
let directSendBase: ((ip: string, buffer: Buffer) => number[]) | null = null;

function patchSendBase(): void {
  const originalSendBase = EL.sendBase.bind(EL);
  // Store reference to original so flushGetResBuffer can bypass the patched version
  directSendBase = originalSendBase;

  EL.sendBase = function (ip: string, buffer: Buffer): number[] {
    // Buffer layout from sendOPC1: [EHD0=0x10, EHD1=0x81, TID0, TID1, SEOJ0-2, DEOJ0-2, ESV, OPC, ...]
    // Index: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, ...

    // Check if this is a response ESV (any type that should echo request TID)
    const esv = buffer[10];
    const isResponseEsv = RESPONSE_ESV.has(("0" + esv.toString(16)).slice(-2).toUpperCase());

    if (isResponseEsv && buffer.length >= 13) {
      // Fix up TID: library increments at start of sendOPC1, so buffer[2:4] is lastReceivedTid+1.
      // Replace with the cached request TID.
      // Fix up TID: replace with the cached request TID (lastReceivedTid is already in correct byte format)
      buffer[2] = lastReceivedTid[0];
      buffer[3] = lastReceivedTid[1];

      // Check if this is a Node Profile response (SEJO is 0EF001, DEOJ is requester's EOJ)
      const tidStr = EL.toHexString(buffer[2]) + EL.toHexString(buffer[3]);
      const seoj = EL.toHexString(buffer[4]) + EL.toHexString(buffer[5]) + EL.toHexString(buffer[6]);
      const actualDeoj = EL.toHexString(buffer[7]) + EL.toHexString(buffer[8]) + EL.toHexString(buffer[9]);

      if (seoj === "0ef001" && (esv === 0x72 || esv === 0x52)) {
        const key: GetResBufferKey = `${ip}|${actualDeoj}`;

        // Cache the first TID seen for this request group (library increments TID between calls)
        if (!firstTidByGroup.has(key)) {
          firstTidByGroup.set(key, tidStr);
        }

        // Extract EPC and EDT from the buffer
        const opc = buffer[11]; // OPC count
        let offset = 12; // Start after ESV

        for (let i = 0; i < opc; i++) {
          const epc = EL.toHexString(buffer[offset]);       // EPC
          const pdc = buffer[offset + 1];                   // PDC
          const edt: number[] = [];
          for (let j = 0; j < pdc && (offset + 2 + j) < buffer.length; j++) {
            edt.push(buffer[offset + 2 + j]);
          }

          let buf = getResBuffers.get(key);
          if (!buf) {
            buf = [];
            getResBuffers.set(key, buf);
          }
          buf.push({ esv, epc, edt });
        }

        // Schedule flush after a short delay to collect all properties from the same GET request
        const existingTimer = getResTimers.get(key);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const flushTimer = setTimeout(() => {
          flushGetResBuffer(key);
        }, 50); // 50ms delay to collect all responses from the same GET request

        getResTimers.set(key, flushTimer);

        // Don't send this individual packet - it will be sent as part of aggregated response
        return tidStr.length > 0 ? [0x00, 0x00] : [];
      }
    }

    // Not a Node Profile GET_RES/GET_SNA - send normally
    return originalSendBase(ip, buffer);
  };
}

/**
 * PATCH: Wrap EL.sendOPC1 to automatically preserve TID for response packets.
 *
 * The echonet-lite library handles Node Profile GET requests internally
 * (in its returner function, before userFunc is called). It iterates over each
 * requested EPC and calls sendOPC1 separately for each response, incrementing
 * TID each time. This patch intercepts ALL sendOPC1 calls and uses the cached
 * request TID when the ESV indicates a response packet (except Node Profile ones,
 * which are handled by patchSendBase).
 *
 * Non-response messages (INF notifications, SETI, GET requests, etc.) still
 * use the library's auto-incremented TID as normal.
 */
function patchSendOPC1(): void {
  const originalSendOPC1 = EL.sendOPC1.bind(EL);

  EL.sendOPC1 = function (
    ip: string,
    seoj: string | number[],
    deoj: string | number[],
    esv: string | number,
    epc: string | number,
    edt: string | number | number[]
  ): number[] {
    // Convert esv to uppercase hex string for comparison
    let esvStr: string;
    if (typeof esv === "number") {
      esvStr = ("0" + esv.toString(16)).slice(-2).toUpperCase();
    } else {
      esvStr = esv.toUpperCase();
    }

    // If this is a response ESV, use the cached request TID
    if (RESPONSE_ESV.has(esvStr)) {
      // Save current library TID
      const savedTid = [...EL.tid];

      // Set library TID to match the incoming request.
      // Note: The library increments TID at the start of sendOPC1, so we set it
      // first and then after the call we need to fix up EL.tid back to what it was.
      EL.tid[0] = lastReceivedTid[0];
      EL.tid[1] = lastReceivedTid[1];

      // Send with the preserved TID (library will increment it, but that's fine
      // because patchSendBase intercepts the raw buffer and Node Profile ones are
      // handled there. For non-Node-Profile responses, we fix the buffer TID below.)
      const result = originalSendOPC1(ip, seoj, deoj, esv, epc, edt);

      // Restore library's auto-incremented TID to what it was before our send
      EL.tid[0] = savedTid[0];
      EL.tid[1] = savedTid[1];

      return result;
    }

    // Non-response: use normal library behavior (auto-increment TID)
    return originalSendOPC1(ip, seoj, deoj, esv, epc, edt);
  };
}

/**
 * Sends an ECHONET packet using a specific TID (typically echoing the request's TID).
 * This is still useful for explicit control in userFunc.
 */
function sendResponseWithTid(
  ip: string,
  seoj: string | number[],
  deoj: string | number[],
  esv: string | number,
  epc: string | number,
  edt: string | number | number[]
): void {
  // Save the current library TID so we can restore it after our send
  const savedLibTid = [...EL.tid];

  // Set the library's internal TID to match the response TID
  EL.tid[0] = lastReceivedTid[0];
  EL.tid[1] = lastReceivedTid[1];

  // Send using the library's sendOPC1 (which will now use our TID)
  EL.sendOPC1(ip, seoj, deoj, esv, epc, edt);

  // Restore the library's auto-incremented TID to maintain normal operation
  EL.tid[0] = savedLibTid[0];
  EL.tid[1] = savedLibTid[1];
}

let echonetTargetNetwork = ""; //"192.168.1.0/24";
let echonetDelayTime = 0;
let debugLog = false;
let webPort = 3000;
let settingsFilePath = "";
let settings: Settings = Settings.createEmpty();

if (
  "ECHONET_TARGET_NETWORK" in process.env &&
  process.env.ECHONET_TARGET_NETWORK !== undefined
) {
  echonetTargetNetwork = process.env.ECHONET_TARGET_NETWORK;
}
if (
  "ECHOENT_DELAY_TIME" in process.env &&
  process.env.ECHOENT_DELAY_TIME !== undefined
) {
  echonetDelayTime = parseInt(process.env.ECHOENT_DELAY_TIME);
}
if ("DEBUG" in process.env && process.env.DEBUG !== undefined) {
  debugLog =
    process.env.DEBUG.toUpperCase() === "TRUE" || process.env.DEBUG === "1";
}
if ("WEBPORT" in process.env && process.env.WEBPORT !== undefined) {
  webPort = parseInt(process.env.WEBPORT);
}
if (
  "SETTINGS" in process.env && process.env.SETTINGS !== undefined) {
  settingsFilePath = process.env.SETTINGS;
}

if (echonetDelayTime > 0) {
  console.log(`ECHOENT_DELAY_TIME:${echonetDelayTime}`);
}
if (debugLog) {
  console.log(`DEBUG:${debugLog}`);
}
if(settingsFilePath !== "")
{
  console.log(`SETTINGS:${settingsFilePath}`);
}
if(fs.existsSync(settingsFilePath)){
  settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf-8")) as Settings;
  const validationResult = Settings.validate(settings);
  if(validationResult.valid === false)
  {
    console.error("Invalid settings file.");
    console.error(validationResult.message);
    process.exit(1);
  }
}

class Logger implements ILogger {
  private logOut: boolean;
  constructor(logOut: boolean) {
    this.logOut = logOut;
  }
  log(log: string): void {
    if (this.logOut === false) {
      return;
    }
    console.log(new Date().toISOString() + "\t" + log);
  }
  dir(obj: any, options?: InspectOptions): void {
    if (this.logOut === false) {
      return;
    }
    console.dir(obj, options);
  }
}

const logger = new Logger(debugLog);

const app = express();
const controller = new Controller(logger, settings);

app.use(express.static("public"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/status", controller.getStatus);
app.get("/api/cellingLight", controller.getCellingLightStatus);
app.post("/api/cellingLight", controller.setCellingLightStatusFromRestApi);
app.get("/api/sensorMeter", controller.getSensorMeterStatus);
app.post("/api/sensorMeter", controller.setSensorMeterStatusFromRestApi);
app.get("/api/motionSensor", controller.getMotionSensorStatus);
app.post("/api/motionSensor", controller.setMotionSensorStatusFromRestApi);
app.get("/api/floorLight", controller.getFloorLightStatus);
app.post("/api/floorLight", controller.setFloorLightStatusFromRestApi);
app.get("/api/shutter", controller.getShutterStatus);
app.post("/api/shutter", controller.setShutterStatusFromRestApi);
app.get("/api/door", controller.getDoorStatus);
app.post("/api/door", controller.setDoorStatusFromRestApi);
app.get("/api/bathWaterHeater", controller.getBathWaterHeaterStatus);
app.post(
  "/api/bathWaterHeater",
  controller.setBathWaterHeaterStatusFromRestApi
);
app.get("/api/airConditioner", controller.getAirConditionerStatus);
app.post("/api/airConditioner", controller.setAirConditionerStatusFromRestApi);

app.post("/api/commands/:command", controller.postCommandsFromRestApi);

const server = app.listen(webPort, function () {
  const address = server.address();
  const port =
    address === null
      ? "null"
      : typeof address === "string"
      ? address
      : address.port;

  console.log(`Start listening to web server. 0.0.0.0:${port}`);
});

let usedIpByEchoNet = "";
if (echonetTargetNetwork.match(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+/)) {
  const interfaces = os.networkInterfaces();
  const matchedNetworkAddresses = Object.keys(interfaces)
    .map((key) => interfaces[key])
    .flat()
    .filter((_) => _ !== undefined && ip.cidrSubnet(echonetTargetNetwork).contains(_.address!));
  if (matchedNetworkAddresses.length >= 1) {
    usedIpByEchoNet = matchedNetworkAddresses[0]!.address;
  }
}

controller.sendPropertyChangedEvent = (
  echoStatus: EchoStatus,
  seoj: string,
  propertyNo: string,
  newValue: number[]
): void => {
  logger.log(`INF seoj:${seoj} propertyCode:${propertyNo} ${newValue}`);
  EL.sendOPC1(EL.EL_Multi, seoj, "05FF01", EL.INF, propertyNo, newValue);
};

controller.sendCommandCallback = (command: string, option:any): void => {
  if (command === "instanceListNotification") {
    logger.log(`send instanceListNotification`);
    EL.sendOPC1(EL.EL_Multi, "0ef001", "0ef001", EL.INF, "d5", EL.Node_details["d5"]);
  }
  if(command === "changedevices")
  {
    const arr = option as {eoj:string, enabled:boolean}[];
    for(const elem of arr)
    {
      const echoStatus = controller.allStatusList.find(_=>_.eoj === elem.eoj);
      if(echoStatus === undefined)
      {
        continue;
      }
      if(echoStatus.enabled !== elem.enabled)
      {
        echoStatus.enabled = elem.enabled;
        console.log(`Changed ${elem.eoj} to ${elem.enabled}`);
      }
    }
    recreateEchoObjectList();
    //EL.sendOPC1(EL.EL_Multi, "0ef001", "0ef001", EL.INF, "d5", EL.Node_details["d5"]);
  }
};

function recreateEchoObjectList(): void {
  const echoObjectList = controller.allStatusList
    .filter(_=>_.enabled)
    .map((_) => _.echoObject)
    .map((_) => Object.keys(_))
    .flat();
  
  EL.EL_obj = echoObjectList;

	// クラスリストにする
	let classes = EL.EL_obj.map((e)=>e.substr(0, 4));
	let classList = classes.filter(function (x, i, self) {		// 重複削除
		return self.indexOf(x) === i;
	});
	EL.EL_cls = classList;

  // インスタンスリスト
  {
    EL.Node_details["d3"] = [0x00, 0x00, EL.EL_obj.length]; // D3はノードプロファイル入らない，最大253では？なぜ3Byteなのか？
	  const v = EL.EL_obj.flatMap((elem)=>EL.toHexArray(elem));
	  v.unshift(EL.EL_obj.length);
	  EL.Node_details["d5"] = Array.prototype.concat.apply([], v);  // D5, D6同じでよい．ノードプロファイル入らない．
	  EL.Node_details["d6"] = EL.Node_details["d5"];

    // EPC 0x8C: Product Code (max 12 bytes per ECHONET Lite spec)
    // Set to a default ASCII product code if not already configured via settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(EL.Node_details as any)["8c"]) {
      // Default product code: "KAD1" in ASCII (4B 41 44 31)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (EL.Node_details as any)["8c"] = [0x4B, 0x41, 0x44, 0x31]; // "KAD1"
    }
  }

	// クラス情報
  {
  	EL.Node_details["d4"] = [0x00, EL.EL_cls.length + 1]; // D4だけなぜかノードプロファイル入る．
	  const v = EL.EL_cls.flatMap((elem)=>EL.toHexArray(elem));
	  v.unshift(EL.EL_cls.length);
	  EL.Node_details["d7"] = Array.prototype.concat.apply([], v);  // D7はノードプロファイル入らない
  }
}

const echoObjectList = controller.allStatusList
  .filter(_=>_.enabled)
  .map((_) => _.echoObject)
  .map((_) => Object.keys(_))
  .flat();

const options: InitializeOptions = {
  //autoGetProperties: true,
  autoGetDelay: 100,
};
if (usedIpByEchoNet !== "") {
  options.v4 = usedIpByEchoNet;
}

let sleeping = false;

async function sleep(msec: number): Promise<void> {
  if (msec === 0) {
    return;
  }
  return new Promise((resolve) => setTimeout(resolve, msec));
}

// ---------------------------------------------------------------------------
// ECHONET Lite message handler
// ---------------------------------------------------------------------------

async function userFunc(rinfo: rinfo, els: eldata): Promise<void> {
  // Update the cached TID from this incoming packet so responses echo it back
  updateLastTid(els);

  if (debugLog) {
    logger.log(`TID: ${els.TID} ESV: ${els.ESV} SEOJ: ${els.SEOJ} DEOJ: ${els.DEOJ}`);
  }

  const b = JSON.stringify(els);
  logger.log(`recieved:` + b);

  if (sleeping) {
    // スリープ中に来たコマンドはエラーを返す（TIDをエコー）- use buffering for multiple EPCs
    const key: GetResBufferKey = `${rinfo.address}|${els.SEOJ}`;
    requesterEojByBufferKey.set(key, els.SEOJ); // Store the actual requester EOJ

    if (!firstTidByGroup.has(key)) {
      // Use slice(-2) to ensure exactly 2 hex characters per byte
      const tidHex = ("0" + lastReceivedTid[0].toString(16)).slice(-2).toUpperCase() + 
                     ("0" + lastReceivedTid[1].toString(16)).slice(-2).toUpperCase();
      firstTidByGroup.set(key, tidHex);
    }

    const errorEsv = parseInt(els.ESV === EL.GET ? EL.GET_SNA : EL.SETC_SNA, 16);
    let buf = getResBuffers.get(key);
    if (!buf) {
      buf = [];
      getResBuffers.set(key, buf);
    }

    for (const propertyCode in els.DETAILs) {
      buf.push({ esv: errorEsv, epc: propertyCode, edt: [] });
      logger.log(`Error response (sleeping): ${els.DEOJ} ${propertyCode}`);
    }

    // Flush immediately for error responses (no delay needed)
    flushGetResBuffer(key);
    return;
  }

  // スリープ中に来たSETIコマンドは無視する
  if (els.ESV === EL.SETI) {
    // SETIの処理 - no response needed
    const matchedEchoObjects = controller.allStatusList.filter(
      (_) => _.enabled && els.DEOJ in _.echoObject
    );
    for (const status of matchedEchoObjects) {
      for (const propertyCode in els.DETAILs) {
        controller.setValueFromEchoNet(
          status.echoObject,
          propertyCode,
          EL.toHexArray(els.DETAILs[propertyCode])
        );
      }
    }
    return;
  }

  // GET - respond with same TID as request (use buffering for multiple EPCs)
  // Skip Node Profile (0xEF01) requests - the echonet-lite library handles those directly
  if (els.ESV === EL.GET && els.DEOJ !== "0ef001") {
    const key: GetResBufferKey = `${rinfo.address}|${els.SEOJ}`;
    requesterEojByBufferKey.set(key, els.SEOJ); // Store the actual requester EOJ

    // Cache the first TID seen for this request group
    if (!firstTidByGroup.has(key)) {
      // Use slice(-2) to ensure exactly 2 hex characters per byte
      const tidHex = ("0" + lastReceivedTid[0].toString(16)).slice(-2).toUpperCase() + 
                     ("0" + lastReceivedTid[1].toString(16)).slice(-2).toUpperCase();
      firstTidByGroup.set(key, tidHex);
    }

    const matchedEchoObjects = controller.allStatusList.filter(
      (_) => _.enabled && els.DEOJ in _.echoObject
    );

    for (const propertyCode in els.DETAILs) {
      // Find the matching device and check if property exists
      for (const status of matchedEchoObjects) {
        if (propertyCode in status.echoObject[els.DEOJ]) {
          const value = status.echoObject[els.DEOJ][propertyCode];

          logger.log(`Requested: ${els.DEOJ} ${propertyCode}`);

          // Add to buffer with the matched device's EOJ as SEOJ (source)
          let buf = getResBuffers.get(key);
          if (!buf) {
            buf = [];
            getResBuffers.set(key, buf);
          }
          buf.push({ esv: parseInt(EL.GET_RES, 16), epc: propertyCode, edt: value, seoj: status.eoj });
          break; // Property found in this device, move to next EPC
        }
      }
    }

    // Flush after delay to collect all responses
    if (echonetDelayTime > 0) {
      sleeping = true;
      await sleep(echonetDelayTime);
      sleeping = false;
    }

    flushGetResBuffer(key);
    return;
  }

  // SETC - respond with same TID as request (use buffering for multiple EPCs)
  if (els.ESV === EL.SETC) {
    const key: GetResBufferKey = `${rinfo.address}|${els.SEOJ}`;
    requesterEojByBufferKey.set(key, els.SEOJ); // Store the actual requester EOJ

    // Cache the first TID seen for this request group
    if (!firstTidByGroup.has(key)) {
      // Use slice(-2) to ensure exactly 2 hex characters per byte
      const tidHex = ("0" + lastReceivedTid[0].toString(16)).slice(-2).toUpperCase() + 
                     ("0" + lastReceivedTid[1].toString(16)).slice(-2).toUpperCase();
      firstTidByGroup.set(key, tidHex);
    }

    const matchedEchoObjects = controller.allStatusList.filter(
      (_) => _.enabled && els.DEOJ in _.echoObject
    );

    for (const propertyCode in els.DETAILs) {
      let handled = false;
      // Find the matching device and process SET command
      for (const status of matchedEchoObjects) {
        const result = controller.setValueFromEchoNet(
          status.echoObject,
          propertyCode,
          EL.toHexArray(els.DETAILs[propertyCode])
        );
        if (result) {
          // Add success response to buffer with the matched device's EOJ as SEOJ (source)
          let buf = getResBuffers.get(key);
          if (!buf) {
            buf = [];
            getResBuffers.set(key, buf);
          }
          buf.push({ esv: parseInt(EL.SET_RES, 16), epc: propertyCode, edt: [], seoj: status.eoj });
          handled = true;
          break; // Handled by this device, move to next EPC
        }
      }

      if (!handled) {
        // If not handled by any device, add error response (use Node Profile as default SEOJ)
        let buf = getResBuffers.get(key);
        if (!buf) {
          buf = [];
          getResBuffers.set(key, buf);
        }
        buf.push({ esv: parseInt(EL.SETC_SNA, 16), epc: propertyCode, edt: [] });
      }
    }

    // Flush after delay
    if (echonetDelayTime > 0) {
      sleeping = true;
      await sleep(echonetDelayTime);
      sleeping = false;
    }

    flushGetResBuffer(key);
    return;
  }
}

// ---------------------------------------------------------------------------
// Initialize ECHONET Lite - patch returner, sendBase and sendOPC1 BEFORE initialize so
// all patches are active when the library's internal Node Profile handler sends responses.
// ---------------------------------------------------------------------------

patchReturner();   // Capture TID from raw bytes before library's internal handler processes packets
patchSendBase();   // Intercept raw packets for aggregation
patchSendOPC1();   // Preserve TID for response ESV types

EL.initialize(echoObjectList, userFunc, 4, options);

// Call recreateEchoObjectList to populate ALL Node_details including EPC 8C (Instance Detailed List)
// This must be called AFTER EL.initialize() because the library initializes Node_details defaults there
recreateEchoObjectList();

if(settings.nodeProfileId !== undefined && settings.nodeProfileId !== "")
{
  EL.Node_details["83"] = EL.toHexArray(settings.nodeProfileId);
}

console.log(`Start ECHONET Lite to network interface:${EL.usingIF.v4}`);

//EL.search();

// EL.setObserveFacilities(1000, () => {
//   console.dir(EL.facilities);
// });