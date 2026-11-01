// Content-script entry point: navigation, observer, storage.
//
// Product scoring lives in product.js; search tiles live in search.js. Shared state is AIR.page.
// Amazon swaps page content without a navigation event, so nothing here can rely on
// DOMContentLoaded.

(function () {
  const page = AIR.page;
  const product = AIR.product;
  const search = AIR.search;
  const { state, HOST_ID, isProductPage, isListPage, isRelevantPage, publishActionBadge } = page;
  const { scoreCurrentPage } = product;
  const { searchAllowed, resetSearchGate, standDown, badgeSearchResults, armHoverPass,
    armAutoScorePass, cancelTileWork, clearBadges } = search;

  // The speed setting (AIR.db.speed); 'balanced' when that module is not loaded.
  const paceOf = v => (AIR.db.speed ? AIR.db.speed.sanitizePace({ ratePace: v }).ratePace : 'normal');
  const speedModeOf = v => (AIR.db.speed ? AIR.db.speed.sanitizeSpeed({ speedMode: v }).speedMode : 'balanced');

  chrome.runtime.onMessage?.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'currentPageScore') return false;
    reply(state.enabled && isProductPage() ? state.pageScore : null);
    return false;
  });

  function resetListState() {
    cancelTileWork();
    clearBadges();
  }

  function settleIfDone() {
    const st = document.getElementById(HOST_ID)?.dataset.airState;
    // not-food is stable. scored stays observed for a while so late NIC hydration can replace a wrong first
    // blurb (see the idle window below). fail never settles for good: Amazon often publishes the list after
    // expanders load, and a click or a scroll starts watching again.
    if (st === 'not-food') settle(st);
  }

  // A product page used to be observed for as long as the tab lived: every text change anywhere on it (a
  // carousel, a countdown, a price) restarted a pass that reads the label sections' rendered text, which forces
  // layout. Now the observer stops once nothing about the product's reading has changed for IDLE_SETTLE_MS, and
  // starts again when the reader does something that can reveal more of the page: a click (an expander), a
  // scroll (Amazon builds the sections below the fold as they come into view), or a navigation.
  const IDLE_SETTLE_MS = 60000;
  let idleTimer = null, idleProgress = '', wakeOnActivity = null;

  const productProgress = () => [state.lastKey, state.lastTextSig, document.getElementById(HOST_ID)?.dataset.airState].join('|');

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(settleIdle, IDLE_SETTLE_MS);
  }

  function settleIdle() {
    idleTimer = null;
    if (!state.enabled || !isProductPage()) return;
    settle('idle');
    const ac = new AbortController();
    wakeOnActivity = ac;
    const wakeUp = () => {
      ac.abort();
      if (wakeOnActivity === ac) wakeOnActivity = null;
      if (state.enabled && isProductPage() && state.settled === 'idle') wake();
    };
    const options = { capture: true, passive: true, once: true, signal: ac.signal };
    addEventListener('click', wakeUp, options);
    addEventListener('scroll', wakeUp, options);
  }

  const DEBOUNCE_MS = 400;
  const MAX_WAIT_MS = 1500;
  let timer = null, firstRequest = 0;
  const schedule = () => {
    const now = Date.now();
    if (!firstRequest) firstRequest = now;
    if (now - firstRequest >= MAX_WAIT_MS) { clearTimeout(timer); firstRequest = 0; tick(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { firstRequest = 0; tick(); }, DEBOUNCE_MS);
  };

  let observer = null;
  let observerRoot = null;

  function observeRoot(narrow) {
    if (!narrow) return document.documentElement;
    return document.querySelector(
      '#search, .s-main-slot, [data-component-type="s-search-results"], #dp, #dp-container, #ppd'
    ) || document.documentElement;
  }

  function startObserving(narrow = false) {
    if (!state.enabled) return;
    const root = observeRoot(narrow);
    if (observer && observerRoot === root) return;
    stopObserving();
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['data-asin', 'value'] });
    observerRoot = root;
    state.settled = null;
    idleProgress = '';
    if (isProductPage()) armIdle();
  }

  function stopObserving() {
    clearTimeout(idleTimer);
    idleTimer = null;
    wakeOnActivity?.abort();
    wakeOnActivity = null;
    if (!observer) return;
    observer.disconnect();
    observer = null;
    observerRoot = null;
  }

  function settle(why) {
    if (state.settled === why) return;
    state.settled = why;
    stopObserving();
  }
  page.settle = settle;

  function tick() {
    if (!state.enabled) return;
    try {
      if (isProductPage()) {
        scoreCurrentPage();
        settleIfDone();
        // The idle window runs from the last change to the reading, not the last change anywhere on the page.
        const progress = productProgress();
        if (progress !== idleProgress) { idleProgress = progress; if (observer) armIdle(); }
      }
      else if (isListPage()) {
        removePanel();
        if (state.lastBadgeScore != null) {
          state.lastBadgeScore = undefined;
          publishActionBadge(null);
        }
        if (!searchAllowed()) { standDown(); AIR.sort?.mount({ priceOnly: true }); startObserving(true); return; }
        // Amazon's Sort by menu gets the Ingredient Check options (sort.js), with or without badges.
        if (!state.badges) { standDown(); AIR.sort?.mount(); settle('badges off'); return; }
        badgeSearchResults();
        AIR.sort?.mount();
        // After the first badge pass, watch only the results slot — not the whole document.
        startObserving(true);
      } else {
        teardown();
        if (state.lastBadgeScore != null) {
          state.lastBadgeScore = undefined;
          publishActionBadge(null);
        }
        settle('not a product or results page');
      }
    } catch (e) {
      console.debug('[AIR]', e);
    }
  }

  function wake() {
    if (!state.enabled) return;
    if (!isRelevantPage()) {
      stopObserving();
      teardown();
      settle('not a product or results page');
      return;
    }
    startObserving();
    schedule();
  }

  // The address changed without a page load: AIR.nav (nav.js) tells us, with no timer between navigations.
  let unwatchNav = null;

  function onNavigated() {
    removePanel();
    state.manual = null;
    state.lastBadgeScore = undefined;
    state.lastTextSig = null;
    state.lastFailSig = null;
    publishActionBadge(null);
    resetListState();
    AIR.sort?.unmount();
    state.lastKey = null;
    state.failedExtracts = 0;
    resetSearchGate();
    if (!state.enabled) return;
    if (isRelevantPage()) wake();
    else {
      stopObserving();
      teardown();
      settle('not a product or results page');
    }
  }

  function watchNavigation() {
    if (!unwatchNav) unwatchNav = AIR.nav.onChange(() => onNavigated());
  }

  function stopNavigation() {
    if (!unwatchNav) return;
    unwatchNav();
    unwatchNav = null;
  }

  function suspend() {
    stopObserving();
    stopNavigation();
    clearTimeout(timer);
    cancelTileWork();
    teardown();
    state.lastBadgeScore = undefined;
    publishActionBadge(null);
    state.settled = 'suspended';
  }

  function resume() {
    state.lastKey = null;
    state.failedExtracts = 0;
    state.settled = null;
    resetSearchGate();
    AIR.nav.sync();
    watchNavigation();
    if (isRelevantPage()) {
      AIR.engine?.warmUp?.();   // compile the engine's patterns in idle time, before the first label needs them
      startObserving();
      schedule();
      armHoverPass();
      armAutoScorePass();
    } else {
      teardown();
      settle('not a product or results page');
    }
  }

  function removePanel() {
    state.pageScore = null;
    document.getElementById(HOST_ID)?.remove();
    state.lastKey = null;
    state.requestId++;
  }

  // Also takes the Ingredient Check options out of Amazon's sort menu (sort.js) and stops a sorted
  // list being built: master switch off, navigation, or a page that is not a product or results page.
  function teardown() {
    removePanel();
    clearBadges();
    AIR.sort?.unmount();
  }

  chrome.storage.local.get(['enabled', 'badges', 'hoverScore', 'autoScoreSearch', 'hoverBreakdown',
    'breakdownDetail', 'breakdownDelayMs', 'scoreHoverDelayMs', 'panelOpen', 'foodOnly', 'ratingStyle', 'personalCareEnabled', 'ocrLabels', 'sendDiagnostics', 'weights', 'allergens', 'diets', 'avoidList', 'useOpenFoodFacts', 'sharedCache', 'sharedProducts', 'sheetIndexRev', 'producerIndexRev', 'speedMode', 'ratePace', 'cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays', 'unitPrice', 'theme', 'palette', 'accent'], o => {
    const toggles = AIR.db.prefs.sanitizeToggles(o);
    state.cacheOptions = { ...o, ...toggles };
    state.enabled = toggles.enabled;
    state.badges = toggles.badges;
    state.hoverScore = toggles.hoverScore;
    state.autoScoreSearch = toggles.autoScoreSearch;
    state.hoverBreakdown = toggles.hoverBreakdown;
    state.panelOpen = toggles.panelOpen;
    Object.assign(state, AIR.db.prefs.sanitizeDisplay(o));
    state.foodOnly = toggles.foodOnly;
    state.ocrLabels = toggles.ocrLabels;
    state.sendDiagnostics = toggles.sendDiagnostics;
    state.unitPrice = toggles.unitPrice;
    state.speedMode = speedModeOf(o.speedMode);
    state.ratePace = paceOf(o.ratePace);
    AIR.db.theme?.use(o);      // the reader's score palette and light/dark (engine/db/theme.js)
    readPrefs(o);
    if (state.enabled) resume(); else suspend();
  });

  function readPrefs(o) {
    const clean = AIR.db.prefs.sanitizeScoring(o);
    state.prefs = {
      weights: clean.weights,
      allergens: clean.allergens,
      diets: clean.diets,
      avoidList: clean.avoidList,
      ratingStyle: clean.ratingStyle, personalCareEnabled: clean.personalCareEnabled,
    };
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    for (const key of ['cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays', 'weights', 'avoidList', 'foodOnly', 'ratingStyle', 'personalCareEnabled', 'ocrLabels', 'useOpenFoodFacts', 'sharedCache', 'sharedProducts', 'sheetIndexRev', 'producerIndexRev']) {
      if (changes[key]) state.cacheOptions[key] = Object.hasOwn(AIR.db.prefs.TOGGLE_DEFAULTS, key)
        ? AIR.db.prefs.sanitizeToggles({ [key]: changes[key].newValue })[key] : changes[key].newValue;
    }
    if (changes.weights || changes.allergens || changes.diets || changes.avoidList || changes.ratingStyle || changes.personalCareEnabled) {
      chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList', 'ratingStyle', 'personalCareEnabled'], o => {
        readPrefs(o);
        resetSearchGate();
        resetListState();
        removePanel();
        state.lastKey = null;
        if (state.enabled) { wake(); armAutoScorePass(); }
      });
    }
    // A new speed changes which saved scores are fresh enough and how many pages may be requested:
    // badges already on the page are worked out again under it, as for a weight change.
    if (changes.speedMode || AIR.db.speed?.RECALL_KEYS.some(k => changes[k])) {
      if (changes.speedMode) state.speedMode = speedModeOf(changes.speedMode.newValue);
      resetListState();
      if (state.enabled && state.badges) { wake(); armAutoScorePass(); }
    }
    // A new palette or theme: badges and the panel are painted again under it.
    if (changes.theme || changes.palette) {
      chrome.storage.local.get(['theme', 'palette', 'accent'], o => {
        AIR.db.theme?.use(o);
        resetListState();
        removePanel();
        state.lastKey = null;
        if (state.enabled) { wake(); schedule(); armAutoScorePass(); }
      });
    }
    // Read when the next request starts: nothing already on the page needs redoing.
    if (changes.ratePace) state.ratePace = paceOf(changes.ratePace.newValue);
    if (changes.unitPrice) {
      state.unitPrice = AIR.db.prefs.sanitizeToggles({ unitPrice: changes.unitPrice.newValue }).unitPrice;
      AIR.sort?.refresh();
    }
    if (changes.enabled) {
      state.enabled = changes.enabled.newValue !== false;
      if (state.enabled) resume(); else suspend();
    }
    if (changes.badges) {
      state.badges = changes.badges.newValue !== false;
      if (!state.badges) resetListState();
      else if (state.enabled) wake();
    }
    if (changes.hoverScore) {
      state.hoverScore = changes.hoverScore.newValue === true;
      resetListState();
      if (state.enabled && state.badges) wake();
    }
    if (changes.foodOnly) {
      state.foodOnly = changes.foodOnly.newValue !== false;
      state.lastKey = null;
      resetSearchGate();
      removePanel();
      resetListState();
      if (state.enabled) { schedule(); armAutoScorePass(); }
    }
    if (changes.autoScoreSearch) {
      state.autoScoreSearch = AIR.db.prefs.sanitizeToggles({ autoScoreSearch: changes.autoScoreSearch.newValue }).autoScoreSearch;
      resetListState();
      if (state.enabled && state.badges) wake();
    }
    if (changes.sendDiagnostics) state.sendDiagnostics = changes.sendDiagnostics.newValue === true;
    // Badges are repainted so they gain or lose the button role and the plain tooltip.
    if (changes.hoverBreakdown) {
      state.hoverBreakdown = changes.hoverBreakdown.newValue !== false;
      resetListState();
      if (state.enabled && state.badges) wake();
    }
    if (changes.breakdownDetail || changes.breakdownDelayMs || changes.scoreHoverDelayMs) {
      const shown = { ...state };
      for (const key of ['breakdownDetail', 'breakdownDelayMs', 'scoreHoverDelayMs']) {
        if (changes[key]) shown[key] = changes[key].newValue;
      }
      Object.assign(state, AIR.db.prefs.sanitizeDisplay(shown));
      AIR.hoverCard?.close();
    }
    if (changes.panelOpen) state.panelOpen = changes.panelOpen.newValue === true;
    if (changes.ocrLabels) {
      state.ocrLabels = AIR.db.prefs.sanitizeToggles({ ocrLabels: changes.ocrLabels.newValue }).ocrLabels;
      resetListState();
      if (state.enabled) { removePanel(); wake(); }
    }
    if (changes.useOpenFoodFacts || changes.sharedCache || changes.sharedProducts || changes.sheetIndexRev || changes.producerIndexRev) {
      resetListState();
      removePanel();
      if (state.enabled) wake();
    }
  });

  Object.assign(page, {
    settle, onNavigated, suspend, resume, resetListState, wake, schedule,
    scoreCurrentPage, showFailure: product.showFailure,
    queue: search.queue, scoreTile: search.scoreTile, enqueue: search.enqueue,
    TILE_FAIL_LIMIT: search.TILE_FAIL_LIMIT, pauseForThrottle: search.pauseForThrottle,
    usableCache: page.usableCache, cacheScore: page.cacheScore,
  });
})();
