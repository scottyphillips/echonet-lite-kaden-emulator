// Solar Power Generation Device Controller
// Handles household solar power generation functionality

const SolarPowerGeneration = {
    state: { 
        operationStatus: "off",
        installationLocation: "Outdoor",
        faultStatus: "noFault",
        faultDescription: 0,
        instantaneousElectricPowerGeneration: 0,
        cumulativeElectricEnergyOfGeneration: 0,
        cumulativeElectricEnergySold: 0,
        ratedElectricPowerOfgeneration: 5000,
        systemInterconnectionType: "gridConnectionReverseFlowAcceptable",
        outputPowerRestraintStatus: "notRestraining"
    },

    async setSolarOperationStatus(on) {
        try {
            await fetch("/api/solarPowerGeneration", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operationStatus: on ? "on" : "off" })
            });
            await App.getStatus();
        } catch (e) { console.error("Solar Power error:", e); }
    },

    async setSolarPowerGeneration(power) {
        try {
            const currentStatus = this.state;
            await fetch("/api/solarPowerGeneration", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    operationStatus: currentStatus.operationStatus,
                    instantaneousElectricPowerGeneration: power
                })
            });
            await App.getStatus();
        } catch (e) { console.error("Solar Power generation error:", e); }
    },

    async setCumulativeEnergy(energy) {
        try {
            await fetch("/api/solarPowerGeneration", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    cumulativeElectricEnergyOfGeneration: energy
                })
            });
            await App.getStatus();
        } catch (e) { console.error("Solar cumulative energy error:", e); }
    },

    updateStatus() {
        const state = this.state;
        
        if (!state) return;
        
        // Operation status
        const statusEl = document.getElementById('solar-status-display');
        if (statusEl) statusEl.textContent = state.operationStatus === "on" ? "ON" : "OFF";
        
        // Fault status
        const faultEl = document.getElementById('solar-fault-display');
        if (faultEl) faultEl.textContent = state.faultStatus === "noFault" ? "OK" : "FAULT";
        
        // System interconnection type
        const sysTypeMap = {
            "gridConnectionReverseFlowAcceptable": "Grid (Reverse OK)",
            "independentOperation": "Independent",
            "gridConnectionReverseFlowNotAcceptable": "Grid (No Reverse)"
        };
        const systypeEl = document.getElementById('solar-systype-display');
        if (systypeEl) systypeEl.textContent = sysTypeMap[state.systemInterconnectionType] || "--";
        
        // Output power restraint status
        const restraintMap = {
            "ongoingRestraintControl": "Restraint (Control)",
            "ongoingRestraintExceptControl": "Restraint (Other)",
            "ongoingRestraintUnknown": "Restraint (Unknown)",
            "notRestraining": "Not Restraining",
            "unknown": "Unknown"
        };
        const restraintEl = document.getElementById('solar-restraint-display');
        if (restraintEl) restraintEl.textContent = restraintMap[state.outputPowerRestraintStatus] || "--";
        
        // Instantaneous power generation
        const powerEl = document.getElementById('solar-power-display');
        if (powerEl) powerEl.textContent = state.instantaneousElectricPowerGeneration;
        
        // Energy of generation (convert from 0.001kWh to kWh)
        const energyGenEl = document.getElementById('solar-energy-gen-display');
        if (energyGenEl) energyGenEl.textContent = (state.cumulativeElectricEnergyOfGeneration / 1000).toFixed(3);
        
        // Energy sold (convert from 0.001kWh to kWh)
        const energySoldEl = document.getElementById('solar-energy-sold-display');
        if (energySoldEl) energySoldEl.textContent = (state.cumulativeElectricEnergySold / 1000).toFixed(3);

        // Rated power
        const ratedPowerEl = document.getElementById('solar-rated-power-display');
        if (ratedPowerEl) ratedPowerEl.textContent = state.ratedElectricPowerOfgeneration;
    },

    toggleDevice(enabled) {
        const card = document.getElementById('card-solarPowerGeneration');
        if (card) {
            card.classList.toggle('disabled', !enabled);
        }
    }
};