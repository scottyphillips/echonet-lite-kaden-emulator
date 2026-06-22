import { EchoObject, EchoStatus } from "../types";
import { IBaseDevice, createEchoStatus, setCommonProperties } from "./baseDevice";

export interface PowerDistributionBoardMeteringChannelData {
  channel: number;
  cumulativeEnergyKwh: number; // Cumulative energy in kWh (uint32, coefficient from EPC 0xC2)
  currentRPhaseA: number; // R phase current in amperes (int16, ×0.1 multiple)
  currentTPhaseA: number; // T phase current in amperes (int16, ×0.1 multiple)
  powerW: number; // Instantaneous power in watts (derived for internal tracking)
}

export interface PowerDistributionBoardMeteringStatus {
  operationStatus: "on" | "off";
  faultStatus: "faultOccurred" | "noFault";
  currentLimit: number;
  simplexPowerChannels: PowerDistributionBoardMeteringChannelData[];
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
      // Per ECHONETLite spec for EOJ 0x0287: each channel has cumulativeEnergy(4B) + currentR(2B) + currentT(2B)
      // Current values: int16 × 0.1A, noData = 0x7FFE (32766), energy noData = 0xFFFFFFFE (4294967294)
      // Assuming 100V single-phase, power_factor=1.0: I(A) = Power(W) / 100V
      { channel: 1, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 2, cumulativeEnergyKwh: 152, currentRPhaseA: 36, currentTPhaseA: 36, powerW: 36 },     // 36W → 0.36A × 10 = 36
      { channel: 3, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 4, cumulativeEnergyKwh: 525, currentRPhaseA: 105, currentTPhaseA: 105, powerW: 105 }, // 105W → 1.05A × 10 = 105
      { channel: 5, cumulativeEnergyKwh: 220, currentRPhaseA: 44, currentTPhaseA: 44, powerW: 44 },    // 44W → 0.44A × 10 = 44
      { channel: 6, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 7, cumulativeEnergyKwh: 305, currentRPhaseA: 61, currentTPhaseA: 61, powerW: 61 },    // 61W → 0.61A × 10 = 61
      { channel: 8, cumulativeEnergyKwh: 2320, currentRPhaseA: 464, currentTPhaseA: 464, powerW: 464 }, // 464W → 4.64A × 10 = 464
      { channel: 9, cumulativeEnergyKwh: 1805, currentRPhaseA: 361, currentTPhaseA: 361, powerW: 361 }, // 361W → 3.61A × 10 = 361
      { channel: 10, cumulativeEnergyKwh: 225, currentRPhaseA: 45, currentTPhaseA: 45, powerW: 45 },   // 45W → 0.45A × 10 = 45
      { channel: 11, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 12, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 13, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 14, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 15, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 16, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 17, cumulativeEnergyKwh: 1120, currentRPhaseA: 224, currentTPhaseA: 224, powerW: 224 }, // 224W → 2.24A × 10 = 224
      { channel: 18, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 19, cumulativeEnergyKwh: 1980, currentRPhaseA: 396, currentTPhaseA: 396, powerW: 396 }, // 396W → 3.96A × 10 = 396
      { channel: 20, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 21, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 22, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 23, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 24, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 25, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 26, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 27, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 28, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
      { channel: 29, cumulativeEnergyKwh: 0, currentRPhaseA: 0, currentTPhaseA: 0, powerW: 0 },
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
      // EPC 0xB2 (178): Channel range specification for cumulative amount of electric power consumption measurement (simplex) - channels 1-29
      "b2": [0x01, 0x1D],
      // EPC 0xB6 (182): Channel range specification for instantaneous power consumption measurement (simplex) - channels 1-29
      "b6": [0x01, 0x1D],
      // EPC 0xC0 (192): Measured cumulative amount of electric energy (normal direction)
      "c0": [0x00, 0x00, 0x00, 0x01],
      // EPC 0xC6 (198): Measured instantaneous amount of electric energy
      "c6": [0x00, 0x00, 0x0e, 0x10],
      // Per ECHONETLite spec: Measurement channel data format (object_PDB_01):
      // Bytes 1-4: Cumulative energy (uint32, kWh, coefficient from EPC 0xC2)
      // Bytes 5-6: R phase current (int16, A × 0.1), noData = 0x7FFE
      // Bytes 7-8: T phase current (int16, A × 0.1), noData = 0x7FFE
      // EPC 0xD0 (208): Ch1 - no data (energy=0, currentR=0, currentT=0)
      "d0": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xE0 (224): Ch17 - cumulativeEnergy=1120kWh(0x00000460), currentR=22.4A(0x00E0), currentT=22.4A(0x00E0)
      "e0": [0x00, 0x00, 0x04, 0x60, 0x00, 0xE0, 0x00, 0xE0],
      // EPC 0xF0 (240): Ch32 - no data
      "f0": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xB1 (177): Number of measurement channels (simplex)
      "b1": [0x1D],
      // EPC 0xC1 (193): Measured cumulative amount of electric energy (reverse direction)
      "c1": [0x00, 0x00, 0x00, 0x01],
      // EPC 0xC7 (199): Measured instantaneous currents
      "c7": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xE1 (225): Ch18 - no data (energy=0, currentR=noData=0x7FFE, currentT=noData=0x7FFE)
      "e1": [0x00, 0x00, 0x00, 0x00, 0x7F, 0xFE, 0x7F, 0xFE],
      // EPC 0xF1 (241): Property map related - handled by 9d/9e/9f
      "f1": [0x0b, 0x81, 0x97, 0x98, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9],
      // EPC 0x82 (130): Standard version information
      "82": [0x00, 0x00, 0x50, 0x01],
      // EPC 0xB7 (183): Measured instantaneous power consumption list (simplex)
      // Per spec: [startChannel(1byte), rangeCount(1byte), ch1Power(4bytes,int32,W), ch2Power(4bytes), ...]
      // Values from SmartCosmo test data (unit=W, int32 format)
      "b7": [
        0x01, 0x1D,  // Start channel=1, Range=29 channels (channels 1-29)
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
      // EPC 0xC2 (194): Unit for cumulative amounts of electric energy (coefficient=1)
      "c2": [0x01],
      // EPC 0xC8 (200): Measured instantaneous voltages (uint32, V × some multiple)
      "c8": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xE2 (226): Ch19 - cumulativeEnergy=1980kWh(0x000007BC), currentR=39.6A(0x018C), currentT=39.6A(0x018C)
      "e2": [0x00, 0x00, 0x07, 0xBC, 0x01, 0x8C, 0x01, 0x8C],
      // EPC 0xF2 (242): Ch33 - no data (energy=0, currentR=noData=0x7FFE, currentT=noData=0x7FFE)
      "f2": [0x00, 0x00, 0x00, 0x00, 0x7F, 0xFE, 0x7F, 0xFE],
      // EPC 0x83 (131): Identification number
      "83": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xB8 (184): Number of measurement channels (duplex)
      "b8": [0x01],
      // EPC 0xC3 (195): Historical data of measured cumulative amounts of electric energy (normal direction)
      "c3": [0x00],
      // EPC 0xE3 (227): Ch20 - no data
      "e3": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF3 (243): Ch34 - no data
      "f3": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xD4 (212): Ch5 - cumulativeEnergy=220kWh(0x000000DC), currentR=4.4A(0x002C), currentT=4.4A(0x002C)
      "d4": [0x00, 0x00, 0x00, 0xDC, 0x00, 0x2C, 0x00, 0x2C],
      // EPC 0xE4 (228): Ch21 - no data
      "e4": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF4 (244): Ch35 - no data
      "f4": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xD5 (213): Ch6 - no data
      "d5": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xE5 (229): Ch22 - no data
      "e5": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF5 (245): Ch36 - no data
      "f5": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0x8A (138): Manufacturer code
      "8a": [0xff, 0xff, 0xff],
      // EPC 0xB9 (185): Channel range specification for cumulative amount of electric power consumption measurement (duplex)
      "b9": [0x01, 0x01],
      // EPC 0xCA (202): Not used - skip
      // EPC 0xE6 (230): Ch23 - no data
      "e6": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF6 (246): Ch37 - no data
      "f6": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0x97 (151): Current time setting
      "97": [0x00, 0x00],
      // EPC 0xBA (186): Measured cumulative amount of electric power consumption list (duplex)
      "ba": [0x01, 0x01, 0x00, 0x00, 0x05, 0xF5, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xCB (203): Not used - skip
      // EPC 0xE7 (231): Ch24 - no data
      "e7": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF7 (247): Ch38 - no data
      "f7": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0x98 (152): Current date setting
      "98": [0x00, 0x00, 0x00, 0x00],
      // EPC 0xBB (187): Channel range specification for instantaneous current measurement (duplex)
      "bb": [0x01, 0x01],
      // EPC 0xCC (204): Not used - skip
      // EPC 0xE8 (232): Ch25 - no data
      "e8": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF8 (248): Ch39 - no data (outside 32-channel range)
      "f8": [0x00, 0x00, 0x00, 0x00, 0x7F, 0xFE, 0x7F, 0xFE],
      // EPC 0xCD (205): Not used - skip
      // EPC 0xE9 (233): Ch26 - no data
      "e9": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xDA (218): Ch11 - no data
      "da": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xDC (220): Ch13 - no data
      "dc": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xEC (236): Ch29 - no data
      "ec": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0x9D (157): Status change announcement property map (ntfmap)
      "9d": [0x05, 0x80, 0x81, 0x86, 0x88, 0x89],
      // EPC 0xBD (189): Channel range specification for instantaneous power consumption measurement (duplex)
      "bd": [0x01, 0x01],
      // EPC 0xED (237): Ch30 - no data
      "ed": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0x9E (158): Set property map (setmap)
      "9e": [0x0b, 0x81, 0x97, 0x98, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf9],
      // EPC 0xBE (190): Measured instantaneous power consumption list (duplex)
      "be": [0x00, 0x00, 0x0e, 0x10],
      // EPC 0xDB (219): Ch12 - no data
      "db": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xDE (222): Ch15 - no data
      "de": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0x9F (159): Get property map (getmap)
      "9f": [0x46, 0x80, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0, 0x81, 0xb1, 0xc1, 0xd1, 0xe1, 0xf1, 0x82, 0xb2, 0xc2, 0xd2, 0xe2, 0xf2, 0x83, 0xb7, 0xc3, 0xd3, 0xe3, 0xf3, 0xd4, 0xe4, 0xf4, 0xd5, 0xe5, 0xf5, 0x8a, 0xb9, 0xca, 0xd6, 0xe6, 0xf6, 0x97, 0xba, 0xcb, 0xd7, 0xe7, 0xf7, 0x88, 0x98, 0xbb, 0xcc, 0xd8, 0xe8, 0xf8, 0x89, 0xb9, 0xcd, 0xe9, 0xda, 0xdc, 0xec, 0x9d, 0xbd, 0xdb, 0xdd, 0x9e, 0xbe, 0xde, 0xed, 0x9f],
      // EPC 0xDF (223): Ch16 - no data
      "df": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xEE (238): Ch31 - no data
      "ee": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xF9 (249): Ch41 - no data (outside 32-channel range)
      "f9": [0x00, 0x00, 0x00, 0x00, 0x7F, 0xFE, 0x7F, 0xFE],
      // EPC 0xD1 (209): Ch2 - cumulativeEnergy=152kWh(0x00000098), currentR=3.6A(0x0024), currentT=3.6A(0x0024)
      "d1": [0x00, 0x00, 0x00, 0x98, 0x00, 0x24, 0x00, 0x24],
      // EPC 0xD2 (210): Ch3 - no data
      "d2": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      // EPC 0xD3 (211): Ch4 - cumulativeEnergy=525kWh(0x0000020D), currentR=10.5A(0x0069), currentT=10.5A(0x0069)
      "d3": [0x00, 0x00, 0x02, 0x0D, 0x00, 0x69, 0x00, 0x69],
      // EPC 0xD6 (214): Ch7 - cumulativeEnergy=305kWh(0x00000131), currentR=6.1A(0x003D), currentT=6.1A(0x003D)
      "d6": [0x00, 0x00, 0x01, 0x31, 0x00, 0x3D, 0x00, 0x3D],
      // EPC 0xD7 (215): Ch8 - cumulativeEnergy=2320kWh(0x00000908), currentR=46.4A(0x01D0), currentT=46.4A(0x01D0)
      "d7": [0x00, 0x00, 0x09, 0x08, 0x01, 0xD0, 0x01, 0xD0],
      // EPC 0xD8 (216): Ch9 - cumulativeEnergy=1805kWh(0x0000070D), currentR=36.1A(0x0169), currentT=36.1A(0x0169)
      "d8": [0x00, 0x00, 0x07, 0x0D, 0x01, 0x69, 0x01, 0x69],
      // EPC 0xD9 (217): Ch10 - cumulativeEnergy=225kWh(0x000000E1), currentR=4.5A(0x002D), currentT=4.5A(0x002D)
      "d9": [0x00, 0x00, 0x00, 0xE1, 0x00, 0x2D, 0x00, 0x2D],
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

      default:
        // Handle measurement channel EPCs (0xD0-0xEF) - 8 bytes each per spec
        // Format: cumulativeEnergy(4bytes,uint32,kWh) + currentR(2bytes,int16,A×0.1) + currentT(2bytes,int16,A×0.1)
        const epcNum = parseInt(propertyCodeText, 16);
        if (epcNum >= 0xD0 && epcNum <= 0xEF) {
          const channelIndex = epcNum - 0xD0 + 1; // 1-based channel number
          if (newValue.length === 8) {
            // Parse: bytes 0-3 = energy, bytes 4-5 = currentR, bytes 6-7 = currentT
            const cumulativeEnergy = (newValue[0] << 24) | (newValue[1] << 16) | (newValue[2] << 8) | newValue[3];
            const currentR = ((newValue[4] << 8) | newValue[5]) & 0xFFFF;
            const currentT = ((newValue[6] << 8) | newValue[7]) & 0xFFFF;

            // Update the channel data in status
            if (channelIndex <= this._status.simplexPowerChannels.length) {
              const ch = this._status.simplexPowerChannels[channelIndex - 1];
              ch.cumulativeEnergyKwh = cumulativeEnergy;
              ch.currentRPhaseA = currentR > 32767 ? currentR - 65536 : currentR; // signed int16
              ch.currentTPhaseA = currentT > 32767 ? currentT - 65536 : currentT; // signed int16

              // Recalculate power from current (assuming 100V, PF=1)
              ch.powerW = Math.round((ch.currentRPhaseA / 10) * 100);

              // Update the echoObject value
              this._echoObject["028701"][propertyCodeText.toLowerCase()] = newValue;

              // Recalculate total power
              this.recalculateTotalPower();

              this.notifyPropertyChanged(propertyCodeText.toLowerCase());
              return true;
            }
          }
        }
        break;
    }
    return false;
  }

  private recalculateTotalPower(): void {
    this._status.totalSimplexPower = this._status.simplexPowerChannels.reduce(
      (sum, ch) => sum + ch.powerW,
      0
    );
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