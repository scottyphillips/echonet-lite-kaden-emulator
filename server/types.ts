/**
 * ECHONET Lite Core Types
 * 
 * Defines the fundamental data structures for the ECHONET Lite emulator.
 */

import { InspectOptions } from "util";

// ---------------------------------------------------------------------------
// Core ECHONET Types
// ---------------------------------------------------------------------------

/**
 * ECHONET Object (EOJ) structure.
 * Key: EOJ address (e.g., "013001")
 * Value: Property map where key is EPC code and value is array of hex bytes
 */
export type EchoObject = { [key: string]: { [key: string]: number[] } };

/**
 * ECHONET device status wrapper.
 * Contains the EOJ address, echo object definition, and enabled state.
 */
export interface EchoStatus {
  eoj: string;           // EOJ address (e.g., "013001")
  echoObject: EchoObject;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Logger Interface
// ---------------------------------------------------------------------------

export interface ILogger {
  log(message: string): void;
  dir(obj: any, options?: InspectOptions): void;
}