// Ingredient Check's sorted list on every supported store (Walmart, Target, Costco, Instacart, the Kroger banners,
// Safeway, Albertsons): the same list, the same settings and the same behaviour as on Amazon.
//
// It is src/content/sort.js moved onto the retailer adapters' shared interface (searchTiles, readListing, productUrl),
// so one file serves every store and the two cannot drift. Amazon puts two entries into its own Sort by menu; a
// retailer's menu is a React widget this extension cannot safely extend, so the page gets one "Ingredient Check sort"
// button that offers the same two entries with the same wording:
//   "Ingredient Check score: High to Low"   and   "Price per <unit>: Low to High"
// Choosing one never reorders the store's page. It opens Chrome's side panel (a tab where Chrome will not) with this
// search's listings ranked there, by the same extension page Amazon uses (src/options/sorted.js): priorities,
// units, "why it scored" notes on hover, Stop, back-to-search.
//
// The list fills in as it goes, in Amazon's order:
//   1. the listings on this page, with the scores this computer already holds (and the reasons behind them);
//   2. when "Load more results" is on (Settings > Search and unit-price sorting), further results pages, until the
//      reader's count is reached or their time limit is up;
//   3. when the sort setting and automatic rating allow, the product pages of listings still without a score,
//      through the runner's own reader (retailer.js readProductScore), a few at a time, one request per product,
//      stopped by Stop, the master switch, the store refusing, or the per-page budget.
// Nothing here fetches what the badges would not, and nothing leaves the browser.
//
// How further pages are read, for a store whose results are not in the page's HTML (Target, Instacart and the
// Kroger banners build them with scripts): the page is fetched first, as Amazon's are, through the shared page reader
// (AIR.cart.publicDocument: one size cap, one abort rule, one block-page test). When that holds no results the same
// address is rendered in a hidden same-origin frame, the way the shopper's own browser would show it, and read there;
// when the store gives no next-page address at all, the live page is scrolled to make it load more, and put back.
// All three are limited to the reader's count and time limit, and stop when the store shows a challenge page.

