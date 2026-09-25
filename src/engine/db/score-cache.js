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
    if (source === 'label-ocr') out.ocrLabels = raw.ocrLabels === true;
    if (source === 'open-food-facts') out.useOpenFoodFacts = raw.useOpenFoodFacts === true;
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
    const m = String(raw || '').match(/^s:([^:]+):([A-Z0-9]{10})$/i);
    return m ? { store: m[1], asin: m[2].toUpperCase() } : null;
  }

  function listScores(all, { version, prefs } = {}, now = Date.now()) {
    const out = [];
    for (const [cacheKey, hit] of Object.entries(all || {})) {
      const parsed = parseKey(cacheKey);
      if (!parsed || !hit) continue;
      if (!valid(hit, { store: parsed.store, asin: parsed.asin, version, prefs }, now)) continue;
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

  const api = AIRmodule('scoreCache', {
    key, fingerprint, valid, parseKey, listScores, SCHEMA, TTL_MS, normalizeStore,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
