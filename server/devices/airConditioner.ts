import { EchoObject, EchoStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

export interface AirConditionerStatus {
  state: "off" | "cool" | "heat" | "dry" | "wind";
  temp: number;
  internalMode: "cool" | "heat" | "dry" | "wind";
}

export class AirConditionerDevice {
  readonly eoj = "013001";
  enabled: boolean = true;
  
  private _status: AirConditionerStatus = {
    state: "off",
    internalMode: "cool",
    temp: 22,
  };
  private _echoObject: EchoObject = {
    "013001": {
      80: [0x30], // Operation status: ON=0x30, OFF=0x31
      "8f": [0x42], // Energy saving operation: energy saving=0x41, normal=0x42
      b0: [0x42], // Operating mode: auto/cool/heat/dehumidify/fan/others 0x41/0x42/0x43/0x44/0x45/0x40
      b3: [22], // Temperature setting: 0x00-0x32 (0-50°C)
      bb: [20], // Indoor temperature measurement: 0x81-0x7D (-127 to 125°C)
      a0: [0x41], // Fan rate: auto=0x41, level=0x31-0x38
      "9d": [0x06, 0x80, 0x8f, 0xb0, 0xb3, 0xa0], // Status change announcement property map
      "9e": [0x04, 0x80, 0xb0, 0xb3, 0xa0], // Set property map
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

  get status(): AirConditionerStatus {
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

  setStatus(status: Partial<AirConditionerStatus>): void {
    const newState = status.state;
    const newInternalMode = status.internalMode;
    const newTemp = status.temp;

    // Validate state
    if (newState !== undefined &&
        newState !== "off" &&
        newState !== "cool" &&
        newState !== "heat" &&
        newState !== "dry" &&
        newState !== "wind") {
      return;
    }

    // Validate internalMode
    if (newInternalMode !== undefined &&
        newInternalMode !== "cool" &&
        newInternalMode !== "heat" &&
        newInternalMode !== "dry" &&
        newInternalMode !== "wind") {
      return;
    }

    if (newState !== undefined && this._status.state !== newState) {
      this._status.state = newState;
      this._echoObject["013001"]["80"] =
        this._status.state !== "off" ? [0x30] : [0x31];
      this.notifyPropertyChanged("80");
    }

    if (newInternalMode !== undefined && this._status.internalMode !== newInternalMode) {
      this._status.internalMode = newInternalMode;
      const modeMap: Record<string, number> = {
        cool: 0x42,
        heat: 0x43,
        dry: 0x44,
        wind: 0x45,
      };
      this._echoObject["013001"]["b0"] = [modeMap[newInternalMode]];
      this.notifyPropertyChanged("b0");
    }

    if (newTemp !== undefined) {
      let temp = newTemp;
      if (typeof temp === "string") {
        temp = parseInt(temp, 10);
        if (isNaN(temp)) {
          return;
        }
      }

      if (18 <= temp && temp <= 30 && this._status.temp !== temp) {
        this._status.temp = temp;
        this._echoObject["013001"]["b3"] = [temp];
        this.notifyPropertyChanged("b3");
      }
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    const newStatus: Partial<AirConditionerStatus> = {
      state: this._status.state,
      temp: this._status.temp,
      internalMode: this._status.internalMode,
    };

    if (propertyCodeText === "80") {
      newStatus.state = newValue[0] === 0x30 ? newStatus.internalMode : "off";
      this.setStatus(newStatus);
      return true;
    } else if (propertyCodeText === "b0") {
      newStatus.internalMode =
        newValue[0] === 0x42
          ? "cool"
          : newValue[0] === 0x43
          ? "heat"
          : newValue[0] === 0x44
          ? "dry"
          : newValue[0] === 0x45
          ? "wind"
          : newStatus.internalMode;
      if (newStatus.state !== "off") {
        newStatus.state = newStatus.internalMode;
      }
      this.setStatus(newStatus);
      return true;
    } else if (propertyCodeText === "b3") {
      let newTemp = newValue[0];
      if (newTemp < 18) newTemp = 18;
      if (newTemp > 30) newTemp = 30;
      newStatus.temp = newTemp;
      this.setStatus(newStatus);
      return true;
    } else if (propertyCodeText === "bb") {
      // Update internal temperature reading
      this._echoObject["013001"]["bb"] = newValue;
      return true;
    }
    return false;
  }

  /**
   * Update the internal temperature sensor reading.
   * Called when external temperature sensor data is received.
   */
  updateInternalTemp(temp: number): void {
    if (-127 <= temp && temp <= 125) {
      this._echoObject["013001"]["bb"] = [temp];
      // Note: bb is a reading-only property, no notification needed
    }
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
}