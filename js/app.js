/**
 * app.js - Main Application Bootstrapper & Coordinator
 * Wires up DOM listeners, handles routing navigation clicks, binds inputs,
 * and manages active event selections.
 */

// Global state variables
window.activePinX = null;
window.activePinY = null;
window.canvasInstance = null;
window.activeLiveEventCode = localStorage.getItem("active_live_event_code") || "";
window.selectedEvent = "";
window.activeMode = "research";
window.preEventData = null;

document.addEventListener("DOMContentLoaded", async () => {
  // Query all core DOM elements
  const form = document.getElementById("scouting-form");
  const eventSelect = document.getElementById("event-select");
  const usernameInput = document.getElementById("username");
  const matchnoInput = document.getElementById("matchno");
  const teamnoContainer = document.getElementById("teamno-container");
  const settingsModal = document.getElementById("settings-modal");
  const settingSyncUrlInput = document.getElementById("setting-sync-url");
  const settingAudioCheckbox = document.getElementById("setting-enable-audio");
  const settingHapticsCheckbox = document.getElementById("setting-enable-haptics");
  const btnFetchFlagged = document.getElementById("btn-fetch-flagged");
  
  // Pre-event Elements References
  const preeventContainer = document.getElementById("preevent-container");
  const preeventTeamSelect = document.getElementById("preevent-team-select");
  const preeventMatchInput = document.getElementById("preevent-matchno");
  const preeventAllianceContainer = document.getElementById("preevent-alliance-container");
  const preeventAllianceRed = document.getElementById("preevent-alliance-red");
  const preeventAllianceBlue = document.getElementById("preevent-alliance-blue");
  const preeventLinksContainer = document.getElementById("preevent-links-container");
  const preeventScoutedStatus = document.getElementById("preevent-scouted-status");
  const standardSetupInputs = document.getElementById("standard-setup-inputs");
  const modeBtnLive = document.getElementById("mode-btn-live");
  const modeBtnResearch = document.getElementById("mode-btn-research");

  // Initialize modular UI and Form controllers
  if (window.scoutingUI) window.scoutingUI.init();
  if (window.formManager) window.formManager.init();

  // Heal default Sync Endpoint URL if missing/obsolete on startup
  try {
    const savedUrl = localStorage.getItem("scout_sync_endpoint_url");
    const obsoleteMock = "AKfycbwr8qHhcLIQVY9tUasa_GMvkTpLOk2vdfSQDbjIOLxqGVOavdUA-ef68KhH9n0XPIBerw";
    const defaultUrl = "https://script.google.com/macros/s/AKfycbxJRUak86fAobUoidVDzuiJNHdq23nU8KbodwiwK0KvovdprEE8nm4WVvvn9qLQhgQt/exec";
    if (!savedUrl || savedUrl === "undefined" || savedUrl === "null" || savedUrl.trim() === "" || savedUrl.includes(obsoleteMock)) {
      localStorage.setItem("scout_sync_endpoint_url", defaultUrl);
      console.log("[App] Healed and populated default sync endpoint URL.");
    }
  } catch (err) {
    console.error("[App] Failed to auto-populate sync endpoint URL:", err);
  }

  // Initialize dbManager in background
  if (window.dbManager) {
    window.dbManager.init().catch(err => {
      console.warn("[App] Failed to initialize database in background:", err);
    });
  }

  // Initialize active events dropdown list
  try {
    await initEventDropdown(false);
  } catch (e) {
    console.error("[App] Failed to initialize active events dropdown:", e);
  }

  // Bind refresh active events list
  const refreshEventsBtn = document.getElementById("refresh-events-btn");
  if (refreshEventsBtn) {
    refreshEventsBtn.addEventListener("click", async () => {
      refreshEventsBtn.disabled = true;
      const originalText = refreshEventsBtn.textContent;
      refreshEventsBtn.textContent = "⏳";
      if (window.showToast) window.showToast("Updating active events from Google Sheets...");
      try {
        await initEventDropdown(true);
        if (window.showToast) window.showToast("Events list refreshed successfully!");
      } catch (err) {
        console.error("[App] Failed to refresh events:", err);
        if (window.showToast) window.showToast("Refresh failed. Check Web App URL in Settings.");
      } finally {
        refreshEventsBtn.disabled = false;
        refreshEventsBtn.textContent = originalText;
      }
    });
  }

  // Restore and persist Scouter name
  try {
    if (usernameInput) {
      usernameInput.value = localStorage.getItem("sticky_scouter_name") || "";
      const saveName = () => {
        localStorage.setItem("sticky_scouter_name", usernameInput.value.trim());
        if (window.formManager) window.formManager.triggerAutosave();
      };
      usernameInput.addEventListener("input", saveName);
      usernameInput.addEventListener("change", saveName);
    }
  } catch (e) {
    console.error("[App] Failed to restore sticky scouter name:", e);
  }

  // 1. Dropdown Initialization & Caching Engine
  async function initEventDropdown(fetchFromNetwork = false) {
    if (!eventSelect) return;

    async function fetchWithTimeout(url, options = {}) {
      const { timeout = 8000 } = options;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
      } catch (err) {
        clearTimeout(id);
        throw err;
      }
    }

    const performNetworkFetch = async () => {
      if (window.syncManager) {
        const endpoint = window.syncManager.getSyncEndpoint();
        if (endpoint) {
          // Fetch Admin Configuration
          try {
            const res = await fetchWithTimeout(`${endpoint}?action=getAdminConfig`, { mode: 'cors', redirect: 'follow' });
            if (res.ok) {
              const config = await res.json();
              if (config) {
                const isSimActive = config.simActive === true || config.simActive === 1 || String(config.simActive).toLowerCase() === "true";
                window.activeLiveEventCode = isSimActive ? config.simTargetEvent : config.targetEvent;
                localStorage.setItem("active_live_event_code", window.activeLiveEventCode);
                updateDefaultModeForSelectedEvent();
              }
            }
          } catch (e) {
            console.warn("[App] Failed to fetch admin config:", e);
          }

          // Fetch Active Events List
          try {
            const events = await window.syncManager.fetchEventConfig();
            if (events && events.length > 0) {
              populateDropdownWithOptions(events);
            }
          } catch (e) {
            console.warn("[App] Failed to fetch events from network:", e);
          }
        }
      }
    };

    // Load from cache first
    try {
      const cachedConfig = localStorage.getItem("event_config");
      if (cachedConfig) {
        const events = JSON.parse(cachedConfig);
        populateDropdownWithOptions(events);
      } else {
        eventSelect.innerHTML = `<option value="">-- Select Event (Click ↻) --</option>`;
      }
    } catch (e) {
      console.warn("[App] Failed to parse cached event config:", e);
    }

    // Restore sticky selected event
    let restoredEvent = localStorage.getItem("sticky_event") || "";
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("scouted_event")) {
      restoredEvent = urlParams.get("scouted_event");
    }

    if (restoredEvent) {
      const optionExists = Array.from(eventSelect.options).some(opt => opt.value === restoredEvent);
      if (optionExists) {
        eventSelect.value = restoredEvent;
      }
    }

    if (fetchFromNetwork) {
      await performNetworkFetch();
    }
    updateDefaultModeForSelectedEvent();
    await handleEventSelectionChange();

    function updateDefaultModeForSelectedEvent() {
      window.selectedEvent = eventSelect ? eventSelect.value : "";
      if (!window.selectedEvent) return;

      if (urlParams.has("scouted_event") || window.location.search.includes("mode=preevent")) {
        if (modeBtnResearch) modeBtnResearch.classList.add("active");
        if (modeBtnLive) modeBtnLive.classList.remove("active");
        return;
      }

      // Smart date check
      let isFutureEvent = false;
      try {
        const events = JSON.parse(localStorage.getItem("event_config") || "[]");
        const ev = events.find(e => e.code === window.selectedEvent);
        if (ev && ev.startDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const startDate = new Date(ev.startDate);
          if (startDate > today) {
            isFutureEvent = true;
          }
        }
      } catch (e) {
        console.warn("[App] Failed to parse event date:", e);
      }

      if (window.selectedEvent === window.activeLiveEventCode && !isFutureEvent) {
        if (modeBtnLive) modeBtnLive.classList.add("active");
        if (modeBtnResearch) modeBtnResearch.classList.remove("active");
      } else {
        if (modeBtnResearch) modeBtnResearch.classList.add("active");
        if (modeBtnLive) modeBtnLive.classList.remove("active");
      }
    }

    // Setup mode click listeners
    if (modeBtnLive && modeBtnResearch) {
      modeBtnLive.addEventListener("click", () => {
        modeBtnLive.classList.add("active");
        modeBtnResearch.classList.remove("active");
        handleEventSelectionChange();
      });
      modeBtnResearch.addEventListener("click", () => {
        modeBtnResearch.classList.add("active");
        modeBtnLive.classList.remove("active");
        handleEventSelectionChange();
      });
    }

    eventSelect.addEventListener("change", () => {
      localStorage.setItem("sticky_event", eventSelect.value);
      updateDefaultModeForSelectedEvent();
      handleEventSelectionChange();
    });
  }

  function populateDropdownWithOptions(events) {
    if (!eventSelect) return;
    const currentVal = eventSelect.value;
    eventSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = events.length === 0 ? "-- Select Event (Click ↻) --" : "-- Select Active Event --";
    eventSelect.appendChild(placeholder);

    events.forEach(e => {
      const opt = document.createElement("option");
      opt.value = e.code;
      opt.textContent = `${e.name} (${e.code})`;
      eventSelect.appendChild(opt);
    });

    if (currentVal && Array.from(eventSelect.options).some(o => o.value === currentVal)) {
      eventSelect.value = currentVal;
    }
  }

  async function handleEventSelectionChange() {
    window.selectedEvent = eventSelect ? eventSelect.value : "";
    if (!window.selectedEvent) return;

    const isResearchActive = modeBtnResearch ? modeBtnResearch.classList.contains("active") : false;
    window.activeMode = isResearchActive ? "research" : "live";

    if (window.activeMode === "research") {
      preeventContainer.style.display = "block";
      standardSetupInputs.style.display = "none";

      if (window.syncManager) {
        showToast("Fetching pre-event team standings...");
        await window.syncManager.fetchPreEventTeamList(window.selectedEvent, (data, isStale) => {
          window.preEventData = data;
          populatePreEventTeamSelector(data);
        });
      }
    } else {
      preeventContainer.style.display = "none";
      standardSetupInputs.style.display = "block";

      // Load qualification matches schedule
      if (window.syncManager) {
        await window.syncManager.fetchAndCacheQualSchedule(window.selectedEvent, () => {
          updateTeamSelector();
        });
      }
    }

    // Auto-save form selection state
    if (window.formManager) window.formManager.triggerAutosave();
  }

  // 2. Pre-Event Scouting Interface Controllers
  function populatePreEventTeamSelector(data) {
    if (!preeventTeamSelect) return;
    const currentVal = preeventTeamSelect.value;
    preeventTeamSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "-- Select Team --";
    preeventTeamSelect.appendChild(placeholder);

    const teams = data ? (data.topTeams || data.teams) : null;
    if (teams && Array.isArray(teams)) {
      teams.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.num;
        opt.textContent = `${t.num} - ${t.name} (Rank: ${t.rank}, npOPR: ${t.npOPR.toFixed(1)})`;
        opt.setAttribute("data-lastevent", t.lastEvent || "");
        preeventTeamSelect.appendChild(opt);
      });
    }

    if (currentVal && Array.from(preeventTeamSelect.options).some(o => o.value === currentVal)) {
      preeventTeamSelect.value = currentVal;
    }
    handlePreEventSelectionUpdates();
  }

  function handlePreEventSelectionUpdates() {
    const selectedTeam = preeventTeamSelect ? preeventTeamSelect.value : "";
    preeventMatchInput.value = "0"; // Pre-event is always match 0
    preeventAllianceContainer.style.display = selectedTeam ? "flex" : "none";
    preeventLinksContainer.style.display = selectedTeam ? "block" : "none";

    if (selectedTeam) {
      const matchnoHidden = document.getElementById("matchno");
      const teamnoHidden = document.getElementById("teamno");
      if (matchnoHidden) matchnoHidden.value = "0";
      if (teamnoHidden) teamnoHidden.value = selectedTeam;
    }

    // Restore or update alliance styles on selection
    if (preeventAllianceRed && preeventAllianceRed.classList.contains("active")) {
      if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Red");
    } else if (preeventAllianceBlue && preeventAllianceBlue.classList.contains("active")) {
      if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Blue");
    }

    if (!selectedTeam) {
      if (preeventLinksContainer) preeventLinksContainer.innerHTML = "";
      if (preeventScoutedStatus) {
        preeventScoutedStatus.style.display = "none";
        preeventScoutedStatus.innerHTML = "";
      }
      return;
    }

    const activeOption = preeventTeamSelect.selectedOptions[0];
    const lastEventRaw = activeOption ? activeOption.getAttribute("data-lastevent") : "";
    let lastEventCode = "";
    let lastEventName = "";

    if (lastEventRaw && lastEventRaw.includes("|")) {
      const parts = lastEventRaw.split("|");
      lastEventCode = parts[0].trim();
      lastEventName = parts[1].trim();
    } else {
      lastEventCode = lastEventRaw;
      lastEventName = lastEventRaw;
    }

    if (preeventLinksContainer) {
      const targetUrl = lastEventCode
        ? `https://ftc-events.firstinspires.org/2025/${lastEventCode.toUpperCase()}/qualifications?team=${selectedTeam}`
        : `https://ftc-events.firstinspires.org/2025/team/${selectedTeam}`;
      
      const badgeLabel = lastEventCode
        ? `📺 Watch ${lastEventCode.toUpperCase()} Videos`
        : `🌐 FIRST Matches (${selectedTeam})`;

      preeventLinksContainer.innerHTML = `
        <a href="${targetUrl}" target="_blank" class="preevent-badge-video" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:12px; background:rgba(99,102,241,0.15); color:var(--accent-color); font-weight:600; font-size:0.85rem; border:1px solid rgba(99,102,241,0.3); transition:all 0.2s;">
          ${badgeLabel}
        </a>
        <a href="https://www.youtube.com/results?search_query=${encodeURIComponent('ftc team ' + selectedTeam + ' ' + lastEventName)}" target="_blank" class="preevent-badge-youtube" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:12px; background:rgba(245,158,11,0.15); color:#f59e0b; font-weight:600; font-size:0.85rem; border:1px solid rgba(245,158,11,0.3); transition:all 0.2s;">
          🔍 YouTube Search
        </a>
      `;
    }

    if (preeventScoutedStatus && window.preEventData) {
      const completed = window.preEventData.completedMatches || [];
      const teamMatches = completed.filter(m => String(m.team) === String(selectedTeam));
      
      if (teamMatches.length > 0) {
        const matchesList = teamMatches.map(m => `Q${m.match}`).join(", ");
        preeventScoutedStatus.innerHTML = `⚠️ Already scouted at this event: <strong>Match ${matchesList}</strong>`;
        preeventScoutedStatus.style.display = "block";
      } else {
        preeventScoutedStatus.innerHTML = `✅ No matches scouted yet for Team ${selectedTeam} at this event.`;
        preeventScoutedStatus.style.display = "block";
      }
    }

    if (window.formManager) window.formManager.triggerAutosave();
  }

  if (preeventTeamSelect) {
    preeventTeamSelect.addEventListener("change", handlePreEventSelectionUpdates);
  }

  if (preeventAllianceRed) {
    preeventAllianceRed.addEventListener("click", () => {
      preeventAllianceRed.classList.add("active");
      if (preeventAllianceBlue) preeventAllianceBlue.classList.remove("active");
      if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Red");
    });
  }

  if (preeventAllianceBlue) {
    preeventAllianceBlue.addEventListener("click", () => {
      preeventAllianceBlue.classList.add("active");
      if (preeventAllianceRed) preeventAllianceRed.classList.remove("active");
      if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Blue");
    });
  }

  // 3. Match Day Team and Positional Selectors
  const redBtn = document.getElementById("alliance-btn-red");
  const blueBtn = document.getElementById("alliance-btn-blue");

  if (redBtn) redBtn.addEventListener("click", () => {
    if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Red");
  });
  if (blueBtn) blueBtn.addEventListener("click", () => {
    if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Blue");
  });

  const teamnoContainerRef = document.getElementById("teamno-container");
  if (teamnoContainerRef) {
    teamnoContainerRef.addEventListener("change", (e) => {
      if (e.target && e.target.id === "teamno") {
        const teamVal = e.target.value;
        const matchVal = parseInt(matchnoInput ? matchnoInput.value : "0");
        const testMatchNumbers = [123, 999, 9999, 1234, 1000];

        if (testMatchNumbers.includes(matchVal)) {
          const selectedTeam = parseInt(teamVal);
          if (selectedTeam === 88881 || selectedTeam === 88882) {
            if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Red");
          } else if (selectedTeam === 88883 || selectedTeam === 88884) {
            if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Blue");
          }
        } else {
          const savedSchedule = localStorage.getItem("qual_schedule");
          let schedule = null;
          try {
            schedule = savedSchedule ? JSON.parse(savedSchedule) : null;
          } catch (e) {
            console.warn("[App] Failed to parse qual_schedule from cache:", e);
          }
          if (matchVal && schedule && schedule[matchVal]) {
            if (window.scoutingUI) window.scoutingUI.updateAllianceColorForTeam(teamVal, schedule[matchVal]);
          }
        }
        if (window.formManager) window.formManager.triggerAutosave();
      }
    });
  }

  // Range and mutually exclusive toggle buttons click handler
  const genericRangeBtns = document.querySelectorAll(".range-toggle-btn[data-field]");
  genericRangeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const fieldId = btn.getAttribute("data-field");
      const value = btn.getAttribute("data-value");
      const hiddenInput = document.getElementById(fieldId);

      // Handle multi-select vs mutually exclusive range selectors
      if (btn.classList.contains("active")) {
        btn.classList.remove("active");
        if (hiddenInput) {
          hiddenInput.value = "";
        }
      } else {
        const container = btn.closest(".range-toggle-container") || btn.parentElement;
        container.querySelectorAll(`.range-toggle-btn[data-field='${fieldId}']`).forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (hiddenInput) {
          hiddenInput.value = value;
        }
      }

      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }

      if (window.formManager) window.formManager.triggerAutosave();
    });
  });

  // Segmented yes/no toggle buttons click handler
  const genericSegmentBtns = document.querySelectorAll(".segment-btn[data-field]");
  genericSegmentBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const fieldId = btn.getAttribute("data-field");
      const value = btn.getAttribute("data-value");
      const container = btn.closest(".segmented-container");

      container.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const hiddenInput = document.getElementById(fieldId);
      if (hiddenInput) {
        hiddenInput.value = value;
      }

      // Handle malfunctions drawer logic specifically
      if (fieldId === "breaks" && window.formManager) {
        window.formManager.toggleMalfunctionsContainer(value);
      }

      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }

      if (window.formManager) window.formManager.triggerAutosave();
    });
  });

  // Multi-select penalty checkbox buttons click handler
  const genericCheckboxBtns = document.querySelectorAll(".toggle-checkbox-btn");
  genericCheckboxBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const container = btn.closest(".toggle-checkbox-container");
      const fieldId = container.getAttribute("data-field");
      const value = btn.getAttribute("data-value");
      const hiddenInput = document.getElementById(fieldId);

      btn.classList.toggle("active");

      // Compile active comma-separated elements list
      const activeValues = [];
      container.querySelectorAll(".toggle-checkbox-btn.active").forEach(b => {
        activeValues.push(b.getAttribute("data-value"));
      });

      if (hiddenInput) {
        hiddenInput.value = activeValues.join(", ");
      }

      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }

      if (window.formManager) window.formManager.triggerAutosave();
    });
  });

  // Settings modal save buttons
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      await saveSettingsAndReloadEvents();
    });
  }

  async function saveSettingsAndReloadEvents({ closeModal = true, toastMessage = "Settings Saved! Loading Events..." } = {}) {
    const newEndpoint = settingSyncUrlInput ? settingSyncUrlInput.value.trim() : "";
    const audioVal = settingAudioCheckbox ? settingAudioCheckbox.checked : true;
    const hapticsVal = settingHapticsCheckbox ? settingHapticsCheckbox.checked : true;

    if (newEndpoint && window.syncManager) {
      window.syncManager.setSyncEndpoint(newEndpoint);
    }
    if (window.feedbackManager) {
      window.feedbackManager.saveSettings(audioVal, hapticsVal);
    }

    if (closeModal && settingsModal) {
      settingsModal.classList.remove("active");
    }

    showToast(toastMessage);

    // Auto-reload the dropdown instantly
    try {
      await initEventDropdown(true);
    } catch (e) {
      console.error("[Settings] Failed to reload dropdown:", e);
      showToast("Failed to load events. Check settings.");
    }
  }

  // Restore Settings parameters on opening settings modal
  const openSettingsBtn = document.getElementById("open-settings-btn");
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => {
      if (settingSyncUrlInput && window.syncManager) {
        settingSyncUrlInput.value = window.syncManager.getSyncEndpoint();
      }
      if (settingAudioCheckbox && window.feedbackManager) {
        settingAudioCheckbox.checked = window.feedbackManager.audioEnabled;
      }
      if (settingHapticsCheckbox && window.feedbackManager) {
        settingHapticsCheckbox.checked = window.feedbackManager.hapticsEnabled;
      }
      if (settingsModal) settingsModal.classList.add("active");
    });
  }

  const closeSettingsBtn = document.getElementById("close-settings-btn");
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", () => {
      if (settingsModal) settingsModal.classList.remove("active");
    });
  }

  // 4. Auton Starting Bar Canvas Instantiation
  const canvasEl = document.getElementById("starting-pos-canvas");
  if (canvasEl) {
    window.canvasInstance = new window.ScoutingCanvas(canvasEl, (zoneString, x, y) => {
      const fieldInput = document.getElementById("robotpos");
      if (fieldInput) {
        fieldInput.value = zoneString;
      }
      
      // Update starting coordinates pins
      window.activePinX = x;
      window.activePinY = y;

      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }

      if (window.formManager) window.formManager.triggerAutosave();
    });
  }

  // 5. Team dropdown matcher schedule selector on match input change
  function updateTeamSelector() {
    if (!matchnoInput || !teamnoContainer) return;

    const matchVal = parseInt(matchnoInput.value);
    const testDataBanner = document.getElementById("test-data-banner");
    const testMatchNumbers = [123, 999, 9999, 1234, 1000];

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

        teamSelect.addEventListener("change", () => {
          const selectedTeam = parseInt(teamSelect.value);
          if (selectedTeam === 88881 || selectedTeam === 88882) {
            if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Red");
          } else if (selectedTeam === 88883 || selectedTeam === 88884) {
            if (window.scoutingUI) window.scoutingUI.setAllianceStyle("Blue");
          }
          if (window.formManager) window.formManager.triggerAutosave();
        });
      }

      const currentValue = teamSelect.value;
      teamSelect.innerHTML = "";

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

      let savedSchedule = null;
      if (window.selectedEvent) {
        savedSchedule = localStorage.getItem(`qual_schedule_${window.selectedEvent}`);
      }
      if (!savedSchedule) {
        savedSchedule = localStorage.getItem("qual_schedule");
      }

      let schedule = null;
      try {
        schedule = savedSchedule ? JSON.parse(savedSchedule) : null;
      } catch (e) {
        console.warn("[App] Failed to parse qual_schedule:", e);
      }

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

          teamSelect.addEventListener("change", () => {
            if (window.scoutingUI) window.scoutingUI.updateAllianceColorForTeam(teamSelect.value, matchDetails);
            if (window.formManager) window.formManager.triggerAutosave();
          });
        }

        const currentValue = teamSelect.value;
        teamSelect.innerHTML = "";

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

        if (currentValue && teams.some(t => String(t.num) === String(currentValue))) {
          teamSelect.value = currentValue;
        }
      } else {
        // Restore input type="number" if not in schedule
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

          teamInput.addEventListener("input", () => {
            if (window.formManager) window.formManager.triggerAutosave();
          });
          teamInput.addEventListener("change", () => {
            if (window.formManager) window.formManager.triggerAutosave();
          });
        }
      }
    }
  }

  if (matchnoInput) {
    matchnoInput.addEventListener("input", updateTeamSelector);
    matchnoInput.addEventListener("change", updateTeamSelector);
  }
  
  // Expose globally
  window.updateTeamSelector = updateTeamSelector;

  // Bind navigation phase steps next/prev buttons
  document.querySelectorAll(".btn-next").forEach(btn => {
    btn.addEventListener("click", () => {
      const nextPhaseId = btn.getAttribute("data-next");
      if (window.scoutingUI) window.scoutingUI.navigateToPhase(nextPhaseId);
    });
  });

  document.querySelectorAll(".btn-prev").forEach(btn => {
    btn.addEventListener("click", () => {
      const prevPhaseId = btn.getAttribute("data-prev");
      if (window.scoutingUI) window.scoutingUI.navigateToPhase(prevPhaseId);
    });
  });

  const progressSteps = document.querySelectorAll(".progress-step");
  progressSteps.forEach(step => {
    step.addEventListener("click", () => {
      const targetPhaseId = step.getAttribute("data-step");
      if (window.scoutingUI) window.scoutingUI.navigateToPhase(targetPhaseId);
    });
  });

  // Bind action score counter ticks
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
      if (window.formManager) window.formManager.logEventAction(phase, field, add);
    });
  });

  // Bind undo buttons
  document.querySelectorAll(".event-log-btn[data-undo]").forEach(btn => {
    btn.addEventListener("click", () => {
      const phase = btn.getAttribute("data-undo");
      if (window.formManager) window.formManager.handleUndoAction(phase);
    });
  });

  // Restore active draft on load
  if (window.formManager) {
    await window.formManager.restoreFormStateDraft();
  }

  // Main Form Submission Actions Handle
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (window.formManager) {
      if (!window.formManager.validateSetupPhase()) return;

      const finalRecord = window.formManager.compileFormStateJSON();

      // Prepend malfunctions to comments prefix
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

      // Outliers validation checks
      const autoElements = (parseInt(finalRecord.preload_made) || 0) + (parseInt(finalRecord.pickup_made) || 0) + (parseInt(finalRecord.pickup_ovw) || 0);
      const teleOpElements = (parseInt(finalRecord.close_made) || 0) + (parseInt(finalRecord.far_made) || 0) + (parseInt(finalRecord.close_ovw) || 0) + (parseInt(finalRecord.far_ovw) || 0);

      if (autoElements > 20 || teleOpElements > 50) {
        const confirmSubmit = confirm(`⚠️ HIGH SCORING OUTLIER DETECTED!\n\n- Auton Elements Scored: ${autoElements} (Warning limit: 20)\n- Teleop Elements Scored: ${teleOpElements} (Warning limit: 50)\n\nThese values are exceptionally high and might indicate double-tapping errors. Are you absolutely certain these match counts are correct?`);
        if (!confirmSubmit) return;
      }

      try {
        // 1. Save to database
        await window.dbManager.saveRecord(finalRecord);

        // 2. Clear draft
        await window.dbManager.clearDraft();

        // 3. Reset form
        const savedEvent = eventSelect ? eventSelect.value : "";
        form.reset();
        window.formManager.resetFormCounters();
        updateTeamSelector();
        window.activePinX = null;
        window.activePinY = null;
        if (window.canvasInstance) {
          window.canvasInstance.clearPin();
        }

        // Restore scouter name & event
        document.getElementById("username").value = finalRecord.username;
        if (savedEvent && eventSelect) {
          eventSelect.value = savedEvent;
          await handleEventSelectionChange();
        }

        // 4. Ingestion Sync Queue trigger
        if (window.syncManager) {
          window.syncManager.processSyncQueue();
        }

        showToast("Scouting Record Saved Successfully!");

        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);

      } catch (err) {
        console.error("[App] Submission failed:", err);
        alert("Failed to save scouting record offline: " + err.message);
      }
    }
  });

  // Clear Form Buttons
  const clearFormBtn = document.getElementById("clear-form-btn");
  if (clearFormBtn) {
    clearFormBtn.addEventListener("click", async () => {
      const confirmClear = confirm("⚠️ Reset Scouting Form?\n\nAre you sure you want to clear the entire form? This will permanently wipe all of your current unsaved match inputs.");
      if (confirmClear && window.formManager) {
        const savedName = document.getElementById("username").value;
        const savedEvent = eventSelect ? eventSelect.value : "";

        form.reset();
        window.formManager.resetFormCounters();
        updateTeamSelector();
        window.activePinX = null;
        window.activePinY = null;
        if (window.canvasInstance) {
          window.canvasInstance.clearPin();
        }

        document.getElementById("username").value = savedName;
        if (savedEvent && eventSelect) {
          eventSelect.value = savedEvent;
          await handleEventSelectionChange();
        }

        await window.dbManager.clearDraft();
        showToast("Scouting Form Reset Successfully!");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  // Comments malfunctions live extraction listener
  const commentsInputEl = document.getElementById("comments");
  if (commentsInputEl) {
    commentsInputEl.addEventListener("input", () => {
      if (window.formManager) window.formManager.parseCommentsAndExtractMalfunctions();
    });
  }

  // Local submissions logs buttons
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
      await window.syncManager.fetchAndCacheQualSchedule();
      const syncedCount = await window.syncManager.processSyncQueue();
      showToast(`Successfully synced ${syncedCount} entries!`);
    }
  });

  const emergencyBackupBtn = document.getElementById("btn-emergency-backup");
  if (emergencyBackupBtn) {
    emergencyBackupBtn.addEventListener("click", async () => {
      if (window.syncManager) {
        await window.syncManager.backupUnsyncedToFile();
      }
    });
  }

  // Audit Logs fetch flagged buttons
  if (btnFetchFlagged) {
    btnFetchFlagged.addEventListener("click", () => {
      if (window.scoutingUI) window.scoutingUI.renderAuditLogsList();
    });
  }

});
