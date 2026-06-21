/* eslint-disable @typescript-eslint/no-var-requires */
import express from "express";
import EL from "echonet-lite";
import { Settings } from "./Settings";
import { InspectOptions } from "util";
import type { ILogger, EchoObject, EchoStatus, SendPropertyChangedMethod } from "./types";

// Import device modules
import { CeilingLightDevice } from "./devices/ceilingLight";
import { TemperatureSensorDevice, HumiditySensorDevice } from "./devices/sensors";
import { MotionSensorDevice } from "./devices/motionSensor";
import { FloorLightDevice } from "./devices/floorLight";
import { ShutterDevice } from "./devices/shutter";
import { DoorDevice, SwitchDevice } from "./devices/door";
import { BathWaterHeaterDevice } from "./devices/bathWaterHeater";
import { AirConditionerDevice } from "./devices/airConditioner";
import { DistributionPanelMeterControllerDevice } from "./devices/distributionPanelMeterController";
import { EvChargerDischargerDevice, EvChargerDischargerStatus } from "./devices/evChargerDischarger";

// Re-export types for backward compatibility
export type { EchoObject, EchoStatus, ILogger, SendPropertyChangedMethod } from "./types";

// Local backward-compatible status interfaces (for existing API contracts)
interface CellingLightStatus {
  state: "on" | "off";
}

interface SensorMeterStatus {
  temp: number;
  hum: number;
}

interface MotionSensorStatus {
  state: "detected" | "notDetected";
}

interface FloorLightStatus {
  state: "on" | "off";
  color: "lamp" | "white" | "neutralWhite";
}

interface ShutterStatus {
  state: "opened" | "opening" | "halfOpen" | "closing" | "closed";
  position: number; // 0:全閉、100:全開
  move: "opening" | "stopped" | "closing";
}

interface DoorStatus {
  state: "closed" | "opened";
  lockState: "unlocked" | "locked";
}

interface BathWaterHeaterStatus {
  state: "empty" | "supply" | "drainage" | "full";
  auto: "off" | "on";
  temp: number;
  waterLevel: number; // 0:空、100:Full
  timerRunning?: boolean; // Whether the auto-fill timer is active
}

interface AirConditionerStatus {
  state: "off" | "cool" | "heat" | "dry" | "wind";
  temp: number;
  internalMode: "cool" | "heat" | "dry" | "wind";
}

export class Controller {
  private logger: ILogger;
  private readonly settings: Settings;

  // Device instances
  private ceilingLight: CeilingLightDevice;
  private tempSensor: TemperatureSensorDevice;
  private humSensor: HumiditySensorDevice;
  private motionSensor: MotionSensorDevice;
  private floorLight: FloorLightDevice;
  private shutter: ShutterDevice;
  private door: DoorDevice;
  private switchDevice: SwitchDevice;
  private bathWaterHeater: BathWaterHeaterDevice;
  private airConditioner: AirConditionerDevice;
  private distributionPanelMeterController: DistributionPanelMeterControllerDevice;
  private evChargerDischarger: EvChargerDischargerDevice;

