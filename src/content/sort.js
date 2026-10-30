// Ingredient Check in Amazon's own "Sort by" menu.
//
// Ported from the Amazon Cost per Ounce Sorter (github.com/jackson29382938/amazon_cost_sorting): two
// options join Amazon's list, "Ingredient Check score: High to Low" and, while the unit-price setting
// is on, "Price per <unit>: Low to High", where the unit is the one most of the page's listings already
// show (ounce, fl oz, pound, gallon, count...) and the side panel can change it. Choosing one never reorders Amazon's page. It opens
// Chrome's side panel beside the results, with this search's listings ranked there; the panel's
// priority bar mixes health score, price per ounce, total price and customer rating.
//
// Chrome opens the side panel only in response to a user action, so the option's click is caught
// here before Amazon's own menu code sees it, and the request goes out while that click still counts
// (the worker calls sidePanel.open before anything else). Amazon's menu is a native <select> that
// its script mirrors into a pop-up list and then drives through jQuery; jQuery's change event never
// reaches addEventListener, which is why listening on the <select> alone is not enough.
//
// The list fills in as it goes: the listings on this page first, with the scores this computer and
// the shared database already have; then, when "Load more results" is on, further Amazon results
// pages; then, when the sort setting and "Rate every search result" allow, the product pages of the
// listings still without a score, through the badges' own request queue (search.js: three at a time,
// one request per product, one throttle pause and one per-page budget), stopped by the panel's Stop
// button, the master switch, Amazon refusing, or that budget. Nothing here fetches what the badges
// would not.

