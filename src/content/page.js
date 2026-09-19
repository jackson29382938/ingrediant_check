// Shared content-script state and helpers used by both the product page and search tiles.
//
// Kept as a bag of closures (`AIR.page`) so product.js / search.js / main.js can split without a
// bundler. Tests that used to rewrite main.js's IIFE now read this object.

(function (root) {
  root.AIR = root.AIR || {};

  const HOST_ID = 'air-score-panel';
  const BADGE_ATTR = 'data-air-badge';
  const state = { enabled: true, badges: true, hoverScore: false, autoScoreSearch: false, foodOnly: true,
    ocrLabels: false, sendDiagnostics: false, settled: null, lastBadgeScore: undefined,
    prefs: { weights: {}, allergens: [], diets: [], avoidList: [] }, lastKey: null, requestId: 0,
    failedExtracts: 0, manual: null };

  const ENGINE_VERSION = (() => {
    try { return chrome.runtime.getManifest().version; } catch (e) { return '0'; }
  })();
  const CACHE = root.AIR.db && root.AIR.db.scoreCache;
  state.cacheOptions = {};
  state.pageScore = null;
  const cachePrefs = () => ({ ...state.cacheOptions, weights: state.prefs.weights, foodOnly: state.foodOnly });
  const cacheKey = asin => CACHE ? CACHE.key(location.hostname, asin) : `s:${location.hostname}:${asin}`;
  const usableCache = (hit, asin) => !!CACHE && CACHE.valid(hit, {
    store: location.hostname, asin, version: ENGINE_VERSION, prefs: cachePrefs(),
  });

  const MAX_EXTRACT_RETRIES = 8;

  const isProductPage = () => /\/(dp|gp\/product)\/[A-Z0-9]{10}/.test(location.pathname);
  const isListPage = () => /\/(s|b|gp\/browse|stores)\b/.test(location.pathname) || location.search.includes('k=');
  const isRelevantPage = () => isProductPage() || isListPage();

  // Below this share of the ingredient list matching anything the rulebase knows, the score is not
  // evidence about the product — it is evidence that the rules are in the wrong language.
  const MIN_COVERAGE = 0.34;
  const unreadable = result =>
    typeof result.coverage === 'number' && result.parsed > 0 && result.coverage < MIN_COVERAGE;

  function sendDiagnostic(data, result, source, text) {
    if (!state.sendDiagnostics || !root.AIR.db || !root.AIR.db.diagnostics) return;
    try {
      const record = root.AIR.db.diagnostics.buildRecord(data, result, {
        version: ENGINE_VERSION,
        store: location.hostname,
        source,
        text: text || data.text,
        weights: state.prefs.weights,
        defaultWeights: root.AIR.db.categories && root.AIR.db.categories.DEFAULT_WEIGHTS,
      });
      chrome.runtime.sendMessage({ type: 'diagnostic', record }, () => void chrome.runtime.lastError);
    } catch (e) { /* never let telemetry break scoring */ }
  }

  function publishActionBadge(result) {
    const score = result && typeof result.score === 'number' ? result.score : null;
    if (score == null) state.pageScore = null;
    if (score === state.lastBadgeScore) return;
    state.lastBadgeScore = score;
    try {
      chrome.runtime.sendMessage(
        score != null
          ? { type: 'pageScore', score, verdict: result.verdict }
          : { type: 'pageScore' },
        () => void chrome.runtime.lastError
      );
    } catch (e) { /* messaging unavailable in some frames */ }
  }

  function cacheScore(asin, result, name, source, ingredients, provenanceSource) {
    if (!asin || !result || !CACHE) return;
    const entry = {
      schema: CACHE.SCHEMA, v: ENGINE_VERSION, t: Date.now(),
      store: location.hostname, asin, prefs: CACHE.fingerprint(cachePrefs()),
      score: result.score, verdict: result.verdict, nova: result.nova,
      source: source || 'page',
      provenanceSource: provenanceSource || '',
      name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    };
    if (isProductPage()) state.pageScore = entry;
    if (source === 'manual-paste' || source === 'food-override') { cache(asin, null); return; }
    cache(asin, entry);
  }

  function cache(asin, value) {
    if (!asin) return;
    try {
      const work = value
        ? chrome.storage.local.set({ [cacheKey(asin)]: value })
        : chrome.storage.local.remove(cacheKey(asin));
      work?.catch?.(() => {});
    } catch (e) { /* storage unavailable in some frames */ }
  }

  const page = {
    HOST_ID, BADGE_ATTR, state, ENGINE_VERSION, CACHE,
    cachePrefs, cacheKey, usableCache,
    MAX_EXTRACT_RETRIES, isProductPage, isListPage, isRelevantPage,
    MIN_COVERAGE, unreadable,
    sendDiagnostic, publishActionBadge, cacheScore, cache,
  };
  root.AIR.page = page;
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof globalThis !== 'undefined' ? globalThis : self);