  constructor(logger: ILogger, settings: Settings) {
    this.logger = logger;
    this.settings = settings;

    // Initialize device instances with property change callback
    const onPropertyChanged: SendPropertyChangedMethod = (echoStatus: EchoStatus, eoj: string, propertyNo: string, newValue: number[]) => {
      this.sendPropertyChangedEvent(echoStatus, eoj, propertyNo, newValue);
    };

    this.ceilingLight = new CeilingLightDevice({ onPropertyChanged });
    this.tempSensor = new TemperatureSensorDevice({ onPropertyChanged });
    this.humSensor = new HumiditySensorDevice({ onPropertyChanged });
    this.motionSensor = new MotionSensorDevice({ onPropertyChanged });
    this.floorLight = new FloorLightDevice({ onPropertyChanged });
    this.shutter = new ShutterDevice({ onPropertyChanged });
    this.door = new DoorDevice({ onPropertyChanged });
    this.switchDevice = new SwitchDevice({ onPropertyChanged });
    this.bathWaterHeater = new BathWaterHeaterDevice({ onPropertyChanged });
    this.airConditioner = new AirConditionerDevice({ onPropertyChanged });
    this.distributionPanelMeterController = new DistributionPanelMeterControllerDevice({ onPropertyChanged });
    this.evChargerDischarger = new EvChargerDischargerDevice({ onPropertyChanged });

    // Apply settings
    this.ceilingLight.enabled = !(settings.devices?.monoFunctionalLighting?.disabled ?? false);
    this.tempSensor.enabled = !(settings.devices?.temperatureSensor?.disabled ?? false);
    this.humSensor.enabled = !(settings.devices?.humiditySensor?.disabled ?? false);
    this.motionSensor.enabled = !(settings.devices?.humanDetectionSensor?.disabled ?? false);
    this.floorLight.enabled = !(settings.devices?.generalLighting?.disabled ?? false);
    this.shutter.enabled = !(settings.devices?.electricallyOperatedRainSlidingDoorShutter?.disabled ?? false);
    this.bathWaterHeater.enabled = !(settings.devices?.electricWaterHeater?.disabled ?? false);
    this.airConditioner.enabled = !(settings.devices?.homeAirConditioner?.disabled ?? false);
    this.door.enabled = !(settings.devices?.electricLock?.disabled ?? false);
    this.switchDevice.enabled = !(settings.devices?.switch?.disabled ?? false);
    this.distributionPanelMeterController.enabled = !(settings.devices?.distributionPanelMeterController?.disabled ?? false);
    this.evChargerDischarger.enabled = !(settings.devices?.evChargerDischarger?.disabled ?? false);

    // Set common properties
    this.setCommonProperties(this.ceilingLight.echoObject, settings.devices?.monoFunctionalLighting?.id ?? "");
    this.setCommonProperties(this.tempSensor.echoObject, settings.devices?.temperatureSensor?.id ?? "");
    this.setCommonProperties(this.humSensor.echoObject, settings.devices?.humiditySensor?.id ?? "");
    this.setCommonProperties(this.motionSensor.echoObject, settings.devices?.humanDetectionSensor?.id ?? "");
    this.setCommonProperties(this.floorLight.echoObject, settings.devices?.generalLighting?.id ?? "");
    this.setCommonProperties(this.shutter.echoObject, settings.devices?.electricallyOperatedRainSlidingDoorShutter?.id ?? "");
    this.setCommonProperties(this.door.echoObject, settings.devices?.electricLock?.id ?? "");
    this.setCommonProperties(this.switchDevice.echoObject, settings.devices?.switch?.id ?? "");
    this.setCommonProperties(this.bathWaterHeater.echoObject, settings.devices?.electricWaterHeater?.id ?? "");
    this.setCommonProperties(this.airConditioner.echoObject, settings.devices?.homeAirConditioner?.id ?? "");
    this.setCommonProperties(this.distributionPanelMeterController.echoObject, settings.devices?.distributionPanelMeterController?.id ?? "");
    this.setCommonProperties(this.evChargerDischarger.echoObject, settings.devices?.evChargerDischarger?.id ?? "");

    // Start timer for animated devices
    setInterval(() => this.timer(), 1000);
  }

  private sendPropertyChanged = (
    echoObject: EchoObject,
    eoj: string,
    propertyNo: string
  ): void => {
    const enabledDevices = [this.ceilingLight, this.tempSensor, this.humSensor, this.motionSensor, this.floorLight, this.shutter, this.door, this.switchDevice, this.bathWaterHeater, this.airConditioner, this.distributionPanelMeterController, this.evChargerDischarger];
    for (const device of enabledDevices) {
      if (device.enabled === false) continue;

      const echoStatus = device.echoStatus;
      if (!(propertyNo in echoStatus.echoObject[eoj])) {
        continue;
      }

      const announcePropertyMap = echoStatus.echoObject[eoj]["9d"];
      if (!announcePropertyMap || announcePropertyMap.length === 0) {
        continue;
      }

      const existsAnnounceProperty = announcePropertyMap
        .slice(1)
        .filter((_): boolean => _ === parseInt(propertyNo, 16)).length !== 0;

      if (existsAnnounceProperty === false) {
        continue;
      }

      this.sendPropertyChangedEvent(
        echoStatus,
        eoj,
        propertyNo,
        echoStatus.echoObject[eoj][propertyNo]
      );
      break;
    }
  };

  public sendPropertyChangedEvent: SendPropertyChangedMethod = (): void => {
    //
  };

