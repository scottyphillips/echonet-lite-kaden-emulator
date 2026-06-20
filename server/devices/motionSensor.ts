import { EchoObject, EchoStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

export interface MotionSensorStatus {
  state: "detected" | "notDetected";
}

export class MotionSensorDevice {
  readonly eoj = "000701";
  enabled: boolean = true;
  
  private _status: MotionSensorStatus = { state: "detected" };
  private _echoObject: EchoObject = {
    "000701": {
      "80": [0x30],
      b1: [0x41],
      "9d": [0x02, 0xb1], // Status change announcement property map
      "9e": [0x01], // Set property map
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

  get status(): MotionSensorStatus {
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

  setStatus(state: "detected" | "notDetected"): void {
    if (this._status.state !== state) {
      this._status.state = state;
      this._echoObject["000701"]["b1"] =
        state === "detected" ? [0x41] : [0x42];
      this.notifyPropertyChanged("b1");
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    if (propertyCodeText === "b1") {
      const state = newValue[0] === 0x41 ? "detected" : "notDetected";
      this.setStatus(state);
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