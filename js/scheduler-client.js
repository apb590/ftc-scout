/**
 * js/scheduler-client.js - Offline-first Scouter Scheduling Client
 * Caches scouter assignments and shift blocks locally and syncs substitutions back to the spreadsheet.
 */
class ScoutingSchedulerClient {
  constructor() {
    this.pendingSubstitutionsKey = "pending_substitutions";
    this.pendingTogglesKey = "pending_scouter_toggles";
    this.isSyncing = false;

    // Listen to network transitions to sync pending assignments
    window.addEventListener("online", () => this.syncPendingRequests());
  }

  /**
   * Helper to get endpoint URL from sync manager
   */
  getEndpoint() {
    return window.syncManager.getSyncEndpoint();
  }

  /**
   * Fetches scouter roster, Head Scout name, and Shift Blocks via SWR
   */
  async fetchScouterConfig(updateCallback = null) {
    const endpoint = this.getEndpoint();
    const dataUrl = `${endpoint}?action=getScouterConfig`;
    const cacheKey = "scouter_config";

    await window.syncManager.executeSWR(cacheKey, dataUrl, (data, isStale) => {
      if (data && data.headScout) {
        window.headScoutName = data.headScout;
      }
      if (updateCallback) {
        updateCallback(data, isStale);
      }
    });
  }

  /**
   * Fetches the generated master scouting schedule via SWR
   */
  async fetchScoutingSchedule(updateCallback = null) {
    const endpoint = this.getEndpoint();
    const dataUrl = `${endpoint}?action=getScoutingSchedule`;
    const cacheKey = "scouting_schedule";

    await window.syncManager.executeSWR(cacheKey, dataUrl, (data, isStale) => {
      if (updateCallback) {
        updateCallback(data, isStale);
      }
    });
  }

