// Walmart's right-hand comparison drawer. Shares Amazon's ranking and unit-price
// engine, while leaving Walmart's own sorting/filter controls and React nodes alone.
(function(root) {
  if (!/^(?:www\.)?walmart\.com$/i.test(location.hostname)) return;
  const R = root.AIR.db.sortedResults, U = root.AIR.db.unitPrice, L = root.AIR.retailerLabels;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const unitMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
  const t = (key, fallback, value) => {
    try { return chrome.i18n.getMessage(key, value == null ? [] : [String(value)]) || fallback.replace('$1', String(value ?? '')); }
    catch { return fallback.replace('$1', String(value ?? '')); }
  };
  let host, shadow, panel, toggle, list, status, signature = '', products = [], mode = 'health', custom = null;
  let active = false, open = false;
  const fixedStyles = new Map();
  let pageScroll = 0;
  function undock() {
    document.documentElement.removeAttribute('data-air-walmart-docked');
    document.documentElement.style.removeProperty('--air-walmart-dock-width');
    for (const [node, styles] of fixedStyles) for (const [name, value, priority] of styles) {
      if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name);
    }
    fixedStyles.clear();
  }
  function dock() {
    undock();
    if (!open || innerWidth <= 800) return;
    const width = Math.min(410, innerWidth * 0.4) + 24;
    document.documentElement.style.setProperty('--air-walmart-dock-width', `${width}px`);
    document.documentElement.setAttribute('data-air-walmart-docked', '');
    // Fixed retailer headers/widgets use the viewport rather than the page's new
    // width. Keep them within the remaining page area too, preserving their styles.
    for (const node of document.body.querySelectorAll('*')) {
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
  const label = key => ({
    health: t('sortedPresetHealth', 'Healthiest'), price: t('sortedPresetPrice', 'Lowest price'),
    unitPrice: t('walmartPerOunce', 'Lowest price per oz'), balanced: t('sortedPresetBalanced', 'Balanced'),
  })[key];
  function show(value) {
    if (value && !open) pageScroll = scrollY;
    open = value;
    panel.hidden = !open; toggle.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
    dock();
    if (open) { panel.querySelector('button').focus({ preventScroll: true }); render(); if (innerWidth <= 800) panel.scrollIntoView({ block: 'start' }); }
    else { toggle.focus({ preventScroll: true }); if (innerWidth <= 800) scrollTo(0, pageScroll); }
  }
  function mount() {
    if (host?.isConnected) return;
    host = el('div'); host.id = 'air-walmart-sort';
    shadow = host.attachShadow({ mode: 'open' });
    if (!document.getElementById('air-walmart-dock-style')) {
      const layout = el('style'); layout.id = 'air-walmart-dock-style';
      layout.textContent = 'html[data-air-walmart-docked]{padding-right:var(--air-walmart-dock-width)!important;box-sizing:border-box!important}html[data-air-walmart-docked] body{width:auto!important;min-width:0!important;max-width:none!important}';
      document.head.append(layout);
    }
    const css = el('style');
    css.textContent = ':host{font:14px/1.45 system-ui,sans-serif;color:#18221d}*{box-sizing:border-box}[hidden]{display:none!important}button,a,input{font:inherit}button{cursor:pointer;background:#fff;color:#17492d;border:1px solid #9dad9f;border-radius:8px;padding:9px 12px}button:hover,button:focus-visible,a:focus-visible{outline:2px solid #257747;outline-offset:2px}button[aria-pressed=true]{background:#17492d;color:white;border-color:#17492d}.toggle{position:fixed;right:0;top:44%;z-index:2147482900;border-radius:12px 0 0 12px;box-shadow:0 2px 12px #0003;max-width:150px;font-weight:700}.drawer{position:fixed;z-index:2147482901;right:12px;top:100px;bottom:16px;width:min(410px,calc(100vw - 24px));background:#fff;border:1px solid #c9d4cc;border-radius:16px;box-shadow:0 8px 32px #0003;display:flex;flex-direction:column;overflow:hidden}.header,.controls{padding:16px;border-bottom:1px solid #e0e7e2}.header{display:flex;gap:10px;align-items:center}.header h2{font-size:18px;margin:0;flex:1}.header small{display:block;font-size:12px;font-weight:400;color:#536158}.presets{display:grid;grid-template-columns:1fr 1fr;gap:7px}.weights{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.weights label{font-size:12px}.weights input{width:100%;accent-color:#17492d}.status{margin:0;padding:10px 16px;color:#536158;font-size:12px}.list{overflow:auto;overscroll-behavior:contain;margin:0;padding:0 16px 16px;list-style:none}.item{border-top:1px solid #e0e7e2;padding:14px 0;display:flex;gap:10px;align-items:flex-start}.score{flex:none;min-width:40px;min-height:40px;border:2px solid;border-radius:50%;display:grid;place-items:center;font-weight:750}.copy{min-width:0;flex:1}.copy a{color:#17492d;font-weight:650;text-decoration:none}.copy a:hover{text-decoration:underline}.facts{margin-top:6px;color:#536158;font-size:12px}.facts strong{color:#18221d;font-size:16px}.hint{color:#536158;font-size:12px;margin:9px 0 0}';
    shadow.append(css);
    css.textContent += ':host{display:block}.drawer{width:min(410px,40vw)}@media(max-width:800px){.drawer{position:relative;right:auto;top:auto;bottom:auto;width:calc(100% - 24px);max-height:calc(100vh - 150px);margin:12px;scroll-margin-top:140px}.toggle{max-width:125px}}';
    toggle = el('button', t('walmartSortTab', 'Price & health'), 'toggle');
    toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'air-walmart-drawer');
    toggle.addEventListener('click', () => show(true));
    panel = el('section', null, 'drawer'); panel.id = 'air-walmart-drawer'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', t('walmartSortTitle', 'Compare Walmart results'));
    const header = el('div', null, 'header'), heading = el('h2', t('walmartSortTitle', 'Compare Walmart results'));
    heading.append(el('small', 'Ingredient Check'));
    const close = el('button', '×'); close.type = 'button'; close.setAttribute('aria-label', t('walmartSortClose', 'Close comparison'));
    close.addEventListener('click', () => show(false)); header.append(heading, close);
    const controls = el('div', null, 'controls'), presets = el('div', null, 'presets');
    for (const key of ['health', 'price', 'unitPrice', 'balanced']) {
      const b = el('button', label(key)); b.type = 'button'; b.dataset.mode = key;
      b.addEventListener('click', () => {
        mode = key; custom = null;
        list.scrollTop = 0;
        for (const input of shadow.querySelectorAll('input')) input.value = R.presetFor(mode)[input.dataset.factor];
        render();
      }); presets.append(b);
    }
    controls.append(presets);
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
    list = el('ol', null, 'list'); list.setAttribute('aria-label', t('walmartSortList', 'Walmart results ranked by your priorities'));
    panel.append(header, controls, status, list); shadow.append(toggle, panel);
    shadow.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); show(false); } });
    document.body.append(host);
  }
  function render() {
    if (!host?.isConnected || !open) return;
    for (const b of shadow.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(!custom && b.dataset.mode === mode));
    const mixed = new Set(products.filter(p => p.score != null).map(p => `${p.category}:${p.ratingStyle}`)).size > 1;
    const weights = R.sanitizeWeights(custom || R.presetFor(mode), { healthEnabled: !mixed });
    status.textContent = t('walmartSortCount', '$1 products loaded', products.length) + ' · '
      + t('walmartSortRated', '$1 rated', products.filter(p => p.score != null).length)
      + (mixed ? ' · ' + t('walmartSortMixed', 'Mixed categories: health ranking is unavailable.') : '');
    const rows = R.rank(products, weights, { family: 'weight', healthEnabled: !mixed });
    const heldScroll = list.scrollTop;
    const heldLink = shadow.activeElement?.closest('a')?.href;
    list.replaceChildren();
    for (const { product } of rows) {
      const row = el('li', null, 'item'); row.dataset.product = product.asin;
      const chip = el('span', product.score == null ? '—' : String(product.score), 'score');
      chip.setAttribute('aria-label', product.score == null ? t('sortedNoScore', 'No score') : `${product.score}/100`);
      const color = product.score == null || product.category !== 'food' ? root.AIR.db.theme.neutral() : root.AIR.db.theme.band(product.score);
      chip.style.color = color.fg; chip.style.background = color.bg; chip.style.borderColor = color.ring;
      const copy = el('div', null, 'copy'), link = el('a', product.title);
      link.href = product.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const facts = el('div', null, 'facts');
      facts.append(el('strong', product.listingPrice == null ? '—' : money.format(product.listingPrice)));
      if (product.unitPrice != null) facts.append(document.createTextNode(` · ${unitMoney.format(product.unitPrice)}/oz`));
      if (product.score == null) facts.append(document.createTextNode(' · ' + t('sortedNoScore', 'No score')));
      copy.append(link, facts); row.append(chip, copy); list.append(row);
    }
    list.scrollTop = heldScroll;
    if (heldLink) Array.from(list.querySelectorAll('a')).find(a => a.href === heldLink)?.focus({ preventScroll: true });
  }
  function update(entries) {
    if (!active) return;
    const next = [], seen = new Set();
    for (const { tile, hit } of entries) {
      if (seen.has(tile.id)) continue;
      seen.add(tile.id);
      const card = tile.el || tile.tile || tile.anchor;
      const text = L.text(card);
      // Walmart renders split visual dollars/cents; its accessibility price text
      // contains the exact decimal. Never interpret "$797" as a $797 listing.
      const priceNode = card.querySelector('[data-testid="unified-global-product-price-a11y-text"]');
      const priceText = priceNode?.textContent || card.querySelector('a[href]')?.textContent || '';
      const match = priceText.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/);
      const listingPrice = match ? Number(match[1].replace(/,/g, '')) : null;
      const unit = U.unitPricesFor({ title: tile.title, text: priceNode?.textContent || text, listingPrice }, {}, 'walmart.com');
      const ratingText = card.querySelector('[aria-label*="out of 5"]')?.getAttribute('aria-label') || '';
      const stars = ratingText.match(/([0-5](?:\.\d)?)\s+out of 5/i);
      next.push({ asin: tile.id, title: tile.title, url: root.AIR.storeAdapters.walmart.productUrl(tile.id, location),
        listingPrice, ...unit, unitPrice: unit.unitPrices.weight ?? null, score: hit?.score ?? null, category: hit?.category || 'food', ratingStyle: hit?.ratingStyle || 'food',
        ratingValue: stars ? Number(stars[1]) : null, reviewCount: null });
    }
    const sig = JSON.stringify(next);
    if (signature === sig && host?.isConnected) return;
    products = next; signature = sig; mount(); render();
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
