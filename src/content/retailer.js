// Content script for stores other than Amazon. One runner, one adapter per store
// (src/stores/<store>.js): the adapter knows the store's pages, this knows what to do with them.
// Amazon keeps its own pipeline (page/product/search/main.js) and does not load this file.
//
// Everything here is local. It reads the page the visitor has open, scores it on this computer,
// and keeps the score in chrome.storage.local. It never fetches: no product pages in the background,
// no shared database, no Open Food Facts, no label photos. A search results page shows a score only
// for products the visitor has already opened on this computer.

(function (root) {
  const adapter = Object.values(root.AIR.storeAdapters || {}).find(a => a.matchesHost(location.hostname));
  if (!adapter) return;

  const HOST_ID = 'air-score-panel';
  const BADGE_CLASS = 'air-badge';
  const MIN_COVERAGE = 0.34;           // the same gate as the Amazon pipeline (src/content/page.js)
  const WAIT_FOR_LABEL_MS = 15000;      // how long a product page may take to render its label
  const P = root.AIR.panel;
  const CACHE = root.AIR.db.scoreCache;
  const PREFS = root.AIR.db.prefs;
  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return '0'; } })();
  const STORE = CACHE.normalizeStore(location.hostname);

  const state = { enabled: true, badges: true, foodOnly: true, prefs: {}, raw: {}, url: '', pageScore: null,
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
    const scoring = PREFS.sanitizeScoring(o);
    state.prefs = { weights: scoring.weights, allergens: scoring.allergens, diets: scoring.diets, avoidList: scoring.avoidList };
    // The same fingerprint inputs the popup validates with, so its "This page" card accepts these.
    state.raw = { weights: o.weights, foodOnly: toggles.foodOnly,
      sheetIndexRev: o.sheetIndexRev, producerIndexRev: o.producerIndexRev };
    // How old a saved score may be: the speed setting's age (1 to 90 days), as on Amazon.
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
      ? { type: 'pageScore', score: result.score, verdict: result.verdict }
      : { type: 'pageScore', status: result && result.status });
  }

  function cacheEntry(id, result, name, source) {
    return {
      schema: CACHE.SCHEMA, v: VERSION, t: Date.now(), store: STORE, asin: id,
      prefs: CACHE.fingerprint(state.raw, source), score: result.score, verdict: result.verdict,
      nova: result.nova, source, provenanceSource: '', name: String(name || '').slice(0, 120),
    };
  }

  function show(host, html, state_, wire) {
    host.dataset.airState = state_;
    const shadow = P.mount(host, html, null, wire && wire.paste);
    if (wire && wire.after) wire.after(shadow);
  }

  function scoreText(host, data, text, via) {
    const result = root.AIR.engine.score({ name: data.title, ingredients_text: text, nutrition: data.nutrition }, state.prefs);
    if (result.parsed > 0 && result.coverage < MIN_COVERAGE) {
      show(host, P.renderFailure({ lowCoverage: true, storeName: adapter.name }), 'fail', { paste: onPaste(host, data) });
      badge({ status: 'fail' });
      return;
    }
    show(host, P.render(result, { title: data.title, confidence: via === 'manual-paste' ? 1 : 0.95, via, report: false }), 'scored');
    const entry = cacheEntry(data.id, result, data.title, via === 'manual-paste' ? 'manual-paste' : (via === 'food-override' ? 'food-override' : 'page'));
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
    if (!data.id) return true;
    const anchor = document.querySelector('h1[data-test="product-title"]') || document.querySelector('h1');
    if (!anchor || !anchor.parentNode) return false; // not rendered yet
    // Created on first use, so a page still rendering its label gets no empty card.
    const host = () => hostEl(anchor);

    if (state.manual && state.manual.id === data.id) { scoreText(host(), data, state.manual.text, 'manual-paste'); return true; }

    if (state.foodOnly && !state.override) {
      const verdict = root.AIR.db.ingestible.assess({ querySelector: () => null },
        { title: data.title, text: [data.crumbs.join(' › '), data.title, data.labelText].join(' \n ') });
      if (!verdict.ok && verdict.negatives.length) {
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
        title: t('labelClosedTitle', 'Open “Label info” to score this product.'),
        body: t('labelClosedBody', 'This store only shows the ingredient list once that section is open. Ingredient Check reads it from this page on your computer; nothing is sent anywhere.'),
        action: t('labelClosedAction', 'Open Label info'),
      }), 'waiting', {
        after: shadow => shadow.querySelector('button.notice-action')?.addEventListener('click', () => {
          const toggle = adapter.labelToggle(document);
          if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
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
  function paintBadge(anchor, hit) {
    let b = anchor.querySelector('.' + BADGE_CLASS);
    if (!b) {
      b = document.createElement('span');
      b.className = BADGE_CLASS;
      anchor.insertBefore(b, anchor.firstChild);
    }
    const text = String(hit.score);
    const title = `Ingredient Check: ${hit.score}/100 — ${hit.verdict}`;
    // Setting the same text again still replaces the text node, which the page watcher sees as a
    // change: it ran another pass 400 ms later, which repainted, for as long as the tab stayed open.
    if (b.textContent === text && b.title === title) return;
    const c = P.BAND_COLOR(hit.score);
    b.textContent = text;
    b.title = title;
    // aria-label on a plain span is ignored; as an image the label is the badge's name (search.js too).
    b.setAttribute('aria-label', b.title);
    b.setAttribute('role', 'img');
    b.style.cssText = `display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;`
      + `padding:0 6px;margin-right:8px;border-radius:999px;font:700 12px/1 sans-serif;vertical-align:middle;`
      + `box-sizing:border-box;color:${c.fg};background:${c.bg};border:2px solid ${c.ring};`;
  }

  function searchPass() {
    const tiles = adapter.searchTiles(document);
    if (state.foodOnly) {
      const gate = root.AIR.db.ingestible;
      const verdict = gate.assessSearch({ query: adapter.searchQuery(location), alias: '', label: '' });
      const titles = tiles.map(x => x.title);
      if (!verdict.ok || (titles.length >= gate.RESULT_SAMPLE_MIN && gate.looksNonFoodFromResults(titles))) {
        clearBadges();
        return true;                                // stand down on a non-food search
      }
    }
    if (!state.badges || !tiles.length) return false;
    const generation = state.generation;
    const keys = tiles.map(x => CACHE.key(STORE, x.id));
    chrome.storage.local.get(keys, got => {
      if (generation !== state.generation || !state.enabled || !state.badges) return;
      for (const x of tiles) {
        const hit = got && got[CACHE.key(STORE, x.id)];
        if (x.anchor.isConnected && CACHE.valid(hit, { store: STORE, asin: x.id, version: VERSION, prefs: state.raw, maxAgeMs: state.maxAgeMs })) {
          paintBadge(x.anchor, hit);
        } else {
          x.anchor.querySelector('.' + BADGE_CLASS)?.remove();
        }
      }
    });
    return false;                                   // results keep loading as the visitor scrolls
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
    if (product && done === true) { state.done = true; stopWatching(); }
    else if (product && done === false) {
      state.timer = setTimeout(pass, Math.max(500, WAIT_FOR_LABEL_MS - (Date.now() - state.started) + 50));
    }
  }

  function watch() {
    if (state.observer || !state.enabled) return;
    let pending = null;
    state.observer = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; pass(); }, 400);
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function reset() {
    state.generation = (state.generation || 0) + 1;
    send({ type: 'pageScore', status: null });
    stopWatching();
    document.getElementById(HOST_ID)?.remove();
    clearBadges();
    state.pageScore = null; state.override = false; state.done = false; state.started = Date.now();
    state.url = location.href;
    if (!state.enabled) return;
    if (!adapter.isProductPage(location) && !adapter.isSearchPage(location)) return;
    pass();
    if (!state.done) watch();
  }

  // Target is a single-page app: moving from results to a product does not reload the page.
  setInterval(() => { if (location.href !== state.url) { state.manual = null; reset(); } }, 1000);

  const KEYS = ['enabled', 'badges', 'foodOnly', 'weights', 'allergens', 'diets', 'avoidList',
    'sheetIndexRev', 'producerIndexRev', 'speedMode'];
  chrome.storage.local.get(KEYS, o => { readSettings(o || {}); reset(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    if (!KEYS.some(k => changes[k])) {
      if (Object.keys(changes).some(k => k.startsWith(`s:${STORE}:`)) && adapter.isSearchPage(location)) pass();
      return;
    }
    chrome.storage.local.get(KEYS, o => { readSettings(o || {}); reset(); });
  });

  // The popup's "This page" card.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'currentPageScore') return false;
    reply(state.pageScore && typeof state.pageScore.score === 'number' ? state.pageScore : null);
    return false;
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = { state, pass, reset, adapter };
})(typeof globalThis !== 'undefined' ? globalThis : self);
