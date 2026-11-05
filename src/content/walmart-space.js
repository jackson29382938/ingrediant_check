// Fill only residual empty columns after Walmart's ad-slot compaction. Each
// statistic describes this loaded search, never inferred purchases or savings.
(function(root) {
  if (!/^(?:www\.)?walmart\.com$/i.test(location.hostname)) return;
  const layouts = new Map();
  let lastEntries = [];
  const titles = [
    ['walmartStatLoaded', 'Products in this search'], ['walmartStatRated', 'Ingredient ratings ready'],
    ['walmartStatAverage', 'Average ingredient score'], ['walmartStatBest', 'Highest ingredient score'],
    ['walmartStatExcellent', 'Excellent ingredient scores'], ['walmartStatLowPrice', 'Lowest listed price'],
    ['walmartStatLowUnit', 'Lowest price per ounce'], ['walmartStatAds', 'Hidden ad slots'],
    ['walmartStatWaiting', 'Labels still checking'], ['walmartStatUnknown', 'Labels unavailable'],
  ];
  const t = (key, fallback) => { try { return chrome.i18n.getMessage(key) || fallback; } catch { return fallback; } };
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 });
  function stats(entries) {
    const held = new Map(entries.map(({ tile, hit }) => [tile.id, { tile, hit }]));
    const unique = [...held.values()], scores = unique.filter(x => !x.hit?.category || x.hit.category === 'food').map(x => x.hit?.score).filter(Number.isFinite);
    const prices = [], units = [];
    let waiting = 0, unknown = 0;
    for (const { tile } of unique) {
      const card = tile.el || tile.tile || tile.anchor;
      const text = card.querySelector('[data-testid="unified-global-product-price-a11y-text"]')?.textContent || '';
      const match = text.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/);
      if (match) prices.push(Number(match[1].replace(/,/g, '')));
      const unit = root.AIR.db.unitPrice.parseDisplayedUnit(text, 'walmart.com');
      if (unit?.kind === 'weight') units.push(unit.perOz);
      const status = tile.anchor.querySelector('.air-badge')?.dataset.airStatus;
      if (status === 'checking') waiting++;
      if (status === 'unavailable') unknown++;
    }
    const ads = document.querySelectorAll('[data-air-sponsored-hidden]').length;
    const values = [unique.length, scores.length, scores.length ? `${Math.round(scores.reduce((a,b) => a+b,0)/scores.length)}/100` : '—',
      scores.length ? `${Math.max(...scores)}/100` : '—', scores.filter(n => n >= 90).length,
      prices.length ? money.format(Math.min(...prices)) : '—', units.length ? `${money.format(Math.min(...units))}/oz` : '—', ads, waiting, unknown];
    return titles.map(([key, fallback], i) => ({ title: t(key, fallback), value: String(values[i]) }));
  }
  function reset() {
    lastEntries = [];
    for (const node of document.querySelectorAll('[data-air-space-filler]')) node.remove();
    layouts.clear();
  }
  function update(entries) {
    lastEntries = entries;
    const summaries = stats(entries);
    for (const [stack] of layouts) if (!stack.isConnected) layouts.delete(stack);
    for (const stack of document.querySelectorAll('[data-air-compact-grid]')) {
      const previous = layouts.get(stack);
      // Measure the organic grid without our own cells affecting new cards that
      // Walmart may append after them. Style changes do not retrigger the page observer.
      for (const node of previous?.nodes || []) node.style.display = 'none';
      const cells = Array.from(stack.children).filter(node => node.hasAttribute('data-air-result-cell')
        && !node.hasAttribute('data-air-space-filler') && node.getClientRects().length
        && getComputedStyle(node).display !== 'none');
      const columns = getComputedStyle(stack).gridTemplateColumns.split(/\s+/).length;
      const last = cells.at(-1), top = last?.getBoundingClientRect().top;
      const row = cells.filter(node => Math.abs(node.getBoundingClientRect().top - top) < 2);
      const count = last && columns > 1 ? Math.max(0, columns - row.length) : 0;
      const height = row.length ? Math.max(...row.map(n => n.getBoundingClientRect().height)) : 0;
      // A tiny final line needs no dashboard. Never cover or replace a product,
      // full-width retailer message, or an interactive/media slot.
      const slots = height >= 240 ? Math.min(count, 5) : 0;
      const key = `${slots}:${Math.round(height)}`;
      let layout = layouts.get(stack);
      if (!layout || layout.key !== key || layout.nodes.some(n => !n.isConnected)) {
        for (const node of layout?.nodes || []) node.remove();
        layout = { key, nodes: [] }; layouts.set(stack, layout);
        for (let column = 0; column < slots; column++) {
          const node = document.createElement('div'); node.setAttribute('data-air-space-filler', ''); node.setAttribute('data-air-result-cell', '');
          node.style.cssText = `box-sizing:border-box;min-width:0;height:${Math.round(height)}px;padding:10px 24px 10px 8px`;
          const shadow = node.attachShadow({ mode: 'open' }), css = document.createElement('style');
          css.textContent = ':host{color:#253e2e;font:14px/1.4 system-ui,sans-serif}.wrap{height:100%;display:flex;flex-direction:column;gap:10px}header{font-size:12px;color:#526557}header strong{display:block;font-size:14px;color:#234d34}.stat{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;border:1px solid #d6e3d8;border-radius:12px;background:#f4f8f4;padding:12px}.title{font-size:12px;color:#526557}.value{font-size:24px;font-weight:750;color:#234d34}.note{font-size:11px;color:#526557}@media (prefers-color-scheme:dark){:host(:not([data-air-theme="light"])){color:#e3ece5}:host(:not([data-air-theme="light"])) header,:host(:not([data-air-theme="light"])) .title,:host(:not([data-air-theme="light"])) .note{color:#9fb2a3}:host(:not([data-air-theme="light"])) header strong,:host(:not([data-air-theme="light"])) .value{color:#8ad8a6}:host(:not([data-air-theme="light"])) .stat{background:#18221b;border-color:#2d4033}}:host([data-air-theme="dark"]){color:#e3ece5}:host([data-air-theme="dark"]) header,:host([data-air-theme="dark"]) .title,:host([data-air-theme="dark"]) .note{color:#9fb2a3}:host([data-air-theme="dark"]) header strong,:host([data-air-theme="dark"]) .value{color:#8ad8a6}:host([data-air-theme="dark"]) .stat{background:#18221b;border-color:#2d4033}';
          const wrap = document.createElement('section'); wrap.className = 'wrap'; wrap.setAttribute('aria-label', t('walmartStatSection', 'Ingredient Check search summaries'));
          const header = document.createElement('header'), brand = document.createElement('strong'); brand.textContent = 'Ingredient Check';
          header.append(brand, document.createTextNode(t('walmartStatScope', 'This loaded search'))); wrap.append(header);
          const limit = height >= 480 ? Math.min(titles.length, slots * 4) : Math.min(titles.length, slots * 2);
          for (let i = column; i < limit; i += slots) {
            const stat = document.createElement('div'); stat.className = 'stat'; stat.dataset.stat = String(i);
            const title = document.createElement('span'); title.className = 'title'; title.textContent = summaries[i].title;
            const value = document.createElement('span'); value.className = 'value'; value.textContent = summaries[i].value;
            stat.append(title, value); wrap.append(stat);
          }
          const note = document.createElement('div'); note.className = 'note'; note.textContent = t('walmartStatNote', 'Updates as labels arrive. Missing values stay unknown.'); wrap.append(note);
          shadow.append(css, wrap); stack.append(node); layout.nodes.push(node);
        }
      }
      for (const node of layout.nodes) { root.AIR.db.theme?.force?.(node); node.style.removeProperty('display'); }
      for (const node of layout.nodes) for (const stat of node.shadowRoot.querySelectorAll('[data-stat]')) {
        const value = summaries[Number(stat.dataset.stat)].value;
        const label = stat.querySelector('.value');
        if (label.textContent !== value) label.textContent = value;
      }
    }
  }
  root.AIR.retailerSpace = { update, reset };
  addEventListener('resize', () => requestAnimationFrame(() => {
    if (lastEntries.length) update(lastEntries.filter(({ tile }) => tile.anchor.isConnected));
  }));
})(typeof globalThis !== 'undefined' ? globalThis : self);
