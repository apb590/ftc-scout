/**
 * app.js - Main Application Controller
 * Handles routing, component triggers, form actions, and draft persistence.
 */
document.addEventListener("DOMContentLoaded", async () => {
  // Initialize Database and Sync Manager
  try {
    await window.dbManager.init();
    console.log("[App] Database initialized in app scope");
    
    // Fetch and cache the qualification schedule on startup if online
    if (window.syncManager && navigator.onLine) {
      window.syncManager.fetchAndCacheQualSchedule();
    }
  } catch (err) {
    console.error("[App] Failed to load database layer:", err);
  }

  // 1. PWA Service Worker Registration
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          console.log("[Service Worker] Registered successfully with scope:", reg.scope);
        })
        .catch((err) => {
          console.warn("[Service Worker] Registration failed:", err);
        });
    });
  }

  // 2. State & Elements References
  const form = document.getElementById("scouting-form");
  const allianceInput = document.getElementById("alliance");
  const robotposInput = document.getElementById("robotpos");
  const settingsModal = document.getElementById("settings-modal");
  const qrModal = document.getElementById("qr-modal");
  const toastBanner = document.getElementById("toast-notification");
  const toastMsg = document.getElementById("toast-message");

  let canvasInstance = null;
  // Coordinates coordinates
  let activePinX = null;
  let activePinY = null;

  // Initialize sync status on load
  if (window.syncManager) {
    window.syncManager.updateSyncIndicators();
    // Attempt auto-sync immediately if online on startup
    if (navigator.onLine) {
      window.syncManager.processSyncQueue();
    }
  }

  // 3. Tab Routing Logic
  const tabs = document.querySelectorAll(".nav-tab");
  const sections = document.querySelectorAll(".form-section");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      sections.forEach(s => s.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-target");
      document.getElementById(targetId).classList.add("active");

      // Redraw canvas if returning to form view to prevent scaling glitch
      if (targetId === "scout-section" && canvasInstance) {
        setTimeout(() => canvasInstance.draw(), 50);
      }

      // Re-render history list if switching to logs
      if (targetId === "history-section") {
        renderHistoryList();
      }

      // Query flagged audit logs if switching to audits
      if (targetId === "audit-section") {
        renderAuditLogsList();
      }
    });
  });

  // 4. Alliance Styling & Accent Switchers
  const redBtn = document.getElementById("alliance-btn-red");
  const blueBtn = document.getElementById("alliance-btn-blue");

  function setAllianceStyle(alliance) {
    if (alliance === "Red") {
      document.body.classList.remove("alliance-blue");
      document.body.classList.add("alliance-red");
      redBtn.classList.add("active");
      blueBtn.classList.remove("active");
    } else {
      document.body.classList.remove("alliance-red");
      document.body.classList.add("alliance-blue");
      blueBtn.classList.add("active");
      redBtn.classList.remove("active");
    }
    allianceInput.value = alliance;
    triggerAutosave();
  }

  redBtn.addEventListener("click", () => setAllianceStyle("Red"));
  blueBtn.addEventListener("click", () => setAllianceStyle("Blue"));

  // 5. Segmented Button Generic Handlers
  const genericSegmentBtns = document.querySelectorAll(".segment-btn[data-field]");
  genericSegmentBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const fieldId = btn.getAttribute("data-field");
      const value = btn.getAttribute("data-value");
      const container = btn.closest(".segmented-container");
      
      // Reset siblings active states
      container.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Write value to hidden sibling input
      const hiddenInput = document.getElementById(fieldId);
      if (hiddenInput) {
        hiddenInput.value = value;
        if (fieldId === "breaks") {
          toggleMalfunctionsContainer(value);
        }
        triggerAutosave();
      }
    });
  });

  // 6. Interactive Canvas Map Initialization
  const canvasEl = document.getElementById("starting-pos-canvas");
  if (canvasEl) {
    canvasInstance = new window.ScoutingCanvas(canvasEl, (zoneString, x, y) => {
      robotposInput.value = zoneString;
      activePinX = x;
      activePinY = y;
      triggerAutosave();
    });

    // Start map loaded to default view style
    canvasInstance.setTheme("default");
  }

  // 7. Digital Counter Incrementor Modifier Handles
  const minusBtns = document.querySelectorAll(".counter-btn.minus");
  const plusBtns = document.querySelectorAll(".counter-btn:not(.minus)");

  minusBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const hiddenInput = document.getElementById(targetId);
      const displayVal = document.getElementById(`val-${targetId}`);

      if (hiddenInput && displayVal) {
        let current = parseInt(hiddenInput.value) || 0;
        if (current > 0) {
          current--;
          hiddenInput.value = current;
          displayVal.textContent = current;
          triggerAutosave();
        }
      }
    });
  });

  plusBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const hiddenInput = document.getElementById(targetId);
      const displayVal = document.getElementById(`val-${targetId}`);

      if (hiddenInput && displayVal) {
        let current = parseInt(hiddenInput.value) || 0;
        current++;
        hiddenInput.value = current;
        displayVal.textContent = current;
        triggerAutosave();
      }
    });
  });

  // 8. Settings Overlay Modal Drawer Functions
  const openSettingsBtn = document.getElementById("open-settings-btn");
  const closeSettingsBtn = document.getElementById("close-settings-modal-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const settingSyncUrlInput = document.getElementById("setting-sync-endpoint");

  openSettingsBtn.addEventListener("click", () => {
    // Populate current local settings values
    settingSyncUrlInput.value = window.syncManager.getSyncEndpoint();
    settingsModal.classList.add("active");
  });

  closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("active");
  });

  saveSettingsBtn.addEventListener("click", () => {
    const newEndpoint = settingSyncUrlInput.value.trim();

    if (newEndpoint) {
      window.syncManager.setSyncEndpoint(newEndpoint);
    }

    settingsModal.classList.remove("active");
    showToast("Settings Saved Successfully!");
  });

  // --- Upgraded Custom Webapp UI Controls ---
  // A. Preload Log Actions (Strict 3 Max sum combined between Scored & Missed)
  const btnPreloadMade = document.getElementById("btn-preload-made");
  const btnPreloadMiss = document.getElementById("btn-preload-miss");
  const preloadMadeInput = document.getElementById("preload_made");
  const preloadMissInput = document.getElementById("preload_miss");

  if (btnPreloadMade && btnPreloadMiss && preloadMadeInput && preloadMissInput) {
    btnPreloadMade.addEventListener("click", () => {
      const made = parseInt(preloadMadeInput.value) || 0;
      const miss = parseInt(preloadMissInput.value) || 0;
      if (made + miss >= 3) {
        showToast("Maximum of 3 combined preloads reached!");
        return;
      }
      preloadMadeInput.value = made + 1;
      document.getElementById("val-preload_made").textContent = made + 1;
      actionHistoryStack.push({ phase: "preload", field: "preload_made", increment: 1 });
      triggerAutosave();
    });

    btnPreloadMiss.addEventListener("click", () => {
      const made = parseInt(preloadMadeInput.value) || 0;
      const miss = parseInt(preloadMissInput.value) || 0;
      if (made + miss >= 3) {
        showToast("Maximum of 3 combined preloads reached!");
        return;
      }
      preloadMissInput.value = miss + 1;
      document.getElementById("val-preload_miss").textContent = miss + 1;
      actionHistoryStack.push({ phase: "preload", field: "preload_miss", increment: 1 });
      triggerAutosave();
    });
  }

  // B. Generic Mutually-Exclusive Range & Parking Toggles
  document.querySelectorAll(".range-toggle-btn[data-field]").forEach(btn => {
    btn.addEventListener("click", () => {
      const fieldId = btn.getAttribute("data-field");
      const val = btn.getAttribute("data-value");
      const hiddenInput = document.getElementById(fieldId);
      
      if (hiddenInput) {
        const container = btn.closest(".range-toggle-container");
        
        if (btn.classList.contains("active")) {
          // Deactivate
          btn.classList.remove("active");
          hiddenInput.value = fieldId === "auto_range" ? "No shots taken / unknown" : "None";
        } else {
          // Activate this one, deactivate siblings
          container.querySelectorAll(".range-toggle-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          hiddenInput.value = val;
        }
        triggerAutosave();
      }
    });
  });

  // C. Tap-to-Toggle Penalty Checkbox Grids
  document.querySelectorAll(".toggle-checkbox-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      const container = btn.closest(".toggle-checkbox-container");
      const fieldId = container.getAttribute("data-field");
      const hiddenInput = document.getElementById(fieldId);
      
      if (hiddenInput) {
        const activeVals = Array.from(container.querySelectorAll(".toggle-checkbox-btn.active"))
          .map(b => b.getAttribute("data-value"));
        hiddenInput.value = activeVals.join(", ");
        triggerAutosave();
      }
    });
  });

  // 9. Active Form Buffer Autosave Trigger
  let autosaveTimeout = null;
  
  function triggerAutosave() {
    clearTimeout(autosaveTimeout);
    // Debounce autosave to run 600ms after final keystroke
    autosaveTimeout = setTimeout(saveFormStateDraft, 600);
  }

  // Bind change listeners to all standard controls inside scouting form
  form.querySelectorAll("input, select, textarea").forEach(input => {
    input.addEventListener("input", triggerAutosave);
    input.addEventListener("change", triggerAutosave);
  });

  async function saveFormStateDraft() {
    const formData = compileFormStateJSON();
    try {
      await window.dbManager.saveDraft(formData);
      // Subtle background log
      console.log("[Autosave] Draft written to IndexedDB");
    } catch (e) {
      console.warn("[Autosave] Failed to write draft:", e);
    }
  }

  // Compile full form data object (incorporating 35 target schema elements)
  function compileFormStateJSON() {
    const data = {};
    
    // Core inputs (1-35 mapped fields)
    const elementsToIngest = [
      "teamno", "matchno", "alliance", "robotpos", "automove",
      "preload_made", "preload_miss", "pickup_made", "pickup_miss", "pickup_ovw",
      "auto_range", "auto_pattern", "auto_gate", "auto_midline", "auto_park",
      "auto_penal", "telesetup", "close_made", "close_miss", "close_ovw",
      "far_made", "far_miss", "far_ovw", "gate_opn", "tele_collection",
      "tele_pattern", "tele_range", "defense", "timetopark", "park_base",
      "park_bonus", "tele_penal", "breaks", "comments", "username", "malfunctions"
    ];

    elementsToIngest.forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        // Parse numbers specifically to preserve data types in spreadsheet
        if (el.type === "number") {
          data[key] = el.value === "" ? "" : parseInt(el.value) || 0;
        } else {
          data[key] = el.value;
        }
      }
    });

    // Append canvas crosshair coordinates metadata
    data.pinX = activePinX;
    data.pinY = activePinY;

    return data;
  }

  // Load existing form state drafts upon launch
  async function restoreFormStateDraft() {
    try {
      const draft = await window.dbManager.getDraft();
      if (!draft) return;

      console.log("[App] Active draft recovered. Re-populating form controls.");

      // Restore basic inputs
      for (const [key, val] of Object.entries(draft)) {
        const el = document.getElementById(key);
        if (el) {
          el.value = val;
          // If counter display exists, sync it
          const counterDisplay = document.getElementById(`val-${key}`);
          if (counterDisplay) {
            counterDisplay.textContent = val;
          }
        }
      }

      // Restore Alliance styles
      if (draft.alliance) {
        setAllianceStyle(draft.alliance);
      }

      // Restore Segmented buttons states (Yes/No options)
      document.querySelectorAll(".segment-btn[data-field]").forEach(btn => {
        const field = btn.getAttribute("data-field");
        const val = btn.getAttribute("data-value");
        if (draft[field] === val) {
          const container = btn.closest(".segmented-container");
          container.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          if (field === "breaks") {
            toggleMalfunctionsContainer(val);
          }
        }
      });

      // Restore Canvas Pin crosshair overlay
      // Morph the team number selector if match was restored
      updateTeamSelector();
      
      // If team selector has a value, restore it as select option if applicable
      const teamSelector = document.getElementById("teamno");
      if (teamSelector && draft.teamno) {
        teamSelector.value = draft.teamno;
      }

      // Restore Shooting Range toggles & Auton Parking toggles
      document.querySelectorAll(".range-toggle-btn[data-field]").forEach(btn => {
        const field = btn.getAttribute("data-field");
        const val = btn.getAttribute("data-value");
        if (draft[field] === val) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      // Restore penalty toggle checkbox buttons active states
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

      // Restore Canvas Pin crosshair overlay
      if (draft.pinX !== null && draft.pinY !== null && canvasInstance) {
        activePinX = draft.pinX;
        activePinY = draft.pinY;
        canvasInstance.setPinPosition(activePinX, activePinY);
      }

      showToast("Unfinished Scouting Draft Restored!");
    } catch (e) {
      console.warn("[App] Error restoring form state draft:", e);
    }
  }

  const matchnoInput = document.getElementById("matchno");
  const teamnoContainer = document.getElementById("teamno-container");
  
  if (matchnoInput && teamnoContainer) {
    matchnoInput.addEventListener("input", updateTeamSelector);
    matchnoInput.addEventListener("change", updateTeamSelector);
  }

  const testMatchNumbers = [123, 999, 9999, 1234, 1000];

  function updateTeamSelector() {
    if (!matchnoInput || !teamnoContainer) return;
    
    const matchVal = parseInt(matchnoInput.value);
    const testDataBanner = document.getElementById("test-data-banner");
    
    // Check if it is a test match number
    if (testMatchNumbers.includes(matchVal)) {
      if (testDataBanner) {
        testDataBanner.style.display = "block";
      }
      
      let teamSelect = document.getElementById("teamno");
      if (!teamSelect || teamSelect.tagName !== "SELECT") {
        const selectEl = document.createElement("select");
        selectEl.id = "teamno";
        selectEl.className = "input-control";
        selectEl.required = true;
        
        teamnoContainer.innerHTML = "";
        teamnoContainer.appendChild(selectEl);
        teamSelect = selectEl;
        
        // Add event listeners to autosave and update alliance color based on test team
        teamSelect.addEventListener("change", () => {
          const selectedTeam = parseInt(teamSelect.value);
          if (selectedTeam === 88881 || selectedTeam === 88882) {
            setAllianceStyle("Red");
          } else if (selectedTeam === 88883 || selectedTeam === 88884) {
            setAllianceStyle("Blue");
          }
          triggerAutosave();
        });
      }
      
      const currentValue = teamSelect.value;
      teamSelect.innerHTML = "";
      
      // Default placeholder
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "-- Select Test Team --";
      teamSelect.appendChild(defaultOpt);
      
      const testTeams = [
        { num: 88881, label: "88881 (Red Test Team)", alliance: "Red" },
        { num: 88882, label: "88882 (Red Test Team)", alliance: "Red" },
        { num: 88883, label: "88883 (Blue Test Team)", alliance: "Blue" },
        { num: 88884, label: "88884 (Blue Test Team)", alliance: "Blue" }
      ];
      
      testTeams.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.num;
        opt.textContent = t.label;
        if (t.alliance === "Red") {
          opt.style.color = "var(--color-error)";
        } else {
          opt.style.color = "#2563eb";
        }
        teamSelect.appendChild(opt);
      });
      
      if (currentValue && testTeams.some(t => String(t.num) === String(currentValue))) {
        teamSelect.value = currentValue;
      }
    } else {
      if (testDataBanner) {
        testDataBanner.style.display = "none";
      }
      
      const savedSchedule = localStorage.getItem("qual_schedule");
      const schedule = savedSchedule ? JSON.parse(savedSchedule) : null;
      
      // Find if the match is in the schedule
      if (matchVal && schedule && schedule[matchVal]) {
        const matchDetails = schedule[matchVal];
        
        let teamSelect = document.getElementById("teamno");
        if (!teamSelect || teamSelect.tagName !== "SELECT") {
          const selectEl = document.createElement("select");
          selectEl.id = "teamno";
          selectEl.className = "input-control";
          selectEl.required = true;
          
          teamnoContainer.innerHTML = "";
          teamnoContainer.appendChild(selectEl);
          teamSelect = selectEl;
          
          // Add event listeners to the new select to autosave and update alliance color
          teamSelect.addEventListener("change", () => {
            updateAllianceColorForTeam(teamSelect.value, matchDetails);
            triggerAutosave();
          });
        }
        
        const currentValue = teamSelect.value;
        teamSelect.innerHTML = "";
        
        // Default placeholder option
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "-- Select Team --";
        teamSelect.appendChild(defaultOpt);
        
        const teams = [
          { num: matchDetails.red1, label: `${matchDetails.red1} (Red)`, alliance: "Red" },
          { num: matchDetails.red2, label: `${matchDetails.red2} (Red)`, alliance: "Red" },
          { num: matchDetails.blue1, label: `${matchDetails.blue1} (Blue)`, alliance: "Blue" },
          { num: matchDetails.blue2, label: `${matchDetails.blue2} (Blue)`, alliance: "Blue" }
        ];
        
        teams.forEach(t => {
          if (t.num) {
            const opt = document.createElement("option");
            opt.value = t.num;
            opt.textContent = t.label;
            teamSelect.appendChild(opt);
          }
        });
        
        // Try to preserve previous selection if it's one of the 4 teams
        if (currentValue && teams.some(t => String(t.num) === String(currentValue))) {
          teamSelect.value = currentValue;
        }
      } else {
        // Restore input type="number"
        let teamInput = document.getElementById("teamno");
        if (!teamInput || teamInput.tagName !== "INPUT") {
          const inputEl = document.createElement("input");
          inputEl.type = "number";
          inputEl.id = "teamno";
          inputEl.className = "input-control";
          inputEl.placeholder = "e.g. 16379";
          inputEl.min = "1";
          inputEl.required = true;
          
          teamnoContainer.innerHTML = "";
          teamnoContainer.appendChild(inputEl);
          teamInput = inputEl;
          
          // Add event listeners
          teamInput.addEventListener("input", triggerAutosave);
          teamInput.addEventListener("change", triggerAutosave);
        }
      }
    }
  }

  function updateAllianceColorForTeam(selectedTeam, matchDetails) {
    if (!selectedTeam || !matchDetails) return;
    const teamNum = parseInt(selectedTeam);
    if (teamNum === matchDetails.red1 || teamNum === matchDetails.red2) {
      setAllianceStyle("Red");
    } else if (teamNum === matchDetails.blue1 || teamNum === matchDetails.blue2) {
      setAllianceStyle("Blue");
    }
  }

  // Expose updateTeamSelector globally
  window.updateTeamSelector = updateTeamSelector;

  // Step-by-Step Phase Routing Navigation
  const phaseSteps = document.querySelectorAll(".phase-step");
  const progressSteps = document.querySelectorAll(".progress-step");
  const progressLineFill = document.getElementById("phase-progress-line-fill");

  let currentPhaseIndex = 0; // 0: setup, 1: auton, 2: teleop, 3: review
  const phaseIds = ["step-setup", "step-auton", "step-teleop", "step-review"];

  function validateSetupPhase() {
    const username = document.getElementById("username").value.trim();
    const matchno = document.getElementById("matchno").value;
    const teamno = document.getElementById("teamno").value;

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

  function navigateToPhase(phaseId) {
    const targetIndex = phaseIds.indexOf(phaseId);
    if (targetIndex === -1) return;

    // If navigating forward from Setup phase, validate fields first!
    if (currentPhaseIndex === 0 && targetIndex > 0) {
      if (!validateSetupPhase()) return;
    }

    // Deactivate current step
    phaseSteps.forEach(step => step.classList.remove("active"));
    progressSteps.forEach(step => step.classList.remove("active"));

    // Activate target step
    const targetStep = document.getElementById(phaseId);
    if (targetStep) {
      targetStep.classList.add("active");
    }

    // Set active class on progress indicators
    for (let i = 0; i <= targetIndex; i++) {
      const indicator = document.querySelector(`.progress-step[data-step="${phaseIds[i]}"]`);
      if (indicator) {
        if (i === targetIndex) {
          indicator.classList.add("active");
          indicator.classList.remove("completed");
        } else {
          indicator.classList.add("completed");
        }
      }
    }
    
    // Remove active and completed classes from forward steps
    for (let i = targetIndex + 1; i < phaseIds.length; i++) {
      const indicator = document.querySelector(`.progress-step[data-step="${phaseIds[i]}"]`);
      if (indicator) {
        indicator.classList.remove("active");
        indicator.classList.remove("completed");
      }
    }

    // Animate progress connecting line fill width
    if (progressLineFill) {
      const percentage = (targetIndex / (phaseIds.length - 1)) * 100;
      progressLineFill.style.width = `${percentage}%`;
    }

    currentPhaseIndex = targetIndex;
    
    // Smooth scroll to top of page
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Redraw map canvas if setup step is active
    if (phaseId === "step-setup" && canvasInstance) {
      setTimeout(() => canvasInstance.draw(), 50);
    }
  }

  // Bind next/prev button clicks
  document.querySelectorAll(".btn-next").forEach(btn => {
    btn.addEventListener("click", () => {
      const nextPhaseId = btn.getAttribute("data-next");
      navigateToPhase(nextPhaseId);
    });
  });

  document.querySelectorAll(".btn-prev").forEach(btn => {
    btn.addEventListener("click", () => {
      const prevPhaseId = btn.getAttribute("data-prev");
      navigateToPhase(prevPhaseId);
    });
  });

  // Bind clicks on progress tracker circles/labels to jump directly
  progressSteps.forEach(step => {
    step.addEventListener("click", () => {
      const targetPhaseId = step.getAttribute("data-step");
      navigateToPhase(targetPhaseId);
    });
  });

  // Event-Based Actions Logging & Undo Stack Logic
  let actionHistoryStack = [];
  
  function logEventAction(phase, field, increment = 1) {
    const hiddenInput = document.getElementById(field);
    const displayVal = document.getElementById(`val-${field}`);
    if (hiddenInput) {
      let current = parseInt(hiddenInput.value) || 0;
      current += increment;
      hiddenInput.value = current;
      if (displayVal) {
        displayVal.textContent = current;
      }
      
      // Push to the event stack
      actionHistoryStack.push({ phase, field, increment });
      console.log(`[Event Log] Added action to stack:`, { phase, field, increment }, `Stack Size: ${actionHistoryStack.length}`);
      
      triggerAutosave();
    }
  }

  function handleUndoAction(phase) {
    // Search stack right-to-left for the last action matching this phase
    for (let i = actionHistoryStack.length - 1; i >= 0; i--) {
      if (actionHistoryStack[i].phase === phase) {
        const action = actionHistoryStack[i];
        
        // Remove from stack
        actionHistoryStack.splice(i, 1);
        
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
        
        console.log(`[Undo Action] Reverted action from stack:`, action, `Stack Size: ${actionHistoryStack.length}`);
        triggerAutosave();
        showToast("Last score action reverted!");
        return;
      }
    }
    showToast("No scoring history found to undo!");
  }

  // Bind Action Event logging buttons
  document.querySelectorAll(".event-log-btn[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = btn.getAttribute("data-action");
      const add = parseInt(btn.getAttribute("data-add")) || 1;
      let phase = "auton";
      if (field.startsWith("close")) {
        phase = "close";
      } else if (field.startsWith("far")) {
        phase = "far";
      }
      logEventAction(phase, field, add);
    });
  });

  // Bind Undo buttons
  document.querySelectorAll(".event-log-btn[data-undo]").forEach(btn => {
    btn.addEventListener("click", () => {
      const phase = btn.getAttribute("data-undo");
      handleUndoAction(phase);
    });
  });

  // Restore draft state immediately on load
  await restoreFormStateDraft();

  // 10. Form Submission Actions Handle
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Verify fields
    const username = document.getElementById("username").value.trim();
    const matchno = document.getElementById("matchno").value;
    const teamno = document.getElementById("teamno").value;

    if (!username || !matchno || !teamno) {
      alert("Please ensure Scouter Name, Match, and Team fields are completed!");
      return;
    }

    // Verify scouter name pattern (first_lastinitial e.g. alden_h)
    const nameRegex = /^[a-zA-Z]+_[a-zA-Z]$/;
    if (!nameRegex.test(username)) {
      alert("Please enter Scouter Name in the correct format: first_lastinitial (e.g., alden_h)");
      return;
    }

    const finalRecord = compileFormStateJSON();
    
    // Auto-prepend malfunctions to comments if breaks === Yes and malfunctions are selected
    const breaksEl = document.getElementById("breaks");
    const malfunctionsEl = document.getElementById("malfunctions");
    if (breaksEl && breaksEl.value === "Yes" && malfunctionsEl && malfunctionsEl.value) {
      const prefix = `[Failures: ${malfunctionsEl.value}]`;
      let currentComments = finalRecord.comments || "";
      if (!currentComments.startsWith("[Failures:")) {
        finalRecord.comments = `${prefix} ${currentComments}`.trim();
      } else {
        currentComments = currentComments.replace(/^\[Failures:[^\]]+\]\s*/, "");
        finalRecord.comments = `${prefix} ${currentComments}`.trim();
      }
    }

    // Intercept with real-time Out-of-Bounds guard check (Limits: 20 auton, 50 teleop)
    const autoElements = (parseInt(finalRecord.preload_made) || 0) + (parseInt(finalRecord.pickup_made) || 0) + (parseInt(finalRecord.pickup_ovw) || 0);
    const teleOpElements = (parseInt(finalRecord.close_made) || 0) + (parseInt(finalRecord.far_made) || 0) + (parseInt(finalRecord.close_ovw) || 0) + (parseInt(finalRecord.far_ovw) || 0);
    
    if (autoElements > 20 || teleOpElements > 50) {
      const confirmSubmit = confirm(`⚠️ HIGH SCORING OUTLIER DETECTED!\n\n- Auton Elements Scored: ${autoElements} (Warning limit: 20)\n- Teleop Elements Scored: ${teleOpElements} (Warning limit: 50)\n\nThese values are exceptionally high and might indicate double-tapping errors. Are you absolutely certain these match counts are correct?`);
      if (!confirmSubmit) return;
    }
    
    try {
      // 1. Save finalized record to IndexedDB
      await window.dbManager.saveRecord(finalRecord);
      
      // 2. Clear working autosave buffer
      await window.dbManager.clearDraft();

      // 3. Reset form states (Counters back to 0, clear canvas pin)
      form.reset();
      resetFormCounters();
      updateTeamSelector();
      activePinX = null;
      activePinY = null;
      if (canvasInstance) {
        canvasInstance.clearPin();
      }

      // Repopulate Scouter Name for next scout matches (UX helper)
      document.getElementById("username").value = finalRecord.username;

      // 4. Trigger auto sync queue in background
      if (window.syncManager) {
        window.syncManager.processSyncQueue();
      }

      showToast("Scouting Record Saved Successfully!");
      
      // Switch view back to top or logs to verify
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);

    } catch (err) {
      console.error("[App] Submission pipeline error:", err);
      alert("Failed to save scouting record offline: " + err.message);
    }
  });

  // Safe Form Clearing & Reset handler (Preserves Scouter Name, clears draft buffers)
  const clearFormBtn = document.getElementById("clear-form-btn");
  if (clearFormBtn) {
    clearFormBtn.addEventListener("click", async () => {
      const confirmClear = confirm("⚠️ Reset Scouting Form?\n\nAre you sure you want to clear the entire form? This will permanently wipe all of your current unsaved match inputs.");
      if (confirmClear) {
        // Save the scouter name so it doesn't get lost
        const savedName = document.getElementById("username").value;
        
        // Reset form controls
        form.reset();
        resetFormCounters();
        updateTeamSelector();
        activePinX = null;
        activePinY = null;
        if (canvasInstance) {
          canvasInstance.clearPin();
        }
        
        // Restore scouter name
        document.getElementById("username").value = savedName;
        
        // Clear IndexedDB active draft buffer to prevent auto-restoring
        await window.dbManager.clearDraft();
        
        showToast("Scouting Form Reset Successfully!");
        
        // Scroll smoothly to top
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  function resetFormCounters() {
    const counterFields = [
      "preload_made", "preload_miss", "pickup_made", "pickup_miss", "pickup_ovw",
      "close_made", "close_miss", "close_ovw", "far_made", "far_miss", "far_ovw"
    ];
    counterFields.forEach(field => {
      const hidden = document.getElementById(field);
      const display = document.getElementById(`val-${field}`);
      if (hidden) hidden.value = 0;
      if (display) display.textContent = 0;
    });

    // Reset action history stack
    actionHistoryStack = [];

    // Reset range and parking toggles
    document.querySelectorAll(".range-toggle-btn[data-field]").forEach(btn => btn.classList.remove("active"));
    const autoRangeInput = document.getElementById("auto_range");
    if (autoRangeInput) autoRangeInput.value = "No shots taken / unknown";
    const autoParkInput = document.getElementById("auto_park");
    if (autoParkInput) autoParkInput.value = "None";

    // Reset penalty toggle checkbox buttons
    document.querySelectorAll(".toggle-checkbox-btn").forEach(btn => btn.classList.remove("active"));
    const autoPenalInput = document.getElementById("auto_penal");
    if (autoPenalInput) autoPenalInput.value = "";
    const telePenalInput = document.getElementById("tele_penal");
    if (telePenalInput) telePenalInput.value = "";

    // Reset segmented selector states back to default (No / No failures)
    document.querySelectorAll(".segment-btn[data-value='No']").forEach(btn => {
      btn.click();
    });

    // Navigate back to Setup phase
    navigateToPhase("step-setup");
  }

  function toggleMalfunctionsContainer(value) {
    const container = document.getElementById("malfunctions-container");
    if (!container) return;
    if (value === "Yes") {
      container.style.display = "block";
    } else {
      container.style.display = "none";
      // Clear malfunctions hidden input and button active states when set to No
      const hiddenInput = document.getElementById("malfunctions");
      if (hiddenInput) {
        hiddenInput.value = "";
      }
      container.querySelectorAll(".toggle-checkbox-btn").forEach(btn => btn.classList.remove("active"));
    }
  }

  function parseCommentsAndExtractMalfunctions() {
    const commentsEl = document.getElementById("comments");
    if (!commentsEl) return;
    
    let text = commentsEl.value || "";
    const match = text.match(/^\[Failures:\s*([^\]]+)\]\s*/);
    if (match) {
      const malfunctionsList = match[1];
      // Clean up the comments field text in UI
      commentsEl.value = text.replace(/^\[Failures:\s*([^\]]+)\]\s*/, "");
      
      // Set malfunctions input value
      const malfunctionsInput = document.getElementById("malfunctions");
      if (malfunctionsInput) {
        malfunctionsInput.value = malfunctionsList;
      }
      
      // Toggle breaks to Yes
      const breaksInput = document.getElementById("breaks");
      if (breaksInput) {
        breaksInput.value = "Yes";
      }
      
      // Update segmented button active styles for breaks
      document.querySelectorAll(".segment-btn[data-field='breaks']").forEach(btn => {
        if (btn.getAttribute("data-value") === "Yes") {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
      
      // Show container and active buttons
      toggleMalfunctionsContainer("Yes");
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

  let toastTimeout = null;
  function showToast(message) {
    clearTimeout(toastTimeout);
    toastMsg.textContent = message;
    toastBanner.classList.add("active");
    
    toastTimeout = setTimeout(() => {
      toastBanner.classList.remove("active");
    }, 3000);
  }

  // 12. Local Submission History List Builder
  const historyListContainer = document.getElementById("history-list-container");

  async function renderHistoryList() {
    if (!historyListContainer) return;

    try {
      const records = await window.dbManager.getAllRecords();
      
      if (records.length === 0) {
        historyListContainer.innerHTML = `<div class="history-empty">No scout records have been logged in the local offline database yet.</div>`;
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

      historyListContainer.innerHTML = listHtml;

      // Bind show QR Code overlay triggers to row action buttons
      document.querySelectorAll(".view-qr-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const recId = btn.getAttribute("data-id");
          triggerQROverlay(recId);
        });
      });

    } catch (e) {
      console.error("[App] Render history error:", e);
      historyListContainer.innerHTML = `<div class="history-empty" style="color:var(--color-error)">Failed to read history logs from IndexedDB.</div>`;
    }
  }

  // Export renderHistoryList globally so sync wrappers can call it
  window.renderHistoryList = renderHistoryList;

  // 13. Offline QR Code Overlay Generator Panel
  const qrCanvas = document.getElementById("qr-display-canvas");
  const qrRecordIdField = document.getElementById("qr-record-id-field");
  const closeQRModalBtn = document.getElementById("close-qr-modal-btn");
  const closeQRModalActionBtn = document.getElementById("close-qr-modal-action-btn");
  const qrModalTitle = document.getElementById("qr-modal-title");

  async function triggerQROverlay(recordId) {
    try {
      const records = await window.dbManager.getAllRecords();
      const targetRecord = records.find(r => r.id === recordId);
      
      if (!targetRecord) {
        alert("Scout record not found in IndexedDB!");
        return;
      }

      qrModalTitle.textContent = `Offline QR: Team ${targetRecord.teamno}`;
      qrRecordIdField.value = recordId;

      // Draw QR Code onto modal canvas via Sync Manager
      if (window.syncManager) {
        const status = window.syncManager.generateQRForRecord(targetRecord, qrCanvas);
        if (status) {
          qrModal.classList.add("active");
        } else {
          alert("QR Code Generation failed mathematically!");
        }
      }
    } catch (e) {
      console.error("[App] Failed to generate QR overlay:", e);
    }
  }

  closeQRModalBtn.addEventListener("click", () => qrModal.classList.remove("active"));
  closeQRModalActionBtn.addEventListener("click", () => qrModal.classList.remove("active"));

  // 14. History Card Export Bindings Setup
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    if (window.syncManager) window.syncManager.exportAllToCSV();
  });

  document.getElementById("btn-export-json").addEventListener("click", () => {
    if (window.syncManager) window.syncManager.exportAllToJSON();
  });

  document.getElementById("btn-trigger-sync").addEventListener("click", async () => {
    if (!navigator.onLine) {
      alert("Browser is currently Offline! Auto-sync is blocked until Internet is restored.");
      return;
    }
    
    showToast("Triggering forced ingestion sync...");
    
    if (window.syncManager) {
      // Refresh qual schedule when forcing a sync
      await window.syncManager.fetchAndCacheQualSchedule();
      const syncedCount = await window.syncManager.processSyncQueue();
      showToast(`Successfully synced ${syncedCount} entries!`);
    }
  });

  // ----------------============================================================
  // PART 15: REAL-TIME SCOUTING DISCREPANCY AUDITING & FEEDBACK LOOP
  // ------------------------------------------------============================
  
  const auditListContainer = document.getElementById("audit-list-container");
  const btnFetchFlagged = document.getElementById("btn-fetch-flagged");
  let activeFlaggedRecords = []; // Global memory array for active audits

  btnFetchFlagged.addEventListener("click", () => renderAuditLogsList());

  async function renderAuditLogsList() {
    if (!auditListContainer) return;

    if (!navigator.onLine) {
      auditListContainer.innerHTML = `<div class="history-empty" style="color:var(--color-error)">Browser is Offline! Live sheet discrepancies cannot be queried while network is down.</div>`;
      return;
    }

    // Refresh qual schedule when loading audit panel to keep scouters up to date
    if (window.syncManager) {
      window.syncManager.fetchAndCacheQualSchedule();
    }

    auditListContainer.innerHTML = `<div class="history-empty animate-pulse">Querying Google Sheets for points discrepancies... Please wait.</div>`;

    try {
      const endpoint = window.syncManager.getSyncEndpoint();
      const response = await fetch(`${endpoint}?action=getFlaggedRecords`);
      
      if (!response.ok) {
        throw new Error("Failed to connect to Google Sheet API. Status: " + response.status);
      }

      activeFlaggedRecords = await response.json();

      if (activeFlaggedRecords.length === 0) {
        auditListContainer.innerHTML = `<div class="history-empty" style="color:hsl(140, 70%, 40%)">✓ All scouted alliance points are aligned with official FIRST scores! Excellent scouting accuracy.</div>`;
        return;
      }

      let listHtml = "";
      activeFlaggedRecords.forEach(rec => {
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

      auditListContainer.innerHTML = listHtml;

      // Bind button click event listeners
      document.querySelectorAll(".btn-correct-audit").forEach(btn => {
        btn.addEventListener("click", () => {
          const recId = btn.getAttribute("data-id");
          handleCorrectAudit(recId);
        });
      });

      document.querySelectorAll(".btn-bypass-audit").forEach(btn => {
        btn.addEventListener("click", () => {
          const recId = btn.getAttribute("data-id");
          handleBypassAudit(recId);
        });
      });

    } catch (e) {
      console.error("[App] Fetch flagged errors fail:", e);
      auditListContainer.innerHTML = `<div class="history-empty" style="color:var(--color-error)">Failed to query flagged records: ${e.message}</div>`;
    }
  }

  // Restores a flagged record's original scout data back into the main form
  function handleCorrectAudit(recordId) {
    const targetRecord = activeFlaggedRecords.find(r => r.id === recordId);
    if (!targetRecord) {
      alert("Flagged record payload not loaded in active memory!");
      return;
    }

    const confirmCorrection = confirm(`Correct and resubmit Team ${targetRecord.teamno} for Match ${targetRecord.matchno}? This will load their values into the form so you can adjust them.`);
    if (!confirmCorrection) return;

    console.log(`[Audit] Replenishing form controls with flagged dataset:`, targetRecord.data);

    // 1. Loop through all 35 schema keys and write values
    for (const [key, val] of Object.entries(targetRecord.data)) {
      const el = document.getElementById(key);
      if (el) {
        el.value = val;
        // Sync visual counter display values if relevant
        const counterDisplay = document.getElementById(`val-${key}`);
        if (counterDisplay) {
          counterDisplay.textContent = val;
        }
      }
    }

    // 2. Set Alliance Styles
    if (targetRecord.alliance) {
      setAllianceStyle(targetRecord.alliance);
    }

    // 3. Set Segmented Yes/No buttons states
    document.querySelectorAll(".segment-btn[data-field]").forEach(btn => {
      const field = btn.getAttribute("data-field");
      const val = btn.getAttribute("data-value");
      if (targetRecord.data[field] === val) {
        const container = btn.closest(".segmented-container");
        container.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (field === "breaks") {
          toggleMalfunctionsContainer(val);
        }
      }
    });

    // 3b. Restore penalty toggle checkbox buttons active states (specifically for malfunctions)
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

    // 3c. Extract malfunctions from comments in correction mode
    parseCommentsAndExtractMalfunctions();

    // 4. Set Canvas coordinates pin if present
    if (canvasInstance) {
      // Look up coordinate floats in record database
      const pinX = targetRecord.data.pinX !== undefined ? parseFloat(targetRecord.data.pinX) : null;
      const pinY = targetRecord.data.pinY !== undefined ? parseFloat(targetRecord.data.pinY) : null;
      if (pinX !== null && pinY !== null && !isNaN(pinX) && !isNaN(pinY)) {
        activePinX = pinX;
        activePinY = pinY;
        canvasInstance.setPinPosition(activePinX, activePinY);
      } else {
        activePinX = null;
        activePinY = null;
        canvasInstance.clearPin();
      }
    }

    // 5. Trigger active form autosave
    triggerAutosave();

    // 6. Navigate user to the Scouting Form tab
    const scoutTabBtn = document.getElementById("tab-scout");
    if (scoutTabBtn) {
      scoutTabBtn.click();
    }

    showToast(`Audit Correction Mode: Team ${targetRecord.teamno} Match ${targetRecord.matchno} loaded!`);
    alert(`AUDIT CORRECTION MODE ACTIVE:\n\nReview Team ${targetRecord.teamno} Match ${targetRecord.matchno}.\nCorrect the erroneous counts based on official FIRST score sheets, and click 'Submit Scouting Entry' to resubmit.`);
  }

  // Force approves/bypasses a validation discrepancy flag using the Admin Password
  async function handleBypassAudit(recordId) {
    const targetRecord = activeFlaggedRecords.find(r => r.id === recordId);
    if (!targetRecord) return;

    const pwd = prompt(`Force approve Team ${targetRecord.teamno} Match ${targetRecord.matchno}?\n\nEnter Lead Scout Password:`);
    if (pwd === null) return; // cancelled
    if (pwd.trim() === "") {
      alert("Password cannot be blank.");
      return;
    }

    showToast("Authenticating bypass credentials...");

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
        showToast("Audit flag successfully bypassed!");
        alert("Bypass Success: Record has been force-approved and returned to analytics.");
        // Refresh flagged list
        renderAuditLogsList();
      } else {
        alert("Bypass Denied: " + result.message);
      }

    } catch (err) {
      console.error("[Audit] Bypass submission error:", err);
      alert("Failed to connect to spreadsheet backend: " + err.message);
    }
  }

  // Bind renderAuditLogsList globally so sync recovering can refresh it
  window.renderAuditLogsList = renderAuditLogsList;

});
