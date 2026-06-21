// Power Distribution Board Metering (Panasonic Smart Cosmo IP)
// Handles power distribution board meter functionality with 29-channel monitoring

const PowerDistributionBoardMetering = {
    state: { 
        operationStatus: "on", 
        faultStatus: "noFault", 
        currentLimit: 80,
        simplexPowerChannels: [] // Array of {channel, power} objects
    },

    // Pre-create debounce-wrapped API function (stored once, called repeatedly)
    _debouncedUpdatePdbmLimit: function() {
        return BaseDevice.createDebounce(300, async () => {
            const slider = document.getElementById('pdbm-limit-slider');
            await PowerDistributionBoardMetering.setPdbmLimit(parseInt(slider.value));
        });
    }(),

    updatePdbmLimitDisplay() {
        BaseDevice.updateSliderDisplay('pdbm-limit-slider', 'pdbm-limit-slider-val', '%');
    },

    async setPdbmLimit(limit) {
        try {
            await fetch("/api/powerDistributionBoardMetering", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentLimit: limit })
            });
            await App.getStatus();
        } catch (e) { console.error("PDBM limit error:", e); }
    },

    async togglePdbmStatus() {
        const newState = this.state.operationStatus === "on" ? "off" : "on";
        await this.setPdbmOperationStatus(newState);
    },

    async setPdbmOperationStatus(on) {
        try {
            await fetch("/api/powerDistributionBoardMetering", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operationStatus: on ? "on" : "off" })
            });
            await App.getStatus();
        } catch (e) { console.error("PDBM status error:", e); }
    },

    updatePdbmLimit() {
        this._debouncedUpdatePdbmLimit();
    },

    /**
     * Parse EPC 0xB7 list data into channel array
     * Format: [num_channels_low, num_channels_high, ch1(4bytes), ch2(4bytes), ...]
     */
    parseSimplexPowerList(b7Data) {
        if (!b7Data || b7Data.length < 3) return [];
        
        const numChannels = b7Data[0]; // Lower byte of channel count
        if (numChannels === 0) return [];
        
        const channels = [];
        let offset = 2; // Skip count bytes (2 bytes for channel range)
        
        // Each channel value is 4 bytes (big-endian signed integer)
        for (let i = 0; i < numChannels && offset + 3 < b7Data.length; i++) {
            const power = (b7Data[offset] << 24) | (b7Data[offset + 1] << 16) | 
                         (b7Data[offset + 2] << 8) | b7Data[offset + 3];
            
            // Convert from signed 32-bit to handle positive values only
            const powerValue = power > 0x7FFFFFFF ? power - 0x100000000 : power;
            
            channels.push({
                channel: i + 1,
                power: Math.max(0, powerValue) // Only show positive values
            });
            
            offset += 4;
        }
        
        return channels;
    },

    /**
     * Parse individual channel EPCs (0xD0-0xF9) into channel array
     */
    parseIndividualChannels(echoObject) {
        const channels = [];
        const eojData = echoObject?.["028701"];
        
        if (!eojData) return channels;

        // Channel EPC mapping: D0=Ch1, D1=Ch2, ..., D9=Ch10, E0=Ch17, ..., F9=Ch41
        const channelEpcMap = {
            'd0': 1, 'd1': 2, 'd2': 3, 'd3': 4, 'd4': 5, 'd5': 6,
            'd6': 7, 'd7': 8, 'd8': 9, 'd9': 10,
            'da': 11, 'db': 12, 'dc': 13, 'dd': 14, 'de': 15, 'df': 16,
            'e0': 17, 'e1': 18, 'e2': 19, 'e3': 20, 'e4': 21, 'e5': 22,
            'e6': 23, 'e7': 24, 'e8': 25, 'e9': 26,
            'ea': 27, 'eb': 28, 'ec': 29, 'ed': 30, 'ee': 31, 'ef': 32,
            'f0': 32, 'f1': 33, 'f2': 34, 'f3': 35, 'f4': 36, 'f5': 37,
            'f6': 38, 'f7': 39, 'f8': 40, 'f9': 41
        };

        for (const [epc, channelNum] of Object.entries(channelEpcMap)) {
            const epcData = eojData[epc];
            if (epcData && epcData.length >= 4) {
                const power = (epcData[0] << 24) | (epcData[1] << 16) | 
                             (epcData[2] << 8) | epcData[3];
                const powerValue = power > 0x7FFFFFFF ? power - 0x100000000 : power;
                
                channels.push({
                    channel: channelNum,
                    power: Math.max(0, powerValue)
                });
            }
        }

        return channels.sort((a, b) => a.channel - b.channel);
    },

    updateStatus() {
        const state = this.state;
        const operationStatus = state.operationStatus === "on" ? "ON" : "OFF";
        const faultStatus = state.faultStatus === "faultOccurred" ? "FAULT" : "NO FAULT";

        document.getElementById('pdbm-status-display').textContent = operationStatus;
        document.getElementById('pdbm-fault-display').textContent = faultStatus;

        // Update slider
        const slider = document.getElementById('pdbm-limit-slider');
        if (document.activeElement !== slider) {
            slider.value = state.currentLimit;
        }
        document.getElementById('pdbm-limit-slider-val').textContent = state.currentLimit + '%';

        // Update channel power display from App.currentStatus
        const currentStatus = App.currentStatus?.powerDistributionBoardMetering;
        if (currentStatus) {
            // Try to get channel data from echoObject if available
            let channels = state.simplexPowerChannels || [];
            
            // If we have simplexPowerChannels in state, use them
            if (channels.length === 0 && currentStatus.echoObject) {
                channels = this.parseIndividualChannels(currentStatus.echoObject);
            }
            
            // Also try parsing from B7 list if available
            if (channels.length === 0 && currentStatus.b7List) {
                channels = this.parseSimplexPowerList(currentStatus.b7List);
            }

            this.renderChannelGrid(channels);
        }
    },

    /**
     * Render channel power values in a grid display
     */
    renderChannelGrid(channels) {
        let container = document.getElementById('pdbm-channels-container');
        
        if (!container) {
            // Create container if it doesn't exist
            const controlSection = document.querySelector('#card-powerDistributionBoardMetering .control-section:last-child');
            if (controlSection) {
                container = document.createElement('div');
                container.id = 'pdbm-channels-container';
                container.className = 'channel-grid';
                controlSection.parentNode.insertBefore(container, controlSection);
            }
        }

        if (!container) return;

        // Get active channels (power > 0) for summary
        const activeChannels = channels.filter(ch => ch.power > 0);
        const totalPower = channels.reduce((sum, ch) => sum + ch.power, 0);

        // Update or create summary display
        let summaryDiv = document.getElementById('pdbm-channel-summary');
        if (!summaryDiv) {
            summaryDiv = document.createElement('div');
            summaryDiv.id = 'pdbm-channel-summary';
            summaryDiv.style.cssText = 'display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-dark);border-radius:6px;margin-bottom:8px;font-size:12px;';
            
            const totalSpan = document.createElement('span');
            totalSpan.id = 'pdbm-total-power';
            totalSpan.style.cssText = 'color:var(--accent-blue)';
            
            const activeSpan = document.createElement('span');
            activeSpan.id = 'pdbm-active-channels';
            
            summaryDiv.appendChild(totalSpan);
            summaryDiv.appendChild(activeSpan);
            container.parentNode.insertBefore(summaryDiv, container.nextSibling);
        }

        document.getElementById('pdbm-total-power').textContent = `Total: ${totalPower}W`;
        document.getElementById('pdbm-active-channels').textContent = `Active: ${activeChannels.length}/${channels.length} channels`;

        // Build channel grid HTML
        let html = '';
        for (let i = 0; i < Math.min(channels.length, 29); i++) {
            const ch = channels[i];
            const power = ch?.power || 0;
            const isActive = power > 0;
            
            html += `<div class="channel-cell ${isActive ? 'active' : ''}" title="Channel ${ch.channel}: ${power}W">
                <div class="channel-number">CH${ch.channel}</div>
                <div class="channel-power">${power}W</div>
            </div>`;
        }
        
        container.innerHTML = html;
    },

    toggleDevice(enabled) {
        const card = document.getElementById('card-powerDistributionBoardMetering');
        if (card) {
            card.classList.toggle('disabled', !enabled);
        }
    }
};