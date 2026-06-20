import { EchoObject, EchoStatus } from "../types";
import { IBaseDevice, createEchoStatus, setCommonProperties } from "./baseDevice";

export class DistributionPanelMeterDevice implements IBaseDevice {
  readonly eoj = "05ff01";
  enabled: boolean = true;
  echoObject: EchoObject;
  
  private _status: {
    operationStatus: "on" | "off";
    faultStatus: "faultOccurred" | "noFault";
    instantaneousPowerConsumption: number;
    cumulativeElectricEnergy: number;
    currentLimit: number;
  } = {
    operationStatus: "on",
    faultStatus: "noFault",
    instantaneousPowerConsumption: 2342,
    cumulativeElectricEnergy: 15432,
    currentLimit: 80,
  };
  private _echoStatus: EchoStatus;
  private onPropertyChanged?: (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => void;

  constructor(options?: { onPropertyChanged?: (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => void }) {
    this.onPropertyChanged = options?.onPropertyChanged;
    
    // Define EPC properties with mandatory + example data types
    const properties = {
      // Mandatory properties
      "80": [0x30],        // Operation status (0x30=ON, 0x31=OFF)
      "81": [0x00],        // Installation location
      "88": [0x42],        // Fault status (0x41=Fault, 0x42=No fault)
      
      // Measured instantaneous power consumption (uint16, unit: W) - 2342W
      "84": [0x09, 0x26],  // 0x0926 = 2342 W
      
      // Measured cumulative electric energy consumption (uint32, unit: 0.001 kWh) - 15.432 kWh
      "85": [0x00, 0x00, 0x3C, 0x18],  // 0x00003C18 = 15432 * 0.001 = 15.432 kWh
      
      // Current limit setting (uint8, unit: %) - 80%
      "87": [0x50],        // 0x50 = 80%
      
      // Fault description (single byte) - No fault
      "89": [0x00],
      
      // Power-saving operation setting - Normal Operation
      "8F": [0x42],
      
      // Power limit setting (uint16, unit: W) - 6000W
      "99": [0x17, 0xA0],  // 0x17A0 = 6000 W
      
      // Cumulative operating time (5 bytes: unit + 4 bytes value) - hours
      "9A": [0x02, 0x00, 0x03, 0xA1, 0xF8],  // unit=0x02(hours), value=250000
    };

    this._echoStatus = createEchoStatus(
      this.eoj,
      {
        "05ff01": properties,
      },
      this.enabled
    );
    this.echoObject = this._echoStatus.echoObject;
  }

  get status() {
    return { ...this._status };
  }

  get echoStatus(): EchoStatus {
    return this._echoStatus;
  }

  setCommonProperties(id?: string): void {
    setCommonProperties(this.echoObject, id);
  }

  setStatus(newStatus: Partial<typeof this._status>): void {
    let changed = false;

    if (newStatus.operationStatus !== undefined) {
      const state = newStatus.operationStatus === "on" ? "on" : "off";
      if (this._status.operationStatus !== state) {
        this._status.operationStatus = state;
        this._echoStatus.echoObject["05ff01"]["80"] = state === "on" ? [0x30] : [0x31];
        changed = true;
      }
    }

    if (newStatus.faultStatus !== undefined) {
      const fault = newStatus.faultStatus === "faultOccurred" ? "faultOccurred" : "noFault";
      if (this._status.faultStatus !== fault) {
        this._status.faultStatus = fault;
        this._echoStatus.echoObject["05ff01"]["88"] = fault === "faultOccurred" ? [0x41] : [0x42];
        changed = true;
      }
    }

    if (newStatus.instantaneousPowerConsumption !== undefined) {
      const value = Math.max(0, Math.min(65533, newStatus.instantaneousPowerConsumption));
      if (this._status.instantaneousPowerConsumption !== value) {
        this._status.instantaneousPowerConsumption = value;
        this._echoStatus.echoObject["05ff01"]["84"] = [
          (value >> 8) & 0xff,
          value & 0xff,
        ];
        changed = true;
      }
    }

    if (newStatus.cumulativeElectricEnergy !== undefined) {
      const value = Math.max(0, Math.min(999999999, newStatus.cumulativeElectricEnergy));
      if (this._status.cumulativeElectricEnergy !== value) {
        this._status.cumulativeElectricEnergy = value;
        this._echoStatus.echoObject["05ff01"]["85"] = [
          (value >> 24) & 0xff,
          (value >> 16) & 0xff,
          (value >> 8) & 0xff,
          value & 0xff,
        ];
        changed = true;
      }
    }

    if (newStatus.currentLimit !== undefined) {
      const value = Math.max(0, Math.min(100, newStatus.currentLimit));
      if (this._status.currentLimit !== value) {
        this._status.currentLimit = value;
        this._echoStatus.echoObject["05ff01"]["87"] = [value];
        changed = true;
      }
    }

    if (changed) {
      this.notifyAllProperties();
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
        this._echoStatus.echoObject[this.eoj][propertyNo]
      );
    }
  }

  private notifyAllProperties(): void {
    if (!this.enabled) return;
    
    const eoj = "05ff01";
    const properties = ["80", "84", "85", "87", "88", "89", "8F", "99", "9A"];
    for (const prop of properties) {
      this.notifyPropertyChanged(prop);
    }
  }

  /**
   * Update power consumption value from ECHONET notification
   */
  updatePowerConsumption(watts: number): void {
    this.setStatus({ instantaneousPowerConsumption: watts });
  }

  /**
   * Update cumulative energy consumption (in kWh)
   */
  updateEnergyConsumption(kwh: number): void {
    this.setStatus({ cumulativeElectricEnergy: kwh });
  }

  /**
   * Simulate a fault condition
   */
  setFaultCondition(faulty: boolean): void {
    this.setStatus({ faultStatus: faulty ? "faultOccurred" : "noFault" });
  }
}