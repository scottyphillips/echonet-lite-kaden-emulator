import { EchoStatus, CellingLightStatus } from "../types";
import { IBaseDevice, createEchoStatus, setCommonProperties } from "./baseDevice";

export class CeilingLightDevice implements IBaseDevice {
  readonly eoj = "029101";
  enabled: boolean = true;
  echoObject: EchoStatus["echoObject"];
  
  private _status: CellingLightStatus = { state: "on" };
  private _echoStatus: EchoStatus;
  private onPropertyChanged?: (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => void;

  constructor(options?: { onPropertyChanged?: (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => void }) {
    this.onPropertyChanged = options?.onPropertyChanged;
    
    this._echoStatus = createEchoStatus(
      this.eoj,
      {
        "029101": {
          "80": [0x30],
          "9d": [0x01, 0x80], // Status change announcement property map
          "9e": [0x01, 0x80], // Set property map
        },
      },
      this.enabled
    );
    this.echoObject = this._echoStatus.echoObject;
  }

  get status(): CellingLightStatus {
    return { ...this._status };
  }

  get echoStatus(): EchoStatus {
    return this._echoStatus;
  }

  setCommonProperties(id?: string): void {
    setCommonProperties(this.echoObject, id);
  }

  setStatus(newStatus: CellingLightStatus): void {
    const state = newStatus.state === "on" ? "on" : "off";
    if (this._status.state !== state) {
      this._status.state = state;
      this._echoStatus.echoObject["029101"]["80"] =
        state === "on" ? [0x30] : [0x31];
      this.notifyPropertyChanged("80");
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    if (propertyCodeText === "80") {
      const state = newValue[0] === 0x30 ? "on" : "off";
      this.setStatus({ state });
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
        this._echoStatus.echoObject[this.eoj][propertyNo]
      );
    }
  }
}