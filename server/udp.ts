/**
 * udp.ts — Native ECHONET Lite UDP stack
 *
 * Replaces echonet-lite's internal packet dispatcher (EL.returner / EL.initialize)
 * with a single-pass frame parser that handles every EPC in a batched GET/SETC/SETI
 * in one synchronous loop, then emits exactly one UDP datagram per response.
 *
 * No timers, no buffering maps, no patch layers. TID from the incoming frame is
 * copied verbatim to bytes 2-3 of the outgoing frame.
 *
 * What is still used from the echonet-lite npm package:
 *   EL.toHexArray / EL.toHexString  — hex encoding helpers
 *   EL.Node_details                 — canonical Node Profile property storage
 *   EL.EL_obj / EL.EL_cls          — EOJ object / class lists (populated by index.ts)
 *   EL.EL_Multi                     — multicast group address constant
 *   EL.usingIF                      — selected NIC address (set by index.ts)
 *
 * ESV reference (ECHONET Lite spec appendix):
 *   0x60  SETI      — Set, no response
 *   0x61  SETC      — Set, response required  (was 0x61 in older docs; current spec: 0x61=SETI, 0x60=SETC)
 *   0x62  GET
 *   0x63  INF_REQ
 *   0x6E  SETGET
 *   0x71  SET_RES
 *   0x72  GET_RES
 *   0x73  INF
 *   0x74  INFC
 *   0x7A  INFC_RES
 *   0x7E  SETGET_RES
 *   0x50  SETI_SNA
 *   0x51  SETC_SNA
 *   0x52  GET_SNA
 *   0x53  INF_SNA
 *   0x5E  SETGET_SNA
 *
 * Note on ESV byte values — the echonet-lite library exports string constants that
 * hold the hex digit string (e.g. EL.GET === "62"). We compare against numeric
 * literals here to avoid the string-parsing overhead in the hot path.
 */

import dgram from "dgram";
import os from "os";
import EL from "echonet-lite";
import type { EchoStatus } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EL_PORT = 3610;
const EL_MULTICAST_V4 = "224.0.23.0";

// ESV codes as numbers (avoids repeated parseInt in the hot path)
const ESV = {
  SETI:       0x60,
  SETC:       0x61,
  GET:        0x62,
  INF_REQ:    0x63,
  SETGET:     0x6E,
  SET_RES:    0x71,
  GET_RES:    0x72,
  INF:        0x73,
  INFC:       0x74,
  INFC_RES:   0x7A,
  SETGET_RES: 0x7E,
  SETI_SNA:   0x50,
  SETC_SNA:   0x51,
  GET_SNA:    0x52,
  INF_SNA:    0x53,
  SETGET_SNA: 0x5E,
} as const;

// Node Profile EOJ bytes (used to route internally)
const NODE_PROFILE_EOJ = [0x0E, 0xF0, 0x01] as const;
const NODE_PROFILE_HEX = "0ef001";

// ---------------------------------------------------------------------------
// Frame structures
// ---------------------------------------------------------------------------

interface Property {
  epc: number;
  edt: Buffer;
}

