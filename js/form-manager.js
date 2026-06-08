/**
 * form-manager.js - Form State and Interaction Module
 * Manages form serialization, input validations, draft caching (autosave/restore),
 * scoring event counts, undo actions, and malfunction comments mapping.
 */

(function() {
  class ScoutingForm {
    constructor() {
      this.actionHistoryStack = [];
      
      // Schema keys matching the 38 spreadsheet columns (excl. Timestamp, Record ID, etc.)
      this.schemaKeys = [
        "username", "matchno", "teamno", "alliance", "robotpos",
        "preload_made", "preload_miss", "pickup_made", "pickup_miss", "pickup_ovw",
        "auto_range", "auto_park", "auto_pattern", "auto_midline", "auto_gate", "auto_penal",
        "close_made", "close_miss", "close_ovw", "far_made", "far_miss", "far_ovw",
        "tele_collection", "tele_pattern", "tele_range", "tele_penal",
        "gate_opn", "defense", "breaks", "malfunctions", "comments",
        "timetopark", "park_base", "park_bonus", "automove", "is_preevent", "upcoming_event", "scouted_event"
      ];
    }

    /**
     * Cache form references
     */
    init() {
      this.form = document.getElementById("scouting-form");
    }

    /**
     * Checks if scouter name, match, and team fields are filled and valid
     */
    validateSetupPhase() {
      const usernameInput = document.getElementById("username");
      const matchnoInput = document.getElementById("matchno");
      const teamnoInput = document.getElementById("teamno");

      const username = usernameInput ? usernameInput.value.trim() : "";
      const matchno = matchnoInput ? matchnoInput.value : "";
      const teamno = teamnoInput ? teamnoInput.value : "";

      if (!username || !matchno || !teamno) {
        alert("Please ensure Scouter Name, Match, and Team fields are completed!");
        return false;
      }

      const nameRegex = /^[a-zA-Z]+_[a-zA-Z]$/;
      if (!nameRegex.test(username)) {
        alert("Please enter Scouter Name in first_lastinitial format (e.g., alden_h)");
        return false;
      }
      return true;
    }

    /**
     * Helper to trigger form autosave with debounce
     */
    triggerAutosave() {
      if (this.autosaveTimeout) clearTimeout(this.autosaveTimeout);
      this.autosaveTimeout = setTimeout(() => {
        this.saveFormStateDraft();
      }, 500);
    }

    /**
     * Saves active inputs as draft to IndexedDB autosave store
     */
    async saveFormStateDraft() {
      try {
        const activeDraft = this.compileFormStateJSON();
        await window.dbManager.saveDraft(activeDraft);
        console.log("[Autosave] Form state draft successfully saved to IndexedDB.");
      } catch (err) {
        console.warn("[Autosave] Failed to write autosave draft:", err);
      }
    }

    /**
     * Restores draft inputs from IndexedDB on page reload
     */
    async restoreFormStateDraft() {
      try {
        const draft = await window.dbManager.getDraft();
        if (!draft) return;

        console.log("[Autosave] Restoring draft state from IndexedDB...", draft);

        // 1. Populate standard values
        this.schemaKeys.forEach(key => {
          if (draft[key] !== undefined) {
            const input = document.getElementById(key);
            if (input) {
              input.value = draft[key];
              
              // Update visual count labels
              const countDisplay = document.getElementById(`val-${key}`);
              if (countDisplay) {
                countDisplay.textContent = draft[key];
              }
            }
          }
        });

        // 2. Set Alliance Theme Accent
        if (draft.alliance && window.scoutingUI) {
          window.scoutingUI.setAllianceStyle(draft.alliance);
        }

        // 3. Set visual ranges/parking button states
        document.querySelectorAll(".range-toggle-btn[data-field]").forEach(btn => {
          const field = btn.getAttribute("data-field");
          const val = btn.getAttribute("data-value");
          if (draft[field] === val) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });

        // 4. Set visual segmented buttons states
        document.querySelectorAll(".segment-btn[data-field]").forEach(btn => {
          const field = btn.getAttribute("data-field");
          const val = btn.getAttribute("data-value");
          if (draft[field] === val) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });

        // Toggle malfunctions drawer depending on breaks
        this.toggleMalfunctionsContainer(draft.breaks || "No");

        // 5. Restore penalty checkbox visual states
        document.querySelectorAll(".toggle-checkbox-container").forEach(container => {
          const field = container.getAttribute("data-field");
          const val = draft[field] || "";
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

        // 6. Restore Auton Canvas pin coordinates
        if (draft.pinX !== undefined && draft.pinY !== undefined) {
          window.activePinX = parseFloat(draft.pinX) || null;
          window.activePinY = parseFloat(draft.pinY) || null;
          if (window.canvasInstance && window.activePinX !== null && window.activePinY !== null) {
            window.canvasInstance.setPinPosition(window.activePinX, window.activePinY);
          }
        }

        // 7. Re-verify the scouter name local cache
        const nameInput = document.getElementById("username");
        if (nameInput && draft.username) {
          localStorage.setItem("sticky_scouter_name", draft.username);
        }

        if (window.showToast) {
          window.showToast("In-progress scouting draft restored!");
        }
      } catch (err) {
        console.error("[Autosave] Failed to restore draft:", err);
      }
    }

    /**
     * Serializes all form controls into a structured JSON record
     */
    compileFormStateJSON() {
      const record = {};
      
      this.schemaKeys.forEach(key => {
        const input = document.getElementById(key);
        if (input) {
          record[key] = input.value;
        } else {
          record[key] = "";
        }
      });

      // Special overrides for Pre-Event fields
      const modeBtnResearch = document.getElementById("mode-btn-research");
      const isResearchActive = modeBtnResearch ? modeBtnResearch.classList.contains("active") : false;
      const eventSelect = document.getElementById("event-select");
      
      // Determine pre-event state
      record.is_preevent = isResearchActive ? 1 : 0;

      if (isResearchActive && eventSelect) {
        // ALWAYS use the PWA dropdown event as upcoming_event
        record.upcoming_event = eventSelect.value;
        
        // ALWAYS use the data-lastevent of the selected team as scouted_event
        const preeventTeamSelect = document.getElementById("preevent-team-select");
        if (preeventTeamSelect) {
          const selectedOption = preeventTeamSelect.options[preeventTeamSelect.selectedIndex];
          if (selectedOption) {
            let lastEvent = selectedOption.getAttribute("data-lastevent") || "";
            if (lastEvent.includes("|")) {
              lastEvent = lastEvent.split("|")[0].trim();
            }
            record.scouted_event = lastEvent;
          }
        }
      } else {
        record.scouted_event = "";
        record.upcoming_event = eventSelect ? eventSelect.value : "";
      }

      // Auton Starting Bar coordinates mapping
      record.pinX = window.activePinX !== null ? window.activePinX : "";
      record.pinY = window.activePinY !== null ? window.activePinY : "";

      return record;
    }

    /**
     * scoring counter logger increments
     */
    logEventAction(phase, field, increment = 1) {
      const hiddenInput = document.getElementById(field);
      const displayVal = document.getElementById(`val-${field}`);
      if (hiddenInput) {
        let current = parseInt(hiddenInput.value) || 0;
        current += increment;
        hiddenInput.value = current;
        if (displayVal) {
          displayVal.textContent = current;
        }

        // Push to undo stack
        this.actionHistoryStack.push({ phase, field, increment });
        console.log(`[Event Log] Added action:`, { phase, field, increment }, `Stack: ${this.actionHistoryStack.length}`);

        if (window.feedbackManager) {
          window.feedbackManager.trigger("click");
        }

        this.triggerAutosave();
      }
    }

    /**
     * undo handler for counts
     */
    handleUndoAction(phase) {
      for (let i = this.actionHistoryStack.length - 1; i >= 0; i--) {
        if (this.actionHistoryStack[i].phase === phase) {
          const action = this.actionHistoryStack[i];

          // Revert stack
          this.actionHistoryStack.splice(i, 1);

          // Revert count
          const hiddenInput = document.getElementById(action.field);
          const displayVal = document.getElementById(`val-${action.field}`);
          if (hiddenInput) {
            let current = parseInt(hiddenInput.value) || 0;
            current = Math.max(0, current - action.increment);
            hiddenInput.value = current;
            if (displayVal) {
              displayVal.textContent = current;
            }
          }

          console.log(`[Undo Action] Reverted action:`, action, `Stack: ${this.actionHistoryStack.length}`);

          if (window.feedbackManager) {
            window.feedbackManager.trigger("undo");
          }

          this.triggerAutosave();
          if (window.showToast) {
            window.showToast("Last score action reverted!");
          }
          return;
        }
      }

      if (window.feedbackManager) {
        window.feedbackManager.trigger("warning");
      }
      if (window.showToast) {
        window.showToast("No scoring history found to undo!");
      }
    }

    /**
     * Resets form counters, toggles, penalty buttons, and segmented controls
     */
    resetFormCounters() {
      const counterFields = [
        "preload_made", "preload_miss", "pickup_made", "pickup_miss", "pickup_ovw",
        "close_made", "close_miss", "close_ovw", "far_made", "far_miss", "far_ovw", "gate_opn"
      ];
      counterFields.forEach(field => {
        const hidden = document.getElementById(field);
        const display = document.getElementById(`val-${field}`);
        if (hidden) hidden.value = 0;
        if (display) display.textContent = 0;
      });

      // Clear undo stack
      this.actionHistoryStack = [];

      // Reset range buttons
      document.querySelectorAll(".range-toggle-btn[data-field]").forEach(btn => btn.classList.remove("active"));

      const rangeDefaults = {
        "auto_range": "",
        "auto_park": "On Launch Line",
        "auto_gate": "Avoided gate",
        "telesetup": "Unsure / not a distinct first step",
        "tele_pattern": "no",
        "tele_range": "Unable to tell",
        "defense": "No intentional contact",
        "timetopark": "",
        "park_base": "",
        "park_bonus": ""
      };

      for (const [field, defVal] of Object.entries(rangeDefaults)) {
        const input = document.getElementById(field);
        if (input) input.value = defVal;

        if (defVal !== "") {
          if (field === "park_bonus") continue;

          const defaultBtn = document.querySelector(`.range-toggle-btn[data-field='${field}'][data-value='${defVal}']`);
          if (defaultBtn) {
            defaultBtn.classList.add("active");
          }
        }
      }

      // Reset checkboxes
      document.querySelectorAll(".toggle-checkbox-btn").forEach(btn => btn.classList.remove("active"));

      const checkboxFields = ["auto_pattern", "auto_midline", "auto_penal", "tele_penal"];
      checkboxFields.forEach(field => {
        const input = document.getElementById(field);
        if (input) input.value = "";
      });

      // Default ground for tele_collection
      const teleCollInput = document.getElementById("tele_collection");
      if (teleCollInput) {
        teleCollInput.value = "ground";
        const groundBtn = document.querySelector(".toggle-checkbox-btn[data-value='ground']");
        if (groundBtn) groundBtn.classList.add("active");
      }

      // Reset segmented buttons
      document.querySelectorAll(".segment-btn").forEach(btn => btn.classList.remove("active"));

      const automoveInput = document.getElementById("automove");
      if (automoveInput) automoveInput.value = "No";
      const automoveNoBtn = document.querySelector(".segment-btn[data-field='automove'][data-value='No']");
      if (automoveNoBtn) automoveNoBtn.classList.add("active");

      // Reset alliance
      const allianceInput = document.getElementById("alliance");
      if (allianceInput) allianceInput.value = "";

      // Reset breaks
      const breaksInput = document.getElementById("breaks");
      if (breaksInput) breaksInput.value = "No";
      const breaksNoBtn = document.querySelector(".segment-btn[data-field='breaks'][data-value='No']");
      if (breaksNoBtn) breaksNoBtn.classList.add("active");

      // Navigate setup phase
      if (window.scoutingUI) {
        window.scoutingUI.navigateToPhase("step-setup");
      }
    }

    /**
     * Toggles visibility of the malfunctions list container
     */
    toggleMalfunctionsContainer(value) {
      const container = document.getElementById("malfunctions-container");
      if (!container) return;
      if (value === "Yes") {
        container.style.display = "block";
      } else {
        container.style.display = "none";
        const hiddenInput = document.getElementById("malfunctions");
        if (hiddenInput) {
          hiddenInput.value = "";
        }
        container.querySelectorAll(".toggle-checkbox-btn").forEach(btn => btn.classList.remove("active"));
      }
    }

    /**
     * Parses malfunctions prefix out of comments field and sets controls accordingly
     */
    parseCommentsAndExtractMalfunctions() {
      const commentsEl = document.getElementById("comments");
      if (!commentsEl) return;

      let text = commentsEl.value || "";
      const match = text.match(/^\[Failures:\s*([^\]]+)\]\s*/);
      if (match) {
        const malfunctionsList = match[1];
        commentsEl.value = text.replace(/^\[Failures:\s*([^\]]+)\]\s*/, "");

        const malfunctionsInput = document.getElementById("malfunctions");
        if (malfunctionsInput) {
          malfunctionsInput.value = malfunctionsList;
        }

        const breaksInput = document.getElementById("breaks");
        if (breaksInput) {
          breaksInput.value = "Yes";
        }

        document.querySelectorAll(".segment-btn[data-field='breaks']").forEach(btn => {
          if (btn.getAttribute("data-value") === "Yes") {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });

        this.toggleMalfunctionsContainer("Yes");
        const activeVals = malfunctionsList.split(", ").map(v => v.trim()).filter(Boolean);
        const container = document.getElementById("malfunctions-container");
        if (container) {
          container.querySelectorAll(".toggle-checkbox-btn").forEach(btn => {
            if (activeVals.includes(btn.getAttribute("data-value"))) {
              btn.classList.add("active");
            } else {
              btn.classList.remove("active");
            }
          });
        }
      }
    }
  }

  // Instantiate globally
  window.formManager = new ScoutingForm();
  window.triggerAutosave = () => window.formManager.triggerAutosave();
  window.resetFormCounters = () => window.formManager.resetFormCounters();
})();
