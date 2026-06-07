/**
 * app.js - Main Application Controller
 * Handles routing, component triggers, form actions, and draft persistence.
 */

/**
 * FeedbackManager - Handles synthesized Web Audio ticks and haptic vibrations.
 */
class FeedbackManager {
  constructor() {
    this.audioEnabled = true;
    this.hapticsEnabled = true;
    this.audioCtx = null;
    
    // Load persisted settings
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
        console.log("[Feedback] AudioContext initialized successfully.");
      }
    } catch (e) {
      console.error("[Feedback] Web Audio API initialization failed:", e);
    }
  }

  playTick(frequency, duration) {
    if (!this.audioEnabled) return;
    
    // Autoplay policy: initialize / resume context on click/tap
    this.initAudio();
    if (!this.audioCtx) return;

    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }

    try {
      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();
      
      osc.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
      
      // Crisp decay envelope to prevent popping/clicking sounds
      gainNode.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);
      
      osc.start(this.audioCtx.currentTime);
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
window.feedbackManager = new FeedbackManager();

document.addEventListener("DOMContentLoaded", async () => {
  // Auto-prepopulate and heal the Web App URL if missing or invalid on startup
  try {
    const savedUrl = localStorage.getItem("scout_sync_endpoint_url");
    const obsoleteMock = "AKfycbwr8qHhcLIQVY9tUasa_GMvkTpLOk2vdfSQDbjIOLxqGVOavdUA-ef68KhH9n0XPIBerw";
    const defaultUrl = "https://script.google.com/macros/s/AKfycbxJRUak86fAobUoidVDzuiJNHdq23nU8KbodwiwK0KvovdprEE8nm4WVvvn9qLQhgQt/exec";
    if (!savedUrl || savedUrl === "undefined" || savedUrl === "null" || savedUrl.trim() === "" || savedUrl.includes(obsoleteMock)) {
      localStorage.setItem("scout_sync_endpoint_url", defaultUrl);
      console.log("[App] Healed and pre-populated default sync endpoint URL.");
    }
  } catch (err) {
    console.error("[App] Failed to auto-populate sync endpoint URL:", err);
  }

  // Initialize Database in background (non-blocking)
  window.dbManager.init().catch(err => {
    console.warn("[App] Failed to initialize database in background:", err);
  });

  // Fetch and cache the qualification schedule on startup using SWR
  if (window.syncManager) {
    try {
      window.syncManager.fetchAndCacheQualSchedule(null, (schedule, isStale) => {
        const statusEl = document.getElementById("sync-status") || document.getElementById("sync-status-indicator");
        if (statusEl) {
          statusEl.textContent = isStale ? "Serving Offline Cache..." : "Verified Live Up-To-Date";
        }
      });
    } catch (e) {
      console.warn("[App] Failed to trigger qualification schedule fetch:", e);
    }
  }

  // Initialize active events dropdown and pre-event setup
  try {
    await initEventDropdown();
  } catch (e) {
    console.error("[App] Failed to initialize active events dropdown:", e);
  }

  // Restore and save Scouter Name to localStorage to survive page refreshes
  try {
    const usernameInput = document.getElementById("username");
    if (usernameInput) {
      usernameInput.value = localStorage.getItem("sticky_scouter_name") || "";
      const saveName = () => localStorage.setItem("sticky_scouter_name", usernameInput.value.trim());
      usernameInput.addEventListener("input", saveName);
      usernameInput.addEventListener("change", saveName);
    }
  } catch (e) {
    console.error("[App] Failed to restore sticky scouter name:", e);
  }

  // 1. PWA Service Worker Registration & User-Prompted Update Flow
  function showUpdateBanner(onAccept) {
    // Remove any existing banner first
    const existing = document.getElementById("sw-update-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "sw-update-banner";
    banner.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:10000;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:linear-gradient(135deg,hsl(260,60%,25%),hsl(230,50%,20%));color:#fff;font-family:'Inter',sans-serif;font-size:0.9rem;box-shadow:0 -4px 20px rgba(0,0,0,0.4);border-top:2px solid hsl(260,70%,60%);animation:slideUp 0.3s ease-out;";
    banner.innerHTML = `
      <span>🔄 <strong>App Update Ready!</strong> Tap to load the latest version.</span>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button id="sw-update-dismiss" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#fff;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.8rem;">Later</button>
        <button id="sw-update-accept" style="background:hsl(260,70%,55%);border:none;color:#fff;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.8rem;">Update Now</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById("sw-update-accept").addEventListener("click", () => {
      banner.remove();
      if (onAccept) onAccept();
    });
    document.getElementById("sw-update-dismiss").addEventListener("click", () => {
      banner.remove();
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          console.log("[Service Worker] Registered successfully with scope:", reg.scope);

          // Force immediate update check on every load
          reg.update();

          // If an update is already waiting, show banner
          if (reg.waiting) {
            console.log("[Service Worker] New service worker waiting. Prompting user...");
            showUpdateBanner(() => {
              reg.waiting.postMessage({ action: "skipWaiting" });
            });
          }

          // Listen for new service worker installations
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  console.log("[Service Worker] New update available. Prompting user...");
                  showUpdateBanner(() => {
                    newWorker.postMessage({ action: "skipWaiting" });
                  });
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn("[Service Worker] Registration failed:", err);
        });

      // Handle controller change (reload the page once to apply the update)
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          console.log("[Service Worker] Controller changed. Reloading page...");
          window.location.reload();
        }
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

  // Pre-event Elements References
  const eventSelect = document.getElementById("event-select");
  const preeventContainer = document.getElementById("preevent-container");
  const preeventTeamSelect = document.getElementById("preevent-team-select");
  const preeventMatchInput = document.getElementById("preevent-matchno");
  const preeventAllianceContainer = document.getElementById("preevent-alliance-container");
  const preeventAllianceRed = document.getElementById("preevent-alliance-red");
  const preeventAllianceBlue = document.getElementById("preevent-alliance-blue");
  const preeventLinksContainer = document.getElementById("preevent-links-container");
  const preeventScoutedStatus = document.getElementById("preevent-scouted-status");
  const standardSetupInputs = document.getElementById("standard-setup-inputs");
  const scoutingModeGroup = document.getElementById("scouting-mode-group");
  const modeBtnLive = document.getElementById("mode-btn-live");
  const modeBtnResearch = document.getElementById("mode-btn-research");

  let canvasInstance = null;
  // Coordinates coordinates
  let activePinX = null;
  let activePinY = null;

  let activeLiveEventCode = localStorage.getItem("active_live_event_code") || "";
  let preEventData = null;

  // Parse URL pre-population parameters
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("mode") === "preevent") {
    window.preeventUrlParams = {
      event: urlParams.get("event") || "",
      team: urlParams.get("team") || "",
      scouted_event: urlParams.get("scouted_event") || "",
      match: urlParams.get("match") || "",
      alliance: urlParams.get("alliance") || ""
    };
  }

  // Active Event Dropdown Populator
  async function initEventDropdown() {
    if (!eventSelect) return;

    // 1. Populate immediately from local cache if available (instant load)
    let cachedEvents = [];
    try {
      const cached = localStorage.getItem("event_config");
      cachedEvents = cached ? JSON.parse(cached) : [];
    } catch (e) {
      console.warn("[App] Failed to parse cached event_config on early load:", e);
    }

    if (Array.isArray(cachedEvents) && cachedEvents.length > 0) {
      populateDropdownWithOptions(cachedEvents);
    }

    // 2. Fetch targetEvent and latest events from network — AWAIT the event config
    //    so dropdown is populated BEFORE handleEventSelectionChange runs.
    if (window.syncManager) {
      const endpoint = window.syncManager.getSyncEndpoint();
      if (endpoint) {
        // Admin config (target event) — fire-and-forget, non-critical for dropdown
        fetch(`${endpoint}?action=getAdminConfig`)
          .then(res => res.ok ? res.json() : null)
          .then(async config => {
            if (config && config.targetEvent) {
              activeLiveEventCode = config.targetEvent;
              localStorage.setItem("active_live_event_code", activeLiveEventCode);
              updateDefaultModeForSelectedEvent();

              // Auto-select target event if no event is currently selected
              if (!eventSelect.value && activeLiveEventCode) {
                eventSelect.value = activeLiveEventCode;
                localStorage.setItem("sticky_event", activeLiveEventCode);
                await handleEventSelectionChange();
              }
            }
          })
          .catch(e => console.warn("[App] Failed to fetch active live event in background:", e));

        // Event config — AWAIT this so dropdown is ready before we proceed
        try {
          const events = await window.syncManager.fetchEventConfig();
          if (events && events.length > 0) {
            populateDropdownWithOptions(events);
          }
        } catch (e) {
          console.warn("[App] Failed to fetch event config:", e);
        }
      }
    }

    // 3. Restore sticky event AFTER dropdown is populated
    let restoredEvent = "";
    if (window.preeventUrlParams && window.preeventUrlParams.event) {
      restoredEvent = window.preeventUrlParams.event;
    } else {
      restoredEvent = localStorage.getItem("sticky_event") || "";
    }

    if (restoredEvent) {
      eventSelect.value = restoredEvent;
      await handleEventSelectionChange();
    } else {
      const cachedActiveCode = localStorage.getItem("active_live_event_code");
      if (cachedActiveCode) {
        eventSelect.value = cachedActiveCode;
        await handleEventSelectionChange();
      }
    }

    function updateDefaultModeForSelectedEvent() {
      const selectedEvent = eventSelect ? eventSelect.value : "";
      if (!selectedEvent) return;

      if (window.preeventUrlParams || window.location.search.includes("mode=preevent")) {
        if (modeBtnResearch) modeBtnResearch.classList.add("active");
        if (modeBtnLive) modeBtnLive.classList.remove("active");
        return;
      }

      // Smart date-based future event check
      let isFutureEvent = false;
      try {
        const events = JSON.parse(localStorage.getItem("event_config") || "[]");
        const ev = events.find(e => e.code === selectedEvent);
        if (ev && ev.startDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const startDate = new Date(ev.startDate);
          if (startDate > today) {
            isFutureEvent = true;
          }
        }
      } catch (e) {
        console.warn("[App] Failed to check event date:", e);
      }

      if (selectedEvent === activeLiveEventCode && !isFutureEvent) {
        if (modeBtnLive) modeBtnLive.classList.add("active");
        if (modeBtnResearch) modeBtnResearch.classList.remove("active");
      } else {
        if (modeBtnResearch) modeBtnResearch.classList.add("active");
        if (modeBtnLive) modeBtnLive.classList.remove("active");
      }
    }

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

    updateDefaultModeForSelectedEvent();
    await handleEventSelectionChange();
  }

  function populateDropdownWithOptions(events) {
    if (!eventSelect) return;
    const currentValue = eventSelect.value;
    eventSelect.innerHTML = "";

    const placeholderOpt = document.createElement("option");
    placeholderOpt.value = "";
    placeholderOpt.textContent = "-- Select Event --";
    eventSelect.appendChild(placeholderOpt);

    events.forEach(e => {
      const opt = document.createElement("option");
      opt.value = e.code;
      opt.textContent = `${e.name} (${e.code.toUpperCase()})`;
      eventSelect.appendChild(opt);
    });

    if (currentValue && events.some(e => e.code === currentValue)) {
      eventSelect.value = currentValue;
    }
  }

  // Pre-event Container Toggle Control
  async function handleEventSelectionChange() {
    const selectedEvent = eventSelect.value;
    const standardMatchInput = document.getElementById("matchno");
    const standardTeamInput = document.getElementById("teamno");
    const standardAllianceGroup = document.getElementById("alliance-container") ? document.getElementById("alliance-container").closest(".input-group") : null;

    if (selectedEvent && window.syncManager) {
      // Trigger background schedule caching for the newly selected event using SWR
      window.syncManager.fetchAndCacheQualSchedule(selectedEvent, (schedule, isStale) => {
        const statusEl = document.getElementById("sync-status") || document.getElementById("sync-status-indicator");
        if (statusEl) {
          statusEl.textContent = isStale ? "Serving Offline Cache..." : "Verified Live Up-To-Date";
        }
      }).catch(e => console.warn("[App] Failed to pre-cache schedule for:", selectedEvent));
    }

    if (!selectedEvent) {
      if (preeventContainer) preeventContainer.style.display = "none";
      if (standardSetupInputs) standardSetupInputs.style.display = "flex";
      if (standardAllianceGroup) standardAllianceGroup.style.display = "block";
      if (standardMatchInput) standardMatchInput.required = true;
      if (standardTeamInput) standardTeamInput.required = true;
      if (scoutingModeGroup) scoutingModeGroup.style.display = "none";
      return;
    }

    if (scoutingModeGroup) scoutingModeGroup.style.display = "block";

    let activeMode = "live";
    if (modeBtnResearch && modeBtnResearch.classList.contains("active")) {
      activeMode = "research";
    }

    if (activeMode === "live") {
      if (preeventContainer) preeventContainer.style.display = "none";
      if (standardSetupInputs) standardSetupInputs.style.display = "flex";
      if (standardAllianceGroup) standardAllianceGroup.style.display = "block";
      if (standardMatchInput) standardMatchInput.required = true;
      if (standardTeamInput) standardTeamInput.required = true;

      updateTeamSelector();
    } else {
      if (standardSetupInputs) standardSetupInputs.style.display = "none";
      if (standardAllianceGroup) standardAllianceGroup.style.display = "none";
      if (standardMatchInput) {
        standardMatchInput.required = false;
        standardMatchInput.value = "";
      }
      if (standardTeamInput) {
        standardTeamInput.required = false;
        standardTeamInput.value = "";
      }
      if (preeventContainer) preeventContainer.style.display = "block";

      if (preeventTeamSelect) {
        preeventTeamSelect.innerHTML = "<option value=''>-- Loading Teams --</option>";
      }

      await window.syncManager.fetchPreEventTeamList(selectedEvent, (data, isStale) => {
        preEventData = data;
        const statusEl = document.getElementById("sync-status") || document.getElementById("sync-status-indicator");
        if (statusEl) {
          statusEl.textContent = isStale ? "Serving Offline Cache..." : "Verified Live Up-To-Date";
        }
        if (data) {
          populatePreEventTeamSelector(data);
        } else {
          if (preeventTeamSelect) {
            preeventTeamSelect.innerHTML = "<option value=''>-- Error Loading Teams --</option>";
          }
        }
      });
    }
  }

  // Pre-event Team Dropdown Prioritization Sorting
  function populatePreEventTeamSelector(data) {
    if (!preeventTeamSelect) return;

    // Gracefully preserve current selection if any
    const currentSelectedValue = preeventTeamSelect.value;

    const topTeams = data.topTeams || [];
    const completedMatches = data.completedMatches || [];

    const completionsMap = {};
    completedMatches.forEach(m => {
      completionsMap[m.team] = (completionsMap[m.team] || 0) + 1;
    });

    const sortedTeams = [...topTeams].sort((a, b) => {
      const compA = completionsMap[a.num] || 0;
      const compB = completionsMap[b.num] || 0;
      const isScoutedA = compA > 0;
      const isScoutedB = compB > 0;

      if (isScoutedA && !isScoutedB) return 1;
      if (!isScoutedA && isScoutedB) return -1;
      return b.npOPR - a.npOPR;
    });

    preeventTeamSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "-- Choose Team --";
    preeventTeamSelect.appendChild(placeholder);

    sortedTeams.forEach(t => {
      const comp = completionsMap[t.num] || 0;
      const opt = document.createElement("option");
      opt.value = t.num;
      opt.setAttribute("data-lastevent", t.lastEvent || "");
      opt.setAttribute("data-npopr", t.npOPR || 0);
      opt.setAttribute("data-autoopr", t.autoOPR || 0);
      opt.setAttribute("data-teleopr", t.teleOPR || 0);
      opt.setAttribute("data-awards", t.awardsStr || "");

      if (comp > 0) {
        opt.textContent = `Team ${t.num} - ${t.name} (Scouted: ${comp} match${comp > 1 ? "es" : ""}, OPR: ${t.npOPR})`;
        opt.style.color = "var(--text-secondary)";
      } else {
        opt.textContent = `Team ${t.num} - ${t.name} (OPR: ${t.npOPR})`;
        opt.style.color = "var(--accent-color)";
      }
      preeventTeamSelect.appendChild(opt);
    });

    // Gracefully restore previous selection if it is still valid
    if (currentSelectedValue && sortedTeams.some(t => String(t.num) === String(currentSelectedValue))) {
      preeventTeamSelect.value = currentSelectedValue;
      handlePreEventSelectionUpdates();
    }

    if (window.preeventUrlParams) {
      const params = window.preeventUrlParams;
      if (params.team) {
        preeventTeamSelect.value = params.team;
      }
      if (preeventMatchInput && params.match) {
        preeventMatchInput.value = params.match;
      }
      if (params.alliance) {
        const btn = document.querySelector(`.segment-btn[id^='preevent-alliance-'][data-value='${params.alliance}']`);
        if (btn) btn.click();
      }

      handlePreEventSelectionUpdates();

      window.preeventUrlParams = null;
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (e) { }
    }
  }

  // Pre-event Live QR Code and Links Generator Control
  function handlePreEventSelectionUpdates() {
    const selectedTeam = preeventTeamSelect ? preeventTeamSelect.value : "";
    const matchVal = preeventMatchInput ? preeventMatchInput.value : "";

    let allianceVal = "";
    const activeAllianceBtn = preeventAllianceContainer ? preeventAllianceContainer.querySelector(".segment-btn.active") : null;
    if (activeAllianceBtn) {
      allianceVal = activeAllianceBtn.getAttribute("data-value");
    }

    const standardTeamInput = document.getElementById("teamno");
    if (standardTeamInput) {
      standardTeamInput.value = selectedTeam;
    }
    const standardMatchInput = document.getElementById("matchno");
    if (standardMatchInput) {
      standardMatchInput.value = matchVal;
    }
    if (allianceVal) {
      allianceInput.value = allianceVal;
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

    if (lastEventRaw.includes("|")) {
      lastEventCode = lastEventRaw.split("|")[0].trim();
    } else {
      lastEventCode = lastEventRaw.trim();
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
      `;
    }

    if (preeventScoutedStatus && preEventData) {
      const completed = preEventData.completedMatches || [];
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
  }

  // Bind change listeners to preevent elements
  if (preeventTeamSelect) {
    preeventTeamSelect.addEventListener("change", handlePreEventSelectionUpdates);
  }
  if (preeventMatchInput) {
    preeventMatchInput.addEventListener("input", handlePreEventSelectionUpdates);
    preeventMatchInput.addEventListener("change", handlePreEventSelectionUpdates);
  }
  if (preeventAllianceRed && preeventAllianceBlue) {
    preeventAllianceRed.addEventListener("click", () => {
      setAllianceStyle("Red");
      handlePreEventSelectionUpdates();
    });
    preeventAllianceBlue.addEventListener("click", () => {
      setAllianceStyle("Blue");
      handlePreEventSelectionUpdates();
    });
  }

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
      if (preeventAllianceRed) preeventAllianceRed.classList.add("active");
      if (preeventAllianceBlue) preeventAllianceBlue.classList.remove("active");
    } else {
      document.body.classList.remove("alliance-red");
      document.body.classList.add("alliance-blue");
      blueBtn.classList.add("active");
      redBtn.classList.remove("active");
      if (preeventAllianceBlue) preeventAllianceBlue.classList.add("active");
      if (preeventAllianceRed) preeventAllianceRed.classList.remove("active");
    }
    allianceInput.value = alliance;
    triggerAutosave();
  }

  redBtn.addEventListener("click", () => setAllianceStyle("Red"));
  blueBtn.addEventListener("click", () => setAllianceStyle("Blue"));

  // Re-establish team dropdown change handler to auto-select alliance color
  const teamnoContainer = document.getElementById("teamno-container");
  const matchnoInput = document.getElementById("matchno");
  const testMatchNumbers = [123, 999, 9999, 1234, 1000];

  if (teamnoContainer) {
    teamnoContainer.addEventListener("change", (e) => {
      if (e.target && e.target.id === "teamno") {
        const teamVal = e.target.value;
        const matchVal = parseInt(matchnoInput ? matchnoInput.value : "0");

        if (testMatchNumbers.includes(matchVal)) {
          const selectedTeam = parseInt(teamVal);
          if (selectedTeam === 88881 || selectedTeam === 88882) {
            setAllianceStyle("Red");
          } else if (selectedTeam === 88883 || selectedTeam === 88884) {
            setAllianceStyle("Blue");
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
            updateAllianceColorForTeam(teamVal, schedule[matchVal]);
          }
        }
        triggerAutosave();
      }
    });
  }

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
          if (window.feedbackManager) {
            window.feedbackManager.trigger("undo");
          }
          triggerAutosave();
        } else {
          if (window.feedbackManager) {
            window.feedbackManager.trigger("warning");
          }
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
        if (window.feedbackManager) {
          window.feedbackManager.trigger("click");
        }
        triggerAutosave();
      }
    });
  });

  // 8. Settings Overlay Modal Drawer Functions
  const openSettingsBtn = document.getElementById("open-settings-btn");
  const closeSettingsBtn = document.getElementById("close-settings-modal-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const refreshEventsBtn = document.getElementById("refresh-events-btn");
  const settingSyncUrlInput = document.getElementById("setting-sync-endpoint");
  const settingAudioCheckbox = document.getElementById("setting-enable-audio");
  const settingHapticsCheckbox = document.getElementById("setting-enable-haptics");

  // Set initial feedback UI checkbox states based on persisted settings
  if (settingAudioCheckbox && window.feedbackManager) {
    settingAudioCheckbox.checked = window.feedbackManager.audioEnabled;
  }
  if (settingHapticsCheckbox && window.feedbackManager) {
    settingHapticsCheckbox.checked = window.feedbackManager.hapticsEnabled;
  }

  async function saveSettingsAndReloadEvents({ closeModal = true, toastMessage = "Settings Saved! Loading Events..." } = {}) {
    let newEndpoint = settingSyncUrlInput ? settingSyncUrlInput.value.trim() : "";

    // When invoked by the inline refresh button, the settings modal may never have
    // been opened. In that case, use the currently persisted endpoint so refresh
    // follows the exact same save/apply/reload path without accidentally clearing it.
    if (!newEndpoint && window.syncManager) {
      newEndpoint = window.syncManager.getSyncEndpoint() || "";
      if (settingSyncUrlInput) settingSyncUrlInput.value = newEndpoint;
    }

    if (newEndpoint && window.syncManager) {
      // Strip any trailing query parameters (like ?action=...) if accidentally copy-pasted
      if (newEndpoint.includes("?")) {
        newEndpoint = newEndpoint.split("?")[0];
      }
      window.syncManager.setSyncEndpoint(newEndpoint);
      if (settingSyncUrlInput) settingSyncUrlInput.value = newEndpoint;
    }

    // Save feedback manager settings
    if (window.feedbackManager) {
      const audioVal = settingAudioCheckbox ? settingAudioCheckbox.checked : true;
      const hapticsVal = settingHapticsCheckbox ? settingHapticsCheckbox.checked : true;
      window.feedbackManager.saveSettings(audioVal, hapticsVal);
    }

    if (closeModal && settingsModal) {
      settingsModal.classList.remove("active");
    }

    showToast(toastMessage);

    // Auto-reload the dropdown instantly
    try {
      await initEventDropdown();
    } catch (e) {
      console.error("[Settings] Failed to reload dropdown:", e);
      showToast("Failed to load events. Check settings.");
    }
  }

  openSettingsBtn.addEventListener("click", () => {
    // Populate current local settings values
    settingSyncUrlInput.value = window.syncManager.getSyncEndpoint();
    if (settingAudioCheckbox && window.feedbackManager) {
      settingAudioCheckbox.checked = window.feedbackManager.audioEnabled;
    }
    if (settingHapticsCheckbox && window.feedbackManager) {
      settingHapticsCheckbox.checked = window.feedbackManager.hapticsEnabled;
    }
    settingsModal.classList.add("active");
  });

  closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("active");
  });

  saveSettingsBtn.addEventListener("click", () => {
    saveSettingsAndReloadEvents({
      closeModal: true,
      toastMessage: "Settings Saved! Loading Events..."
    });
  });

  if (refreshEventsBtn) {
    refreshEventsBtn.addEventListener("click", () => {
      saveSettingsAndReloadEvents({
        closeModal: false,
        toastMessage: "Refreshing Events..."
      });
    });
  }

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
        if (window.feedbackManager) {
          window.feedbackManager.trigger("warning");
        }
        showToast("Maximum of 3 combined preloads reached!");
        return;
      }
      preloadMadeInput.value = made + 1;
      document.getElementById("val-preload_made").textContent = made + 1;
      actionHistoryStack.push({ phase: "preload", field: "preload_made", increment: 1 });
      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }
      triggerAutosave();
    });

    btnPreloadMiss.addEventListener("click", () => {
      const made = parseInt(preloadMadeInput.value) || 0;
      const miss = parseInt(preloadMissInput.value) || 0;
      if (made + miss >= 3) {
        if (window.feedbackManager) {
          window.feedbackManager.trigger("warning");
        }
        showToast("Maximum of 3 combined preloads reached!");
        return;
      }
      preloadMissInput.value = miss + 1;
      document.getElementById("val-preload_miss").textContent = miss + 1;
      actionHistoryStack.push({ phase: "preload", field: "preload_miss", increment: 1 });
      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }
      triggerAutosave();
    });
  }

  // Gate Open Log Actions
  const btnGateOpen = document.getElementById("btn-gate-open");
  const btnGateUndo = document.getElementById("btn-gate-undo");
  const gateOpnInput = document.getElementById("gate_opn");

  if (btnGateOpen && gateOpnInput) {
    btnGateOpen.addEventListener("click", () => {
      const current = parseInt(gateOpnInput.value) || 0;
      gateOpnInput.value = current + 1;
      const display = document.getElementById("val-gate_opn");
      if (display) display.textContent = current + 1;
      actionHistoryStack.push({ phase: "teleop", field: "gate_opn", increment: 1 });
      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }
      triggerAutosave();
    });
  }

  if (btnGateUndo && gateOpnInput) {
    btnGateUndo.addEventListener("click", () => {
      const current = parseInt(gateOpnInput.value) || 0;
      if (current > 0) {
        gateOpnInput.value = current - 1;
        const display = document.getElementById("val-gate_opn");
        if (display) display.textContent = current - 1;

        // Remove matching action from stack if present
        const matchIdx = actionHistoryStack.map(x => x.field).lastIndexOf("gate_opn");
        if (matchIdx !== -1) {
          actionHistoryStack.splice(matchIdx, 1);
        }
        if (window.feedbackManager) {
          window.feedbackManager.trigger("undo");
        }
        triggerAutosave();
      } else {
        if (window.feedbackManager) {
          window.feedbackManager.trigger("warning");
        }
      }
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

          const rangeDefaults = {
            "auto_range": "No shots taken / unknown",
            "auto_park": "On Launch Line",
            "auto_gate": "Avoided gate",
            "telesetup": "Unsure / not a distinct first step",
            "tele_pattern": "no",
            "tele_range": "Unable to tell",
            "defense": "No intentional contact",
            "timetopark": "",
            "park_base": "Did not attempt",
            "park_bonus": "No bonus"
          };

          hiddenInput.value = rangeDefaults[fieldId] !== undefined ? rangeDefaults[fieldId] : "None";
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

    // Append pre-event schema fields
    const selectedEvent = document.getElementById("event-select") ? document.getElementById("event-select").value : "";
    const modeBtnResearch = document.getElementById("mode-btn-research");
    const isResearchMode = modeBtnResearch && modeBtnResearch.classList.contains("active");
    
    // It's a pre-event record if research mode is active OR if the selected event is not the active live event
    const isPre = (isResearchMode || (selectedEvent && selectedEvent !== activeLiveEventCode)) ? 1 : 0;

    data.is_preevent = isPre;

    if (isPre) {
      // upcoming_event = the Active Event (target event this scouting prepares for)
      data.upcoming_event = selectedEvent || activeLiveEventCode;

      // scouted_event = "Last Event Played" from the PreEventRosterCache tab
      let scoutedEventVal = "";
      const teamSel = document.getElementById("preevent-team-select");
      if (teamSel && teamSel.selectedOptions && teamSel.selectedOptions[0]) {
        const lastEventRaw = teamSel.selectedOptions[0].getAttribute("data-lastevent") || "";
        if (lastEventRaw.includes("|")) {
          scoutedEventVal = lastEventRaw.split("|")[0].trim();
        } else {
          scoutedEventVal = lastEventRaw.trim();
        }
      }
      data.scouted_event = scoutedEventVal;
    } else {
      data.upcoming_event = "";
      data.scouted_event = "";
    }

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

      // Restore Event dropdown sticky state or draft state
      const evSelect = document.getElementById("event-select");
      if (evSelect && draft.upcoming_event) {
        evSelect.value = draft.upcoming_event;
        await handleEventSelectionChange();

        // Restore pre-event inputs if in pre-event mode
        if (draft.is_preevent) {
          const preTeamSel = document.getElementById("preevent-team-select");
          if (preTeamSel && draft.teamno) {
            preTeamSel.value = draft.teamno;
          }
          const preMatchInput = document.getElementById("preevent-matchno");
          if (preMatchInput && draft.matchno) {
            preMatchInput.value = draft.matchno;
          }
          if (draft.alliance) {
            const btn = document.querySelector(`.segment-btn[id^='preevent-alliance-'][data-value='${draft.alliance}']`);
            if (btn) btn.click();
          }
          handlePreEventSelectionUpdates();
        }
      }

      showToast("Unfinished Scouting Draft Restored!");
    } catch (e) {
      console.warn("[App] Error restoring form state draft:", e);
    }
  }

  if (matchnoInput && teamnoContainer) {
    matchnoInput.addEventListener("input", updateTeamSelector);
    matchnoInput.addEventListener("change", updateTeamSelector);
  }


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
      const eventSelect = document.getElementById("event-select");
      const selectedEvent = eventSelect ? eventSelect.value : "";

      let savedSchedule = null;
      if (selectedEvent) {
        savedSchedule = localStorage.getItem(`qual_schedule_${selectedEvent}`);
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

      if (window.feedbackManager) {
        window.feedbackManager.trigger("click");
      }

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
        
        if (window.feedbackManager) {
          window.feedbackManager.trigger("undo");
        }

        triggerAutosave();
        showToast("Last score action reverted!");
        return;
      }
    }

    if (window.feedbackManager) {
      window.feedbackManager.trigger("warning");
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
      const savedEvent = document.getElementById("event-select") ? document.getElementById("event-select").value : "";
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

      // Restore active event
      if (savedEvent) {
        const evSelect = document.getElementById("event-select");
        if (evSelect) {
          evSelect.value = savedEvent;
          handleEventSelectionChange();
        }
      }

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
        // Save the scouter name and active event select so they don't get lost
        const savedName = document.getElementById("username").value;
        const savedEvent = document.getElementById("event-select") ? document.getElementById("event-select").value : "";

        // Reset form controls
        form.reset();
        resetFormCounters();
        updateTeamSelector();
        activePinX = null;
        activePinY = null;
        if (canvasInstance) {
          canvasInstance.clearPin();
        }

        // Restore scouter name and active event
        document.getElementById("username").value = savedName;
        if (savedEvent) {
          const evSelect = document.getElementById("event-select");
          if (evSelect) {
            evSelect.value = savedEvent;
            handleEventSelectionChange();
          }
        }

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
      "close_made", "close_miss", "close_ovw", "far_made", "far_miss", "far_ovw", "gate_opn"
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

    // Set explicit default values for all range-toggle and mutually exclusive fields
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

      // Auto-activate the default button in PWA UI visually (only if default is not empty)
      if (defVal !== "") {
        // Exclude park_bonus from visual pre-selection so it starts unselected
        if (field === "park_bonus") continue;

        const defaultBtn = document.querySelector(`.range-toggle-btn[data-field='${field}'][data-value='${defVal}']`);
        if (defaultBtn) {
          defaultBtn.classList.add("active");
        }
      }
    }

    // Reset penalty toggle checkbox buttons
    document.querySelectorAll(".toggle-checkbox-btn").forEach(btn => btn.classList.remove("active"));

    // Reset all checkboxes hidden values
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

    // Reset segmented selector states: clear all, then default automove to No
    document.querySelectorAll(".segment-btn").forEach(btn => btn.classList.remove("active"));

    // Explicitly set automove default to "No"
    const automoveInput = document.getElementById("automove");
    if (automoveInput) automoveInput.value = "No";
    const automoveNoBtn = document.querySelector(".segment-btn[data-field='automove'][data-value='No']");
    if (automoveNoBtn) automoveNoBtn.classList.add("active");

    // Explicitly reset alliance
    const allianceInput = document.getElementById("alliance");
    if (allianceInput) allianceInput.value = "";

    // Explicitly set breaks default to "No"
    const breaksInput = document.getElementById("breaks");
    if (breaksInput) breaksInput.value = "No";
    const breaksNoBtn = document.querySelector(".segment-btn[data-field='breaks'][data-value='No']");
    if (breaksNoBtn) breaksNoBtn.classList.add("active");

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

  // Emergency Backup Button Handler
  const emergencyBackupBtn = document.getElementById("btn-emergency-backup");
  if (emergencyBackupBtn) {
    emergencyBackupBtn.addEventListener("click", async () => {
      if (window.syncManager) {
        await window.syncManager.backupUnsyncedToFile();
      }
    });
  }

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
