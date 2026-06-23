import dotenv from "dotenv";
dotenv.config();

import express from "express";
import EL, { InitializeOptions } from "echonet-lite";
import { Controller, EchoObject, EchoStatus, ILogger } from "./controller";
import os from "os";
import ip from "ip";
import fs from "fs";
import { Settings } from "./Settings";
import { InspectOptions } from "util";
import { startUdpServer, UdpServer } from "./udp";

// ---------------------------------------------------------------------------
// Environment / configuration
// ---------------------------------------------------------------------------

let echonetTargetNetwork = "";
let debugLog = false;
let webPort = 3000;
let settingsFilePath = "";
let settings: Settings = Settings.createEmpty();

if ("ECHONET_TARGET_NETWORK" in process.env && process.env.ECHONET_TARGET_NETWORK) {
  echonetTargetNetwork = process.env.ECHONET_TARGET_NETWORK;
}
if ("DEBUG" in process.env && process.env.DEBUG) {
  debugLog = process.env.DEBUG.toUpperCase() === "TRUE" || process.env.DEBUG === "1";
}
if ("WEBPORT" in process.env && process.env.WEBPORT) {
  webPort = parseInt(process.env.WEBPORT);
}
if ("SETTINGS" in process.env && process.env.SETTINGS) {
  settingsFilePath = process.env.SETTINGS;
}

