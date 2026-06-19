import { EchoObject, EchoStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

export interface ShutterStatus {
  state: "opened" | "opening" | "halfOpen" | "closing" | "closed";
  position: number; // 0:fully closed, 100:fully open
  move: "opening" | "stopped" | "closing";
}

export class ShutterDevice {
  readonly eoj = "026301";
  enabled: boolean = true;
  
  private _status: ShutterStatus = { state: "opened", position: 100, move: "stopped" };
  private _echoObject: EchoObject = {
    "026301": {
      80: [0x30], // Operation status
      e0: [0x43], // Open/close setting: open=0x41, close=0x42, stop=0x43
      ea: [0x41], // Open/close state: fully open=0x41, fully closed=0x42, opening=0x43, closing=0x44, partially stopped=0x45
      "9d": [0x04, 0x80, 0xe0, 0xea], // Status change announcement property map
      "9e": [0x02, 0xe0], // Set property map
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

  get status(): ShutterStatus {
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

  setStatus(newStatus: Partial<ShutterStatus>): void {
    if (newStatus.move !== undefined) {
      this.handleMoveCommand(newStatus.move);
    }
    this.notifyPropertyChanged("e0");
    this.notifyPropertyChanged("ea");
  }

  setStatusFromEchoNet(propertyCodeText: string, newValue: number[]): boolean {
    if (propertyCodeText === "e0") {
      const move =
        newValue[0] === 0x41
          ? "opening"
          : newValue[0] === 0x42
          ? "closing"
          : "stopped";
      this.handleMoveCommand(move);
      return true;
    }
    return false;
  }

  /**
   * Tick function for timer-based state updates.
   * Called periodically to animate opening/closing.
   */
  tick(): void {
    if (this._status.move === "opening") {
      this._status.position += 20;
      if (this._status.position >= 100) {
        this._status.position = 100;
        this._status.state = "opened";
        this._status.move = "stopped";
        this._echoObject["026301"]["e0"] = [0x43]; // Stopped
        this._echoObject["026301"]["ea"] = [0x41]; // Fully open
        this.notifyPropertyChanged("e0");
        this.notifyPropertyChanged("ea");
      }
    }
    if (this._status.move === "closing") {
      this._status.position -= 20;
      if (this._status.position <= 0) {
        this._status.position = 0;
        this._status.state = "closed";
        this._status.move = "stopped";
        this._echoObject["026301"]["e0"] = [0x43]; // Stopped
        this._echoObject["026301"]["ea"] = [0x42]; // Fully closed
        this.notifyPropertyChanged("e0");
        this.notifyPropertyChanged("ea");
      }
    }
  }

  private handleMoveCommand(move: "opening" | "stopped" | "closing"): void {
    if (move === "opening") {
      if (this._status.position < 100 && this._status.move !== "opening") {
        this._status.state = "opening";
        this._status.move = "opening";
        this._echoObject["026301"]["e0"] = [0x41]; // Opening
        this._echoObject["026301"]["ea"] = [0x43]; // Opening state
      }
    } else if (move === "closing") {
      if (this._status.position > 0 && this._status.move !== "closing") {
        this._status.state = "closing";
        this._status.move = "closing";
        this._echoObject["026301"]["e0"] = [0x42]; // Closing
        this._echoObject["026301"]["ea"] = [0x44]; // Closing state
      }
    } else if (move === "stopped") {
      if (this._status.move !== "stopped") {
        this._status.move = "stopped";
        this._echoObject["026301"]["e0"] = [0x43]; // Stopped

        if (this._status.position === 100) {
          this._status.state = "opened";
          this._echoObject["026301"]["ea"] = [0x41]; // Fully open
        } else if (this._status.position === 0) {
          this._status.state = "closed";
          this._echoObject["026301"]["ea"] = [0x42]; // Fully closed
        } else {
          this._status.state = "halfOpen";
          this._echoObject["026301"]["ea"] = [0x45]; // Partially stopped
        }
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