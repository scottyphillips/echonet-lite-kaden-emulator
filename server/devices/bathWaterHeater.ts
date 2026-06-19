import { EchoObject, EchoStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

export interface BathWaterHeaterStatus {
  state: "empty" | "supply" | "drainage" | "full";
  auto: "off" | "on";
  temp: number;
  waterLevel: number; // 0:empty, 100:full
}

export class BathWaterHeaterDevice {
  readonly eoj = "026b01";
  enabled: boolean = true;
  
  private _status: BathWaterHeaterStatus = {
    state: "empty",
    auto: "off",
    temp: 41,
    waterLevel: 0,
  };
  private _echoObject: EchoObject = {
    "026b01": {
      80: [0x30], // Operation status (0x80): 0x30
      b0: [0x41], // Auto boil setting (0xB0): auto boil=0x41
      b2: [0x40], // Boiling state (0xB2): boiling=0x41
      c0: [0x42], // Daytime refill permission (0xC0): prohibited=0x42
      c3: [0x42], // Hot water supply state (0xC3): not supplying=0x42
      e3: [0x42], // Bath auto mode (0xE3): on=0x41, off=0x42
      c7: [0x00], // Energy shift participation (0xC7): not participating=0x00
      c8: [0x14], // Boil start time (0xC8): 20:00 = 0x14
      c9: [0x01], // Energy shift count (0xC9): 1 time=0x01
      ca: [0x00], // Daytime shift time 1 (0xCA): clear=0x00
      cb: Array.from(new Array(32)).map(() => 0x00), // Predicted energy at shift time 1
      cc: Array.from(new Array(32)).map(() => 0x00), // Hourly power consumption 1
      cd: [0x00], // Daytime shift time 2 (0xCD): clear=0x00
      ce: Array.from(new Array(24)).map(() => 0x00), // Predicted energy at shift time 2
      cf: Array.from(new Array(12)).map(() => 0x00), // Hourly power consumption 2 (0xCF)
      d3: [41], // Bath temperature setting (0xD3): 0-100°C
      ea: [0x42], // Bath operation (0xEA): filling=0x41, keeping heat=0x43, stopped=0x42
      "9d": [0x07, 0x80, 0xb0, 0xb2, 0xc3, 0xd3, 0xea], // Status change announcement property map
      "9e": [0x04, 0x80, 0xb0, 0xd3, 0xe3], // Set property map
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

  get status(): BathWaterHeaterStatus {
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

  setStatus(newStatus: Partial<BathWaterHeaterStatus>): void {
    if (newStatus.auto !== undefined) {
      this.handleAutoChange(newStatus.auto!);
    }
    if (newStatus.temp !== undefined) {
      this.handleTempChange(newStatus.temp!);
    }
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    const newStatus: BathWaterHeaterStatus = {
      auto: this._status.auto,
      state: this._status.state,
      temp: this._status.temp,
      waterLevel: this._status.waterLevel,
    };

    if (propertyCodeText === "d3") {
      let newTemp = newValue[0];
      if (newTemp < 30) newTemp = 30;
      if (newTemp > 60) newTemp = 60;
      newStatus.temp = newTemp;
      this.setStatus(newStatus);
      return true;
    } else if (propertyCodeText === "e3") {
      // Bath auto mode (0xE3): on=0x41, off=0x42
      newStatus.auto = newValue[0] === 0x41 ? "on" : "off";
      this.setStatus(newStatus);
      return true;
    }
    return false;
  }

  /**
   * Tick function for timer-based water level changes.
   * Called periodically when auto mode is active.
   * Simulates water filling/draining based on auto mode state.
   */
  tick(): void {
    if (this._status.auto === "on" && this._status.waterLevel < 100) {
      this._status.waterLevel += 20;
      if (this._status.waterLevel >= 100) {
        this._status.waterLevel = 100;
        this._status.state = "full";
        this._echoObject["026b01"]["ea"] = [0x43]; // Keeping heat=0x43
        this.notifyPropertyChanged("ea");
      } else {
        this._status.state = "supply";
        this._echoObject["026b01"]["ea"] = [0x41]; // Filling=0x41
        this.notifyPropertyChanged("ea");
      }
    } else if (this._status.auto === "off" && this._status.waterLevel > 0) {
      this._status.waterLevel -= 20;
      if (this._status.waterLevel <= 0) {
        this._status.waterLevel = 0;
        this._status.state = "empty";
        this._echoObject["026b01"]["ea"] = [0x42]; // Stopped=0x42
        this.notifyPropertyChanged("ea");
      } else {
        this._status.state = "drainage";
        this._echoObject["026b01"]["ea"] = [0x42]; // Stopped=0x42
        this.notifyPropertyChanged("ea");
      }
    }
  }

  private handleAutoChange(auto: "on" | "off"): void {
    if (this._status.auto !== auto) {
      this._status.auto = auto;
      if (auto === "on") {
        this._echoObject["026b01"]["e3"] = [0x41]; // Auto on=0x41
        this.notifyPropertyChanged("e3");

        if (this._status.waterLevel < 100) {
          this._status.state = "supply";
          this._echoObject["026b01"]["ea"] = [0x41]; // Filling=0x41
          this.notifyPropertyChanged("ea");
        } else if (this._status.waterLevel === 100) {
          this._status.state = "full";
          this._echoObject["026b01"]["ea"] = [0x43]; // Keeping heat=0x43
          this.notifyPropertyChanged("ea");
        }
      } else {
        this._echoObject["026b01"]["e3"] = [0x42]; // Auto off=0x42
        this.notifyPropertyChanged("e3");

        if (this._status.waterLevel > 0) {
          this._status.state = "drainage";
          this._echoObject["026b01"]["ea"] = [0x42]; // Stopped=0x42
          this.notifyPropertyChanged("ea");
        } else if (this._status.waterLevel === 0) {
          this._status.state = "empty";
          this._echoObject["026b01"]["ea"] = [0x42]; // Stopped=0x42
          this.notifyPropertyChanged("ea");
        }
      }
    }
  }

  private handleTempChange(temp: number): void {
    if (30 <= temp && temp <= 60) {
      if (this._status.temp !== temp) {
        this._status.temp = temp;
        this._echoObject["026b01"]["d3"] = [temp];
        this.notifyPropertyChanged("d3");
      }
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