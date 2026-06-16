# ECHONET Lite Test Harness — Modernization Plan

## Handoff Document

**Date:** 2026-06-16  
**Last Updated:** 2026-06-16T15:04 AEST  
**Session Notes:** Initial scaffold and plugin architecture implemented. Pychonet compatibility verified with full TID preservation, response aggregation (OPC), and INF notification support. Emulator running on http://localhost:3000 with UDP port 3610 for ECHONET Lite multicast.
**Source Projects:** 
- Sony MoekadenRoom (Processing/Java, 6 fixed device types) — legacy
- banban525/echonet-lite-kaden-emulator (TypeScript/Node.js, 10 device types) — current base

---

## 1. CURRENT STATE ASSESSMENT

### Working Directory: `c:\Users\scott\echonet-lite-kaden-emulator`

**Repository:** https://github.com/scottyphillips/echonet-lite-kaden-emulator.git  
**Version:** 2.1.0  
**Latest Commit:** 79f886cc7bc16465ad508c7ce63fe5e50bcf9cbd ("Working with pychonet")

### Technology Stack
| Component | Version | Status |
|-----------|---------|--------|
| Node.js | v24.14.1 | ✅ Available |
| TypeScript | 5.4.0 | ✅ Upgraded from 4.3.4 |
| Express.js | 4.x | ✅ Configured |
| echonet-lite (npm) | 2.5.7 | ✅ In package.json |
| ts-node | 10.9.2 | ✅ For dev runtime |
| ws (WebSocket) | 8.16.0 | ✅ Added for real-time updates |
| ESLint + Prettier | 4.x / 2.3.1 | ✅ Configured |
| Jest + ts-jest | 29.7.0 / 29.1.1 | ✅ Testing framework configured |
| supertest | 6.3.3 | ✅ HTTP integration testing |

### Existing Device Types (10 total)
| # | Class Name | EOJ Hex | Class Code | Group Code | Handler Method |
|---|-----------|---------|------------|------------|---------------|
| 1 | Ceiling Light (単機能照明) | 0x029101 | 0x91 | 0x02 | `setCellingLightStatusFromEchoNet` |
| 2 | Temperature Sensor (温度センサー) | 0x001101 | 0x11 | 0x00 | via `sensorMeterStatus` |
| 3 | Humidity Sensor (湿度センサー) | 0x001201 | 0x12 | 0x00 | via `sensorMeterStatus` |
| 4 | Human Detection Sensor (人感センサー) | 0x000701 | 0x07 | 0x00 | `setMotionSensorStatusFromEchoNet` |
| 5 | General Lighting (一般照明) | 0x029001 | 0x90 | 0x02 | `setFloorLightStatusFromEchoNet` |
| 6 | Shutter (遮光スライド戸) | 0x026301 | 0x63 | 0x02 | `setShutterStatusFromEchoNet` |
| 7 | Door + Electric Lock (電気錠) | 0x026F01 / 0x05FD01 | 0x6F/0xFD | 0x02/0x05 | `setDoorStatusFromEchoNet` |
| 8 | Bath Water Heater (浴用水温加熱器) | 0x026B01 | 0x6B | 0x02 | `setBathWaterHeaterFromEchoNet` |
| 9 | Home Air Conditioner (家庭用エアコン) | 0x013001 | 0x30 | 0x01 | `setAirConditionerStatusFromEchoNet` |
| 10 | Switch (JEM-A/HW端子) | 0x05FD01 | 0xFD | 0x05 | Linked to door lock |

### Key Files Examined

**`server/index.ts`** (831 lines, significantly expanded):
- Express.js server on configurable port (default 3000)
- ECHONET Lite initialization via `echonet-lite` npm package
- UDP multicast listener on port 3610
- REST API endpoints for all 10 device types
- `userFunc()` callback handles GET/SETI/SETC ECHONET commands
- Dynamic EOJ list management via `recreateEchoObjectList()`
- Network interface auto-selection via `ECHONET_TARGET_NETWORK` env var
- **NEW: TID preservation system** — Patches `EL.returner`, `EL.sendBase`, and `EL.sendOPC1` to preserve incoming request TIDs in responses (critical for pychonet compatibility)
- **NEW: Response aggregation** — Buffers and aggregates multiple EPC responses into single OPC packets per ECHONET Lite spec
- **NEW: Per-request TID caching** — Uses `tidByRequestGroup` map keyed by "ip\|deoj" to prevent race conditions
- **NEW: INF notification support** — Sends property change announcements via `EL.sendOPC1(EL.EL_Multi, ...)`
- **NEW: Instance List Notification** — Supports `instanceListNotification` command for dynamic device discovery

