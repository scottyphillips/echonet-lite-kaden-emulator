import { EchoObject, EchoStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

export interface FloorLightStatus {
  state: "on" | "off";
  color: "lamp" | "white" | "neutralWhite";
}

export class FloorLightDevice {
  readonly eoj = "029001";
  enabled: boolean = true;
  
  private _status: FloorLightStatus = { state: "on", color: "lamp" };
  private _echoObject: EchoObject = {
    "029001": {
      80: [0x30], // Operation status: ON=0x30, OFF=0x31
      b1: [0x41], // Light color: warm=0x41, white=0x42, neutral white=0x43
      "9d": [0x02, 0x80, 0xb1], // Status change announcement property map
      "9e": [0x03, 0x80, 0xb1], // Set property map
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

  get status(): FloorLightStatus {
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

  setStatus(newStatus: FloorLightStatus): void {
    const state = newStatus.state === "on" ? "on" : "off";
    if (this._status.state !== state) {
      this._status.state = state;
      this._echoObject["029001"]["80"] =
        state === "on" ? [0x30] : [0x31];
      this.notifyPropertyChanged("80");
    }

    const color = newStatus.color;
    if (color === "lamp") {
      this._status.color = "lamp";
      this._echoObject["029001"]["b1"] = [0x41];
      this.notifyPropertyChanged("b1");
    } else if (color === "white") {
      this._status.color = "white";
      this._echoObject["029001"]["b1"] = [0x42];
      this.notifyPropertyChanged("b1");
    } else if (color === "neutralWhite") {
      this._status.color = "neutralWhite";
      this._echoObject["029001"]["b1"] = [0x43];
      this.notifyPropertyChanged("b1");
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    const newStatus: FloorLightStatus = {
      state: this._status.state,
      color: this._status.color,
    };

    if (propertyCodeText === "80") {
      newStatus.state = newValue[0] === 0x30 ? "on" : "off";
      this.setStatus(newStatus);
      return true;
    } else if (propertyCodeText === "b1") {
      newStatus.color =
        newValue[0] === 0x41
          ? "lamp"
          : newValue[0] === 0x42
          ? "white"
          : newValue[0] === 0x43
          ? "neutralWhite"
          : newStatus.color;
      this.setStatus(newStatus);
      return true;
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
}