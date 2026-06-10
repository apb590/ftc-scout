/**
 * sync.js - Offline Synchronization & Backup Utilities
 * Manages auto-syncing, CSV/JSON exports, and local QR code generation.
 */
class ScoutingSyncManager {
  constructor() {
    this.syncEndpointKey = "scout_sync_endpoint_url";
    this.isSyncing = false; // Concurrency lock semaphore
    
    // Strict schema order of the 35 target keys
    this.schemaKeys = [
      "teamno", "matchno", "alliance", "robotpos", "automove",
      "preload_made", "preload_miss", "pickup_made", "pickup_miss", "pickup_ovw",
      "auto_range", "auto_pattern", "auto_gate", "auto_midline", "auto_park",
      "auto_penal", "telesetup", "close_made", "close_miss", "close_ovw",
      "far_made", "far_miss", "far_ovw", "gate_opn", "tele_collection",
      "tele_pattern", "tele_range", "defense", "timetopark", "park_base",
      "park_bonus", "tele_penal", "breaks", "comments", "username",
      "is_preevent", "upcoming_event", "scouted_event"
    ];

    // Listen to browser network changes
    window.addEventListener("online", () => this.handleNetworkRecovery());
  }

  /**
   * Returns the active sync API URL (defaults to live spreadsheet endpoint)
   * Dynamically auto-migrates any instances pointing to the obsolete mock endpoint.
   */
  getSyncEndpoint() {
    let url = localStorage.getItem(this.syncEndpointKey);
    const obsoleteMock = "AKfycbwr8qHhcLIQVY9tUasa_GMvkTpLOk2vdfSQDbjIOLxqGVOavdUA-ef68KhH9n0XPIBerw";
    const defaultUrl = "https://script.google.com/macros/s/AKfycbxJRUak86fAobUoidVDzuiJNHdq23nU8KbodwiwK0KvovdprEE8nm4WVvvn9qLQhgQt/exec";
    
    if (!url || url === "undefined" || url === "null" || url.trim() === "" || url.includes(obsoleteMock)) {
      url = defaultUrl;
      localStorage.setItem(this.syncEndpointKey, url);
    }
    return url;
  }

  /**
   * Sets the sync API URL
   */
  setSyncEndpoint(url) {
    localStorage.setItem(this.syncEndpointKey, url);
  }

  /**
   * Compresses a scouting record into a highly dense CSV string line
   * This is perfect for fitting into a low-density, highly scannable offline QR Code.
   */
  convertToCompactCSVString(record) {
    return this.schemaKeys.map(key => {
      let val = record[key];
      if (val === undefined || val === null) {
        val = "";
      }
      // Escape commas and newlines
      let valStr = String(val).replace(/,/g, ";").replace(/\r?\n/g, " ");
      return valStr;
    }).join(",");
  }

  /**
   * Generates a visual QR Code representing a record on the provided canvas element
   */
  generateQRForRecord(record, canvasElement) {
    if (!window.QRious) {
      console.error("[Sync] QRious library is not loaded.");
      return false;
    }

    try {
      // Step 1: Strip keys — positional value serialization using schema order
      const sequentialValues = this.schemaKeys.map(key => record[key] ?? "");

      // Step 2: Pipe-delimited flat string (much smaller than JSON or CSV)
      const flatString = sequentialValues.join("|");

      // Step 3: Compress with JSONCrush if available, otherwise fall back to raw
      let dataPayload;
      if (window.JSONCrush && typeof window.JSONCrush.crush === "function") {
        dataPayload = JSONCrush.crush(flatString);
        console.log(`[Sync] JSONCrush compressed: ${flatString.length} → ${dataPayload.length} chars (${Math.round((1 - dataPayload.length / flatString.length) * 100)}% reduction)`);
      } else {
        dataPayload = flatString;
        console.warn("[Sync] JSONCrush not available, using uncompressed pipe-delimited payload.");
      }

      new QRious({
        element: canvasElement,
        value: dataPayload,
        size: 260,
        level: "L" // Low error correction = larger data blocks, easier scan in dark stands
      });

      console.log(`[Sync] Offline QR Code generated successfully (${dataPayload.length} chars)`);
      return true;
    } catch (e) {
      console.error("[Sync] QR Code generation error:", e);
      return false;
    }
  }

