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
    // not-food is stable. scored stays observed so late NIC hydration can replace a wrong first
    // blurb. fail never settles permanently — Amazon often publishes the list after expanders load.
    if (st === 'not-food') settle(st);
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
  let urlTimer = null;
  let navWired = false;
  let lastUrl = location.href;

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
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    observerRoot = root;
    state.settled = null;
  }

  function stopObserving() {
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
      if (isProductPage()) { scoreCurrentPage(); settleIfDone(); }
      else if (isListPage()) {
        removePanel();
        if (state.lastBadgeScore != null) {
          state.lastBadgeScore = undefined;
          publishActionBadge(null);
        }
        if (!searchAllowed()) { standDown(); AIR.sort?.unmount(); settle('non-food search'); return; }
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

  const URL_POLL_MS = 500;

  function onNavigated() {
    lastUrl = location.href;
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
    if (!navWired) {
      addEventListener('popstate', onNavigated);
      // Prefer the Navigation API when present; keep the poll as a fallback for Amazon soft nav.
      try {
        if (typeof navigation !== 'undefined' && navigation
            && typeof navigation.addEventListener === 'function') {
          navigation.addEventListener('navigate', () => {
            queueMicrotask(() => {
              if (location.href !== lastUrl) onNavigated();
            });
          });
        }
      } catch (e) { /* Navigation API unavailable */ }
      navWired = true;
    }
    if (urlTimer) return;
    urlTimer = setInterval(() => {
      if (location.href !== lastUrl) onNavigated();
    }, URL_POLL_MS);
  }

  function stopNavigation() {
    if (!urlTimer) return;
    clearInterval(urlTimer);
    urlTimer = null;
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
    lastUrl = location.href;
    watchNavigation();
    if (isRelevantPage()) {
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
    'breakdownDetail', 'breakdownDelayMs', 'foodOnly', 'ocrLabels', 'sendDiagnostics', 'weights', 'allergens', 'diets', 'avoidList', 'useOpenFoodFacts', 'sharedCache', 'sharedProducts', 'sheetIndexRev', 'producerIndexRev', 'speedMode', 'unitPrice'], o => {
    const toggles = AIR.db.prefs.sanitizeToggles(o);
    state.cacheOptions = { ...o, ...toggles };
    state.enabled = toggles.enabled;
    state.badges = toggles.badges;
    state.hoverScore = toggles.hoverScore;
    state.autoScoreSearch = toggles.autoScoreSearch;
    state.hoverBreakdown = toggles.hoverBreakdown;
    Object.assign(state, AIR.db.prefs.sanitizeDisplay(o));
    state.foodOnly = toggles.foodOnly;
    state.ocrLabels = toggles.ocrLabels;
    state.sendDiagnostics = toggles.sendDiagnostics;
    state.unitPrice = toggles.unitPrice;
    state.speedMode = speedModeOf(o.speedMode);
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
    };
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    for (const key of ['weights', 'foodOnly', 'ocrLabels', 'useOpenFoodFacts', 'sharedCache', 'sharedProducts', 'sheetIndexRev', 'producerIndexRev']) {
      if (changes[key]) state.cacheOptions[key] = Object.hasOwn(AIR.db.prefs.TOGGLE_DEFAULTS, key)
        ? AIR.db.prefs.sanitizeToggles({ [key]: changes[key].newValue })[key] : changes[key].newValue;
    }
    if (changes.weights || changes.allergens || changes.diets || changes.avoidList) {
      chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList'], o => {
        readPrefs(o);
        resetListState();
        removePanel();
        state.lastKey = null;
        if (state.enabled) { wake(); armAutoScorePass(); }
      });
    }
    // A new speed changes which saved scores are fresh enough and how many pages may be requested:
    // badges already on the page are worked out again under it, as for a weight change.
    if (changes.speedMode) {
      state.speedMode = speedModeOf(changes.speedMode.newValue);
      resetListState();
      if (state.enabled && state.badges) { wake(); armAutoScorePass(); }
    }
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
    if (changes.breakdownDetail || changes.breakdownDelayMs) {
      Object.assign(state, AIR.db.prefs.sanitizeDisplay({
        breakdownDetail: changes.breakdownDetail ? changes.breakdownDetail.newValue : state.breakdownDetail,
        breakdownDelayMs: changes.breakdownDelayMs ? changes.breakdownDelayMs.newValue : state.breakdownDelayMs,
      }));
      AIR.hoverCard?.close();
    }
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
