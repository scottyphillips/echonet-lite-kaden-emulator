import { EchoObject, EchoStatus, SensorMeterStatus } from "../types";
import { createEchoStatus, setCommonProperties } from "./baseDevice";

/**
 * Temperature and Humidity Sensor devices.
 * These share a status interface but have separate EOJ instances.
 */

export class TemperatureSensorDevice {
  readonly eoj = "001101";
  enabled: boolean = true;
  
  private _status: SensorMeterStatus = { temp: 20.0, hum: 50 };
  private _echoObject: EchoObject = {
    "001101": {
      "80": [0x30],
      e0: [0x00, 0xc8],
      "9d": [0x02, 0xe0], // Status change announcement property map
      "9e": [0x01, 0xe0], // Set property map
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

  get status(): SensorMeterStatus {
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

  setStatus(temp: number): boolean {
    return this.updateTemperature(temp);
  }

  updateTemperature(temp: number): boolean {
    if (-10 <= temp && temp <= 40) {
      if (this._status.temp !== temp) {
        this._status.temp = temp;
        const rawValue = Math.round(temp * 10);
        this._echoObject["001101"]["e0"] = [
          (rawValue >> 8) & 0xFF,
          rawValue & 0xFF,
        ];
        this.notifyPropertyChanged("e0");
        return true;
      }
    }
    return false;
  }

  updateHumidity(hum: number): boolean {
    if (0 <= hum && hum <= 100) {
      if (this._status.hum !== hum) {
        this._status.hum = hum;
        // Note: humidity uses a separate device (HumiditySensorDevice)
        return true;
      }
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

export class HumiditySensorDevice {
  readonly eoj = "001201";
  enabled: boolean = true;
  
  private _status: SensorMeterStatus = { temp: 20.0, hum: 50 };
  private _echoObject: EchoObject = {
    "001201": {
      "80": [0x30],
      e0: [50],
      "9d": [0x02, 0xe0], // Status change announcement property map
      "9e": [0x01, 0xe0], // Set property map
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

  get status(): SensorMeterStatus {
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

  setStatus(hum: number): boolean {
    return this.updateHumidity(hum);
  }

  updateHumidity(hum: number): boolean {
    if (0 <= hum && hum <= 100) {
      if (this._status.hum !== hum) {
        this._status.hum = hum;
        this._echoObject["001201"]["e0"] = [hum];
        this.notifyPropertyChanged("e0");
        return true;
      }
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
