// Content-script entry point.
//
// Amazon swaps page content without a navigation event, so nothing here can rely on
// DOMContentLoaded. Detection is driven by a MutationObserver plus history-API patching, debounced
// so a busy page doesn't cause repeated rescoring.

(function () {
  const HOST_ID = 'air-score-panel';
  const BADGE_ATTR = 'data-air-badge';
  const state = { enabled: true, badges: true, hoverScore: false, autoScoreSearch: false, foodOnly: true,
    ocrLabels: false, sendDiagnostics: false, settled: null, lastBadgeScore: undefined,
    prefs: { weights: {}, allergens: [], diets: [], avoidList: [] }, lastKey: null, requestId: 0,
    failedExtracts: 0, manual: null };

  const ENGINE_VERSION = (() => {
    try { return chrome.runtime.getManifest().version; } catch (e) { return '0'; }
  })();
  const CACHE = AIR.db.scoreCache;
  state.cacheOptions = {};
  state.pageScore = null;
  const cachePrefs = () => ({ ...state.cacheOptions, weights: state.prefs.weights, foodOnly: state.foodOnly });
  const cacheKey = asin => CACHE ? CACHE.key(location.hostname, asin) : `s:${location.hostname}:${asin}`;
  const usableCache = (hit, asin) => !!CACHE && CACHE.valid(hit, {
    store: location.hostname, asin, version: ENGINE_VERSION, prefs: cachePrefs(),
  });

  // How many times a page that has already failed extraction is re-walked before we stop.
  const MAX_EXTRACT_RETRIES = 8;

  const isProductPage = () => /\/(dp|gp\/product)\/[A-Z0-9]{10}/.test(location.pathname);
  const isListPage = () => /\/(s|b|gp\/browse|stores)\b/.test(location.pathname) || location.search.includes('k=');
  const isRelevantPage = () => isProductPage() || isListPage();

  // ---------------------------------------------------------------- product page
  function mountPoint() {
    return document.querySelector('#nutritionalInfoAndIngredients_feature_div')
      || document.querySelector('#important-information')
      || document.querySelector('#feature-bullets')
      || document.querySelector('#centerCol')
      || document.querySelector('#dp-container');
  }

  // Title-only probe, run before any DOM walk. Returns the verdict when the title alone is enough
  // to say this is not food, and null when it is not sure.
  function quickNonFood() {
    if (!state.foodOnly) return null;
    const gate = AIR.db.ingestible;
    if (!gate || typeof gate.assessTitle !== 'function') return null;
    const el = document.querySelector('#productTitle');
    const title = el && (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    const verdict = gate.assessTitle(title);
    if (verdict.ok || !verdict.negatives.length) return null;
    return { title, verdict };
  }

  function showNotFood(data, key) {
    const anchor = mountPoint();
    if (!anchor) { state.lastKey = key; return; }
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      anchor.parentNode.insertBefore(host, anchor);
    }
    state.lastKey = key;
    host.dataset.airState = 'not-food';
    publishActionBadge(null);
    const shadow = AIR.panel.mount(host, AIR.panel.renderNotFood(data));
    wireScoreAnyway(shadow, host, data, key);
    settle('not-food');
  }

  function scoreCurrentPage() {
    // Cheap identity check BEFORE the expensive DOM walk. extract() costs ~16ms cold on a real
    // Amazon PDP and used to run on every debounce fire, even when the answer was already on
    // screen. The ASIN is in the URL, so nothing needs to be extracted to know it's the same page.
    const urlAsin = (location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1];
    const earlyKey = urlAsin || location.pathname;
    const existing = document.getElementById(HOST_ID);
    const existingState = existing && existing.dataset.airState;
    // A first pass can run before Amazon injects the ingredients card. Skipping every later
    // tick just because a failure card is already mounted left "Organic Rolled Oats." unread.
    // Only a completed score (or an in-flight barcode lookup) is final.
    if (earlyKey === state.lastKey && (existingState === 'scored' || existingState === 'loading')) return;

    // Keep a user-supplied label for this product when weights or warnings change.
    // It is page-local and cleared on navigation, never shared with another product.
    if (state.manual && state.manual.key === earlyKey) {
      const anchor = mountPoint();
      if (!anchor) return;
      let host = existing;
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        anchor.parentNode.insertBefore(host, anchor);
      }
      state.lastKey = earlyKey;
      renderManual(host, state.manual.data, earlyKey, state.manual.text);
      return;
    }

    // Already decided this one is not food. The verdict cannot change without a navigation, so
    // this must return BEFORE extract(). It used to return after, which meant a shampoo page
    // re-walked the whole document on every ad refresh and carousel tick to reach a conclusion it
    // had already reached.
    if (earlyKey === state.lastKey && existingState === 'not-food') { settle('not-food'); return; }

    // Cheapest check that exists: the product title alone. One querySelector and a few regexes
    // against a short string, against extract()'s full-document walk plus a nutrition-table scan.
    // Only clear negative evidence stops here — an ambiguous title still goes the long way, where
    // a Nutrition Facts panel can rescue a store-brand food.
    const quick = quickNonFood();
    if (quick) {
      showNotFood({ asin: urlAsin, title: quick.title, ingestible: quick.verdict }, earlyKey);
      return;
    }

    // A 'fail' card is deliberately not final, because Amazon can inject the ingredients card
    // late. But extract() is a ~16ms DOM walk and the MutationObserver fires on every ad refresh
    // and carousel tick, so an unreadable page re-walked the DOM forever and threw the result
    // away each time. Give the late card a bounded number of chances instead of unbounded ones.
    if (earlyKey !== state.lastKey) state.failedExtracts = 0;
    if (existingState === 'fail' && state.failedExtracts >= MAX_EXTRACT_RETRIES) return;

    const data = AIR.extract.extract(document, { asin: urlAsin, foodOnly: state.foodOnly });
    if (!data.ok) state.failedExtracts++;
    // Not food: say so. A missing card looks like a bug; a score looks like we judged it as food.
    if (state.foodOnly && data.ingestible && !data.ingestible.ok) {
      const key = data.asin || earlyKey;
      if (existingState === 'not-food' && key === state.lastKey) { settle('not-food'); return; }
      showNotFood(data, key);
      return;
    }
    const key = data.asin || earlyKey;
    if (key === state.lastKey && existingState === 'scored') return;

    const anchor = mountPoint();
    if (!anchor) return;

    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      anchor.parentNode.insertBefore(host, anchor);
    }
    state.lastKey = key;

    if (!data.ok) {
      if (host.dataset.airState === 'fail' || host.dataset.airState === 'loading') return;
      cache(key, null);
      if (data.upc) {
        const requestId = ++state.requestId;
        chrome.storage.local.get('useOpenFoodFacts', options => {
          if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
          if (!options.useOpenFoodFacts) {
            showFailure(host, data, key);
            return;
          }
          host.dataset.airState = 'loading';
          AIR.panel.mount(host, AIR.panel.renderLoading(data));
          chrome.runtime.sendMessage({ type: 'lookupBarcode', code: data.upc, foodOnly: state.foodOnly }, fallback => {
            // Reading lastError prevents Chrome from logging a noisy unchecked-error warning when
            // the service worker is restarting or optional permission disappears mid-request.
            const messageError = chrome.runtime.lastError;
            if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
            if (fallback && fallback.rejected === 'not-food') {
              host.dataset.airState = 'not-food';
              const shadow = AIR.panel.mount(host, AIR.panel.renderNotFood({
                ...data,
                ingestible: { ok: false, reason: fallback.reason || 'Open Food Facts lists this as a non-food product' },
              }));
              wireScoreAnyway(shadow, host, data, key);
              return;
            }
            if (messageError || !fallback || !fallback.ingredients_text) {
              showFailure(host, { ...data, lookupAttempted: true }, key);
              return;
            }
            const result = AIR.engine.score({
              name: fallback.name || data.title,
              labels: `${data.labels || ''} ${fallback.labels || ''}`,
              ingredients_text: fallback.ingredients_text,
            }, state.prefs);
            // Open Food Facts is multilingual, so this path meets unreadable text more often than
            // the page path does.
            if (unreadable(result)) { showFailure(host, { ...data, lookupAttempted: true, lowCoverage: true }, key); return; }
            host.dataset.airState = 'scored';
            settle('scored');
            AIR.panel.mount(host, AIR.panel.render(result, {
              title: data.title || fallback.name,
              confidence: 0.55,
              via: 'open-food-facts',
            }));
            cacheScore(key, result, data.title || fallback.name, 'open-food-facts', fallback.ingredients_text);
            publishActionBadge(result);
            sendDiagnostic(data, result, 'open-food-facts', fallback.ingredients_text);
          });
        });
        return;
      }
      showFailure(host, data, key);
      return;
    }

    const requestId = ++state.requestId;
    const result = AIR.engine.score({
      // A brand name such as "Organic Valley" is not evidence that this specific product is
      // certified organic. Only ingredient text and page-level claims feed provenance bonuses.
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: data.text,
    }, state.prefs);
    // The engine only penalises what it recognises, so text it cannot read comes back looking
    // clean: an unknown ingredient scored 93, and the same drink scored 5 in English and 80 in
    // Spanish. A score we cannot stand behind is worse than no score, which is the same rule the
    // extractor already applies to placeholder text. Say so and offer the paste box instead.
    if (unreadable(result)) { showFailure(host, { ...data, lowCoverage: true }, key); return; }
    host.dataset.airState = 'scored';
    settle('scored');
    AIR.panel.mount(host, AIR.panel.render(result, {
      title: data.title, confidence: data.confidence, via: data.via,
    }), reporter(data, result));
    cacheScore(key, result, data.title, data.via, data.text);
    publishActionBadge(result);
    sendDiagnostic(data, result, data.via);

    // Whole foods get a second pass against the shared provenance database. The panel renders
    // immediately from the page alone and upgrades in place if a record exists, rather than making
    // every product wait on a network round trip that most of them do not need.
    if (result.provenance) enrichProvenance(host, data, key, result, requestId);
  }

  function enrichProvenance(host, data, key, first, requestId) {
    try {
      chrome.runtime.sendMessage({
        type: 'provenanceLookup',
        key: { asin: data.asin, upc: data.upc, brand: data.brand },
      }, record => {
        const err = chrome.runtime.lastError;   // service worker may be restarting
        if (requestId !== state.requestId || !host.isConnected || !state.enabled) return;
        if (err || !record) { maybeContribute(data, first); return; }
        const better = AIR.engine.score({
          name: data.title, labels: data.labels, certifications: data.certifications,
          nutrition: data.nutrition, ingredients_text: data.text, provenanceRecord: record,
        }, state.prefs);
        host.dataset.airState = 'scored';
        settle('scored');
        AIR.panel.mount(host, AIR.panel.render(better, {
          title: data.title, confidence: data.confidence, via: data.via,
          provenanceSource: record.source,
        }));
        cacheScore(key, better, data.title, data.via, data.text, record.source || 'shared database');
        publishActionBadge(better);
      });
    } catch (e) { /* messaging unavailable in some frames */ }
  }

  // Offer back what this page disclosed, so the next person does not have to re-derive it. Only
  // certification text and identifiers — never anything about the user or their browsing.
  function maybeContribute(data, result) {
    if (!result.provenance || !result.provenance.verified.length) return;
    try {
      chrome.runtime.sendMessage({ type: 'contribute', payload: {
        asin: data.asin || '', upc: data.upc || '', brand: data.brand || '',
        product_name: data.title || '', kind: result.provenance.kind,
        certifications: result.provenance.verified.map(v => v.label).join(', '),
        verified_by: 'amazon certification widget',
      } }, () => void chrome.runtime.lastError);
    } catch (e) { /* ignore */ }
  }

  // A report carries what the extension actually did, so a wrong score can be diagnosed rather
  // than just complained about: which tier read the ingredients, what fired, what it concluded.
  function reporter(data, result) {
    return done => {
      try {
        chrome.runtime.sendMessage({ type: 'report', payload: {
          asin: data.asin || '', upc: data.upc || '', brand: data.brand || '',
          product_name: data.title || '',
          notes: `scored ${result.score} (${result.verdict}); NOVA ${result.nova}; ` +
                 `read via ${data.via || 'unknown'}; ` +
                 `hits: ${result.bad.slice(0, 6).map(b => b.why).join('; ')}`,
          certifications: '', verified_by: 'user report',
        } }, res => { void chrome.runtime.lastError; done(!!(res && res.ok)); });
      } catch (e) { done(false); }
    };
  }

  // Last resort before giving up: read the label photo. Amazon publishes no ingredient text for a
  // large share of grocery items, and for some it publishes the product NAME in the ingredients
  // field instead (see tests/blurb.test.js). The photo is then the only place the real list exists.
  // Opt-in, because it costs seconds of CPU.
  function tryOcr(host, data, key) {
    if (AIR.extract.ocrReadyForHost && !AIR.extract.ocrReadyForHost(location.hostname)) {
      showFailure(host, { ...data, ocrAttempted: true, localeDeclined: true }, key);
      return;
    }
    const urls = (AIR.db.ocrText && AIR.db.ocrText.imageCandidates(document)) || [];
    if (!urls.length) { showFailure(host, { ...data, ocrAttempted: true }, key); return; }
    const requestId = ++state.requestId;
    host.dataset.airState = 'loading';
    AIR.panel.mount(host, AIR.panel.renderLoading({ ...data, ocr: true }));
    const giveUp = extra => {
      host.dataset.airState = '';
      showFailure(host, { ...data, ocrAttempted: true, ...extra }, key);
    };
    try {
      chrome.runtime.sendMessage({ type: 'ocrLabels', urls }, res => {
        void chrome.runtime.lastError;
        if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
        const best = res && res.ok && AIR.db.ocrText.bestBlock(res.results,
          t => AIR.extract.looksLikeIngredients(t, data.title));
        if (!best) { giveUp({}); return; }
        // Ingredients only. On a real label OCR read the ingredient block cleanly but turned the
        // nutrition table into "SOAIUM rnc 125MQ" and "Total Carb 189"; scoring those numbers
        // would manufacture exactly the impossible values score.js guards against.
        const result = AIR.engine.score({
          name: data.title, labels: data.labels, certifications: data.certifications,
          ingredients_text: best.text,
        }, state.prefs);
        if (unreadable(result)) { giveUp({ lowCoverage: true }); return; }
        host.dataset.airState = 'scored';
        settle('scored');
        AIR.panel.mount(host, AIR.panel.render(result, {
          title: data.title, confidence: 0.7, via: 'label-ocr',
        }), reporter(data, result));
        cacheScore(key, result, data.title, 'label-ocr', best.text);
        publishActionBadge(result);
        sendDiagnostic(data, result, 'label-ocr', best.text);
      });
    } catch (e) { giveUp({}); }
  }

  function showFailure(host, data, key) {
    if (state.lastKey !== key || !host.isConnected) return;
    if (host.dataset.airState === 'fail') return;
    if (state.ocrLabels && !data.ocrAttempted) {
      if (AIR.extract.ocrReadyForHost && !AIR.extract.ocrReadyForHost(location.hostname)) {
        data = { ...data, ocrAttempted: true, localeDeclined: true };
      } else {
        tryOcr(host, data, key);
        return;
      }
    }
    host.dataset.airState = 'fail';
    publishActionBadge(null);
    AIR.panel.mount(host, AIR.panel.renderFailure(data), null, text => {
      state.manual = { key, data, text };
      renderManual(host, data, key, text);
    });
  }

  function renderManual(host, data, key, text) {
    const result = AIR.engine.score({
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: text,
    }, state.prefs);
    host.dataset.airState = 'scored';
    settle('scored');
    AIR.panel.mount(host, AIR.panel.render(result, {
      title: data.title, confidence: 1, via: 'manual-paste',
    }), reporter(data, result));
    cacheScore(key, result, data.title, 'manual-paste', text);
    publishActionBadge(result);
    sendDiagnostic(data, result, 'manual-paste', text);
  }

  // One-page override of the food-only gate. Does not flip the setting — only this product.
  function wireScoreAnyway(shadow, host, data, key) {
    const btn = shadow && shadow.querySelector('button.anyway');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const data2 = AIR.extract.extract(document, { asin: data.asin, foodOnly: false });
      if (!data2.ok) { showFailure(host, data2, key); return; }
      const result = AIR.engine.score({
        name: data2.title, labels: data2.labels, certifications: data2.certifications,
        nutrition: data2.nutrition, ingredients_text: data2.text,
      }, state.prefs);
      host.dataset.airState = 'scored';
      settle('scored');
      AIR.panel.mount(host, AIR.panel.render(result, {
        title: data2.title, confidence: data2.confidence, via: data2.via,
      }), reporter(data2, result));
      cacheScore(key, result, data2.title, 'food-override', data2.text);
      publishActionBadge(result);
    });
  }

  // ---------------------------------------------------------------- search-page gate
  //
  // The per-product gate says whether a thing is food. It never said whether the SEARCH was about
  // food, so a search for running shoes still swept every tile, armed a hover listener on each and
  // ran the IntersectionObserver across the results. Nothing visible happened with default
  // settings, but the extension was running where it had no business running — and with hover or
  // auto-score enabled it would fetch product pages for them.
  //
  // Decided once per URL, because it reads the DOM and tick() fires on every mutation.
  const searchGate = { url: null, decision: null };

  function searchContext() {
    const params = new URLSearchParams(location.search);
    let label = '';
    try {
      const el = document.querySelector('#searchDropdownBox option:checked')
        || document.querySelector('.nav-search-scope .nav-search-label')
        || document.querySelector('#nav-search-dropdown-card .nav-search-label');
      label = ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    } catch (e) { /* :checked is unsupported in a few embedded contexts */ }
    return { query: params.get('k') || '', alias: params.get('i') || '', label };
  }

  function resetSearchGate() { searchGate.url = null; searchGate.decision = null; }

  function searchAllowed() {
    if (!state.foodOnly) return true;                      // the user turned the gate off
    const gate = AIR.db && AIR.db.ingestible;
    if (!gate || typeof gate.assessSearch !== 'function') return true;
    if (searchGate.url === location.href && searchGate.decision !== null) return searchGate.decision;

    const verdict = gate.assessSearch(searchContext());
    let ok = verdict.ok;

    if (ok && verdict.signal === 'none') {
      // Department and query are both silent — a brand-name search like "nike air max" names no
      // category at all. Amazon's own results are the last word.
      const titles = [...document.querySelectorAll('[data-asin]')].slice(0, 24)
        .map(tileTitle).filter(Boolean);
      if (titles.length < gate.RESULT_SAMPLE_MIN) return true;   // results not in yet; decide later
      ok = !gate.looksNonFoodFromResults(titles);
    }

    searchGate.url = location.href;
    searchGate.decision = ok;
    return ok;
  }

  // Leave the page exactly as we found it: no badges, no queued fetches, no observer, and every
  // armed tile unmarked so re-entering a food search re-arms cleanly.
  function standDown() {
    clearBadges();
    cancelTileWork();
  }

  // ---------------------------------------------------------------- search result badges
  // The highest-leverage surface: this is what changes what goes in the cart.
  function badgeSearchResults() {
    const tiles = document.querySelectorAll('[data-asin]:not([' + BADGE_ATTR + '])');
    tiles.forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || asin.length !== 10) return;
      tile.setAttribute(BADGE_ATTR, '1');
      // A score cached while food-only was off must not reappear on shampoo, shoes, etc.
      if (state.foodOnly && AIR.db.ingestible && AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
        return;
      }
      const epoch = queue.epoch;
      chrome.storage.local.get(cacheKey(asin), obj => {
        if (epoch !== queue.epoch || !state.enabled || !state.badges || !tile.isConnected) return;
        const hit = obj[cacheKey(asin)];
        if (!usableCache(hit, asin)) return;
        paintBadge(tile, hit);
      });
    });
    armHoverPass();
    armAutoScorePass();
  }

  // Separate pass, deliberately not gated by BADGE_ATTR. Settings arrive asynchronously, so the
  // first badge pass can run while hoverScore is still false; if arming lived inside that loop,
  // every tile would already be marked processed by the time the setting arrived and hover would
  // never work on a page that doesn't happen to mutate afterwards.
  // Results pages only. A product page carries [data-asin] carousels too, and arming them fetched
  // a product page on hover only to find no tile heading to paint the badge into.
  function armHoverPass() {
    if (!state.enabled || !state.badges || !state.hoverScore) return;
    if (!isListPage() || !searchAllowed()) return;
    document.querySelectorAll('[data-asin]:not([data-air-hover])').forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
      armHover(tile, asin);
    });
  }

  let badgeStyleReady = false;
  function ensureBadgeStyle() {
    if (badgeStyleReady || document.getElementById('air-badge-style')) {
      badgeStyleReady = true;
      return;
    }
    const s = document.createElement('style');
    s.id = 'air-badge-style';
    s.textContent = `.air-badge{display:inline-grid;place-items:center;min-width:26px;height:26px;`
      + `padding:0 6px;margin-right:8px;border-radius:999px;font:700 12px/1 sans-serif;`
      + `vertical-align:middle;box-sizing:border-box}`;
    (document.head || document.documentElement).appendChild(s);
    badgeStyleReady = true;
  }

  function paintBadge(tile, hit) {
    ensureBadgeStyle();
    const titleEl = tile.querySelector('h2, [data-cy="title-recipe"]');
    if (!titleEl) return null;
    let b = tile.querySelector('.air-badge');
    if (!b) {
      b = document.createElement('span');
      b.className = 'air-badge';
      titleEl.insertBefore(b, titleEl.firstChild);
    }
    const sig = hit === 'pending' ? 'p' : hit === 'unreadable' ? '?' : `${hit.score}:${hit.verdict}`;
    if (typeof b.getAttribute === 'function' && b.getAttribute('data-air') === sig) return b;
    if (typeof b.setAttribute === 'function') b.setAttribute('data-air', sig);
    if (hit === 'pending') {
      b.textContent = '…';
      b.title = 'Reading ingredients…';
      b.setAttribute('aria-label', 'Reading ingredients');
      b.setAttribute('role', 'status');
      b.style.cssText = 'color:#565959;background:#f0f2f2;border:2px solid #d5d9d9;';
      return b;
    }
    if (hit === 'unreadable') {
      b.textContent = '?';
      b.title = "Amazon doesn't publish readable ingredients for this one";
      b.setAttribute('aria-label', "Amazon doesn't publish readable ingredients for this one");
      b.style.cssText = 'color:#767676;background:#f7f8f8;border:2px dashed #d5d9d9;';
      return b;
    }
    const c = AIR.panel.BAND_COLOR(hit.score);
    b.textContent = hit.score;
    b.title = `Ingredient Check: ${hit.score}/100 — ${hit.verdict}`;
    b.setAttribute('aria-label', b.title);
    b.style.cssText = `color:${c.fg};background:${c.bg};border:2px solid ${c.ring};`;
    return b;
  }

  // ---------------------------------------------------------------- tile scoring
  // Two ways a search-result tile gets a score, sharing one polite request queue:
  //
  //   hover      — point at a tile for 600ms. Always available when badges are on.
  //   auto-score — score every tile as it scrolls into view. Opt-in, off by default, and it stays
  //                on once you turn it on.
  //
  // Auto-score only fetches tiles that actually enter the viewport, runs at most MAX_CONCURRENT at
  // a time with a gap between requests, and never re-fetches something already cached. A results
  // page holds ~60 tiles; firing 60 simultaneous requests at Amazon is how an extension gets its
  // user rate-limited, so the queue is the feature, not an afterthought.
  const HOVER_DELAY_MS = 600;
  const MAX_CONCURRENT = 3;
  const REQUEST_GAP_MS = 250;
  // Consecutive tile-fetch failures (403/429/network) before we stop. Deleting from `seen`
  // and letting the next observer pass retry is how an extension gets its user rate-limited.
  const TILE_FAIL_LIMIT = 5;

  const queue = { pending: [], active: 0, seen: new Set(), lastStart: 0, epoch: 0, controllers: new Set(),
    failStreak: 0, throttled: false };

  function throttleCopy(key, fallback) {
    try { return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback; }
    catch (e) { return fallback; }
  }

  function showThrottleNotice() {
    if (document.getElementById('air-throttle-notice')) return;
    const el = document.createElement('div');
    el.id = 'air-throttle-notice';
    el.setAttribute('role', 'status');
    el.style.cssText = 'margin:12px 0;padding:12px 14px;border:1px solid #f0a02a;border-radius:8px;'
      + 'background:#fdf3e2;color:#9a6206;font:13px/1.45 "Amazon Ember",sans-serif;';
    const title = document.createElement('b');
    title.style.display = 'block';
    title.textContent = throttleCopy('throttleTitle', 'Amazon throttled scoring');
    const body = document.createElement('span');
    body.textContent = throttleCopy('throttleBody',
      'Too many product-page requests were blocked. Auto-score is paused on this search so we do not keep retrying. Cached badges still show. Open a product, or start a new search, to try again.');
    el.appendChild(title);
    el.appendChild(body);
    const anchor = document.querySelector('#search, .s-main-slot, #dp-container, body');
    if (anchor && anchor.tagName === 'BODY') anchor.insertBefore(el, anchor.firstChild);
    else if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
    else document.documentElement.appendChild(el);
  }

  function clearThrottleNotice() {
    document.getElementById('air-throttle-notice')?.remove();
  }

  function pauseForThrottle() {
    if (queue.throttled) return;
    queue.throttled = true;
    queue.pending.length = 0;
    for (const controller of queue.controllers) controller.abort();
    queue.controllers.clear();
    if (tileObserver) { tileObserver.disconnect(); tileObserver = null; }
    showThrottleNotice();
  }

  function noteTileFailure() {
    queue.failStreak++;
    if (queue.failStreak >= TILE_FAIL_LIMIT) pauseForThrottle();
  }

  function cancelTileWork() {
    queue.epoch++;
    queue.pending.length = 0;
    queue.seen.clear();
    queue.lastStart = 0;
    queue.failStreak = 0;
    queue.throttled = false;
    clearThrottleNotice();
    for (const controller of queue.controllers) controller.abort();
    queue.controllers.clear();
    if (tileObserver) { tileObserver.disconnect(); tileObserver = null; }
    document.querySelectorAll('[data-air-auto]').forEach(t => t.removeAttribute('data-air-auto'));
  }

  function tileTitle(tile) {
    const el = tile.querySelector('h2 a, h2, [data-cy="title-recipe"]');
    return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  }

  function enqueue(tile, asin, { front = false } = {}) {
    if (queue.throttled) return;
    if (!state.enabled || !state.badges || !searchAllowed()) return;
    if (front ? !state.hoverScore : !state.autoScoreSearch) return;
    if (queue.seen.has(asin)) return;
    // Skip the Amazon fetch when the tile title is already a cosmetic, shoe, detergent, etc.
    // Ambiguous titles still fetch — store-brand oats should not die on a weak title.
    if (state.foodOnly && AIR.db.ingestible && AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
      queue.seen.add(asin);
      return;
    }
    queue.seen.add(asin);
    const job = { tile, asin, epoch: queue.epoch, url: location.href };
    if (front) queue.pending.unshift(job); else queue.pending.push(job);
    pump();
  }

  function pump() {
    if (queue.throttled) return;
    while (queue.active < MAX_CONCURRENT && queue.pending.length) {
      const job = queue.pending.shift();
      if (!job.tile.isConnected) continue;
      queue.active++;
      const wait = Math.max(0, queue.lastStart + REQUEST_GAP_MS - Date.now());
      queue.lastStart = Date.now() + wait;
      setTimeout(() => scoreTile(job.tile, job.asin, job.epoch, job.url).finally(() => { queue.active--; pump(); }), wait);
    }
  }

  function armHover(tile, asin) {
    if (tile.hasAttribute('data-air-hover')) return;
    tile.setAttribute('data-air-hover', '1');
    let timer = null;
    const start = () => {
      if (!state.enabled || !state.badges || !state.hoverScore) return;
      // A listener attached on a previous search stays attached after Amazon swaps the results in.
      if (!searchAllowed()) return;
      if (tile.querySelector('.air-badge')) return;
      clearTimeout(timer);
      timer = setTimeout(() => enqueue(tile, asin, { front: true }), HOVER_DELAY_MS);
    };
    const cancel = () => clearTimeout(timer);
    tile.addEventListener('mouseenter', start);
    tile.addEventListener('mouseleave', cancel);
    // Keyboard users never fire mouseenter. The tile itself is rarely tabbable, but the
    // product link inside it is, and focusin/focusout bubble.
    tile.addEventListener('focusin', start);
    tile.addEventListener('focusout', cancel);
  }

  // Visibility-gated auto-scoring. Tiles below the fold cost nothing until you scroll to them.
  let tileObserver = null;
  function autoObserver() {
    if (tileObserver) return tileObserver;
    tileObserver = new IntersectionObserver(entries => {
      if (!state.enabled || !state.badges || !state.autoScoreSearch) return;
      if (!searchAllowed()) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const tile = entry.target;
        tileObserver.unobserve(tile);
        const asin = tile.getAttribute('data-asin');
        if (!asin || tile.querySelector('.air-badge')) continue;
        // Cached scores paint instantly and cost no request.
        const epoch = queue.epoch;
        chrome.storage.local.get(cacheKey(asin), obj => {
          if (epoch !== queue.epoch || !state.enabled || !state.badges || !state.autoScoreSearch || !tile.isConnected) return;
          const hit = obj[cacheKey(asin)];
          if (usableCache(hit, asin)) { paintBadge(tile, hit); queue.seen.add(asin); return; }
          if (state.autoScoreSearch && !queue.throttled) enqueue(tile, asin);
        });
      }
    }, { rootMargin: '150px' });
    return tileObserver;
  }

  function armAutoScorePass() {
    if (queue.throttled) return;
    if (!state.enabled || !state.badges || !state.autoScoreSearch) return;
    if (!isListPage() || !searchAllowed()) return;
    const obs = autoObserver();
    document.querySelectorAll('[data-asin]:not([data-air-auto])').forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
      tile.setAttribute('data-air-auto', '1');
      obs.observe(tile);
    });
  }

  async function scoreTile(tile, asin, epoch, url) {
    const current = () => epoch === queue.epoch && url === location.href && state.enabled
      && state.badges && tile.isConnected && searchAllowed();
    if (!current()) return;
    const controller = new AbortController();
    queue.controllers.add(controller);
    paintBadge(tile, 'pending');
    try {
      const res = await fetch(`/dp/${asin}`, { credentials: 'same-origin', signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      if (!current()) return;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // The ASIN must be passed explicitly: this document is not the page we are standing on.
      const data = AIR.extract.extract(doc, { asin, foodOnly: state.foodOnly });
      if (!current()) return;
      // A non-food tile gets no badge at all — not even "?" — because there is nothing to say.
      if (state.foodOnly && data.ingestible && !data.ingestible.ok) {
        const b = tile.querySelector('.air-badge');
        if (b) b.remove();
        return;
      }
      if (!data.ok) { paintBadge(tile, 'unreadable'); return; }
      const result = AIR.engine.score({
        name: data.title, labels: data.labels, certifications: data.certifications,
        nutrition: data.nutrition, ingredients_text: data.text,
      }, state.prefs);
      // Same rule as the product page: a badge is a claim, and we do not make one we cannot read.
      if (unreadable(result)) { paintBadge(tile, 'unreadable'); return; }
      paintBadge(tile, result);
      cacheScore(asin, result, data.title, data.via || 'search-tile', data.text);
      sendDiagnostic(data, result, 'search-tile');
      queue.failStreak = 0;
    } catch (e) {
      if (!current()) return;
      const aborted = e && (e.name === 'AbortError' || controller.signal.aborted);
      if (aborted) return;
      const b = tile.querySelector('.air-badge');
      if (b && b.textContent === '…') b.remove();
      // Keep the ASIN in `seen` so a failed fetch is not retried on the next observer pass.
      noteTileFailure();
    } finally {
      queue.controllers.delete(controller);
    }
  }

  // Below this share of the ingredient list matching anything the rulebase knows, the score is not
  // evidence about the product — it is evidence that the rules are in the wrong language. Measured
  // against the corpus: the lowest legitimate product sits at 50% and unreadable text at 0%, so
  // the threshold sits in the empty space between them.
  const MIN_COVERAGE = 0.34;
  const unreadable = result =>
    typeof result.coverage === 'number' && result.parsed > 0 && result.coverage < MIN_COVERAGE;

  // One diagnostic row per score, so accuracy can be measured against the evidence rather than
  // guessed at. Fire-and-forget: a diagnostics failure must never affect what the user sees.
  function sendDiagnostic(data, result, source, text) {
    if (!state.sendDiagnostics || !AIR.db.diagnostics) return;
    try {
      const record = AIR.db.diagnostics.buildRecord(data, result, {
        version: ENGINE_VERSION,
        store: location.hostname,
        source,
        text: text || data.text,
        weights: state.prefs.weights,
        defaultWeights: AIR.db.categories && AIR.db.categories.DEFAULT_WEIGHTS,
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
      // The ingredient text is deliberately not stored: nothing read it, and at up to 12 KB per
      // entry a few thousand cached tiles would have run into the 10 MB storage quota.
      source: source || 'page',
      provenanceSource: provenanceSource || '',
      name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    };
    if (isProductPage()) state.pageScore = entry;
    // A paste or explicit non-food override belongs to this tab, never to search results.
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

  chrome.runtime.onMessage?.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'currentPageScore') return false;
    reply(state.enabled && isProductPage() ? state.pageScore : null);
    return false;
  });

  function resetListState() {
    cancelTileWork();
    clearBadges();
  }

  // ---------------------------------------------------------------- lifecycle
  function tick() {
    // There was a `busy` guard here. tick() is fully synchronous, so it could never be observed
    // true and never guarded anything.
    if (!state.enabled) return;
    try {
      if (isProductPage()) { scoreCurrentPage(); settleIfDone(); }
      else if (isListPage()) {
        removePanel();
        if (state.lastBadgeScore != null) {
          state.lastBadgeScore = undefined;
          publishActionBadge(null);
        }
        if (!searchAllowed()) { standDown(); settle('non-food search'); return; }
        // No badges means nothing to do on a results page — stop watching until the setting returns.
        if (!state.badges) { standDown(); settle('badges off'); return; }
        badgeSearchResults();
        // List pages keep watching: infinite scroll keeps adding tiles.
      } else {
        teardown();
        if (state.lastBadgeScore != null) {
          state.lastBadgeScore = undefined;
          publishActionBadge(null);
        }
        settle('not a product or results page');
      }
    } catch (e) {
      // An extension must never take the host page down with it.
      console.debug('[AIR]', e);
    }
  }

  // Each mount that reaches a final score settles directly, because the asynchronous paths — the
  // barcode lookup, the OCR pass, a pasted list — can finish on a page that has gone quiet, where
  // no further mutation would arrive to trigger the check below.
  //
  // A product page whose answer cannot change without a navigation stops being watched. Amazon
  // mutates the DOM continuously — ad refresh, lazy images, carousels — and re-running for a
  // conclusion already reached was the largest cost this extension imposed on a page. 'loading' is
  // excluded: a barcode lookup or an OCR pass is still in flight and will mount its own result.
  function settleIfDone() {
    const st = document.getElementById(HOST_ID)?.dataset.airState;
    if (st === 'scored' || st === 'not-food') settle(st);
    else if (st === 'fail' && state.failedExtracts >= MAX_EXTRACT_RETRIES) settle('unreadable');
  }

  // A pure trailing debounce starves under sustained churn: measured on the real extension, any
  // mutation cadence faster than ~400ms meant tick() never ran and no panel ever appeared. Amazon
  // PDPs have ad refresh, lazy image swaps and carousels, so that is a live page, not a stress
  // test. MAX_WAIT guarantees a run even if mutations never stop.
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

  // ---------------------------------------------------------------- lifecycle
  //
  // The observer is the expensive thing here: subtree:true on documentElement fires on every ad
  // refresh Amazon does. It runs only while the page still has a question outstanding, and stops
  // once the answer is settled. The URL poll is what wakes it again.

  let observer = null;
  let urlTimer = null;
  let navWired = false;
  let lastUrl = location.href;

  function startObserving() {
    if (observer || !state.enabled) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    state.settled = null;
  }

  function stopObserving() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function settle(why) {
    if (state.settled === why) return;
    state.settled = why;
    stopObserving();
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

  // Content scripts run in an isolated world, so reassigning history.pushState here is invisible to
  // Amazon's own scripts — verified: the page world still sees the native function. The patch was
  // inert. popstate does cross worlds, and a cheap URL poll covers pushState/replaceState without
  // injecting anything into the page.
  const URL_POLL_MS = 500;

  function onNavigated() {
    lastUrl = location.href;
    removePanel();
    state.manual = null;
    state.lastBadgeScore = undefined;
    publishActionBadge(null);
    resetListState();
    state.lastKey = null;      // a new URL is a new product; don't reuse the last render
    state.failedExtracts = 0;
    resetSearchGate();         // ...and a new search, which may be about something else entirely
    if (!state.enabled) return;
    if (isRelevantPage()) wake();
    else {
      stopObserving();
      teardown();
      settle('not a product or results page');
    }
  }

  function watchNavigation() {
    if (!navWired) { addEventListener('popstate', onNavigated); navWired = true; }
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

  // The master switch. Off means off: no observer, no polling, no queued work, nothing left in the
  // page. It touches no stored setting, so everything configured below it is exactly as it was
  // when switched back on.
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
    // Poll only while enabled so a pushState off a product page still tears down. The observer
    // itself stays off until this is actually a product or results URL.
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

  function clearBadges() {
    document.querySelectorAll('.air-badge').forEach(b => b.remove());
    document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(tile => tile.removeAttribute(BADGE_ATTR));
  }

  function teardown() {
    removePanel();
    clearBadges();
  }

  chrome.storage.local.get(['enabled', 'badges', 'hoverScore', 'autoScoreSearch', 'foodOnly', 'ocrLabels', 'sendDiagnostics', 'weights', 'allergens', 'diets', 'avoidList', 'useOpenFoodFacts', 'sheetUrl', 'producersUrl', 'sheetIndexRev', 'producerIndexRev'], o => {
    state.cacheOptions = { ...o };
    const toggles = (AIR.db.prefs && AIR.db.prefs.sanitizeToggles(o)) || {
      enabled: o.enabled !== false,
      badges: o.badges !== false,
      hoverScore: o.hoverScore === true,
      autoScoreSearch: o.autoScoreSearch === true,
      foodOnly: o.foodOnly !== false,
      ocrLabels: o.ocrLabels === true,
      sendDiagnostics: o.sendDiagnostics === true,
    };
    state.enabled = toggles.enabled;
    state.badges = toggles.badges;
    state.hoverScore = toggles.hoverScore;
    state.autoScoreSearch = toggles.autoScoreSearch;
    state.foodOnly = toggles.foodOnly;
    state.ocrLabels = toggles.ocrLabels;
    state.sendDiagnostics = toggles.sendDiagnostics;
    readPrefs(o);
    if (state.enabled) resume(); else suspend();
  });

  function readPrefs(o) {
    const clean = (AIR.db.prefs && AIR.db.prefs.sanitizeScoring(o)) || {
      weights: o.weights || {},
      allergens: Array.isArray(o.allergens) ? o.allergens : [],
      diets: Array.isArray(o.diets) ? o.diets : [],
      avoidList: Array.isArray(o.avoidList) ? o.avoidList : [],
    };
    state.prefs = {
      weights: clean.weights,
      allergens: clean.allergens,
      diets: clean.diets,
      avoidList: clean.avoidList,
    };
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    for (const key of ['weights', 'foodOnly', 'ocrLabels', 'useOpenFoodFacts', 'sheetUrl', 'producersUrl', 'sheetIndexRev', 'producerIndexRev']) {
      if (changes[key]) state.cacheOptions[key] = changes[key].newValue;
    }
    // Changing a weight changes every score on screen, so the panel and badges are rebuilt and the
    // cache fingerprint changes — a number computed under the old weights is wrong now.
    if (changes.weights || changes.allergens || changes.diets || changes.avoidList) {
      chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList'], o => {
        readPrefs(o);
        const rescore = () => {
          resetListState();
          removePanel();
          state.lastKey = null;
          if (state.enabled) { wake(); armAutoScorePass(); }
        };
        // Fingerprints reject old weights even if another tab writes a late cache record.
        rescore();
      });
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
      state.autoScoreSearch = changes.autoScoreSearch.newValue === true;
      resetListState();
      if (state.enabled && state.badges) wake();
    }
    if (changes.sendDiagnostics) state.sendDiagnostics = changes.sendDiagnostics.newValue === true;
    if (changes.ocrLabels) {
      state.ocrLabels = changes.ocrLabels.newValue === true;
      resetListState();
      if (state.enabled) { removePanel(); wake(); }
    }
    if (changes.useOpenFoodFacts || changes.sheetUrl || changes.producersUrl || changes.sheetIndexRev || changes.producerIndexRev) {
      resetListState();
      removePanel();
      if (state.enabled) wake();
    }
  });

  // Nothing starts until the stored settings say so; the boot read above calls resume() or
  // suspend(). Starting a URL poll here ran even on a paused extension until that read returned.
})();
