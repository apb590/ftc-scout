/**
 * ui.js - User Interface Controller Module
 * Handles visual styling, slide transitions, modal behaviors, toast alerts,
 * and rendering IndexedDB/GSheet data feeds.
 */

(function() {
  class ScoutingUI {
    constructor() {
      this.toastTimeout = null;
      this.activeFlaggedRecords = [];
      
      this.phaseIds = ["step-setup", "step-auton", "step-teleop", "step-review"];
      this.currentPhaseIndex = 0;
    }

    /**
     * Cache element references once DOM has fully loaded
     */
    init() {
      this.toastBanner = document.getElementById("toast-notification");
      this.toastMsg = document.getElementById("toast-message");
      this.historyListContainer = document.getElementById("history-list-container");
      this.auditListContainer = document.getElementById("audit-list-container");
      this.progressLineFill = document.getElementById("phase-progress-line-fill");
      
      this.qrCanvas = document.getElementById("qr-display-canvas");
      this.qrRecordIdField = document.getElementById("qr-record-id-field");
      this.qrModal = document.getElementById("qr-modal");
      this.qrModalTitle = document.getElementById("qr-modal-title");
      
      this.redBtn = document.getElementById("alliance-btn-red");
      this.blueBtn = document.getElementById("alliance-btn-blue");
      this.allianceInput = document.getElementById("alliance");

      this.phaseSteps = document.querySelectorAll(".phase-step");
      this.progressSteps = document.querySelectorAll(".progress-step");
    }

    /**
     * Show a bottom-right toast notification
     */
    showToast(message) {
      if (!this.toastBanner || !this.toastMsg) return;
      clearTimeout(this.toastTimeout);
      this.toastMsg.textContent = message;
      this.toastBanner.classList.add("active");

      this.toastTimeout = setTimeout(() => {
        this.toastBanner.classList.remove("active");
      }, 3000);
    }

    /**
     * Sets the active alliance styling (red vs blue layout accent theme)
     */
    setAllianceStyle(alliance) {
      if (alliance === "Red") {
        document.body.classList.remove("alliance-blue");
        document.body.classList.add("alliance-red");
        if (this.redBtn) this.redBtn.classList.add("active");
        if (this.blueBtn) this.blueBtn.classList.remove("active");
      } else {
        document.body.classList.remove("alliance-red");
        document.body.classList.add("alliance-blue");
        if (this.blueBtn) this.blueBtn.classList.add("active");
        if (this.redBtn) this.redBtn.classList.remove("active");
      }
      if (this.allianceInput) this.allianceInput.value = alliance;
      
      // Auto-save form progress draft
      if (window.formManager) {
        window.formManager.triggerAutosave();
      }
    }

    /**
     * Auto-selects alliance based on schedule details
     */
    updateAllianceColorForTeam(selectedTeam, matchDetails) {
      if (!selectedTeam || !matchDetails) return;
      const teamNum = parseInt(selectedTeam);
      if (teamNum === matchDetails.red1 || teamNum === matchDetails.red2) {
        this.setAllianceStyle("Red");
      } else if (teamNum === matchDetails.blue1 || teamNum === matchDetails.blue2) {
        this.setAllianceStyle("Blue");
      }
    }

    /**
     * Step-by-Step Phase Routing Navigation
     */
    navigateToPhase(phaseId) {
      const targetIndex = this.phaseIds.indexOf(phaseId);
      if (targetIndex === -1) return;

      // Validate setup phase inputs if moving past setup step
      if (this.currentPhaseIndex === 0 && targetIndex > 0) {
        if (window.formManager && !window.formManager.validateSetupPhase()) return;
      }

      // Deactivate current steps
      this.phaseSteps.forEach(step => step.classList.remove("active"));
      this.progressSteps.forEach(step => step.classList.remove("active"));

      // Activate target step
      const targetStep = document.getElementById(phaseId);
      if (targetStep) {
        targetStep.classList.add("active");
      }

      // Set progress indicators states
      for (let i = 0; i <= targetIndex; i++) {
        const indicator = document.querySelector(`.progress-step[data-step="${this.phaseIds[i]}"]`);
        if (indicator) {
          if (i === targetIndex) {
            indicator.classList.add("active");
            indicator.classList.remove("completed");
          } else {
            indicator.classList.add("completed");
          }
        }
      }

      // Clean up forward steps
      for (let i = targetIndex + 1; i < this.phaseIds.length; i++) {
        const indicator = document.querySelector(`.progress-step[data-step="${this.phaseIds[i]}"]`);
        if (indicator) {
          indicator.classList.remove("active");
          indicator.classList.remove("completed");
        }
      }

      // Animate progress connecting line fill width
      if (this.progressLineFill) {
        const percentage = (targetIndex / (this.phaseIds.length - 1)) * 100;
        this.progressLineFill.style.width = `${percentage}%`;
      }

      this.currentPhaseIndex = targetIndex;

      // Scroll to top of screen
      window.scrollTo({ top: 0, behavior: "smooth" });

      // Redraw Auton map canvas if setup screen is active
      if (phaseId === "step-setup" && window.canvasInstance) {
        setTimeout(() => window.canvasInstance.draw(), 50);
      }
    }

    /**
     * Render the list of final match submissions saved in the local DB
     */
    async renderHistoryList() {
      if (!this.historyListContainer) return;

      try {
        const records = await window.dbManager.getAllRecords();

        if (records.length === 0) {
          this.historyListContainer.innerHTML = `<div class="history-empty">No scout records have been logged in the local offline database yet.</div>`;
          return;
        }

        let listHtml = "";
        records.forEach(rec => {
          const syncBadgeClass = rec.synced === 1 ? "synced" : "pending";
          const syncBadgeText = rec.synced === 1 ? "Synced" : "Pending";
          const allianceDotClass = rec.alliance && rec.alliance.toLowerCase() === "red" ? "red" : "blue";

          listHtml += `
            <div class="history-item" data-id="${rec.id}">
              <div class="history-item-meta">
                <div class="history-team">
                  <span class="alliance-dot ${allianceDotClass}"></span>
                  Team ${rec.teamno}
                </div>
                <div class="history-match">
                  Match ${rec.matchno} &bull; Pos: ${rec.robotpos || "Unknown"}
                </div>
              </div>
              
              <div class="history-item-actions">
                <span class="sync-badge ${syncBadgeClass}">${syncBadgeText}</span>
                <button class="history-btn view-qr-btn" data-id="${rec.id}" title="Show Offline QR Code">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </button>
              </div>
            </div>
          `;
        });

        this.historyListContainer.innerHTML = listHtml;

        // Bind QR buttons clicks
        document.querySelectorAll(".view-qr-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const recId = btn.getAttribute("data-id");
            this.triggerQROverlay(recId);
          });
        });

      } catch (e) {
        console.error("[UI] Render history error:", e);
        this.historyListContainer.innerHTML = `<div class="history-empty" style="color:var(--color-error)">Failed to read history logs from IndexedDB.</div>`;
      }
    }

    /**
     * Generate and display the offline QR Code modal
     */
    async triggerQROverlay(recordId) {
      try {
        const records = await window.dbManager.getAllRecords();
        const targetRecord = records.find(r => r.id === recordId);

        if (!targetRecord) {
          alert("Scout record not found in IndexedDB!");
          return;
        }

        if (this.qrModalTitle) this.qrModalTitle.textContent = `Offline QR: Team ${targetRecord.teamno}`;
        if (this.qrRecordIdField) this.qrRecordIdField.value = recordId;

        if (window.syncManager) {
          const status = window.syncManager.generateQRForRecord(targetRecord, this.qrCanvas);
          if (status) {
            if (this.qrModal) this.qrModal.classList.add("active");
          } else {
            alert("QR Code Generation failed mathematically!");
          }
        }
      } catch (e) {
        console.error("[UI] Failed to generate QR overlay:", e);
      }
    }

    /**
     * Fetches and renders live discrepancy audits from Google Sheets
     */
    async renderAuditLogsList() {
      if (!this.auditListContainer) return;

      if (!navigator.onLine) {
        this.auditListContainer.innerHTML = `<div class="history-empty" style="color:var(--color-error)">Browser is Offline! Live sheet discrepancies cannot be queried while network is down.</div>`;
        return;
      }

      if (window.syncManager) {
        window.syncManager.fetchAndCacheQualSchedule();
      }

      this.auditListContainer.innerHTML = `<div class="history-empty animate-pulse">Querying Google Sheets for points discrepancies... Please wait.</div>`;

      try {
        const endpoint = window.syncManager.getSyncEndpoint();
        const response = await fetch(`${endpoint}?action=getFlaggedRecords`, { mode: 'cors', redirect: 'follow' });

        if (!response.ok) {
          throw new Error("Failed to connect to Google Sheet API. Status: " + response.status);
        }

        this.activeFlaggedRecords = await response.json();

        if (this.activeFlaggedRecords.length === 0) {
          this.auditListContainer.innerHTML = `<div class="history-empty" style="color:hsl(140, 70%, 40%)">✓ All scouted alliance points are aligned with official FIRST scores! Excellent scouting accuracy.</div>`;
          return;
        }

        let listHtml = "";
        this.activeFlaggedRecords.forEach(rec => {
          const allianceDotClass = rec.alliance && rec.alliance.toLowerCase() === "red" ? "red" : "blue";
          const deltaLabelClass = rec.delta > 0 ? "text-error" : "text-success";
          const deltaSymbol = rec.delta > 0 ? "+" : "";

          listHtml += `
            <div class="history-item" style="flex-direction: column; align-items: stretch; gap: 8px; padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="history-team" style="font-family:'Outfit'; font-weight:bold;">
                  <span class="alliance-dot ${allianceDotClass}"></span>
                  Team ${rec.teamno} &bull; Match ${rec.matchno}
                </div>
                <span class="sync-badge pending" style="background:rgba(239, 68, 68, 0.15); color:#ef4444; border:1px solid #ef4444;">DISCREPANCY</span>
              </div>
              
              <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.4;">
                <strong>Scouter:</strong> ${rec.username}<br/>
                <strong>Scouted Total Points:</strong> ${rec.scoutedPoints}<br/>
                <strong>Points Delta vs FIRST Score:</strong> <span class="${deltaLabelClass}" style="font-weight:bold;">${deltaSymbol}${rec.delta.toFixed(1)} points</span>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px;">
                <button class="btn-secondary btn-correct-audit" data-id="${rec.id}" style="padding: 6px 10px; font-size: 0.8rem; box-shadow:none; border: 1px solid var(--border-color);">
                  ✏️ Correct & Resubmit
                </button>
                <button class="btn-primary btn-bypass-audit" data-id="${rec.id}" style="padding: 6px 10px; font-size: 0.8rem; background:hsl(260, 60%, 50%); box-shadow:none;">
                  🔒 Bypass (Force Approve)
                </button>
              </div>
            </div>
          `;
        });

        this.auditListContainer.innerHTML = listHtml;

        // Bind clicks
        document.querySelectorAll(".btn-correct-audit").forEach(btn => {
          btn.addEventListener("click", () => {
            const recId = btn.getAttribute("data-id");
            this.handleCorrectAudit(recId);
          });
        });

        document.querySelectorAll(".btn-bypass-audit").forEach(btn => {
          btn.addEventListener("click", () => {
            const recId = btn.getAttribute("data-id");
            this.handleBypassAudit(recId);
          });
        });

      } catch (e) {
        console.error("[UI] Fetch audits fail:", e);
        this.auditListContainer.innerHTML = `<div class="history-empty" style="color:var(--color-error)">Failed to query flagged records: ${e.message}</div>`;
      }
    }

    /**
     * Loads a discrepant record back into form controls for scouter correction
     */
    handleCorrectAudit(recordId) {
      const targetRecord = this.activeFlaggedRecords.find(r => r.id === recordId);
      if (!targetRecord) {
        alert("Flagged record payload not loaded in active memory!");
        return;
      }

      const confirmCorrection = confirm(`Correct and resubmit Team ${targetRecord.teamno} for Match ${targetRecord.matchno}? This will load their values into the form so you can adjust them.`);
      if (!confirmCorrection) return;

      console.log(`[UI] Replenishing form controls with flagged dataset:`, targetRecord.data);

      // Loop through all keys and write values
      for (const [key, val] of Object.entries(targetRecord.data)) {
        const el = document.getElementById(key);
        if (el) {
          el.value = val;
          // Sync visual displays
          const counterDisplay = document.getElementById(`val-${key}`);
          if (counterDisplay) {
            counterDisplay.textContent = val;
          }
        }
      }

      // Set alliance style accents
      if (targetRecord.alliance) {
        this.setAllianceStyle(targetRecord.alliance);
      }

      // Set segmented buttons
      document.querySelectorAll(".segment-btn[data-field]").forEach(btn => {
        const field = btn.getAttribute("data-field");
        const val = btn.getAttribute("data-value");
        if (targetRecord.data[field] === val) {
          const container = btn.closest(".segmented-container");
          container.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          if (field === "breaks") {
            if (window.formManager) window.formManager.toggleMalfunctionsContainer(val);
          }
        }
      });

      // Set penalty checkboxes
      document.querySelectorAll(".toggle-checkbox-container").forEach(container => {
        const field = container.getAttribute("data-field");
        const val = targetRecord.data[field] || "";
        const activeVals = val.split(", ").map(v => v.trim()).filter(Boolean);

        container.querySelectorAll(".toggle-checkbox-btn").forEach(btn => {
          const btnVal = btn.getAttribute("data-value");
          if (activeVals.includes(btnVal)) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });
      });

      if (window.formManager) {
        window.formManager.parseCommentsAndExtractMalfunctions();
      }

      // Set canvas coordinate pin
      if (window.canvasInstance) {
        const pinX = targetRecord.data.pinX !== undefined ? parseFloat(targetRecord.data.pinX) : null;
        const pinY = targetRecord.data.pinY !== undefined ? parseFloat(targetRecord.data.pinY) : null;
        if (pinX !== null && pinY !== null && !isNaN(pinX) && !isNaN(pinY)) {
          window.activePinX = pinX;
          window.activePinY = pinY;
          window.canvasInstance.setPinPosition(window.activePinX, window.activePinY);
        } else {
          window.activePinX = null;
          window.activePinY = null;
          window.canvasInstance.clearPin();
        }
      }

      // Save draft
      if (window.formManager) {
        window.formManager.triggerAutosave();
      }

      // Navigate to setup phase
      const scoutTabBtn = document.getElementById("tab-scout");
      if (scoutTabBtn) {
        scoutTabBtn.click();
      }

      this.showToast(`Audit Correction Mode: Team ${targetRecord.teamno} Match ${targetRecord.matchno} loaded!`);
      alert(`AUDIT CORRECTION MODE ACTIVE:\n\nReview Team ${targetRecord.teamno} Match ${targetRecord.matchno}.\nCorrect the erroneous counts based on official FIRST score sheets, and click 'Submit Scouting Entry' to resubmit.`);
    }

    /**
     * Prompts for admin password to bypass/force-approve a discrepancy flag
     */
    async handleBypassAudit(recordId) {
      const targetRecord = this.activeFlaggedRecords.find(r => r.id === recordId);
      if (!targetRecord) return;

      const pwd = prompt(`Force approve Team ${targetRecord.teamno} Match ${targetRecord.matchno}?\n\nEnter Lead Scout Password:`);
      if (pwd === null) return;
      if (pwd.trim() === "") {
        alert("Password cannot be blank.");
        return;
      }

      this.showToast("Authenticating bypass credentials...");

      try {
        const endpoint = window.syncManager.getSyncEndpoint();
        const payload = {
          action: "bypassFlag",
          recordId: recordId,
          password: pwd.trim()
        };

        const response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          redirect: "follow",
          headers: {
            "Content-Type": "text/plain"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error("HTTP connection error: status " + response.status);
        }

        const result = await response.json();

        if (result.status === "success") {
          this.showToast("Audit flag successfully bypassed!");
          alert("Bypass Success: Record has been force-approved and returned to analytics.");
          this.renderAuditLogsList();
        } else {
          alert("Bypass Denied: " + result.message);
        }

      } catch (err) {
        console.error("[Audit] Bypass submission error:", err);
        alert("Failed to connect to spreadsheet backend: " + err.message);
      }
    }
  /**
   * FeedbackManager - Handles synthesized Web Audio ticks and haptic vibrations.
   */
  class FeedbackManager {
    constructor() {
      this.audioEnabled = true;
      this.hapticsEnabled = true;
      this.audioCtx = null;
      
      this.loadSettings();
    }

    loadSettings() {
      try {
        const audioSetting = localStorage.getItem("scout_enable_audio");
        const hapticSetting = localStorage.getItem("scout_enable_haptics");
        
        this.audioEnabled = audioSetting !== "false"; // default to true
        this.hapticsEnabled = hapticSetting !== "false"; // default to true
      } catch (e) {
        console.warn("[Feedback] Failed to load localStorage settings:", e);
      }
    }

    saveSettings(enableAudio, enableHaptics) {
      this.audioEnabled = !!enableAudio;
      this.hapticsEnabled = !!enableHaptics;
      try {
        localStorage.setItem("scout_enable_audio", String(this.audioEnabled));
        localStorage.setItem("scout_enable_haptics", String(this.hapticsEnabled));
      } catch (e) {
        console.warn("[Feedback] Failed to save localStorage settings:", e);
      }
    }

    initAudio() {
      if (this.audioCtx) return;
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      } catch (e) {
        console.warn("[Feedback] Failed to initialize AudioContext:", e);
      }
    }

    playTick(frequency, duration) {
      if (!this.audioEnabled) return;
      this.initAudio();
      if (!this.audioCtx) return;

      try {
        if (this.audioCtx.state === "suspended") {
          this.audioCtx.resume();
        }

        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

        gainNode.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + duration);
      } catch (e) {
        console.warn("[Feedback] Audio tick generation error:", e);
      }
    }

    vibrate(pattern) {
      if (!this.hapticsEnabled) return;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(pattern);
        } catch (e) {
          console.warn("[Feedback] Vibration failed:", e);
        }
      }
    }

    trigger(type) {
      if (type === "click") {
        this.playTick(880, 0.05); // High pitch crisp beep
        this.vibrate(35);         // Short vibration
      } else if (type === "undo") {
        this.playTick(440, 0.12); // Medium low pitch beep
        this.vibrate(75);         // Medium vibration
      } else if (type === "warning") {
        this.playTick(220, 0.20); // Buzzing low pitch beep
        this.vibrate([50, 40, 50]); // Double short pulse
      }
    }
  }

  // Instantiate globally
  window.scoutingUI = new ScoutingUI();
  window.showToast = (msg) => window.scoutingUI.showToast(msg);
  window.renderHistoryList = () => window.scoutingUI.renderHistoryList();
  window.renderAuditLogsList = () => window.scoutingUI.renderAuditLogsList();
  window.feedbackManager = new FeedbackManager();
})();
