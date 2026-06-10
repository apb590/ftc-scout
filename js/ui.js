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

      // Bind navigation bar tabs switching
      const navTabs = document.querySelectorAll(".nav-tab");
      const formSections = document.querySelectorAll(".form-section");
      navTabs.forEach(tab => {
        tab.addEventListener("click", () => {
          const targetId = tab.getAttribute("data-target");
          
          if (window.feedbackManager) {
            window.feedbackManager.trigger("click");
          }
          
          navTabs.forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
          
          formSections.forEach(sec => sec.classList.remove("active"));
          const targetSec = document.getElementById(targetId);
          if (targetSec) {
            targetSec.classList.add("active");
          }
          
          if (targetId === "history-section") {
            this.renderHistoryList();
          }
          if (targetId === "audit-section") {
            this.renderAuditLogsList();
          }
        });
      });

      // Bind scouter schedule filter change
      const filterSelect = document.getElementById("schedule-scouter-filter");
      if (filterSelect) {
        filterSelect.addEventListener("change", () => {
          const selectedName = filterSelect.value;
          const usernameInput = document.getElementById("username");
          if (selectedName && usernameInput) {
            let formattedName = selectedName.toLowerCase();
            if (!formattedName.includes("_")) {
              formattedName = formattedName + "_h";
            }
            usernameInput.value = formattedName;
            localStorage.setItem("sticky_scouter_name", formattedName);
          }
          this.renderSchedulerDashboard();
          this.updateAccessControl();
        });
      }

      // Bind schedule refresh button
      const refreshSchedBtn = document.getElementById("refresh-schedule-btn");
      if (refreshSchedBtn) {
        refreshSchedBtn.addEventListener("click", async () => {
          refreshSchedBtn.disabled = true;
          const originalText = refreshSchedBtn.textContent;
          refreshSchedBtn.textContent = "⏳";
          if (window.showToast) window.showToast("Syncing schedule assignments...");
          try {
            if (window.schedulerClient) {
              await window.schedulerClient.fetchScouterConfig();
              await window.schedulerClient.fetchScoutingSchedule();
              this.renderSchedulerDashboard();
              this.renderScouterSettings();
            }
          } catch(e) {
            console.error(e);
          } finally {
            refreshSchedBtn.disabled = false;
            refreshSchedBtn.textContent = originalText;
          }
        });
      }

      // Bind username inputs for Head Scout access control update
      const usernameInput = document.getElementById("username");
      if (usernameInput) {
        usernameInput.addEventListener("input", () => this.updateAccessControl());
        usernameInput.addEventListener("change", () => this.updateAccessControl());
      }

      // Run initial check
      setTimeout(() => this.updateAccessControl(), 100);
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
     * Shows/hides Audit Logs tab and restricts bypass/audit controls based on Head Scout name
     */
    updateAccessControl() {
      const usernameInput = document.getElementById("username");
      const currentScouter = usernameInput ? usernameInput.value.trim() : "";
      
      const headScout = window.headScoutName || "Alden";
      const isHeadScout = currentScouter.toLowerCase().startsWith(headScout.toLowerCase().split("_")[0]);
      
      const auditTab = document.getElementById("tab-audit");
      if (auditTab) {
        if (isHeadScout) {
          auditTab.style.display = "inline-block";
        } else {
          auditTab.style.display = "none";
          if (auditTab.classList.contains("active")) {
            const scoutTab = document.getElementById("tab-scout");
            if (scoutTab) scoutTab.click();
          }
        }
      }
      
      document.querySelectorAll(".btn-bypass-audit").forEach(btn => {
        if (isHeadScout) {
          btn.style.display = "inline-block";
        } else {
          btn.style.display = "none";
        }
      });
    }

    /**
     * Renders the logged-in scouter's personalized timetable and dropdown filter
     */
    async renderSchedulerDashboard() {
      const filterSelect = document.getElementById("schedule-scouter-filter");
      const container = document.getElementById("schedule-timetable-container");
      if (!container) return;

      const eventCode = window.selectedEvent || localStorage.getItem("sticky_event") || "";
      const scouterConfigKey = eventCode ? `scouter_config_${eventCode}` : "scouter_config";
      const scheduleKey = eventCode ? `scouting_schedule_${eventCode}` : "scouting_schedule";

      const scouterConfigCached = localStorage.getItem(scouterConfigKey);
      const scheduleCached = localStorage.getItem(scheduleKey);

      let scouters = [];
      let schedule = [];
      let shiftBlocks = [];

      try {
        if (scouterConfigCached) {
          const config = JSON.parse(scouterConfigCached);
          scouters = config.scouters || [];
          shiftBlocks = config.shiftBlocks || [];
          window.headScoutName = config.headScout || "Alden";
        }
      } catch (e) {
        console.warn("[UI] Failed to parse scouter config:", e);
      }

      try {
        if (scheduleCached) {
          schedule = JSON.parse(scheduleCached) || [];
        }
      } catch (e) {
        console.warn("[UI] Failed to parse schedule:", e);
      }

      if (!Array.isArray(schedule)) {
        schedule = [];
      }

      if (filterSelect) {
        const currentValue = filterSelect.value;
        filterSelect.innerHTML = `<option value="">-- Choose Name --</option>`;
        scouters.forEach(scout => {
          if (scout.active) {
            const opt = document.createElement("option");
            opt.value = scout.name;
            opt.textContent = scout.name;
            filterSelect.appendChild(opt);
          }
        });
        
        let bestSelection = currentValue;
        if (!bestSelection) {
          const stickyScouter = (localStorage.getItem("sticky_scouter_name") || "").trim().toLowerCase();
          const stickyShort = stickyScouter.split("_")[0];
          if (stickyShort) {
            const found = scouters.find(s => {
              const nameLower = s.name.toLowerCase();
              return nameLower === stickyShort || nameLower === stickyScouter || stickyScouter.startsWith(nameLower) || nameLower.startsWith(stickyShort);
            });
            if (found) {
              bestSelection = found.name;
            }
          }
        }

        if (bestSelection && Array.from(filterSelect.options).some(o => o.value === bestSelection)) {
          filterSelect.value = bestSelection;
        }
      }

      this.updateAccessControl();

      const selectedName = filterSelect ? filterSelect.value : "";
      if (!selectedName) {
        container.innerHTML = `
          <div style="font-style: italic; color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 12px;">
            Select a scouter name above to load assignments.
          </div>
        `;
        return;
      }

      // Pre-event research mode handling
      if (window.activeMode === "research") {
        const data = window.preEventData;
        if (!data || !data.assignments || data.assignments.length === 0) {
          container.innerHTML = `
            <div style="font-style: italic; color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 16px; background: rgba(255,255,255,0.01); border: 1px dashed var(--card-border); border-radius: 8px;">
              ⚠️ Pre-event assignments are empty or not synced. Please check event configuration.
            </div>
          `;
          return;
        }

        const scouterNameVal = selectedName.trim().toLowerCase();
        const targetShort = scouterNameVal.split("_")[0];
        const myAssignments = data.assignments.filter(assign => {
          const name = assign.scout.trim().toLowerCase();
          const scoutShort = name.split("_")[0];
          return name === scouterNameVal || name === targetShort || scouterNameVal.startsWith(name) || name.startsWith(targetShort);
        });

        if (myAssignments.length === 0) {
          container.innerHTML = `
            <div style="font-style: italic; color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 16px; background: rgba(255,255,255,0.01); border: 1px dashed var(--card-border); border-radius: 8px;">
              No pre-event assignments scheduled for ${selectedName}.
            </div>
          `;
          return;
        }

        // Count completed matches for each assignment using both server data and local IndexedDB records
        let localPreEventRecords = [];
        try {
          if (window.dbManager) {
            const allLocal = await window.dbManager.getAllRecords();
            localPreEventRecords = allLocal.filter(r => {
              const isPre = r.is_preevent === 1 || r.is_preevent === "1" || r.is_preevent === true || String(r.is_preevent).toLowerCase() === "true";
              const eventMatches = String(r.upcoming_event || "").trim().toLowerCase() === (window.selectedEvent || "").toLowerCase();
              return isPre && eventMatches;
            });
          }
        } catch (e) {
          console.warn("[UI] Failed to query local pre-event records for scheduler:", e);
        }

        let listHtml = "";
        myAssignments.forEach(assign => {
          const serverRuns = (data.completedMatches || []).filter(m => parseInt(m.team) === assign.team).map(m => parseInt(m.match));
          const localRuns = localPreEventRecords.filter(r => parseInt(r.teamno) === assign.team).map(r => parseInt(r.matchno));
          const allCompletedMatches = new Set([...serverRuns, ...localRuns]);
          const completedCount = allCompletedMatches.size;
          const target = assign.target || 4;
          const isCompleted = completedCount >= target;
          
          const pct = Math.min(100, Math.round((completedCount / target) * 100));
          const statusText = isCompleted ? "Completed" : `${completedCount}/${target} Matches`;
          const badgeStyle = isCompleted 
            ? "background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid #10b981;" 
            : "background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid #f59e0b;";

          listHtml += `
            <div class="history-item schedule-item" style="flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="history-team" style="font-weight: bold; font-family: 'Outfit';">
                  Team ${assign.team}
                </div>
                <span class="sync-badge" style="font-size: 0.75rem; padding: 2px 6px; ${badgeStyle}">${statusText}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <div style="flex: 1; margin-right: 12px;">
                  <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${isCompleted ? '#10b981' : 'var(--accent-color)'}; border-radius: 3px; transition: width 0.3s ease;"></div>
                  </div>
                </div>
                <button type="button" class="btn-primary btn-scout-homework-sched" data-team="${assign.team}" style="padding: 4px 10px; font-size: 0.75rem; background: var(--accent-color); box-shadow: none; margin-top: 0;">
                  Scout
                </button>
              </div>
            </div>
          `;
        });

        container.innerHTML = listHtml;

        // Bind clicks to "Scout" buttons in scheduler container
        container.querySelectorAll(".btn-scout-homework-sched").forEach(btn => {
          btn.addEventListener("click", () => {
            const teamNum = btn.getAttribute("data-team");
            const preeventTeamSelect = document.getElementById("preevent-team-select");
            const preeventMatchInput = document.getElementById("preevent-matchno");
            if (preeventTeamSelect) {
              preeventTeamSelect.value = teamNum;
              preeventTeamSelect.dispatchEvent(new Event("change"));
              
              if (preeventMatchInput) {
                preeventMatchInput.focus();
                preeventMatchInput.select();
              }
              
              if (window.showToast) {
                window.showToast(`Selected Homework: Team ${teamNum}`, "success");
              }
            }
          });
        });

        return;
      }

      let latestMatch = 0;
      const adminConfigCached = localStorage.getItem("admin_config");
      let adminConfig = {};
      try {
        if (adminConfigCached) {
          adminConfig = JSON.parse(adminConfigCached) || {};
        }
      } catch (e) {
        console.warn("[UI] Failed to parse cached admin config:", e);
      }

      const isSimActive = adminConfig.simActive === true || adminConfig.simActive === 1 || String(adminConfig.simActive).toLowerCase() === "true";
      let testMatchNums = [1234, 999, 9999, 1000]; // default fallback
      if (adminConfig.testMatchNumbers) {
        testMatchNums = String(adminConfig.testMatchNumbers)
          .split(",")
          .map(m => parseInt(m.trim()))
          .filter(m => !isNaN(m));
      }

      if (isSimActive) {
        latestMatch = parseInt(adminConfig.simMatchThreshold) || 1;
      } else {
        // Normal Mode Progress calculation
        const currentEvent = (window.selectedEvent || localStorage.getItem("sticky_event") || "").trim().toLowerCase();

        // Find max scheduled match number from the event qualification schedule
        let maxScheduledMatch = 0;
        let savedSchedule = null;
        if (currentEvent) {
          savedSchedule = localStorage.getItem(`qual_schedule_${currentEvent}`);
        }
        if (!savedSchedule) {
          savedSchedule = localStorage.getItem("qual_schedule");
        }
        try {
          if (savedSchedule) {
            const scheduleObj = JSON.parse(savedSchedule);
            if (scheduleObj) {
              const keys = Object.keys(scheduleObj).map(k => parseInt(k)).filter(k => !isNaN(k));
              if (keys.length > 0) {
                maxScheduledMatch = Math.max(...keys);
              }
            }
          }
        } catch (e) {
          console.warn("[UI] Failed to parse qual schedule to find max match:", e);
        }

        // Progress validation checker helper
        const isValidMatchNo = (m) => {
          if (isNaN(m) || m <= 0) return false;
          if (testMatchNums.includes(m)) return false;
          if (maxScheduledMatch > 0 && m > maxScheduledMatch) return false;
          return true;
        };

        // Group IndexedDB records by match number for the current event
        const matchRecordCounts = {};
        try {
          if (window.dbManager) {
            const records = await window.dbManager.getAllRecords();
            if (records && records.length > 0) {
              records.forEach(r => {
                const m = parseInt(r.matchno);
                if (isValidMatchNo(m)) {
                  // Only consider matches for the current event
                  const recordEvent = String(r.scouted_event || r.upcoming_event || "").trim().toLowerCase();
                  if (currentEvent && recordEvent && recordEvent !== currentEvent) return;
                  
                  // Ignore pre-event
                  const isPre = r.is_preevent === 1 || r.is_preevent === "1" || r.is_preevent === true || String(r.is_preevent).toLowerCase() === "true";
                  if (isPre) return;

                  matchRecordCounts[m] = (matchRecordCounts[m] || 0) + 1;
                }
              });
            }
          }
        } catch (e) {
          console.warn("[UI] Failed to query latest scouted match number from IndexedDB:", e);
        }

        // Count expected scouts for each match from the scouting schedule
        const matchExpectedCounts = {};
        schedule.forEach(row => {
          const m = parseInt(row.match);
          if (isNaN(m)) return;
          let count = 0;
          if (row.red1Scout && row.red1Scout.trim()) count++;
          if (row.red2Scout && row.red2Scout.trim()) count++;
          if (row.blue1Scout && row.blue1Scout.trim()) count++;
          if (row.blue2Scout && row.blue2Scout.trim()) count++;
          matchExpectedCounts[m] = count;
        });

        // Collect valid candidates
        const progressCandidates = [];

        // Candidate B: Matches in IndexedDB that meet the "half of expected scouting" threshold
        for (const mStr in matchRecordCounts) {
          const m = parseInt(mStr);
          const expected = matchExpectedCounts[m] || 4; // default to 4 if not in schedule
          const actual = matchRecordCounts[m] || 0;
          if (actual >= Math.ceil(expected / 2) && actual > 0) {
            progressCandidates.push(m);
          }
        }

        // Candidate C: The current match input value `#matchno`
        const matchInput = document.getElementById("matchno");
        if (matchInput && matchInput.value) {
          const inputVal = parseInt(matchInput.value);
          if (isValidMatchNo(inputVal)) {
            progressCandidates.push(inputVal);
          }
        }

        // Determine final latestMatch value as max of all valid candidates
        if (progressCandidates.length > 0) {
          latestMatch = Math.max(...progressCandidates);
        }
      }

      const displayMinMatch = latestMatch > 3 ? latestMatch - 3 : 1;

      const assignments = [];
      schedule.forEach(row => {
        let role = "";
        let team = "";
        const checkScout = (scoutField) => {
          if (!scoutField || !selectedName) return false;
          const target = selectedName.trim().toLowerCase();
          const targetShort = target.split("_")[0];
          return scoutField.split(",").map(s => s.trim().toLowerCase()).some(s => {
            return s === target || s === targetShort || target.startsWith(s) || s.startsWith(targetShort);
          });
        };
        
        let scoutVal = "";
        if (checkScout(row.red1Scout)) { role = "red1"; team = row.red1Team; scoutVal = row.red1Scout; }
        else if (checkScout(row.red2Scout)) { role = "red2"; team = row.red2Team; scoutVal = row.red2Scout; }
        else if (checkScout(row.blue1Scout)) { role = "blue1"; team = row.blue1Team; scoutVal = row.blue1Scout; }
        else if (checkScout(row.blue2Scout)) { role = "blue2"; team = row.blue2Team; scoutVal = row.blue2Scout; }

        if (role) {
          assignments.push({
            match: parseInt(row.match),
            field: row.field,
            role: role,
            team: team,
            alliance: role.startsWith("red") ? "Red" : "Blue",
            subRequested: scoutVal.includes("(Sub Requested)"),
            rawRow: row
          });
        }
      });

      // Check if the current scout is a floater for the current shift block
      let currentShiftIdx = -1;
      let currentShiftName = "";
      for (let i = 0; i < shiftBlocks.length; i++) {
        const s = shiftBlocks[i];
        if (latestMatch >= s.startMatch && latestMatch <= s.endMatch) {
          currentShiftIdx = i;
          currentShiftName = s.name;
          break;
        }
      }

      let isFloaterCurrentShift = false;
      if (currentShiftIdx !== -1 && scouters.length > 0) {
        const targetScout = scouters.find(s => s.name.toLowerCase() === selectedName.toLowerCase());
        if (targetScout && targetScout.shifts) {
          const shiftVal = String(targetScout.shifts[currentShiftIdx] || "Unavailable").trim().toLowerCase();
          if (shiftVal === "floater") {
            isFloaterCurrentShift = true;
          }
        }
      }

      assignments.sort((a, b) => a.match - b.match);

      // Scan for open sub requests in the schedule
      const openSubRequests = [];
      schedule.forEach(row => {
        const checkRequest = (scoutField, role, team) => {
          if (scoutField && scoutField.includes("(Sub Requested)")) {
            const requester = scoutField.split("(")[0].trim();
            openSubRequests.push({
              match: parseInt(row.match),
              field: row.field,
              role: role,
              team: team,
              alliance: role.startsWith("red") ? "Red" : "Blue",
              requester: requester,
              rawScoutField: scoutField
            });
          }
        };
        checkRequest(row.red1Scout, "red1", row.red1Team);
        checkRequest(row.red2Scout, "red2", row.red2Team);
        checkRequest(row.blue1Scout, "blue1", row.blue1Team);
        checkRequest(row.blue2Scout, "blue2", row.blue2Team);
      });

      // Compile active open sub requests (where match >= displayMinMatch)
      const activeSubRequests = openSubRequests.filter(req => req.match >= displayMinMatch);
      
      const scoutScheduledMatches = new Set(assignments.map(a => a.match));
      const scoutMatchFieldMap = {};
      assignments.forEach(a => {
        scoutMatchFieldMap[a.match] = a.field;
      });
      
      const getEligibility = (req) => {
        if (selectedName.trim().toLowerCase() === req.requester.trim().toLowerCase()) {
          return { eligible: false, reason: "Your Request" };
        }
        
        // Determine shift of the requested match
        let reqShiftIdx = -1;
        for (let i = 0; i < shiftBlocks.length; i++) {
          if (req.match >= shiftBlocks[i].startMatch && req.match <= shiftBlocks[i].endMatch) {
            reqShiftIdx = i;
            break;
          }
        }
        
        // Check active / shift status for this block
        if (scouters && scouters.length > 0) {
          const targetScout = scouters.find(s => s.name.toLowerCase() === selectedName.toLowerCase());
          if (!targetScout || !targetScout.active) {
            return { eligible: false, reason: "Inactive" };
          }
          
          if (reqShiftIdx !== -1) {
            const shiftVal = targetScout.shifts ? String(targetScout.shifts[reqShiftIdx]).trim().toLowerCase() : "unavailable";
            if (shiftVal !== "scouter" && shiftVal !== "floater") {
              return { eligible: false, reason: "Shift Off" };
            }
          }
        }
        
        // If the scout is assigned to the SAME MATCH on any field/role, they are busy!
        if (scoutScheduledMatches.has(req.match)) {
          return { eligible: false, reason: "Busy Scouting" };
        }
        
        // Condition 1 (Other Field): Scout S is assigned adjacent match (M - 1 or M + 1) on the other field
        const prevField = scoutMatchFieldMap[req.match - 1];
        const isPrevOtherField = prevField && prevField !== req.field;
        const nextField = scoutMatchFieldMap[req.match + 1];
        const isNextOtherField = nextField && nextField !== req.field;
        const isOtherFieldEligible = isPrevOtherField || isNextOtherField;
        
        // Condition 2 (Two Consecutive Matches Break): Scout S is free for at least two consecutive matches containing/adjacent to M
        const freeM_minus_1 = !scoutScheduledMatches.has(req.match - 1);
        const freeM = !scoutScheduledMatches.has(req.match);
        const freeM_plus_1 = !scoutScheduledMatches.has(req.match + 1);
        const isBreakEligible = (freeM_minus_1 && freeM) || (freeM && freeM_plus_1);
        
        if (isOtherFieldEligible || isBreakEligible) {
          return { eligible: true };
        }
        return { eligible: false, reason: "No Adjacent/Break" };
      };

      // Identify field transitions within display range
      const transitions = [];
      for (let i = 1; i < assignments.length; i++) {
        const prev = assignments[i - 1];
        const curr = assignments[i];
        if (prev.field !== curr.field) {
          if (curr.match >= displayMinMatch) {
            transitions.push({
              fromMatch: prev.match,
              toMatch: curr.match,
              fromField: prev.field,
              toField: curr.field
            });
          }
        }
      }

      let headerHtml = "";
      if (isFloaterCurrentShift) {
        headerHtml += `
          <div class="premium-card" style="background: rgba(99, 102, 241, 0.08); border: 1px solid var(--accent-color); padding: 12px; margin-bottom: 12px; border-radius: 8px; box-shadow: none;">
            <div style="font-weight: bold; color: var(--accent-color); font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
              📣 On-Demand Floater
            </div>
            <div style="font-size: 0.8rem; color: var(--text-primary); margin-top: 4px;">
              You are the designated substitute floater for <strong>${currentShiftName}</strong>. Tap 'Opt In' on any open request below to cover a shift!
            </div>
          </div>
        `;
      }

      if (transitions.length > 0) {
        headerHtml += `
          <div class="premium-card" style="background: rgba(245, 158, 11, 0.08); border: 1px solid var(--color-warning); padding: 12px; margin-bottom: 12px; border-radius: 8px; box-shadow: none;">
            <div style="font-weight: bold; color: var(--color-warning); font-size: 0.85rem; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              ⚠️ Field Transitions detected for ${selectedName}
            </div>
            <ul style="margin: 0; padding-left: 16px; font-size: 0.8rem; color: var(--text-primary); line-height: 1.4;">
        `;
        transitions.forEach(tr => {
          headerHtml += `
            <li style="margin-bottom: 2px;">Shift from <strong>${tr.fromField}</strong> (Match ${tr.fromMatch}) &rarr; <strong>${tr.toField}</strong> (Match ${tr.toMatch})</li>
          `;
        });
        headerHtml += `
            </ul>
          </div>
        `;
      }

      if (activeSubRequests.length > 0) {
        headerHtml += `
          <div class="premium-card" style="background: rgba(99, 102, 241, 0.08); border: 1px solid var(--accent-color); padding: 12px; margin-bottom: 12px; border-radius: 8px; box-shadow: none;">
            <div style="font-weight: bold; color: var(--accent-color); font-size: 0.85rem; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
              🙋 Cover a Shift? (Open Sub Requests)
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
        `;
        activeSubRequests.forEach(req => {
          const elig = getEligibility(req);
          let actionHtml = "";
          if (elig.eligible) {
            actionHtml = `
              <button type="button" class="btn-primary btn-opt-in-sub" data-match="${req.match}" data-role="${req.role}" data-requester="${req.rawScoutField}" style="padding: 4px 8px; font-size: 0.75rem; background: var(--accent-color); box-shadow: none; margin-left: 10px;">
                Opt In
              </button>
            `;
          } else {
            actionHtml = `
              <span style="font-size: 0.75rem; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 3px 6px; border-radius: 4px; font-weight: bold; margin-left: 10px; white-space: nowrap;">
                ${elig.reason}
              </span>
            `;
          }
          
          headerHtml += `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--text-primary);">
              <div>
                <strong>${req.requester}</strong> requests a sub for <strong>Match ${req.match}</strong> (${req.field}, Team ${req.team}, ${req.alliance} Alliance)
              </div>
              ${actionHtml}
            </div>
          `;
        });
        headerHtml += `
            </div>
          </div>
        `;
      }

      let html = "";
      let hiddenCount = 0;

      if (assignments.length === 0) {
        if (!schedule || schedule.length === 0) {
          html = `
            <div style="font-style: italic; color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 16px; background: rgba(255,255,255,0.01); border: 1px dashed var(--card-border); border-radius: 8px;">
              ⚠️ Master schedule is empty or not synced. Please generate the schedule on the spreadsheet, then tap sync.
            </div>
          `;
        } else {
          html = `
            <div style="font-style: italic; color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 16px; background: rgba(255,255,255,0.01); border: 1px dashed var(--card-border); border-radius: 8px;">
              No scheduled match assignments for this shift.
            </div>
          `;
        }
      } else {
        assignments.forEach(assign => {
          if (assign.match < displayMinMatch) {
            hiddenCount++;
            return;
          }

          const allianceClass = assign.alliance.toLowerCase();
          const allianceDotClass = allianceClass === "red" ? "red" : "blue";
          
          html += `
            <div class="history-item schedule-item" style="flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="history-team" style="font-weight: bold; font-family: 'Outfit';">
                  <span class="alliance-dot ${allianceDotClass}"></span>
                  Match ${assign.match} &bull; Team ${assign.team}
                </div>
                <span class="sync-badge" style="background: var(--card-border); color: var(--text-primary); font-size: 0.75rem;">${assign.field}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <div style="font-size: 0.85rem; color: var(--text-secondary);">
                  Role: <strong>${assign.alliance} ${assign.role.endsWith("1") ? "1" : "2"}</strong>
                  ${assign.subRequested ? ` <span class="sync-badge pending" style="background:rgba(245, 158, 11, 0.15); color:var(--color-warning); font-size:0.7rem; padding: 2px 6px;">SUB REQUESTED</span>` : ""}
                </div>
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="btn-primary btn-scout-now" data-match="${assign.match}" data-team="${assign.team}" data-alliance="${assign.alliance}" data-field="${assign.field}" style="padding: 4px 10px; font-size: 0.75rem; background: var(--accent-color); box-shadow: none;">
                    Scout Match
                  </button>
                  <button type="button" class="btn-secondary btn-sub-scout" data-match="${assign.match}" data-role="${assign.role}" data-scouter="${selectedName}" ${assign.subRequested ? "disabled" : ""} style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--color-warning); color: var(--color-warning); box-shadow: none; background: rgba(245, 158, 11, 0.05); ${assign.subRequested ? "opacity:0.5; cursor:not-allowed;" : ""}">
                    ${assign.subRequested ? "Sub Pending" : "Request Sub"}
                  </button>
                </div>
              </div>
            </div>
          `;
        });
      }

      if (hiddenCount > 0) {
        html = `
          <div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center; margin-bottom: 12px; padding: 6px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px dashed var(--card-border);">
            💡 Hidden ${hiddenCount} past matches. Showing from Match ${displayMinMatch} onwards.
          </div>
        ` + html;
      }

      container.innerHTML = headerHtml + html;

      container.querySelectorAll(".btn-scout-now").forEach(btn => {
        btn.addEventListener("click", () => {
          const mNum = btn.getAttribute("data-match");
          const tNum = btn.getAttribute("data-team");
          const alliance = btn.getAttribute("data-alliance");
          
          if (window.feedbackManager) window.feedbackManager.trigger("click");

          const matchInput = document.getElementById("matchno");
          if (matchInput) {
            matchInput.value = mNum;
            if (window.updateTeamSelector) {
              window.updateTeamSelector();
            }
          }
          
          const teamSelect = document.getElementById("teamno");
          if (teamSelect) {
            teamSelect.value = tNum;
          }
          
          this.setAllianceStyle(alliance);

          const startingPosCard = document.getElementById("starting-pos-canvas") ? document.getElementById("starting-pos-canvas").closest(".premium-card") : null;
          if (startingPosCard) {
            startingPosCard.scrollIntoView({ behavior: "smooth" });
          }
          this.showToast(`Scouting setup filled for Match ${mNum} Team ${tNum}!`);
        });
      });

      container.querySelectorAll(".btn-sub-scout").forEach(btn => {
        btn.addEventListener("click", () => {
          const match = btn.getAttribute("data-match");
          const role = btn.getAttribute("data-role");
          const originalScouter = btn.getAttribute("data-scouter");
          
          this.triggerSubstitutionOverlay(match, role, originalScouter, scouters);
        });
      });

      container.querySelectorAll(".btn-opt-in-sub").forEach(btn => {
        btn.addEventListener("click", async () => {
          const match = btn.getAttribute("data-match");
          const role = btn.getAttribute("data-role");
          const requesterField = btn.getAttribute("data-requester");
          
          const confirmOptIn = confirm(`Do you want to opt in and cover Match ${match} for ${requesterField.split("(")[0].trim()}?`);
          if (!confirmOptIn) return;

          if (window.feedbackManager) window.feedbackManager.trigger("click");
          if (window.schedulerClient) {
            await window.schedulerClient.postSubstitution(match, role, selectedName, requesterField);
          }
        });
      });
    }

    /**
     * Opens a selection modal to substitute another scout for a match assignment
     */
    triggerSubstitutionOverlay(match, role, originalScouter, scouters) {
      if (window.feedbackManager) window.feedbackManager.trigger("click");
      
      const availableScouts = scouters.filter(s => s.active && s.name.toLowerCase() !== originalScouter.toLowerCase());
      
      const overlay = document.createElement("div");
      overlay.className = "overlay-modal active";
      overlay.style.zIndex = "3000";
      
      const content = document.createElement("div");
      content.className = "modal-content";
      content.style.maxWidth = "400px";
      content.style.textAlign = "center";
      
      const header = document.createElement("div");
      header.className = "modal-header";
      
      const title = document.createElement("h3");
      title.style.fontFamily = "'Outfit', sans-serif";
      title.textContent = `Substitute Scout (Match ${match})`;
      
      const closeBtn = document.createElement("button");
      closeBtn.className = "modal-close";
      closeBtn.innerHTML = "&times;";
      closeBtn.addEventListener("click", () => overlay.remove());
      
      header.appendChild(title);
      header.appendChild(closeBtn);
      content.appendChild(header);
      
      if (availableScouts.length > 0) {
        const body = document.createElement("div");
        body.style.margin = "16px 0";
        body.style.textAlign = "left";
        
        const label = document.createElement("label");
        label.className = "input-label";
        label.textContent = `Transfer Match ${match} assignment from ${originalScouter} to:`;
        
        const select = document.createElement("select");
        select.className = "input-control";
        select.style.marginTop = "8px";
        
        availableScouts.forEach(s => {
          const opt = document.createElement("option");
          opt.value = s.name;
          opt.textContent = s.name;
          select.appendChild(opt);
        });
        
        body.appendChild(label);
        body.appendChild(select);
        content.appendChild(body);
        
        const submitBtn = document.createElement("button");
        submitBtn.className = "btn-primary";
        submitBtn.textContent = "Confirm Substitution";
        submitBtn.style.background = "var(--color-warning)";
        submitBtn.addEventListener("click", async () => {
          const newScout = select.value;
          if (newScout) {
            overlay.remove();
            if (window.schedulerClient) {
              await window.schedulerClient.postSubstitution(match, role, newScout, originalScouter);
            }
          }
        });
        content.appendChild(submitBtn);
      } else {
        const body = document.createElement("div");
        body.style.margin = "16px 0";
        body.style.fontSize = "0.9rem";
        body.style.color = "var(--text-secondary)";
        body.textContent = "No other active scouters are currently available in Settings to assign directly.";
        content.appendChild(body);
      }
      
      const openSubBtn = document.createElement("button");
      openSubBtn.className = "btn-secondary";
      openSubBtn.textContent = "Request Open Sub (Put on Board)";
      openSubBtn.style.width = "100%";
      openSubBtn.style.marginTop = "10px";
      openSubBtn.style.borderColor = "var(--color-warning)";
      openSubBtn.style.color = "var(--color-warning)";
      openSubBtn.style.background = "rgba(245, 158, 11, 0.05)";
      openSubBtn.style.boxShadow = "none";
      openSubBtn.addEventListener("click", async () => {
        overlay.remove();
        if (window.schedulerClient) {
          await window.schedulerClient.postSubstitution(match, role, `${originalScouter} (Sub Requested)`, originalScouter);
        }
      });
      content.appendChild(openSubBtn);
      
      overlay.appendChild(content);
      document.body.appendChild(overlay);
    }

    /**
     * Renders scouters roster inside Settings modal with toggles and shift checkboxes
     */
    renderScouterSettings() {
      const listContainer = document.getElementById("scouter-availability-settings-list");
      if (!listContainer) return;

      const eventCode = window.selectedEvent || localStorage.getItem("sticky_event") || "";
      const scouterConfigKey = eventCode ? `scouter_config_${eventCode}` : "scouter_config";
      const scouterConfigCached = localStorage.getItem(scouterConfigKey);
      let scouters = [];
      
      try {
        if (scouterConfigCached) {
          const config = JSON.parse(scouterConfigCached);
          scouters = config.scouters || [];
        }
      } catch (e) {
        console.warn("[UI] Failed to parse scouter config for settings:", e);
      }

      if (scouters.length === 0) {
        listContainer.innerHTML = `
          <div style="font-style: italic; color: var(--text-secondary); font-size: 0.9rem;">
            No scouters loaded. Sync from sheets to load list.
          </div>
        `;
        return;
      }

      let html = "";
      scouters.forEach(scout => {
        const activeText = scout.active ? "Active" : "Inactive";
        const btnBg = scout.active ? "hsl(140, 60%, 40%)" : "transparent";
        const btnColor = scout.active ? "#ffffff" : "var(--text-secondary)";
        
        html += `
          <div style="
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-sm);
            padding: 10px;
            margin-bottom: 8px;
          ">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: bold; font-size: 0.95rem; color: var(--text-primary);">
                ${scout.name} ${scout.isHead ? "👑" : ""}
              </span>
              <button type="button" class="btn-toggle-scout-active" data-name="${scout.name}" data-active="${scout.active}" style="
                padding: 4px 8px;
                font-size: 0.75rem;
                background: ${btnBg};
                color: ${btnColor};
                border: 1px solid ${scout.active ? "transparent" : "var(--border-color)"};
                cursor: pointer;
                border-radius: var(--radius-sm);
                font-weight: bold;
                transition: all 0.2s;
              ">${activeText}</button>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-top: 6px; border-top: 1px dashed var(--card-border); padding-top: 8px;">
              ${[1, 2, 3, 4].map(sNum => {
                const status = scout.shifts ? String(scout.shifts[sNum - 1] || "Unavailable").trim() : "Unavailable";
                const statusLower = status.toLowerCase();
                
                const isOff = statusLower === "unavailable" || statusLower === "false" || !status || statusLower === "off";
                const isScout = statusLower === "scouter" || statusLower === "true";
                const isFloat = statusLower === "floater";

                const activeOffStyle = isOff ? "background: var(--card-border); color: var(--text-primary); font-weight: bold;" : "background: transparent; color: var(--text-secondary);";
                const activeScoutStyle = isScout ? "background: var(--accent-color); color: #ffffff; font-weight: bold;" : "background: transparent; color: var(--text-secondary);";
                const activeFloatStyle = isFloat ? "background: var(--color-warning); color: #ffffff; font-weight: bold;" : "background: transparent; color: var(--text-secondary);";

                return `
                  <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span style="font-size: 0.7rem; color: var(--text-secondary); font-weight: bold;">Shift ${sNum}</span>
                    <div class="segmented-container" style="display: flex; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); border-radius: 4px; padding: 2px; gap: 2px; width: 100%;">
                      <button type="button" class="btn-shift-state" data-name="${scout.name}" data-shift="${sNum - 1}" data-value="Unavailable" style="flex: 1; text-align: center; border: none; font-size: 0.65rem; padding: 3px 0; border-radius: 2px; cursor: pointer; transition: all 0.15s; ${activeOffStyle}">Off</button>
                      <button type="button" class="btn-shift-state" data-name="${scout.name}" data-shift="${sNum - 1}" data-value="Scouter" style="flex: 1; text-align: center; border: none; font-size: 0.65rem; padding: 3px 0; border-radius: 2px; cursor: pointer; transition: all 0.15s; ${activeScoutStyle}">Scout</button>
                      <button type="button" class="btn-shift-state" data-name="${scout.name}" data-shift="${sNum - 1}" data-value="Floater" style="flex: 1; text-align: center; border: none; font-size: 0.65rem; padding: 3px 0; border-radius: 2px; cursor: pointer; transition: all 0.15s; ${activeFloatStyle}">Float</button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      });

      listContainer.innerHTML = html;

      listContainer.querySelectorAll(".btn-toggle-scout-active").forEach(btn => {
        btn.addEventListener("click", async () => {
          const name = btn.getAttribute("data-name");
          const currentActive = btn.getAttribute("data-active") === "true";
          
          if (window.feedbackManager) window.feedbackManager.trigger("click");
          
          const targetScout = scouters.find(s => s.name === name);
          if (targetScout && window.schedulerClient) {
            await window.schedulerClient.postScouterToggles(name, !currentActive, targetScout.shifts);
          }
        });
      });

      listContainer.querySelectorAll(".btn-shift-state").forEach(btn => {
        btn.addEventListener("click", async () => {
          const name = btn.getAttribute("data-name");
          const shiftIdx = parseInt(btn.getAttribute("data-shift"));
          const val = btn.getAttribute("data-value");
          
          if (window.feedbackManager) window.feedbackManager.trigger("click");
          
          const targetScout = scouters.find(s => s.name === name);
          if (targetScout && window.schedulerClient) {
            const shifts = [...targetScout.shifts];
            shifts[shiftIdx] = val;
            await window.schedulerClient.postScouterToggles(name, targetScout.active, shifts);
          }
        });
      });
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
