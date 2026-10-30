// Content script for stores other than Amazon. One runner, one adapter per store
// (src/stores/<store>.js): the adapter knows the store's pages, this knows what to do with them.
// Amazon keeps its own pipeline (page/product/search/main.js) and does not load this file.
//
// Scores are computed locally. Search can request public same-origin product pages when
// autoScoreSearch is enabled. No internal store APIs, shared database or label-photo services.
// Missing/blocked declarations remain unavailable rather than receiving an invented score.

(function (root) {
  const adapter = Object.values(root.AIR.storeAdapters || {}).find(a => a.matchesHost(location.hostname));
  if (!adapter) return;

  const HOST_ID = 'air-score-panel';
  const BADGE_CLASS = 'air-badge';
  const WAIT_FOR_LABEL_MS = 15000;      // how long a product page may take to render its label
  const P = root.AIR.panel;
  const CACHE = root.AIR.db.scoreCache;
  const PREFS = root.AIR.db.prefs;
  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return '0'; } })();
  const STORE = CACHE.normalizeStore(location.hostname);

  const state = { requests: new Map(), controllers: new Set(), queue: [], active: 0, fetchCount: 0, searchAllowed: true, throttled: false, enabled: true, badges: true, foodOnly: true, prefs: {}, raw: {}, url: '', pageScore: null,
    manual: null, override: false, started: 0, done: false, observer: null, timer: null };

  const t = (key, fallback, sub) => {
    try { return (chrome.i18n && chrome.i18n.getMessage(key, sub != null ? [String(sub)] : [])) || fallback; }
    catch (e) { return fallback; }
  };
  const send = msg => { try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch (e) { /* reloaded */ } };

  function readSettings(o) {
    const toggles = PREFS.sanitizeToggles(o);
    state.enabled = toggles.enabled;
    state.badges = toggles.badges;
    state.foodOnly = toggles.foodOnly;
    state.autoScoreSearch = toggles.autoScoreSearch;
    state.panelOpen = toggles.panelOpen;
    if (root.AIR.db.theme) root.AIR.db.theme.use(o);   // the reader's score palette and light/dark
    const scoring = PREFS.sanitizeScoring(o);
    state.prefs = { weights: scoring.weights, allergens: scoring.allergens, diets: scoring.diets, avoidList: scoring.avoidList, ratingStyle: scoring.ratingStyle, personalCareEnabled: scoring.personalCareEnabled };
    // The same fingerprint inputs the popup validates with, so its "This page" card accepts these.
    state.raw = { ...root.AIR.db.speed?.sanitizeRecall(o), weights: o.weights, foodOnly: toggles.foodOnly, ratingStyle: scoring.ratingStyle, personalCareEnabled: scoring.personalCareEnabled, avoidList: scoring.avoidList,
      sheetIndexRev: o.sheetIndexRev, producerIndexRev: o.producerIndexRev };
    // How old a saved score may be: the speed setting's age (1 to 90 days), as on Amazon.
    state.fetchLimit = root.AIR.db.speed ? root.AIR.db.speed.profile(o.speedMode).autoFetches : 60;
    state.maxAgeMs = root.AIR.db.speed ? root.AIR.db.speed.profile(o.speedMode).maxAgeMs : CACHE.TTL_MS;
  }

  // ------------------------------------------------------------------ product page
  function hostEl(anchor) {
    let host = document.getElementById(HOST_ID);
    if (!host && anchor && anchor.parentNode) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.margin = '8px 0 12px';
      anchor.parentNode.insertBefore(host, anchor);
    }
    return host;
  }

  function badge(result) {
    state.pageScore = result;
    send(result && typeof result.score === 'number'
      ? { type: 'pageScore', score: result.score, verdict: result.verdict, ...(result.category && result.category !== 'food' ? { index: true } : {}) }
      : { type: 'pageScore', status: result && result.status });
  }

  function cacheEntry(id, result, name, source, input) {
    return {
      schema: CACHE.SCHEMA, cacheRevision: CACHE.CACHE_REVISION, v: VERSION, t: Date.now(), store: STORE, asin: id,
      prefs: CACHE.fingerprint(state.raw, source, result.category), score: result.score, verdict: result.verdict,
      nova: result.nova, category: result.category || 'food', ratingStyle: result.ratingStyle || 'food', ...(input ? { input } : {}), source, provenanceSource: '', name: String(name || '').slice(0, 120),
      ...(root.AIR.db.shopping ? { evidence: root.AIR.db.shopping.evidence(result, { source, capturedAt: Date.now(), prefs: state.prefs }) } : {}),
    };
  }

  function show(host, html, state_, wire) {
    host.dataset.airState = state_;
    const shadow = P.mount(host, html, null, wire && wire.paste);
    // "Open the score panel on product pages" applies here too, for a score (not a failure card).
    if (state_ === 'scored' && state.panelOpen && typeof P.openCard === 'function') P.openCard(host);
    if (wire && wire.after) wire.after(shadow);
  }

  function scoreText(host, data, text, via) {
    const input = { name: data.title, category: data.supplementFacts ? 'supplement' : undefined, supplement_facts: data.supplementFacts, ingredients_text: text, advisory_text: data.advisoryText, nutrition: data.nutrition };
    const result = root.AIR.engine.score(input, via === 'food-override' ? { ...state.prefs, personalCareEnabled: true } : state.prefs);
    if (result.category && !root.AIR.engine.isReadable(result)) {
      show(host, P.renderPersonalCare({ ...root.AIR.db.ingestible.personalCareReview(data.title, text, state.prefs, data.advisoryText, data.supplementFacts), category: result.category, reason: result.reason, flags: result.flags }), 'personal-care');
      badge({ status: 'fail' }); return;
    }
    if (!root.AIR.engine.isReadable(result)) {
      show(host, P.renderFailure({ lowCoverage: true, storeName: adapter.name }), 'fail', { paste: onPaste(host, data) });
      badge({ status: 'fail' });
      return;
    }
    show(host, P.render(result, { title: data.title, confidence: via === 'manual-paste' ? 1 : 0.95, via, report: false }), 'scored');
    root.AIR.db.shopping?.offerSave(P.shadowOf(host), { id: `product:${STORE}:${data.id}`, name: data.title, input, source: via, url: location.href, savedScore: result.score, capturedAt: Date.now() });
    const entry = cacheEntry(data.id, result, data.title, via === 'manual-paste' ? 'manual-paste' : (via === 'food-override' ? 'food-override' : 'page'), input);
    badge({ ...entry });
    // Pasted and overridden scores stay on this tab, as on Amazon.
    if (entry.source === 'page') chrome.storage.local.set({ [CACHE.key(STORE, data.id)]: entry });
  }

  function onPaste(host, data) {
    return text => {
      state.manual = { id: data.id, text };
      scoreText(host, data, text, 'manual-paste');
    };
  }

  function productPass() {
    const data = adapter.readProduct(document, location);
    if (data && !data.supplementFacts) data.supplementFacts = root.AIR.retailerLabels?.supplementFacts?.(document) || '';
    if (!data.id) return true;
    const signature = JSON.stringify([data.id, data.title, data.crumbs, data.ingredients, data.labelText, data.advisoryText, data.department, data.nutrition, data.label]);
    // Grocery page hydration may discard an injected sibling without changing the label.
    // Opt in per adapter so the separately maintained store pipelines keep their behavior.
    if (state.done && state.signature === signature && (!adapter.remountPanel || document.getElementById(HOST_ID))) return 'watch';
    if (state.done && state.signature !== signature) {
      // A changed declaration invalidates its prior saved score as well as this tab.
      if (typeof chrome.storage.local.remove === 'function') chrome.storage.local.remove(CACHE.key(STORE, data.id), () => void chrome.runtime.lastError);
      badge(null);
      document.getElementById(HOST_ID)?.remove();
      state.done = false;
    }
    state.signature = signature;
    const anchor = adapter.productAnchor?.(document) || document.querySelector('h1[data-test="product-title"]') || document.querySelector('h1');
    if (!anchor || !anchor.parentNode) return false; // not rendered yet
    // Created on first use, so a page still rendering its label gets no empty card.
    const host = () => hostEl(anchor);

    if (state.manual && state.manual.id === data.id) { scoreText(host(), data, state.manual.text, 'manual-paste'); return true; }

    if (state.foodOnly && !state.override) {
      const verdict = root.AIR.db.ingestible.assess({ querySelector: () => null },
        { title: data.title, text: [data.department || root.AIR.retailerLabels?.department(data.crumbs), data.crumbs.join(' › '), data.title, data.labelText].join(' \n ') });
      if (!verdict.ok && verdict.negatives.length && !root.AIR.db.ingestible?.allowsProduct?.(data.title, state.prefs)) {
        show(host(), P.renderNotFood({ title: data.title, ingestible: verdict }), 'not-food', {
          after: shadow => shadow.querySelector('button.anyway')?.addEventListener('click', () => {
            state.override = true; state.done = false; productPass();
          }),
        });
        badge({ status: 'not-food' });
        return true;
      }
    }

    if (data.ingredients) { scoreText(host(), data, data.ingredients, state.override ? 'food-override' : 'page'); return true; }

    if (data.label === 'collapsed') {
      if (host().dataset.airState === 'waiting') return 'watch';
      show(host(), P.renderNotice({
        title: adapter.labelName ? `Open “${adapter.labelName}” to score this product.` : t('labelClosedTitle', 'Open “Label info” to score this product.'),
        body: t('labelClosedBody', 'This store only shows the ingredient list once that section is open. Ingredient Check reads it from this page on your computer; nothing is sent anywhere.'),
        action: adapter.labelName ? `Open ${adapter.labelName}` : t('labelClosedAction', 'Open Label info'),
      }), 'waiting', {
        after: shadow => shadow.querySelector('button.notice-action')?.addEventListener('click', () => {
          const toggle = adapter.labelToggle(document);
          if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
          watch();                                  // the list renders a moment after it opens
        }),
      });
      return 'watch';                               // no timer: only the visitor opening it helps
    }

    // Not there yet, or never published (fresh produce has no label at all). Give the page time.
    if (Date.now() - state.started < WAIT_FOR_LABEL_MS) return false;
    show(host(), P.renderFailure({ storeName: adapter.name }), 'fail', { paste: onPaste(host(), data) });
    badge({ status: 'fail' });
    return true;
  }

  // ------------------------------------------------------------------ search page
  function currentTile(tile, current) {
    return tile.anchor && tile.anchor.isConnected && current.get(tile.anchor) === tile.id;
  }

  function paintBadge(tile, hit, status = '', saved = false) {
    const anchor = tile.anchor;
    let b = anchor.querySelector('.' + BADGE_CLASS);
    // Image-only links cannot contain a badge: it would change the image box/grid tracks.
    // Adapters choose the title heading/text container, never the outer product grid.
    if (!b) {
      b = document.createElement('span');
      b.className = BADGE_CLASS;
      anchor.appendChild(b);
      if (tile.badgePlacement === 'corner') {
        if (typeof getComputedStyle === 'function' && getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
      }
      b.style.cssText = 'display:inline-flex!important;position:static!important;float:none!important;'
        + 'vertical-align:middle!important;margin:4px 0 4px 6px!important;max-width:100%!important;';
      if (tile.badgePlacement === 'corner') b.style.cssText = 'display:inline-flex!important;position:absolute!important;'
        + 'top:6px!important;left:6px!important;z-index:2!important;max-width:calc(100% - 12px)!important;pointer-events:auto!important;';
      if (b.attachShadow) {
        const shadow = b.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>:host{line-height:normal}span{display:inline-flex;align-items:center;'
          + 'justify-content:center;box-sizing:border-box;min-width:26px;min-height:26px;padding:3px 7px;'
          + 'border-radius:999px;font:700 12px/1.3 sans-serif;color:var(--air-fg,#374151);'
          + 'background:var(--air-bg,#f3f4f6);border:2px solid var(--air-ring,#9ca3af);white-space:normal}</style>'
          + '<span><slot></slot></span>';
      }
    }
    const care = !!hit && !!hit.category && hit.category !== 'food';
    const text = hit ? String(hit.score) + (care ? ` · ${root.AIR.db.productRatings.categoryLabel(hit.category, t)}` : '') + (saved ? ' · saved' : '') : status === 'checking' ? 'Checking label…'
      : status === 'unavailable' ? 'Label unavailable' : status === 'not-food' ? 'Not a food'
      : status === 'limited' ? 'Open to rate' : 'Open to rate';
    let title = hit ? `Ingredient Check: ${hit.score}/100 — ${hit.verdict}${care ? ` · ${root.AIR.db.productRatings.caption(hit, t)}` : ''}`
      : status === 'unavailable' ? 'Ingredient Check: no readable ingredient label was returned. Open the product to expand its label or paste ingredients.'
      : status === 'checking' ? 'Ingredient Check: reading the public product label.'
      : status === 'not-food' ? 'Ingredient Check: this product appears to be outside food scoring.'
      : 'Ingredient Check: open this product to rate it, or enable Rate every search result in Settings.';
    if (hit?.evidence && root.AIR.db.shopping) title += ' · ' + root.AIR.db.shopping.describe(hit.evidence, t);
    if (b.textContent === text && b.title === title && b.dataset.airProduct === tile.id) return;
    b.textContent = text;
    b.title = title;
    b.dataset.airProduct = tile.id;
    b.dataset.airStatus = hit ? 'scored' : status;
    b.setAttribute('aria-label', title);
    b.setAttribute('role', 'img');
    if (hit?.input) b.setAttribute('tabindex', '0');
    const c = hit ? (care ? root.AIR.db.theme.neutral() : P.BAND_COLOR(hit.score)) : { fg: '#374151', bg: '#f3f4f6', ring: '#9ca3af' };
    if (b.style.setProperty) {
      b.style.setProperty('--air-fg', c.fg);
      b.style.setProperty('--air-bg', c.bg);
      b.style.setProperty('--air-ring', c.ring);
    }
  }

  // Read through the shared page reader (stores/cart.js, loaded after this file and used only at call time).
  const publicDocument = (response, signal) => root.AIR.cart.publicDocument(response, signal);

  function drain() {
    while (state.active < 2 && state.queue.length && state.enabled && state.badges && state.autoScoreSearch && state.searchAllowed && !state.throttled && location.href === state.url && adapter.isSearchPage(location)) {
      const job = state.queue.shift();
      const generation = state.generation;
      if (job.generation !== generation) continue;
      state.active++;
      const controller = new AbortController();
      state.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      (async () => {
        const url = new URL(adapter.productUrl(job.id, location), location.href);
        if (url.origin !== location.origin || adapter.productId(url.href) !== job.id) throw new Error('unavailable');
        const response = await fetch(url.href, { credentials: 'omit', signal: controller.signal });
        if (generation !== state.generation || location.href !== state.url || controller.signal.aborted) return;
        if ([403, 429, 503].includes(response.status)) state.throttled = true;
        const final = new URL(response.url || url.href);
        if (final.origin !== url.origin || adapter.productId(final.href) !== job.id) throw new Error('unavailable');
        const doc = await publicDocument(response, controller.signal);
        if (generation !== state.generation || location.href !== state.url || controller.signal.aborted) return;
        const data = adapter.readProduct(doc, final);
        data.supplementFacts = data.supplementFacts || root.AIR.retailerLabels?.supplementFacts?.(doc) || '';
        if (data.id !== job.id || !data.ingredients) throw new Error('unavailable');
        const context = { title: data.title, text: [data.department || root.AIR.retailerLabels?.department(data.crumbs || []),
          (data.crumbs || []).join(' › '), data.title, data.labelText].join(' \n ') };
        const food = root.AIR.db.ingestible.assess({ querySelector: () => null }, context);
        if (state.foodOnly && !food.ok && food.negatives.length && !root.AIR.db.ingestible?.allowsProduct?.(data.title, state.prefs)) {
          state.requests.set(job.id, { status: 'not-food' }); return;
        }
        const result = root.AIR.engine.score({ name: data.title, ingredients_text: data.ingredients,
          advisory_text: data.advisoryText, category: data.supplementFacts ? 'supplement' : undefined, supplement_facts: data.supplementFacts, nutrition: data.nutrition }, state.prefs);
        if (!root.AIR.engine.isReadable(result)) throw new Error('unavailable');
        const entry = cacheEntry(job.id, result, data.title, 'page', { name: data.title, ingredients_text: data.ingredients, advisory_text: data.advisoryText, category: data.supplementFacts ? 'supplement' : undefined, supplement_facts: data.supplementFacts, nutrition: data.nutrition });
        state.requests.set(job.id, { hit: entry });
        try { await chrome.storage.local.set({ [CACHE.key(STORE, job.id)]: entry }); }
        catch (e) { /* The score can still be displayed on this tab if persistence fails. */ }
      })().catch(error => {
        if (generation === state.generation && error.message === 'blocked') state.throttled = true;
        if (generation === state.generation) state.requests.set(job.id, { status: 'unavailable' });
      }).finally(() => {
        clearTimeout(timer);
        state.controllers.delete(controller);
        if (generation !== state.generation) return;
        state.active--;
        if (state.throttled) {
          for (const pending of state.queue) state.requests.set(pending.id, { status: 'unavailable' });
          state.queue = [];
        }
        if (state.enabled && adapter.isSearchPage(location)) searchPass();
        drain();
      });
    }
  }

  function searchPass() {
    const tiles = adapter.searchTiles(document);
    if (state.foodOnly) {
      const gate = root.AIR.db.ingestible;
      const verdict = gate.assessSearch({ query: adapter.searchQuery(location), alias: '', label: '' });
      const titles = tiles.map(x => x.title);
      if ((!verdict.ok || (titles.length >= gate.RESULT_SAMPLE_MIN && gate.looksNonFoodFromResults(titles))) && !gate.allowsSearch?.({ query: adapter.searchQuery(location) }, titles, state.prefs)) {
        state.searchAllowed = false; state.queue = [];
        for (const controller of state.controllers) controller.abort();
        clearBadges();
        return true;
      }
    }
    state.searchAllowed = true;
    if (!state.badges || !tiles.length) return false;
    const generation = state.generation;
    const keys = tiles.map(x => CACHE.key(STORE, x.id));
    CACHE.readLocal(keys, state.raw, got => {
      if (generation !== state.generation || !state.enabled || !state.badges || location.href !== state.url) return;
      const current = new Map(adapter.searchTiles(document).map(tile => [tile.anchor, tile.id]));
      for (const x of tiles) {
        if (!currentTile(x, current)) continue;
        const hit = got && got[CACHE.key(STORE, x.id)];
        const saved = CACHE.recall(hit, { store: STORE, asin: x.id, version: VERSION, prefs: state.raw, maxAgeMs: state.maxAgeMs });
        if (saved && !saved.refresh) { paintBadge(x, hit, '', saved.stale); continue; }
        let job = state.requests.get(x.id);
        if (!job && state.autoScoreSearch && adapter.productUrl && !state.throttled && state.fetchCount < state.fetchLimit) {
          job = { status: 'checking' };
          state.requests.set(x.id, job);
          state.fetchCount++;
          state.queue.push({ id: x.id, generation });
        }
        paintBadge(x, job?.hit || saved?.hit || null, job?.status || (state.throttled ? 'unavailable' : 'limited'), saved?.stale && !job?.hit);
      }
      drain();
    }, chrome.storage);
    return false;
  }

  function clearBadges() { document.querySelectorAll('.' + BADGE_CLASS).forEach(b => b.remove()); }

  // ------------------------------------------------------------------ lifecycle
  function stopWatching() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    clearTimeout(state.timer);
  }

  function pass() {
    if (!state.enabled) return;
    const product = adapter.isProductPage(location);
    const done = product ? productPass() : adapter.isSearchPage(location) ? searchPass() : true;
    // true: finished, stop watching. 'watch': wait for the page to change. false: not rendered yet,
    // so a timer makes sure the give-up point is reached even if the page goes quiet.
    // Search pages keep watching for more tiles.
    clearTimeout(state.timer);
    if (product && done === true) { state.done = true; watch(); }
    else if (product && done === false) {
      state.timer = setTimeout(pass, Math.max(500, WAIT_FOR_LABEL_MS - (Date.now() - state.started) + 50));
    }
  }

  function watch() {
    if (state.observer || !state.enabled) return;
    root.AIR.engine?.warmUp?.();   // compile the engine's patterns in idle time, before the first label needs them
    let pending = null;
    state.observer = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; pass(); }, 400);
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden', 'aria-expanded', 'data-test', 'data-testid'] });
  }

  function reset() {
    state.generation = (state.generation || 0) + 1;
    for (const controller of state.controllers) controller.abort();
    state.controllers.clear(); state.requests.clear(); state.queue = []; state.active = 0;
    state.fetchCount = 0; state.searchAllowed = true; state.throttled = false;
    send({ type: 'pageScore', status: null });
    stopWatching();
    document.getElementById(HOST_ID)?.remove();
    clearBadges();
    state.signature = null;
    state.pageScore = null; state.override = false; state.done = false; state.started = Date.now();
    state.url = location.href;
    if (!state.enabled) return;
    if (!adapter.isProductPage(location) && !adapter.isSearchPage(location)) return;
    pass();
    if (!state.done) watch();
  }

  // Target is a single-page app: moving from results to a product does not reload the page.
  setInterval(() => { if (location.href !== state.url) { state.manual = null; reset(); } }, 1000);

  const KEYS = ['enabled', 'badges', 'foodOnly', 'ratingStyle', 'personalCareEnabled', 'weights', 'allergens', 'diets', 'avoidList',
    'sheetIndexRev', 'producerIndexRev', 'speedMode', 'cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays', 'autoScoreSearch', 'panelOpen', 'theme', 'palette'];
  chrome.storage.local.get(KEYS, o => { readSettings(o || {}); reset(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    if (!KEYS.some(k => changes[k])) {
      if (Object.keys(changes).some(k => k.startsWith(`s:${STORE}:`)) && adapter.isSearchPage(location)) pass();
      return;
    }
    chrome.storage.local.get(KEYS, o => { readSettings(o || {}); reset(); });
  });

  let detailHost, detailTurn = 0, detailTimer;
  function closeDetails() { detailTurn++; clearTimeout(detailTimer); detailHost?.remove(); detailHost = null; }
  async function showDetails(badge) {
    const turn = ++detailTurn, id = badge.dataset.airProduct;
    if (!id || !state.enabled) return;
    const display = await chrome.storage.local.get(['hoverBreakdown', 'breakdownDetail']);
    if (display.hoverBreakdown === false) return;
    const got = await CACHE.readLocal([CACHE.key(STORE, id)], state.raw, null, chrome.storage);
    const hit = got[CACHE.key(STORE, id)];
    if (turn !== detailTurn || !badge.isConnected || !hit?.input || !CACHE.recall(hit, {store:STORE, asin:id, version:VERSION, prefs:state.raw, maxAgeMs:state.maxAgeMs})) return;
    const result = root.AIR.engine.score(hit.input, state.prefs);
    if (!root.AIR.engine.isReadable(result)) return;
    detailHost?.remove(); detailHost = document.createElement('div');
    detailHost.id = 'air-retailer-details'; detailHost.style.cssText = 'position:fixed;z-index:2147483000;max-height:70vh;overflow:auto';
    const shadow = P.mount(detailHost, P.renderBreakdown(result, {asin:id, score:hit.score, verdict:hit.verdict, category:hit.category, ratingStyle:hit.ratingStyle, detail:display.breakdownDetail}));
    for (const link of shadow.querySelectorAll('a')) { link.href = adapter.productUrl(id, location); link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    document.body.append(detailHost);
    const rect = badge.getBoundingClientRect(); detailHost.style.left = `${Math.max(8,Math.min(rect.left,innerWidth-356))}px`; detailHost.style.top = `${Math.max(8,Math.min(rect.bottom+6,innerHeight-detailHost.offsetHeight-8))}px`;
    detailHost.addEventListener('mouseenter',()=>clearTimeout(detailTimer));
    detailHost.addEventListener('mouseleave',()=>{detailTimer=setTimeout(closeDetails,250);});
  }
  const detailBadge = node => node?.closest?.('.air-badge, .air-cart-badge');
  document.addEventListener?.('mouseover', e => { const badge=detailBadge(e.target); if (badge) {clearTimeout(detailTimer); void showDetails(badge);} });
  document.addEventListener?.('mouseout', e => { if (detailBadge(e.target)) detailTimer=setTimeout(closeDetails,250); });
  document.addEventListener?.('focusin', e => { const badge=detailBadge(e.target); if (badge) void showDetails(badge); });
  document.addEventListener?.('keydown', e => { if (e.key === 'Escape') closeDetails(); });
  if (typeof addEventListener === 'function') addEventListener('scroll',closeDetails,true);

  // The popup's "This page" card.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'currentPageScore') return false;
    reply(state.pageScore && typeof state.pageScore.score === 'number' ? state.pageScore : null);
    return false;
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = { state, pass, reset, adapter };
})(typeof globalThis !== 'undefined' ? globalThis : self);