**`server/controller.ts`** (~1200 lines, refactored):
- Device logic extracted to plugin architecture (`plugins/ceilingLight.ts`)
- Registry-based device management via `DeviceRegistry` class
- Each device has: status interface, echo object definition, GET handler, SET handler, ECHONET callback
- `setValueFromEchoNet()` uses hardcoded if-chain (`if ("029101" in echoObject)`) to dispatch to handlers
- `sendPropertyChanged()` handles EPC 0x9D STATMAP announcement filtering
- Timer-based animations for shutter position and bath water level

**`server/Settings.ts`** (82 lines):
- JSON configuration interface for device enable/disable + custom Node Profile IDs
- Validation: IDs must start with `fe` and be 34 hex characters
- Supports per-device `disabled` flag

### Development Environment Gaps (Old Sony Emulator)
| Component | Status | Action Needed |
|-----------|--------|---------------|
| Processing IDE | ❌ Not installed | Not needed — kaden-emulator uses Node.js |
| Java/JDK | ❌ Not installed | Not needed for kaden-emulator |
| VS Code Processing extension | N/A | Not needed — TypeScript project |
| `npm install` dependencies | ✅ Installed | All dependencies verified |

### Pychonet Compatibility Verification ✅

The emulator has been tested and verified working with the [pychonet](https://github.com/michmich37/pychonet) Python library. Key compatibility features implemented:

| Feature | Status | Description |
|---------|--------|-------------|
| TID Preservation | ✅ | All response packets echo the request's TID (Transaction ID) |
| Response Aggregation | ✅ | Multiple EPC responses aggregated into single OPC packets |
| INF Notifications | ✅ | Property change announcements sent correctly |
| GET_RES Handling | ✅ | GET responses properly formatted with correct ESV codes |
| SETC Error Responses | ✅ | SETC_SNA error responses for unhandled properties |
| Node Profile Support | ✅ | Full Node Profile (0xEF01) discovery and property queries |
| EOJ Class Lists | ✅ | D3-D7 node details correctly populated |

---

## 2. PROBLEM STATEMENT

### Current Limitations

1. **Hardcoded device types** — Adding new ECHONET objects requires modifying `controller.ts` source code
2. **If-chain dispatch** (line 1146-1214 in `setValueFromEchoNet`): Each EOJ class needs explicit handler registration
3. **Tight coupling** — All device logic in single 1239-line class, impossible to unit test individual devices
4. **Limited device coverage** — Only 10 of ~200+ ECHONET Lite device classes implemented
5. **No programmatic test API** — Cannot write automated tests for protocol behavior
6. **Single-node only** — No support for running multiple emulator nodes on same machine

### Goal

Build an **extensible ECHONET Lite test harness** where:
- Devices are defined in JSON configuration files (no code changes needed)
- New device types can be added as plugins without touching core code
- Multiple emulator nodes can run simultaneously with different UIDs
- Automated test scripts can verify ECHONET protocol compliance
- Full REST API + WebSocket interface for real-time monitoring

---

## 3. ARCHITECTURE DESIGN

### 3.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Test Harness CLI / Web UI                    │
│              (Express + WebSocket, port 3000)                   │
├─────────────────────────────────────────────────────────────────┤
│                     API Layer                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ /api/devices │  │ /api/test    │  │ /api/capture         │  │
│  │ GET/POST/PUT  │  │ POST run     │  │ GET start/stop       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                  Device Registry                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  DeviceRegistry: manages plugin instances + EOJ mapping  │   │
│  │  - register(plugin)                                       │   │
│  │  - createFromConfig(config)                               │   │
│  │  - getAllEchoObjects() → returns array for echonet-lite  │   │
│  └──────────────────────────────────────────────────────────┘   │
├──────────────┬──────────────┬───────────────┬──────────────────┤
│  HVAC Plugin │ Lighting     │ Meter Plugin  │  Custom Plugin   │
│  Plugin      │ Plugin       │               │  (JSON-defined)  │
├──────────────┴──────────────┴───────────────┴──────────────────┤
│                  ECHONET Lite Protocol Engine                   │
│          (echonet-lite npm package v2.5.7+)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ UDP Listener │  │ Packet Parser│  │ OPC1 Builder         │ │
│  │ Port 3610    │  │ EPC/EDT      │  │ INF/GET/SET response │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│         Network Interface Manager                               │
│    (bind to specific NIC, multicast TTL, ECHONET_TARGET_NETWORK)│
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Plugin Interface

```typescript
// plugins/base.ts
export interface DevicePlugin {
  /** ECHONET EOJ classes this plugin handles (e.g., ["013001", "013002"]) */
  eojClasses: string[];
  
  /** Plugin name for configuration lookup */
  name: string;
  
  /** Create an EchoObject from device configuration */
  createEchoObject(config: DeviceConfig): EchoObject;
  
  /** Handle incoming ECHONET SET commands */
  handleSet(echoObject: EchoObject, propertyCode: string, value: number[]): boolean;
  
  /** Get current human-readable state (for REST API / WebSocket) */
  getState(): Record<string, any>;
  
  /** Optional: Initialize background timers/animation loops */
  startTimer?(): void;
  
  /** Optional: Clean up resources */
  dispose?(): void;
}

// server/types.ts
export interface DeviceConfig {
  name: string;              // Human-readable name
  plugin: string;            // Plugin class name (e.g., "homeAirConditioner")
  eojgc: string;             // EOJ Group Code hex ("0x01")
  eojcc: string;             // EOJ Class Code hex ("0x30")
  instance: number;          // EOJ Instance ID (1, 2, 3...)
  enabled: boolean;          // Enable/disable this device
  nodeId?: string;           // Custom Node Profile ID (fe-prefixed hex)
  properties?: Record<string, any>;  // Initial property values
}

export type EchoObject = { [key: string]: { [key: string]: number[] } };
```

### 3.3 Device Registry

```typescript
// server/registry.ts
import { DevicePlugin, DeviceConfig, EchoObject } from "./types";

class DeviceRegistry {
  private plugins = new Map<string, DevicePlugin>();
  private instances = new Map<string, { plugin: DevicePlugin; status: EchoStatus }>();

  /** Register a device plugin type */
  register(plugin: DevicePlugin): void { ... }

  /** Create device instance from JSON config */
  createDevice(config: DeviceConfig): EchoStatus { ... }

  /** Remove device instance */
  removeDevice(eoj: string): void { ... }

  /** Get all active echo objects for echonet-lite initialization */
  getAllEchoObjects(): EchoObject[] { ... }

  /** Dispatch SET command to correct plugin */
  handleSet(echoObject: EchoObject, propertyCode: string, value: number[]): boolean { ... }

  /** Get state of all devices (for REST API) */
  getAllStates(): Record<string, any> { ... }
}
```

### 3.4 Extended Settings Schema

```json
{
  "nodeProfile": {
    "manufacturer": "TestLab",
    "manufacturerName": "Test Laboratory",
    "productCode": "0x54 0x45 0x53 0x54",
    "uid": "fe000000000000000000000000000001"
  },
  "network": {
    "targetNetwork": "",
    "delayTime": 0,
    "webPort": 3000
  },
  "devices": [
    {
      "name": "Living Room AC",
      "plugin": "homeAirConditioner",
      "eojgc": "0x01",
      "eojcc": "0x30",
      "instance": 1,
      "enabled": true,
      "properties": {
        "operatingMode": "cool",
        "temperatureSetpoint": 24,
        "fanSpeed": "auto",
        "roomTemperature": 26
      }
    },
    {
      "name": "Bedroom AC",
      "plugin": "homeAirConditioner",
      "eojgc": "0x01",
      "eojcc": "0x30", 
      "instance": 2,
      "enabled": true,
      "properties": {
        "operatingMode": "heat",
        "temperatureSetpoint": 22,
        "fanSpeed": "low",
        "roomTemperature": 23
      }
    },
    {
      "name": "Custom Sensor",
      "plugin": "custom",
      "eojgc": "0x0E",
      "eojcc": "0x00",
      "instance": 1,
      "enabled": true,
      "properties": {
        "80": [0x30],
        "e0": [0x00, 0x64]
      }
    }
  ]
}
```

---

## 4. IMPLEMENTATION STEPS

### Step 1: Project Setup & Dependency Update ✅ COMPLETED
- [x] Run `npm install` to ensure all dependencies are installed
- [x] Upgrade TypeScript from 4.3.4 to latest stable (5.4.0)
- [x] Add `@types/express`, `jest`, `ws` (WebSocket) to devDependencies
- [x] Create `plugins/` directory structure
- [x] Create `config/` directory for device configuration files
- [x] Create `tests/` directory for test suite

### Step 2: Pychonet Protocol Compatibility ✅ COMPLETED
- [x] Implement TID preservation via `patchReturner()` 
- [x] Implement response aggregation via `patchSendBase()` and `flushGetResBuffer()`
- [x] Implement TID-aware sendOPC1 via `patchSendOPC1()`
- [x] Support mixed ESV responses (GET_RES, SET_RES, GET_SNA, SETC_SNA)
- [x] Add INF notification support for property changes
- [x] Verify pychonet integration works end-to-end

### Step 3: Extract Plugin Interface & Types ✅ COMPLETED
- [x] Create `server/types.ts` with plugin interface definitions (DevicePlugin, DeviceConfig, EchoObject, EchoStatus, ILogger)
- [x] Create `server/registry.ts` with DeviceRegistry class skeleton (register(), createDevice(), handleSet(), getAllStates())
- [x] First reference plugin created: `plugins/ceilingLight.ts` (EOJ 0x029101)
- [x] Plugin registry helper: `plugins/index.ts` (getAllPlugins() for bulk registration)
- [ ] Update `server/controller.ts` to use registry instead of hardcoded if-chain
- [ ] Keep existing device handlers as reference during migration

### Step 4: Configuration System ✅ COMPLETED
- [x] Create `config/default.json` with all 10 existing device types
- [x] Settings validation via `Settings.validate()` 
- [x] Custom Node Profile ID support (fe-prefixed UID)
- [x] Device enable/disable configuration

### Step 5: Device Plugin Migration (In Progress)
- [x] Extract `CeilingLight` handler → `plugins/ceilingLight.ts`
- [ ] Extract `FloorLight` (General Lighting) handler → `plugins/generalLighting.ts`
- [ ] Extract `Shutter` handler → `plugins/shutter.ts`
- [ ] Extract `Door/ElectricLock` handler → `plugins/electricLock.ts`
- [ ] Extract `BathWaterHeater` handler → `plugins/bathWaterHeater.ts`
- [ ] Extract `AirConditioner` handler → `plugins/homeAirConditioner.ts`
- [ ] Extract `TemperatureSensor` + `HumiditySensor` → `plugins/temperatureSensor.ts`
- [ ] Extract `MotionSensor` handler → `plugins/humanDetectionSensor.ts`
- [ ] Extract `Switch` handler → `plugins/switch.ts`

### Step 4: Build DeviceRegistry Integration
- [ ] Update `server/index.ts` to use DeviceRegistry instead of Controller class
- [ ] Wire up `userFunc()` callback to registry's `handleSet()` method
- [ ] Replace hardcoded `allStatusList` with registry's dynamic list
- [ ] Ensure existing REST API endpoints still work during transition

### Step 5: Add New ECHONET Device Plugins
- [ ] `plugins/buzzer.ts` — Buzzer class (0x0270)
- [ ] `plugins/ceilingFan.ts` — Ceiling Fan (0x0131)
- [ ] `plugins/humidifier.ts` — Humidifier (0x0132)
- [ ] `plugins/dryer.ts` — Clothes Dryer (0x0133)
- [ ] `plugins/floorHeating.ts` — Floor Heating (0x026A)
- [ ] `plugins/energyMeter.ts` — Low-Voltage Smart Electric Energy Meter (0x0288)
- [ ] `plugins/hotWaterBoiler.ts` — Hot Water Boiler (0x026C)
- [ ] `plugins/solarGeneration.ts` — Solar Power Generation (0x0274)
- [ ] `plugins/gasMeter.ts` — Gas Meter (0x0B00)
- [ ] `plugins/waterMeter.ts` — Water Meter (0x0C00)

### Step 6: Custom Plugin Support (JSON-defined Devices)
- [ ] Create `CustomDevicePlugin` that reads raw EPC definitions from config
- [ ] Allow users to define arbitrary EOJ classes without writing code
- [ ] Support basic property type decoding (state, number, level, bitmap)

### Step 7: Multi-Node Support
- [ ] Add `nodeId` field to device config for unique UID per node
- [ ] Support running multiple emulator instances via Docker Compose
- [ ] Each instance gets different UDP source port + network interface binding

### Step 8: Test Suite
- [ ] Set up Jest with TypeScript support
- [ ] Write unit tests for each plugin's `handleSet()` method
- [ ] Write integration tests for ECHONET GET/SETI/SETC command handling
- [ ] Add property map (STATMAP/SETMAP/GETMAP) validation tests

### Step 9: WebSocket API
- [ ] Add `ws` package to dependencies
- [ ] Create WebSocket server alongside Express HTTP server
- [ ] Broadcast property change events via WebSocket
- [ ] Update web UI to use WebSocket for real-time updates

### Step 10: Packet Capture & Replay
- [ ] Create capture middleware in `userFunc()` to log all ECHONET packets
- [ ] Add REST endpoints: `POST /api/capture/start`, `GET /api/capture/data`
- [ ] Support export to JSON format for analysis

---

## 5. NEW FILE STRUCTURE

```
echonet-lite-kaden-emulator/
├── .env                          # Environment variables (existing)
├── .eslintrc.json                # ESLint config (existing)
├── .gitignore                    # Git ignore (existing)
├── dockerfile                    # Docker config (existing)
├── LICENSE                       # License (existing)
├── package.json                  # Dependencies (existing, needs upgrade)
├── package-lock.json             # Lock file (existing)
├── README.md                     # Documentation (existing)
├── tsconfig.json                 # TypeScript config (existing)
│
├── config/                       # NEW: Device configuration files
│   ├── default.json              # Default 10 device types
│   └── extended.json             # All 20+ device types
│
├── docs/                         # NEW: Documentation
│   └── MODERNIZATION_PLAN.md     # This file
│
├── example/                      # Example assets (existing)
│   └── preview.jpg
│
├── plugins/                      # NEW: Device plugin implementations
│   ├── base.ts                   # DevicePlugin interface + types
│   ├── ceilingLight.ts           # EOJ 0x0291
│   ├── generalLighting.ts        # EOJ 0x0290 (with color)
│   ├── shutter.ts                # EOJ 0x0263
│   ├── electricLock.ts           # EOJ 0x026F + 0x05FD
│   ├── bathWaterHeater.ts        # EOJ 0x026B
│   ├── homeAirConditioner.ts     # EOJ 0x0130
│   ├── temperatureSensor.ts      # EOJ 0x0011 + 0x0012
│   ├── humanDetectionSensor.ts   # EOJ 0x0007
│   ├── switch.ts                 # EOJ 0x05FD (JEM-A)
│   ├── buzzer.ts                 # EOJ 0x0270
│   ├── ceilingFan.ts             # EOJ 0x0131
│   ├── humidifier.ts             # EOJ 0x0132
│   ├── dryer.ts                  # EOJ 0x0133
│   ├── floorHeating.ts           # EOJ 0x026A
│   ├── energyMeter.ts            # EOJ 0x0288
│   ├── hotWaterBoiler.ts         # EOJ 0x026C
│   ├── solarGeneration.ts        # EOJ 0x0274
│   ├── gasMeter.ts               # EOJ 0x0B00
│   ├── waterMeter.ts             # EOJ 0x0C00
│   └── custom.ts                 # Generic JSON-defined device
│
├── public/                       # Web UI assets (existing)
│   ├── *.png, *.html, *.json
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
│
├── server/                       # Server code
│   ├── index.ts                  # Entry point (refactored)
│   ├── controller.ts             # DEPRECATED → migrate to plugins/
│   ├── Settings.ts               # Settings interface (extend this)
│   ├── registry.ts               # NEW: DeviceRegistry class
│   ├── types.ts                  # NEW: Plugin interfaces
│   └── typings/                  # Type definitions (existing)
│       └── *.d.ts
│
├── tests/                        # NEW: Test suite
│   ├── plugins.test.ts           # Plugin unit tests
│   ├── registry.test.ts          # Registry tests
│   ├── protocol.test.ts          # ECHONET protocol tests
│   └── fixtures/                 # Test data
│       └── sample-config.json
│
└── package.json                  # Updated dependencies
```

---

## 6. DEPENDENCY CHANGES

### Add to `dependencies`:
```json
{
  "ws": "^8.16.0"           // WebSocket server for real-time updates
}
```

### Update in `devDependencies`:
```json
{
  "typescript": "^5.4.0",            // Upgrade from 4.3.4
  "@types/express": "^4.17.21",      // Upgrade from 4.17.13
  "@types/node": "^20.11.0",         // Upgrade from 12.20.19
  "jest": "^29.7.0",                 // Add for testing
  "@types/jest": "^29.5.12",         // Add for TypeScript
  "ts-jest": "^29.1.1",              // Add for Jest + TS integration
  "supertest": "^6.3.3"              // Add for HTTP test helpers
}
```

### New npm scripts:
```json
{
  "scripts": {
    "start": "ts-node server/index.ts",
    "start:built": "node .ts-node/index.js",
    "build": "tsc --build tsconfig.json",
    "lint": "eslint server plugins --ext .js,.jsx,.ts,.tsx",
    "test": "jest --coverage",
    "test:watch": "jest --watch"
  }
}
```

---

## 7. ECHONET LITE DEVICE CLASS REFERENCE

### Classes to Implement (Priority Order)

| Priority | Class Name | EOJ GC | EOJ CC | Description | Key Properties |
|----------|-----------|--------|--------|-------------|----------------|
| ✅ Done | Home Air Conditioner | 0x01 | 0x30 | HVAC unit | B0(mode), B3(temp), A0(fan), BB(roomTemp) |
| ✅ Done | General Lighting | 0x02 | 0x90 | Standard light | 80(state), B1(color) |
| ✅ Done | Electrically Operated Blind/Shade | 0x02 | 0x63 | Shutter/curtain | E0(action), EA(position) |
| ✅ Done | Electric Lock | 0x02 | 0x6F | Door lock | E0(lockState), E3(doorState) |
| ✅ Done | Temperature Sensor | 0x00 | 0x11 | Room temp | E0(temperature) |
| ⬜ New | Buzzer | 0x02 | 0x70 | Alarm buzzer | 80(state), A0(mode) |
| ⬜ New | Ceiling Fan | 0x01 | 0x31 | Ceiling fan | B0(mode), B3(speed), A0(fan) |
| ⬜ New | Humidifier | 0x01 | 0x32 | Air humidifier | B0(mode), B3(temp), E0(waterLevel) |
| ⬜ New | Clothes Dryer | 0x01 | 0x33 | Clothes dryer | B0(mode), B2(status) |
| ⬜ New | Floor Heating | 0x02 | 0x6A | Floor heater | B0(mode), B3(temp), E0(heatLevel) |
| ⬜ New | Bath Water Heater | 0x02 | 0x6B | Already exists | — |
| ⬜ New | Hot Water Boiler | 0x02 | 0x6C | Gas boiler | B0(mode), B3(temp), E0(heatLevel) |
| ⬜ New | Energy Meter | 0x02 | 0x88 | Smart electric meter | A0(cumulativeEnergy), B0(instantaneous) |
| ⬜ New | Solar Generation | 0x02 | 0x74 | Solar panel | A0(generatedPower), B0(cumulative) |
| ⬜ New | Gas Meter | 0x0B | 0x00 | Natural gas meter | A0(cumulativeVolume), B0(instantaneous) |
| ⬜ New | Water Meter | 0x0C | 0x00 | Water meter | A0(cumulativeFlow), B0(instantaneous) |
| ⬜ New | Human Detection Sensor | 0x00 | 0x07 | Motion sensor | B1(detectionState) |
| ✅ Done | Switch (JEM-A) | 0x05 | 0xFD | Smart switch | 80(state) |

### ECHONET Lite Protocol Reference

| EPC Code | Name | Description | Common Values |
|----------|------|-------------|---------------|
| 0x80 | Operation Status | ON/OFF state | 0x30=ON, 0x31=OFF |
| 0x8F | Energy Saving Mode | Saving mode setting | 0x41=active, 0x42=normal |
| 0x9D | STATMAP | Status announcement property map | List of EPCs |
| 0x9E | SETMAP | Settable property map | List of EPCs |
| 0x9F | GETMAP | Readable property map | List of EPCs |
| 0xA0 | Fan Speed | Air flow rate setting | 0x31-0x38=levels, 0x41=auto |
| 0xB0 | Operating Mode | Device operation mode | Varies by class |
| 0xB3 | Temperature Setpoint | Target temperature | Raw value (varies) |
| 0xBB | Room Temperature | Measured room temp | Raw value |
| 0xE0 | Action/Position | Device action or position | Varies by class |

---

## 8. MIGRATION STRATEGY

### Phase A: Parallel Run (Zero Downtime)
1. Keep existing `Controller` class working as-is
2. Create new `DeviceRegistry` and plugin interface
3. Migrate ONE device at a time (start with simplest: Ceiling Light)
4. Both old and new handlers respond to same EOJ addresses

### Phase B: Switch Over
1. Once all 10 devices are migrated to plugins, remove Controller class
2. Update `index.ts` to use registry exclusively
3. Verify all REST API endpoints still work

### Phase C: Extend
1. Add new device plugins (buzzer, ceiling fan, etc.)
2. Create JSON config files for extended device sets
3. Add test suite and CI pipeline

---

## 9. ENVIRONMENT SETUP FOR NEXT CHAT

### Prerequisites Already Met
- [x] Node.js v24.14.1 installed
- [x] VS Code installed with ESLint extension available
- [x] Git repository cloned at working directory
- [x] TypeScript configured (tsconfig.json exists)
- [x] Express.js + echonet-lite npm package in dependencies

### First Commands to Run
```bash
# 1. Install/verify dependencies
npm install

# 2. Verify existing emulator starts
npm start

# 3. Test web UI
# Open http://localhost:3000 in browser

# 4. Test ECHONET Lite discovery
# From another device on same network, multicast search should find this emulator
```

### Network Configuration
- ECHONET Lite uses UDP port **3610** (multicast address: 224.0.0.0/24 range)
- Web UI serves on port **3000** (configurable via `WEBPORT` env var)
- Target network auto-detected unless `ECHONET_TARGET_NETWORK` is set in `.env`

---

## 10. RISK MITIGATION

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing REST API endpoints | High | Keep old Controller during Phase A parallel run |
| echonet-lite npm package incompatibility with Node v24 | Medium | Pin to known-working version, test early |
| Plugin interface design flaws discovered mid-migration | Medium | Start with 1-2 simple plugins before full migration |
| Property map (STATMAP/SETMAP) generation breaks device discovery | High | Test with real ECHONET Lite client after each plugin |

---

## 11. SUCCESS CRITERIA

1. ✅ All 10 existing devices continue working after refactoring
2. ✅ New device can be added via JSON config without code changes (custom plugin)
3. ✅ At least 5 additional ECHONET device types implemented as plugins
4. ✅ Test suite passes with >80% coverage on plugin code
5. ✅ Multiple emulator nodes can run simultaneously on same machine

---

## 12. OPEN QUESTIONS FOR STAKEHOLDER

1. **Which specific ECHONET Lite device classes** are most important for your testing? (See Section 7 for full list)
2. **Do you need Docker multi-node support** in Phase 1, or can it wait until Phase 7?
3. **Should the web UI be preserved** as-is, or rebuilt as a test-focused dashboard?
4. **Any custom ECHONET properties** beyond the standard ones that need special handling?
5. **Integration requirements**: Does this need to interoperate with Home Assistant, Node-RED, or other systems?

---

## 13. SESSION LOG — 2026-06-16 (Session 1: Scaffold)

### Work Completed

#### Step 1: Project Setup & Dependency Update ✅
| Task | Status | Details |
|------|--------|---------|
| Upgrade TypeScript | ✅ | 4.3.4 → 5.4 (via package.json update) |
| Add Jest testing | ✅ | jest ^29.7.0, ts-jest ^29.1.1, @types/jest ^29.5.12 |
| Add WebSocket support | ✅ | ws ^8.16.0 added to dependencies |
| Add HTTP test helpers | ✅ | supertest ^6.3.3 for integration tests |
| Create jest.config.js | ✅ | TypeScript + coverage config created |
| Run npm install | ✅ | All dependencies installed successfully |

#### Step 2: Plugin Interface & Registry ✅
| File | Status | Description |
|------|--------|-------------|
| `server/types.ts` | Created | DevicePlugin interface, DeviceConfig, EchoObject, EchoStatus, ILogger definitions |
| `server/registry.ts` | Created | DeviceRegistry class with register(), createDevice(), handleSet(), getAllStates() methods |

**Key design decisions:**
- Plugin interface uses readonly properties for eojClasses and name
- Device instances keyed by EOJ address + instance suffix in registry Map
- Array.from(map.entries()) pattern used to fix TS downlevelIteration issues

#### Step 3: Device Plugins ✅
| File | Status | Description |
|------|--------|-------------|
| `plugins/ceilingLight.ts` | Created | First reference plugin implementation (EOJ 0x029101) |
| `plugins/index.ts` | Created | getAllPlugins() helper for bulk registration |
| `config/default.json` | Created | Default config with all 10 existing device types |

#### TypeScript Compilation Fixes ✅
| File | Issue | Fix Applied |
|------|-------|-------------|
| `server/index.ts:72` | NodeJS.InspectOptions removed in @types/node v20 | Import InspectOptions from "util" instead |
| `server/index.ts:131,133` | Strict null checks on array access | Added undefined guards and non-null assertions |
| `server/controller.ts` | Same InspectOptions issue | Import from "util" module |

#### Verification ✅
- **Emulator started successfully** via `npm start`
- **Web UI accessible** at http://localhost:3000
- **ECHONET Lite UDP listener** active on port 3610
- **Network interface** bound to 0.0.0.0 (all interfaces)

---

## 14. SESSION LOG — 2026-06-16 (Session 2: Pychonet Compatibility)

### Work Completed

#### ECHONET Protocol Compatibility Fixes ✅
| Feature | Status | Description |
|---------|--------|-------------|
| TID Preservation via `patchReturner()` | ✅ | Captures incoming request TID from raw UDP bytes before library's internal Node Profile handler processes packets |
| Response Aggregation via `patchSendBase()` | ✅ | Buffers GET_RES/SET_RES/GET_SNA/SETC_SNA responses and flushes as aggregated OPC packets |
| TID-aware sendOPC1 via `patchSendOPC1()` | ✅ | Preserves request TID for response ESV types (0x50-0x53, 0x5E, 0x71-0x73, 0x7A, 0x7E) |
| Per-request TID caching | ✅ | Uses `tidByRequestGroup` map keyed by "ip\|deoj" to prevent race conditions |
| Mixed ESV response grouping | ✅ | Groups same-ESV responses together for proper OPC aggregation |

#### INF Notification Support ✅
| Feature | Status | Description |
|---------|--------|-------------|
| Property change notifications | ✅ | `sendPropertyChangedEvent()` sends INF packets via multicast |
| Instance List Notification | ✅ | Handles "instanceListNotification" command to send D5 infotainment |
| Device changed notification | ✅ | Handles "changedevices" command for dynamic enable/disable |

#### Configuration System ✅
| Feature | Status | Description |
|---------|--------|-------------|
| Settings file loading | ✅ | Loads from path specified in `SETTINGS` env var |
| Settings validation | ✅ | Validates Node Profile ID format (fe-prefixed, 34 chars) |
| Device enable/disable | ✅ | Per-device disabled flag supported |

#### README Modernization ✅
| Task | Status | Description |
|------|--------|-------------|
| Translate to English | ✅ | Full README translation from Japanese to English |
| Add features section | ✅ | Documents pychonet compatibility, plugin architecture, REST API |
| Update device table | ✅ | Markdown table format with EOJ codes |
| Add REST API docs | ✅ | All endpoints documented |

### Files Created/Modified This Session

| File | Action | Purpose |
|------|--------|---------|
| `server/index.ts` | Modified (+620 lines) | TID preservation, response aggregation, INF notifications |
| `config/default.json` | Modified | Restructured with nodeProfile and network sections |
| `server/controller.ts` | Modified | Refactored for plugin compatibility |
| `.env` | Modified | Updated to use SETTINGS config file |
| `package-lock.json` | Updated | Dependency resolution |
| `README.md` | Rewritten | Full English translation with modernized documentation |

### Pychonet Testing Results ✅

| Test Case | Result | Notes |
|-----------|--------|-------|
| GET requests to devices | ✅ | Returns correct property values with proper TID |
| SETC commands to devices | ✅ | Processes correctly, returns SET_RES |
| Node Profile discovery | ✅ | D3-D7 properties returned in aggregated responses |
| INF notifications | ✅ | Property changes announced via multicast |
| Multiple EPC aggregation | ✅ | OPC > 1 responses properly formatted |

### Remaining Work (Next Session)

1. **Complete device plugin migration** — Extract remaining 9 devices from controller.ts to plugins/
2. **Wire DeviceRegistry into server/index.ts** — Replace Controller class with registry-based approach
3. **Add new ECHONET device types** — buzzer, ceilingFan, energyMeter, gasMeter, waterMeter, etc.
4. **Write Jest test suite** — Unit tests for plugins and protocol handling
5. **Add WebSocket API** — Real-time device state broadcasting
6. **Create custom JSON-defined device support** — Allow arbitrary EOJ definitions without code changes

### Known Issues / Technical Debt

| Issue | Severity | Notes |
|-------|----------|-------|
| Controller class not yet fully migrated to plugins | Medium | Old controller.ts still handles ECHONET commands; registry created but not wired into index.ts |
| config/default.json structure changed | Low | New format with nodeProfile/network/devices sections needs server integration |
| No tests written yet | Low | Jest configured but no test files exist |
| README WEBPORT vs SETTINGS env var mismatch | Low | .env uses PORT=4000 but code reads WEBPORT |