if (settingsFilePath !== "") {
  console.log(`SETTINGS: ${settingsFilePath}`);
}
if (fs.existsSync(settingsFilePath)) {
  settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf-8")) as Settings;
  const validationResult = Settings.validate(settings);
  if (validationResult.valid === false) {
    console.error("Invalid settings file.");
    console.error(validationResult.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

class Logger implements ILogger {
  private logOut: boolean;
  constructor(logOut: boolean) { this.logOut = logOut; }
  log(log: string): void {
    if (this.logOut) console.log(new Date().toISOString() + "\t" + log);
  }
  dir(obj: any, options?: InspectOptions): void {
    if (this.logOut) console.dir(obj, options);
  }
}

const logger = new Logger(debugLog);

// ---------------------------------------------------------------------------
// Express REST API
// ---------------------------------------------------------------------------

const app = express();
const controller = new Controller(logger, settings);

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/status",                           controller.getStatus);
app.get("/api/cellingLight",                     controller.getCellingLightStatus);
app.post("/api/cellingLight",                    controller.setCellingLightStatusFromRestApi);
app.get("/api/sensorMeter",                      controller.getSensorMeterStatus);
app.post("/api/sensorMeter",                     controller.setSensorMeterStatusFromRestApi);
app.get("/api/motionSensor",                     controller.getMotionSensorStatus);
app.post("/api/motionSensor",                    controller.setMotionSensorStatusFromRestApi);
app.get("/api/floorLight",                       controller.getFloorLightStatus);
app.post("/api/floorLight",                      controller.setFloorLightStatusFromRestApi);
app.get("/api/shutter",                          controller.getShutterStatus);
app.post("/api/shutter",                         controller.setShutterStatusFromRestApi);
app.get("/api/door",                             controller.getDoorStatus);
app.post("/api/door",                            controller.setDoorStatusFromRestApi);
app.get("/api/bathWaterHeater",                  controller.getBathWaterHeaterStatus);
app.post("/api/bathWaterHeater",                 controller.setBathWaterHeaterStatusFromRestApi);
app.get("/api/airConditioner",                   controller.getAirConditionerStatus);
app.post("/api/airConditioner",                  controller.setAirConditionerStatusFromRestApi);
app.get("/api/distributionPanelMeterController", controller.getDistributionPanelMeterControllerStatus);
app.post("/api/distributionPanelMeterController",controller.setDistributionPanelMeterControllerStatusFromRestApi);
app.get("/api/evChargerDischarger",              controller.getEvChargerDischargerStatus);
app.post("/api/evChargerDischarger",             controller.setEvChargerDischargerStatusFromRestApi);
app.get("/api/solarPowerGeneration",             controller.getSolarPowerGenerationStatus);
app.post("/api/solarPowerGeneration",            controller.setSolarPowerGenerationStatusFromRestApi);
app.get("/api/powerDistributionBoardMetering",   controller.getPowerDistributionBoardMeteringStatus);
app.post("/api/powerDistributionBoardMetering",  controller.setPowerDistributionBoardMeteringStatusFromRestApi);
app.post("/api/commands/:command",               controller.postCommandsFromRestApi);

const server = app.listen(webPort, () => {
  const address = server.address();
  const port = address === null
    ? "null"
    : typeof address === "string"
    ? address
    : address.port;
  console.log(`Start listening to web server. 0.0.0.0:${port}`);
});

// ---------------------------------------------------------------------------
// NIC selection (mirrors the original logic)
// ---------------------------------------------------------------------------

let usedIpByEchoNet = "";
if (echonetTargetNetwork.match(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+/)) {
  const interfaces = os.networkInterfaces();
  const matched = Object.values(interfaces)
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo =>
      i !== undefined && ip.cidrSubnet(echonetTargetNetwork).contains(i.address)
    );
  if (matched.length >= 1) {
    usedIpByEchoNet = matched[0].address;
  }
}

// ---------------------------------------------------------------------------
// Node Profile — populate EL.Node_details and keep EL.EL_obj / EL.EL_cls
// current so the UDP handler can read from them.
// EL.initialize() is called in minimal mode only to trigger this setup;
// its internal UDP listener and returner are NOT used.
// ---------------------------------------------------------------------------

function recreateEchoObjectList(): void {
  const echoObjectList = controller.allStatusList
    .filter(s => s.enabled)
    .map(s => Object.keys(s.echoObject))
    .flat();

  EL.EL_obj = echoObjectList;

  // Class list (deduplicated 4-char prefixes)
  const classes = EL.EL_obj.map(e => e.substring(0, 4));
  EL.EL_cls = classes.filter((v, i, a) => a.indexOf(v) === i);

  // D3 — number of instances (excluding Node Profile)
  (EL.Node_details as any)["d3"] = [0x00, 0x00, EL.EL_obj.length];

  // D5 / D6 — instance list
  const v = EL.EL_obj.flatMap(e => EL.toHexArray(e));
  v.unshift(EL.EL_obj.length);
  (EL.Node_details as any)["d5"] = v;
  (EL.Node_details as any)["d6"] = v;

  // D4 — class count (Node Profile counts too, hence +1)
  (EL.Node_details as any)["d4"] = [0x00, EL.EL_cls.length + 1];

  // D7 — class list
  const vc = EL.EL_cls.flatMap(e => EL.toHexArray(e));
  vc.unshift(EL.EL_cls.length);
  (EL.Node_details as any)["d7"] = vc;

  // 8C — Product code (max 12 bytes, ASCII "KAD1")
  if (!(EL.Node_details as any)["8c"]) {
    (EL.Node_details as any)["8c"] = [0x4B, 0x41, 0x44, 0x31];
  }
}

const initialEchoObjectList = controller.allStatusList
  .filter(s => s.enabled)
  .map(s => Object.keys(s.echoObject))
  .flat();

// Initialize EL solely to populate Node_details defaults; we do not use its socket.
// autoGetProperties must be disabled to prevent it from sending spurious traffic.
const elOptions: InitializeOptions = { autoGetDelay: 0 };
if (usedIpByEchoNet !== "") elOptions.v4 = usedIpByEchoNet;
EL.initialize(initialEchoObjectList, () => { /* intentionally empty */ }, 4, elOptions);

// Populate all Node_details fields now that EL has set its defaults
recreateEchoObjectList();

// Apply custom Node Profile ID from settings
if (settings.nodeProfileId) {
  EL.Node_details["83"] = EL.toHexArray(settings.nodeProfileId);
}

// ---------------------------------------------------------------------------
// Native UDP stack
// ---------------------------------------------------------------------------

// Wire the controller's setValueFromEchoNet as the SET handler
function setHandler(eoj: string, propertyCode: string, value: number[]): boolean {
  const allStatus = controller.allStatusList;
  const matched = allStatus.find(s => s.enabled && eoj in s.echoObject);
  if (!matched) return false;
  return controller.setValueFromEchoNet(matched.echoObject, propertyCode, value);
}

const udp: UdpServer = startUdpServer(
  () => controller.allStatusList,
  setHandler,
  {
    bindAddress: usedIpByEchoNet || undefined,
    debugLog,
  }
);

console.log(
  `Start ECHONET Lite UDP stack on :3610` +
  (usedIpByEchoNet ? ` (interface ${usedIpByEchoNet})` : " (all interfaces)")
);

// ---------------------------------------------------------------------------
// Controller callbacks — property-change INF and command dispatch
// ---------------------------------------------------------------------------

controller.sendPropertyChangedEvent = (
  _echoStatus: EchoStatus,
  seoj: string,
  propertyNo: string,
  newValue: number[]
): void => {
  logger.log(`INF seoj:${seoj} propertyCode:${propertyNo} value:[${newValue}]`);
  udp.sendInf(seoj, propertyNo, newValue);
};

controller.sendCommandCallback = (command: string, option: any): void => {
  if (command === "instanceListNotification") {
    logger.log("send instanceListNotification");
    udp.sendInstanceListNotification();
  }
  if (command === "changedevices") {
    const arr = option as { eoj: string; enabled: boolean }[];
    for (const elem of arr) {
      const echoStatus = controller.allStatusList.find(s => s.eoj === elem.eoj);
      if (echoStatus && echoStatus.enabled !== elem.enabled) {
        echoStatus.enabled = elem.enabled;
        console.log(`Changed ${elem.eoj} to ${elem.enabled}`);
      }
    }
    recreateEchoObjectList();
  }
};
