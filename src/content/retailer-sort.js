// The sort panel for store search pages whose cards state a price (Walmart, Target). It shares Amazon's
// ranking and unit-price engine and leaves the store's own sort menu, filters and React nodes alone: it only
// reads the cards the page already shows and lists them again, in the order the shopper asks for, in a panel
// docked beside the page.
//
// "Price per unit: low to high" is the headline order. A listing is priced per ounce, per fluid ounce or
// per item, whichever its card states or its title gives unambiguously, and those families are never
// converted into one another (see unit-price.js). So the list is ranked in ONE family at a time, chosen from
// what most of the loaded results already show, or by the shopper; listings that cannot be priced in it
// stay at the end, marked, in the store's own order. A price is never guessed.
(function(root) {
  const adapter = Object.values(root.AIR.storeAdapters || {}).find(a => a.matchesHost(location.hostname));
  if (!adapter || typeof adapter.readListing !== 'function') return;
  const R = root.AIR.db.sortedResults, U = root.AIR.db.unitPrice;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const unitMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
  const t = (key, fallback, ...values) => {
    const fill = text => values.reduce((out, value, i) => out.replace(`$${i + 1}`, String(value ?? '')), text);
    try { return chrome.i18n.getMessage(key, values.map(String)) || fill(fallback); }
    catch { return fill(fallback); }
  };
  const MODES = ['unitPrice', 'health', 'price', 'balanced'];
  const SAVED = 'air-sort';
  // The choice and whether the panel was open survive moving between searches in this tab, nothing more.
  const remembered = (() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SAVED) || '{}');
      return { mode: MODES.includes(saved.mode) ? saved.mode : 'unitPrice', unit: saved.unit === 'auto' || U.isUnitId(saved.unit) ? saved.unit : 'auto', open: saved.open === true };
    } catch { return { mode: 'unitPrice', unit: 'auto', open: false }; }
  })();
  let host, shadow, panel, toggle, list, status, picker, note, signature = '', products = [], custom = null;
  let mode = remembered.mode, unit = remembered.unit, active = false, open = false, wantOpen = remembered.open;
  const fixedStyles = new Map();
  let pageScroll = 0;
  function remember() { try { sessionStorage.setItem(SAVED, JSON.stringify({ mode, unit, open })); } catch { /* storage may be blocked */ } }
  function undock() {
    document.documentElement.removeAttribute('data-air-sort-docked');
    document.documentElement.style.removeProperty('--air-sort-dock-width');
    for (const [node, styles] of fixedStyles) for (const [name, value, priority] of styles) {
      if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name);
    }
    fixedStyles.clear();
  }
  function dock() {
    undock();
    if (!open || innerWidth <= 800) return;
    const width = Math.min(440, innerWidth * 0.4) + 24;
    document.documentElement.style.setProperty('--air-sort-dock-width', `${width}px`);
    document.documentElement.setAttribute('data-air-sort-docked', '');
    // Fixed retailer headers/widgets use the viewport rather than the page's new
    // width. Keep them within the remaining page area too, preserving their styles.
    for (const node of document.body.querySelectorAll('*')) {
      if (node === host) continue;
      const css = getComputedStyle(node);
      if (css.position !== 'fixed') continue;
      const rect = node.getBoundingClientRect();
      if (rect.right <= innerWidth - width || !rect.width) continue;
      fixedStyles.set(node, ['right', 'width', 'max-width'].map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]));
      node.style.setProperty('right', `${width + Math.max(0, innerWidth - rect.right)}px`, 'important');
      if (rect.width > innerWidth - width) {
        node.style.setProperty('width', `${Math.max(0, innerWidth - width - Math.max(0, rect.left))}px`, 'important');
        node.style.setProperty('max-width', '100%', 'important');
      }
    }
  }
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const modeLabel = key => ({
    unitPrice: t('retailerSortUnitLow', 'Price per unit: low to high'), health: t('sortedPresetHealth', 'Healthiest'),
    price: t('sortedPresetPrice', 'Lowest price'), balanced: t('sortedPresetBalanced', 'Balanced'),
  })[key];
  const unitChoice = id => U.UNIT_CHOICES.find(u => u.id === id);
  const unitName = id => (id === 'ct' ? t('retailerUnitItem', 'item') : unitChoice(id)?.short || id);
  function show(value) {
    if (value && !open) pageScroll = scrollY;
    open = value; remember();
    panel.hidden = !open; toggle.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
    dock();
    if (open) { panel.querySelector('button').focus({ preventScroll: true }); render(); if (innerWidth <= 800) panel.scrollIntoView({ block: 'start' }); }
    else { toggle.focus({ preventScroll: true }); if (innerWidth <= 800) scrollTo(0, pageScroll); }
  }
  function syncSliders() {
    const weights = custom || R.presetFor(mode);
    for (const input of shadow.querySelectorAll('input')) input.value = weights[input.dataset.factor];
  }
  function mount() {
    if (host?.isConnected) return;
    host = el('div'); host.id = 'air-retailer-sort';
    shadow = host.attachShadow({ mode: 'open' });
    if (!document.getElementById('air-sort-dock-style')) {
      const layout = el('style'); layout.id = 'air-sort-dock-style';
      layout.textContent = 'html[data-air-sort-docked]{padding-right:var(--air-sort-dock-width)!important;box-sizing:border-box!important}html[data-air-sort-docked] body{width:auto!important;min-width:0!important;max-width:none!important}';
      document.head.append(layout);
    }
    const css = el('style');
    css.textContent = ':host{display:block;font:14px/1.45 system-ui,sans-serif;color:#18221d}*{box-sizing:border-box}[hidden]{display:none!important}button,a,input,select{font:inherit}button{cursor:pointer;background:#fff;color:#17492d;border:1px solid #9dad9f;border-radius:8px;padding:9px 12px}button:hover,button:focus-visible,a:focus-visible,select:focus-visible{outline:2px solid #257747;outline-offset:2px}button[aria-pressed=true]{background:#17492d;color:white;border-color:#17492d}'
      + '.toggle{position:fixed;right:0;top:44%;z-index:2147482900;border-radius:12px 0 0 12px;box-shadow:0 2px 12px #0003;max-width:150px;font-weight:700}'
      + '.drawer{position:fixed;z-index:2147482901;right:12px;top:100px;bottom:16px;width:min(440px,40vw);background:#fff;border:1px solid #c9d4cc;border-radius:16px;box-shadow:0 8px 32px #0003;display:flex;flex-direction:column;overflow:hidden}'
      + '.header,.controls{padding:14px 16px;border-bottom:1px solid #e0e7e2}.header{display:flex;gap:10px;align-items:center}.header h2{font-size:18px;margin:0;flex:1}.header small{display:block;font-size:12px;font-weight:400;color:#536158}'
      + '.presets{display:grid;grid-template-columns:1fr 1fr;gap:7px}.presets button:first-child{grid-column:1/-1;font-weight:700}'
      + '.per{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px}.per select{flex:1;min-width:0;padding:7px 8px;border:1px solid #9dad9f;border-radius:8px;background:#fff;color:#18221d}'
      + '.weights{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.weights label{font-size:12px}.weights input{width:100%;accent-color:#17492d}'
      + '.status{margin:0;padding:9px 16px 2px;color:#536158;font-size:12px}.note{margin:0;padding:0 16px 8px;color:#6a4b00;font-size:12px}'
      + '.list{overflow:auto;overscroll-behavior:contain;margin:0;padding:0 16px 16px;list-style:none}.item{border-top:1px solid #e0e7e2;padding:12px 0;display:grid;grid-template-columns:22px 52px minmax(0,1fr) auto;gap:10px;align-items:start}'
      + '.rank{color:#536158;font-size:12px;font-weight:700;padding-top:4px;text-align:right}.thumb{width:52px;height:52px;object-fit:contain;border-radius:8px;background:#f4f7f5}.thumb.none{display:block}'
      + '.score{min-width:40px;min-height:40px;border:2px solid;border-radius:50%;display:grid;place-items:center;font-weight:750}.copy{min-width:0}.copy a{color:#17492d;font-weight:650;text-decoration:none;overflow-wrap:anywhere}.copy a:hover{text-decoration:underline}'
      + '.facts{margin-top:5px;color:#536158;font-size:12px}.facts strong{color:#18221d;font-size:16px}.facts .unit{color:#17492d;font-weight:700}.tag{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid #c9d4cc;border-radius:999px;font-size:11px;color:#536158}'
      + '.hint{color:#536158;font-size:12px;margin:9px 0 0}'
      + '@media(max-width:800px){.drawer{position:relative;right:auto;top:auto;bottom:auto;width:calc(100% - 24px);max-height:calc(100vh - 150px);margin:12px;scroll-margin-top:140px}.toggle{max-width:125px}}';
    shadow.append(css);
    toggle = el('button', t('retailerSortTab', 'Sort results'), 'toggle');
    toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'air-sort-drawer');
    toggle.addEventListener('click', () => show(true));
    const title = t('retailerSortTitle', 'Sort $1 results', adapter.name);
    panel = el('section', null, 'drawer'); panel.id = 'air-sort-drawer'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title);
    const header = el('div', null, 'header'), heading = el('h2', title);
    heading.append(el('small', 'Ingredient Check'));
    const close = el('button', '×'); close.type = 'button'; close.setAttribute('aria-label', t('walmartSortClose', 'Close comparison'));
    close.addEventListener('click', () => show(false)); header.append(heading, close);
    const controls = el('div', null, 'controls'), presets = el('div', null, 'presets');
    presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', t('sortedPresetsAria', 'Starting points'));
    for (const key of MODES) {
      const b = el('button', modeLabel(key)); b.type = 'button'; b.dataset.mode = key;
      b.addEventListener('click', () => { mode = key; custom = null; remember(); list.scrollTop = 0; syncSliders(); render(); });
      presets.append(b);
    }
    controls.append(presets);
    // "Price per": which unit the price is ranked and shown in. Auto follows what most results already state.
    const per = el('label', null, 'per'); per.append(el('span', t('retailerSortPer', 'Price per')));
    picker = el('select'); picker.dataset.control = 'unit';
    picker.addEventListener('change', () => { unit = picker.value; remember(); list.scrollTop = 0; render(); });
    per.append(picker); controls.append(per);
    const weights = el('div', null, 'weights');
    for (const [factor, text] of [['health', t('walmartHealthWeight', 'Health importance')], ['unitPrice', t('walmartPriceWeight', 'Unit-price importance')]]) {
      const wrap = el('label', text), input = el('input'); input.type = 'range'; input.min = '0'; input.max = '10'; input.step = '1';
      input.value = R.presetFor(mode)[factor]; input.dataset.factor = factor;
      input.addEventListener('input', () => {
        custom = { health: 0, unitPrice: 0, price: 0, rating: 0, reviews: 0 };
        for (const range of shadow.querySelectorAll('input')) custom[range.dataset.factor] = Number(range.value);
        list.scrollTop = 0;
        render();
      }); wrap.append(input); weights.append(wrap);
    }
    controls.append(weights, el('p', t('walmartSortHint', 'Loaded results only. Ratings update as labels arrive; unknown values stay last.'), 'hint'));
    status = el('p', '', 'status'); status.setAttribute('role', 'status');
    note = el('p', '', 'note');
    list = el('ol', null, 'list'); list.setAttribute('aria-label', t('retailerSortList', 'Sorted results'));
    panel.append(header, controls, status, note, list); shadow.append(toggle, panel);
    shadow.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); show(false); } });
    document.body.append(host);
    syncSliders();
  }
  // The family and unit the list is ranked and shown in, from the shopper's choice or the loaded results.
  function unitPlan() {
    const likely = U.likelyUnit(products, 'us');
    const unitId = unit === 'auto' ? likely?.unit || 'oz' : unit;
    return { unitId, family: U.familyOf(unitId) || 'weight', auto: likely?.unit || 'oz' };
  }
  function fillPicker(plan) {
    const wanted = ['auto', ...U.UNIT_CHOICES.map(u => u.id)];
    if (picker.options.length !== wanted.length) {
      picker.replaceChildren();
      for (const id of wanted) { const option = el('option'); option.value = id; picker.append(option); }
    }
    for (const option of picker.options) {
      option.textContent = option.value === 'auto'
        ? t('retailerSortAuto', 'Automatic ($1)', unitName(plan.auto)) : unitName(option.value);
    }
    picker.value = unit;
  }
  function render() {
    if (!host?.isConnected || !open) return;
    for (const b of shadow.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(!custom && b.dataset.mode === mode));
    const mixed = new Set(products.filter(p => p.score != null).map(p => `${p.category}:${p.ratingStyle}`)).size > 1;
    const plan = unitPlan();
    fillPicker(plan);
    const weights = R.sanitizeWeights(custom || R.presetFor(mode), { healthEnabled: !mixed });
    const hiddenAds = document.querySelectorAll('[data-air-sponsored-hidden]').length;
    status.textContent = t('walmartSortCount', '$1 products loaded', products.length) + ' · '
      + t('walmartSortRated', '$1 rated', products.filter(p => p.score != null).length)
      + (hiddenAds ? ' · ' + t('retailerSortHidden', '$1 ad slots hidden', hiddenAds) : '')
      + (mixed ? ' · ' + t('walmartSortMixed', 'Mixed categories: health ranking is unavailable.') : '');
    const unpriced = products.filter(p => U.priceIn(p, plan.family) == null).length;
    note.textContent = weights.unitPrice && unpriced && products.length
      ? t('retailerSortUnpriced', '$1 listed last: no price per $2 on the card or in the title.', unpriced, unitName(plan.unitId)) : '';
    const rows = R.rank(products, weights, { family: plan.family, healthEnabled: !mixed });
    const heldScroll = list.scrollTop;
    const heldLink = shadow.activeElement?.closest('a')?.href;
    list.replaceChildren();
    rows.forEach(({ product }, index) => {
      const row = el('li', null, 'item'); row.dataset.product = product.asin;
      const copy = el('div', null, 'copy'), link = el('a', product.title);
      link.href = product.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const facts = el('div', null, 'facts');
      facts.append(el('strong', product.listingPrice == null ? '—' : money.format(product.listingPrice)));
      const perBase = U.priceIn(product, plan.family), shown = perBase == null ? null : U.perUnit(perBase, plan.unitId, adapter.storeHost);
      if (shown != null) facts.append(document.createTextNode(' · '), el('span', `${unitMoney.format(shown)}/${unitName(plan.unitId)}`, 'unit'));
      else facts.append(document.createTextNode(' · ' + t('retailerSortNoUnit', 'No unit price')));
      if (product.ratingValue != null) facts.append(document.createTextNode(` · ★ ${product.ratingValue}`));
      if (product.score == null) facts.append(document.createTextNode(' · ' + t('sortedNoScore', 'No score')));
      if (product.sponsored) facts.append(el('span', t('retailerSortSponsored', 'Sponsored'), 'tag'));
      copy.append(link, facts);
      const chip = el('span', product.score == null ? '—' : String(product.score), 'score');
      chip.setAttribute('aria-label', product.score == null ? t('sortedNoScore', 'No score') : `${product.score}/100`);
      const color = product.score == null || product.category !== 'food' ? root.AIR.db.theme.neutral() : root.AIR.db.theme.band(product.score);
      chip.style.color = color.fg; chip.style.background = color.bg; chip.style.borderColor = color.ring;
      const thumb = el('img', null, 'thumb'); thumb.alt = ''; thumb.loading = 'lazy'; thumb.referrerPolicy = 'no-referrer';
      if (product.image) thumb.src = product.image; else thumb.classList.add('none');
      row.append(el('span', String(index + 1), 'rank'), thumb, copy, chip); list.append(row);
    });
    list.scrollTop = heldScroll;
    if (heldLink) Array.from(list.querySelectorAll('a')).find(a => a.href === heldLink)?.focus({ preventScroll: true });
  }
  function update(entries) {
    if (!active) return;
    const next = [], seen = new Set();
    for (const { tile, hit } of entries) {
      if (seen.has(tile.id)) continue;
      seen.add(tile.id);
      const facts = adapter.readListing(tile);
      const unitPrices = U.unitPricesFor({ title: tile.title, text: facts.unitText, listingPrice: facts.listingPrice }, {}, adapter.storeHost);
      next.push({ asin: tile.id, title: tile.title, url: adapter.productUrl(tile.id, location), image: facts.image,
        listingPrice: facts.listingPrice, ...unitPrices,
        score: hit?.score ?? null, category: hit?.category || 'food', ratingStyle: hit?.ratingStyle || 'food',
        ratingValue: facts.ratingValue, reviewCount: facts.reviewCount, sponsored: facts.sponsored === true });
    }
    const sig = JSON.stringify(next) + document.querySelectorAll('[data-air-sponsored-hidden]').length;
    if (signature === sig && host?.isConnected) return;
    products = next; signature = sig; mount(); render();
    if (wantOpen) { wantOpen = false; if (!open) show(true); }
  }
  function reset(enabled) {
    active = enabled; products = []; signature = '';
    if (!enabled) { undock(); host?.remove(); host = null; open = false; }
    else if (host?.isConnected) render();
  }
  root.AIR.retailerSort = { update, reset };
  addEventListener('resize', () => {
    if (!open) return;
    dock();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (open && innerWidth <= 800 && panel?.isConnected) panel.scrollIntoView({ block: 'start' });
    }));
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
