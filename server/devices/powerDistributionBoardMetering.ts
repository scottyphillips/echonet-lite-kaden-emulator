import { EchoObject, EchoStatus } from "../types";
import { IBaseDevice, createEchoStatus, setCommonProperties } from "./baseDevice";

export interface PowerDistributionBoardMeteringChannelPower {
  channel: number;
  power: number; // Power in watts
}

export interface PowerDistributionBoardMeteringStatus {
  operationStatus: "on" | "off";
  faultStatus: "faultOccurred" | "noFault";
  currentLimit: number;
  simplexPowerChannels: PowerDistributionBoardMeteringChannelPower[];
  totalSimplexPower: number; // Sum of all simplex channel powers
}

export class PowerDistributionBoardMeteringDevice implements IBaseDevice {
  readonly eoj = "028701";
  enabled: boolean = true;

  // Device metadata (from user-specified test instance)
  readonly host = "PANASONIC_SMARTCOSMO_IP";
  readonly hostProductCode = "MKN7350S1";
  readonly manufacturer = "Panasonic";

  private _status: PowerDistributionBoardMeteringStatus = {
    operationStatus: "on",
    faultStatus: "noFault",
    currentLimit: 80,
    simplexPowerChannels: [
      { channel: 1, power: 0 },
      { channel: 2, power: 36 },
      { channel: 3, power: 0 },
      { channel: 4, power: 105 },
      { channel: 5, power: 44 },
      { channel: 6, power: 0 },
      { channel: 7, power: 61 },
      { channel: 8, power: 464 },
      { channel: 9, power: 361 },
      { channel: 10, power: 45 },
      { channel: 11, power: 0 },
      { channel: 12, power: 0 },
      { channel: 13, power: 0 },
      { channel: 14, power: 0 },
      { channel: 15, power: 0 },
      { channel: 16, power: 0 },
      { channel: 17, power: 224 },
      { channel: 18, power: 0 },
      { channel: 19, power: 396 },
      { channel: 20, power: 0 },
      { channel: 21, power: 0 },
      { channel: 22, power: 0 },
      { channel: 23, power: 0 },
      { channel: 24, power: 0 },
      { channel: 25, power: 0 },
      { channel: 26, power: 0 },
      { channel: 27, power: 0 },
      { channel: 28, power: 0 },
      { channel: 29, power: 0 },
    ],
    totalSimplexPower: 1736, // Sum: 0+36+0+105+44+0+61+464+361+45+0+0+0+0+0+0+224+0+396+0+0+0+0+0+0+0+0+0+0
  };

  // User-specified property maps converted to hex EPC codes
  // getmap: [128,176,192,208,224,240,129,177,193,209,225,241,130,178,194,210,226,242,131,179,211,227,243,212,228,244,213,229,245,134,182,198,214,230,246,151,183,199,215,231,247,136,152,184,200,216,232,248,137,185,217,233,218,234,140,220,236,157,189,221,237,158,190,222,238,159,223,239]
  // ntfmap: [128,129,134,136,137]
  // setmap: [129,151,152,241,242,243,244,245,246,247,249]