(function (root) {
  root.AIR = root.AIR || {};
  const adapter = Object.values(root.AIR.storeAdapters || {}).find(a => a.matchesHost && a.matchesHost(location.hostname));
  if (!adapter || typeof adapter.searchTiles !== 'function') return;
  const R = () => root.AIR.db.sortedResults;
  const U = () => root.AIR.db.unitPrice;
  const runner = () => root.AIR.retailerRunner;     // set by retailer.js, which loads after this file
  const storeName = adapter.name || 'this store';
  // The storefront used to read prices and sizes: the store's own formats, else the default (US dollars, ounces).
  const priceStore = adapter.storeHost || location.hostname.replace(/^www\./, '');

  const MARK = 'air-retailer-sort';
  const PUBLISH_GAP_MS = 700;
  const PAGE_TIMEOUT_MS = 15000;
  const FRAME_TIMEOUT_MS = 12000;
  const REQUEST_GAP_MS = 400;
  const CONCURRENT = 2;
  const MAX_PAGES = 30;

  let host, shadow, button, menu;
  let active = false, mounted = false, pending = false, run = 0, runId = null, listening = false, outside = false, followedURL = '';
  let lastTiles = [], unitHeld = { sig: '', unit: null }, unitOn = true;
  const controllers = new Set();
  let unitSettings = {};

  const t = (key, fallback, ...subs) => {
    const args = subs.map(String);
    let text = '';
    try { text = (chrome.i18n && chrome.i18n.getMessage(key, args)) || ''; } catch (e) { /* no locale */ }
    return text || fallback.replace(/\$(\d)/g, (m, n) => (args[n - 1] != null ? args[n - 1] : m));
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const storageGet = keys => new Promise(resolve => {
    try { chrome.storage.local.get(keys, o => { void chrome.runtime.lastError; resolve(o || {}); }); }
    catch (e) { resolve({}); }
  });
  const send = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, r => { void chrome.runtime.lastError; resolve(r); }); }
    catch (e) { resolve(undefined); }
  });
  const unscoredTail = n => (n === 1 ? t('sortUnscoredTailOne', '1 without a score is at the end.')
    : t('sortUnscoredTail', '$1 without a score are at the end.', n));
  const logAction = (where, what) => send({ type: 'logAction', where, what });

  // ------------------------------------------------------------------ one listing
  // The listing as the sorted list shows it, from the store's own card. The score is added by the caller.
  // The card around a listing. Most adapters return it; a few return only the product's link, whose price sits in the
  // wrapper around it, so climb to the widest wrapper that still holds nothing but this product.
  function cardOf(tile) {
    let card = tile.el || tile.tile || tile.anchor;
    let depth = 0;
    for (let up = card.parentNode; up && up.nodeType === 1 && depth < 5; depth++, up = up.parentNode) {
      if (/^(?:BODY|HTML|MAIN|UL|OL|NAV|SECTION|FORM|ASIDE|HEADER|FOOTER)$/.test(up.tagName)) break;
      const ids = new Set(Array.from(up.querySelectorAll('a[href]')).map(a => adapter.productId(a.getAttribute('href'))).filter(Boolean));
      if (ids.size !== 1 || !ids.has(tile.id)) break;
      card = up;
    }
    return card;
  }
  function facts(tile) {
    if (typeof adapter.readListing === 'function') return adapter.readListing(tile);
    const L = root.AIR.retailerLabels, card = cardOf(tile);
    // Pictures: the store's own site, and the CDNs the registry names for it; the worker checks them again.
    const store = root.AIR.stores && root.AIR.stores.storeForHost(location.hostname);
    const hosts = store ? [...store.domains, ...(store.images || [])].map(d => d.replace(/\./g, '\\.')) : [];
    return { ...L.listingFacts(card, { imageHost: hosts.length ? new RegExp(`(?:^|\\.)(?:${hosts.join('|')})$`, 'i') : null }), sponsored: false };
  }
  function extractProduct(tile, pageNumber = 1, settings = {}) {
    const f = facts(tile);
    const unit = settings.unitPrice === false ? { unitPrice: null, unitSource: 'none', unitKind: '', unitId: '', unitPrices: {}, unitSources: {} }
      : U().unitPricesFor({ title: tile.title, text: f.unitText, listingPrice: f.listingPrice }, settings, priceStore);
    return {
      asin: tile.id, title: tile.title, url: root.AIR.retailerLabels.listingProductUrl(adapter, tile.id, location, tile.url), image: f.image || '',
      listingPrice: f.listingPrice, ...unit,
      rating: f.ratingValue != null ? `${f.ratingValue} out of 5 stars` : '', ratingValue: f.ratingValue,
      reviews: f.reviewCount != null ? String(f.reviewCount) : '', reviewCount: f.reviewCount,
      bought: '', sponsored: f.sponsored === true, pageNumber,
    };
  }
  // The tiles currently on the page, in the store's own order.
  const pageTiles = () => { try { return adapter.searchTiles(document); } catch (e) { return []; } };

  // ------------------------------------------------------------------ the menu
  const unitName = id => { const u = U().UNIT_CHOICES.find(c => c.id === id); return u ? t(`unitName_${id}`, u.long) : id; };
  // The unit most of this page's listings already show, worked out from the cards before anything is fetched.
  function menuUnit() {
    const tiles = lastTiles.length ? lastTiles : pageTiles();
    const sig = tiles.map(tile => tile.id).join(',');
    if (unitHeld.sig === sig) return unitHeld.unit;
    const likely = U().likelyUnit(tiles.map(tile => extractProduct(tile, 1, unitSettings)), 'us');
    unitHeld = { sig, unit: likely ? likely.unit : null };
    return unitHeld.unit;
  }
  const labels = () => ({
    health: t('sortMenuScore', 'Ingredient Check score: High to Low'),
    unitPrice: t('sortMenuUnitPer', 'Price per $1: Low to High', unitName(menuUnit() || U().defaultUnit('weight', 'us'))),
  });
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  function closeMenu(focus) {
    if (!menu || menu.hidden) return;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  }
  function openMenu() {
    const names = labels();
    for (const item of menu.querySelectorAll('[data-mode]')) {
      item.textContent = names[item.dataset.mode];
      // Amazon's menu drops the price entry while unit prices are switched off in the popup; so does this one.
      item.hidden = item.dataset.mode === 'unitPrice' && !unitOn;
    }
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    menu.querySelector('button:not([hidden])').focus({ preventScroll: true });
  }
  function mount() {
    if (host?.isConnected || !active) return;
    host = el('div'); host.id = MARK;
    shadow = host.attachShadow({ mode: 'open' });
    const css = el('style');
    css.textContent = ':host{display:block;font:14px/1.4 system-ui,sans-serif;color:#18221d}*{box-sizing:border-box}[hidden]{display:none!important}'
      + 'button{font:inherit;cursor:pointer;background:#fff;color:#17492d;border:1px solid #9dad9f;padding:9px 12px}'
      + 'button:hover,button:focus-visible{outline:2px solid #257747;outline-offset:2px}'
      + '.toggle{position:fixed;right:0;top:44%;z-index:2147482900;border-radius:12px 0 0 12px;box-shadow:0 2px 12px #0003;font-weight:700;max-width:150px}'
      + '.menu{position:fixed;right:12px;top:calc(44% + 52px);z-index:2147482901;width:min(300px,calc(100vw - 24px));margin:0;padding:6px;background:#fff;border:1px solid #c9d4cc;border-radius:14px;box-shadow:0 8px 32px #0003;display:flex;flex-direction:column;gap:4px}'
      + '.menu button{border:0;border-radius:10px;text-align:left;padding:10px 12px;font-weight:600;background:transparent}.menu button:hover{background:#e8f2ec}'
      + '.note{margin:2px 8px 6px;font-size:12px;color:#536158}'
      + '@media (prefers-color-scheme:dark){:host{color:#f3f3f3}button{background:#232525;color:#e5eee8;border-color:#656d68}'
      + 'button:hover,button:focus-visible{outline-color:#8dc8a3}.menu{background:#232525;border-color:#656d68}'
      + '.menu button:hover{background:#343c37}.note{color:#c0c9c3}}';
    shadow.append(css);
    button = el('button', t('sortMenuButton', 'Ingredient Check sort'), 'toggle');
    button.type = 'button'; button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu(true)));
    menu = el('div', null, 'menu'); menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('sortMenuButton', 'Ingredient Check sort'));
    for (const mode of ['unitPrice', 'health']) {
      const item = el('button', '', null); item.type = 'button'; item.dataset.mode = mode; item.setAttribute('role', 'menuitem');
      // Runs inside the click: the message goes out before any await, so Chrome still counts the click and opens the panel.
      item.addEventListener('click', () => { closeMenu(false); choose(mode); });
      menu.append(item);
    }
    menu.addEventListener('keydown', event => {
      const items = [...menu.querySelectorAll('button')], at = items.indexOf(shadow.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length].focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    });
    shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); } });
    if (!outside) {
      outside = true;
      document.addEventListener('pointerdown', event => { if (host && menu && !menu.hidden && !event.composedPath().includes(host)) closeMenu(false); }, true);
    }
    shadow.append(button, menu);
    document.body.append(host);
    root.AIR.db.theme?.force(shadow);
  }
  function unmount() {
    mounted = false; pending = false; run++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    host?.remove(); host = null;
  }

  // ------------------------------------------------------------------ choosing
  function choose(mode) {
    if (pending) return;
    pending = true;
    const token = ++run;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    logAction('sort menu', `${storeName}: chose ${mode === 'unitPrice' ? 'Unit price' : 'Ingredient Check score'} on ${location.pathname}`);
    send({ type: 'openSortedPanel', mode, sourceUrl: location.href, priceOnly: false, unitEnabled: true }).then(async reply => {
      pending = false;
      if (token !== run || !reply || !reply.runId) return;
      runId = reply.runId;
      // No side panel (an older Chrome, or the click no longer counted): the same list in a tab.
      if (!reply.ok) {
        logAction('sort menu', `side panel did not open (${reply.reason || 'unknown'}); opened a tab`);
        send({ type: 'openSortedTab' });
      }
      await gather(token);
    });
  }
  // Never leave the panel on "Reading listings…": say what went wrong.
  async function gather(token) {
    try { await collect(token); }
    catch (e) {
      publish(token, [], false, t('sortFailedStore', 'Could not read this results page ($2). Refresh the $1 page and choose the option again.',
        storeName, String((e && e.message) || e).slice(0, 120)), true);
    }
  }
  // The keyboard shortcut (background.js sortFromCommand) has already opened the panel and made the list.
  function startFromCommand(msg) {
    for (const controller of controllers) controller.abort();
    controllers.clear();
    const token = ++run;
    runId = msg.runId;
    logAction('keyboard shortcut', `${storeName}: sorted ${msg.mode === 'unitPrice' ? 'by unit price' : 'by Ingredient Check score'} on ${location.pathname}`);
    return gather(token);
  }

  // ------------------------------------------------------------------ scores
  // Why a listing scored what it did: the rows the product panel and the hover card show, trimmed to what the list needs.
  const WHY_ROWS = 8;
  function whyOf(result) {
    const panel = root.AIR.panel;
    if (!result || !panel || typeof panel.sections !== 'function') return null;
    const { caps, minus, plus, neutral } = panel.sections(result);
    const row = h => ({ c: h.c === 'CAP' ? 'CAP' : Math.round(Number(h.c) || 0), why: String(h.why || '').slice(0, 140), ing: h.ing ? String(h.ing).slice(0, 80) : '' });
    return { caps: caps.slice(0, WHY_ROWS).map(row), plus: plus.slice(0, WHY_ROWS).map(row), minus: minus.slice(0, WHY_ROWS).map(row), neutral: neutral.slice(0, 3).map(row) };
  }
  const servingsFor = input => (input && U() && U().servingsOf(input.nutrition)) || null;
  function scoreRow(hit, prefs) {
    const { score, verdict, category = 'food', ratingStyle = 'food', input } = hit;
    const assessed = input && root.AIR.engine.score(input, prefs);
    const matches = assessed && root.AIR.engine.isReadable(assessed) && assessed.score === score;
    const why = matches ? whyOf(assessed) : null;
    // Retailer cache entries written before shopping evidence loaded here can still carry a full label.
    const evidence = hit.evidence || (matches ? root.AIR.db.shopping?.evidence(assessed, { source: hit.source, capturedAt: hit.t, prefs }) : null);
    return { score, evidence, verdict, category, ratingStyle, source: 'scored', why, servings: servingsFor(input) };
  }
  // id -> { score, verdict, source, why }, from this computer only: a saved score still valid under the current
  // settings (with the reasons, re-worked from the reading behind it), or the outcome the badges already found.
  async function knownScores(ids) {
    const { CACHE, STORE, VERSION, state } = runner();
    const out = new Map();
    if (!ids.length) return out;
    const got = await CACHE.readLocal(ids.map(id => CACHE.key(STORE, id)), state.raw, null, chrome.storage);
    for (const id of ids) {
      const hit = got && got[CACHE.key(STORE, id)];
      const saved = CACHE.recall(hit, { store: STORE, asin: id, version: VERSION, prefs: state.raw, maxAgeMs: state.maxAgeMs });
      if (saved && !saved.refresh && Number.isFinite(hit.score)) {
        out.set(id, scoreRow(hit, state.prefs));
        continue;
      }
      const seen = state.requests.get(id);
      if (seen?.hit && Number.isFinite(seen.hit.score)) out.set(id, scoreRow(seen.hit, state.prefs));
      else if (seen?.status === 'not-food') out.set(id, { score: null, source: 'not-food' });
      else if (seen?.status === 'unavailable') out.set(id, { score: null, source: 'unreadable' });
    }
    return out;
  }

  // Product pages for listings still without a score, through the runner's reader: a few at a time, one request per
  // product, one throttle flag shared with the badges, one budget per results page in the list.
  async function rateByProductPage(ids, products, token, onProgress, budget, timeUp) {
    const { state, readProductScore } = runner();
    const out = new Map();
    let next = 0, done = 0, stopped = '', fetches = 0, lastStart = 0;
    const halted = () => token !== run || !!stopped || !state.enabled || timeUp();
    const throttled = () => t('sortThrottledStore', '$1 stopped answering product pages, so rating paused.', storeName);
    async function worker() {
      while (next < ids.length && !halted()) {
        if (state.throttled) { stopped = throttled(); break; }
        if (fetches >= budget()) { stopped = t('sortBudgetStore', 'Rating stopped at $2 product pages, the limit for the $1 results pages in this list.', storeName, budget()); break; }
        const id = ids[next++];
        const seen = state.requests.get(id);
        // A product the badges already read costs nothing more.
        if (seen && seen.status !== 'checking') {
          if (seen.hit) out.set(id, scoreRow(seen.hit, state.prefs));
          else out.set(id, { score: null, source: seen.status === 'not-food' ? 'not-food' : 'unreadable' });
          done++; onProgress(done, ids.length, out); continue;
        }
        fetches++;
        const wait = Math.max(0, lastStart + REQUEST_GAP_MS - Date.now());
        lastStart = Date.now() + wait;
        if (wait) await sleep(wait);
        if (halted()) break;
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
        try {
          const reading = await readProductScore(id, controller.signal, () => token === run && state.enabled, products.get(id)?.url);
          if (token !== run) return;
          if (!reading) continue;
          if (reading.hit) {
            state.requests.set(id, { hit: reading.hit });
            out.set(id, scoreRow(reading.hit, state.prefs));
          } else { state.requests.set(id, { status: 'not-food' }); out.set(id, { score: null, source: 'not-food' }); }
        } catch (e) {
          // Refused, offline, aborted or unreadable: the listing stays without a score.
          if (e && e.message === 'blocked') state.throttled = true;
          if (token === run) { state.requests.set(id, { status: 'unavailable' }); out.set(id, { score: null, source: 'unreadable' }); }
        } finally {
          clearTimeout(timer); controllers.delete(controller);
          done++; onProgress(done, ids.length, out);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENT }, worker));
    if (!stopped && state.throttled) stopped = throttled();
    return { scores: out, stopped, timedOut: !stopped && timeUp() };
  }

  // ------------------------------------------------------------------ further results pages
  // The page's own link to its next page: rel="next", or a link named "Next" / "Next page" that is not disabled.
  function findNextLink(doc, currentUrl) {
    const named = a => /^(?:next(?:\s+page)?|›|»|>)$/i.test((a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim());
    for (const a of doc.querySelectorAll('a[href]')) {
      if (!(/(?:^|\s)next(?:\s|$)/i.test(a.getAttribute('rel') || '') || named(a))) continue;
      if (a.getAttribute('aria-disabled') === 'true' || a.hasAttribute('disabled')) continue;
      try {
        const url = new URL(a.getAttribute('href'), currentUrl);
        if (url.origin === location.origin && url.href !== currentUrl && (adapter.isSearchPage(url) || adapter.isBrowsePage?.(url))) return url.href;
      } catch (e) { /* not an address */ }
    }
    return null;
  }
  // How a store numbers its pages, when the page carries no link: a counter (Walmart: page=2) or an offset (Target:
  // Nao=24). Nothing is guessed for a store that has neither (the live page is scrolled instead).
  function pagedUrl(currentUrl, pageNumber, firstPageCount) {
    const paging = adapter.paging;
    if (!paging) return null;
    try {
      const url = new URL(currentUrl);
      const value = paging.offset ? pageNumber * (paging.size || firstPageCount || 24) : (paging.first ?? 1) + pageNumber;
      url.searchParams.set(paging.param, String(value));
      return url.href;
    } catch (e) { return null; }
  }
  // A results page rendered in a hidden same-origin frame, read before it is removed. For stores whose HTML holds no
  // results: the shopper's browser builds the page exactly as it would for a visit.
  function readInFrame(url, signal, extract) {
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.title = '';
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:1600px;border:0;opacity:0;pointer-events:none';
      let poll = 0, last = '';
      const finish = (fn, value) => {
        clearInterval(poll); clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
        frame.src = 'about:blank';
        frame.remove();
        fn(value);
      };
      const onAbort = () => finish(reject, new Error('aborted'));
      const timer = setTimeout(() => finish(resolve, []), FRAME_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort);
      frame.src = url;
      document.body.append(frame);
      poll = setInterval(() => {
        try {
          const doc = frame.contentDocument;
          if (!doc || doc.readyState === 'loading' || new URL(doc.location.href).origin !== location.origin) return;
          if (runner().publicDocument && root.AIR.cart.isChallenge(doc)) { finish(reject, Object.assign(new Error('blocked'), { blocked: true })); return; }
          const tiles = adapter.searchTiles(doc);
          const sig = tiles.map(tile => tile.id).join(',');
          // Settled: the same listings on two looks in a row.
          if (tiles.length && sig === last) finish(resolve, extract(tiles, doc));
          last = sig;
        } catch (e) { finish(reject, e); }
      }, 400);
    });
  }
  // One results page's listings, read as `extract(tiles, doc)`. The page's HTML first; when it holds no results, the
  // page rendered in a frame. Throws Error('blocked') on a challenge page.
  async function readResultsPage(url, signal, extract) {
    const response = await fetch(url, { credentials: adapter.publicCredentials === 'same-origin' ? 'same-origin' : 'omit', headers: { Accept: 'text/html' }, signal });
    if (!response.ok) { if ([403, 429, 503].includes(response.status)) throw Object.assign(new Error('blocked'), { blocked: true }); throw new Error(`${storeName} returned ${response.status}`); }
    const doc = await root.AIR.cart.publicDocument(response, signal);
    if (signal?.aborted) throw new Error('aborted');
    const tiles = adapter.searchTiles(doc);
    if (tiles.length) return { doc, items: extract(tiles, doc) };
    return { doc, items: await readInFrame(url, signal, extract) };
  }
  // A store with no way to name its next page: scroll the live page so it loads more (or press its own "show more"
  // button), then put the scroll position back.
  async function loadByScrolling(token, want, add, timeUp) {
    const start = scrollY;
    let idle = 0;
    const more = () => [...document.querySelectorAll('button, a[role="button"]')].find(b => /^(?:show|load|view|see)\s+more(?:\s+(?:results|items|products))?$/i.test((b.textContent || '').trim()) && !b.disabled);
    try {
      while (token === run && !timeUp() && idle < 2 && want() > 0) {
        const button = more();
        if (button) button.click(); else scrollTo(0, document.documentElement.scrollHeight);
        await sleep(1400);
        const fresh = add(pageTiles());
        idle = fresh ? 0 : idle + 1;
      }
    } finally { scrollTo(0, start); }
  }

  // ------------------------------------------------------------------ building the list
  async function getSettings() {
    const got = await storageGet([...Object.keys(R().SORT_DEFAULTS), ...Object.keys(U().UNIT_DEFAULTS), 'unitPrice']);
    unitSettings = U().sanitizeUnit(got);
    return { ...R().sanitizeSort(got), ...unitSettings, unitPrice: got.unitPrice !== false };
  }
  // Everything the panel shows comes through here; the worker re-checks it and keeps it in session storage.
  // One at a time and in order, so a late progress update never lands after the final list.
  let lastPublish = 0, publishing = Promise.resolve(true);
  function publish(token, items, loading, status, force = false) {
    if (token !== run) return Promise.resolve(false);
    if (!force && loading && Date.now() - lastPublish < PUBLISH_GAP_MS) return Promise.resolve(true);
    lastPublish = Date.now();
    const id = runId;
    publishing = publishing.then(async () => {
      if (token !== run) return false;
      const likely = U().likelyUnit(items, 'us');
      if (new Set(items.filter(p => Number.isFinite(p.score)).map(p => p.category || 'food')).size > 1) status = t('sortMixed', 'Mixed categories: score ranking is disabled; other priorities still apply.') + ' ' + status;
      const reply = await send({ type: 'updateSortedResults', runId: id, items, loading, status, priceOnly: false, unit: likely ? likely.unit : '' });
      // A newer sort (in this tab or another) took the panel over: stop working for this one.
      if (reply && reply.stale) { if (token === run) run++; return false; }
      return true;
    });
    return publishing;
  }
  // The store can change the address first and show the new search's results later (a soft navigation swaps the list
  // in a moment after history.pushState). Reading the cards the instant the address changed gave the panel an empty
  // list or the previous search's listings, so wait for the cards to arrive and stop changing; after READY_TIMEOUT_MS
  // whatever is there is used.
  const READY_POLL_MS = 250, READY_TIMEOUT_MS = 6000;
  let lastRead = { search: '', sig: '' };
  const signature = tiles => tiles.map(tile => tile.id).join(',');
  const searchOf = href => { try { const u = new URL(href); return u.pathname + u.search; } catch (e) { return String(href); } };
  async function listingsReady(token) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let waited = false, previous = null;
    while (token === run) {
      const sig = signature(pageTiles());
      const stale = !sig || (!!lastRead.search && lastRead.search !== searchOf(location.href) && sig === lastRead.sig);
      if (stale) waited = true;
      else if (!waited || sig === previous) return;
      else previous = sig;
      if (Date.now() >= deadline) return;
      await sleep(READY_POLL_MS);
    }
  }

  async function collect(token) {
    const settings = await getSettings();
    await listingsReady(token);
    if (token !== run) return;
    const { state } = runner();
    const products = new Map();
    // Returns how many were new. `pageNumber` labels where each came from.
    const addTiles = (tiles, pageNumber) => {
      let fresh = 0;
      for (const tile of tiles) {
        if (products.size >= settings.sortCount) break;
        if (!tile.id || products.has(tile.id)) continue;
        products.set(tile.id, extractProduct(tile, pageNumber, settings)); fresh++;
      }
      return fresh;
    };
    const startedAt = Date.now();
    const timeUp = () => settings.sortTimeLimit > 0 && Date.now() - startedAt >= settings.sortTimeLimit * 1000;
    const timeMessage = () => t('sortTimeLimit', 'Stopped after $1 seconds, the time limit for building this list.', settings.sortTimeLimit);
    let stopped = '';
    const tiles = pageTiles();
    lastRead = { search: searchOf(location.href), sig: signature(tiles) };
    addTiles(tiles, 1);
    const scores = new Map();
    const list = () => [...products.values()].map(p => ({ ...p, ...(scores.get(p.asin) || { score: null, verdict: '', source: 'unrated' }) }));
    const noScore = () => [...products.keys()].filter(id => !scores.has(id));
    const counting = () => t('sortStatusFound', '$1 listings so far.', products.size);

    if (!products.size) {
      await publish(token, [], false, t('sortNoCardsStore', 'No $1 product cards were found. Check that this is a search results page, then refresh after listings load.', storeName), true);
      return;
    }
    for (const [id, s] of await knownScores(noScore())) scores.set(id, s);
    if (!await publish(token, list(), true, `${counting()} ${t('sortStatusChecking', 'Checking saved scores…')}`, true)) return;

    // Further results pages, when "Load more results" is on.
    let partialError = '', pagesInList = 1, exhausted = false;
    if (settings.sortLoadMore && products.size < settings.sortCount) {
      const firstPageCount = tiles.length;
      let currentUrl = location.href, currentDoc = document, pageNumber = 1;
      const wanted = () => settings.sortCount - products.size;
      while (products.size < settings.sortCount && token === run && !timeUp() && pageNumber < MAX_PAGES) {
        const nextUrl = findNextLink(currentDoc, currentUrl) || pagedUrl(currentUrl, pageNumber, firstPageCount);
        if (!nextUrl) {
          // No address for a next page: scroll this one, once, for what the store loads by itself.
          await publish(token, list(), true, t('sortMoreFromPage', 'Loading more results from this page… ($1 products found)', products.size), true);
          await loadByScrolling(token, wanted, found => addTiles(found, 1), timeUp);
          exhausted = true; break;
        }
        pageNumber += 1;
        await publish(token, list(), true, t('sortLoadingPageStore', 'Loading $1 results page $2 ($3 products found)…', storeName, pageNumber, products.size), true);
        const controller = new AbortController();
        controllers.add(controller);
        const signal = AbortSignal.any ? AbortSignal.any([controller.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS + FRAME_TIMEOUT_MS)]) : controller.signal;
        try {
          await sleep(REQUEST_GAP_MS);
          let fresh = 0;
          const read = await readResultsPage(nextUrl, signal, found => { fresh = addTiles(found, pageNumber); return found; });
          if (token !== run) return;
          if (!fresh) { exhausted = true; break; }            // nothing new: the store has no more, or ignores the page number
          pagesInList = pageNumber;
          currentUrl = nextUrl; currentDoc = read.doc;
          for (const [id, s] of await knownScores(noScore())) scores.set(id, s);
        } catch (error) {
          if (token !== run) return;
          if (error && error.blocked) runner().state.throttled = true;
          partialError = error && error.name === 'TimeoutError' ? t('sortPageTimeoutStore', '$1 took too long to send the next results page', storeName)
            : (error && error.message) || t('sortNoMoreStore', '$1 has no more results.', storeName);
          break;
        } finally { controllers.delete(controller); }
      }
      if (token !== run) return;
      if (timeUp() && products.size < settings.sortCount && !exhausted) stopped = timeMessage();
      for (const [id, s] of await knownScores(noScore())) scores.set(id, s);
      if (!await publish(token, list(), true, counting(), true)) return;
    }

    // Product pages for what is still unscored, when the settings allow it.
    const rateAllowed = settings.sortMissing === 'rate-first' && state.autoScoreSearch;
    if (rateAllowed && noScore().length && token === run) {
      const ids = noScore();
      const budget = () => (state.fetchLimit >= Number.MAX_SAFE_INTEGER ? Infinity : state.fetchLimit * pagesInList);
      const rated = await rateByProductPage(ids, products, token, (done, total, got) => {
        for (const [id, s] of got) scores.set(id, s);
        publish(token, list(), true, t('sortRatingMore', 'Rating listings without a score: $1 of $2…', done, total));
      }, budget, timeUp);
      for (const [id, s] of rated.scores) scores.set(id, s);
      stopped = stopped || rated.stopped || (rated.timedOut ? timeMessage() : '');
    }
    if (token !== run) return;

    const items = list();
    const unscored = items.filter(p => p.score == null).length;
    const tail = unscored ? ' ' + unscoredTail(unscored) : '';
    const collected = t('sortCollected', 'Collected $1 products.', items.length);
    let status;
    if (stopped) status = `${stopped} ${collected}${tail}`;
    else if (partialError) status = `${collected} ${t('sortPartial', 'More results could not be loaded')} (${partialError}).${tail}`;
    else if (settings.sortLoadMore && items.length < settings.sortCount) status = `${t('sortNoMoreStore', '$1 has no more results.', storeName)} ${collected}${tail}`;
    else status = `${collected}${tail}`;
    logAction('side panel list', `${storeName}: ${status} (${items.filter(p => p.unitPrice != null).length} with a unit price)`);
    await publish(token, items, false, status, true);
  }

  // ------------------------------------------------------------------ messages from the panel and the worker
  // The panel's Stop button, the worker's shortcut start and the panel's "follow this search" ask this tab directly.
  function onPanelMessage(msg, sender, respond) {
    const own = !!sender && sender.id === chrome.runtime.id && !sender.tab;
    if (msg?.type === 'sortFollow') { if (own) followSearch(true); return false; }
    if (msg && msg.type === 'sortStart') {
      const ok = own && mounted && typeof msg.runId === 'string' && /^[\w-]{1,64}$/.test(msg.runId);
      if (typeof respond === 'function') respond({ ok });
      if (ok) startFromCommand({ mode: msg.mode === 'unitPrice' ? 'unitPrice' : 'health', runId: msg.runId });
      return false;
    }
    if (!msg || msg.type !== 'sortStop') return false;
    let fromList;
    try {
      fromList = own && /\/src\/options\/(sorted|sidepanel)\.html(?:[?#]|$)/.test(new URL(sender.url || '').pathname + '#');
    } catch (e) { fromList = false; }
    if (!fromList || (msg.runId && msg.runId !== runId)) return false;
    run++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    return false;
  }
  // With the panel open, a new search in this tab fills it again, as on Amazon.
  function followSearch(force = false) {
    if (!mounted || (!force && followedURL === location.href)) return;
    const url = location.href, generation = run;
    followedURL = url;
    send({ type: 'followSortedSearch', sourceUrl: url, priceOnly: false, unitEnabled: true }).then(reply => {
      if (reply?.ok && typeof reply.runId === 'string' && mounted && location.href === url && run === generation) void startFromCommand(reply);
    });
  }

  // ------------------------------------------------------------------ lifecycle (called by retailer.js)
  // `update` on every search pass with the tiles now on the page; `reset(enabled)` when the page, the settings or
  // the switch change. A page that is not a food search, or an extension that is paused, gets no button.
  function update(entries) {
    if (!active) return;
    lastTiles = entries.map(entry => entry.tile);
    mounted = true;
    mount();
    if (!listening) {
      listening = true;
      try { chrome.runtime.onMessage.addListener(onPanelMessage); } catch (e) { /* no messaging */ }
    }
    if (U()) storageGet([...Object.keys(U().UNIT_DEFAULTS), 'unitPrice']).then(got => { unitSettings = U().sanitizeUnit(got); unitOn = got.unitPrice !== false; });
    followSearch();
  }
  function reset(enabled) {
    active = enabled;
    if (enabled && host?.isConnected) root.AIR.db.theme?.force(shadow);
    unitHeld = { sig: '', unit: null };
    lastTiles = [];
    // Another search, a settings change or the switch: whatever list was being built for the old page stops here.
    run++; pending = false; mounted = false;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    if (!enabled) { unmount(); followedURL = ''; }
  }
  root.AIR.retailerSort = { update, reset, extractProduct, whyOf, findNextLink, pagedUrl, cardOf, choose, get runId() { return runId; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.retailerSort;
})(typeof globalThis !== 'undefined' ? globalThis : self);
