/**
 * db.js - Promise-based IndexedDB Storage Wrapper
 * Handles auto-saving active forms and storing final match records offline.
 */
class ScoutingDatabase {
  constructor() {
    this.dbName = "FTCDecodeScoutingDB";
    this.dbVersion = 1;
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Initializes the IndexedDB database instance
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store 1: autosave - holds current working draft
        if (!db.objectStoreNames.contains("autosave")) {
          db.createObjectStore("autosave", { keyPath: "id" });
        }

        // Store 2: records - holds final scouting entries
        if (!db.objectStoreNames.contains("records")) {
          // Compounds keys will be generated as custom "id" string: `${matchno}_${teamno}_${username}`
          const recordStore = db.createObjectStore("records", { keyPath: "id" });
          recordStore.createIndex("synced", "synced", { unique: false });
          recordStore.createIndex("matchno", "matchno", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log("[Database] IndexedDB initialized successfully");
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("[Database] Error opening IndexedDB:", event.target.error);
        this.initPromise = null; // Let future retries try again
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  /**
   * Saves the active form inputs as a draft (autosave)
   */
  async saveDraft(data) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("autosave", "readwrite");
      const store = transaction.objectStore("autosave");
      
      const draft = {
        id: "active_draft",
        timestamp: Date.now(),
        data: data
      };

      const request = store.put(draft);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieves the active draft state
   */
  async getDraft() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("autosave", "readonly");
      const store = transaction.objectStore("autosave");
      const request = store.get("active_draft");

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Clears the active draft (e.g. after successful submission)
   */
  async clearDraft() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("autosave", "readwrite");
      const store = transaction.objectStore("autosave");
      const request = store.delete("active_draft");

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Saves a finalized scouting record
   */
  async saveRecord(record) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("records", "readwrite");
      const store = transaction.objectStore("records");

      // Generate the compound primary key: matchno_teamno_username
      const cleanUsername = record.username ? record.username.trim().toLowerCase() : "anonymous";
      const recordId = `${record.matchno}_${record.teamno}_${cleanUsername}`;
      
      const recordToSave = {
        ...record,
        id: recordId,
        synced: record.synced || 0, // 0 = false, 1 = true
        timestamp: record.timestamp || Date.now()
      };

      const request = store.put(recordToSave);

      request.onsuccess = () => {
        console.log(`[Database] Record saved locally: ${recordId}`);
        resolve(recordId);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieves all saved scout records (sorted by timestamp descending)
   */
  async getAllRecords() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("records", "readonly");
      const store = transaction.objectStore("records");
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result || [];
        // Sort descending by timestamp
        records.sort((a, b) => b.timestamp - a.timestamp);
        resolve(records);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieves all records that have not been successfully synced yet
   */
  async getUnsyncedRecords() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("records", "readonly");
      const store = transaction.objectStore("records");
      const index = store.index("synced");
      const request = index.getAll(0); // 0 means unsynced

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Updates the synchronization flag for a record
   */
  async setSynced(id, isSynced) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("records", "readwrite");
      const store = transaction.objectStore("records");

      // First fetch the record
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          reject(new Error(`Record ${id} not found in database`));
          return;
        }

        record.synced = isSynced ? 1 : 0;
        const putRequest = store.put(record);

        putRequest.onsuccess = () => resolve(true);
        putRequest.onerror = (e) => reject(e.target.error);
      };

      getRequest.onerror = (e) => reject(e.target.error);
    });
  }
}

// Export global database manager instance
window.dbManager = new ScoutingDatabase();
