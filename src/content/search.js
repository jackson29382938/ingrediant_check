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
  // The speed setting lowers it (AIR.db.speed autoFetches); 60 is the Balanced default.
  const MAX_AUTO_FETCHES = 60;
  const autoFetchCap = () => (P().speed ? P().speed().autoFetches : MAX_AUTO_FETCHES);

  // A badge is painted into the tile's title. Results pages also carry [data-asin] carousel cards
  // with no title; arming those fetched product pages for badges that could never be shown, and on
  // a kefir search 37 of them spent the auto-score budget before the last real results. A card that
  // renders its title later is picked up by the next pass, since nothing marks it until then.
  const TITLE_SEL = 'h2, [data-cy="title-recipe"]';
  const badgeable = tile => !!tile.querySelector(TITLE_SEL);

  const searchGate = { url: null, decision: null };
  // One queue for every Amazon product-page request this tab makes: the badges (below) and the sorted
  // list (sort.js readByProductPage) share its slots, its gap between starts, its failure count and
  // throttle pause, and its per-results-page budget (`fetches`). `reads` holds requests in flight and
  // `readings` finished ones, by ASIN, so a product is requested once per results page whoever asks.
  const queue = { pending: [], active: 0, seen: new Set(), lastStart: 0, epoch: 0, controllers: new Set(),
    failStreak: 0, throttled: false, fetches: 0, reads: new Map(), readings: new Map() };
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
    const { state, cacheKey, usableCache, freshLocal, sharedOk, sharedProductsOn, speed, storeHost, rememberProduct } = P();
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
        if (local && freshLocal(local) && applyRow(it.tile, it.asin, local)) { queue.seen.add(it.asin); continue; }
        misses.push(it);
      }
      if (!misses.length) return;
      // "Most up to date" reads every product page itself instead of asking the shared database, and
      // so does a reader who has not turned shared product readings on.
      if (!speed().sharedDays || !sharedProductsOn()) { if (onMiss) misses.forEach(onMiss); return; }
      try {
        chrome.runtime.sendMessage({ type: 'productsLookup', store: storeHost(), asins: misses.map(m => m.asin) }, reply => {
          void chrome.runtime.lastError;
          if (!live()) return;
          const rows = (reply && reply.rows) || {};
          const pulls = [];
          for (const it of misses) {
            if (!it.tile.isConnected || it.tile.querySelector('.air-badge')) continue;
            const row = C.sanitize(rows[it.asin]);
            if (!row || !sharedOk(row) || !applyRow(it.tile, it.asin, row)) { if (onMiss) onMiss(it); continue; }
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
      for (const a of ['role', 'tabindex', 'aria-haspopup', 'aria-expanded', 'aria-hidden']) b.removeAttribute(a);
    }
    // The badge sits inside the product link. aria-label on a plain span is ignored, so a score read
    // as a bare "96"; role="img" makes the label the badge's name. The pending "…" is hidden: as a
    // role="status" live region it announced "Reading ingredients" once per tile, and never the score.
    if (hit === 'pending') {
      b.textContent = '…';
      b.title = 'Reading ingredients…';
      b.removeAttribute('aria-label');
      b.setAttribute('aria-hidden', 'true');
      b.style.cssText = 'color:#565959;background:#f0f2f2;border:2px solid #d5d9d9;';
      return b;
    }
    if (hit === 'unreadable') {
      b.textContent = '?';
      b.title = throttleCopy('badgeNoIngredients', "Amazon doesn't publish readable ingredients for this one");
      b.setAttribute('aria-label', b.title);
      b.setAttribute('role', 'img');
      b.style.cssText = 'color:#6a6a6a;background:#f7f8f8;border:2px dashed #d5d9d9;';
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
    b.setAttribute('role', 'img');
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

  // Automatic rating is on by default, and what it does is not visible from the tiles: each result
  // it scores is a product-page request to this Amazon store, made with the reader's own Amazon
  // sign-in. So the first time it is about to make one, the page says so once, next to the
  // results, with the switch right there. It never waits on an answer: scoring carries on
  // underneath, exactly as before, until the reader turns it off here or in the popup.
  const AUTO_NOTICE_ID = 'air-auto-notice';
  const AUTO_NOTICE_SEEN = 'autoScoreNoticeSeen';
  let autoNoticeChecked = false;

  function noticeButton(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'margin:8px 8px 0 0;padding:4px 10px;border:1px solid #8d9096;border-radius:6px;'
      + 'background:#fff;color:#0f1111;font:inherit;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  }

  function showAutoScoreNotice() {
    if (document.getElementById(AUTO_NOTICE_ID)) return;
    const el = document.createElement('div');
    el.id = AUTO_NOTICE_ID;
    el.setAttribute('role', 'status');
    el.style.cssText = 'margin:12px 0;padding:12px 14px;border:1px solid #8fb4d9;border-radius:8px;'
      + 'background:#eef5fb;color:#0f1111;font:13px/1.45 "Amazon Ember",sans-serif;';
    const title = document.createElement('b');
    title.style.display = 'block';
    title.textContent = throttleCopy('autoNoticeTitle', 'Ingredient Check is rating these results');
    const body = document.createElement('span');
    body.textContent = throttleCopy('autoNoticeBody',
      'To score a result, it requests that product\'s page from this Amazon store in the background, '
      + 'signed in as you: a few at a time, at most 60 per results page. Amazon sees each request much as '
      + 'if you had opened the product. You can change this at any time in the Ingredient Check toolbar popup.');
    const done = values => {
      el.remove();
      try { chrome.storage.local.set(values); } catch (e) { /* extension reloaded */ }
    };
    el.appendChild(title);
    el.appendChild(body);
    el.appendChild(document.createElement('br'));
    el.appendChild(noticeButton(throttleCopy('autoNoticeOff', 'Turn off automatic rating'),
      () => done({ autoScoreSearch: false, [AUTO_NOTICE_SEEN]: true })));
    el.appendChild(noticeButton(throttleCopy('autoNoticeOk', 'OK'), () => done({ [AUTO_NOTICE_SEEN]: true })));
    // In priority order: one selector list would return <body> first, since it precedes the results
    // in the document, and the notice would land above Amazon's header instead of beside the results.
    const results = document.querySelector('#search') || document.querySelector('.s-main-slot');
    if (results && results.parentNode) results.parentNode.insertBefore(el, results);
    else if (document.body) document.body.insertBefore(el, document.body.firstChild);
    else document.documentElement.appendChild(el);
  }

  // Asked once per page (and again after the notice is cleared), not once per tile.
  function noteAutoFetch() {
    if (autoNoticeChecked) return;
    autoNoticeChecked = true;
    try {
      chrome.storage.local.get(AUTO_NOTICE_SEEN, o => {
        void chrome.runtime.lastError;
        const { state } = P();
        if ((o && o[AUTO_NOTICE_SEEN]) || !state.enabled || !state.autoScoreSearch || queue.throttled) return;
        showAutoScoreNotice();
      });
    } catch (e) { /* extension reloaded under the page */ }
  }

  function clearAutoScoreNotice() {
    autoNoticeChecked = false;
    document.getElementById(AUTO_NOTICE_ID)?.remove();
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
    queue.reads.clear();
    queue.readings.clear();
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
    if (!front && queue.fetches >= autoFetchCap()) return;
    if (state.foodOnly && root.AIR.db.ingestible && root.AIR.db.ingestible.looksNonFoodFromTitle(tileTitle(tile))) {
      queue.seen.add(asin);
      return;
    }
    queue.seen.add(asin);
    if (!front) { queue.fetches++; noteAutoFetch(); }
    const job = { tile, asin, epoch: queue.epoch, url: location.href };
    if (front) queue.pending.unshift(job); else queue.pending.push(job);
    pump();
  }

  // A request slot for the sorted list (sort.js). The badges' pump() takes slots directly; this waits
  // until one is free and the gap since the last start has passed. -> false when `halted` says stop
  // or Amazon throttled this tab.
  async function acquireSlot(halted = () => false) {
    for (;;) {
      if (halted() || queue.throttled) return false;
      const wait = Math.max(0, queue.lastStart + REQUEST_GAP_MS - Date.now());
      if (queue.active < MAX_CONCURRENT && !wait) {
        queue.active++;
        queue.lastStart = Date.now();
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, wait || REQUEST_GAP_MS));
    }
  }
  function releaseSlot() {
    queue.active = Math.max(0, queue.active - 1);
    pump();
  }
  // The request for this product, if one is in flight or done on this results page.
  const knownRead = asin => queue.readings.get(asin) || queue.reads.get(asin) || null;

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

  // What one fetched product page says, with no side effects: 'not-food', 'unreadable' (no list),
  // 'low-coverage' (a list the rulebase mostly cannot read) or 'scored'. Shared by the tile queue and
  // the sort's load-more pass (sort.js), so both read a product page exactly the same way.
  function readProductHtml(asin, html) {
    const { state, unreadable } = P();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const data = root.AIR.extract.extract(doc, { asin, foodOnly: state.foodOnly });
    // A robot check or an error page is not an answer about the product; never record it.
    const real = !!doc.querySelector('#productTitle');
    const food = !(data.ingestible && data.ingestible.ok === false);
    if (state.foodOnly && !food) return { outcome: 'not-food', real, food, data };
    if (!data.ok) return { outcome: 'unreadable', real, food, data };
    const input = {
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: data.text,
    };
    const result = root.AIR.engine.score(input, state.prefs);
    return { outcome: unreadable(result) ? 'low-coverage' : 'scored', real, food, data, input, result };
  }

  // Keep what a reading found: the product data (p:) whenever the page was real, and the weighted
  // score (s:) plus a diagnostic row when there is a score.
  function recordReading(asin, reading, source) {
    const { cacheScore, sendDiagnostic, rememberProduct } = P();
    const { outcome, real, food, data } = reading;
    if (outcome === 'not-food' || outcome === 'unreadable') {
      if (real) rememberProduct(asin, { status: outcome, input: { name: data.title }, food });
      return;
    }
    rememberProduct(asin, { input: reading.input, via: data.via || source, confidence: data.confidence, food });
    if (outcome !== 'scored') return;
    cacheScore(asin, reading.result, data.title, data.via || source);
    sendDiagnostic(data, reading.result, source);
  }

  const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

  // Fetch, read and record one product page, once per results page however many callers ask: a
  // second caller joins the request in flight or gets the finished reading. Any caller's HTTP refusal
  // counts toward the one throttle pause. Nothing is recorded once the search was reset (epoch), the
  // master switch went off, or the request was aborted. -> the reading (readProductHtml).
  function readProductPage(asin, source) {
    const { state } = P();
    const known = knownRead(asin);
    if (known) return Promise.resolve(known);
    if (queue.throttled) return Promise.reject(abortError());
    const epoch = queue.epoch;
    const controller = new AbortController();
    queue.controllers.add(controller);
    const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.any)
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
      : controller.signal;
    const stale = () => controller.signal.aborted || epoch !== queue.epoch || !state.enabled;
    const work = (async () => {
      try {
        const res = await fetch(`/dp/${asin}`, { credentials: 'same-origin', signal });
        if (stale()) throw abortError();
        // Only Amazon HTTP blocks count toward the throttle pause — offline / DNS is not a 403.
        if (!res.ok) {
          if (res.status >= 400) noteTileFailure();
          throw Object.assign(new Error(String(res.status)), { httpStatus: res.status });
        }
        const html = await res.text();
        if (stale()) throw abortError();
        const reading = readProductHtml(asin, html);
        recordReading(asin, reading, source);
        queue.failStreak = 0;
        queue.readings.set(asin, reading);
        return reading;
      } finally {
        queue.controllers.delete(controller);
      }
    })();
    queue.reads.set(asin, work);
    // Once settled, a later caller finds the reading in `readings`, or (after a failure) asks again.
    const forget = () => { if (queue.reads.get(asin) === work) queue.reads.delete(asin); };
    work.then(forget, forget);
    return work;
  }

  function paintReading(tile, reading) {
    if (reading.outcome === 'not-food') { tile.querySelector('.air-badge')?.remove(); return; }
    if (reading.outcome !== 'scored') { paintBadge(tile, 'unreadable'); return; }
    paintBadge(tile, reading.result);
  }

  async function scoreTile(tile, asin, epoch, url) {
    const { state } = P();
    const current = () => epoch === queue.epoch && url === location.href && state.enabled
      && state.badges && tile.isConnected && searchAllowed();
    if (!current()) return;
    const done = queue.readings.get(asin);
    if (done) { paintReading(tile, done); return; }
    paintBadge(tile, 'pending');
    try {
      const reading = await readProductPage(asin, 'search-tile');
      if (!current()) return;
      paintReading(tile, reading);
    } catch (e) {
      if (!current()) return;
      // Refused, offline, or a request the sorted list started and then stopped.
      const b = tile.querySelector('.air-badge');
      if (b && b.textContent === '…') b.remove();
    }
  }

  function clearBadges() {
    const { BADGE_ATTR } = P();
    root.AIR.hoverCard?.close();
    clearAutoScoreNotice();
    document.querySelectorAll('.air-badge').forEach(b => b.remove());
    document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(tile => tile.removeAttribute(BADGE_ATTR));
    for (const ac of hoverAborts) ac.abort();
    hoverAborts.clear();
    document.querySelectorAll('[data-air-hover]').forEach(t => t.removeAttribute('data-air-hover'));
  }

  const search = {
    queue, TILE_FAIL_LIMIT, MAX_AUTO_FETCHES, MAX_CONCURRENT, autoFetchCap,
    readProductPage, knownRead, acquireSlot, releaseSlot,
    searchAllowed, resetSearchGate, standDown, badgeSearchResults,
    armHoverPass, armAutoScorePass, enqueue, scoreTile, cancelTileWork, resolveTiles,
    pauseForThrottle, clearBadges, paintBadge, AUTO_NOTICE_ID, AUTO_NOTICE_SEEN,
    readProductHtml, recordReading,
  };
  root.AIR.search = search;
  if (typeof module !== 'undefined' && module.exports) module.exports = search;
})(typeof globalThis !== 'undefined' ? globalThis : self);
