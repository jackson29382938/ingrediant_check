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
    failedExtracts: 0, manual: null, lastTextSig: null, lastFailSig: null };

  const ENGINE_VERSION = (() => {
    try { return chrome.runtime.getManifest().version; } catch (e) { return '0'; }
  })();
  const CACHE = root.AIR.db.scoreCache;
  state.cacheOptions = {};
  state.pageScore = null;
  const cachePrefs = () => ({ ...state.cacheOptions, weights: state.prefs.weights, foodOnly: state.foodOnly });
  const storeHost = () => CACHE.normalizeStore(location.hostname);
  const cacheKey = asin => CACHE.key(location.hostname, asin);
  const usableCache = (hit, asin) => CACHE.valid(hit, {
    store: location.hostname, asin, version: ENGINE_VERSION, prefs: cachePrefs(),
  });

  const MAX_EXTRACT_RETRIES = 8;

  const isProductPage = () => /\/(dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/.test(location.pathname);
  // Do not treat a PDP with a stray k= param as a search page.
  const isListPage = () => !isProductPage() && (
    /\/(s|b|gp\/browse|stores)\b/.test(location.pathname) || /[?&]k=/.test(location.search)
  );
  const isRelevantPage = () => isProductPage() || isListPage();

  // Cheap fingerprint of published ingredient text so a settled score can detect late NIC hydration
  // without re-running the full extract on every Amazon ad mutation.
  function ingredientSig(doc = document) {
    try {
      const el = doc.querySelector(
        '#nic-ingredients-content, #important-information, #productFactsDesktop_feature_div, '
        + '[data-a-expander-name="ingredient_text"], .a-expander-content'
      );
      const t = el && (el.innerText || '').replace(/\s+/g, ' ').trim();
      return t ? t.slice(0, 320) : '';
    } catch (e) { return ''; }
  }

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
    const status = result && result.status;
    if (score == null && !status) state.pageScore = null;
    const badgeKey = status || score;
    if (badgeKey === state.lastBadgeScore) return;
    state.lastBadgeScore = badgeKey;
    try {
      chrome.runtime.sendMessage(
        score != null
          ? { type: 'pageScore', score, verdict: result.verdict }
          : status
            ? { type: 'pageScore', status }
            : { type: 'pageScore' },
        () => void chrome.runtime.lastError
      );
    } catch (e) { /* messaging unavailable in some frames */ }
  }

  // `t` is when the ingredients were read: a score worked out now from a 20-day-old reading must
  // expire when that reading does.
  function cacheScore(asin, result, name, source, provenanceSource, t = Date.now()) {
    if (!asin || !result) return;
    const entry = {
      schema: CACHE.SCHEMA, v: ENGINE_VERSION, t,
      store: storeHost(), asin, prefs: CACHE.fingerprint(cachePrefs(), source || 'page'),
      score: result.score, verdict: result.verdict, nova: result.nova,
      source: source || 'page',
      provenanceSource: provenanceSource || '',
      name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    };
    if (isProductPage()) state.pageScore = entry;
    if (source === 'manual-paste' || source === 'food-override') { cache(asin, null); return; }
    cache(asin, entry);
  }

  // What was read off the page, before weighting (docs/CACHE.md): kept on this computer as
  // `p:<store>:<asin>` so a weight change rescores without refetching, and — unless `share` is
  // false because the row came FROM the shared cache — queued for the shared products tab. The
  // worker drops the upload when the shared database is off. Pasted lists never get here.
  function rememberProduct(asin, scan, { share = true } = {}) {
    const C = root.AIR.db.productCache;
    const row = scan && scan.key ? C.sanitize(scan) : C.fromScan({ store: storeHost(), asin, ...scan });
    if (!row) return null;
    try {
      // Pulls are the shared tab's business; on this computer only age decides a rescan.
      chrome.storage.local.set({ [C.localKey(row.store, row.asin)]: { ...row, pulls: 0, t: Date.parse(row.scanned_at) } })
        ?.catch?.(() => {});
      if (share) chrome.runtime.sendMessage({ type: 'productsQueue', upserts: [row] }, () => void chrome.runtime.lastError);
    } catch (e) { /* context invalidated */ }
    return row;
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
    cachePrefs, cacheKey, usableCache, storeHost, ingredientSig,
    MAX_EXTRACT_RETRIES, isProductPage, isListPage, isRelevantPage,
    MIN_COVERAGE, unreadable,
    sendDiagnostic, publishActionBadge, cacheScore, cache, rememberProduct,
  };
  root.AIR.page = page;
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof globalThis !== 'undefined' ? globalThis : self);