(function (root) {
  root.AIR = root.AIR || {};
  const P = () => root.AIR.page;
  const S = () => root.AIR.search;
  const R = () => root.AIR.db.sortedResults;
  const U = () => root.AIR.db.unitPrice;
  const SF = () => root.AIR.db.storefronts;

  const CARD = '[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin]';
  const VALUE = { health: 'ingredient-check-score', unitPrice: 'ingredient-check-price-per-ounce' };
  const MARK = 'data-air-sort';
  const LOOKUP_BATCH = 100;
  const PUBLISH_GAP_MS = 700;
  const LOAD_MORE_TIMEOUT_MS = 15000;

  let observer = null;
  let observerTimer = 0;
  let mounted = false;
  let priceOnly = false;
  let pending = false;
  let run = 0;
  let runId = null;
  const controllers = new Set();

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
  const toAbsoluteUrl = value => { if (!value) return ''; try { return new URL(value, location.href).href; } catch { return ''; } };

  // ------------------------------------------------------------------ the menu
  // The unit's name in the menu: "ounce", "gallon", "count", "100 g". Localised by key, English otherwise.
  const unitName = id => { const u = U().UNIT_CHOICES.find(c => c.id === id); return u ? t(`unitName_${id}`, u.long) : id; };
  // The unit most of this page's listings already show, worked out from the cards on the page before anything
  // is fetched (extract.js reads each card's own unit price, else its title). Kept until the cards change.
  let unitSettings = U() ? { ...U().UNIT_DEFAULTS } : {};
  let menuUnitHeld = { sig: '', unit: null };
  function menuUnit() {
    const cards = productCardsIn(document);
    // Which listings, and how much text each holds: a card that gains a unit price keeps its ASIN.
    const sig = cards.map(card => `${card.dataset.asin}:${(card.textContent || '').length}`).join(',');
    if (menuUnitHeld.sig === sig) return menuUnitHeld.unit;
    const likely = U().likelyUnit(cards.map(card => extractProduct(card, 1, unitSettings)), SF().storefront(location.hostname).units);
    menuUnitHeld = { sig, unit: likely ? likely.unit : null };
    return menuUnitHeld.unit;
  }
  // "Price per gallon: Low to High": one entry, whose unit is the one most listings are priced in.
  const labels = () => ({
    health: t('sortMenuScore', 'Ingredient Check score: High to Low'),
    unitPrice: t('sortMenuUnitPer', 'Price per $1: Low to High', unitName(menuUnit() || U().defaultUnit('weight', SF().storefront(location.hostname).units))),
  });
  const modes = () => priceOnly ? (P().state.unitPrice === false ? [] : ['unitPrice']) : (P().state.unitPrice === false ? ['health'] : ['unitPrice', 'health']);
  const modeOfValue = value => Object.keys(VALUE).find(mode => VALUE[mode] === value) || null;

  // Amazon's sort menu, found by its option values ("relevanceblender", "price-asc-rank", …), which do
  // not change with the store's language; the English labels are a fallback for a menu without them.
  const AMAZON_SORT_VALUES = /^(?:relevanceblender|featured-rank|price-asc-rank|price-desc-rank|review-rank|date-desc-rank|exact-aware-popularity-rank)$/;
  const LOW_TO_HIGH = option => option.value === 'price-asc-rank' || /price\s*:\s*low\s*to\s*high/i.test(option.textContent);
  function sortSelects(doc = document) {
    return [...doc.querySelectorAll('select#s-result-sort-select, select[id*="sort-select"], select[data-action*="sort"]')]
      .filter(select => [...select.options].some(option => AMAZON_SORT_VALUES.test(option.value)
        || /featured|price\s*:\s*low\s*to\s*high/i.test(option.textContent)));
  }

  // Our options in the <select>: price per ounce after "Price: Low to High", the score at the end.
  // Amazon builds its pop-up list from these when the menu opens.
  function syncSelect(select) {
    const want = modes();
    const names = labels();
    for (const mode of Object.keys(VALUE)) {
      const existing = select.querySelector(`option[value="${VALUE[mode]}"]`);
      if (!want.includes(mode)) { existing?.remove(); continue; }
      if (existing) { if (existing.textContent !== names[mode]) existing.textContent = names[mode]; continue; }
      const option = new Option(names[mode], VALUE[mode]);
      option.setAttribute(MARK, mode);
      const lowToHigh = [...select.options].find(LOW_TO_HIGH);
      if (mode === 'unitPrice' && lowToHigh) select.insertBefore(option, lowToHigh.nextSibling);
      else select.append(option);
    }
    if (select.dataset.airSortListening) return;
    select.dataset.airSortListening = '1';
    select.addEventListener('input', onSelectChange, true);
    select.addEventListener('change', onSelectChange, true);
  }

  // Amazon's pop-up list, when it is already built: add our rows if it was built before our options
  // existed, and drop them when an option was turned off.
  function syncPopover(select) {
    const want = modes();
    const names = labels();
    const lists = new Set([...document.querySelectorAll(`a[id^="${CSS.escape(select.id)}_"]`)]
      .map(a => a.closest('ul, [role="listbox"]')).filter(Boolean));
    for (const list of lists) {
      for (const mode of Object.keys(VALUE)) {
        const row = list.querySelector(`[${MARK}="${mode}"]`)
          || [...list.querySelectorAll('a')].find(a => dataValue(a) === VALUE[mode])?.closest('li');
        if (!want.includes(mode)) { row?.remove(); continue; }
        if (row) {
          row.setAttribute(MARK, mode);
          const link = row.querySelector('a');
          if (link && link.textContent !== names[mode]) link.textContent = names[mode];
          continue;
        }
        const template = list.querySelector('li');
        if (!template) continue;
        const li = template.cloneNode(true);
        li.setAttribute(MARK, mode);
        li.setAttribute('aria-selected', 'false');
        const a = li.querySelector('a') || li;
        a.classList?.remove('a-active');
        a.textContent = names[mode];
        a.setAttribute('data-value', JSON.stringify({ stringVal: VALUE[mode] }));
        a.id = `${select.id}_air_${mode}`;
        if (mode === 'unitPrice') {
          const after = [...list.querySelectorAll('a')].find(item => dataValue(item) === 'price-asc-rank'
            || /price\s*:\s*low\s*to\s*high/i.test(item.textContent))?.closest('li');
          if (after) { after.after(li); continue; }
        }
        list.append(li);
      }
    }
  }

  function dataValue(a) {
    try { return JSON.parse(a.getAttribute('data-value') || '{}').stringVal || ''; } catch { return ''; }
  }

  function install() {
    if (!mounted) return;
    for (const select of sortSelects()) {
      syncSelect(select);
      if (select.id) syncPopover(select);
    }
  }

  function uninstall() {
    document.querySelectorAll(`option[${MARK}], li[${MARK}]`).forEach(node => node.remove());
    for (const mode of Object.keys(VALUE)) document.querySelectorAll(`option[value="${VALUE[mode]}"]`).forEach(node => node.remove());
  }

  // The row the user picked in Amazon's pop-up list, if it is ours.
  function pickedMode(target) {
    const el = target && target.closest ? target.closest(`[${MARK}], a.a-dropdown-link, [role="option"]`) : null;
    if (!el) return null;
    const marked = el.closest(`[${MARK}]`);
    if (marked) return marked.getAttribute(MARK);
    const link = el.matches('a') ? el : el.querySelector('a');
    return link ? modeOfValue(dataValue(link)) : null;
  }

  function closeMenu(target) {
    const popover = target.closest('.a-popover');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
    try { (document.activeElement || document.body).dispatchEvent(escape); } catch (e) { /* ignore */ }
    if (popover) setTimeout(() => {
      if (popover.isConnected && popover.getAttribute('aria-hidden') !== 'true' && getComputedStyle(popover).display !== 'none') {
        popover.style.display = 'none';
        popover.setAttribute('aria-hidden', 'true');
      }
    }, 60);
  }

  // Capture phase on window, so this runs before Amazon's delegated menu handlers.
  function onMenuPointer(event) {
    if (!mounted || !pickedMode(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    const mode = pickedMode(event.target);
    closeMenu(event.target);
    choose(mode);
  }

  function onMenuKey(event) {
    if (!mounted || (event.key !== 'Enter' && event.key !== ' ')) return;
    const mode = pickedMode(event.target) || pickedMode(document.activeElement);
    if (!mode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeMenu(event.target);
    choose(mode);
  }

  // Keyboard and native-dropdown choices land on the <select> itself.
  function onSelectChange(event) {
    const select = event.currentTarget;
    const mode = modeOfValue(select.value);
    if (!mode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Native selects fire input before change; retain the chosen value until change handles it.
    if (event.type === 'input') return;
    // Put Amazon's current sort back so the page and the menu keep saying what Amazon is showing.
    const current = new URLSearchParams(location.search).get('s');
    const back = [...select.options].find(o => o.value === current) || [...select.options].find(o => !o.hasAttribute(MARK));
    if (back) select.value = back.value;
    if (event.type === 'change') choose(mode);
  }

  // ------------------------------------------------------------------ choosing
  // Runs inside the click. The message goes out before any await so Chrome still counts the click.
  function choose(mode) {
    if (pending || (priceOnly && mode !== 'unitPrice')) return;
    pending = true;
    const token = ++run;
    for (const c of controllers) c.abort();
    controllers.clear();
    const sourceUrl = location.href;
    P().logAction?.('Amazon sort menu', `chose ${mode === 'unitPrice' ? 'Unit price' : 'Ingredient Check score'} on ${location.pathname}`);
    send({ type: 'openSortedPanel', mode, sourceUrl, priceOnly, unitEnabled: P().state.unitPrice !== false }).then(async reply => {
      pending = false;
      if (token !== run || !reply || !reply.runId) return;
      runId = reply.runId;
      // No side panel (an older Chrome, or the click no longer counted): the same list in a tab.
      if (!reply.ok) {
        P().logAction?.('Amazon sort menu', `side panel did not open (${reply.reason || 'unknown'}); opened a tab`);
        send({ type: 'openSortedTab' });
      }
      await gather(token);
    });
  }

  // Never leave the panel on "Reading Amazon listings…": say what went wrong.
  async function gather(token) {
    try {
      await collect(token);
    } catch (e) {
      publish(token, [], false, t('sortFailed', 'Could not read this results page ($1). Refresh the Amazon page and choose the option again.',
        String((e && e.message) || e).slice(0, 120)), true);
    }
  }

  // The keyboard shortcut (background.js sortFromCommand) has already opened the panel and made the
  // list; this starts gathering for it, as a click in the menu would.
  function startFromCommand(msg) {
    for (const c of controllers) c.abort();
    controllers.clear();
    const token = ++run;
    runId = msg.runId;
    P().logAction?.('keyboard shortcut', `sorted ${msg.mode === 'unitPrice' ? 'by unit price' : 'by Ingredient Check score'} on ${location.pathname}`);
    return gather(token);
  }

  // ------------------------------------------------------------------ listings
  // A listing is what the badges treat as one (search.js): an element with a real ASIN and a title,
  // not inside another such element. This used to also demand an `h2 a` link or Amazon's image
  // link; current Amazon cards put the h2 INSIDE the link (and grocery / Whole Foods cards may have
  // neither), so on those pages no card qualified and the side panel stayed empty.
  // Grocery storefronts can use linked text or h3 instead of the standard h2 title. Which element is the
  // title is decided once, in search.js (listingTitle), so the badge on the page and the name in the side
  // panel can never come from different elements: the first heading in a grocery tile can be the hidden
  // "Quantity not updated" alert of its add-to-cart control.
  const ASIN = /^[A-Z0-9]{10}$/;
  const isCard = card => !!(card.dataset && ASIN.test(card.dataset.asin || '') && S().listingTitle(card));
  function productCardsIn(doc) {
    const slot = doc.querySelector('.s-main-slot, [data-component-type="s-search-results"] .s-result-list') || doc;
    let cards = [...slot.querySelectorAll(CARD + ', [data-asin]')].filter(isCard);
    if (!cards.length && slot !== doc) cards = [...doc.querySelectorAll('[data-asin]')].filter(isCard);
    const set = new Set(cards);
    // Outermost only: a card can hold a variation or an inner element carrying the same ASIN.
    return cards.filter(card => { for (let a = card.parentElement; a; a = a.parentElement) if (set.has(a)) return false; return true; });
  }

  // The listing's price. Amazon splits it into whole and fraction parts; reading those needs no guess
  // about which of "," and "." is the decimal mark. The screen-reader text is the fallback, read the
  // way this store writes prices (storefronts.js).
  function getPrice(card) {
    for (const price of card.querySelectorAll('.a-price:not(.a-text-price)')) {
      if (price.closest('.a-text-price')) continue;
      const whole = (price.querySelector('.a-price-whole')?.textContent || '').replace(/\D/g, '');
      const fraction = (price.querySelector('.a-price-fraction')?.textContent || '').replace(/\D/g, '');
      if (whole) return Number(fraction ? `${whole}.${fraction}` : whole);
      const value = R().parseMoney(price.querySelector('.a-offscreen')?.textContent, location.hostname);
      if (value != null) return value;
    }
    return null;
  }

  // "4.6 out of 5 stars", "4,6 von 5 Sternen", "4,6 sur 5 étoiles", "5つ星のうち4.6" -> 4.6.
  function ratingValue(text) {
    const s = String(text || '');
    const jp = s.match(/5つ星のうち\s*(\d(?:[.,]\d)?)/);
    const m = jp || s.match(/(\d(?:[.,]\d)?)\s*(?:out of|von|sur|de|su|van|av|z|na|üzerinden|من)\s*5\b/i);
    return m ? Number(m[1].replace(',', '.')) : null;
  }
  // "(12,345)", "12.3K", "1K+" -> a count; "(12.345)" on a comma-decimal store is twelve thousand.
  function reviewCount(text, store) {
    const decimal = SF() ? SF().storefront(store).decimal : '.';
    const raw = String(text || '');
    const abbreviated = raw.match(/(\d+(?:[.,]\d+)?)\s*([KkMm])\b/);
    if (abbreviated) {
      const n = Number(abbreviated[1].replace(',', '.')) * (/k/i.test(abbreviated[2]) ? 1000 : 1e6);
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    const n = SF() ? SF().parseNumber(raw, decimal) : Number((raw.replace(/,/g, '').match(/\d+/) || [])[0]);
    return Number.isFinite(n) && n != null ? Math.round(n) : null;
  }

  // The listing as the sorted list shows it. The score is added by withScores().
  function extractProduct(card, pageNumber = 1, settings = {}) {
    // Our own score badge sits at the start of the title (search.js paintBadge); it is not the title.
    const badge = (card.querySelector('.air-badge')?.textContent || '').trim();
    const withoutBadge = s => (badge && s.startsWith(badge) ? s.slice(badge.length) : s).trim();
    const titleNode = S().listingTitle(card);
    const linkNode = card.querySelector('h2 a')
      || [...card.querySelectorAll('a[href]')].find(a => /\/(?:dp|gp\/product)\/[A-Z0-9]{10}/.test(a.getAttribute('href') || ''))
      || card.querySelector('a.a-link-normal.s-no-outline');
    const title = withoutBadge((titleNode?.innerText || titleNode?.textContent || '').trim());
    const text = (card.innerText || card.textContent || '').replace(/\u00a0/g, ' ').trim()
      .split(/\n/).map(line => withoutBadge(line.trim())).filter(line => line && line !== badge).join('\n');
    const image = card.querySelector('img.s-image');
    const imageUrl = image?.getAttribute('src');
    const imageFallback = image?.getAttribute('data-src') || image?.getAttribute('data-old-hires');
    const ratingNode = card.querySelector('[aria-label*="out of 5 stars"], .a-icon-alt');
    const reviewsNode = card.querySelector('a[href*="customerReviews"] .a-size-base, a[href*="customerReviews"]')
      || card.querySelector('[aria-label$=" ratings"], [aria-label$=" rating"]');
    const listingPrice = getPrice(card);
    const rating = (ratingNode?.getAttribute('aria-label') || ratingNode?.textContent || '').trim();
    // "2,310 ratings" in aria-label is exact where the visible text is rounded ("(2.3K)").
    const reviewsLabel = reviewsNode?.getAttribute('aria-label') || '';
    const reviews = (/\d/.test(reviewsLabel) ? reviewsLabel : (reviewsNode?.innerText || reviewsNode?.textContent || '')).trim();
    const unit = settings.unitPrice === false ? { unitPrice: null, unitSource: 'none', unitKind: '', unitId: '', unitPrices: {}, unitSources: {} }
      : U().unitPricesFor({ title, text, listingPrice }, settings, location.hostname);
    const asin = card.dataset.asin || '';
    return {
      asin,
      title: title || 'Amazon listing',
      url: toAbsoluteUrl(linkNode?.getAttribute('href')) || (ASIN.test(asin) ? `${location.origin}/dp/${asin}` : ''),
      image: toAbsoluteUrl(imageUrl && !imageUrl.startsWith('data:') ? imageUrl : imageFallback || imageUrl),
      listingPrice,
      unitPrice: unit.unitPrice,
      unitSource: unit.unitSource,
      unitKind: unit.unitKind,
      unitId: unit.unitId,
      unitPrices: unit.unitPrices,
      unitSources: unit.unitSources,
      rating,
      ratingValue: ratingValue(rating),
      reviews,
      reviewCount: reviewCount(reviews, location.hostname),
      bought: text.match(/\b[\d,.]+\s*(?:K\+?\s*)?bought in past month\b/i)?.[0] || '',
      sponsored: /\bsponsored\b/i.test(text.slice(0, 200)),
      pageNumber,
    };
  }

  // ------------------------------------------------------------------ scores
  // Why a listing scored what it did: the same rows the product panel and the results-page hover card
  // show ("What's good", "What hurt"), trimmed to what the list needs. The engine re-runs on the
  // saved product reading under the reader's current settings, as the hover card does; no network.
  const WHY_ROWS = 8;
  function whyOf(result) {
    if (!result || !root.AIR.panel || typeof root.AIR.panel.sections !== 'function') return null;
    const { caps, minus, plus, neutral } = root.AIR.panel.sections(result);
    const row = h => ({ c: h.c === 'CAP' ? 'CAP' : Math.round(Number(h.c) || 0), why: String(h.why || '').slice(0, 140),
      ing: h.ing ? String(h.ing).slice(0, 80) : '' });
    return { caps: caps.slice(0, WHY_ROWS).map(row), plus: plus.slice(0, WHY_ROWS).map(row),
      minus: minus.slice(0, WHY_ROWS).map(row), neutral: neutral.slice(0, 3).map(row) };
  }

  // asin -> { score, verdict, source, why }, from this computer only: the weighted score, else the
  // product data read earlier, scored under the current settings.
  async function knownScores(asins) {
    const { cacheKey, usableCache, freshLocal, storeHost, unreadable, state, cacheScore } = P();
    const C = root.AIR.db.productCache;
    const localKey = asin => C.localKey(storeHost(), asin);
    const got = await root.AIR.db.scoreCache.readLocal(asins.flatMap(a => [cacheKey(a), localKey(a)]), state.cacheOptions, null, chrome.storage);
    const out = new Map();
    for (const asin of asins) {
      const hit = got[cacheKey(asin)];
      const row = C.sanitize(got[localKey(asin)]);
      const okRow = row && row.status === 'ok' && freshLocal(row);
      if (usableCache(hit, asin)) {
        // The saved score keeps no reasons; the product reading behind it does.
        const assessed = okRow ? root.AIR.engine.score(C.toInput(row), state.prefs) : null;
        const sameScore = assessed && !unreadable(assessed) && assessed.score === hit.score;
        const why = sameScore ? whyOf(assessed) : null;
        const evidence = sameScore ? root.AIR.db.shopping?.evidence(assessed, { source: row.data.via, capturedAt: Date.parse(row.scanned_at), prefs: state.prefs }) : hit.evidence;
        out.set(asin, { score: hit.score, category: hit.category || 'food', ratingStyle: hit.ratingStyle || 'food', verdict: hit.verdict, source: 'scored', evidence, why, servings: okRow ? servingsFor(C.toInput(row)) : null });
        continue;
      }
      if (!row || !freshLocal(row)) continue;
      if (row.status === 'not-food' || (row.data.food === false && !root.AIR.db.ingestible?.allowsProduct?.(row.data.title, state.prefs))) { out.set(asin, { score: null, source: 'not-food' }); continue; }
      if (row.status === 'unreadable') { out.set(asin, { score: null, source: 'unreadable' }); continue; }
      const result = root.AIR.engine.score(C.toInput(row), state.prefs);
      if (unreadable(result)) { out.set(asin, { score: null, source: 'unreadable' }); continue; }
      cacheScore(asin, result, row.data.title, row.data.via || 'search-tile', '', Date.parse(row.scanned_at));
      out.set(asin, { score: result.score, category: result.category || 'food', ratingStyle: result.ratingStyle || 'food', verdict: result.verdict, source: 'scored', evidence: root.AIR.db.shopping?.evidence(result, { source: row.data.via, capturedAt: Date.parse(row.scanned_at), prefs: state.prefs }), why: whyOf(result), servings: servingsFor(C.toInput(row)) });
    }
    return out;
  }

  // Servings in the package, from the product reading behind a score, for the price per serving shown
  // with each listing. Only a product page publishes it; a listing never read has none.
  const servingsFor = input => (input && U() && U().servingsOf(input.nutrition)) || null;

  // Shared-database rows for listings this computer has not read, scored here under this reader's
  // settings; counts one pull per row used, as the badges do. Skipped unless shared product readings
  // are on, and when the speed setting says to read every product page yourself.
  async function sharedScores(asins, token) {
    const { storeHost, unreadable, state, cacheScore, rememberProduct, sharedOk, sharedProductsOn, speed } = P();
    const out = new Map();
    if (!asins.length || !sharedProductsOn() || !speed().sharedDays) return out;
    const C = root.AIR.db.productCache;
    const pulls = [];
    for (let i = 0; i < asins.length && token === run; i += LOOKUP_BATCH) {
      const reply = await send({ type: 'productsLookup', store: storeHost(), asins: asins.slice(i, i + LOOKUP_BATCH) });
      for (const [asin, raw] of Object.entries((reply && reply.rows) || {})) {
        const row = C.sanitize(raw);
        if (!row || !asins.includes(asin) || !sharedOk(row)) continue;
        rememberProduct(asin, row, { share: false });
        pulls.push({ key: row.key, scanned_at: row.scanned_at });
        if (row.status === 'not-food' || (row.data.food === false && !root.AIR.db.ingestible?.allowsProduct?.(row.data.title, state.prefs))) { out.set(asin, { score: null, source: 'not-food' }); continue; }
        if (row.status === 'unreadable') { out.set(asin, { score: null, source: 'unreadable' }); continue; }
        const result = root.AIR.engine.score(C.toInput(row), state.prefs);
        if (unreadable(result)) { out.set(asin, { score: null, source: 'unreadable' }); continue; }
        cacheScore(asin, result, row.data.title, row.data.via || 'search-tile', '', Date.parse(row.scanned_at));
        out.set(asin, { score: result.score, category: result.category || 'food', ratingStyle: result.ratingStyle || 'food', verdict: result.verdict, source: 'scored', evidence: root.AIR.db.shopping?.evidence(result, { source: row.data.via, capturedAt: Date.parse(row.scanned_at), prefs: state.prefs }), why: whyOf(result), servings: servingsFor(C.toInput(row)) });
      }
    }
    if (pulls.length) send({ type: 'productsQueue', pulls });
    return out;
  }

  // Product pages for listings still without a score, through the badges' request queue (search.js):
  // the same three slots and gap between starts, one request per product whoever asks first, one
  // throttle pause, and one budget per Amazon results page (`budget`, counted with the badges'
  // requests). Stopped by the panel's Stop button, the master switch, Amazon refusing, or the budget.
  async function rateByProductPage(asins, token, onProgress, budget, timeUp = () => false) {
    const search = S();
    const q = search.queue;
    const out = new Map();
    let next = 0, done = 0, stopped = '';
    const halted = () => token !== run || !!stopped || !P().state.enabled || timeUp();
    const throttled = () => t('sortThrottled', 'Amazon stopped answering product pages, so rating paused.');
    const outOfBudget = () => t('sortBudget', 'Rating stopped at $1 product pages, the limit for the Amazon results pages in this list.', budget());
    async function worker() {
      while (next < asins.length && !halted()) {
        if (q.throttled) { stopped = throttled(); break; }
        const asin = asins[next++];
        let slot = false;
        try {
          // A product the badges already requested costs nothing more.
          if (!search.knownRead(asin)) {
            if (q.fetches >= budget()) { stopped = outOfBudget(); break; }
            slot = await search.acquireSlot(halted);
            if (!slot) { if (q.throttled && !stopped) stopped = throttled(); break; }
            if (q.fetches >= budget()) { stopped = outOfBudget(); break; }
            q.fetches++;
          }
          const reading = await search.readProductPage(asin, 'sort-list');
          if (token !== run) return;
          out.set(asin, reading.outcome === 'scored'
            ? { score: reading.result.score, category: reading.result.category || 'food', ratingStyle: reading.result.ratingStyle || 'food', verdict: reading.result.verdict, source: 'scored', why: whyOf(reading.result), servings: servingsFor(reading.input) }
            : { score: null, source: reading.outcome === 'not-food' ? 'not-food' : 'unreadable' });
        } catch (e) {
          // Refused, offline, or aborted: the listing stays without a score. Refusals count toward the
          // shared throttle pause inside readProductPage.
        } finally {
          if (slot) search.releaseSlot();
          done++;
          onProgress(done, asins.length, out);
        }
      }
    }
    await Promise.all(Array.from({ length: search.pace().concurrent }, worker));
    if (!stopped && q.throttled) stopped = throttled();
    return { scores: out, stopped, timedOut: !stopped && timeUp() };
  }

  function findNextPage(doc, currentUrl) {
    const next = doc.querySelector('a.s-pagination-next[href]');
    if (!next || next.classList.contains('s-pagination-disabled') || next.getAttribute('aria-disabled') === 'true') return null;
    try {
      const url = new URL(next.getAttribute('href'), currentUrl);
      return url.origin === location.origin ? url.href : null;
    } catch { return null; }
  }

  // ------------------------------------------------------------------ building the list
  async function getSettings() {
    const got = await storageGet([...Object.keys(R().SORT_DEFAULTS), ...Object.keys(U().UNIT_DEFAULTS)]);
    unitSettings = U().sanitizeUnit(got);
    return { ...R().sanitizeSort(got), ...unitSettings, unitPrice: P().state.unitPrice !== false };
  }

  // Everything the panel shows comes through here; the worker re-checks it and keeps it in session
  // storage. One at a time and in order, so a late progress update never lands after the final list;
  // progress updates are spaced out.
  let lastPublish = 0;
  let publishing = Promise.resolve(true);
  function publish(token, items, loading, status, force = false) {
    if (token !== run) return Promise.resolve(false);
    if (!force && loading && Date.now() - lastPublish < PUBLISH_GAP_MS) return Promise.resolve(true);
    lastPublish = Date.now();
    const id = runId;
    publishing = publishing.then(async () => {
      if (token !== run) return false;
      // The unit most of these listings are priced in; the panel uses it until the reader picks another.
      const likely = U() && SF() ? U().likelyUnit(items, SF().storefront(location.hostname).units) : null;
      if (new Set(items.filter(p => Number.isFinite(p.score)).map(p => p.category || 'food')).size > 1) status = t('sortMixed', 'Mixed categories: score ranking is disabled; other priorities still apply.') + ' ' + status;
      const reply = await send({ type: 'updateSortedResults', runId: id, items, loading, status, priceOnly, unit: likely ? likely.unit : '' });
      // A newer sort (in this tab or another) took the panel over: stop working for this one.
      if (reply && reply.stale) { if (token === run) run++; return false; }
      return true;
    });
    return publishing;
  }

  // Amazon can change the address first and show the new search's results later (a soft navigation swaps
  // the list in a moment after history.pushState; a grocery page can fill its grid after load). Reading
  // the cards the instant the address changed gave the side panel an empty list ("No Amazon product cards
  // were found") or the previous search's listings under the new search. So when there is nothing to read,
  // or what is there is exactly what the last list was made from while the search in the address has changed, wait for
  // the cards to arrive and stop changing; when the page has what it needs, read it at once. After
  // READY_TIMEOUT_MS whatever is there is used: a new search can really return the same listings.
  const READY_POLL_MS = 250;
  const READY_TIMEOUT_MS = 6000;
  let lastRead = { search: '', sig: '' };
  const signature = cards => cards.map(card => card.dataset.asin).join(',');
  // The parts of the address that decide the results; Amazon appends tracking parameters (crid, sprefix, ref…)
  // to the same search, and that is not a new search to wait for.
  const SEARCH_PARAMS = ['k', 'i', 'rh', 'node', 's', 'page', 'srs', 'bbn', 'low-price', 'high-price', 'field-keywords'];
  const searchOf = href => {
    try { const u = new URL(href); return [u.pathname, ...SEARCH_PARAMS.map(name => u.searchParams.get(name) || '')].join('|'); } catch (e) { return String(href); }
  };
  async function listingsReady(token) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let waited = false, previous = null;
    while (token === run) {
      const sig = signature(productCardsIn(document));
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
    const pricesOnly = priceOnly;
    const { state } = P();
    const products = new Map();
    const add = product => { const key = product.asin || product.url; if (!key || products.has(key)) return false; products.set(key, product); return true; };
    // The reader's time limit: past it, what is gathered is shown as it stands.
    const startedAt = Date.now();
    const timeUp = () => settings.sortTimeLimit > 0 && Date.now() - startedAt >= settings.sortTimeLimit * 1000;
    const timeMessage = () => t('sortTimeLimit', 'Stopped after $1 seconds, the time limit for building this list.', settings.sortTimeLimit);
    let stopped = '';
    const cards = productCardsIn(document);
    lastRead = { search: searchOf(location.href), sig: signature(cards) };
    for (const card of cards) add(extractProduct(card, 1, settings));
    const scores = new Map();
    const list = () => [...products.values()].map(p => ({ ...p, ...(scores.get(p.asin) || { score: null, verdict: '', source: 'unrated' }) }));
    const noScore = () => [...products.values()].map(p => p.asin).filter(a => a && !scores.has(a));
    const counting = () => t('sortStatusFound', '$1 listings so far.', products.size);

    if (!products.size) {
      await publish(token, [], false, t('sortNoCardsHelp', 'No Amazon product cards were found. Check that this is a search results page, then refresh after listings load.'), true);
      return;
    }
    if (!pricesOnly) for (const [a, s] of await knownScores(noScore())) scores.set(a, s);
    if (!await publish(token, list(), true, pricesOnly ? counting() : `${counting()} ${t('sortStatusChecking', 'Checking saved scores…')}`, true)) return;
    if (!pricesOnly) for (const [a, s] of await sharedScores(noScore(), token)) scores.set(a, s);
    if (!await publish(token, list(), true, counting(), true)) return;

    // Further Amazon results pages, when "Load more results" is on.
    let partialError = '';
    // Amazon results pages in this list: the product-page budget is the badges' per-page cap for each.
    let pagesInList = 1;
    if (settings.sortLoadMore && products.size < settings.sortCount) {
      let nextUrl = findNextPage(document, location.href);
      let pageNumber = 1;
      while (products.size < settings.sortCount && nextUrl && token === run && !timeUp()) {
        pageNumber += 1;
        await publish(token, list(), true, t('sortLoadingPage', 'Loading Amazon results page $1 ($2 products found)…', pageNumber, products.size), true);
        try {
          await sleep(S().pace().gapMs);
          const controller = new AbortController();
          controllers.add(controller);
          let response;
          const signal = AbortSignal.any ? AbortSignal.any([controller.signal, AbortSignal.timeout(LOAD_MORE_TIMEOUT_MS)]) : controller.signal;
          try { response = await fetch(nextUrl, { credentials: 'same-origin', headers: { Accept: 'text/html' }, signal }); }
          catch (error) {
            if (error && error.name === 'TimeoutError') throw new Error(t('sortPageTimeout', 'Amazon took too long to send the next results page'), { cause: error });
            throw error;
          } finally { controllers.delete(controller); }
          if (!response.ok) throw new Error(`Amazon returned ${response.status}`);
          const doc = new DOMParser().parseFromString(await root.AIR.cart.readHtml(response, signal), 'text/html');
          const cards = productCardsIn(doc);
          if (!cards.length) throw new Error('no product cards on the next page');
          pagesInList = pageNumber;
          const fresh = [];
          for (const card of cards) {
            const product = extractProduct(card, pageNumber, settings);
            if (add(product) && product.asin) fresh.push(product.asin);
            if (products.size >= settings.sortCount) break;
          }
          // Saved scores for this page now, so the list fills in as the pages arrive.
          if (!pricesOnly) for (const [a, s] of await knownScores(fresh)) scores.set(a, s);
          nextUrl = findNextPage(doc, nextUrl);
        } catch (error) {
          if (token !== run) return;
          partialError = error.message || 'Amazon could not load another results page.';
          break;
        }
      }
      if (token !== run) return;
      if (timeUp() && nextUrl && products.size < settings.sortCount) stopped = timeMessage();
      if (!pricesOnly) for (const [a, s] of await sharedScores(noScore(), token)) scores.set(a, s);
      if (!await publish(token, list(), true, counting(), true)) return;
    }

    // Product pages for what is still unscored, when the settings allow it.
    const rateAllowed = !pricesOnly && settings.sortMissing === 'rate-first' && state.autoScoreSearch;
    if (rateAllowed && noScore().length && token === run) {
      const asins = noScore();
      const budget = () => S().autoFetchCap() * pagesInList;
      const rated = await rateByProductPage(asins, token, (done, total, got) => {
        for (const [a, s] of got) scores.set(a, s);
        publish(token, list(), true, t('sortRatingMore', 'Rating listings without a score: $1 of $2…', done, total));
      }, budget, timeUp);
      for (const [a, s] of rated.scores) scores.set(a, s);
      stopped = stopped || rated.stopped || (rated.timedOut ? timeMessage() : '');
      // Tiles the badge queue finished meanwhile.
      if (!pricesOnly) for (const [a, s] of await knownScores(noScore())) scores.set(a, s);
    }
    if (token !== run) return;

    const items = list();
    const unscored = items.filter(p => p.score == null).length;
    const tail = !pricesOnly && unscored ? ' ' + unscoredTail(unscored) : '';
    const collected = t('sortCollected', 'Collected $1 products.', items.length);
    let status;
    if (stopped) status = `${stopped} ${collected}${tail}`;
    else if (partialError) status = `${collected} ${t('sortPartial', 'More results could not be loaded')} (${partialError}).${tail}`;
    else if (settings.sortLoadMore && items.length < settings.sortCount) status = `${t('sortNoMore', 'Amazon has no more results.')} ${collected}${tail}`;
    else status = `${collected}${tail}`;
    P().logAction?.('side panel list', `${status} (${items.filter(p => p.unitPrice != null).length} with a unit price)`);
    await publish(token, items, false, status, true);
  }

  // The panel's Stop button (sorted.js) asks this tab directly.
  function onPanelMessage(msg, sender, respond) {
    if (msg?.type === 'sortFollow') { if (sender?.id === chrome.runtime.id && !sender.tab) followSearch(true); return false; }
    if (msg && msg.type === 'sortStart') {
      // From this extension's worker only, for a page this extension is sorting.
      const own = sender && sender.id === chrome.runtime.id && !sender.tab;
      const ok = !!own && mounted && !(priceOnly && msg.mode !== 'unitPrice') && typeof msg.runId === 'string' && /^[\w-]{1,64}$/.test(msg.runId);
      if (typeof respond === 'function') respond({ ok });
      if (ok) startFromCommand({ mode: msg.mode === 'unitPrice' ? 'unitPrice' : 'health', runId: msg.runId });
      return false;
    }
    if (!msg || msg.type !== 'sortStop') return false;
    let fromList;
    try {
      fromList = sender && sender.id === chrome.runtime.id && !sender.tab
        && /\/src\/options\/(sorted|sidepanel)\.html(?:[?#]|$)/.test(new URL(sender.url || '').pathname + '#');
    } catch (e) { fromList = false; }
    if (!fromList || (msg.runId && msg.runId !== runId)) return false;
    run++;
    for (const c of controllers) c.abort();
    controllers.clear();
    return false;
  }
  let listening = false;

  // ------------------------------------------------------------------ lifecycle
  // Called by main.js on a food results page while Ingredient Check is on. Idempotent.
  // Only on stores whose menus and listings the tests cover (storefronts.js `sort`).
  const storeSupported = () => !SF() || SF().sortEnabled(location.hostname);
  let followedURL = '';
  function followSearch(force = false) {
    if (!mounted || (!force && followedURL === location.href)) return;
    const url = location.href, generation = run;
    followedURL = url;
    send({type:'followSortedSearch',sourceUrl:url,priceOnly,unitEnabled:P().state.unitPrice!==false}).then(reply => {
      if (reply?.ok && typeof reply.runId === 'string' && mounted && location.href === url && run === generation) void startFromCommand(reply);
    });
  }
  function mount(options = {}) {
    const nextPriceOnly = options.priceOnly === true;
    if (mounted && nextPriceOnly !== priceOnly) { unmount(); followedURL = ''; }
    priceOnly = nextPriceOnly;
    const { state } = P();
    if (!state.enabled || !isSearchPage() || !storeSupported()) return;
    if (!listening) {
      listening = true;
      window.addEventListener('pointerdown', onMenuPointer, true);
      window.addEventListener('mousedown', onMenuPointer, true);
      window.addEventListener('mouseup', onMenuPointer, true);
      window.addEventListener('click', onMenuPointer, true);
      window.addEventListener('keydown', onMenuKey, true);
      try { chrome.runtime.onMessage.addListener(onPanelMessage); } catch (e) { /* no messaging */ }
    }
    mounted = true;
    install();
    followSearch();
    if (U()) storageGet(Object.keys(U().UNIT_DEFAULTS)).then(got => {
      const next = U().sanitizeUnit(got);
      if (next.unitMissing !== unitSettings.unitMissing) { unitSettings = next; menuUnitHeld = { sig: '', unit: null }; if (mounted) install(); }
    });
    if (observer) return;
    // Amazon rebuilds the menu when results change; put the options back when it does.
    observer = new MutationObserver(() => {
      if (observerTimer) return;
      observerTimer = setTimeout(() => { observerTimer = 0; install(); }, 120);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Whenever Ingredient Check stands down on this page (master switch off, a non-food search,
  // navigation, a settings change): stop any list being built and take our options out of the menu.
  function unmount() {
    mounted = false;
    pending = false;
    run++;
    for (const c of controllers) c.abort();
    controllers.clear();
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(observerTimer);
    observerTimer = 0;
    uninstall();
  }

  // A setting that changes which options exist (price per ounce on or off).
  function refresh() { if (mounted) install(); }

  const api = { mount, unmount, refresh, isSearchPage, extractProduct, knownScores, findNextPage, sortSelects, rateByProductPage,
    ratingValue, reviewCount, getPrice, storeSupported, whyOf, VALUE, MARK, choose, get runId() { return runId; } };
  root.AIR.sort = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
