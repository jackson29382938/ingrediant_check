// Large sheet / producer indexes live in IndexedDB so chrome.storage.local stays under quota.
// Revision strings stay in chrome.storage.local for the score-cache fingerprint.
// Falls back to chrome.storage.local when IndexedDB is unavailable (Node tests, older runtimes).
// Function declarations so importScripts / vm preload expose them on the worker global.

var SHEET_IDB_NAME = 'ingredient-check-sheets';
var SHEET_IDB_STORE = 'indexes';
var SHEET_IDB_VERSION = 1;

function sheetIdbAvailable() {
  try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
  catch (e) { return false; }
}

function openSheetIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHEET_IDB_NAME, SHEET_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHEET_IDB_STORE)) db.createObjectStore(SHEET_IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb-open'));
  });
}

function idbPut(key, value) {
  return openSheetIdb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SHEET_IDB_STORE, 'readwrite');
    tx.objectStore(SHEET_IDB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('idb-put')); };
  }));
}

function idbGet(key) {
  return openSheetIdb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SHEET_IDB_STORE, 'readonly');
    const req = tx.objectStore(SHEET_IDB_STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error || new Error('idb-get')); };
  }));
}

function idbDelete(key) {
  return openSheetIdb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SHEET_IDB_STORE, 'readwrite');
    tx.objectStore(SHEET_IDB_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('idb-del')); };
  }));
}

function putSheetIndex(storageKey, payload) {
  if (sheetIdbAvailable()) {
    return idbPut(storageKey, payload).then(() => {
      try { return chrome.storage.local.remove(storageKey); } catch (e) { return undefined; }
    });
  }
  return chrome.storage.local.set({ [storageKey]: payload });
}

function getSheetIndex(storageKey) {
  if (sheetIdbAvailable()) {
    return idbGet(storageKey).then(hit => {
      if (hit) return hit;
      return chrome.storage.local.get(storageKey).then(all => all[storageKey] || null);
    }).catch(() => chrome.storage.local.get(storageKey).then(all => all[storageKey] || null));
  }
  return chrome.storage.local.get(storageKey).then(all => all[storageKey] || null);
}

function clearSheetIndex(storageKey) {
  const dropIdb = sheetIdbAvailable() ? idbDelete(storageKey).catch(() => {}) : Promise.resolve();
  return dropIdb.then(() => {
    try { return chrome.storage.local.remove(storageKey); } catch (e) { return undefined; }
  });
}
