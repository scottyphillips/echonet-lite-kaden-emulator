// ============================================================
// ECHONET Lite Controller - Main Application
// ============================================================

const App = {
    // Device EOJ mapping for the device manager modal
    deviceEojMap: [
        { key: 'ceilingLight',                    eoj: '029101', name: 'Ceiling Light' },
        { key: 'tempSensor',                      eoj: '001101', name: 'Temperature Sensor' },
        { key: 'humSensor',                       eoj: '001201', name: 'Humidity Sensor' },
        { key: 'motionSensor',                    eoj: '000701', name: 'Motion Sensor' },
        { key: 'floorLight',                      eoj: '029001', name: 'Floor Light' },
        { key: 'shutter',                         eoj: '026301', name: 'Shutter' },
        { key: 'door',                            eoj: '026f01', name: 'Entrance Door', linkedEojs: ['05fd01'] },
        { key: 'bath',                            eoj: '026b01', name: 'Bath Water Heater' },
        { key: 'airConditioner',                  eoj: '013001', name: 'Air Conditioner' },
        { key: 'distributionPanelMeterController',eoj: '05ff01', name: 'Distribution Panel Meter Controller' },
        { key: 'evChargerDischarger',             eoj: '027e01', name: 'EV Charger Discharger' },
        { key: 'solarPowerGeneration',            eoj: '027901', name: 'Solar Power Generation' },
        { key: 'powerDistributionBoardMetering',  eoj: '028701', name: 'Power Distribution Board Metering' },
    ],

    // ============================================================
    // API Functions
    // ============================================================

    async sendInstanceListNotification() {
        try {
            await fetch('/api/commands/instanceListNotification', { method: 'POST' });
        } catch (e) {
            console.error('Failed to send instance list notification:', e);
        }
    },

    // Card toggle — fires immediately when the user flips the switch on a card
    async toggleDevice(deviceKey, eojCode, enabled) {
        const card = document.getElementById('card-' + deviceKey);
        if (card) card.classList.toggle('disabled', !enabled);
        await this.saveDeviceSettings();
    },

    // Collect enabled state from all card toggles and POST to server
    async saveDeviceSettings() {
        const echoObjects = [];
        const processedEojs = new Set();

        for (const device of this.deviceEojMap) {
            const card   = document.getElementById('card-' + device.key);
            const toggle = card?.querySelector('.card-toggle input');
            const enabled = toggle ? toggle.checked : true;

            echoObjects.push({ eoj: device.eoj, enabled });
            processedEojs.add(device.eoj.toLowerCase());

            for (const linkedEoj of device.linkedEojs ?? []) {
                if (!processedEojs.has(linkedEoj.toLowerCase())) {
                    echoObjects.push({ eoj: linkedEoj, enabled });
                    processedEojs.add(linkedEoj.toLowerCase());
                }
            }
        }

        try {
            const res = await fetch('/api/commands/changedevices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(echoObjects),
            });
            if (res.ok) {
                BaseDevice.showMessage('Devices updated successfully', 'success');
            } else {
                BaseDevice.showMessage('Failed to update devices', 'error');
            }
        } catch (e) {
            console.error('Save device settings error:', e);
            BaseDevice.showMessage('Error saving device settings', 'error');
        }
    },

    // ============================================================
    // Device Manager Modal
    // ============================================================

    openDeviceManager() {
        const container = document.getElementById('deviceListContainer');
        container.innerHTML = '';

        for (const device of this.deviceEojMap) {
            const card    = document.getElementById('card-' + device.key);
            const toggle  = card?.querySelector('.card-toggle input');
            const enabled = toggle ? toggle.checked : true;

            const item = document.createElement('div');
            item.className = 'device-list-item';
            item.innerHTML = `
                <div class="device-list-info">
                    <div>
                        <div class="device-list-name">${device.name}</div>
                        <div class="device-list-eoj">${device.eoj}</div>
                    </div>
                </div>
                <label class="card-toggle">
                    <input type="checkbox" id="modal-toggle-${device.eoj}" ${enabled ? 'checked' : ''}
                           onchange="App.syncModalToggle('${device.key}', '${device.eoj}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>`;
            container.appendChild(item);
        }

        document.getElementById('deviceManagerModal').classList.add('active');
    },

    closeDeviceManager() {
        document.getElementById('deviceManagerModal').classList.remove('active');
    },

    // Sync a modal toggle change back to the card toggle, then save
    syncModalToggle(deviceKey, eoj, checked) {
        const card   = document.getElementById('card-' + deviceKey);
        const toggle = card?.querySelector('.card-toggle input');
        if (toggle) toggle.checked = checked;
        this.toggleDevice(deviceKey, eoj, checked);
    },

    // ============================================================
    // Status Polling
    // ============================================================

    async getStatus() {
        try {
            const res = await fetch('/api/status');
            if (!res.ok) return;
            const status = await res.json();

            // Update device module state
            if (status.airConditioner)                  { AirConditioner.state                  = status.airConditioner; }
            if (status.light)                           { Lighting.ceilingLight                 = status.light; }
            if (status.floorLight)                      { Lighting.floorLight                   = status.floorLight; }
            if (status.sensorMeter)                     { Sensors.tempSensor                    = status.sensorMeter; }
            if (status.motionSensor)                    { Sensors.motionSensor                  = status.motionSensor; }
            if (status.shutter)                         { Shutter.state                         = status.shutter; }
            if (status.door)                            { Door.state                            = status.door; }
            if (status.bath)                            { BathWaterHeater.state                 = status.bath; }
            if (status.distributionPanelMeterController){ DistributionPanelMeterController.state= status.distributionPanelMeterController; }
            if (status.evChargerDischarger)             { EvChargerDischarger.state             = status.evChargerDischarger; }
            if (status.powerDistributionBoardMetering)  { PowerDistributionBoardMetering.state  = status.powerDistributionBoardMetering; }
            if (status.solarPowerGeneration)            { SolarPowerGeneration.state            = status.solarPowerGeneration; }

            // Sync card toggle states from server's enabled flags
            if (status.echoObjects) {
                for (const echoObj of status.echoObjects) {
                    const device = this.deviceEojMap.find(d => d.eoj === echoObj.eoj);
                    if (!device) continue;
                    const card   = document.getElementById('card-' + device.key);
                    const toggle = card?.querySelector('.card-toggle input');
                    if (toggle && toggle.checked !== echoObj.enabled) {
                        toggle.checked = echoObj.enabled;
                        card?.classList.toggle('disabled', !echoObj.enabled);
                    }
                }
            }

            // Re-render all device displays
            try { AirConditioner.updateStatus(); }                  catch(e) { console.error('AC:', e); }
            try { Lighting.updateCeilingLightStatus(); }            catch(e) { console.error('CL:', e); }
            try { Lighting.updateFloorLightStatus(); }              catch(e) { console.error('FL:', e); }
            try { Sensors.updateSensorStatus(); }                   catch(e) { console.error('Sensors:', e); }
            try { Sensors.updateMotionStatus(); }                   catch(e) { console.error('Motion:', e); }
            try { Shutter.updateStatus(); }                         catch(e) { console.error('Shutter:', e); }
            try { Door.updateStatus(); }                            catch(e) { console.error('Door:', e); }
            try { BathWaterHeater.updateStatus(); }                 catch(e) { console.error('Bath:', e); }
            try { DistributionPanelMeterController.updateStatus(); }catch(e) { console.error('DPM:', e); }
            try { EvChargerDischarger.updateStatus(); }             catch(e) { console.error('EVC:', e); }
            try { SolarPowerGeneration.updateStatus(); }            catch(e) { console.error('Solar:', e); }
            try { PowerDistributionBoardMetering.updateStatus(); }  catch(e) { console.error('PDBM:', e); }

            document.getElementById('connectionDot').style.backgroundColor = 'var(--accent-green)';
            document.getElementById('connectionStatus').textContent = 'Connected';

        } catch (e) {
            document.getElementById('connectionDot').style.backgroundColor = 'var(--accent-red)';
            document.getElementById('connectionStatus').textContent = 'Disconnected';
        }
    },

    // ============================================================
    // Initialize
    // ============================================================

    init() {
        this.getStatus();
        setInterval(() => this.getStatus(), 1000);
    },
};

