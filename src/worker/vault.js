// The two API keys a reader may paste in (OpenRouter, USDA FoodData Central), kept where a store page cannot
// reach them.
//
// chrome.storage.local is readable from every content script unless an extension restricts the whole area, and
// this extension's content scripts read their settings from it on sixteen stores. The keys sat there too: only
// the worker ever read them, but that was a convention, and a fault in the browser's page process on any of
// those stores would have exposed them (docs/AUDIT-2026-11-16.md, finding 9). IndexedDB belongs to the
// extension's own origin, which the worker and the extension's pages share and a content script does not.
//
// Loaded by the worker (background.js) and by the settings page, which shows whether a key is saved and writes
// a new one. A key found in chrome.storage.local, where builds up to 1.26.4 kept it, is moved here on first read
// and at worker start, and removed from there.
//
// Where IndexedDB is missing (Node tests, a private window that refuses it) the key stays in
// chrome.storage.local, as before: a saved key that cannot be read back would be worse than one kept the old way.
(function (root) {
  const DB_NAME = 'ingredient-check-vault';
  const STORE = 'secrets';
  const NAMES = ['openrouterKey', 'usdaKey'];

  function available() {
    try { return typeof root.indexedDB !== 'undefined' && !!root.indexedDB; }
    catch (e) { return false; }
  }

  function open() {
    return new Promise((resolve, reject) => {
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('vault-open'));
    });
  }

  // One transaction: `work(store)` returns a request to read, or nothing for a write.
  function run(mode, work) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('vault-transaction')); };
    }));
  }

  const local = {
    get: name => chrome.storage.local.get(name).then(o => (o ? o[name] : undefined)),
    set: (name, value) => chrome.storage.local.set({ [name]: value }),
    remove: name => chrome.storage.local.remove(name),
  };
  const known = name => NAMES.includes(name);
  const text = value => (typeof value === 'string' && value.length > 0 ? value : '');

  // -> the saved key, or '' when there is none.
  async function get(name) {
    if (!known(name)) return '';
    if (!available()) return text(await local.get(name));
    try {
      const kept = text(await run('readonly', store => store.get(name)));
      if (kept) return kept;
      // A key saved by an older build: move it, then take it out of the shared area.
      const old = text(await local.get(name));
      if (old) { await run('readwrite', store => { store.put(old, name); }); await local.remove(name); }
      return old;
    } catch (e) {
      return text(await local.get(name));
    }
  }

  async function set(name, value) {
    if (!known(name) || !text(value)) return false;
    if (!available()) { await local.set(name, value); return true; }
    try {
      await run('readwrite', store => { store.put(value, name); });
      await local.remove(name);
    } catch (e) {
      await local.set(name, value);
    }
    return true;
  }

  async function remove(name) {
    if (!known(name)) return;
    if (available()) { try { await run('readwrite', store => { store.delete(name); }); } catch (e) { /* nothing kept there */ } }
    await local.remove(name);
  }

  // Worker start: whatever an older build left in the shared area leaves it now, used or not.
  async function migrate() {
    if (!available()) return;
    for (const name of NAMES) { try { await get(name); } catch (e) { /* stays where it was */ } }
  }

  root.AIR = root.AIR || {};
  root.AIR.vault = { get, set, remove, migrate, NAMES };
})(typeof globalThis !== 'undefined' ? globalThis : self);