  /**
   * Exports all local IndexedDB records to a downloadable CSV file matching strict spreadsheet schema sequence
   */
  async exportAllToCSV() {
    try {
      const records = await window.dbManager.getAllRecords();
      if (records.length === 0) {
        alert("No records available to export!");
        return;
      }

      // Create CSV Header matching schema keys
      const headerRow = this.schemaKeys.join(",");
      
      // Map records to sequential rows
      const dataRows = records.map(record => {
        return this.schemaKeys.map(key => {
          let val = record[key];
          if (val === undefined || val === null) {
            val = "";
          }
          let valStr = String(val);
          // If value contains comma, double quotes, or newline, wrap in quotes
          if (valStr.includes(",") || valStr.includes('"') || valStr.includes("\n")) {
            valStr = `"${valStr.replace(/"/g, '""')}"`;
          }
          return valStr;
        }).join(",");
      });

      const csvContent = [headerRow, ...dataRows].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      
      const filename = `FTC_Decode_Scout_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("[Sync] CSV Export triggered successfully");
    } catch (err) {
      console.error("[Sync] CSV export failed:", err);
      alert("Error occurred during CSV export: " + err.message);
    }
  }

  /**
   * Exports all local IndexedDB records to a JSON file
   */
  async exportAllToJSON() {
    try {
      const records = await window.dbManager.getAllRecords();
      if (records.length === 0) {
        alert("No records available to export!");
        return;
      }

      const jsonContent = JSON.stringify(records, null, 2);
      const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
      const link = document.createElement("a");
      
      const filename = `FTC_Decode_Scout_Export_${new Date().toISOString().slice(0, 10)}.json`;
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("[Sync] JSON Export triggered successfully");
    } catch (err) {
      console.error("[Sync] JSON export failed:", err);
      alert("Error occurred during JSON export: " + err.message);
    }
  }

  /**
   * Triggered when browser connectivity is restored
   */
  async handleNetworkRecovery() {
    console.log("[Sync] Internet connectivity detected. Auto-sync queue processing started.");
    const syncStatusLabel = document.getElementById("sync-status-indicator");
    if (syncStatusLabel) {
      syncStatusLabel.textContent = "Online - Processing sync queue...";
      syncStatusLabel.className = "status-tag status-online animate-pulse";
    }
    
    await this.processSyncQueue();
  }

  /**
   * Synchronizes all unsynced local records to the target spreadsheet endpoint
   */
  async processSyncQueue() {
    if (this.isSyncing) {
      console.log("[Sync] Queue is already processing. Skipping concurrent run.");
      return 0;
    }
    this.isSyncing = true;

    try {
      const unsyncedRecords = await window.dbManager.getUnsyncedRecords();
      if (unsyncedRecords.length === 0) {
        console.log("[Sync] Sync completed: No pending items.");
        this.updateSyncIndicators();
        return 0;
      }

      console.log(`[Sync] Found ${unsyncedRecords.length} records pending upload.`);
      let successfullySyncedCount = 0;
      const endpoint = this.getSyncEndpoint();

      for (const record of unsyncedRecords) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            mode: "cors",
            redirect: "follow",
            headers: {
              "Content-Type": "text/plain"
            },
            body: JSON.stringify(record)
          });

          if (response.ok || response.status === 200 || response.status === 201) {
            // Successfully uploaded! Mark as synced in database
            await window.dbManager.setSynced(record.id, true);
            successfullySyncedCount++;
            console.log(`[Sync] Uploaded record successfully: ${record.id}`);
          } else {
            console.warn(`[Sync] Ingestion endpoint rejected record ${record.id} with status ${response.status}`);
          }
        } catch (fetchErr) {
          console.error(`[Sync] Fetch execution failed for record ${record.id}:`, fetchErr);
          // Break cycle if network goes down again mid-process
          break;
        }
      }

      this.updateSyncIndicators();
      
      // Update UI components if they are currently mounted
      if (window.renderHistoryList) {
        window.renderHistoryList();
      }

      return successfullySyncedCount;
    } catch (err) {
      console.error("[Sync] Error running sync routine:", err);
      return 0;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Refresh visual UI badges representing the offline state queue size
   */
  async updateSyncIndicators() {
    try {
      const unsynced = await window.dbManager.getUnsyncedRecords();
      const count = unsynced.length;
      
      const badge = document.getElementById("pending-sync-badge");
      if (badge) {
        if (count > 0) {
          badge.textContent = `${count} pending`;
          badge.style.display = "inline-flex";
        } else {
          badge.style.display = "none";
        }
      }

      const syncStatusLabel = document.getElementById("sync-status-indicator");
      if (syncStatusLabel) {
        if (navigator.onLine) {
          syncStatusLabel.textContent = "Online";
          syncStatusLabel.className = "status-tag status-online";
        } else {
          syncStatusLabel.textContent = "Offline Mode";
          syncStatusLabel.className = "status-tag status-offline";
        }
      }
    } catch (e) {
      console.error("[Sync] Failed to update state indicators:", e);
    }
  }

  /**
   * Helper implementing Stale-While-Revalidate (SWR) fetching pattern.
   * Instantly fires the callback with cached data, then fetches fresh data in the background.
   */
  async executeSWR(cacheKey, dataUrl, updateCallback) {
    // 1. Look in localStorage for the cacheKey
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const cachedData = JSON.parse(cached);
        if (updateCallback) {
          updateCallback(cachedData, true); // true means "stale" cache
        }
      } catch (e) {
        console.warn(`[Sync] Failed to parse cached SWR data for ${cacheKey}:`, e);
      }
    }

    // 2. Perform background fetch to dataUrl
    try {
      const response = await fetch(dataUrl, { mode: 'cors', redirect: 'follow' });
      if (response.ok) {
        const freshData = await response.json();
        const freshStr = JSON.stringify(freshData);
        
        // Zero-caching rule: don't overwrite good cached schedules with empty responses
        const isScheduleKey = cacheKey.includes("qual_schedule") || cacheKey.includes("scouting_schedule");
        const isEmptyResponse = !freshData || (Array.isArray(freshData) && freshData.length === 0) || (typeof freshData === "object" && !Array.isArray(freshData) && Object.keys(freshData).length === 0);
        if (isScheduleKey && isEmptyResponse && cached) {
          console.log(`[Sync] SWR ${cacheKey}: server returned empty, preserving existing cache.`);
          return;
        }

        if (freshStr !== cached) {
          localStorage.setItem(cacheKey, freshStr);
        }
        if (updateCallback) {
          updateCallback(freshData, false); // false means "verified fresh"
        }
      }
    } catch (err) {
      console.warn(`[Sync] Background SWR fetch failed for ${dataUrl}:`, err);
      if (navigator.onLine && window.showToast) {
        window.showToast("Network fetch failed. Please check your Web App URL in settings and verify it is deployed for 'Anyone'.", "warning");
      }
    }
  }

  /**
   * Fetches and caches the qualification schedule locally in localStorage using SWR
   */
  async fetchAndCacheQualSchedule(eventCode = null, updateCallback = null) {
    const cacheKey = eventCode ? `qual_schedule_${eventCode}` : "qual_schedule";
    
    // Dynamically hit the Google Apps Script webhook for the specific schedule
    const endpoint = this.getSyncEndpoint();
    const dataUrl = eventCode ? `${endpoint}?action=getQualSchedule&event=${eventCode}` : `${endpoint}?action=getQualSchedule`;
    
    await this.executeSWR(cacheKey, dataUrl, (data, isStale) => {
      // Update form dropdown if the user has already typed a match number
      if (window.updateTeamSelector) {
        window.updateTeamSelector();
      }
      if (updateCallback) {
        updateCallback(data, isStale);
      }
    });
  }

  /**
   * Fetches the list of active events from the Google Sheet backend
   */
  async fetchEventConfig() {
    const endpoint = this.getSyncEndpoint();
    if (!endpoint) {
      throw new Error("No sync endpoint URL configured.");
    }
    
    try {
      const response = await fetch(`${endpoint}?action=getEventConfig`, { mode: 'cors', redirect: 'follow' });
      if (response.ok) {
        const events = await response.json();
        if (events && Array.isArray(events)) {
          localStorage.setItem("event_config", JSON.stringify(events));
          console.log("[Sync] Event config successfully fetched and cached locally!");
          return events;
        } else {
          throw new Error("Invalid event config data structure returned from server.");
        }
      } else {
        throw new Error(`Server returned status: ${response.status}`);
      }
    } catch (err) {
      console.warn("[Sync] Failed to fetch event config:", err);
      throw err;
    }
  }

  /**
   * Fetches sorted top team list and completed matches for pre-event scouting using SWR
   */
  async fetchPreEventTeamList(eventCode, updateCallback = null) {
    if (!eventCode) return null;
    
    let resolvedData = null;
    try {
      // 1. Look in IndexedDB first
      resolvedData = await window.dbManager.getPreEventData(eventCode);
      if (resolvedData && updateCallback) {
        updateCallback(resolvedData, true); // true = stale/cached
      }
    } catch (e) {
      console.warn("[Sync] Failed to read pre-event data from IndexedDB:", e);
    }
    
    // 2. Perform background fetch
    const endpoint = this.getSyncEndpoint();
    const dataUrl = `${endpoint}?action=getPreEventData&event=${eventCode}`;
    
    try {
      const response = await fetch(dataUrl, { mode: 'cors', redirect: 'follow' });
      if (response.ok) {
        const freshData = await response.json();
        
        // Save to IndexedDB
        await window.dbManager.savePreEventData(eventCode, freshData);
        resolvedData = freshData;
        
        if (updateCallback) {
          updateCallback(freshData, false); // false = fresh
        }
      }
    } catch (err) {
      console.warn(`[Sync] Background pre-event data fetch failed for ${dataUrl}:`, err);
      if (navigator.onLine && window.showToast) {
        window.showToast("Network fetch failed. Please check your Web App URL in settings.", "warning");
      }
    }
    
    return resolvedData;
  }

  /**
   * Emergency fallback: exports only unsynced records to a downloadable JSON file.
   * Persists outside browser eviction limits (iOS memory pressure, etc.)
   */
  async backupUnsyncedToFile() {
    try {
      const unsyncedRecords = await window.dbManager.getUnsyncedRecords();
      if (unsyncedRecords.length === 0) {
        alert("No unsynced records to backup! All records have been successfully synced.");
        return;
      }

      const jsonContent = JSON.stringify(unsyncedRecords, null, 2);
      const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
      const link = document.createElement("a");

      const filename = `FTC_Emergency_Backup_${unsyncedRecords.length}records_${Date.now()}.json`;
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log(`[Sync] Emergency backup triggered: ${unsyncedRecords.length} unsynced records exported.`);
    } catch (err) {
      console.error("[Sync] Emergency backup failed:", err);
      alert("Emergency backup failed: " + err.message);
    }
  }
}

// Export global sync manager instance
window.syncManager = new ScoutingSyncManager();
