// Bath Water Heater Device Controller
// Handles electric water heater functionality

const BathWaterHeater = {
    state: { state: "empty", auto: "off", temp: 40, waterLevel: 0, timerRunning: false },

    // Pre-create debounce-wrapped API function (stored once, called repeatedly)
    _debouncedSendTemp: function() {
        return BaseDevice.createDebounce(300, async () => {
            try {
                await fetch("/api/bathWaterHeater", {
                    method: "POST",
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        auto: BathWaterHeater.state.auto, 
                        temp: parseInt(document.getElementById('bath-temp-slider').value) 
                    })
                });
                await App.getStatus();
            } catch (e) { console.error("Bath temp error:", e); }
        });
    }(),

    updateTempDisplay() {
        BaseDevice.updateSliderDisplay('bath-temp-slider', 'bath-temp-slider-val', '°C');
        this._debouncedSendTemp();
    },

    async setBathAuto(on) {
        try {
            await fetch("/api/bathWaterHeater", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    auto: on ? "on" : "off", 
                    temp: this.state.temp 
                })
            });
            await App.getStatus();
        } catch (e) { console.error("Bath auto error:", e); }
    },

    updateStatus() {
        const state = this.state.state.charAt(0).toUpperCase() + this.state.state.slice(1);
        const temp = this.state.temp;
        
        document.getElementById('bath-state-display').textContent = state;
        document.getElementById('bath-temp-display').textContent = temp;

        // Update water level progress bar
        const waterLevel = this.state.waterLevel || 0;
        const progressBar = document.getElementById('bath-progress');
        progressBar.style.width = waterLevel + '%';
        
        // Change progress bar color based on state
        if (this.state.timerRunning) {
            progressBar.style.background = 'linear-gradient(90deg, #3b82f6, #06b6d4)';
            progressBar.style.animation = 'pulse 1s infinite';
        } else if (waterLevel >= 100) {
            progressBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            progressBar.style.animation = 'none';
        } else if (waterLevel > 0 && this.state.auto === 'off') {
            progressBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
            progressBar.style.animation = 'none';
        } else {
            progressBar.style.background = 'linear-gradient(90deg, var(--accent-blue), var(--accent-cyan))';
            progressBar.style.animation = 'none';
        }

        // Update auto mode buttons
        document.getElementById('bath-auto-on').classList.toggle('active', this.state.auto === 'on');
        document.getElementById('bath-auto-off').classList.toggle('active', this.state.auto === 'off');

        // Update slider
        const slider = document.getElementById('bath-temp-slider');
        if (document.activeElement !== slider) {
            slider.value = temp;
        }
        document.getElementById('bath-temp-slider-val').textContent = temp + '°C';
    },

    toggleDevice(enabled) {
        const card = document.getElementById('card-bath');
        if (card) {
            card.classList.toggle('disabled', !enabled);
        }
    }
};