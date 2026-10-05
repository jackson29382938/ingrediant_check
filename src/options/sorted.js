// The sorted list, in Chrome's side panel (sidepanel.html) or a tab (sorted.html). Ported from the
// Amazon Cost per Ounce Sorter's results view, with a priority bar: the reader weighs health score,
// price per ounce, total price, customer rating and number of reviews, and the list re-ranks at once
// (AIR.db.sortedResults.rank). Choosing an option in Amazon's sort menu opens this with that option's
// preset; the listings arrive while it is open (src/content/sort.js -> worker -> session storage).
//
// Everything is rendered with textContent. Links and images were already limited to Amazon by the
// worker (sanitizeResults), and are re-checked here. The buttons use chrome.tabs and chrome.sidePanel
// directly: an extension page needs no message to the worker for them.

(function () {
  const R = AIR.db.sortedResults;
  const { BAND_COLOR } = AIR.panel;
  const root = document.querySelector('#results-root');
  const isPanel = document.body.dataset.view === 'panel';
  // Prices in the currency and style of the store the list came from (storefronts.js), and a price per
  // ounce as that store's shoppers read it: per ounce on amazon.com, per 100 g / 100 ml elsewhere.
  const SF = AIR.db.storefronts;
  const store = () => SF.storefront(saved && saved.sourceUrl);
  const metric = () => store().units === 'metric';
  const formatters = new Map();
  const money = value => {
    const { currency, locale } = store();
    const key = `${locale}|${currency}`;
    if (!formatters.has(key)) {
      try { formatters.set(key, new Intl.NumberFormat(locale, { style: 'currency', currency })); }
      catch (e) { formatters.set(key, new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })); }
    }
    return formatters.get(key).format(value);
  };
  const count = { format: n => new Intl.NumberFormat(store().locale).format(n) };
  const t = (key, fallback, ...subs) => {
    const args = subs.map(String);
    let text = '';
    try { text = (chrome.i18n && chrome.i18n.getMessage(key, args)) || ''; } catch (e) { /* no locale */ }
    return text || fallback.replace(/\$(\d)/g, (m, n) => (args[n - 1] != null ? args[n - 1] : m));
  };

  const FACTOR_TEXT = {
    health: () => t('sortedFactorHealth', 'Health score'),
    unitPrice: () => (metric() ? t('sortedFactorUnitMetric', 'Price per 100 g') : t('sortedFactorUnit', 'Price per ounce')),
    price: () => t('sortedFactorPrice', 'Total price'),
    rating: () => t('sortedFactorRating', 'Customer rating'),
    reviews: () => t('sortedFactorReviews', 'Number of reviews'),
  };
  const PRESET_TEXT = {
    health: () => t('sortedPresetHealth', 'Healthiest'),
    unitPrice: () => (metric() ? t('sortedPresetUnitMetric', 'Cheapest per 100 g') : t('sortedPresetUnit', 'Cheapest per ounce')),
    balanced: () => t('sortedPresetBalanced', 'Balanced'),
    price: () => t('sortedPresetPrice', 'Lowest price'),
    rating: () => t('sortedPresetRating', 'Best rated'),
  };
  const HEADING_TEXT = {
    health: () => t('sortedTitleHealth', 'Healthiest first'),
    unitPrice: () => (metric() ? t('sortedTitleUnitMetric', 'Lowest price per 100 g first') : t('sortedTitleUnit', 'Lowest price per ounce first')),
    balanced: () => t('sortedTitleBalanced', 'Balanced: health, price per ounce and rating'),
    price: () => t('sortedTitlePrice', 'Lowest price first'),
    rating: () => t('sortedTitleRating', 'Best rated first'),
    custom: () => t('sortedTitleCustom', 'Ranked by your priorities'),
  };
  const SOURCE_TEXT = {
    scored: () => t('sortedSrcScored', 'Ingredient Check score, under your current settings'),
    unreadable: () => t('sortedSrcUnreadable', 'No readable ingredient list on Amazon'),
    'not-food': () => t('sortedSrcNotFood', 'Not scored: does not look like food'),
    unrated: () => t('sortedSrcUnrated', 'Not scored yet'),
  };
  const MISSING_TEXT = {
    health: () => t('sortedMissingHealth', 'no score'),
    unitPrice: () => (metric() ? t('sortedMissingUnitMetric', 'no price per 100 g') : t('sortedMissingUnit', 'no price per ounce')),
    price: () => t('sortedMissingPrice', 'no price'),
    rating: () => t('sortedMissingRating', 'no rating'),
    reviews: () => t('sortedMissingReviews', 'no reviews count'),
  };

  let saved = null;           // chrome.storage.session sortedResults
  let weights = R.presetFor('health');
  let windowId = null;
  let saveTimer = 0;
  let lastSaved = '';     // our own write, echoed back by storage.onChanged
  const ui = {};

  try { chrome.windows.getCurrent(w => { void chrome.runtime.lastError; if (w) windowId = w.id; }); } catch (e) { /* no windows API */ }

  const logUi = what => { try { AIR.db.activity && AIR.db.activity.log(isPanel ? 'side panel' : 'list tab', what); } catch (e) { /* ignore */ } };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function button(className, text, onClick) {
    const b = node('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  const unitEnabled = () => !saved || saved.unitEnabled !== false;
  const activePreset = () => Object.keys(R.PRESETS).find(id => {
    const p = R.sanitizeWeights(R.PRESETS[id], { unitEnabled: unitEnabled() });
    return R.FACTORS.every(f => p[f] === weights[f]);
  }) || 'custom';

  // ---------------------------------------------------------------- buttons
  async function backToAmazon() {
    logUi('Back to Amazon search');
    const url = R.sanitizeSourceUrl(saved && saved.sourceUrl);
    if (!url) return;
    const tabId = saved && saved.sourceTabId;
    if (Number.isInteger(tabId)) {
      try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, tab.url === url ? { active: true } : { url, active: true });
        if (Number.isInteger(tab.windowId)) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        return;
      } catch (e) { /* the Amazon tab was closed: open the search again */ }
    }
    chrome.tabs.create({ url }).catch(() => {});
  }
  function openInTab() {
    logUi('Open in new tab');
    const target = Number.isInteger(windowId) ? { windowId } : Number.isInteger(saved && saved.sourceWindowId) ? { windowId: saved.sourceWindowId } : {};
    chrome.tabs.create({ ...target, url: chrome.runtime.getURL('src/options/sorted.html') }).catch(() => {
      ui.openTab.textContent = t('sortedOpenTabFail', 'Could not open a new tab. Try again from Chrome.');
    });
  }
  // Synchronous inside the click, so Chrome counts it as the user's action.
  function openSidePanel(b) {
    const target = windowId != null ? { windowId } : Number.isInteger(saved && saved.sourceWindowId) ? { windowId: saved.sourceWindowId } : null;
    const fail = () => { b.textContent = t('sortedPanelFallback', 'Open the side panel from Chrome’s side panel menu'); };
    if (!target || !chrome.sidePanel || typeof chrome.sidePanel.open !== 'function') { fail(); return; }
    try { chrome.sidePanel.open(target).catch(fail); } catch (e) { fail(); }
  }
  function openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#sec-sort') }).catch(() => {});
  }
  function stopRating() {
    logUi('Stop rating');
    if (!saved || !Number.isInteger(saved.sourceTabId)) return;
    try {
      chrome.tabs.sendMessage(saved.sourceTabId, { type: 'sortStop', runId: saved.runId }, () => void chrome.runtime.lastError);
    } catch (e) { /* the tab is gone */ }
    ui.stop.disabled = true;
  }

  // ---------------------------------------------------------------- the page, built once
  function build() {
    root.textContent = '';
    const header = node('header', 'results-header');
    const headingGroup = node('div');
    headingGroup.append(node('p', 'eyebrow', t('sortedEyebrow', 'INGREDIENT CHECK')));
    ui.title = node('h1');
    headingGroup.append(ui.title);
    ui.subtitle = node('p', 'results-subtitle');
    headingGroup.append(ui.subtitle);
    ui.status = node('p', 'results-status');
    ui.status.setAttribute('role', 'status');
    ui.status.setAttribute('aria-live', 'polite');
    headingGroup.append(ui.status);
    header.append(headingGroup);

    const actions = node('div', 'header-actions');
    ui.back = button('button secondary', t('sortedBack', 'Back to Amazon search'), backToAmazon);
    actions.append(ui.back);
    if (isPanel) {
      ui.openTab = button('button secondary', t('sortedOpenTab', 'Open in new tab'), openInTab);
      actions.append(ui.openTab);
    }
    else {
      const panelButton = button('button secondary', t('sortedOpenPanel', 'Open side panel'), () => openSidePanel(panelButton));
      actions.append(panelButton);
    }
    ui.stop = button('button secondary', t('sortedStop', 'Stop rating'), stopRating);
    actions.append(ui.stop);
    actions.append(button('button tertiary', t('sortedSettings', 'Settings'), openSettings));
    header.append(actions);
    root.append(header);

    root.append(buildPriorities());
    ui.list = node('section', 'result-list');
    ui.list.setAttribute('aria-label', t('sortedListAria', 'Amazon listings ranked by your priorities'));
    root.append(ui.list);
    ui.empty = node('section', 'empty-state');
    root.append(ui.empty);
  }

  function buildPriorities() {
    const box = node('details', 'priorities');
    box.open = true;
    box.append(node('summary', '', t('sortedPriorities', 'Prioritize')));
    ui.presets = node('div', 'preset-row');
    ui.presets.setAttribute('role', 'group');
    ui.presets.setAttribute('aria-label', t('sortedPresetsAria', 'Starting points'));
    for (const id of Object.keys(R.PRESETS)) {
      const b = button('chip', PRESET_TEXT[id](), () => {
        logUi(`preset ${id}`);
        weights = R.sanitizeWeights(R.PRESETS[id], { unitEnabled: unitEnabled() });
        paintSliders();
        renderList();
        saveWeights();
      });
      b.dataset.preset = id;
      ui.presets.append(b);
    }
    box.append(ui.presets);
    ui.sliders = {};
    const grid = node('div', 'slider-grid');
    for (const f of R.FACTORS) {
      const row = node('label', 'slider');
      row.dataset.factor = f;
      const name = node('span', 'slider-name', FACTOR_TEXT[f]());
      const input = node('input');
      input.type = 'range';
      input.min = '0';
      input.max = String(R.WEIGHT_MAX);
      input.step = '1';
      const value = node('output', 'slider-value');
      input.addEventListener('change', () => logUi(`slider ${f}=${input.value}`));
      input.addEventListener('input', () => {
        weights = R.sanitizeWeights({ ...weights, [f]: Number(input.value) }, { unitEnabled: unitEnabled() });
        paintSliders();
        scheduleRender();
        saveWeights();
      });
      row.append(name, input, value);
      grid.append(row);
      ui.sliders[f] = { row, input, value, name };
    }
    box.append(grid);
    box.append(node('p', 'priority-note', t('sortedPriorityNote',
      'Drag toward 10 for what matters most, 0 to ignore it. A listing missing a value counts as the worst on it. Prices compare on a log scale; price per ounce and price come from the results page, never a coupon or subscription price.')));
    return box;
  }

  function paintSliders() {
    for (const f of R.FACTORS) {
      const s = ui.sliders[f];
      s.row.hidden = f === 'unitPrice' && !unitEnabled();
      s.name.textContent = FACTOR_TEXT[f]();   // per ounce or per 100 g, once the list's store is known
      if (document.activeElement !== s.input) s.input.value = String(weights[f]);
      s.value.textContent = String(weights[f]);
    }
    const active = activePreset();
    for (const b of ui.presets.children) {
      b.setAttribute('aria-pressed', String(b.dataset.preset === active));
      b.hidden = b.dataset.preset === 'unitPrice' && !unitEnabled();
      b.textContent = PRESET_TEXT[b.dataset.preset]();
    }
    ui.title.textContent = HEADING_TEXT[active]();
  }

  // Kept across searches and restarts, one set per way the list was opened, unless the reader turned
  // "Remember my priorities" off. The next list opened the same way starts from them (background.js).
  async function rememberWeights(current) {
    const mode = saved && R.PRIORITY_MODES.includes(saved.mode) ? saved.mode : null;
    if (!mode) return;
    try {
      const conf = await chrome.storage.local.get(['sortRemember', 'sortPriorities']);
      if (!AIR.db.prefs.sanitizeToggles(conf).sortRemember) return;
      const all = R.sanitizePriorities(conf).sortPriorities;
      all[mode] = R.sanitizeWeights(current);
      await chrome.storage.local.set({ sortPriorities: all });
    } catch (e) { /* not an extension page, or storage unavailable: this list still keeps them */ }
  }

  // Kept for the other view (panel <-> tab) while the browser is open.
  function saveWeights() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      lastSaved = JSON.stringify(weights);
      try { chrome.storage.session.set({ sortWeights: weights }); } catch (e) { /* not an extension page */ }
      rememberWeights(weights);
    }, 250);
  }

  // ---------------------------------------------------------------- the list
  // "What's good" / "What hurt": the same rows as the product panel and the results-page hover card.
  function whyList(why) {
    const box = node('div', 'why');
    if (!why) {
      box.append(node('p', 'why-none', t('sortedWhyNone', 'The reasons were not kept for this saved score. Open the product to see why.')));
      return box;
    }
    const section = (rows, head, kind) => {
      if (!rows || !rows.length) return;
      box.append(node('h4', '', head));
      const ul = node('ul');
      for (const r of rows) {
        const li = node('li', r.c === 'CAP' ? 'capflag' : kind);
        li.append(node('span', 'pts', r.c === 'CAP' ? 'CAP' : r.c > 0 ? `+${r.c}` : String(r.c)));
        const text = node('span', 'why-text', r.why);
        if (r.ing) text.append(node('span', 'ing', ` — ${r.ing}`));
        li.append(text);
        ul.append(li);
      }
      box.append(ul);
    };
    section(why.caps, t('headDisqualifying', 'Disqualifying'), 'minus');
    section(why.plus, t('headGood', "What's good"), 'plus');
    section(why.minus, t('headHurt', 'What hurt'), 'minus');
    section(why.neutral, t('headNeutral', 'Not counted against it'), 'plus');
    if (!box.children.length) box.append(node('p', 'why-none', t('breakdownClean', 'Nothing on this label moved the score up or down.')));
    return box;
  }

  // Hovering or focusing a score shows why, in one shared pop-up.
  // The pop-up stays while the pointer moves from the score onto it, so its reasons can be read and
  // scrolled (WCAG 1.4.13, content on hover must be hoverable); Escape or leaving both closes it.
  let pop = null;
  let hideTimer = 0;
  function leaveSoon() { clearTimeout(hideTimer); hideTimer = setTimeout(hideWhy, 150); }
  function showWhy(chip, product) {
    hideWhy();
    pop = node('div', 'why-pop');
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', leaveSoon);
    pop.setAttribute('role', 'tooltip');
    pop.id = 'why-pop';
    pop.append(node('p', 'why-pop-head', t('sortedWhyHead', 'Why it scored $1', product.score)), whyList(product.why));
    document.body.append(pop);
    chip.setAttribute('aria-describedby', 'why-pop');
    const r = chip.getBoundingClientRect();
    const width = Math.min(320, document.documentElement.clientWidth - 16);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - width - 8)) + scrollX}px`;
    const below = innerHeight - r.bottom;
    if (below >= pop.offsetHeight + 12 || below >= r.top) pop.style.top = `${r.bottom + 6 + scrollY}px`;
    else pop.style.top = `${r.top - 6 - pop.offsetHeight + scrollY}px`;
  }
  function hideWhy() {
    clearTimeout(hideTimer);
    if (pop) pop.remove();
    pop = null;
    document.querySelectorAll('[aria-describedby="why-pop"]').forEach(el => el.removeAttribute('aria-describedby'));
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideWhy(); });
  addEventListener('scroll', hideWhy, { passive: true });

  function chipFor(product) {
    const score = node('div', 'score');
    if (typeof product.score === 'number') {
      const c = BAND_COLOR(product.score);
      const chip = node('span', 'score-chip', String(product.score));
      chip.style.color = c.fg;
      chip.style.background = c.bg;
      chip.style.borderColor = c.ring;
      chip.tabIndex = 0;
      chip.setAttribute('aria-label', t('sortedWhyHead', 'Why it scored $1', product.score));
      chip.addEventListener('mouseenter', () => showWhy(chip, product));
      chip.addEventListener('focus', () => showWhy(chip, product));
      chip.addEventListener('mouseleave', leaveSoon);
      chip.addEventListener('blur', hideWhy);
      score.append(chip, node('span', 'score-verdict', product.verdict || ''));
    } else {
      score.append(node('span', 'score-chip none', '–'), node('span', 'score-verdict none', t('sortedNoScore', 'No score')));
    }
    score.append(node('small', '', (SOURCE_TEXT[product.source] || SOURCE_TEXT.unrated)()));
    return score;
  }

  // One listing's DOM, built once and kept while the listing is unchanged (views below): re-ranking
  // 500 listings used to rebuild every one of them, about half a second per slider step. Only the
  // rank, the match number and the missing-values line change with the priorities.
  function makeProduct(product) {
    const article = node('article', product.image ? 'product' : 'product no-image');
    if (product.image) {
      const image = node('img', 'product-image');
      image.src = product.image;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      article.append(image);
    }
    const content = node('div', 'product-content');
    const heading = node('h2');
    const rank = node('span', 'rank', '');
    heading.append(rank, ' ');
    if (product.url) {
      const link = node('a', '', product.title || 'Amazon listing');
      link.href = product.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      heading.append(link);
    } else heading.append(product.title || 'Amazon listing');
    content.append(heading);
    content.append(chipFor(product));

    const facts = node('div', 'facts');
    if (unitEnabled()) {
      const shown = AIR.db.unitPrice.displayUnit(product.unitPrice, product.unitKind, store().units);
      const PER = {
        oz: v => t('sortedPerOunce', '$1/oz', v), floz: v => t('sortedPerFlOunce', '$1/fl oz', v),
        '100g': v => t('sortedPer100g', '$1/100 g', v), '100ml': v => t('sortedPer100ml', '$1/100 ml', v),
      };
      const unit = node('span', 'fact unit', shown
        ? PER[shown.per](money(shown.value))
        : metric() ? t('sortedNoUnitMetric', 'No price per 100 g') : t('sortedNoUnit', 'No price per ounce'));
      if (product.unitPrice != null) unit.title = product.unitSource === 'amazon'
        ? t('sortedUnitAmazon', 'Amazon’s unit price') : t('sortedUnitCalculated', 'Worked out from the listed price and package size');
      facts.append(unit);
    }
    if (product.listingPrice != null) facts.append(node('span', 'fact', money(product.listingPrice)));
    if (product.ratingValue != null) facts.append(node('span', 'fact', `★ ${product.ratingValue.toLocaleString(store().locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`));
    if (product.reviewCount != null) facts.append(node('span', 'fact', t('sortedReviews', '$1 reviews', count.format(product.reviewCount))));
    const match = node('span', 'fact match', '');
    facts.append(match);
    content.append(facts);

    const meta = node('div', 'product-meta');
    if (product.bought) meta.append(node('span', '', product.bought));
    if (product.sponsored) meta.append(node('span', '', t('sortedSponsored', 'Sponsored')));
    meta.append(node('span', '', product.pageNumber > 1
      ? t('sortedResultPage', 'Amazon page $1', product.pageNumber) : t('sortedResultFirst', 'Amazon page 1')));
    const missing = node('span', 'missing', '');
    meta.append(missing);
    content.append(meta);

    if (typeof product.score === 'number') {
      const details = node('details', 'why-details');
      details.append(node('summary', '', t('sortedWhyHead', 'Why it scored $1', product.score)));
      details.append(whyList(product.why));
      content.append(details);
    }
    article.append(content);
    return { article, rank, match, missing };
  }

  // key -> { sig, article, rank, match, missing }. A listing whose data, store or price-per-ounce
  // setting changed is built again; the rest are moved.
  const views = new Map();
  function viewFor(product) {
    const key = product.asin || product.url;
    const sig = `${unitEnabled()}|${store().key}|${JSON.stringify(product)}`;
    const held = views.get(key);
    if (held && held.sig === sig) return held;
    const view = { ...makeProduct(product), sig };
    views.set(key, view);
    return view;
  }

  // Slider drags fire many input events: draw at most once a frame.
  let frame = 0;
  function scheduleRender() {
    if (frame) return;
    const draw = () => { frame = 0; renderList(); };
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : setTimeout(draw, 16);
  }

  function renderList() {
    hideWhy();
    // Re-checked on read too: session storage is shared with every extension page.
    const items = R.sanitizeResults(saved && saved.items);
    const loading = !!(saved && saved.loading);
    ui.back.hidden = !R.sanitizeSourceUrl(saved && saved.sourceUrl);
    ui.stop.hidden = !loading;
    if (!loading) ui.stop.disabled = false;
    ui.status.textContent = R.sanitizeStatus(saved && saved.status);
    root.setAttribute('aria-busy', String(loading));
    ui.empty.textContent = '';
    ui.empty.hidden = items.length > 0;
    clearTimeout(ui.stallTimer);
    if (!items.length) {
      ui.list.textContent = '';
      views.clear();
      ui.subtitle.textContent = '';
      const status = R.sanitizeStatus(saved && saved.status);
      ui.empty.append(node('h2', '', loading ? t('sortedReading', 'Reading Amazon listings…')
        : saved ? t('sortedNothingFound', 'No listings came back') : t('sortedEmptyTitle', 'No sorted results yet')));
      if (!loading) {
        ui.empty.append(node('p', '', status || t('sortedEmptyBody', 'On an Amazon grocery search, open Amazon’s “Sort by” menu and choose “Ingredient Check score: High to Low” or “Price per ounce: Low to High”.')));
        ui.status.textContent = '';
      } else {
        // The Amazon tab sends the first listings within a second or two. If nothing has come, say so
        // rather than leaving an empty panel.
        const started = Number(saved && saved.t) || Date.now();
        const waitMs = Math.max(0, 12000 - (Date.now() - started));
        ui.stallTimer = setTimeout(() => {
          if (!saved || !saved.loading || (saved.items || []).length) return;
          ui.empty.append(node('p', '', t('sortedStalled', 'Nothing has arrived from the Amazon tab yet. Refresh the Amazon results page (after reloading the extension, old tabs lose their connection to it) and choose the option again.')));
        }, waitMs);
      }
      return;
    }
    const ranked = R.rank(items, weights, { unitEnabled: unitEnabled() });
    const multi = R.FACTORS.filter(f => weights[f] > 0).length > 1;
    ui.subtitle.textContent = loading
      ? t('sortedSubtitleLoading', '$1 listings so far · still loading', items.length)
      : t('sortedSubtitleDone', '$1 listings · scored on your computer with your settings', items.length);
    const shown = new Set();
    // In place: a listing already in the right position is not touched, and the others are moved,
    // not rebuilt. Detaching and re-attaching all 500 cost more than everything else put together.
    let at = ui.list.firstElementChild;
    ranked.forEach(({ product, match, missing }, index) => {
      const view = viewFor(product);
      shown.add(product.asin || product.url);
      const rankText = `${index + 1}.`;
      if (view.rank.textContent !== rankText) view.rank.textContent = rankText;
      const matchText = multi ? t('sortedMatch', 'Match $1', match) : '';
      if (view.match.textContent !== matchText) view.match.textContent = matchText;
      view.match.hidden = !multi;
      const missingText = missing.map(f => MISSING_TEXT[f]()).join(', ');
      if (view.missing.textContent !== missingText) view.missing.textContent = missingText;
      view.missing.hidden = !missing.length;
      if (at === view.article) at = at.nextElementSibling;
      else ui.list.insertBefore(view.article, at);
    });
    // Whatever is left after the last ranked listing is gone from the list.
    while (at) { const next = at.nextElementSibling; at.remove(); at = next; }
    for (const key of [...views.keys()]) if (!shown.has(key)) views.delete(key);
  }

  async function load() {
    let got = {};
    try { got = await chrome.storage.session.get(['sortedResults', 'sortWeights']); } catch (e) { got = {}; }
    saved = got.sortedResults || null;
    weights = R.sanitizeWeights(got.sortWeights || R.presetFor(saved && saved.mode), { unitEnabled: unitEnabled() });
    paintSliders();
    renderList();
  }

  build();
  // New listings (or a new choice in Amazon's menu) while this page is open.
  try {
    // A new score palette while the list is open: the chips are painted again under it.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.palette) { AIR.db.theme.use({ ...AIR.db.theme.state, palette: changes.palette.newValue }); scheduleRender(); }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      if (changes.sortedResults) saved = changes.sortedResults.newValue || null;
      if (changes.sortWeights && JSON.stringify(changes.sortWeights.newValue) !== lastSaved) {
        weights = R.sanitizeWeights(changes.sortWeights.newValue, { unitEnabled: unitEnabled() });
      }
      if (changes.sortedResults || changes.sortWeights) { paintSliders(); scheduleRender(); }
    });
  } catch (e) { /* not an extension page */ }
  load().catch(() => renderList());
})();
