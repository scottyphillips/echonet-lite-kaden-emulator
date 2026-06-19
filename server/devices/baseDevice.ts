import { EchoObject, EchoStatus } from "../types";

/**
 * Base interface for all ECHONETLite devices.
 * Provides a common structure for device initialization and property management.
 */
export interface IBaseDevice {
  /** The EOJ (ECHONET Object) identifier string */
  eoj: string;

  /** Whether this device is enabled */
  enabled: boolean;

  /** The ECHONET echo object configuration */
  echoObject: EchoObject;

  /** Set common properties on the echo object */
  setCommonProperties(id?: string): void;
}

/**
 * Factory function type for creating device instances.
 * Devices that need access to shared methods can receive them as callbacks.
 */
export type DeviceFactory<D extends IBaseDevice> = (
  options?: { onPropertyChanged?: PropertyChangedCallback }
) => D;

export type PropertyChangedCallback = (
  echoStatus: EchoStatus,
  eoj: string,
  propertyNo: string,
  newValue: number[]
) => void;

/**
 * Helper to create the base EchoStatus with common properties.
 */
export function createEchoStatus(
  eoj: string,
  echoObject: EchoObject,
  enabled: boolean = true
): EchoStatus {
  return { eoj, echoObject, enabled };
}

/**
 * Sets common ECHONETLite properties on an echo object.
 * This includes: settings location, spec version, abnormal state, manufacturer code, and property maps.
 */
export function setCommonProperties(echoObject: EchoObject, id: string = ""): void {
  for (const key in echoObject) {
    echoObject[key]["80"] ??= [0x30]; // Operation status (preserve if already set)
    echoObject[key]["81"] = [0x00]; // Installation location
    echoObject[key]["82"] = [0x00, 0x00, 0x50, 0x01]; // Specification version info
    echoObject[key]["88"] = [0x42]; // Abnormal state
    echoObject[key]["8a"] = [0xff, 0xff, 0xff]; // Manufacturer code

    if (id !== "") {
      // Import EL at runtime to avoid circular dependency issues
      const EL = require("echonet-lite");
      echoObject[key]["83"] = EL.toHexArray(id);
    }

    // Build GetProperties map (9F)
    const getProperties: number[] = [0x00];
    for (const propertyNo in echoObject[key]) {
      if (propertyNo.match(/[0-9A-Fa-f]{2}/) !== null) {
        getProperties.push(parseInt(propertyNo, 16));
      }
    }
    getProperties.push(0x9f); // Get property map

    getProperties[0] = getProperties.length - 1;
    if (getProperties.length <= 16) {
      echoObject[key]["9f"] = getProperties;
    } else {
      const getPropertiesPart2 = new Array(17).fill(0x00);
      getPropertiesPart2[0] = getProperties.length - 1;
      for (let i = 1; i < getProperties.length; i++) {
        const propCode = getProperties[i];
        const byteIndex = Math.floor((propCode - 0x80) / 8) + 1;
        const bit = (propCode - 0x80) % 8;
        getPropertiesPart2[byteIndex] = getPropertiesPart2[byteIndex] | (0x01 << bit);
      }
      echoObject[key]["9f"] = getPropertiesPart2;
    }
  }
}