// Expose to global scope for inline onclick handlers
window.sendInstanceListNotification = () => App.sendInstanceListNotification();
window.toggleDevice    = (key, eoj, en) => App.toggleDevice(key, eoj, en);
window.saveDeviceSettings = ()          => App.saveDeviceSettings();
window.openDeviceManager  = ()          => App.openDeviceManager();
window.closeDeviceManager = ()          => App.closeDeviceManager();

window.setACMode            = (mode)   => AirConditioner.setMode(mode);
window.updateACTempDisplay  = ()       => AirConditioner.updateTempDisplay();

window.toggleCeilingLight   = ()       => Lighting.toggleCeilingLight();
window.setCeilingLight       = (on)    => Lighting.setCeilingLight(on);
window.setFloorColor         = (color) => Lighting.setFloorColor(color);
window.cycleFloorLight       = ()      => Lighting.cycleFloorLight();

window.updateTempDisplay    = ()       => Sensors.updateTempDisplay();
window.updateHumDisplay     = ()       => Sensors.updateHumDisplay();
window.setMotion            = (det)    => Sensors.setMotion(det);

window.setShutter           = (move)   => Shutter.setShutter(move);

window.setDoor              = (state)  => Door.setDoor(state);
window.setDoorLock          = (ls)     => Door.setDoorLock(ls);

