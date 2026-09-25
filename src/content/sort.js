// Sort Amazon search results by Ingredient Check score.
//
// A port of the Amazon Cost per Ounce Sorter (github.com/jackson29382938/amazon_cost_sorting) with
// the score as the key: a toolbar above the results with Sort, Restore order, Load more results,
// Open sorted list and Settings. Sorting moves Amazon's own result cards, best score first, listings
// without a score at the end, ties in Amazon's order (AIR.db.sortedResults.sortByScore).
//
// Scores come from the same places the badges do: this computer's cache, then the shared database,
// then, only when "Rate every search result" is on and the sort setting allows it, the product page
// itself through search.js's queue and pacing. Nothing here fetches anything the badges would not.
// "Load more results" (off by default) also reads further Amazon search pages and, for listings still
// without a score, their product pages: up to the configured count, three at a time, and it stops
// when Amazon starts refusing.

(function (root) {
  root.AIR = root.AIR || {};
  const P = () => root.AIR.page;
  const S = () => root.AIR.search;
  const R = () => root.AIR.db.sortedResults;

  const CARD = '[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]';
  const HOST_ID = 'air-sort-host';
  const MAX_CONCURRENT = 3;
  const REQUEST_GAP_MS = 250;
  const FAIL_LIMIT = 5;
  const LOOKUP_BATCH = 100;
  const RATE_WAIT_MS = 90000;

  const originalOrder = new WeakMap();
  const knownCards = [];
  let toolbar = null;
  let resultData = [];
  let sorted = false;
  let run = 0;                     // bumped to cancel whatever is in flight
  const controllers = new Set();

  // A message with $1, $2 filled in, from the locale file when it has one.
  const t = (key, fallback, ...subs) => {
    const args = subs.map(String);
    let text = '';
    try { text = (chrome.i18n && chrome.i18n.getMessage(key, args)) || ''; } catch (e) { /* no locale */ }
    return text || fallback.replace(/\$(\d)/g, (m, n) => (args[n - 1] != null ? args[n - 1] : m));
  };
  const unscoredTail = n => (n === 1 ? t('sortUnscoredTailOne', '1 without a score is at the end.')
    : t('sortUnscoredTail', '$1 without a score are at the end.', n));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const storageGet = keys => new Promise(resolve => {
    try { chrome.storage.local.get(keys, o => { void chrome.runtime.lastError; resolve(o || {}); }); }
    catch (e) { resolve({}); }
  });
  const send = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); }); }
    catch (e) { resolve(undefined); }
  });

  const isSearchPage = () => /(^|\/)s(?:\/|$)/.test(location.pathname) || new URLSearchParams(location.search).has('k');
  const toAbsoluteUrl = value => { try { return new URL(value, location.href).href; } catch { return ''; } };

  // ------------------------------------------------------------------ cards
  const isCard = card => card.dataset && card.dataset.asin && card.querySelector('h2 a, a.a-link-normal.s-no-outline');

  function scanCards(rootNode = document) {
    const found = [...rootNode.querySelectorAll(CARD)].filter(isCard);
    for (const card of found) {
      if (!originalOrder.has(card)) {
        originalOrder.set(card, knownCards.length);
        knownCards.push(card);
      }
    }
    return found;
  }

  function getPrice(card) {
    for (const node of card.querySelectorAll('.a-price:not(.a-text-price) .a-offscreen')) {
      if (node.closest('.a-text-price')) continue;
      const value = R().parseMoney(node.textContent);
      if (value != null) return value;
    }
    return null;
  }

  // The listing as the sorted list shows it. The score is added by withScores().
  function extractProduct(card, pageNumber = 1) {
    // Our own score badge sits at the start of the title (search.js paintBadge); it is not the title.
    const badge = (card.querySelector('.air-badge')?.textContent || '').trim();
    const withoutBadge = s => (badge && s.startsWith(badge) ? s.slice(badge.length) : s).trim();
    const titleNode = card.querySelector('h2 span:not(.air-badge)') || card.querySelector('h2');
    const linkNode = card.querySelector('h2 a') || card.querySelector('a.a-link-normal.s-no-outline');
    const title = withoutBadge((titleNode?.innerText || titleNode?.textContent || '').trim());
    const text = (card.innerText || card.textContent || '').replace(/\u00a0/g, ' ').trim()
      .split(/\n/).map(line => withoutBadge(line.trim())).filter(line => line && line !== badge).join('\n');
    const image = card.querySelector('img.s-image');
    const imageUrl = image?.getAttribute('src');
    const imageFallback = image?.getAttribute('data-src') || image?.getAttribute('data-old-hires');
    const ratingNode = card.querySelector('[aria-label*="out of 5 stars"], .a-icon-alt');
    const reviewsNode = card.querySelector('a[href*="customerReviews"] .a-size-base, a[href*="customerReviews"]');
    return {
      asin: card.dataset.asin || '',
      title: title || 'Amazon listing',
      url: toAbsoluteUrl(linkNode?.getAttribute('href')),
      image: toAbsoluteUrl(imageUrl && !imageUrl.startsWith('data:') ? imageUrl : imageFallback || imageUrl),
      listingPrice: getPrice(card),
      rating: (ratingNode?.getAttribute('aria-label') || ratingNode?.textContent || '').trim(),
      reviews: (reviewsNode?.innerText || reviewsNode?.textContent || '').trim(),
      bought: text.match(/\b[\d,.]+\s*(?:K\+?\s*)?bought in past month\b/i)?.[0] || '',
      sponsored: /\bsponsored\b/i.test(text.slice(0, 200)),
      pageNumber,
      details: text.split(/\n+/).map(line => line.trim()).filter(Boolean)
        .filter((line, index, lines) => lines.indexOf(line) === index).slice(0, 45).join('\n').slice(0, 2600),
    };
  }

  // ------------------------------------------------------------------ scores
  // asin -> { score, verdict, source }, from this computer only: the weighted score, else the product
  // data read earlier, scored under the current settings.
  async function knownScores(asins) {
    const { cacheKey, usableCache, storeHost, unreadable, state, cacheScore } = P();
    const C = root.AIR.db.productCache;
    const localKey = asin => C.localKey(storeHost(), asin);
    const got = await storageGet(asins.flatMap(a => [cacheKey(a), localKey(a)]));
    const out = new Map();
    for (const asin of asins) {
      const hit = got[cacheKey(asin)];
      if (usableCache(hit, asin)) { out.set(asin, { score: hit.score, verdict: hit.verdict, source: 'scored' }); continue; }
      const row = C.sanitize(got[localKey(asin)]);
      if (!row || C.stale(row)) continue;
      if (row.status === 'not-food' || row.data.food === false) { out.set(asin, { score: null, source: 'not-food' }); continue; }
      if (row.status === 'unreadable') { out.set(asin, { score: null, source: 'unreadable' }); continue; }
      const result = root.AIR.engine.score(C.toInput(row), state.prefs);
      if (unreadable(result)) { out.set(asin, { score: null, source: 'unreadable' }); continue; }
      cacheScore(asin, result, row.data.title, row.data.via || 'search-tile', '', Date.parse(row.scanned_at));
      out.set(asin, { score: result.score, verdict: result.verdict, source: 'scored' });
    }
    return out;
  }

  function withScores(products, scores) {
    return products.map(p => ({ ...p, ...(scores.get(p.asin) || { score: null, verdict: '', source: 'unrated' }) }));
  }

  // This page's cards without a score go through search.js exactly as the badges do (cache, shared
  // database, then the paced product-page queue). Resolves once that queue has gone quiet.
  async function rateThisPage(cards, token) {
    const search = S();
    const items = cards.filter(card => !/^\d+$/.test(card.querySelector('.air-badge')?.textContent || ''))
      .map(card => ({ tile: card, asin: card.dataset.asin }));
    if (!items.length) return;
    search.resolveTiles(items, it => search.enqueue(it.tile, it.asin));
    const started = Date.now();
    let quiet = 0;
    while (token === run && Date.now() - started < RATE_WAIT_MS) {
      await sleep(300);
      const q = search.queue;
      quiet = !q.active && !q.pending.length ? quiet + 1 : 0;
      if (quiet >= 3 || q.throttled) break;
      const done = items.filter(it => it.tile.querySelector('.air-badge')?.textContent?.match(/^\d+$|^\?$/)).length;
      setStatus(t('sortRating', 'Rating listings without a score ($1 done)…', done));
    }
  }

  // ------------------------------------------------------------------ moving cards (from the Cost Sorter)
  function getSortableUnits(cards) {
    if (!cards.length) return null;
    const mainSlot = cards[0].closest('.s-main-slot');
    if (mainSlot && cards.every(card => mainSlot.contains(card))) {
      const units = cards.map(card => {
        let unit = card;
        while (unit.parentElement && unit.parentElement !== mainSlot) unit = unit.parentElement;
        return unit.parentElement === mainSlot ? unit : null;
      });
      if (units.every(Boolean) && new Set(units).size === units.length && units.every(unit => {
        const count = (unit.matches(CARD) ? 1 : 0) + unit.querySelectorAll(CARD).length;
        return count === 1;
      })) return { container: mainSlot, units };
    }
    const parent = cards[0].parentElement;
    if (parent && cards.every(card => card.parentElement === parent)) return { container: parent, units: cards.slice() };
    return null;
  }

  function moveUnitsInSlots(topology, orderedUnits) {
    if (!topology || orderedUnits.length !== topology.units.length) return false;
    const { container, units } = topology;
    if (units.some(unit => unit.parentElement !== container) || new Set(orderedUnits).size !== units.length) return false;
    const markers = units.map(unit => {
      const marker = document.createComment('air-sort-slot');
      unit.replaceWith(marker);
      return marker;
    });
    markers.forEach((marker, index) => marker.replaceWith(orderedUnits[index]));
    return true;
  }

  // -> { ok, products, reason }. Rates this page first when the settings allow, then moves the cards.
  async function sortCurrentPage(settings, token) {
    const { state } = P();
    let cards = scanCards();
    if (!cards.length) return { ok: false, reason: t('sortNoCards', 'No Amazon product cards were found on this page.') };
    if (settings.sortMissing === 'rate-first' && state.autoScoreSearch) await rateThisPage(cards, token);
    if (token !== run) return { ok: false, cancelled: true };
    cards = scanCards();
    const scores = await knownScores(cards.map(c => c.dataset.asin));
    const products = withScores(cards.map(card => extractProduct(card)), scores);
    const entries = cards.map((card, i) => ({ card, product: products[i] }));
    const order = R().sortByScore(entries.map((e, i) => ({ ...e.product, _i: i, score: e.product.score })));
    const ordered = order.map(p => entries[p._i]);
    const topology = getSortableUnits(cards);
    const clean = ordered.map(e => e.product);
    if (!topology) return { ok: false, products: clean, reason: t('sortCannotMove', 'Amazon’s result cards are arranged in a way that cannot be safely reordered here.') };
    return moveUnitsInSlots(topology, ordered.map(e => topology.units[cards.indexOf(e.card)]))
      ? { ok: true, count: ordered.length, products: clean }
      : { ok: false, products: clean, reason: t('sortCouldNotMove', 'Amazon’s result cards could not be moved safely.') };
  }

  function restoreCurrentPage() {
    const cards = scanCards();
    const topology = getSortableUnits(cards);
    if (!topology) return false;
    const ordered = cards.slice().sort((left, right) => originalOrder.get(left) - originalOrder.get(right));
    return moveUnitsInSlots(topology, ordered.map(card => topology.units[cards.indexOf(card)]));
  }

  // ------------------------------------------------------------------ load more
  function findNextPage(doc, currentUrl) {
    const next = doc.querySelector('a.s-pagination-next[href]');
    if (!next || next.classList.contains('s-pagination-disabled') || next.getAttribute('aria-disabled') === 'true') return null;
    try {
      const url = new URL(next.getAttribute('href'), currentUrl);
      return url.origin === location.origin ? url.href : null;
    } catch { return null; }
  }

  const productCardsIn = doc => [...doc.querySelectorAll(CARD)].filter(isCard);

  // Shared-database rows for listings this computer has not read, scored here under this reader's
  // settings; counts one pull per row used, as the badges do.
  async function sharedScores(asins, token) {
    const { storeHost, unreadable, state, cacheScore, rememberProduct } = P();
    const C = root.AIR.db.productCache;
    const out = new Map();
    const pulls = [];
    for (let i = 0; i < asins.length && token === run; i += LOOKUP_BATCH) {
      const reply = await send({ type: 'productsLookup', store: storeHost(), asins: asins.slice(i, i + LOOKUP_BATCH) });
      for (const [asin, raw] of Object.entries((reply && reply.rows) || {})) {
        const row = C.sanitize(raw);
        if (!row || !asins.includes(asin)) continue;
        rememberProduct(asin, row, { share: false });
        pulls.push({ key: row.key, scanned_at: row.scanned_at });
        if (row.status === 'not-food' || row.data.food === false) { out.set(asin, { score: null, source: 'not-food' }); continue; }
        if (row.status === 'unreadable') { out.set(asin, { score: null, source: 'unreadable' }); continue; }
        const result = root.AIR.engine.score(C.toInput(row), state.prefs);
        if (unreadable(result)) { out.set(asin, { score: null, source: 'unreadable' }); continue; }
        cacheScore(asin, result, row.data.title, row.data.via || 'search-tile', '', Date.parse(row.scanned_at));
        out.set(asin, { score: result.score, verdict: result.verdict, source: 'scored' });
      }
    }
    if (pulls.length) send({ type: 'productsQueue', pulls });
    return out;
  }

  // Product pages for listings still without a score: three at a time, a short gap between starts,
  // stopped by the Stop button, the master switch, or Amazon refusing FAIL_LIMIT times in a row.
  async function rateByProductPage(asins, token, onProgress) {
    const search = S();
    const out = new Map();
    let next = 0, done = 0, failStreak = 0, lastStart = 0, stopped = '';
    async function worker() {
      while (next < asins.length && token === run && !stopped && P().state.enabled) {
        const asin = asins[next++];
        const wait = Math.max(0, lastStart + REQUEST_GAP_MS - Date.now());
        lastStart = Date.now() + wait;
        if (wait) await sleep(wait);
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const signal = AbortSignal.any ? AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) : controller.signal;
          const res = await fetch(`/dp/${asin}`, { credentials: 'same-origin', signal });
          if (!res.ok) throw Object.assign(new Error(String(res.status)), { httpStatus: res.status });
          const html = await res.text();
          if (token !== run) return;
          const reading = search.readProductHtml(asin, html);
          search.recordReading(asin, reading, 'sort-list');
          out.set(asin, reading.outcome === 'scored'
            ? { score: reading.result.score, verdict: reading.result.verdict, source: 'scored' }
            : { score: null, source: reading.outcome === 'not-food' ? 'not-food' : 'unreadable' });
          failStreak = 0;
        } catch (e) {
          if (e && typeof e.httpStatus === 'number' && e.httpStatus >= 400 && ++failStreak >= FAIL_LIMIT) {
            stopped = t('sortThrottled', 'Amazon stopped answering product pages, so rating paused.');
          }
        } finally {
          controllers.delete(controller);
          done++;
          onProgress(done, asins.length);
        }
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
    return { scores: out, stopped };
  }

  async function onLoadMore() {
    const token = ++run;
    const settings = await getSettings();
    showLoading(true);
    const current = await sortCurrentPage(settings, token);
    if (token !== run) return;
    if (current.ok) { sorted = true; show('.restore', true); }
    resultData = current.products || [];
    if (!resultData.length) { showLoading(false); setStatus(t('sortNothingToLoad', 'No product listings were found to load.')); return; }
    setStatus(t('sortLoadingUpTo', 'Sorted this page. Loading up to $1 products…', settings.sortCount));

    const results = new Map(resultData.map(p => [p.asin || p.url, p]));
    const extra = [];
    let nextUrl = findNextPage(document, location.href);
    let pageNumber = 1;
    let partialError = '';
    while (results.size < settings.sortCount && nextUrl && token === run) {
      pageNumber += 1;
      setStatus(t('sortLoadingPage', 'Loading Amazon results page $1 ($2 products found)…', pageNumber, results.size));
      try {
        await sleep(REQUEST_GAP_MS);
        const response = await fetch(nextUrl, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
        if (!response.ok) throw new Error(`Amazon returned ${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const cards = productCardsIn(doc);
        if (!cards.length) throw new Error('no product cards on the next page');
        for (const card of cards) {
          const product = extractProduct(card, pageNumber);
          const key = product.asin || product.url;
          if (!results.has(key)) { results.set(key, product); extra.push(product); }
          if (results.size >= settings.sortCount) break;
        }
        nextUrl = findNextPage(doc, nextUrl);
      } catch (error) {
        partialError = error.message || 'Amazon could not load another results page.';
        break;
      }
    }
    if (token !== run) return;

    // Scores for the listings from further pages: this computer, the shared database, then pages.
    let asins = extra.map(p => p.asin).filter(Boolean);
    const scores = await knownScores(asins);
    asins = asins.filter(a => !scores.has(a));
    for (const [a, s] of await sharedScores(asins, token)) scores.set(a, s);
    asins = asins.filter(a => !scores.has(a));
    let stopped = '';
    const { state } = P();
    if (asins.length && settings.sortMissing === 'rate-first' && state.autoScoreSearch && token === run) {
      const rated = await rateByProductPage(asins, token, (done, total) =>
        setStatus(t('sortRatingMore', 'Rating listings without a score: $1 of $2…', done, total)));
      for (const [a, s] of rated.scores) scores.set(a, s);
      stopped = rated.stopped;
    }
    if (token !== run) return;
    const scoredExtra = new Map(withScores(extra, scores).map(p => [p.asin || p.url, p]));
    resultData = R().sortByScore([...results.values()].map(p => scoredExtra.get(p.asin || p.url) || p));
    showLoading(false);
    show('.open', true);
    const unscored = resultData.filter(p => p.score == null).length;
    const tail = unscored ? ' ' + unscoredTail(unscored) : '';
    if (stopped) setStatus(`${stopped} ${t('sortCollected', 'Collected $1 products.', resultData.length)}${tail}`);
    else if (partialError) setStatus(`${t('sortCollected', 'Collected $1 products.', resultData.length)} ${t('sortPartial', 'More results could not be loaded')} (${partialError}).${tail}`);
    else if (resultData.length >= settings.sortCount) setStatus(`${t('sortCollected', 'Collected $1 products.', resultData.length)} ${t('sortOpenCombined', 'Open the sorted list; listings from other pages are only in that list.')}${tail}`);
    else setStatus(`${t('sortNoMore', 'Amazon has no more results.')} ${t('sortCollected', 'Collected $1 products.', resultData.length)}${tail}`);
  }

  // ------------------------------------------------------------------ toolbar
  async function getSettings() {
    return R().sanitizeSort(await storageGet(Object.keys(R().SORT_DEFAULTS)));
  }

  function setStatus(message) {
    if (toolbar) toolbar.root.querySelector('.status').textContent = message;
  }
  function show(selector, visible) {
    if (toolbar) toolbar.root.querySelector(selector).hidden = !visible;
  }
  function showLoading(on) {
    show('.stop', on);
    for (const sel of ['.sort', '.load']) {
      const b = toolbar && toolbar.root.querySelector(sel);
      if (b) b.disabled = on;
    }
  }

  async function onSort() {
    const token = ++run;
    const settings = await getSettings();
    showLoading(true);
    const result = await sortCurrentPage(settings, token);
    if (token !== run || result.cancelled) return;
    showLoading(false);
    resultData = result.products || [];
    show('.open', resultData.length > 0);
    if (!result.ok) {
      setStatus(resultData.length ? `${result.reason} ${t('sortOpenInstead', 'Open a sorted list instead.')}`
        : t('sortNoCardsHelp', 'No Amazon product cards were found. Check that this is a search results page, then refresh after listings load.'));
      return;
    }
    sorted = true;
    show('.restore', true);
    const unscored = resultData.filter(p => p.score == null).length;
    const offNote = settings.sortMissing === 'rate-first' && !P().state.autoScoreSearch && unscored
      ? ' ' + t('sortAutoOff', '“Rate every search result” is off, so nothing was rated for this sort.') : '';
    setStatus(t('sortSorted', 'Sorted $1 listings by score, best first.', result.count)
      + (unscored ? ' ' + unscoredTail(unscored) : '') + offNote);
  }

  function onRestore() {
    run++;
    const restored = restoreCurrentPage();
    sorted = sorted && !restored;
    setStatus(restored ? t('sortRestored', 'Original Amazon result order restored.')
      : t('sortRestoreGone', 'The original order is no longer available on this page.'));
    show('.restore', !restored);
  }

  function onStop() {
    run++;
    for (const c of controllers) c.abort();
    controllers.clear();
    showLoading(false);
    if (resultData.length) show('.open', true);
    setStatus(t('sortStopped', 'Stopped. Listings sorted so far stay as they are.'));
  }

  async function openSortedResults() {
    if (!resultData.length) return;
    const reply = await send({ type: 'openSortedResults', results: R().sortByScore(resultData), sourceUrl: location.href });
    setStatus(reply && reply.ok ? t('sortOpened', 'Opened the sorted list in a new tab.')
      : t('sortOpenFailed', 'Could not open the sorted list.'));
  }

  async function refreshToolbarSettings() {
    const settings = await getSettings();
    show('.load', settings.sortLoadMore);
  }

  function createToolbar() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:relative;z-index:2147483000;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host{all:initial;font-family:"Amazon Ember",Arial,sans-serif;color:#0f1111}
        .bar{box-sizing:border-box;display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:14px 0;padding:12px 14px;background:#f0faf4;border:1px solid #b9dcc6;border-radius:8px;color:#0f1111;font:13px/1.4 "Amazon Ember",Arial,sans-serif}
        .brand{font-weight:700;margin-right:4px}.status{flex:1 1 180px;color:#3d4a44;min-width:120px}
        button{appearance:none;border:1px solid #9fb8a8;border-radius:6px;background:#fff;color:#0f1111;padding:7px 10px;font:600 12px "Amazon Ember",Arial,sans-serif;cursor:pointer}
        button:hover{background:#e6f2ea}button.primary{background:#0f7b3f;color:#fff;border-color:#0f7b3f}button.primary:hover{background:#0b6433}
        button:disabled{opacity:.55;cursor:default}
        button:focus-visible{outline:3px solid #007185;outline-offset:2px}[hidden]{display:none!important}
      </style>
      <section class="bar">
        <span class="brand"></span>
        <button class="primary sort" type="button"></button>
        <button class="restore" type="button" hidden></button>
        <button class="load" type="button" hidden></button>
        <button class="stop" type="button" hidden></button>
        <button class="open" type="button" hidden></button>
        <button class="settings" type="button"></button>
        <span class="status" role="status" aria-live="polite"></span>
      </section>`;
    // Labels as text, never markup: they may come from a locale file.
    const label = (sel, key, fallback) => { shadow.querySelector(sel).textContent = t(key, fallback); };
    label('.brand', 'sortBrand', 'Sort by Ingredient Check score');
    label('.sort', 'sortButton', 'Sort results');
    label('.restore', 'sortRestore', 'Restore order');
    label('.load', 'sortLoadMore', 'Load more results');
    label('.stop', 'sortStop', 'Stop');
    label('.open', 'sortOpen', 'Open sorted list');
    label('.settings', 'sortSettings', 'Settings');
    label('.status', 'sortReady', 'Ready to sort these results by score.');
    shadow.querySelector('.bar').setAttribute('aria-label', t('sortBrand', 'Sort by Ingredient Check score'));
    const anchor = document.querySelector('.s-main-slot') || document.querySelector('#search');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
    else document.body.insertBefore(host, document.body.firstChild);
    shadow.querySelector('.sort').addEventListener('click', onSort);
    shadow.querySelector('.restore').addEventListener('click', onRestore);
    shadow.querySelector('.load').addEventListener('click', onLoadMore);
    shadow.querySelector('.stop').addEventListener('click', onStop);
    shadow.querySelector('.open').addEventListener('click', openSortedResults);
    shadow.querySelector('.settings').addEventListener('click', () => send({ type: 'openSortSettings' }));
    toolbar = { host, root: shadow };
    refreshToolbarSettings();
    return toolbar;
  }

  let settingsWired = false;
  function wireSettings() {
    if (settingsWired) return;
    settingsWired = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      if (changes.sortLoadMore || changes.sortCount) refreshToolbarSettings();
    });
  }

  // Called by main.js once a food results page has its badges. Idempotent.
  function mount() {
    const { state } = P();
    if (!state.enabled || !state.badges || !isSearchPage()) return;
    if (toolbar && toolbar.host.isConnected) return;
    toolbar = null;
    scanCards();                                    // remember Amazon's order before anything moves
    wireSettings();
    createToolbar();
  }

  // Whenever Ingredient Check stands down on this page (master switch off, badges off, a non-food
  // search, navigation, a settings change): stop, put Amazon's order back, remove the toolbar.
  function unmount() {
    run++;
    for (const c of controllers) c.abort();
    controllers.clear();
    if (sorted) restoreCurrentPage();
    sorted = false;
    resultData = [];
    if (toolbar) toolbar.host.remove();
    toolbar = null;
  }

  const api = { mount, unmount, isSearchPage, extractProduct, knownScores, sortCurrentPage, restoreCurrentPage,
    findNextPage, getSortableUnits, HOST_ID, get resultData() { return resultData; } };
  root.AIR.sort = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
