import { EchoObject, EchoStatus } from "../types";
import { IBaseDevice, createEchoStatus, setCommonProperties } from "./baseDevice";

export interface DistributionPanelMeterControllerStatus {
  operationStatus: "on" | "off";
  faultStatus: "faultOccurred" | "noFault";
  // instantaneousPowerConsumption: number;
  // cumulativeElectricEnergy: number;
  currentLimit: number;
}

export class DistributionPanelMeterControllerDevice implements IBaseDevice {
  readonly eoj = "05ff01";
  enabled: boolean = true;
  
  private _status: DistributionPanelMeterControllerStatus = {
    operationStatus: "on",
    faultStatus: "noFault",
    // instantaneousPowerConsumption: 2342,
    //cumulativeElectricEnergy: 15432,
    currentLimit: 80,
  };

  private _echoObject: EchoObject = {
    "05ff01": {
      // Operation status (0x30=ON, 0x31=OFF)
      80: [0x30],
      // Installation location
      81: [0x00],
      // Fault status (0x41=Fault, 0x42=No fault)
      //88: [0x42],
      // Measured instantaneous power consumption (uint16, unit: W) - 2342W
      // 84: [0x09, 0x26],
      // Measured cumulative electric energy consumption (uint32, unit: 0.001 kWh) - 15.432 kWh
      85: [0x00, 0x00, 0x3C, 0x18],
      // Current limit setting (uint8, unit: %) - 80%
      87: [0x50],
      // Fault description (single byte) - No fault
      89: [0x00],
      // Power-saving operation setting - Normal Operation
      "8f": [0x42],
      // Power limit setting (uint16, unit: W) - 6000W
      99: [0x17, 0xA0],
      // Cumulative operating time (5 bytes: unit + 4 bytes value) - hours
      "9a": [0x02, 0x00, 0x03, 0xA1, 0xF8],
      //
      "9d": [0x01, 0x80], // Status change announcement property map
      "9e": [0x01, 0x80], // Set property map
      "9f": [0x0d, 0x80, 0x81, 0x84, 0x85, 0x87, 0x88, 0x89, 0x8f, 0x99, 0x9a, 0x9d, 0x9e, 0x9f], // Get property map
    },
  };

  private _echoStatus: EchoStatus;
  private onPropertyChanged?: (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => void;

  constructor(options?: { onPropertyChanged?: (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => void }) {
    this.onPropertyChanged = options?.onPropertyChanged;
    
    this._echoStatus = createEchoStatus(
      this.eoj,
      this._echoObject,
      this.enabled
    );

    // Set common properties after initial setup
    setCommonProperties(this._echoObject);
  }

  get status(): DistributionPanelMeterControllerStatus {
    return { ...this._status };
  }

  get echoObject(): EchoObject {
    return this._echoObject;
  }

  get echoStatus(): EchoStatus {
    return this._echoStatus;
  }

  setCommonProperties(id?: string): void {
    setCommonProperties(this._echoObject, id);
  }

  setStatus(newStatus: Partial<DistributionPanelMeterControllerStatus>): void {
    let changed = false;

    if (newStatus.operationStatus !== undefined) {
      const state = newStatus.operationStatus === "on" ? "on" : "off";
      if (this._status.operationStatus !== state) {
        this._status.operationStatus = state;
        this._echoObject["05ff01"]["80"] = state === "on" ? [0x30] : [0x31];
        this.notifyPropertyChanged("80");
        changed = true;
      }
    }

    if (newStatus.faultStatus !== undefined) {
      const fault = newStatus.faultStatus === "faultOccurred" ? "faultOccurred" : "noFault";
      if (this._status.faultStatus !== fault) {
        this._status.faultStatus = fault;
        this._echoObject["05ff01"]["88"] = fault === "faultOccurred" ? [0x41] : [0x42];
        this.notifyPropertyChanged("88");
        changed = true;
      }
    }

    if (newStatus.instantaneousPowerConsumption !== undefined) {
      const value = Math.max(0, Math.min(65533, newStatus.instantaneousPowerConsumption));
      if (this._status.instantaneousPowerConsumption !== value) {
        this._status.instantaneousPowerConsumption = value;
        this._echoObject["05ff01"]["84"] = [
          (value >> 8) & 0xff,
          value & 0xff,
        ];
        this.notifyPropertyChanged("84");
        changed = true;
      }
    }

    if (newStatus.cumulativeElectricEnergy !== undefined) {
      const value = Math.max(0, Math.min(999999999, newStatus.cumulativeElectricEnergy));
      if (this._status.cumulativeElectricEnergy !== value) {
        this._status.cumulativeElectricEnergy = value;
        this._echoObject["05ff01"]["85"] = [
          (value >> 24) & 0xff,
          (value >> 16) & 0xff,
          (value >> 8) & 0xff,
          value & 0xff,
        ];
        this.notifyPropertyChanged("85");
        changed = true;
      }
    }

    if (newStatus.currentLimit !== undefined) {
      const value = Math.max(0, Math.min(100, newStatus.currentLimit));
      if (this._status.currentLimit !== value) {
        this._status.currentLimit = value;
        this._echoObject["05ff01"]["87"] = [value];
        this.notifyPropertyChanged("87");
        changed = true;
      }
    }

    if (changed) {
      // Notify all properties after status change
      const properties = ["80", "84", "85", "87", "88", "89", "8f", "99", "9a"];
      for (const prop of properties) {
        this.notifyPropertyChanged(prop);
      }
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    const prop = propertyCodeText.toLowerCase();
    
    switch (prop) {
      case "80": // Operation status
        if (newValue.length > 0) {
          const state = newValue[0] === 0x30 ? "on" : "off";
          this.setStatus({ operationStatus: state });
          return true;
        }
        break;

      case "87": // Current limit setting
        if (newValue.length > 0) {
          this.setStatus({ currentLimit: newValue[0] });
          return true;
        }
        break;

      case "8f": // Power-saving operation setting
        if (newValue.length > 0) {
          // Not exposed in status but settable
          return true;
        }
        break;

      case "93": // Remote control setting
        if (newValue.length > 0) {
          return true;
        }
        break;

      case "97": // Current time setting
        return true;

      case "98": // Current date setting
        return true;

      case "99": // Power limit setting
        if (newValue.length >= 2) {
          const value = (newValue[0] << 8) | newValue[1];
          this.setStatus({ instantaneousPowerConsumption: value });
          return true;
        }
        break;
    }
    return false;
  }

  private notifyPropertyChanged(propertyNo: string): void {
    if (this.onPropertyChanged && this.enabled) {
      this.onPropertyChanged(
        this._echoStatus,
        this.eoj,
        propertyNo,
        this._echoObject[this.eoj][propertyNo]
      );
    }
  }

  /**
   * Update power consumption value from ECHONET notification.
   */
  updatePowerConsumption(watts: number): void {
    this.setStatus({ instantaneousPowerConsumption: watts });
  }

  /**
   * Update cumulative energy consumption (in kWh).
   */
  updateEnergyConsumption(kwh: number): void {
    this.setStatus({ cumulativeElectricEnergy: kwh });
  }

  /**
   * Simulate a fault condition.
   */
  setFaultCondition(faulty: boolean): void {
    this.setStatus({ faultStatus: faulty ? "faultOccurred" : "noFault" });
  }
}