window.updateBathTempDisplay = ()      => BathWaterHeater.updateTempDisplay();
window.setBathAuto           = (on)    => BathWaterHeater.setBathAuto(on);

window.updateDpmlLimitDisplay = ()     => DistributionPanelMeterController.updateDpmlLimitDisplay();
window.updateDpmlLimit        = ()     => DistributionPanelMeterController.updateDpmlLimit();
window.toggleDpmlStatus       = ()     => DistributionPanelMeterController.toggleDpmlStatus();
window.setDpmlOperationStatus = (on)   => DistributionPanelMeterController.setDpmlOperationStatus(on);

window.setEvChargerMode   = (mode)     => EvChargerDischarger.setEvChargerMode(mode);
window.setEvChargerMethod = (method)   => EvChargerDischarger.setEvChargerMethod(method);

window.setSolarOperationStatus = (on)  => SolarPowerGeneration.setSolarOperationStatus(on);

window.updatePdbmLimitDisplay  = ()    => PowerDistributionBoardMetering.updatePdbmLimitDisplay();
window.updatePdbmLimit         = ()    => PowerDistributionBoardMetering.updatePdbmLimit();
window.togglePdbmStatus        = ()    => PowerDistributionBoardMetering.togglePdbmStatus();
window.setPdbmOperationStatus  = (on)  => PowerDistributionBoardMetering.setPdbmOperationStatus(on);

document.addEventListener('DOMContentLoaded', () => App.init());

// ============================================================
// Card Drag-and-Drop Ordering
// ============================================================

const CardOrder = {
    STORAGE_KEY: 'echonet-card-order',
    draggingEl: null,

    // Persist current DOM order to localStorage
    save() {
        const grid  = document.getElementById('deviceGrid');
        const order = [...grid.querySelectorAll('.device-card')].map(c => c.id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(order));
    },

    // Restore saved order on page load
    restore() {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return;
        let order;
        try { order = JSON.parse(raw); } catch { return; }

        const grid = document.getElementById('deviceGrid');
        for (const id of order) {
            const card = document.getElementById(id);
            if (card) grid.appendChild(card); // moves to end in saved sequence
        }
    },

    init() {
        const grid = document.getElementById('deviceGrid');

        grid.addEventListener('dragstart', e => {
            const card = e.target.closest('.device-card');
            if (!card) return;
            this.draggingEl = card;
            // Defer class add so the browser snapshot is taken first
            requestAnimationFrame(() => card.classList.add('dragging'));
            e.dataTransfer.effectAllowed = 'move';
        });

        grid.addEventListener('dragend', () => {
            this.draggingEl?.classList.remove('dragging');
            grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            this.draggingEl = null;
            this.save();
        });

        grid.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const target = e.target.closest('.device-card');
            if (!target || target === this.draggingEl) return;

            // Determine insert position: before or after target based on pointer midpoint
            const rect    = target.getBoundingClientRect();
            const midX    = rect.left + rect.width  / 2;
            const midY    = rect.top  + rect.height / 2;
            const after   = e.clientY > midY || (Math.abs(e.clientY - midY) < 10 && e.clientX > midX);

            grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            target.classList.add('drag-over');

            if (after) {
                target.after(this.draggingEl);
            } else {
                target.before(this.draggingEl);
            }
        });

        grid.addEventListener('dragleave', e => {
            const target = e.target.closest('.device-card');
            target?.classList.remove('drag-over');
        });

        grid.addEventListener('drop', e => {
            e.preventDefault();
            grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        // Prevent card-body interactive elements from triggering drags
        grid.addEventListener('mousedown', e => {
            if (!e.target.closest('.card-header')) {
                // Temporarily disable dragging when clicking inside card body
                const card = e.target.closest('.device-card');
                if (card) {
                    card.draggable = false;
                    const re = () => { card.draggable = true; card.removeEventListener('mouseup', re); };
                    card.addEventListener('mouseup', re);
                    document.addEventListener('mouseup', re, { once: true });
                }
            }
        });

        this.restore();
    },
};

document.addEventListener('DOMContentLoaded', () => CardOrder.init());