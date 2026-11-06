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
  const REQUEST_GAP_MS = 400;
  const P = root.AIR.panel;
  const CACHE = root.AIR.db.scoreCache;
  const PREFS = root.AIR.db.prefs;
  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return '0'; } })();
  const STORE = CACHE.normalizeStore(location.hostname);
  const isListingPage = loc => adapter.isSearchPage(loc) || adapter.isBrowsePage?.(loc);
  const carouselPage = () => typeof adapter.isBrowsePage === 'function' && adapter.isProductPage(location);
  const ratesTiles = () => isListingPage(location) || (carouselPage() && state.pageScore?.status !== 'not-food');

  const state = { requests: new Map(), controllers: new Set(), queue: [], active: 0, fetchCount: 0, searchAllowed: true, throttled: false, enabled: true, badges: true, foodOnly: true, prefs: {}, raw: {}, url: '', pageScore: null,
    manual: null, override: false, started: 0, done: false, observer: null, timer: null, drainTimer: null, nextRequest: 0 };
  let detailHost, detailTurn = 0, detailTimer;

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
    // Walmart results always show ratings while the extension is enabled. Keep the
    // global switches intact for other stores and honor the extension's pause switch.
    if (adapter.alwaysRateSearch) {
      state.badges = true;
      state.autoScoreSearch = true;
    }
    state.panelOpen = toggles.panelOpen;
    state.hoverBreakdown = toggles.hoverBreakdown;
    const { breakdownDelayMs, breakdownDetail } = PREFS.sanitizeDisplay(o);
    Object.assign(state, { breakdownDelayMs, breakdownDetail });
    if (root.AIR.db.theme) root.AIR.db.theme.use(o);   // the reader's score palette and light/dark
    const scoring = PREFS.sanitizeScoring(o);
    state.prefs = { weights: scoring.weights, allergens: scoring.allergens, diets: scoring.diets, avoidList: scoring.avoidList, ratingStyle: scoring.ratingStyle, personalCareEnabled: scoring.personalCareEnabled };
    // The same fingerprint inputs the popup validates with, so its "This page" card accepts these.
    state.raw = { ...root.AIR.db.speed?.sanitizeRecall(o), weights: o.weights, foodOnly: toggles.foodOnly, ratingStyle: scoring.ratingStyle, personalCareEnabled: scoring.personalCareEnabled, avoidList: scoring.avoidList,
      sheetIndexRev: o.sheetIndexRev, producerIndexRev: o.producerIndexRev };
    // How old a saved score may be: the speed setting's age (1 to 90 days), as on Amazon.
    state.fetchLimit = root.AIR.db.speed ? root.AIR.db.speed.profile(o.speedMode).autoFetches : 60;
    if (adapter.alwaysRateSearch) state.fetchLimit = Number.MAX_SAFE_INTEGER;
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
    if (result?.status === 'not-food' && state.pageScore?.status !== 'not-food' && carouselPage()) {
      cancelTileRequests();
      clearBadges();
    }
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

  // A saved score that no longer matches the current weights or rules still holds the label text it came from
  // (CACHE.recallReading), and scoring text again takes about a millisecond where the product page takes a request.
  // Returns { hit, result } with the score worked out under the current settings, or null when the saved reading
  // cannot be used. The entry keeps the reading's own age (`t`), so a re-scored entry never looks fresher than the label.
  function refit(hit, id) {
    if (!hit || typeof hit !== 'object' || !CACHE.recallReading) return null;
    if (!CACHE.recallReading(hit, { store: STORE, asin: id, version: VERSION, prefs: state.raw, maxAgeMs: state.maxAgeMs })) return null;
    let result;
    try { result = root.AIR.engine.score(hit.input, state.prefs); } catch (e) { return null; }
    if (!root.AIR.engine.isReadable(result)) return null;
    const entry = { ...cacheEntry(id, result, hit.name, hit.source, hit.input), t: hit.t };
    if (root.AIR.db.shopping) entry.evidence = root.AIR.db.shopping.evidence(result, { source: hit.source, capturedAt: hit.t, prefs: state.prefs });
    return { hit: entry, result };
  }
  // One write for every entry a pass re-scored, so the next page of results finds them as ordinary saved scores.
  function saveRefits(entries) {
    if (!entries || !Object.keys(entries).length) return;
    try { chrome.storage.local.set(entries, () => void chrome.runtime.lastError); } catch (e) { /* the scores still show */ }
  }

  // A product opened before has its reading saved on this computer. When the page shows no label yet (the store is
  // still rendering it, or keeps it behind a section the visitor has to open), that reading answers at once and the
  // live label replaces it the moment the page has one; if the page never does, the saved score stays. A label the
  // page shows is never replaced by a saved one: productPass scores it first. Returns 'shown' (nothing more to wait
  // for), 'reading' (the saved reading is being looked up) or null (there is none, so the page is waited on as before).
  function savedPanel(data, host) {
    let mine = state.saved;
    if (!mine || mine.id !== data.id) {
      mine = state.saved = { id: data.id, status: 'reading', result: null, hit: null };
      const key = CACHE.key(STORE, data.id);
      const context = { store: STORE, asin: data.id, version: VERSION, prefs: state.raw, maxAgeMs: state.maxAgeMs };
      let sync = true;
      CACHE.readLocal([key], state.raw, got => {
        if (state.saved !== mine) return;                  // another product, or the page was reset meanwhile
        const hit = got && got[key];
        let result = null;
        try {
          if (CACHE.recall(hit, context)) { if (hit.input) { result = root.AIR.engine.score(hit.input, state.prefs); mine.hit = hit; } }
          else {
            const again = refit(hit, data.id);              // weights or rules moved since it was saved
            if (again) { result = again.result; mine.hit = again.hit; saveRefits({ [key]: again.hit }); }
          }
        } catch (e) { result = null; }
        if (result && root.AIR.engine.isReadable(result)) { mine.result = result; mine.status = 'shown'; } else mine.status = 'none';
        if (!sync) pass();                                 // draw it, or carry on waiting for the page
      }, chrome.storage);
      sync = false;
    }
    if (mine.status === 'shown') {
      const h = host();
      if (h.dataset.airSaved !== data.id) {                // also after hydration discarded the panel
        show(h, P.render(mine.result, { title: data.title, confidence: 0.95, via: mine.hit.source, capturedAt: mine.hit.t, report: false }), 'scored');
        h.dataset.airSaved = data.id;
        badge({ ...mine.hit, score: mine.result.score, verdict: mine.result.verdict, category: mine.result.category || 'food' });
      }
      return 'shown';
    }
    return mine.status === 'reading' ? 'reading' : null;
  }

  function show(host, html, state_, wire) {
    delete host.dataset.airSaved;
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

    // No label on the page (yet): a product opened before answers from its saved reading.
    const saved = savedPanel(data, host);
    if (saved === 'shown') return 'watch';
    if (saved === 'reading') return false;

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
      anchor.insertBefore(b, anchor.firstChild);
      if (tile.badgePlacement === 'corner') {
        if (typeof getComputedStyle === 'function' && getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
      }
      b.style.cssText = 'display:inline-flex!important;position:static!important;float:none!important;'
        + 'vertical-align:middle!important;margin:4px 6px 4px 0!important;max-width:100%!important;';
      if (tile.badgePlacement === 'title') {
        b.style.setProperty('position', 'relative', 'important');
        b.style.setProperty('z-index', '2', 'important');
      }
      if (tile.badgePlacement === 'corner') b.style.cssText = 'display:inline-flex!important;position:absolute!important;'
        + 'top:6px!important;left:6px!important;z-index:2!important;max-width:calc(100% - 12px)!important;pointer-events:auto!important;';
      if (b.attachShadow) {
        const shadow = b.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>:host{line-height:normal}span{display:inline-flex;align-items:center;'
          + 'justify-content:center;box-sizing:border-box;min-width:26px;min-height:26px;padding:3px 7px;'
          + 'border-radius:999px;font:700 12px/1.3 sans-serif;color:var(--air-fg,#374151);'
          + 'background:var(--air-bg,#f3f4f6);border:2px solid var(--air-ring,#9ca3af);white-space:normal}'
          + '@media (prefers-color-scheme: dark){span{color:var(--air-dfg,#b8c0c0);background:#1b1c1c;border-color:var(--air-dring,#6a7373)}}</style>'
          + '<span><slot></slot></span>';
        root.AIR.db.theme?.force(shadow);
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
    const href = tile.url ? root.AIR.retailerLabels.listingProductUrl(adapter, tile.id, location, tile.url) : '';
    if (b.textContent === text && b.title === title && b.dataset.airProduct === tile.id && (b.dataset.airHref || '') === href) return;
    if (href) b.dataset.airHref = href;
    else delete b.dataset.airHref;
    b.textContent = text;
    b.title = title;
    b.dataset.airProduct = tile.id;
    b.dataset.airStatus = hit ? 'scored' : status;
    b.setAttribute('aria-label', title);
    b.setAttribute('role', href && !anchor.closest('a[href]') ? 'link' : 'img');
    if (href || hit?.input) b.setAttribute('tabindex', '0');
    else b.removeAttribute('tabindex');
    const c = hit ? (care ? root.AIR.db.theme.neutral() : P.BAND_COLOR(hit.score)) : { fg: '#374151', bg: '#f3f4f6', ring: '#9ca3af' };
    if (b.style.setProperty) {
      b.style.setProperty('--air-fg', c.fg);
      b.style.setProperty('--air-bg', c.bg);
      b.style.setProperty('--air-ring', c.ring);
      b.style.setProperty('--air-dfg', c.dfg || '#b8c0c0');
      b.style.setProperty('--air-dring', c.dring || '#6a7373');
    }
  }

  // Read through the shared page reader (stores/cart.js, loaded after this file and used only at call time).
  const publicDocument = (response, signal) => root.AIR.cart.publicDocument(response, signal);

  // One product's public page, read, scored and saved: the single way a retailer product is rated from a results
  // page, whoever asks (the badges' queue below, or the sorted list in retailer-sort.js). `alive()` is asked after
  // each wait: false means the page moved on, and nothing is saved or returned. Returns { hit } for a score,
  // { status: 'not-food' } for a product outside food scoring, or undefined when it is no longer wanted;
  // throws Error('unavailable') for a page that gave no readable label, Error('blocked') for a challenge page.
  async function readProductScore(id, signal, alive = () => true, listingUrl) {
    const href = root.AIR.retailerLabels.listingProductUrl(adapter, id, location, listingUrl);
    if (!href) throw new Error('unavailable');
    const url = new URL(href);
    const response = await fetch(url.href, {
      credentials: adapter.publicCredentials === 'same-origin' ? 'same-origin' : 'omit',
      headers: { Accept: 'text/html' }, signal,
    });
    if (!alive() || signal.aborted) return undefined;
    if ([403, 429, 503].includes(response.status)) state.throttled = true;
    const final = new URL(response.url || url.href);
    // Walmart redirects to a challenge URL before serving the verification page.
    if (final.origin === url.origin && /^\/blocked\/?$/.test(final.pathname)) {
      state.throttled = true;
      throw new Error('blocked');
    }
    if ((final.origin !== url.origin && !adapter.acceptsProductRedirect?.(url, final, id))
      || adapter.productId(final.href) !== id) throw new Error('unavailable');
    const doc = await publicDocument(response, signal);
    if (!alive() || signal.aborted) return undefined;
    const data = adapter.readProduct(doc, final);
    data.supplementFacts = data.supplementFacts || root.AIR.retailerLabels?.supplementFacts?.(doc) || '';
    if (data.id !== id || !data.ingredients) throw new Error('unavailable');
    const context = { title: data.title, text: [data.department || root.AIR.retailerLabels?.department(data.crumbs || []),
      (data.crumbs || []).join(' › '), data.title, data.labelText].join(' \n ') };
    const food = root.AIR.db.ingestible.assess({ querySelector: () => null }, context);
    if (state.foodOnly && !food.ok && food.negatives.length && !root.AIR.db.ingestible?.allowsProduct?.(data.title, state.prefs)) return { status: 'not-food' };
    const input = { name: data.title, ingredients_text: data.ingredients, advisory_text: data.advisoryText,
      category: data.supplementFacts ? 'supplement' : undefined, supplement_facts: data.supplementFacts, nutrition: data.nutrition };
    const result = root.AIR.engine.score(input, state.prefs);
    if (!root.AIR.engine.isReadable(result)) throw new Error('unavailable');
    const entry = cacheEntry(id, result, data.title, 'page', input);
    try { await chrome.storage.local.set({ [CACHE.key(STORE, id)]: entry }); }
    catch (e) { /* The score can still be displayed on this tab if persistence fails. */ }
    return { hit: entry };
  }

  function drain() {
    while (state.active < 2 && state.queue.length && state.enabled && state.badges && state.autoScoreSearch && state.searchAllowed && !state.throttled && location.href === state.url && ratesTiles()) {
      const delay = state.nextRequest - Date.now();
      if (delay > 0) {
        if (!state.drainTimer) state.drainTimer = setTimeout(() => { state.drainTimer = null; drain(); }, delay);
        return;
      }
      const job = state.queue.shift();
      const generation = state.generation;
      if (job.generation !== generation) continue;
      state.nextRequest = Date.now() + REQUEST_GAP_MS;
      state.active++;
      const controller = new AbortController();
      state.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      (async () => {
        const out = await readProductScore(job.id, controller.signal,
          () => generation === state.generation && location.href === state.url, job.url);
        if (out) state.requests.set(job.id, out.hit ? { hit: out.hit } : { status: out.status });
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
        if (state.enabled && ratesTiles()) searchPass();
        drain();
      });
    }
  }

  function cancelTileRequests() {
    state.generation = (state.generation || 0) + 1;
    clearTimeout(state.drainTimer);
    state.drainTimer = null; state.nextRequest = 0;
    for (const controller of state.controllers) controller.abort();
    state.controllers.clear(); state.requests.clear(); state.queue = []; state.active = 0;
  }

  function searchPass() {
    const search = adapter.isSearchPage(location);
    const browse = !!adapter.isBrowsePage?.(location);
    if (search || browse) adapter.hideSponsored?.(document);
    const productId = adapter.productId(location.href);
    const gate = root.AIR.db.ingestible;
    const tiles = adapter.searchTiles(document).filter(tile => tile.id !== productId);
    if (state.foodOnly && search) {
      const context = { query: adapter.searchQuery(location), alias: '', label: '' };
      const verdict = gate.assessSearch(context);
      const titles = tiles.map(x => x.title);
      if ((!verdict.ok || (titles.length >= gate.RESULT_SAMPLE_MIN && gate.looksNonFoodFromResults(titles)))
        && !gate.allowsSearch?.(context, titles, state.prefs)) {
        if (state.searchAllowed) cancelTileRequests();
        state.searchAllowed = false;
        clearBadges();
        // Not a food search: no badges and no ingredient lookups, but the listings still have a price per unit, so the
        // sort button stays and offers that (a price-only list).
        if (!isListingPage(location)) root.AIR.retailerSort?.reset(false);
        else if (tiles.length) root.AIR.retailerSort?.update(tiles.map(tile => ({ tile })), { priceOnly: true });
        root.AIR.retailerSpace?.reset();
        return true;
      }
    }
    if (!state.searchAllowed && isListingPage(location)) root.AIR.retailerSort?.reset(true);
    state.searchAllowed = true;
    if (!state.badges || !tiles.length) return false;
    const generation = state.generation;
    const keys = tiles.map(x => CACHE.key(STORE, x.id));
    CACHE.readLocal(keys, state.raw, got => {
      if (generation !== state.generation || !state.enabled || !state.badges || location.href !== state.url) return;
      const current = new Map(adapter.searchTiles(document).map(tile => [tile.anchor, tile.id]));
      const ranked = [], refits = {};
      for (const x of tiles) {
        if (!currentTile(x, current)) continue;
        if ((browse || carouselPage()) && state.foodOnly && gate.looksNonFoodFromTitle(x.title) && !gate.allowsProduct?.(x.title, state.prefs)) continue;
        const context = { store: STORE, asin: x.id, version: VERSION, prefs: state.raw, maxAgeMs: state.maxAgeMs };
        let hit = got && got[CACHE.key(STORE, x.id)];
        let saved = CACHE.recall(hit, context);
        // Settings or rules moved since it was saved: score the saved label text again rather than reading the page.
        if (!saved) {
          const again = refit(hit, x.id);
          if (again) { hit = again.hit; refits[CACHE.key(STORE, x.id)] = hit; saved = CACHE.recall(hit, context); }
        }
        if (saved && !saved.refresh) { paintBadge(x, hit, '', saved.stale); ranked.push({ tile: x, hit }); continue; }
        let job = state.requests.get(x.id);
        if (!job && state.autoScoreSearch && adapter.productUrl && !state.throttled && state.fetchCount < state.fetchLimit) {
          job = { status: 'checking' };
          state.requests.set(x.id, job);
          state.fetchCount++;
          state.queue.push({ id: x.id, url: x.url, generation });
        }
        paintBadge(x, job?.hit || saved?.hit || null, job?.status || (state.throttled ? 'unavailable' : 'limited'), saved?.stale && !job?.hit);
        ranked.push({ tile: x, hit: job?.hit || saved?.hit || null });
      }
      saveRefits(refits);
      if (isListingPage(location) && ranked.length) root.AIR.retailerSort?.update(ranked);
      if (search) root.AIR.retailerSpace?.update(ranked);
      drain();
    }, chrome.storage);
    return false;
  }

  function clearBadges() { document.querySelectorAll('.' + BADGE_CLASS).forEach(b => b.remove()); }

  // ------------------------------------------------------------------ lifecycle
  // An ad that arrives with a late result must not paint, so hiding does not wait for the debounce in watch():
  // the first change after a quiet moment is handled on the next frame, however many mutations arrive. During
  // sustained change (a page lazy-loading as it scrolls, or our own badges arriving) the next run waits eight
  // times as long as the last one took, never less than a frame, so this cannot take more than about an eighth of
  // the page's time. A page of a few dozen cards costs a few milliseconds, so it runs about every other frame.
  const fast = { raf: 0, timer: 0, next: 0 };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function fastHide() {
    if (fast.raf || fast.timer || !adapter.hideSponsored || typeof requestAnimationFrame !== 'function' || !isListingPage(location)) return;
    const run = () => {
      fast.raf = 0;
      if (!state.enabled || !isListingPage(location)) return;
      const started = now();
      adapter.hideSponsored(document);
      fast.next = now() + Math.max(16, (now() - started) * 8);
    };
    const wait = fast.next - now();
    if (wait > 0) fast.timer = setTimeout(() => { fast.timer = 0; fast.raf = requestAnimationFrame(run); }, wait);
    else fast.raf = requestAnimationFrame(run);
  }
  function stopWatching() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (fast.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(fast.raf);
    clearTimeout(fast.timer); fast.raf = fast.timer = 0;
    clearTimeout(state.timer);
  }

  function pass() {
    if (!state.enabled) return;
    const product = adapter.isProductPage(location);
    const done = product && productPass();
    if (ratesTiles()) searchPass();
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
      fastHide();
      if (pending) return;
      pending = setTimeout(() => { pending = null; pass(); }, 400);
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-label', 'data-test', 'data-testid', 'data-automation-id', 'data-item-id', 'data-dca-card-id', 'data-sponsored'] });
  }

  function reset() {
    closeDetails();
    cancelTileRequests();
    state.fetchCount = 0; state.searchAllowed = true; state.throttled = false;
    send({ type: 'pageScore', status: null });
    stopWatching();
    document.getElementById(HOST_ID)?.remove();
    clearBadges();
    adapter.restoreSponsored?.(document);
    state.signature = null;
    state.pageScore = null; state.override = false; state.done = false; state.saved = null; state.started = Date.now();
    state.url = location.href;
    root.AIR.retailerSort?.reset(state.enabled && isListingPage(location));
    root.AIR.retailerSpace?.reset();
    if (!state.enabled) return;
    if (!adapter.isProductPage(location) && !isListingPage(location)) return;
    pass();
    if (!state.done) watch();
  }

  // Target and Walmart are single-page apps: moving from the home page to results, or from results to a
  // product, changes the address without loading a page. The script is injected on the public routes a
  // search starts from (manifest.json), and this notices each move within half a second.
  setInterval(() => { if (location.href !== state.url) { state.manual = null; reset(); } }, 500);

  const KEYS = ['enabled', 'badges', 'foodOnly', 'ratingStyle', 'personalCareEnabled', 'weights', 'allergens', 'diets', 'avoidList',
    'sheetIndexRev', 'producerIndexRev', 'speedMode', 'cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays', 'autoScoreSearch', 'panelOpen', 'theme', 'palette',
    'hoverBreakdown', 'breakdownDelayMs', 'breakdownDetail'];
  chrome.storage.local.get(KEYS, o => { readSettings(o || {}); reset(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    if (!KEYS.some(k => changes[k])) {
      if (Object.keys(changes).some(k => k.startsWith(`s:${STORE}:`)) && ratesTiles()) pass();
      return;
    }
    chrome.storage.local.get(KEYS, o => { readSettings(o || {}); reset(); });
  });

  function closeDetails() { detailTurn++; clearTimeout(detailTimer); detailHost?.remove(); detailHost = null; }
  async function showDetails(badge) {
    const turn = ++detailTurn, id = badge.dataset.airProduct;
    if (!id || !state.enabled || !state.hoverBreakdown || !badge.isConnected) return;
    const got = await CACHE.readLocal([CACHE.key(STORE, id)], state.raw, null, chrome.storage);
    const hit = got?.[CACHE.key(STORE, id)] || state.requests.get(id)?.hit;
    if (turn !== detailTurn || !badge.isConnected || badge.dataset.airProduct !== id || !hit?.input || !CACHE.recall(hit, {store:STORE, asin:id, version:VERSION, prefs:state.raw, maxAgeMs:state.maxAgeMs})) return;
    const result = root.AIR.engine.score(hit.input, state.prefs);
    if (!root.AIR.engine.isReadable(result)) return;
    detailHost?.remove(); detailHost = document.createElement('div');
    detailHost.id = 'air-retailer-details'; detailHost.style.cssText = 'position:fixed;z-index:2147483000;max-height:min(70vh, calc(100vh - 16px));overflow:auto';
    document.body.append(detailHost);
    const shadow = P.mount(detailHost, P.renderBreakdown(result, {asin:id, score:hit.score, verdict:hit.verdict, category:hit.category, ratingStyle:hit.ratingStyle, detail:state.breakdownDetail}));
    const link = shadow.querySelector('a.more');
    const href = root.AIR.retailerLabels.listingProductUrl(adapter, id, location, badge.dataset.airHref);
    if (link && href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else link?.remove();
    const rect = badge.getBoundingClientRect();
    detailHost.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - detailHost.offsetWidth - 8))}px`;
    detailHost.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - detailHost.offsetHeight - 8))}px`;
    detailHost.addEventListener('mouseenter',()=>clearTimeout(detailTimer));
    detailHost.addEventListener('mouseleave',()=>{detailTimer=setTimeout(closeDetails,250);});
  }
  const detailBadge = node => node?.closest?.('.air-badge, .air-cart-badge');
  document.addEventListener?.('mouseover', e => {
    const badge = detailBadge(e.target);
    if (!badge || badge === detailBadge(e.relatedTarget) || !state.hoverBreakdown) return;
    closeDetails();
    detailTimer = setTimeout(() => { void showDetails(badge); }, state.breakdownDelayMs);
  });
  document.addEventListener?.('mouseout', e => {
    const badge = detailBadge(e.target);
    if (!badge || badge === detailBadge(e.relatedTarget)) return;
    detailTurn++;
    clearTimeout(detailTimer);
    detailTimer = setTimeout(closeDetails, 250);
  });
  document.addEventListener?.('focusin', e => {
    const badge = detailBadge(e.target);
    if (badge) { closeDetails(); void showDetails(badge); }
    else if (!detailHost?.contains(e.target)) closeDetails();
  });
  document.addEventListener?.('pointerdown', e => { if (!detailHost?.contains(e.target)) closeDetails(); }, true);
  document.addEventListener?.('keydown', e => { if (e.key === 'Escape') closeDetails(); });
  if (typeof addEventListener === 'function') addEventListener('scroll',closeDetails,true);

  // The popup's "This page" card.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'currentPageScore') return false;
    reply(state.pageScore && typeof state.pageScore.score === 'number' ? state.pageScore : null);
    return false;
  });

  // What the sorted list (retailer-sort.js, loaded before this file and used only at call time) needs of the runner.
  root.AIR.retailerRunner = { adapter, state, CACHE, STORE, VERSION, readProductScore, publicDocument, refit, saveRefits };
  if (typeof module !== 'undefined' && module.exports) module.exports = { state, pass, reset, adapter };
})(typeof globalThis !== 'undefined' ? globalThis : self);
