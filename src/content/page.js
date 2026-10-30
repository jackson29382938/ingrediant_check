// Shared content-script state and helpers used by both the product page and search tiles.
//
// Kept as a bag of closures (`AIR.page`) so product.js / search.js / main.js can split without a
// bundler. Tests that used to rewrite main.js's IIFE now read this object.

(function (root) {
  root.AIR = root.AIR || {};

  const HOST_ID = 'air-score-panel';
  const BADGE_ATTR = 'data-air-badge';
  const state = { enabled: true, badges: true, hoverScore: false, autoScoreSearch: true, foodOnly: true,
    hoverBreakdown: true, breakdownDetail: 'full', breakdownDelayMs: 200, scoreHoverDelayMs: 600, panelOpen: false,
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
  // The speed setting (AIR.db.speed): how old a cached score or saved reading may be, and whether a
  // shared-database reading may answer.
  state.speedMode = 'balanced';
  const BALANCED = { mode: 'balanced', maxAgeMs: CACHE.TTL_MS, autoFetches: 60, sharedDays: 30 };
  state.ratePace = 'normal';
  const pace = () => (root.AIR.db.speed ? root.AIR.db.speed.pace(state.ratePace) : { concurrent: 3, gapMs: 250 });
  const speed = () => (root.AIR.db.speed ? root.AIR.db.speed.profile(state.speedMode) : BALANCED);
  const cacheContext = asin => ({
    store: location.hostname, asin, version: ENGINE_VERSION, prefs: { ...cachePrefs(), ocrLabels: state.ocrLabels, useOpenFoodFacts: (state.cacheOptions || {}).useOpenFoodFacts }, maxAgeMs: speed().maxAgeMs,
  });
  const recallCache = (hit, asin) => CACHE.recall(hit, cacheContext(asin));
  const usableCache = (hit, asin) => state.cacheOptions.cacheFirst !== false && CACHE.valid(hit, cacheContext(asin));
  const freshLocal = row => state.cacheOptions.cacheFirst !== false && !root.AIR.db.productCache.stale(row, Date.now(), speed().maxAgeMs);
  const sharedOk = row => !!row && (!root.AIR.db.speed || root.AIR.db.speed.sharedUsable(row.scanned_at, state.speedMode));
  // Product readings from other computers, and uploading this one's: only when the reader turned
  // them on (prefs.js sharedProducts). The worker checks again; this saves the message.
  const sharedProductsOn = () => state.cacheOptions.sharedCache !== false && state.cacheOptions.sharedProducts === true;

  const MAX_EXTRACT_RETRIES = 8;

  // Public-page scripts also load on cart routes for SPA navigation. A search query on a cart
  // must not wake Amazon's authenticated search scanner or its recommendation processing.
  const isPrivatePage = () => /\/(?:cart|checkout|account|orders|ap|buy)(?:\/|\.|$)/i.test(location.pathname);
  const isProductPage = () => !isPrivatePage() && /\/(dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}/.test(location.pathname);
  // Do not treat a PDP with a stray k= param as a search page.
  const isListPage = () => !isPrivatePage() && !isProductPage() && (
    /\/(s|b|gp\/browse|stores)\b/.test(location.pathname) || /[?&]k=/.test(location.search)
  );
  const isRelevantPage = () => isProductPage() || isListPage();

  // Read all published scoring evidence, including late Nutrition Facts hydration. Keeping the
  // complete text matters: additives near the end of a long list must invalidate a settled score.
  // This avoids running extraction on unrelated ad mutations while retaining every label change.
  function ingredientSig(doc = document) {
    try {
      const selectors = [
        '#nic-ingredients-content', '#important-information', '#productFactsDesktop_feature_div',
        '#nutritionalInfoAndIngredients_feature_div', '[id^="nutritionalInfoAndIngredientsEU_feature_div"]',
        '.nicDesktop', '[data-a-expander-name="ingredient_text"]', '.a-expander-content',
        '#nic-nutrition-facts-content', '#nic-nutrition-summary-serving',
        '#nic-diet-type-logos-wrapper', '[id^="nic-allergens-"]', '#feature-bullets', '#productTitle',
      ];
      const nodes = doc.querySelectorAll(selectors.join(', '));
      const texts = [...nodes].map(el => (el.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      return texts.length ? JSON.stringify(texts) : '';
    } catch (e) { return ''; }
  }

  // Below this share of the ingredient list matching anything the rulebase knows, the score is not
  // evidence about the product — it is evidence that the rules are in the wrong language.
  // The gate itself lives in the engine (AIR.engine.MIN_COVERAGE), so every pipeline shares one number.
  // A personal-care or supplement index that declined before it read the list has parsed 0 and no score, which is
  // not "an empty list" (that a food reads as clean): it is unreadable, and no panel or badge may show its null.
  const unreadable = result =>
    typeof result.coverage === 'number' && (result.parsed > 0 || !!result.category) && !root.AIR.engine.isReadable(result);

  // `extra` is { outcome, feedback } for rows that are not a plain score: a scan that produced none,
  // or a reader's "Looks wrong?" click. `result` may be null then.
  function sendDiagnostic(data, result, source, text, extra) {
    if (!state.sendDiagnostics || !root.AIR.db || !root.AIR.db.diagnostics) return;
    try {
      const record = root.AIR.db.diagnostics.buildRecord(data, result, {
        version: ENGINE_VERSION,
        store: location.hostname,
        source,
        text: text || data.text,
        outcome: extra && extra.outcome,
        feedback: extra && extra.feedback,
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
    const index = !!result && !!result.category && result.category !== 'food';
    const badgeKey = status || (index ? `${score}:index` : score);
    if (badgeKey === state.lastBadgeScore) return;
    state.lastBadgeScore = badgeKey;
    try {
      chrome.runtime.sendMessage(
        score != null
          ? { type: 'pageScore', score, verdict: result.verdict, ...(index ? { index: true } : {}) }
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
      schema: CACHE.SCHEMA, cacheRevision: CACHE.CACHE_REVISION, v: ENGINE_VERSION, t,
      store: storeHost(), asin, prefs: CACHE.fingerprint(cachePrefs(), source || 'page', result.category),
      score: result.score, verdict: result.verdict, nova: result.nova, category: result.category || 'food', ratingStyle: result.ratingStyle || 'food',
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
      if (share && sharedProductsOn()) chrome.runtime.sendMessage({ type: 'productsQueue', upserts: [row] }, () => void chrome.runtime.lastError);
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

  // A line for "Report a problem"'s recent actions (engine/db/activity.js), via the worker. Repeats
  // are dropped here, since a product page re-scores as Amazon updates it.
  let lastAction = '';
  function logAction(where, what) {
    const line = `${where}|${what}`;
    if (line === lastAction) return;
    lastAction = line;
    try { chrome.runtime.sendMessage({ type: 'logAction', where, what }, () => void chrome.runtime.lastError); } catch (e) { /* context gone */ }
  }

  const page = {
    HOST_ID, BADGE_ATTR, state, ENGINE_VERSION, CACHE,
    cachePrefs, cacheKey, usableCache, recallCache, freshLocal, sharedOk, sharedProductsOn, speed, pace, storeHost, ingredientSig,
    MAX_EXTRACT_RETRIES, isProductPage, isListPage, isRelevantPage,
    unreadable,
    sendDiagnostic, publishActionBadge, cacheScore, cache, rememberProduct, logAction,
  };
  root.AIR.page = page;
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
})(typeof globalThis !== 'undefined' ? globalThis : self);