  /**
   * Submits a match-level scouter substitution
   */
  async postSubstitution(match, allianceRole, scoutName, originalScout) {
    const sub = {
      action: "postSubstitution",
      match: parseInt(match),
      allianceRole: allianceRole, // red1, red2, blue1, blue2
      scoutName: scoutName,
      originalScout: originalScout
    };

    // Update local cached schedule immediately so the user doesn't see a delay
    const cacheKey = "scouting_schedule";
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const schedule = JSON.parse(cached);
        const matchItem = schedule.find(m => parseInt(m.match) === parseInt(match));
        if (matchItem) {
          const roleKey = allianceRole + "Scout";
          let currentValue = matchItem[roleKey] || "";
          if (currentValue && originalScout) {
            const list = currentValue.split(",").map(s => s.trim());
            const idx = list.map(s => s.toLowerCase()).indexOf(originalScout.toLowerCase());
            if (idx !== -1) {
              list[idx] = scoutName;
              matchItem[roleKey] = list.join(", ");
            } else {
              matchItem[roleKey] = scoutName;
            }
          } else {
            matchItem[roleKey] = scoutName;
          }
          localStorage.setItem(cacheKey, JSON.stringify(schedule));
          // Trigger UI updates
          if (window.scoutingUI && typeof window.scoutingUI.renderSchedulerDashboard === "function") {
            window.scoutingUI.renderSchedulerDashboard();
          }
        }
      } catch (e) {
        console.warn("[Scheduler] Failed to update local schedule cache for sub:", e);
      }
    }

    if (!navigator.onLine) {
      // Queue offline
      const queue = this.getQueue(this.pendingSubstitutionsKey);
      queue.push(sub);
      this.saveQueue(this.pendingSubstitutionsKey, queue);
      console.log("[Scheduler] Offline: Saved substitution to sync queue", sub);
      if (window.showToast) window.showToast("Saved substitution offline", "success");
      return;
    }

    try {
      const response = await fetch(this.getEndpoint(), {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(sub)
      });
      const result = await response.json();
      if (result.status === "success") {
        console.log("[Scheduler] Substitution successfully posted to backend:", sub);
        if (window.showToast) window.showToast("Substitution synced successfully", "success");
      } else {
        throw new Error(result.message || "Unknown error");
      }
    } catch (err) {
      console.error("[Scheduler] Substitution sync failed. Queueing...", err);
      const queue = this.getQueue(this.pendingSubstitutionsKey);
      queue.push(sub);
      this.saveQueue(this.pendingSubstitutionsKey, queue);
    }
  }

  /**
   * Submits a scouter active availability and shift status toggle
   */
  async postScouterToggles(scouterName, active, shifts) {
    const toggle = {
      action: "postScouterToggles",
      scouterName: scouterName,
      active: active,
      shifts: shifts // array of 4 booleans
    };

    // Update local scouter_config cache immediately
    const cacheKey = "scouter_config";
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const config = JSON.parse(cached);
        const scout = config.scouters.find(s => s.name.toLowerCase() === scouterName.toLowerCase());
        if (scout) {
          scout.active = active;
          if (shifts) scout.shifts = shifts;
          localStorage.setItem(cacheKey, JSON.stringify(config));
          // Trigger UI updates
          if (window.scoutingUI && typeof window.scoutingUI.renderScouterSettings === "function") {
            window.scoutingUI.renderScouterSettings();
          }
        }
      } catch (e) {
        console.warn("[Scheduler] Failed to update local scouter cache:", e);
      }
    }

    if (!navigator.onLine) {
      // Queue offline
      const queue = this.getQueue(this.pendingTogglesKey);
      queue.push(toggle);
      this.saveQueue(this.pendingTogglesKey, queue);
      console.log("[Scheduler] Offline: Saved toggle to sync queue", toggle);
      if (window.showToast) window.showToast("Saved scouter toggle offline", "success");
      return;
    }

    try {
      const response = await fetch(this.getEndpoint(), {
        method: "POST",
        mode: "cors",
        redirect: "follow",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(toggle)
      });
      const result = await response.json();
      if (result.status === "success") {
        console.log("[Scheduler] Scouter toggle posted to backend:", toggle);
        if (window.showToast) window.showToast("Scouter updates synced successfully", "success");
      } else {
        throw new Error(result.message || "Unknown error");
      }
    } catch (err) {
      console.error("[Scheduler] Scouter toggle sync failed. Queueing...", err);
      const queue = this.getQueue(this.pendingTogglesKey);
      queue.push(toggle);
      this.saveQueue(this.pendingTogglesKey, queue);
    }
  }

  /**
   * Syncs all pending offline request queues
   */
  async syncPendingRequests() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      // 1. Process Substitutions
      const subQueue = this.getQueue(this.pendingSubstitutionsKey);
      if (subQueue.length > 0) {
        console.log(`[Scheduler] Syncing ${subQueue.length} pending substitutions.`);
        const remainingSubs = [];
        for (const sub of subQueue) {
          try {
            const response = await fetch(this.getEndpoint(), {
              method: "POST",
              mode: "cors",
              redirect: "follow",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify(sub)
            });
            const result = await response.json();
            if (result.status !== "success") {
              remainingSubs.push(sub);
            }
          } catch (e) {
            console.error("[Scheduler] Syncing substitution failed:", e);
            remainingSubs.push(sub);
          }
        }
        this.saveQueue(this.pendingSubstitutionsKey, remainingSubs);
      }

      // 2. Process Scouter Toggles
      const toggleQueue = this.getQueue(this.pendingTogglesKey);
      if (toggleQueue.length > 0) {
        console.log(`[Scheduler] Syncing ${toggleQueue.length} pending toggles.`);
        const remainingToggles = [];
        for (const toggle of toggleQueue) {
          try {
            const response = await fetch(this.getEndpoint(), {
              method: "POST",
              mode: "cors",
              redirect: "follow",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify(toggle)
            });
            const result = await response.json();
            if (result.status !== "success") {
              remainingToggles.push(toggle);
            }
          } catch (e) {
            console.error("[Scheduler] Syncing toggle failed:", e);
            remainingToggles.push(toggle);
          }
        }
        this.saveQueue(this.pendingTogglesKey, remainingToggles);
      }
      
      // Pull fresh data after successful sync
      await this.fetchScouterConfig();
      await this.fetchScoutingSchedule();
      
      if (window.scoutingUI && typeof window.scoutingUI.renderSchedulerDashboard === "function") {
        window.scoutingUI.renderSchedulerDashboard();
      }
      if (window.scoutingUI && typeof window.scoutingUI.renderScouterSettings === "function") {
        window.scoutingUI.renderScouterSettings();
      }
    } catch (err) {
      console.error("[Scheduler] Error during batch sync:", err);
    } finally {
      this.isSyncing = false;
    }
  }

  // Queue helpers
  getQueue(key) {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : [];
  }

  saveQueue(key, queue) {
    localStorage.setItem(key, JSON.stringify(queue));
  }
}

// Export global scheduler client instance
window.schedulerClient = new ScoutingSchedulerClient();
