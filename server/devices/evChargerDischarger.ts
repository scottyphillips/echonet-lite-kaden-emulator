import { EchoObject, EchoStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

export interface EvChargerDischargerStatus {
  operationStatus: "on" | "off";
  installationLocation: string;
  faultStatus: "noFault" | "faultOccurred";
  vehicleConnectionAndChargeableStatus: "notConnected" | "connected" | "chargeable" | "dischargeable" | "chargeableAndDischargeable";
  operationModeSetting: "rapidCharge" | "charge" | "discharge" | "standby" | "test" | "other";
  systemInterconnectionType: "gridConnectionReverseFlowAcceptable" | "independentOperation" | "gridConnectionReverseFlowNotAcceptable";
  chargingMethod: "others" | "maxChargingPower" | "surplusPower" | "designatedPower" | "designatedCurrent" | "designatedPurchasingPower";
  dischargingMethod: "others" | "maxDischargingPower" | "loadFollowing" | "designatedPower" | "designatedCurrent" | "designatedPurchasingPower";
  actualOperationMode: "charge" | "discharge" | "standby" | "idle" | "preparation" | "other";
  maintenanceStatus: "maintenanceNeeded" | "normal";
  instantaneousPowerConsumption: number; // Watts (0x84)
  cumulativeElectricEnergyConsumption: number; // 0.001kWh increments (0x85)
}

export class EvChargerDischargerDevice {
  readonly eoj = "027e01";
  enabled: boolean = true;

  private _status: EvChargerDischargerStatus = {
    operationStatus: "off",                    // 0x31=Off, 0x30=On
    installationLocation: "Outdoor",            // 0x81: Installation location
    faultStatus: "noFault",                     // 0x42=No fault
    vehicleConnectionAndChargeableStatus: "chargeableAndDischargeable", // 0x43=Chargeable and Dischargeable
    operationModeSetting: "charge",             // 0x42=Charge
    systemInterconnectionType: "gridConnectionReverseFlowAcceptable", // 0x0=Grid connection (reverse flow acceptable)
    chargingMethod: "maxChargingPower",         // 0x1=Maximum charging electric power charging
    dischargingMethod: "loadFollowing",         // 0x2=Load-following discharging
    actualOperationMode: "standby",             // 0x44=Standby
    maintenanceStatus: "normal",                // 0x42=Occurrence status not found
    instantaneousPowerConsumption: 0,           // 0x84: Current power consumption in Watts
    cumulativeElectricEnergyConsumption: 0,     // 0x85: Cumulative energy in 0.001kWh units
  };

  private _echoObject: EchoObject = {
    "027e01": {
      // Mandatory EPCs (inf: required)
      0x80: [0x31],                              // Operation status (0x80): 0x30=On, 0x31=Off (required, GET/SET)
      0x81: [0x01],                              // Installation location (0x81): 0x01=Outdoor (required, GET/SET)
      0x88: [0x42],                              // Fault status (0x88): 0x41=Fault occurred, 0x42=No fault (required, GET)
      0xC7: [0x43],                              // Vehicle connection and chargeable/dischargeable status (0xC7): 0x30=Not Connected, 0x40=Connected, 0x41=Chargeable, 0x42=Dischargeable, 0x43=Chargeable+Dischargeable (required, GET)
      0xDA: [0x42],                              // Operation mode setting (0xDA): 0x41=Rapid charge, 0x42=Charge, 0x43=Discharge, 0x44=Standby, 0x45=Test, 0x40=Other (required, GET/SET)
      0xDB: [0x00],                              // System interconnection type (0xDB): 0x0=Grid connection (reverse flow acceptable), 0x1=Independent operation, 0x2=Grid connection (reverse flow not acceptable) (required, GET)
      0xDC: [0x01],                              // Charging method (0xDC): 0x0=Others, 0x1=Max charging power, 0x2=Surplus power, 0x3=Designated power, 0x4=Designated current, 0x5=Designated purchasing power (required, GET/SET)
      0xDD: [0x02],                              // Discharging method (0xDD): 0x0=Others, 0x1=Max discharging power, 0x2=Load-following, 0x3=Designated power, 0x4=Designated current, 0x5=Designated purchasing power (required, GET/SET)
      0xE1: [0x44],                              // Actual operation mode (0xE1): 0x42=Charge, 0x43=Discharge, 0x44=Standby, 0x47=Idle, 0x48=Preparation, 0x40=Other (required, GET)
      0xE5: [0x42],                              // Maintenance status (0xE5): 0x41=Maintenance needed, 0x42=Normal (required, GET)
      
      // Optional EPCs with test data
      0x84: [0x00, 0x00],                        // Measured instantaneous power consumption (0x84): uint16, watts (currently 0W)
      0x85: [0x00, 0x00, 0x00, 0x00],            // Measured cumulative electric energy consumption (0x85): uint32, 0.001kWh increments
      
      // Property maps
      "9d": [0x0B, 0x80, 0x81, 0x84, 0x85, 0x88, 0xC7, 0xDA, 0xDB, 0xDC, 0xDD, 0xE1, 0xE5], // Status change announcement property map (STATMAP)
      "9e": [0x04, 0x80, 0x81, 0xDA, 0xDC],     // Set property map (SETMAP): 0x80, 0x81, 0xDA, 0xDC are settable
      "9f": [0x0B, 0x80, 0x81, 0x84, 0x85, 0x88, 0xC7, 0xDA, 0xDB, 0xDC, 0xDD, 0xE1, 0xE5], // Get property map (GETMAP)
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
  }

  get status(): EvChargerDischargerStatus {
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

  setStatus(newStatus: Partial<EvChargerDischargerStatus>): void {
    // Update status and echo object for each changed property
    if (newStatus.operationStatus !== undefined) {
      this._status.operationStatus = newStatus.operationStatus!;
      const statusValue = newStatus.operationStatus === "on" ? 0x30 : 0x31;
      this._echoObject["027e01"][0x80] = [statusValue];
      this.notifyPropertyChanged("80");
    }

    if (newStatus.installationLocation !== undefined) {
      this._status.installationLocation = newStatus.installationLocation!;
      // Simple string encoding for installation location
      const locBytes: number[] = [];
      const locStr = newStatus.installationLocation;
      for (let i = 0; i < locStr.length && i < 32; i++) {
        locBytes.push(locStr.charCodeAt(i));
      }
      this._echoObject["027e01"][0x81] = locBytes.length > 0 ? locBytes : [0x00];
      this.notifyPropertyChanged("81");
    }

    if (newStatus.faultStatus !== undefined) {
      this._status.faultStatus = newStatus.faultStatus!;
      const faultValue = newStatus.faultStatus === "faultOccurred" ? 0x41 : 0x42;
      this._echoObject["027e01"][0x88] = [faultValue];
      this.notifyPropertyChanged("88");
    }

    if (newStatus.vehicleConnectionAndChargeableStatus !== undefined) {
      this._status.vehicleConnectionAndChargeableStatus = newStatus.vehicleConnectionAndChargeableStatus!;
      const statusMap: Record<string, number> = {
        "notConnected": 0x30,
        "connected": 0x40,
        "chargeable": 0x41,
        "dischargeable": 0x42,
        "chargeableAndDischargeable": 0x43
      };
      this._echoObject["027e01"][0xC7] = [statusMap[newStatus.vehicleConnectionAndChargeableStatus] || 0x30];
      this.notifyPropertyChanged("C7");
    }

    if (newStatus.operationModeSetting !== undefined) {
      this._status.operationModeSetting = newStatus.operationModeSetting!;
      const modeMap: Record<string, number> = {
        "rapidCharge": 0x41,
        "charge": 0x42,
        "discharge": 0x43,
        "standby": 0x44,
        "test": 0x45,
        "other": 0x40
      };
      this._echoObject["027e01"][0xDA] = [modeMap[newStatus.operationModeSetting] || 0x40];
      this.notifyPropertyChanged("DA");
      
      // Also update actual operation mode when operation mode changes
      if (newStatus.operationModeSetting === "charge") {
        this._status.actualOperationMode = "charge";
        this._echoObject["027e01"][0xE1] = [0x42];
        this.notifyPropertyChanged("E1");
        
        // Simulate power consumption when charging
        this._status.instantaneousPowerConsumption = 3000; // 3kW
        this._echoObject["027e01"][0x84] = this.toUint16Array(3000);
        this.notifyPropertyChanged("84");
      } else if (newStatus.operationModeSetting === "standby") {
        this._status.actualOperationMode = "standby";
        this._echoObject["027e01"][0xE1] = [0x44];
        this.notifyPropertyChanged("E1");
        
        // Zero power when standby
        this._status.instantaneousPowerConsumption = 0;
        this._echoObject["027e01"][0x84] = this.toUint16Array(0);
        this.notifyPropertyChanged("84");
      }
    }

    if (newStatus.systemInterconnectionType !== undefined) {
      this._status.systemInterconnectionType = newStatus.systemInterconnectionType!;
      const typeMap: Record<string, number> = {
        "gridConnectionReverseFlowAcceptable": 0x00,
        "independentOperation": 0x01,
        "gridConnectionReverseFlowNotAcceptable": 0x02
      };
      this._echoObject["027e01"][0xDB] = [typeMap[newStatus.systemInterconnectionType] || 0x00];
      this.notifyPropertyChanged("DB");
    }

    if (newStatus.chargingMethod !== undefined) {
      this._status.chargingMethod = newStatus.chargingMethod!;
      const methodMap: Record<string, number> = {
        "others": 0x00,
        "maxChargingPower": 0x01,
        "surplusPower": 0x02,
        "designatedPower": 0x03,
        "designatedCurrent": 0x04,
        "designatedPurchasingPower": 0x05
      };
      this._echoObject["027e01"][0xDC] = [methodMap[newStatus.chargingMethod] || 0x00];
      this.notifyPropertyChanged("DC");
    }

    if (newStatus.dischargingMethod !== undefined) {
      this._status.dischargingMethod = newStatus.dischargingMethod!;
      const methodMap: Record<string, number> = {
        "others": 0x00,
        "maxDischargingPower": 0x01,
        "loadFollowing": 0x02,
        "designatedPower": 0x03,
        "designatedCurrent": 0x04,
        "designatedPurchasingPower": 0x05
      };
      this._echoObject["027e01"][0xDD] = [methodMap[newStatus.dischargingMethod] || 0x00];
      this.notifyPropertyChanged("DD");
    }

    if (newStatus.actualOperationMode !== undefined) {
      this._status.actualOperationMode = newStatus.actualOperationMode!;
      const modeMap: Record<string, number> = {
        "charge": 0x42,
        "discharge": 0x43,
        "standby": 0x44,
        "idle": 0x47,
        "preparation": 0x48,
        "other": 0x40
      };
      this._echoObject["027e01"][0xE1] = [modeMap[newStatus.actualOperationMode] || 0x40];
      this.notifyPropertyChanged("E1");
    }

    if (newStatus.maintenanceStatus !== undefined) {
      this._status.maintenanceStatus = newStatus.maintenanceStatus!;
      const maintValue = newStatus.maintenanceStatus === "maintenanceNeeded" ? 0x41 : 0x42;
      this._echoObject["027e01"][0xE5] = [maintValue];
      this.notifyPropertyChanged("E5");
    }

    if (newStatus.instantaneousPowerConsumption !== undefined) {
      this._status.instantaneousPowerConsumption = newStatus.instantaneousPowerConsumption!;
      this._echoObject["027e01"][0x84] = this.toUint16Array(newStatus.instantaneousPowerConsumption);
      this.notifyPropertyChanged("84");
    }

    if (newStatus.cumulativeElectricEnergyConsumption !== undefined) {
      this._status.cumulativeElectricEnergyConsumption = newStatus.cumulativeElectricEnergyConsumption!;
      this._echoObject["027e01"][0x85] = this.toUint32Array(newStatus.cumulativeElectricEnergyConsumption);
      this.notifyPropertyChanged("85");
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    const prop = propertyCodeText.toUpperCase();
    
    switch (prop) {
      case "80":
        // Operation status: 0x30=On, 0x31=Off
        this.setStatus({ operationStatus: newValue[0] === 0x30 ? "on" : "off" });
        return true;
      
      case "81":
        // Installation location (simple string)
        const locStr = newValue.map(b => String.fromCharCode(b)).join('');
        this.setStatus({ installationLocation: locStr });
        return true;
      
      case "DA":
        // Operation mode setting
        const modeMap: Record<number, string> = {
          0x41: "rapidCharge",
          0x42: "charge",
          0x43: "discharge",
          0x44: "standby",
          0x45: "test",
          0x40: "other"
        };
        const mode = modeMap[newValue[0]];
        if (mode) {
          this.setStatus({ operationModeSetting: mode as EvChargerDischargerStatus["operationModeSetting"] });
          return true;
        }
        break;
      
      case "DC":
        // Charging method
        const methodMap: Record<number, string> = {
          0x00: "others",
          0x01: "maxChargingPower",
          0x02: "surplusPower",
          0x03: "designatedPower",
          0x04: "designatedCurrent",
          0x05: "designatedPurchasingPower"
        };
        const method = methodMap[newValue[0]];
        if (method) {
          this.setStatus({ chargingMethod: method as EvChargerDischargerStatus["chargingMethod"] });
          return true;
        }
        break;

      case "DD":
        // Discharging method
        const dischargeMethodMap: Record<number, string> = {
          0x00: "others",
          0x01: "maxDischargingPower",
          0x02: "loadFollowing",
          0x03: "designatedPower",
          0x04: "designatedCurrent",
          0x05: "designatedPurchasingPower"
        };
        const dischargeMethod = dischargeMethodMap[newValue[0]];
        if (dischargeMethod) {
          this.setStatus({ dischargingMethod: dischargeMethod as EvChargerDischargerStatus["dischargingMethod"] });
          return true;
        }
        break;
    }
    
    return false;
  }

  private toUint16Array(value: number): number[] {
    return [
      (value >> 8) & 0xff,
      value & 0xff,
    ];
  }

  private toUint32Array(value: number): number[] {
    return [
      (value >> 24) & 0xff,
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ];
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
   * Helper to get human-readable description for an EPC value
   */
  getPropertyDescription(epc: string): string {
    const epcHex = parseInt(epc, 16).toString(16).toUpperCase();
    
    switch (epcHex) {
      case "80":
        return this._status.operationStatus === "on" ? "On" : "Off";
      case "81":
        return this._status.installationLocation;
      case "84":
        return `${this._status.instantaneousPowerConsumption} W`;
      case "85":
        return `${(this._status.cumulativeElectricEnergyConsumption / 1000).toFixed(3)} kWh`;
      case "88":
        return this._status.faultStatus === "noFault" ? "No fault" : "Fault occurred";
      case "C7": {
        const statusMap: Record<string, string> = {
          "notConnected": "Not Connected",
          "connected": "Connected",
          "chargeable": "Chargeable",
          "dischargeable": "Dischargeable",
          "chargeableAndDischargeable": "Chargeable & Dischargeable"
        };
        return statusMap[this._status.vehicleConnectionAndChargeableStatus] || "Unknown";
      }
      case "DA": {
        const modeMap: Record<string, string> = {
          "rapidCharge": "Rapid Charge",
          "charge": "Charge",
          "discharge": "Discharge",
          "standby": "Standby",
          "test": "Test",
          "other": "Other"
        };
        return modeMap[this._status.operationModeSetting] || "Unknown";
      }
      case "DB": {
        const typeMap: Record<string, string> = {
          "gridConnectionReverseFlowAcceptable": "Grid (reverse flow OK)",
          "independentOperation": "Independent",
          "gridConnectionReverseFlowNotAcceptable": "Grid (no reverse flow)"
        };
        return typeMap[this._status.systemInterconnectionType] || "Unknown";
      }
      case "DC": {
        const methodMap: Record<string, string> = {
          "others": "Others",
          "maxChargingPower": "Max Power",
          "surplusPower": "Surplus Power",
          "designatedPower": "Designated Power",
          "designatedCurrent": "Designated Current",
          "designatedPurchasingPower": "Designated Purchasing Power"
        };
        return methodMap[this._status.chargingMethod] || "Unknown";
      }
      case "DD": {
        const methodMap: Record<string, string> = {
          "others": "Others",
          "maxDischargingPower": "Max Discharge Power",
          "loadFollowing": "Load Following",
          "designatedPower": "Designated Power",
          "designatedCurrent": "Designated Current",
          "designatedPurchasingPower": "Designated Purchasing Power"
        };
        return methodMap[this._status.dischargingMethod] || "Unknown";
      }
      case "E1": {
        const modeMap: Record<string, string> = {
          "charge": "Charge",
          "discharge": "Discharge",
          "standby": "Standby",
          "idle": "Idle",
          "preparation": "Preparation",
          "other": "Other"
        };
        return modeMap[this._status.actualOperationMode] || "Unknown";
      }
      case "E5":
        return this._status.maintenanceStatus === "normal" ? "Normal" : "Maintenance Needed";
      default:
        return "Unknown";
    }
  }
}