  // === Ceiling Light (Mono Functional Lighting) ===
  public getCellingLightStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json({ state: this.ceilingLight.status.state });
  };

  public setCellingLightStatus = (newStatus: CellingLightStatus): void => {
    const state = newStatus.state === "on" ? "on" : "off";
    if (this.ceilingLight.status.state !== state) {
      this.ceilingLight.setStatus({ state });
      this.logger.dir(this.ceilingLight.status, { depth: 3 });
    }
  };

  public setCellingLightStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    const newStatus: CellingLightStatus = {
      state: req.body.state === "on" ? "on" : "off",
    };
    this.setCellingLightStatus(newStatus);
    res.json(this.ceilingLight.status);
  };

  public setCellingLightStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    return this.ceilingLight.setStatusFromEchoNet(propertyCodeText, newValue);
  };

  // === Temperature/Humidity Sensors ===
  public getSensorMeterStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json({ temp: this.tempSensor.status.temp, hum: this.humSensor.status.hum });
  };

  public setSensorMeterStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    let temp = req.body.temp;
    if (typeof temp === "string") {
      temp = Number(temp);
      if (isNaN(temp)) {
        temp = this.tempSensor.status.temp;
      }
    }
    if (typeof temp === "number" && -10 <= temp && temp <= 40) {
      this.tempSensor.setStatus(temp);

      // Update air conditioner internal temperature reading
      this.airConditioner.updateInternalTemp(temp);
    }

    let hum = req.body.hum;
    if (typeof hum === "string") {
      hum = Number(hum);
      if (isNaN(hum)) {
        hum = this.humSensor.status.hum;
      }
    }
    if (typeof hum === "number" && 0 <= hum && hum <= 100) {
      this.humSensor.setStatus(hum);
    }

    this.logger.dir({ temp: this.tempSensor.status.temp, hum: this.humSensor.status.hum }, { depth: 3 });
    res.json({ temp: this.tempSensor.status.temp, hum: this.humSensor.status.hum });
  };

  // === Motion Sensor ===
  public getMotionSensorStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.motionSensor.status);
  };

  public setMotionSensorStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    const state = req.body.state === "detected" ? "detected" : "notDetected";
    this.motionSensor.setStatus(state);
    this.logger.dir(this.motionSensor.status, { depth: 3 });
    res.json(this.motionSensor.status);
  };

  // === Floor Light (General Lighting) ===
  public getFloorLightStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.floorLight.status);
  };

  public setFloorLightStatus = (newStatus: FloorLightStatus): void => {
    this.floorLight.setStatus(newStatus);
    this.logger.dir(this.floorLight.status, { depth: 3 });
  };

  public setFloorLightStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    const state = req.body.state === "on" ? "on" : "off";
    let color = req.body.color;
    if (color !== "lamp" && color !== "white" && color !== "neutralWhite") {
      color = "lamp";
    }

    this.setFloorLightStatus({
      state: state,
      color: color,
    });
    res.json(this.floorLight.status);
  };

  public setFloorLightStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    return this.floorLight.setStatusFromEchoNet(propertyCodeText, newValue);
  };

  // === Shutter ===
  public getShutterStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.shutter.status);
  };

  public setShutterStatus = (newStatus: Partial<ShutterStatus>): void => {
    this.shutter.setStatus(newStatus);
    this.logger.dir(this.shutter.status, { depth: 3 });
  };

  public setShutterStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    const move = req.body.move;
    this.setShutterStatus({ move });
    res.json(this.shutter.status);
  };

  public setShutterStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    return this.shutter.setStatusFromEchoNet(propertyCodeText, newValue);
  };

  // === Timer for animated devices ===
  private timer = (): void => {
    this.shutter.tick();

    if (this.bathWaterHeater.enabled) {
      this.bathWaterHeater.tick();
    }
  };

  // === Door/Switch ===
  public getDoorStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.door.status);
  };

  public setDoorStatus = (newStatus: DoorStatus): void => {
    this.door.setStatus(newStatus);
    // Sync switch with door lock state
    this.switchDevice.syncWithDoorLock(this.door.status.lockState);
    this.logger.dir(this.door.status, { depth: 3 });
  };

  public setDoorStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    const state = req.body.state === "closed" ? "closed" : "opened";
    const lockState = req.body.lockState === "unlocked" ? "unlocked" : "locked";

    this.setDoorStatus({
      lockState: lockState,
      state: state,
    });

    res.json(this.door.status);
  };

  public setDoorStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    if ("026f01" in echoObject) {
      if (propertyCodeText === "e0") {
        const lockState = newValue[0] === 0x42 ? "unlocked" : "locked";
        this.setDoorStatus({ ...this.door.status, lockState });
        return true;
      }
    }
    if ("05fd01" in echoObject) {
      if (propertyCodeText === "80") {
        const lockState = newValue[0] === 0x30 ? "unlocked" : "locked";
        this.setDoorStatus({ ...this.door.status, lockState });
        return true;
      }
    }
    return false;
  };

  // === Bath Water Heater ===
  public getBathWaterHeaterStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.bathWaterHeater.status);
  };

  public setBathWaterHeaterStatus = (
    newStatus: Partial<BathWaterHeaterStatus>
  ): void => {
    this.bathWaterHeater.setStatus(newStatus);
    this.logger.dir(this.bathWaterHeater.status, { depth: 3 });
  };

  public setBathWaterHeaterStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    const newStatus: Partial<BathWaterHeaterStatus> = {
      auto: this.bathWaterHeater.status.auto,
      temp: this.bathWaterHeater.status.temp,
    };
    newStatus.auto = req.body.auto === "on" ? "on" : "off";

    if (30 <= req.body.temp && req.body.temp <= 60) {
      newStatus.temp = req.body.temp;
    }

    this.setBathWaterHeaterStatus(newStatus);
    res.json(this.bathWaterHeater.status);
  };

  public setBathWaterHeaterStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    return this.bathWaterHeater.setStatusFromEchoNet(propertyCodeText, newValue);
  };

  // === Air Conditioner ===
  public getAirConditionerStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.airConditioner.status);
  };

  public setAirConditionerStatus = (status: Partial<AirConditionerStatus>): void => {
    this.airConditioner.setStatus(status);
    this.logger.dir(this.airConditioner.status, { depth: 3 });
  };

  public setAirConditionerStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    this.setAirConditionerStatus({
      state: req.body.state,
      temp: req.body.temp,
      internalMode:
        req.body.state !== "off"
          ? req.body.state
          : this.airConditioner.status.internalMode,
    });
    res.json(this.airConditioner.status);
  };

  public setAirConditionerStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    return this.airConditioner.setStatusFromEchoNet(propertyCodeText, newValue);
  };

  // === EV Charger Discharger ===
  public getEvChargerDischargerStatus = (
    req: express.Request,
    res: express.Response
  ): void => {
    res.json(this.evChargerDischarger.status);
  };

  public setEvChargerDischargerStatus = (status: Partial<EvChargerDischargerStatus>): void => {
    this.evChargerDischarger.setStatus(status);
    this.logger.dir(this.evChargerDischarger.status, { depth: 3 });
  };

  public setEvChargerDischargerStatusFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    // Handle operation status (0x80) from REST API
    if (req.body.state !== undefined) {
      this.setEvChargerDischargerStatus({
        operationStatus: req.body.state === "on" ? "on" : "off",
      });
    }
    
    // Handle operation mode setting (0xDA) from REST API
    if (req.body.operationMode !== undefined) {
      const modeMap: Record<string, EvChargerDischargerStatus["operationModeSetting"]> = {
        "charge": "charge",
        "discharge": "discharge",
        "standby": "standby",
        "rapidCharge": "rapidCharge",
        "test": "test",
        "other": "other"
      };
      if (modeMap[req.body.operationMode]) {
        this.setEvChargerDischargerStatus({ 
          operationModeSetting: modeMap[req.body.operationMode],
          // Also update operation status when changing mode
          operationStatus: req.body.operationMode !== "standby" ? "on" : "off"
        });
      }
    }
    
    // Handle charging method (0xDC) from REST API
    if (req.body.chargingMethod !== undefined) {
      const chargingMethodMap: Record<string, EvChargerDischargerStatus["chargingMethod"]> = {
        "others": "others",
        "maxChargingPower": "maxChargingPower",
        "surplusPower": "surplusPower",
        "designatedPower": "designatedPower",
        "designatedCurrent": "designatedCurrent",
        "designatedPurchasingPower": "designatedPurchasingPower"
      };
      if (chargingMethodMap[req.body.chargingMethod]) {
        this.setEvChargerDischargerStatus({ 
          chargingMethod: chargingMethodMap[req.body.chargingMethod]
        });
      }
    }
    
    // Handle discharging method (0xDD) from REST API
    if (req.body.dischargingMethod !== undefined) {
      const dischargingMethodMap: Record<string, EvChargerDischargerStatus["dischargingMethod"]> = {
        "others": "others",
        "maxDischargingPower": "maxDischargingPower",
        "loadFollowing": "loadFollowing",
        "designatedPower": "designatedPower",
        "designatedCurrent": "designatedCurrent",
        "designatedPurchasingPower": "designatedPurchasingPower"
      };
      if (dischargingMethodMap[req.body.dischargingMethod]) {
        this.setEvChargerDischargerStatus({ 
          dischargingMethod: dischargingMethodMap[req.body.dischargingMethod]
        });
      }
    }
    
    res.json(this.evChargerDischarger.status);
  };

  public setEvChargerDischargerStatusFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    return this.evChargerDischarger.setStatusFromEchoNet(propertyCodeText, newValue);
  };

  // === Status Aggregation ===
  public getStatus = (req: express.Request, res: express.Response): void => {
    const result = {
      light: this.ceilingLight.status,
      sensorMeter: { temp: this.tempSensor.status.temp, hum: this.humSensor.status.hum },
      motionSensor: this.motionSensor.status,
      floorLight: this.floorLight.status,
      shutter: this.shutter.status,
      door: this.door.status,
      bath: this.bathWaterHeater.status,
      airConditioner: this.airConditioner.status,
      distributionPanelMeterController: this.distributionPanelMeterController.status,
      evChargerDischarger: this.evChargerDischarger.status,
      echoObjects: [
        this.ceilingLight.echoStatus,
        this.tempSensor.echoStatus,
        this.humSensor.echoStatus,
        this.motionSensor.echoStatus,
        this.floorLight.echoStatus,
        this.shutter.echoStatus,
        this.door.echoStatus,
        this.switchDevice.echoStatus,
        this.bathWaterHeater.echoStatus,
        this.airConditioner.echoStatus,
        this.distributionPanelMeterController.echoStatus,
        this.evChargerDischarger.echoStatus,
      ]
    };
    res.json(result);
  };

  private setCommonProperties = (echoObject: EchoObject, id: string = ""): void => {
    for (const key in echoObject) {
      echoObject[key]["81"] = [0x00]; //設置場所
      echoObject[key]["82"] = [0x00, 0x00, 0x50, 0x01]; //規格 Version 情報
      echoObject[key]["88"] = [0x42]; //異常発生状態
      echoObject[key]["8a"] = [0xff, 0xff, 0xff]; //メーカーコード

      if (id !== "") {
        echoObject[key]["83"] = EL.toHexArray(id);
      }

      const getProperties = [0x00];
      for (const propertyNo in echoObject[key]) {
        if (propertyNo.match(/[0-9A-Fa-f]{2}/) !== null) {
          getProperties.push(parseInt(propertyNo, 16));
        }
      }
      getProperties.push(0x9f); //Getプロパティマップ

      getProperties[0] = getProperties.length - 1;
      if (getProperties.length <= 16) {
        echoObject[key]["9f"] = getProperties;
      } else {
        const getPropertiesPart2 = new Array(17);
        getPropertiesPart2.fill(0x00);
        getPropertiesPart2[0] = getProperties.length - 1;
        
        for (let i = 1; i < getProperties.length; i++) {
          const propCode = getProperties[i];
          
          // The lower nibble (0-15) determines the byte. 
          // We add 1 because index 0 is used for the property count.
          const byteIndex = (propCode & 0x0F) + 1; 
          
          // The upper nibble shifted down (8-15) minus 8 determines the bit (0-7).
          const bit = ((propCode >> 4) & 0x0F) - 8; 
          
          // Ensure we don't accidentally shift out of bounds for weird properties
          if (bit >= 0 && bit <= 7) {
            getPropertiesPart2[byteIndex] = getPropertiesPart2[byteIndex] | (0x01 << bit);
          }
        }
        echoObject[key]["9f"] = getPropertiesPart2;
      }
    }
  };

  public setValueFromEchoNet = (
    echoObject: EchoObject,
    propertyCodeText: string,
    newValue: number[]
  ): boolean => {
    for (const eoj in echoObject) {
      const echoObjectObj = echoObject[eoj];

      const propertyCode = EL.toHexArray(propertyCodeText)[0];
      if (
        echoObjectObj["9e"].filter((_): boolean => _ === propertyCode)
          .length === 0
      ) {
        // 変更不許可
        continue;
      }

      if ("029101" in echoObject) {
        return this.setCellingLightStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("029001" in echoObject) {
        return this.setFloorLightStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("026301" in echoObject) {
        return this.setShutterStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("026f01" in echoObject) {
        return this.setDoorStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("05fd01" in echoObject) {
        return this.setDoorStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("026b01" in echoObject) {
        return this.setBathWaterHeaterStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("013001" in echoObject) {
        return this.setAirConditionerStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
      if ("05ff01" in echoObject) {
        return this.distributionPanelMeterController.setStatusFromEchoNet(
          propertyCodeText,
          newValue
        );
      }
      if ("027e01" in echoObject) {
        return this.setEvChargerDischargerStatusFromEchoNet(
          echoObject,
          propertyCodeText,
          newValue
        );
      }
    }
    return false;
  };

  public sendCommandCallback = (command: string, option: any = undefined): void => {
    // ignore
  };

  /**
   * Returns all device statuses as an array for ECHONET Lite integration.
   */
  public get allStatusList(): EchoStatus[] {
    return [
      this.ceilingLight.echoStatus,
      this.tempSensor.echoStatus,
      this.humSensor.echoStatus,
      this.motionSensor.echoStatus,
      this.floorLight.echoStatus,
      this.shutter.echoStatus,
      this.door.echoStatus,
      this.switchDevice.echoStatus,
      this.bathWaterHeater.echoStatus,
      this.airConditioner.echoStatus,
      this.distributionPanelMeterController.echoStatus,
      this.evChargerDischarger.echoStatus,
    ];
  }

  public postCommandsFromRestApi = (
    req: express.Request,
    res: express.Response
  ): void => {
    // urlの中の:commandを取得
    const command = req.params.command;
    if (command === "instanceListNotification") {
      this.sendCommandCallback("instanceListNotification");
      res.json({ result: "ok" });
      return;
    }
    if (command === "changedevices") {
      const option = req.body as { eoj: string, enabled: boolean }[];
      
      // Update device enabled states based on the request
      for (const device of option) {
        this.updateDeviceEnabledFromApi(device.eoj, device.enabled);
      }
      
      this.sendCommandCallback(command, option);
      res.json({ result: "ok" });
      return;
    }
    res.status(400).send("Invalid Command");
  };

  /**
   * Update device enabled state from REST API.
   * This allows the UI toggles to actually enable/disable devices on the server side.
   */
  private updateDeviceEnabledFromApi(eoj: string, enabled: boolean): void {
    const eojLower = eoj.toLowerCase();
    
    if (eojLower === "026b01") {
      // Bath Water Heater
      this.bathWaterHeater.enabled = enabled;
      console.log(`[Controller] BathWaterHeater enabled: ${enabled}`);
    } else if (eojLower === "029101") {
      this.ceilingLight.enabled = enabled;
    } else if (eojLower === "001101") {
      this.tempSensor.enabled = enabled;
    } else if (eojLower === "001201") {
      this.humSensor.enabled = enabled;
    } else if (eojLower === "000701") {
      this.motionSensor.enabled = enabled;
    } else if (eojLower === "029001") {
      this.floorLight.enabled = enabled;
    } else if (eojLower === "026301") {
      this.shutter.enabled = enabled;
    } else if (eojLower === "026f01" || eojLower === "05fd01") {
      // Door and Switch share the same toggle
      this.door.enabled = enabled;
      this.switchDevice.enabled = enabled;
    } else if (eojLower === "013001") {
      this.airConditioner.enabled = enabled;
    } else if (eojLower === "05ff01") {
      this.distributionPanelMeterController.enabled = enabled;
    } else if (eojLower === "027e01") {
      this.evChargerDischarger.enabled = enabled;
    }
  }
}
