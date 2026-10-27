// Shared cache contract for content scripts and the popup. Old records are cache misses.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js');
  require('../categories.js');
  require('./revision.js');
  require('./prefs.js');
  require('./speed.js');
  require('../../stores/registry.js');
}
(function () {
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // Schema 3: host normalized (no www.); OCR/OFF toggles only fingerprint entries from those sources.
  const SCHEMA = 3;
  // Bump when extraction interpretation or the score-record contract changes. Rules and
  // preferences have their own fingerprint; a UI/docs/app-version update is not a cache reset.
  const CACHE_REVISION = 1;
  const LEGACY_COMPATIBLE = new Set(['1.15.0', '1.15.1']);

  function normalizeStore(store) {
    return String(store || '').toLowerCase().replace(/^www\./, '');
  }

  function key(store, asin) {
    return `s:${normalizeStore(store)}:${asin}`;
  }

  // What a saved score was computed from. A food score reads the food weights, the food-only switch and
  // the provenance indexes. A personal-care or supplement index reads none of those: it reads the
  // rating style, the category switch and, for the preference-focused style only, the avoid list.
  // `category` is the saved result's own ('food' or absent for food), so each kind is retired by its
  // own settings and by the rules revision, never by the other's.
  function fingerprint(raw = {}, source, category) {
    const out = { rules: (AIR.db.revision && AIR.db.revision.RULES_REVISION) || '' };
    if (category && category !== 'food') {
      const scoring = AIR.db.prefs.sanitizeScoring(raw);
      out.ratingStyle = scoring.ratingStyle;
      out.personalCareEnabled = raw.personalCareEnabled !== false;
      out.avoidList = scoring.ratingStyle === 'preferences' ? scoring.avoidList : [];
    } else {
      const weights = AIR.db.categories.resolveWeights(raw.weights);
      out.weights = Object.keys(weights).sort().map(k => [k, weights[k]]);
      out.foodOnly = raw.foodOnly !== false;
      out.sheetRevision = raw.sheetIndexRev || '';
      out.producerRevision = raw.producerIndexRev || '';
    }
    // Toggling OCR / OFF must not retire DOM-extracted chips. Only entries produced by those
    // paths include the matching flag in the fingerprint.
    if (source === 'label-ocr' || source === 'ocr') out.ocrLabels = AIR.db.prefs.sanitizeToggles(raw).ocrLabels;
    if (source === 'open-food-facts') out.useOpenFoodFacts = AIR.db.prefs.sanitizeToggles(raw).useOpenFoodFacts;
    return JSON.stringify(out);
  }

  // maxAgeMs: the speed setting's age limit (AIR.db.speed); TTL_MS when not given.
  function valid(hit, { store, asin, version, prefs, allowManual = false, maxAgeMs = TTL_MS }, now = Date.now()) {
    if (!hit || hit.schema !== SCHEMA || typeof hit.v !== 'string' || hit.v.length > 30 || !/^\d+(?:\.\d+){0,3}$/.test(hit.v)) return false;
    if (Object.hasOwn(hit, 'cacheRevision') ? hit.cacheRevision !== CACHE_REVISION
      : hit.v !== version && !(CACHE_REVISION === 1 && LEGACY_COMPATIBLE.has(hit.v))) return false;
    if (normalizeStore(hit.store) !== normalizeStore(store) || hit.asin !== asin) return false;
    if (hit.prefs !== fingerprint(prefs, hit.source, hit.category)) return false;
    if (!Number.isFinite(hit.score) || hit.score < 0 || hit.score > 100) return false;
    if (!Number.isFinite(hit.t) || hit.t > now || now - hit.t >= maxAgeMs) return false;
    if (typeof hit.source !== 'string' || !hit.source) return false;
    if (!allowManual && ['manual-paste', 'food-override'].includes(hit.source)) return false;
    return true;
  }

  // A saved score is a food score unless it says otherwise; entries written before categories existed have no field.
  const isFood = hit => !hit || !hit.category || hit.category === 'food';

  function parseKey(raw) {
    const m = String(raw || '').match(/^s:([^:]+):([A-Z0-9]{5,15})$/i);
    return m ? { store: m[1], asin: m[2].toUpperCase() } : null;
  }

  // maxAgeMs: the speed setting's age limit, as for valid().
  function listScores(all, { version, prefs, maxAgeMs = TTL_MS } = {}, now = Date.now()) {
    const out = [];
    for (const [cacheKey, hit] of Object.entries(all || {})) {
      const parsed = parseKey(cacheKey);
      const store = parsed && AIR.stores?.storeForHost(parsed.store);
      if (!store || store.status === 'planned' || !hit) continue;
      if (!valid(hit, { store: parsed.store, asin: parsed.asin, version, prefs, maxAgeMs }, now)) continue;
      out.push({
        key: cacheKey, store: hit.store, asin: hit.asin,
        name: hit.name || '', score: hit.score, verdict: hit.verdict || '',
        nova: hit.nova, source: hit.source, t: hit.t, category: hit.category || 'food', ratingStyle: hit.ratingStyle || 'food',
        provenanceSource: hit.provenanceSource || '',
      });
    }
    out.sort((a, b) => (b.t || 0) - (a.t || 0));
    return out;
  }

  // Every key in a storage area, without reading the values: Chrome 130+ has getKeys(); older ones
  // (the manifest allows 116) read everything once. get(null) loads every saved product reading,
  // up to 10,000 of them with their ingredient text, just to count or list them.
  async function storedKeys(area) {
    if (area && typeof area.getKeys === 'function') return area.getKeys();
    return Object.keys((await area.get(null)) || {});
  }
  const isCacheKey = k => /^(s|p|off):/.test(k);

  // Stale answers must still match product, engine and settings; only age gets a grace period.
  function recall(hit, context, now = Date.now()) {
    const options = AIR.db.speed.sanitizeRecall(context.prefs);
    if (!options.cacheFirst) return null;
    if (valid(hit, context, now)) return { hit, stale: false, refresh: false };
    const maxAgeMs = (context.maxAgeMs ?? TTL_MS) + options.cacheGraceDays * AIR.db.speed.DAY;
    if (!options.cacheGraceDays || !valid(hit, { ...context, maxAgeMs }, now)) return null;
    return { hit, stale: true, refresh: options.cacheBackgroundRefresh };
  }

  // Per-content-script LRU: disk remains authoritative, and writes/deletes invalidate memory.
  // Bound both item count and bytes; never cache history, tokens or general settings here.
  function createReader(area, events) {
    const memory = new Map(); let bytes = 0, epoch = 0;
    const clear = () => { memory.clear(); bytes = 0; epoch++; };
    events?.addListener((changes, storageArea) => {
      if (storageArea && storageArea !== 'local') return;
      if (changes.cacheMemory) { clear(); return; }
      epoch++;
      for (const key of Object.keys(changes)) {
        const old = memory.get(key); if (old) { bytes -= old.bytes; memory.delete(key); }
      }
    });
    return (keys, prefs = {}, callback) => {
      const enabled = AIR.db.speed.sanitizeRecall(prefs).cacheMemory;
      if (!enabled) clear();
      const out = {}, missing = [], turn = epoch;
      for (const key of new Set(keys)) {
        const item = enabled && memory.get(key);
        if (item) { memory.delete(key); memory.set(key, item); out[key] = item.value; }
        else missing.push(key);
      }
      if (!missing.length) { callback?.(out); return Promise.resolve(out); }
      return new Promise((resolve, reject) => {
        try { area.get(missing, value => {
          const error = typeof chrome !== 'undefined' && chrome.runtime?.lastError;
          if (error) { if (callback) { callback({}); resolve({}); } else reject(new Error(error.message)); return; }
          const got = value || {}; Object.assign(out, got);
          if (enabled && turn === epoch) for (const key of missing) {
            if (!/^(s|p):/.test(key) || !got[key]) continue;
            const size = JSON.stringify(got[key]).length * 2;
            if (size > 2 * 1024 * 1024) continue;
            const old = memory.get(key); if (old) bytes -= old.bytes;
            memory.delete(key); memory.set(key, { value: got[key], bytes: size }); bytes += size;
            while (memory.size > 256 || bytes > 2 * 1024 * 1024) {
              const first = memory.keys().next().value; bytes -= memory.get(first).bytes; memory.delete(first);
            }
          }
          callback?.(out); resolve(out);
        }); } catch (error) { reject(error); }
      });
    };
  }

  const readers = new WeakMap();
  function readLocal(keys, prefs, callback, storage = globalThis.chrome?.storage) {
    let reader = readers.get(storage.local);
    if (!reader) { reader = createReader(storage.local, storage.onChanged); readers.set(storage.local, reader); }
    const task = reader(keys, prefs, callback);
    return task;
  }

  const api = AIRmodule('scoreCache', {
    key, fingerprint, valid, isFood, recall, createReader, readLocal, parseKey, listScores, SCHEMA, CACHE_REVISION, TTL_MS, normalizeStore, storedKeys, isCacheKey,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
