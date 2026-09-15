// Shared cache contract for content scripts and the popup. Old records are cache misses.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js');
  require('../categories.js');
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
      weights: Object.keys(weights).sort().map(k => [k, weights[k]]),
      foodOnly: raw.foodOnly !== false,
      ocrLabels: raw.ocrLabels === true,
      useOpenFoodFacts: raw.useOpenFoodFacts === true,
      sheetUrl: raw.sheetUrl || '', producersUrl: raw.producersUrl || '',
      sheetRevision: raw.sheetIndex?.t || 0, producerRevision: raw.producerIndex?.t || 0,
    });
  }
  function valid(hit, { store, asin, version, prefs, allowManual = false }, now = Date.now()) {
    return !!hit && hit.schema === SCHEMA && hit.v === version
      && hit.store === store && hit.asin === asin && hit.prefs === fingerprint(prefs)
      && Number.isFinite(hit.score) && hit.score >= 0 && hit.score <= 100
      && Number.isFinite(hit.t) && hit.t <= now && now - hit.t < TTL_MS
      && typeof hit.source === 'string' && !!hit.source
      && typeof hit.ingredients === 'string' && !!hit.ingredients
      && (allowManual || !['manual-paste', 'food-override'].includes(hit.source));
  }
  const api = AIRmodule('scoreCache', { key, fingerprint, valid, SCHEMA, TTL_MS });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
