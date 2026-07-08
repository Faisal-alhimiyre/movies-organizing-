(function () {
  "use strict";

  const DB_NAME = "watchlist-app-v2";
  const DB_VERSION = 1;
  const STORES = {
    watchlistCache: "watchlist_cache",
    importJobs: "import_jobs",
    importItems: "import_items",
  };

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.watchlistCache)) {
          db.createObjectStore(STORES.watchlistCache, { keyPath: "listId" });
        }
        if (!db.objectStoreNames.contains(STORES.importJobs)) {
          db.createObjectStore(STORES.importJobs, { keyPath: "listId" });
        }
        if (!db.objectStoreNames.contains(STORES.importItems)) {
          db.createObjectStore(STORES.importItems, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          let result;
          try {
            result = fn(store, transaction);
          } catch (err) {
            reject(err);
            return;
          }
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error("transaction aborted"));
        })
    );
  }

  async function putWatchlistCache(listId, data, watched, meta = {}) {
    if (!listId || !data) return false;
    const itemCount = meta.itemCount ?? countNestedItems(data);
    await tx(STORES.watchlistCache, "readwrite", (store) => {
      store.put({
        listId,
        data,
        watched: watched || {},
        itemCount,
        revision: meta.revision ?? Date.now(),
        savedAt: Date.now(),
      });
    });
    return true;
  }

  async function getWatchlistCache(listId) {
    if (!listId) return null;
    return tx(STORES.watchlistCache, "readonly", (store) => {
      const req = store.get(listId);
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function deleteWatchlistCache(listId) {
    if (!listId) return;
    await tx(STORES.watchlistCache, "readwrite", (store) => {
      store.delete(listId);
    });
  }

  async function putImportJob(listId, job) {
    await tx(STORES.importJobs, "readwrite", (store) => {
      store.put({ listId, job, updatedAt: Date.now() });
    });
  }

  async function getImportJob(listId) {
    const row = await tx(STORES.importJobs, "readonly", (store) => {
      const req = store.get(listId);
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
    return row?.job || null;
  }

  async function deleteImportJob(listId) {
    await tx(STORES.importJobs, "readwrite", (store) => {
      store.delete(listId);
    });
  }

  async function putImportItems(listId, items) {
    const entries = Object.entries(items || {});
    await tx(STORES.importItems, "readwrite", (store) => {
      for (const [itemId, item] of entries) {
        store.put({ key: `${listId}:${itemId}`, listId, itemId, item, updatedAt: Date.now() });
      }
    });
  }

  async function getImportItems(listId) {
    const items = {};
    await tx(STORES.importItems, "readonly", (store) => {
      const req = store.openCursor();
      return new Promise((resolve, reject) => {
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          const row = cursor.value;
          if (row.listId === listId && row.item) {
            items[row.itemId] = row.item;
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
    return items;
  }

  async function deleteImportItems(listId) {
    const keys = [];
    await tx(STORES.importItems, "readonly", (store) => {
      const req = store.openCursor();
      return new Promise((resolve, reject) => {
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          if (cursor.value.listId === listId) keys.push(cursor.value.key);
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
    if (!keys.length) return;
    await tx(STORES.importItems, "readwrite", (store) => {
      for (const key of keys) store.delete(key);
    });
  }

  async function clearImportData(listId) {
    await deleteImportJob(listId);
    await deleteImportItems(listId);
  }

  function countNestedItems(data) {
    let n = 0;
    for (const genres of Object.values(data || {})) {
      if (!genres || typeof genres !== "object") continue;
      for (const titles of Object.values(genres)) {
        if (Array.isArray(titles)) n += titles.length;
      }
    }
    return n;
  }

  async function estimateUsage() {
    if (!navigator.storage?.estimate) return null;
    try {
      return await navigator.storage.estimate();
    } catch {
      return null;
    }
  }

  window.WatchlistIdb = {
    putWatchlistCache,
    getWatchlistCache,
    deleteWatchlistCache,
    putImportJob,
    getImportJob,
    deleteImportJob,
    putImportItems,
    getImportItems,
    clearImportData,
    countNestedItems,
    estimateUsage,
  };
})();
