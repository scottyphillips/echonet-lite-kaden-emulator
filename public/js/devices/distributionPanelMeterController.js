// Distribution Panel Meter Controller
// Handles power distribution meter functionality

const DistributionPanelMeterController = {
    state: { 
        operationStatus: "on", 
        faultStatus: "noFault", 
        instantaneousPowerConsumption: 0, 
        cumulativeElectricEnergy: 0, 
        currentLimit: 100 
    },

    // Pre-create debounce-wrapped API function (stored once, called repeatedly)
    _debouncedUpdateDpmlLimit: function() {
        return BaseDevice.createDebounce(300, async () => {
            const slider = document.getElementById('dpm-limit-slider');
            await DistributionPanelMeterController.setDpmlLimit(parseInt(slider.value));
        });
    }(),

    updateDpmlLimitDisplay() {
        BaseDevice.updateSliderDisplay('dpm-limit-slider', 'dpm-limit-slider-val', '%');
    },

    async setDpmlLimit(limit) {
        try {
            await fetch("/api/distributionPanelMeterController", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentLimit: limit })
            });
            await App.getStatus();
        } catch (e) { console.error("DPM limit error:", e); }
    },

    async toggleDpmlStatus() {
        const newState = this.state.operationStatus === "on" ? "off" : "on";
        await this.setDpmlOperationStatus(newState);
    },

    async setDpmlOperationStatus(on) {
        try {
            await fetch("/api/distributionPanelMeterController", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operationStatus: on ? "on" : "off" })
            });
            await App.getStatus();
        } catch (e) { console.error("DPM status error:", e); }
    },

    updateDpmlLimit() {
        this._debouncedUpdateDpmlLimit();
    },

    updateStatus() {
        const state = this.state;
        const operationStatus = state.operationStatus === "on" ? "ON" : "OFF";
        const faultStatus = state.faultStatus === "faultOccurred" ? "FAULT" : "NO FAULT";
        const powerConsumption = state.instantaneousPowerConsumption;
        const energyConsumption = state.cumulativeElectricEnergy / 1000; // Convert from Wh to kWh
        const currentLimit = state.currentLimit;

        document.getElementById('dpm-status-display').textContent = operationStatus;
        document.getElementById('dpm-fault-display').textContent = faultStatus;
        document.getElementById('dpm-power-display').textContent = powerConsumption;
        document.getElementById('dpm-energy-display').textContent = energyConsumption.toFixed(3);

        // Update slider
        const slider = document.getElementById('dpm-limit-slider');
        if (document.activeElement !== slider) {
            slider.value = currentLimit;
        }
        document.getElementById('dpm-limit-slider-val').textContent = currentLimit + '%';
    },

    toggleDevice(enabled) {
        const card = document.getElementById('card-distributionPanelMeterController');
        if (card) {
            card.classList.toggle('disabled', !enabled);
        }
    }
};