// Search / browse tiles: food-search gate, cache chips, hover and auto-score queue.
// Reads shared state from AIR.page. Lifecycle stays in main.js.

(function (root) {
  root.AIR = root.AIR || {};
  const P = () => root.AIR.page;

  const HOVER_DELAY_MS = 600;
  const MAX_CONCURRENT = 3;
  const REQUEST_GAP_MS = 250;
  const TILE_FAIL_LIMIT = 5;

  const searchGate = { url: null, decision: null };
  const queue = { pending: [], active: 0, seen: new Set(), lastStart: 0, epoch: 0, controllers: new Set(),
    failStreak: 0, throttled: false };
  let tileObserver = null;
  let badgeStyleReady = false;

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

  function badgeSearchResults() {
    const { state, BADGE_ATTR, cacheKey, usableCache } = P();
    const tiles = document.querySelectorAll('[data-asin]:not([' + BADGE_ATTR + '])');
    tiles.forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || asin.length !== 10) return;
      tile.setAttribute(BADGE_ATTR, '1');
      if (state.foodOnly && root.AIR.db.ingestible && root.AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
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

  function armHoverPass() {
    const { state, isListPage } = P();
    if (!state.enabled || !state.badges || !state.hoverScore) return;
    if (!isListPage() || !searchAllowed()) return;
    document.querySelectorAll('[data-asin]:not([data-air-hover])').forEach(tile => {
      const asin = tile.getAttribute('data-asin');
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
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
    const c = root.AIR.panel.BAND_COLOR(hit.score);
    b.textContent = hit.score;
    b.title = `Ingredient Check: ${hit.score}/100 — ${hit.verdict}`;
    b.setAttribute('aria-label', b.title);
    b.style.cssText = `color:${c.fg};background:${c.bg};border:2px solid ${c.ring};`;
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
    const { state } = P();
    if (queue.throttled) return;
    if (!state.enabled || !state.badges || !searchAllowed()) return;
    if (front ? !state.hoverScore : !state.autoScoreSearch) return;
    if (queue.seen.has(asin)) return;
    if (state.foodOnly && root.AIR.db.ingestible && root.AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
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
    const { state } = P();
    if (tile.hasAttribute('data-air-hover')) return;
    tile.setAttribute('data-air-hover', '1');
    let timer = null;
    const start = () => {
      if (!state.enabled || !state.badges || !state.hoverScore) return;
      if (!searchAllowed()) return;
      if (tile.querySelector('.air-badge')) return;
      clearTimeout(timer);
      timer = setTimeout(() => enqueue(tile, asin, { front: true }), HOVER_DELAY_MS);
    };
    const cancel = () => clearTimeout(timer);
    tile.addEventListener('mouseenter', start);
    tile.addEventListener('mouseleave', cancel);
    tile.addEventListener('focusin', start);
    tile.addEventListener('focusout', cancel);
  }

  function autoObserver() {
    const { state, cacheKey, usableCache } = P();
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
    const { state, isListPage } = P();
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
    const { state, unreadable, cacheScore, sendDiagnostic } = P();
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
      const data = root.AIR.extract.extract(doc, { asin, foodOnly: state.foodOnly });
      if (!current()) return;
      if (state.foodOnly && data.ingestible && !data.ingestible.ok) {
        const b = tile.querySelector('.air-badge');
        if (b) b.remove();
        return;
      }
      if (!data.ok) { paintBadge(tile, 'unreadable'); return; }
      const result = root.AIR.engine.score({
        name: data.title, labels: data.labels, certifications: data.certifications,
        nutrition: data.nutrition, ingredients_text: data.text,
      }, state.prefs);
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
      noteTileFailure();
    } finally {
      queue.controllers.delete(controller);
    }
  }

  function clearBadges() {
    const { BADGE_ATTR } = P();
    document.querySelectorAll('.air-badge').forEach(b => b.remove());
    document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(tile => tile.removeAttribute(BADGE_ATTR));
  }

  const search = {
    queue, TILE_FAIL_LIMIT,
    searchAllowed, resetSearchGate, standDown, badgeSearchResults,
    armHoverPass, armAutoScorePass, enqueue, scoreTile, cancelTileWork,
    pauseForThrottle, clearBadges, paintBadge,
  };
  root.AIR.search = search;
  if (typeof module !== 'undefined' && module.exports) module.exports = search;
})(typeof globalThis !== 'undefined' ? globalThis : self);
