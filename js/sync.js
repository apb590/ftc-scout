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
      // Create a compact CSV string representation of the 35 elements
      const dataPayload = this.convertToCompactCSVString(record);

      new QRious({
        element: canvasElement,
        value: dataPayload,
        size: 260,
        level: "M" // Medium error correction balance
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
   * Fetches and caches the qualification schedule locally in localStorage
   */
  async fetchAndCacheQualSchedule(eventCode = null) {
    try {
      const endpoint = this.getSyncEndpoint();
      if (!endpoint) return;
      
      let url = `${endpoint}?action=getQualSchedule`;
      if (eventCode) {
        url += `&event=${encodeURIComponent(eventCode)}`;
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const schedule = await response.json();
        
        // Zero-caching rule: if the schedule is empty {}, do NOT save it to localStorage
        const hasKeys = schedule && Object.keys(schedule).length > 0;
        if (!hasKeys) {
          console.log("[Sync] Qual schedule is empty, skipping local caching to allow continuous background updates.");
          return;
        }
        
        const cacheKey = eventCode ? `qual_schedule_${eventCode}` : "qual_schedule";
        localStorage.setItem(cacheKey, JSON.stringify(schedule));
        console.log(`[Sync] Qual schedule for ${eventCode || 'active event'} successfully cached locally!`);
        
        // Update the form dropdown if the user has already typed a match number
        if (window.updateTeamSelector) {
          window.updateTeamSelector();
        }
      }
    } catch (err) {
      console.warn("[Sync] Failed to fetch qual schedule:", err);
    }
  }

  /**
   * Fetches the list of active events from the Google Sheet backend
   */
  async fetchEventConfig() {
    try {
      const endpoint = this.getSyncEndpoint();
      if (endpoint) {
        const response = await fetch(`${endpoint}?action=getEventConfig`);
        if (response.ok) {
          const events = await response.json();
          localStorage.setItem("event_config", JSON.stringify(events));
          console.log("[Sync] Event config successfully fetched and cached locally!");
          return events;
        }
      }
    } catch (err) {
      console.warn("[Sync] Failed to fetch event config, falling back to cache:", err);
    }
    
    const cached = localStorage.getItem("event_config");
    try {
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      console.warn("[Sync] Failed to parse cached event_config (fallback):", e);
      return [];
    }
  }

  /**
   * Fetches sorted top team list and completed matches for pre-event scouting
   */
  async fetchPreEventTeamList(eventCode) {
    if (!eventCode) return null;
    try {
      const endpoint = this.getSyncEndpoint();
      if (endpoint) {
        const response = await fetch(`${endpoint}?action=getPreEventData&event=${encodeURIComponent(eventCode)}`);
        if (response.ok) {
          const data = await response.json();
          localStorage.setItem(`preevent_data_${eventCode}`, JSON.stringify(data));
          console.log(`[Sync] Pre-event data for ${eventCode} successfully cached!`);
          return data;
        }
      }
    } catch (err) {
      console.warn(`[Sync] Failed to fetch pre-event data for ${eventCode}, falling back to cache:`, err);
    }
    
    const cached = localStorage.getItem(`preevent_data_${eventCode}`);
    try {
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      console.warn(`[Sync] Failed to parse cached preevent_data for ${eventCode} (fallback):`, e);
      return null;
    }
  }
}

// Export global sync manager instance
window.syncManager = new ScoutingSyncManager();