  private _echoObject: EchoObject = {
    "028701": {
      // EPC 0x80 (128): Operation status
      "80": [0x30],
      // EPC 0x81 (129): Installation location
      "81": [0x00],
      // EPC 0x86 (134): Manufacturer's fault code
      "86": [0x00],
      // EPC 0x88 (136): Fault status (0x42=No fault)
      "88": [0x42],
      // EPC 0x89 (137): Fault description
      "89": [0x00],
      // EPC 0xB0 (176): Master rated capacity
      "b0": [0x3c],
      // EPC 0xB2 (178): Channel range specification for instantaneous power consumption measurement (simplex)
      "b2": [0x01, 0x01],
      // EPC 0xB6 (182): Channel range specification for instantaneous power consumption measurement (duplex)
      "b6": [0x01, 0x01],
      // EPC 0xC0 (192): Measured cumulative amount of electric energy (normal direction)
      "c0": [0x00, 0x00, 0x00, 0x01],
      // EPC 0xC6 (198): Measured instantaneous amount of electric energy
      "c6": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xD0 (208): Ch1 = 0 W
      "d0": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xE0 (224): Ch17 = 224 W
      "e0": [0x00, 0x00, 0x00, 0xE0],
      // EPC 0xF0 (240): Ch32 = 0 W
      "f0": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xB1 (177): Number of measurement channels (simplex)
      "b1": [0x01],
      // EPC 0xC1 (193): Measured cumulative amount of electric energy (reverse direction)
      "c1": [0x00, 0x00, 0x00, 0x01],
      // EPC 0xC7 (199): Measured instantaneous currents
      "c7": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xE1 (225): Ch18 = 0 W
      "e1": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF1 (241): Property map related - handled by 9d/9e/9f
      // EPC 0x82 (130): Standard version information
      "82": [0x00, 0x00, 0x50, 0x01],
      // EPC 0xB7 (183): Measured instantaneous power consumption list (simplex)
      // Format: [num_channels_low, num_channels_high, ch1(4bytes), ch2(4bytes), ...]
      // Values from SmartCosmo test data (coefficient=1, unit=W)
      "b7": [
        0x1D, 0x00,  // 29 channels
        // Channel 001: 0 W
        0x00, 0x00, 0x00, 0x00,
        // Channel 002: 36 W
        0x00, 0x00, 0x00, 0x24,
        // Channel 003: 0 W
        0x00, 0x00, 0x00, 0x00,
        // Channel 004: 105 W
        0x00, 0x00, 0x00, 0x69,
        // Channel 005: 44 W
        0x00, 0x00, 0x00, 0x2C,
        // Channel 006: 0 W
        0x00, 0x00, 0x00, 0x00,
        // Channel 007: 61 W
        0x00, 0x00, 0x00, 0x3D,
        // Channel 008: 464 W
        0x00, 0x00, 0x01, 0xD0,
        // Channel 009: 361 W
        0x00, 0x00, 0x01, 0x69,
        // Channel 010: 45 W
        0x00, 0x00, 0x00, 0x2D,
        // Channel 011-016: 0 W
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        // Channel 017: 224 W
        0x00, 0x00, 0x00, 0xE0,
        // Channel 018: 0 W
        0x00, 0x00, 0x00, 0x00,
        // Channel 019: 396 W
        0x00, 0x00, 0x01, 0x8C,
        // Channel 020-029: 0 W
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
      ],
      // EPC 0xC2 (194): Unit for cumulative amounts of electric energy
      "c2": [0x01],
      // EPC 0xC8 (200): Measured instantaneous voltages
      "c8": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xE2 (226): Ch19 = 396 W
      "e2": [0x00, 0x00, 0x01, 0x8C],
      // EPC 0xF2 (242): Ch33 = 0 W
      "f2": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x83 (131): Identification number
      "83": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xB8 (184): Number of measurement channels (duplex)
      "b8": [0x01],
      // EPC 0xC3 (195): Historical data of measured cumulative amounts of electric energy (normal direction)
      "c3": [0x00],
      // EPC 0xE3 (227): Ch20 = 0 W
      "e3": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF3 (243): Ch34 = 0 W
      "f3": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xD4 (212): Ch5 = 44 W
      "d4": [0x00, 0x00, 0x00, 0x2C],
      // EPC 0xE4 (228): Ch21 = 0 W
      "e4": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF4 (244): Ch35 = 0 W
      "f4": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xD5 (213): Ch6 = 0 W
      "d5": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xE5 (229): Ch22 = 0 W
      "e5": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF5 (245): Ch36 = 0 W
      "f5": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x8A (138): Manufacturer code
      "8a": [0xff, 0xff, 0xff],
      // EPC 0xB9 (185): Channel range specification for cumulative amount of electric power consumption measurement (duplex)
      "b9": [0x01, 0x01],
      // EPC 0xCA (202): Not used - skip
      // EPC 0xE6 (230): Ch23 = 0 W
      "e6": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF6 (246): Ch37 = 0 W
      "f6": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x97 (151): Current time setting
      "97": [0x00, 0x00],
      // EPC 0xBA (186): Measured cumulative amount of electric power consumption list (duplex)
      "ba": [0x00, 0x00, 0x00, 0x01],
      // EPC 0xCB (203): Not used - skip
      // EPC 0xE7 (231): Ch24 = 0 W
      "e7": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF7 (247): Ch38 = 0 W
      "f7": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x98 (152): Current date setting
      "98": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xBB (187): Channel range specification for instantaneous current measurement (duplex)
      "bb": [0x01, 0x01],
      // EPC 0xCC (204): Not used - skip
      // EPC 0xE8 (232): Ch25 = 0 W
      "e8": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF8 (248): Ch39 = 0 W
      "f8": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xCD (205): Not used - skip
      // EPC 0xE9 (233): Ch26 = 0 W
      "e9": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xDA (218): Ch11 = 0 W
      "da": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xDC (220): Ch13 = 0 W
      "dc": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xEC (236): Ch29 = 0 W
      "ec": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x9D (157): Status change announcement property map (ntfmap)
      "9d": [0x05, 0x80, 0x81, 0x86, 0x88, 0x89],
      // EPC 0xBD (189): Channel range specification for instantaneous power consumption measurement (duplex)
      "bd": [0x01, 0x01],
      // EPC 0xED (237): Ch30 = 0 W
      "ed": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x9E (158): Set property map (setmap)
      "9e": [0x0b, 0x81, 0x97, 0x98, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9],
      // EPC 0xBE (190): Measured instantaneous power consumption list (duplex)
      "be": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xDB (219): Ch12 = 0 W
      "db": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xDE (222): Ch15 = 0 W
      "de": [0x00, 0x00, 0x00, 0x00],
      // EPC 0x9F (159): Get property map (getmap)
      "9f": [0x46, 0x80, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x81, 0xb1, 0xc1, 0xd1, 0xe1, 0xf1, 0x82, 0xb2, 0xc2, 0xd2, 0xe2, 0xf2, 0x83, 0xb7, 0xc3, 0xd3, 0xe3, 0xf3, 0xd4, 0xe4, 0xf4, 0xd5, 0xe5, 0xf5, 0x8a, 0xb9, 0xca, 0xd5, 0xe6, 0xf6, 0x97, 0xba, 0xcb, 0xd7, 0xe7, 0xf7, 0x88, 0x98, 0xbb, 0xcc, 0xd8, 0xe8, 0xf8, 0x89, 0xb9, 0xcd, 0xe9, 0xda, 0xdc, 0xec, 0x9d, 0xbd, 0xdb, 0xdd, 0x9e, 0xbe, 0xde, 0xed, 0x9f],
      // EPC 0xDF (223): Ch16 = 0 W
      "df": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xEE (238): Ch31 = 0 W
      "ee": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xF9 (249): Ch41 = 0 W
      "f9": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xD1 (209): Ch2 = 36 W
      "d1": [0x00, 0x00, 0x00, 0x24],
      // EPC 0xD2 (210): Ch3 = 0 W
      "d2": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xD3 (211): Ch4 = 105 W
      "d3": [0x00, 0x00, 0x00, 0x69],
      // EPC 0xD6 (214): Ch7 = 61 W
      "d6": [0x00, 0x00, 0x00, 0x3D],
      // EPC 0xD7 (215): Ch8 = 464 W
      "d7": [0x00, 0x00, 0x01, 0xD0],
      // EPC 0xD8 (216): Ch9 = 361 W
      "d8": [0x00, 0x00, 0x01, 0x69],
      // EPC 0xD9 (217): Ch10 = 45 W
      "d9": [0x00, 0x00, 0x00, 0x2D],
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

  get status(): PowerDistributionBoardMeteringStatus {
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

  setStatus(newStatus: Partial<PowerDistributionBoardMeteringStatus>): void {
    let changed = false;

    if (newStatus.operationStatus !== undefined) {
      const state = newStatus.operationStatus === "on" ? "on" : "off";
      if (this._status.operationStatus !== state) {
        this._status.operationStatus = state;
        this._echoObject["028701"]["80"] = state === "on" ? [0x30] : [0x31];
        this.notifyPropertyChanged("80");
        changed = true;
      }
    }

    if (newStatus.faultStatus !== undefined) {
      const fault = newStatus.faultStatus === "faultOccurred" ? "faultOccurred" : "noFault";
      if (this._status.faultStatus !== fault) {
        this._status.faultStatus = fault;
        this._echoObject["028701"]["88"] = fault === "faultOccurred" ? [0x41] : [0x42];
        this.notifyPropertyChanged("88");
        changed = true;
      }
    }

    if (newStatus.currentLimit !== undefined) {
      const value = Math.max(0, Math.min(100, newStatus.currentLimit));
      if (this._status.currentLimit !== value) {
        this._status.currentLimit = value;
        this._echoObject["028701"]["87"] = [value];
        this.notifyPropertyChanged("87");
        changed = true;
      }
    }

    if (changed) {
      const properties = ["80", "88"];
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

      case "97": // Current time setting
        return true;

      case "98": // Current date setting
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