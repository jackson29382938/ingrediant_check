// Search / browse tiles: food-search gate, cache chips, hover and auto-score queue.
// Reads shared state from AIR.page. Lifecycle stays in main.js.

(function (root) {
  root.AIR = root.AIR || {};
  const P = () => root.AIR.page;

  const HOVER_DELAY_MS = 600;
  const MAX_CONCURRENT = 3;
  const REQUEST_GAP_MS = 250;
  const TILE_FAIL_LIMIT = 5;
  // Amazon product-page fetches auto-score may make per results page (hover is not capped). It
  // counts fetches only: it used to count every tile touched, so tiles answered from the cache or
  // skipped as non-food used up the budget and scoring stopped about forty tiles down. A page holds
  // 48 organic results plus sponsored rows; the 3-at-a-time pacing and the throttle pause still apply.
  const MAX_AUTO_FETCHES = 60;

  // A badge is painted into the tile's title. Results pages also carry [data-asin] carousel cards
  // with no title; arming those fetched product pages for badges that could never be shown, and on
  // a kefir search 37 of them spent the auto-score budget before the last real results. A card that
  // renders its title later is picked up by the next pass, since nothing marks it until then.
  const TITLE_SEL = 'h2, [data-cy="title-recipe"]';
  const badgeable = tile => !!tile.querySelector(TITLE_SEL);

  const searchGate = { url: null, decision: null };
  const queue = { pending: [], active: 0, seen: new Set(), lastStart: 0, epoch: 0, controllers: new Set(),
    failStreak: 0, throttled: false, fetches: 0 };
  let tileObserver = null;
  let badgeStyleReady = false;
  const hoverAborts = new Set();

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
    const { state } = P();
    if (!state.foodOnly) return true;
    const gate = root.AIR.db && root.AIR.db.ingestible;
    if (!gate || typeof gate.assessSearch !== 'function') return true;
    if (searchGate.url === location.href && searchGate.decision !== null) return searchGate.decision;

    const verdict = gate.assessSearch(searchContext());
    let ok = verdict.ok;

    if (ok && verdict.signal === 'none') {
      const titles = [...document.querySelectorAll('[data-asin]')].slice(0, 24)
        .map(tileTitle).filter(Boolean);
      if (titles.length < gate.RESULT_SAMPLE_MIN) return true;
      ok = !gate.looksNonFoodFromResults(titles);
    }

    searchGate.url = location.href;
    searchGate.decision = ok;
    return ok;
  }

  function standDown() {
    clearBadges();
    cancelTileWork();
  }

  // A cached product row -> what the tile shows (docs/CACHE.md). The row is weight-independent, so
  // it is scored here under this reader's settings. Returns false when the row cannot answer for
  // this reader: a not-food row carries no text, so with the food gate off it must be read live.
  function applyRow(tile, asin, row) {
    const { state, unreadable, cacheScore } = P();
    if (state.foodOnly && (row.status === 'not-food' || row.data.food === false)) {
      tile.querySelector('.air-badge')?.remove();
      return true;
    }
    if (row.status === 'not-food') return false;
    if (row.status === 'unreadable') { paintBadge(tile, 'unreadable'); return true; }
    const result = root.AIR.engine.score(root.AIR.db.productCache.toInput(row), state.prefs);
    if (unreadable(result)) { paintBadge(tile, 'unreadable'); return true; }
    paintBadge(tile, result);
    cacheScore(asin, result, row.data.title, row.data.via || 'search-tile', '', Date.parse(row.scanned_at));
    return true;
  }

  // Cheapest answer first: this computer's weighted score, then this computer's product data (a
  // weight change lands here), then the shared products tab. Whatever is left goes to onMiss. One
  // storage read and at most one worker request per call, however many tiles.
  function resolveTiles(items, onMiss) {
    const { state, cacheKey, usableCache, storeHost, rememberProduct } = P();
    const C = root.AIR.db.productCache;
    if (!items.length) return;
    const epoch = queue.epoch;
    const live = () => epoch === queue.epoch && state.enabled && state.badges;
    const localKey = asin => C.localKey(storeHost(), asin);
    chrome.storage.local.get(items.flatMap(({ asin }) => [cacheKey(asin), localKey(asin)]), obj => {
      if (!live()) return;
      const misses = [];
      for (const it of items) {
        if (!it.tile.isConnected) continue;
        const hit = obj[cacheKey(it.asin)];
        if (usableCache(hit, it.asin)) { paintBadge(it.tile, hit); queue.seen.add(it.asin); continue; }
        const local = C.sanitize(obj[localKey(it.asin)]);
        if (local && !C.stale(local) && applyRow(it.tile, it.asin, local)) { queue.seen.add(it.asin); continue; }
        misses.push(it);
      }
      if (!misses.length) return;
      try {
        chrome.runtime.sendMessage({ type: 'productsLookup', store: storeHost(), asins: misses.map(m => m.asin) }, reply => {
          void chrome.runtime.lastError;
          if (!live()) return;
          const rows = (reply && reply.rows) || {};
          const pulls = [];
          for (const it of misses) {
            if (!it.tile.isConnected || it.tile.querySelector('.air-badge')) continue;
            const row = C.sanitize(rows[it.asin]);
            if (!row || !applyRow(it.tile, it.asin, row)) { if (onMiss) onMiss(it); continue; }
            rememberProduct(it.asin, row, { share: false });
            // Both the badge pass and the auto-score observer resolve a tile; count one pull per view.
            if (!queue.seen.has(it.asin)) pulls.push({ key: row.key, scanned_at: row.scanned_at });
            queue.seen.add(it.asin);
          }
          if (pulls.length) chrome.runtime.sendMessage({ type: 'productsQueue', pulls }, () => void chrome.runtime.lastError);
        });
      } catch (e) { if (onMiss) misses.forEach(onMiss); }
    });
  }

  function badgeSearchResults() {
    const { state, BADGE_ATTR } = P();
    const tiles = document.querySelectorAll('[data-asin]:not([' + BADGE_ATTR + '])');
    const pending = [];
    tiles.forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || asin.length !== 10 || !badgeable(tile)) return;
      tile.setAttribute(BADGE_ATTR, '1');
      if (state.foodOnly && root.AIR.db.ingestible && root.AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
        return;
      }
      pending.push({ tile, asin });
    });
    resolveTiles(pending);
    armHoverPass();
    armAutoScorePass();
  }

  function armHoverPass() {
    const { state, isListPage } = P();
    if (!state.enabled || !state.badges || !state.hoverScore) return;
    if (!isListPage() || !searchAllowed()) return;
    document.querySelectorAll('[data-asin]:not([data-air-hover])').forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !badgeable(tile)) return;
      armHover(tile, asin);
    });
  }

  function ensureBadgeStyle() {
    if (badgeStyleReady || document.getElementById('air-badge-style')) {
      badgeStyleReady = true;
      return;
    }
    const s = document.createElement('style');
    s.id = 'air-badge-style';
    s.textContent = `.air-badge{display:inline-flex;align-items:center;justify-content:center;`
      + `flex-shrink:0;align-self:center;min-width:26px;height:26px;`
      + `padding:0 6px;margin-right:8px;border-radius:999px;font:700 12px/1 sans-serif;`
      + `vertical-align:middle;box-sizing:border-box}`;
    (document.head || document.documentElement).appendChild(s);
    badgeStyleReady = true;
  }

  function paintBadge(tile, hit) {
    ensureBadgeStyle();
    const titleEl = tile.querySelector(TITLE_SEL);
    if (!titleEl) return null;
    let b = tile.querySelector('.air-badge');
    if (!b) {
      b = document.createElement('span');
      b.className = 'air-badge';
      titleEl.insertBefore(b, titleEl.firstChild);
    }
    const breakdown = hit !== 'pending' && hit !== 'unreadable' && P().state.hoverBreakdown;
    const sig = hit === 'pending' ? 'p' : hit === 'unreadable' ? '?' : `${hit.score}:${hit.verdict}`;
    if (typeof b.getAttribute === 'function' && b.getAttribute('data-air') === sig) return b;
    if (typeof b.setAttribute === 'function') b.setAttribute('data-air', sig);
    // A numbered badge opens the breakdown card (hover-card.js) when that setting is on, so it is a
    // focusable button and drops the plain tooltip the card replaces.
    if (typeof b.removeAttribute === 'function') {
      for (const a of ['role', 'tabindex', 'aria-haspopup', 'aria-expanded']) b.removeAttribute(a);
    }
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
      b.title = throttleCopy('badgeNoIngredients', "Amazon doesn't publish readable ingredients for this one");
      b.setAttribute('aria-label', b.title);
      b.style.cssText = 'color:#767676;background:#f7f8f8;border:2px dashed #d5d9d9;';
      return b;
    }
    const c = root.AIR.panel.BAND_COLOR(hit.score);
    b.textContent = hit.score;
    const verdictKey = ({
      Excellent: 'verdictExcellent', Good: 'verdictGood', Mediocre: 'verdictMediocre',
      Poor: 'verdictPoor', Avoid: 'verdictAvoid',
    })[hit.verdict];
    const verdict = verdictKey ? throttleCopy(verdictKey, hit.verdict) : hit.verdict;
    b.title = `Ingredient Check: ${hit.score}/100 — ${verdict}`;
    b.setAttribute('aria-label', b.title);
    b.style.cssText = `color:${c.fg};background:${c.bg};border:2px solid ${c.ring};`;
    if (breakdown) {
      b.removeAttribute('title');
      b.setAttribute('role', 'button');
      b.setAttribute('tabindex', '0');
      b.setAttribute('aria-haspopup', 'dialog');
      b.setAttribute('aria-expanded', 'false');
      b.style.cursor = 'pointer';
    }
    return b;
  }

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
    queue.fetches = 0;
    clearThrottleNotice();
    for (const controller of queue.controllers) controller.abort();
    queue.controllers.clear();
    if (tileObserver) { tileObserver.disconnect(); tileObserver = null; }
    for (const ac of hoverAborts) ac.abort();
    hoverAborts.clear();
    document.querySelectorAll('[data-air-auto]').forEach(t => t.removeAttribute('data-air-auto'));
    document.querySelectorAll('[data-air-hover]').forEach(t => t.removeAttribute('data-air-hover'));
  }

  function tileTitle(tile) {
    const el = tile.querySelector('h2 a, h2, [data-cy="title-recipe"]');
    return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  }

  function enqueue(tile, asin, { front = false } = {}) {
    const { state } = P();
    if (queue.throttled) return;
    if (!state.enabled || !state.badges || !searchAllowed()) return;
    if (front ? !state.hoverScore : !state.autoScoreSearch) return;
    if (queue.seen.has(asin)) return;
    if (!front && queue.fetches >= MAX_AUTO_FETCHES) return;
    if (state.foodOnly && root.AIR.db.ingestible && root.AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
      queue.seen.add(asin);
      return;
    }
    queue.seen.add(asin);
    if (!front) queue.fetches++;
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
    const { state } = P();
    if (tile.hasAttribute('data-air-hover')) return;
    tile.setAttribute('data-air-hover', '1');
    let timer = null;
    const ac = new AbortController();
    hoverAborts.add(ac);
    ac.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      hoverAborts.delete(ac);
    });
    const start = () => {
      if (!state.enabled || !state.badges || !state.hoverScore) return;
      if (!searchAllowed()) return;
      if (tile.querySelector('.air-badge')) return;
      clearTimeout(timer);
      timer = setTimeout(() => enqueue(tile, asin, { front: true }), HOVER_DELAY_MS);
    };
    const cancel = () => clearTimeout(timer);
    const opts = { signal: ac.signal };
    tile.addEventListener('mouseenter', start, opts);
    tile.addEventListener('mouseleave', cancel, opts);
    tile.addEventListener('focusin', start, opts);
    tile.addEventListener('focusout', cancel, opts);
  }

  function autoObserver() {
    const { state } = P();
    if (tileObserver) return tileObserver;
    tileObserver = new IntersectionObserver(entries => {
      if (!state.enabled || !state.badges || !state.autoScoreSearch) return;
      if (!searchAllowed()) return;
      const visible = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const tile = entry.target;
        tileObserver.unobserve(tile);
        const asin = tile.getAttribute('data-asin');
        if (!asin || tile.querySelector('.air-badge')) continue;
        visible.push({ tile, asin });
      }
      // enqueue() re-checks the auto-score toggle, the throttle and the per-page cap.
      resolveTiles(visible, ({ tile, asin }) => enqueue(tile, asin));
    }, { rootMargin: '150px' });
    return tileObserver;
  }

  function armAutoScorePass() {
    const { state, isListPage } = P();
    if (queue.throttled) return;
    if (!state.enabled || !state.badges || !state.autoScoreSearch) return;
    if (!isListPage() || !searchAllowed()) return;
    const obs = autoObserver();
    document.querySelectorAll('[data-asin]:not([data-air-auto])').forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || !badgeable(tile)) return;
      tile.setAttribute('data-air-auto', '1');
      obs.observe(tile);
    });
  }

  async function scoreTile(tile, asin, epoch, url) {
    const { state, unreadable, cacheScore, sendDiagnostic, rememberProduct } = P();
    const current = () => epoch === queue.epoch && url === location.href && state.enabled
      && state.badges && tile.isConnected && searchAllowed();
    if (!current()) return;
    const controller = new AbortController();
    queue.controllers.add(controller);
    paintBadge(tile, 'pending');
    try {
      const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.any)
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
        : controller.signal;
      const res = await fetch(`/dp/${asin}`, { credentials: 'same-origin', signal });
      if (!res.ok) throw Object.assign(new Error(String(res.status)), { httpStatus: res.status });
      const html = await res.text();
      if (!current()) return;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const data = root.AIR.extract.extract(doc, { asin, foodOnly: state.foodOnly });
      if (!current()) return;
      // A robot check or an error page is not an answer about the product; never record it.
      const real = !!doc.querySelector('#productTitle');
      const food = !(data.ingestible && data.ingestible.ok === false);
      if (state.foodOnly && !food) {
        if (real) rememberProduct(asin, { status: 'not-food', input: { name: data.title }, food });
        const b = tile.querySelector('.air-badge');
        if (b) b.remove();
        return;
      }
      if (!data.ok) {
        if (real) rememberProduct(asin, { status: 'unreadable', input: { name: data.title }, food });
        paintBadge(tile, 'unreadable');
        return;
      }
      const input = {
        name: data.title, labels: data.labels, certifications: data.certifications,
        nutrition: data.nutrition, ingredients_text: data.text,
      };
      const result = root.AIR.engine.score(input, state.prefs);
      rememberProduct(asin, { input, via: data.via || 'search-tile', confidence: data.confidence, food });
      if (unreadable(result)) { paintBadge(tile, 'unreadable'); return; }
      paintBadge(tile, result);
      cacheScore(asin, result, data.title, data.via || 'search-tile');
      sendDiagnostic(data, result, 'search-tile');
      queue.failStreak = 0;
    } catch (e) {
      if (!current()) return;
      const aborted = e && (e.name === 'AbortError' || e.name === 'TimeoutError' || controller.signal.aborted);
      if (aborted) return;
      const b = tile.querySelector('.air-badge');
      if (b && b.textContent === '…') b.remove();
      // Only Amazon HTTP blocks count toward the throttle pause — offline / DNS is not a 403.
      const status = e && e.httpStatus;
      if (typeof status === 'number' && status >= 400) noteTileFailure();
    } finally {
      queue.controllers.delete(controller);
    }
  }

  function clearBadges() {
    const { BADGE_ATTR } = P();
    root.AIR.hoverCard?.close();
    document.querySelectorAll('.air-badge').forEach(b => b.remove());
    document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(tile => tile.removeAttribute(BADGE_ATTR));
    for (const ac of hoverAborts) ac.abort();
    hoverAborts.clear();
    document.querySelectorAll('[data-air-hover]').forEach(t => t.removeAttribute('data-air-hover'));
  }

  const search = {
    queue, TILE_FAIL_LIMIT, MAX_AUTO_FETCHES,
    searchAllowed, resetSearchGate, standDown, badgeSearchResults,
    armHoverPass, armAutoScorePass, enqueue, scoreTile, cancelTileWork, resolveTiles,
    pauseForThrottle, clearBadges, paintBadge,
  };
  root.AIR.search = search;
  if (typeof module !== 'undefined' && module.exports) module.exports = search;
})(typeof globalThis !== 'undefined' ? globalThis : self);
