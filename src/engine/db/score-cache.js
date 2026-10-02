// Shared cache contract for content scripts and the popup. Old records are cache misses.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js');
  require('../categories.js');
  require('./revision.js');
  require('./prefs.js');
}
(function () {
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // Schema 3: host normalized (no www.); OCR/OFF toggles only fingerprint entries from those sources.
  const SCHEMA = 3;

  function normalizeStore(store) {
    return String(store || '').toLowerCase().replace(/^www\./, '');
  }

  function key(store, asin) {
    return `s:${normalizeStore(store)}:${asin}`;
  }

  function fingerprint(raw = {}, source) {
    const weights = AIR.db.categories.resolveWeights(raw.weights);
    const out = {
      rules: (AIR.db.revision && AIR.db.revision.RULES_REVISION) || '',
      weights: Object.keys(weights).sort().map(k => [k, weights[k]]),
      foodOnly: raw.foodOnly !== false,
      sheetRevision: raw.sheetIndexRev || '', producerRevision: raw.producerIndexRev || '',
    };
    // Toggling OCR / OFF must not retire DOM-extracted chips. Only entries produced by those
    // paths include the matching flag in the fingerprint.
    if (source === 'label-ocr' || source === 'ocr') out.ocrLabels = AIR.db.prefs.sanitizeToggles(raw).ocrLabels;
    if (source === 'open-food-facts') out.useOpenFoodFacts = AIR.db.prefs.sanitizeToggles(raw).useOpenFoodFacts;
    return JSON.stringify(out);
  }

  // maxAgeMs: the speed setting's age limit (AIR.db.speed); TTL_MS when not given.
  function valid(hit, { store, asin, version, prefs, allowManual = false, maxAgeMs = TTL_MS }, now = Date.now()) {
    if (!hit || hit.schema !== SCHEMA || hit.v !== version) return false;
    if (normalizeStore(hit.store) !== normalizeStore(store) || hit.asin !== asin) return false;
    if (hit.prefs !== fingerprint(prefs, hit.source)) return false;
    if (!Number.isFinite(hit.score) || hit.score < 0 || hit.score > 100) return false;
    if (!Number.isFinite(hit.t) || hit.t > now || now - hit.t >= maxAgeMs) return false;
    if (typeof hit.source !== 'string' || !hit.source) return false;
    if (!allowManual && ['manual-paste', 'food-override'].includes(hit.source)) return false;
    return true;
  }

  function parseKey(raw) {
    const m = String(raw || '').match(/^s:([^:]+):([A-Z0-9]{6,12})$/i);
    return m ? { store: m[1], asin: m[2].toUpperCase() } : null;
  }

  // maxAgeMs: the speed setting's age limit, as for valid().
  const COMPARABLE_STORE = /^(?:amazon\.[a-z.]+|target\.com)$/;
  function listScores(all, { version, prefs, maxAgeMs = TTL_MS } = {}, now = Date.now()) {
    const out = [];
    for (const [cacheKey, hit] of Object.entries(all || {})) {
      const parsed = parseKey(cacheKey);
      if (!parsed || !hit || !COMPARABLE_STORE.test(parsed.store)) continue;
      if (!valid(hit, { store: parsed.store, asin: parsed.asin, version, prefs, maxAgeMs }, now)) continue;
      out.push({
        key: cacheKey, store: hit.store, asin: hit.asin,
        name: hit.name || '', score: hit.score, verdict: hit.verdict || '',
        nova: hit.nova, source: hit.source, t: hit.t,
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

  const api = AIRmodule('scoreCache', {
    key, fingerprint, valid, parseKey, listScores, SCHEMA, TTL_MS, normalizeStore, storedKeys, isCacheKey,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
