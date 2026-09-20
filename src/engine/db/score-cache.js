// Shared cache contract for content scripts and the popup. Old records are cache misses.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js');
  require('../categories.js');
  require('./revision.js');
}
(function () {
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const SCHEMA = 2;
  function key(store, asin) {
    return `s:${String(store).toLowerCase()}:${asin}`;
  }
  function fingerprint(raw = {}) {
    const weights = AIR.db.categories.resolveWeights(raw.weights);
    return JSON.stringify({
      // A rule edit retires every cached score, whether or not the manifest version moved.
      rules: (AIR.db.revision && AIR.db.revision.RULES_REVISION) || '',
      weights: Object.keys(weights).sort().map(k => [k, weights[k]]),
      foodOnly: raw.foodOnly !== false,
      ocrLabels: raw.ocrLabels === true,
      useOpenFoodFacts: raw.useOpenFoodFacts === true,
      sheetUrl: raw.sheetUrl || '', producersUrl: raw.producersUrl || '',
      // Content hashes written by the worker, so an unchanged sheet does not retire every score.
      sheetRevision: raw.sheetIndexRev || '', producerRevision: raw.producerIndexRev || '',
    });
  }
  function valid(hit, { store, asin, version, prefs, allowManual = false }, now = Date.now()) {
    return !!hit && hit.schema === SCHEMA && hit.v === version
      && hit.store === store && hit.asin === asin && hit.prefs === fingerprint(prefs)
      && Number.isFinite(hit.score) && hit.score >= 0 && hit.score <= 100
      && Number.isFinite(hit.t) && hit.t <= now && now - hit.t < TTL_MS
      && typeof hit.source === 'string' && !!hit.source
      && (allowManual || !['manual-paste', 'food-override'].includes(hit.source));
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
  const api = AIRmodule('scoreCache', { key, fingerprint, valid, parseKey, listScores, SCHEMA, TTL_MS });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