interface EchoFrame {
  tid:  Buffer;       // 2 bytes
  seoj: Buffer;       // 3 bytes — source EOJ of sender
  deoj: Buffer;       // 3 bytes — destination EOJ
  esv:  number;
  props: Property[];
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UdpOptions {
  /** Bind to this specific IPv4 address (NIC selection). Defaults to all interfaces. */
  bindAddress?: string;
  debugLog?: boolean;
}

export type SetHandler = (
  eoj: string,
  propertyCode: string,
  value: number[]
) => boolean;

export type GetHandler = (
  eoj: string,
  propertyCode: string
) => number[] | undefined;

export type InfSender = (
  seoj: string,
  propertyCode: string,
  value: number[]
) => void;

export interface UdpServer {
  /** Send an INF (property change announcement) multicast. */
  sendInf: InfSender;
  /** Send an instance-list notification (D5). */
  sendInstanceListNotification: () => void;
  /** Tear down the socket. */
  close: () => void;
}

// ---------------------------------------------------------------------------
// Frame codec
// ---------------------------------------------------------------------------

/**
 * Parse a raw UDP buffer into an EchoFrame.
 * Returns null if the buffer is not a valid ECHONET Lite frame.
 *
 * Frame layout:
 *   [0]     EHD1  = 0x10
 *   [1]     EHD2  = 0x81
 *   [2-3]   TID   (big-endian, echo back verbatim)
 *   [4-6]   SEOJ
 *   [7-9]   DEOJ
 *   [10]    ESV
 *   [11]    OPC   (number of EPC tuples)
 *   [12+]   [EPC(1) PDC(1) EDT(PDC)]*
 */
function parseFrame(buf: Buffer): EchoFrame | null {
  if (buf.length < 12) return null;
  if (buf[0] !== 0x10 || buf[1] !== 0x81) return null;

  const opc = buf[11];
  const props: Property[] = [];
  let offset = 12;

  for (let i = 0; i < opc; i++) {
    if (offset + 2 > buf.length) return null;
    const epc = buf[offset];
    const pdc = buf[offset + 1];
    offset += 2;
    if (offset + pdc > buf.length) return null;
    props.push({ epc, edt: buf.slice(offset, offset + pdc) });
    offset += pdc;
  }

  return {
    tid:  buf.slice(2, 4),
    seoj: buf.slice(4, 7),
    deoj: buf.slice(7, 10),
    esv:  buf[10],
    props,
  };
}

/**
 * Build a complete ECHONET Lite frame ready to send.
 *
 * @param tid   2-byte TID — copied verbatim from incoming request
 * @param seoj  3 bytes — OUR EOJ (we are the responder / sender)
 * @param deoj  3 bytes — THEIR EOJ (recipient)
 * @param esv   ESV byte
 * @param props Array of {epc, edt} pairs to include (OPC = props.length)
 */
function buildFrame(
  tid:   Buffer,
  seoj:  Buffer | number[],
  deoj:  Buffer | number[],
  esv:   number,
  props: Property[]
): Buffer {
  // Pre-calculate total length to avoid reallocations
  const propBytes = props.reduce((acc, p) => acc + 2 + p.edt.length, 0);
  const total = 12 + propBytes;
  const out = Buffer.allocUnsafe(total);

  out[0] = 0x10;
  out[1] = 0x81;
  out[2] = tid[0];
  out[3] = tid[1];

  const s = seoj instanceof Buffer ? seoj : Buffer.from(seoj);
  const d = deoj instanceof Buffer ? deoj : Buffer.from(deoj);
  s.copy(out, 4);
  d.copy(out, 7);

  out[10] = esv;
  out[11] = props.length;

  let pos = 12;
  for (const p of props) {
    out[pos++] = p.epc;
    out[pos++] = p.edt.length;
    p.edt.copy(out, pos);
    pos += p.edt.length;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helper: convert hex EOJ string to 3-byte Buffer
// ---------------------------------------------------------------------------

function eojBuf(hex: string): Buffer {
  return Buffer.from([
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]);
}

function eojHex(buf: Buffer): string {
  return buf[0].toString(16).padStart(2, "0") +
         buf[1].toString(16).padStart(2, "0") +
         buf[2].toString(16).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Node Profile handler
// ---------------------------------------------------------------------------

/**
 * Handle a GET directed at the Node Profile (0EF001).
 * Reads directly from EL.Node_details which is kept current by index.ts.
 * Returns one GET_RES frame with all requested properties.
 * If any property is unknown, returns GET_SNA for that property only
 * (spec §4.2.5: separate packets for mixed results).
 */
function handleNodeProfileGet(frame: EchoFrame): Buffer[] {
  const found:   Property[] = [];
  const missing: Property[] = [];

  for (const req of frame.props) {
    const epcHex = req.epc.toString(16).padStart(2, "0");
    const value = (EL.Node_details as Record<string, number[]>)[epcHex];
    if (value !== undefined) {
      found.push({ epc: req.epc, edt: Buffer.from(value) });
    } else {
      missing.push({ epc: req.epc, edt: Buffer.alloc(0) });
    }
  }

  const packets: Buffer[] = [];
  const npEoj = Buffer.from(NODE_PROFILE_EOJ);

  if (found.length > 0) {
    packets.push(buildFrame(frame.tid, npEoj, frame.seoj, ESV.GET_RES, found));
  }
  if (missing.length > 0) {
    packets.push(buildFrame(frame.tid, npEoj, frame.seoj, ESV.GET_SNA, missing));
  }
  return packets;
}

/**
 * Handle INF_REQ directed at the Node Profile.
 * Responds with INF for each known requested property (spec §4.2.3).
 */
function handleNodeProfileInfReq(frame: EchoFrame): Buffer[] {
  const announced: Property[] = [];
  for (const req of frame.props) {
    const epcHex = req.epc.toString(16).padStart(2, "0");
    const value = (EL.Node_details as Record<string, number[]>)[epcHex];
    if (value !== undefined) {
      announced.push({ epc: req.epc, edt: Buffer.from(value) });
    }
  }
  if (announced.length === 0) return [];
  return [buildFrame(frame.tid, Buffer.from(NODE_PROFILE_EOJ), frame.seoj, ESV.INF, announced)];
}

// ---------------------------------------------------------------------------
// Device handler (all non-Node-Profile EOJs)
// ---------------------------------------------------------------------------

/**
 * Process a GET against device echo objects.
 *
 * Spec §4.2.5: if all properties are found → single GET_RES.
 * If any property is missing → the found ones go in GET_RES, missing in GET_SNA.
 * Both packets share the same TID.
 */
function handleDeviceGet(
  frame:      EchoFrame,
  allStatus:  EchoStatus[],
  deojHex:    string
): Buffer[] {
  const found:   Property[] = [];
  const missing: Property[] = [];

  // Identify which enabled EchoStatus owns this DEOJ
  const matchedStatus = allStatus.find(s => s.enabled && deojHex in s.echoObject);

  for (const req of frame.props) {
    const epcHex = req.epc.toString(16).padStart(2, "0");
    if (matchedStatus && epcHex in matchedStatus.echoObject[deojHex]) {
      const value = matchedStatus.echoObject[deojHex][epcHex];
      found.push({ epc: req.epc, edt: Buffer.from(value) });
    } else {
      missing.push({ epc: req.epc, edt: Buffer.alloc(0) });
    }
  }

  const packets: Buffer[] = [];
  const seojBuf = matchedStatus ? eojBuf(matchedStatus.eoj) : frame.deoj;

  if (found.length > 0) {
    packets.push(buildFrame(frame.tid, seojBuf, frame.seoj, ESV.GET_RES, found));
  }
  if (missing.length > 0) {
    packets.push(buildFrame(frame.tid, seojBuf, frame.seoj, ESV.GET_SNA, missing));
  }
  return packets;
}

/**
 * Process a SETC against device echo objects.
 * Calls setHandler for each EPC. On success → SET_RES; on failure → SETC_SNA.
 * All successes go in one SET_RES packet; all failures in one SETC_SNA packet.
 */
function handleDeviceSetC(
  frame:      EchoFrame,
  allStatus:  EchoStatus[],
  deojHex:    string,
  setHandler: SetHandler
): Buffer[] {
  const ok:   Property[] = [];
  const fail: Property[] = [];

  const matchedStatus = allStatus.find(s => s.enabled && deojHex in s.echoObject);

  for (const req of frame.props) {
    const epcHex = req.epc.toString(16).padStart(2, "0");
    // Check writable: EPC must appear in the 9e (SET map) of the target object
    const setMap = matchedStatus?.echoObject[deojHex]["9e"] ?? [];
    const isWritable = setMap.slice(1).includes(req.epc);

    if (isWritable && matchedStatus) {
      const handled = setHandler(deojHex, epcHex, Array.from(req.edt));
      if (handled) {
        ok.push({ epc: req.epc, edt: Buffer.alloc(0) }); // SET_RES: PDC=0
      } else {
        fail.push({ epc: req.epc, edt: Buffer.alloc(0) });
      }
    } else {
      fail.push({ epc: req.epc, edt: Buffer.alloc(0) });
    }
  }

  const packets: Buffer[] = [];
  const seojBuf = matchedStatus ? eojBuf(matchedStatus.eoj) : frame.deoj;

  if (ok.length > 0) {
    packets.push(buildFrame(frame.tid, seojBuf, frame.seoj, ESV.SET_RES, ok));
  }
  if (fail.length > 0) {
    packets.push(buildFrame(frame.tid, seojBuf, frame.seoj, ESV.SETC_SNA, fail));
  }
  return packets;
}

/**
 * Process a SETI (Set, no response required).
 * Calls setHandler for each EPC silently.
 */
function handleDeviceSetI(
  frame:      EchoFrame,
  allStatus:  EchoStatus[],
  deojHex:    string,
  setHandler: SetHandler
): void {
  const matchedStatus = allStatus.find(s => s.enabled && deojHex in s.echoObject);
  if (!matchedStatus) return;

  for (const req of frame.props) {
    const epcHex = req.epc.toString(16).padStart(2, "0");
    setHandler(deojHex, epcHex, Array.from(req.edt));
  }
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function startUdpServer(
  getAllStatus:  () => EchoStatus[],
  setHandler:   SetHandler,
  options:      UdpOptions = {}
): UdpServer {
  const { bindAddress, debugLog = false } = options;

  const log = debugLog
    ? (msg: string) => console.log(new Date().toISOString() + "\t[UDP] " + msg)
    : (_: string) => { /* no-op */ };

  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

  // -------------------------------------------------------------------------
  // Send helper — used for both unicast responses and multicast INF
  // -------------------------------------------------------------------------
  function send(packet: Buffer, host: string): void {
    sock.send(packet, 0, packet.length, EL_PORT, host, (err) => {
      if (err) console.error("[UDP] send error:", err);
    });
  }

  // -------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------
  sock.bind(EL_PORT, () => {
    // Join ECHONET multicast group on the correct interface
    try {
      sock.addMembership(EL_MULTICAST_V4, bindAddress);
    } catch (e) {
      console.error("[UDP] addMembership error:", e);
    }
    sock.setBroadcast(true);
    sock.setMulticastTTL(4);
    log(`Bound to 0.0.0.0:${EL_PORT}, multicast ${EL_MULTICAST_V4}`);
  });

  // -------------------------------------------------------------------------
  // Determine our own IP addresses so we can ignore our own multicast echoes
  // -------------------------------------------------------------------------
  function ownAddresses(): Set<string> {
    const addrs = new Set<string>();
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const info of list ?? []) {
        if (info.family === "IPv4") addrs.add(info.address);
      }
    }
    return addrs;
  }

  // -------------------------------------------------------------------------
  // Message handler
  // -------------------------------------------------------------------------
  sock.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
    // Ignore our own multicast echoes
    if (ownAddresses().has(rinfo.address)) return;

    const frame = parseFrame(msg);
    if (!frame) {
      log(`Ignoring malformed packet from ${rinfo.address} (${msg.length} bytes)`);
      return;
    }

    const deojHex = eojHex(frame.deoj);
    const seojHex = eojHex(frame.seoj);

    log(`RX from ${rinfo.address}: ESV=0x${frame.esv.toString(16)} SEOJ=${seojHex} DEOJ=${deojHex} OPC=${frame.props.length}`);

    let responses: Buffer[] = [];

    // Route by DEOJ first, then ESV
    if (deojHex === NODE_PROFILE_HEX) {
      // Node Profile requests
      switch (frame.esv) {
        case ESV.GET:
          responses = handleNodeProfileGet(frame);
          break;
        case ESV.INF_REQ:
          responses = handleNodeProfileInfReq(frame);
          break;
        case ESV.SETI:
          // Node Profile SETI is read-only; silently ignore
          break;
        default:
          log(`Unhandled Node Profile ESV 0x${frame.esv.toString(16)}`);
      }
    } else {
      // Device requests
      const allStatus = getAllStatus();
      switch (frame.esv) {
        case ESV.GET:
          responses = handleDeviceGet(frame, allStatus, deojHex);
          break;
        case ESV.SETC:
          responses = handleDeviceSetC(frame, allStatus, deojHex, setHandler);
          break;
        case ESV.SETI:
          handleDeviceSetI(frame, allStatus, deojHex, setHandler);
          break;
        case ESV.INF_REQ:
          // Treat INF_REQ to a device the same as GET (respond with current values)
          responses = handleDeviceGet(frame, allStatus, deojHex);
          break;
        default:
          log(`Unhandled device ESV 0x${frame.esv.toString(16)} for ${deojHex}`);
      }
    }

    // Send all response packets (typically 1, at most 2 for mixed found/missing)
    for (const packet of responses) {
      log(`TX to ${rinfo.address}: ESV=0x${packet[10].toString(16)} OPC=${packet[11]} (${packet.length} bytes)`);
      send(packet, rinfo.address);
    }
  });

  sock.on("error", (err) => {
    console.error("[UDP] socket error:", err);
  });

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Send an INF property-change announcement via multicast. */
  const sendInf: InfSender = (seoj, propertyCode, value) => {
    const seojBuf = eojBuf(seoj);
    const deojBuf = Buffer.from([0x05, 0xFF, 0x01]); // ECHONET controller group
    const epc = parseInt(propertyCode, 16);
    const prop: Property = { epc, edt: Buffer.from(value) };
    // TID 0x0000 for unsolicited INF (spec permits any non-zero TID too)
    const tid = Buffer.from([0x00, 0x00]);
    const packet = buildFrame(tid, seojBuf, deojBuf, ESV.INF, [prop]);
    log(`TX INF seoj=${seoj} epc=0x${propertyCode} to multicast`);
    send(packet, EL_MULTICAST_V4);
  };

  /** Send the instance-list notification (D5) INF. */
  const sendInstanceListNotification = (): void => {
    const d5 = EL.Node_details["d5"] as number[] | undefined;
    if (!d5) return;
    const npBuf = Buffer.from(NODE_PROFILE_EOJ);
    const deojBuf = Buffer.from([0x0E, 0xF0, 0x01]);
    const prop: Property = { epc: 0xD5, edt: Buffer.from(d5) };
    const tid = Buffer.from([0x00, 0x00]);
    const packet = buildFrame(tid, npBuf, deojBuf, ESV.INF, [prop]);
    log("TX instance list notification (D5)");
    send(packet, EL_MULTICAST_V4);
  };

  const close = (): void => {
    sock.close();
  };

  return { sendInf, sendInstanceListNotification, close };
}
