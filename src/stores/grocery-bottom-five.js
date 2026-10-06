// QFC, Harris Teeter, Dillons, Safeway and Albertsons only. Public HTML declarations,
// including Albertsons' identity-bound Next Flight data; never execute the page's scripts.
(function(root) {
  const L = root.AIR.retailerLabels;
  const IDS = ['qfc', 'harristeeter', 'dillons', 'safeway', 'albertsons'];
  const PRIVATE = /^(?:cart|checkout|account|login|orders)$/i;
  function excluded(node) {
    if (node?.closest('header, nav, footer, aside, form, [hidden], [aria-hidden="true"], [role="dialog"]')) return true;
    for (let el = node; el?.getAttribute; el = el.parentNode) {
      const scope = ['id', 'class', 'data-testid', 'data-qa', 'aria-label'].map(k => el.getAttribute(k) || '').join(' ');
      if (/recommend|related[-_ ]*(?:products|items)|recently[-_ ]?viewed|you[-_ ]may[-_ ]also|account[-_ ]modal/i.test(scope) ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '')) return true;
    }
    return false;
  }
  const visible = (doc, selector) => Array.from(doc.querySelectorAll(selector)).find(el => !excluded(el)) || null;
  const declaration = value => typeof value === 'string' && value.length <= 6000 &&
    !/^\$/.test(value) && !/[<>]/.test(value) ? L.clean(value) : '';
  const DEFINITIONS = [
    ['sodium', /^sodium$/i, 'mg'], ['saturatedFat', /^saturated fat$/i, 'g'], ['transFat', /^trans fat$/i, 'g'],
    ['sugar', /^(?:total )?sugars?$/i, 'g'], ['addedSugar', /^added sugars?$/i, 'g'],
    ['carbs', /^(?:total )?carbohydrates?$/i, 'g'], ['fibre', /^dietary fib(?:er|re)$/i, 'g'], ['protein', /^protein$/i, 'g'],
  ];
  function nutrition(panels) {
    if (!Array.isArray(panels) || panels.length !== 1) return null;
    const facts = panels[0]?.nutritionFacts;
    if (!facts || !Array.isArray(facts.dailyValue)) return null;
    const out = {}, conflicts = new Set();
    let count = 0;
    function rows(values, depth = 0) {
      if (!Array.isArray(values) || depth > 4) return;
      for (const row of values) {
        if (++count > 100) return;
        const def = DEFINITIONS.find(([, pattern]) => pattern.test(row?.nutritionName || ''));
        if (def) {
          const amount = typeof row.quantity === 'string' || typeof row.quantity === 'number' ? String(row.quantity) : '';
          const units = { g: 1000, mg: 1, mcg: 0.001 };
          if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(amount) || !Object.hasOwn(units, row.uom)) conflicts.add(def[0]);
          else {
            const value = Number(amount) * units[row.uom] / units[def[2]];
            if (!Number.isFinite(value) || (out[def[0]] != null && out[def[0]] !== value)) conflicts.add(def[0]);
            else out[def[0]] = value;
          }
        }
        rows(row?.subNutritient, depth + 1);
      }
    }
    rows(facts.dailyValue);
    if (count > 100) return null;
    for (const key of conflicts) delete out[key];
    const serving = facts.servingDetails;
    if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(serving?.servingSizeText || '')) && Number(serving.servingSizeText) > 0) {
      if (serving.servingSizeUOM === 'g') out.servingGrams = Number(serving.servingSizeText);
      if (serving.servingSizeUOM === 'ml') out.servingMl = Number(serving.servingSizeText);
    }
    return Object.keys(out).length ? out : null;
  }
  function publicModel(doc, currentId) {
    let selected = null, consumed = 0;
    for (const script of doc.querySelectorAll('script')) {
      if (excluded(script)) continue;
      const raw = script.textContent || '';
      consumed += raw.length;
      if (raw.length > 4 * 1024 * 1024 || consumed > 8 * 1024 * 1024) return { invalid: true };
      if (!raw.includes('initialPdpResponse')) continue;
      for (const match of raw.matchAll(/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g)) {
        let stream;
        try { stream = JSON.parse(match[1])[1]; } catch { continue; }
        for (const line of stream.split('\n')) {
          if (!/^[a-f\d]+:\[/i.test(line) || !line.includes('initialPdpResponse')) continue;
          let node;
          try { node = JSON.parse(line.slice(line.indexOf(':') + 1)); } catch { continue; }
          const response = node?.[0] === '$' && node?.[3]?.isSSR === true && node[3].initialPdpResponse;
          if (!response) continue;
          const catalog = response.catalog?.response;
          if (catalog?.numFound !== 1 || !Array.isArray(catalog.docs) || catalog.docs.length !== 1) return { invalid: true };
          const product = catalog.docs[0];
          if (!product || product.id !== currentId || product.pid !== currentId) return { invalid: true };
          const details = product.productDetail?.details;
          const declared = Array.isArray(details) ? details.filter(d => /^ingredients\s*:?$/i.test(d?.header || '')).map(d => declaration(d.value)) : [];
          if (declared.some(value => !value) || new Set(declared).size > 1) return { invalid: true };
          const warnings = Array.isArray(details) ? details.filter(d => /^(?:allergens?|warnings?)\s*:?$/i.test(d?.header || '')).map(d => L.warningText(declaration(d.value))).filter(Boolean) : [];
          const model = { title: declaration(product.name), ingredients: declared[0] || '',
            advisoryText: warnings.join('. '), nutrition: nutrition(response.nutritionPanels),
            crumbs: [product.departmentName, product.aisleName, product.shelfName].filter(v => typeof v === 'string').map(v => L.clean(v.split('|')[0])) };
          if (!model.title || model.title.length > 300) return { invalid: true };
          if (selected && JSON.stringify(selected) !== JSON.stringify(model)) return { invalid: true };
          selected = model;
        }
      }
    }
    return selected;
  }
  for (const id of IDS) {
    const original = root.AIR.storeAdapters[id];
    if (!original) continue;
    const albertsons = ['safeway', 'albertsons'].includes(id);
    const links = new Map();
    function url(raw, base) {
      try {
        const u = new URL(String(raw), base || original.productUrl('0003000001020'));
        return /^https?:$/.test(u.protocol) && !u.username && !u.password && original.matchesHost(u.hostname) ? u : null;
      } catch { return null; }
    }
    function productId(raw) {
      if (!albertsons) return original.productId(raw);
      const u = url(raw);
      if (!u) return '';
      const match = u.pathname.match(/^\/shop\/pd\/([^/]+)\/(\d{5,15})\/?$/);
      if (match && !PRIVATE.test(match[1])) return match[2];
      return original.productId(raw);
    }
    function searchTiles(doc) {
      const out = [], seen = new Set();
      links.clear();
      for (const link of doc.querySelectorAll('a[href]')) {
        const currentId = productId(link.getAttribute('href'));
        if (!currentId || seen.has(currentId) || excluded(link)) continue;
        const card = link.closest('[data-testid^="product-card"], [data-testid="product-grid-item"], [data-testid="product-tile"], .ProductCard, .product-card, .product-card-container') || link;
        if (excluded(card)) continue;
        const own = card === link ? [link] : Array.from(card.querySelectorAll('a[href]')).filter(a => !excluded(a) && productId(a.getAttribute('href')) === currentId);
        if (Array.from(card.querySelectorAll('a[href]')).some(a => !excluded(a) && productId(a.getAttribute('href')) && productId(a.getAttribute('href')) !== currentId)) continue;
        const titleSelector = 'h2, h3, [data-testid="product-title"], [data-qa="product-name"], .product-title, .product-name';
        const titleLink = own.find(a => visible(a, titleSelector)) || own.find(a => L.text(a));
        const title = (titleLink && (L.text(visible(titleLink, titleSelector)) || L.text(titleLink))) || own.map(a => L.clean(a.getAttribute('aria-label'))).find(Boolean) || own.map(a => L.clean(visible(a, 'img[alt]')?.getAttribute('alt'))).find(Boolean);
        if (!title || title.length > 300) continue;
        // Keep the badge outside a truncated/overflow-hidden title link and outside controls.
        const parent = titleLink?.parentNode;
        const anchor = parent && parent !== card && !parent.matches?.('a, button') ? parent : card;
        const corner = !titleLink || anchor === card;
        seen.add(currentId);
        links.set(currentId, link.getAttribute('href'));
        out.push({ id: currentId, title, tile: card, el: card, anchor, badgePlacement: corner ? 'corner' : 'inline' });
      }
      return out;
    }
    function productUrl(value, loc) {
      const current = url(loc?.href);
      const actual = links.get(String(value));
      const target = actual && url(actual, current?.href);
      if (target && (!current || target.origin === current.origin) && productId(target.href) === String(value)) {
        target.hash = ''; return target.href;
      }
      return original.productUrl(value, loc);
    }
    function productAnchor(doc) {
      if (albertsons) return visible(doc, '.product-info, [data-testid="product-details"], main h1, h1');
      return visible(doc, '[data-testid="product-details-name"], main h1, h1');
    }
    function readProduct(doc, loc) {
      if (!albertsons) return original.readProduct(doc, loc);
      const currentId = productId(loc?.href);
      const scope = visible(doc, '.product-info, [data-testid="product-details"]') || doc;
      const heading = visible(scope, '[data-testid="product-details-name"], .product-title, .product-name, h1');
      const base = { id: currentId, title: L.text(heading), crumbs: [], ingredients: '', advisoryText: '', labelText: '', nutrition: null, label: 'missing' };
      if (!currentId || !L.sameCanonical(doc, currentId, productId)) return base;
      for (const wrapper of doc.querySelectorAll('[data-bpn]')) if (!excluded(wrapper) && wrapper.getAttribute('data-bpn') !== currentId) return base;
      const model = publicModel(doc, currentId);
      if (model?.invalid) return base;
      const label = L.readLabel({
        querySelectorAll: selector => Array.from(scope.querySelectorAll(selector)).filter(node => !excluded(node)),
        querySelector: selector => visible(scope, selector),
      });
      const data = model || { ...base, ...label };
      const ingredients = label.ingredients || data.ingredients;
      const changed = label.ingredients && model?.ingredients && L.clean(label.ingredients) !== L.clean(model.ingredients);
      return { ...base, ...data, ingredients, labelText: ingredients, label: ingredients ? 'open' : label.label,
        advisoryText: [label.advisoryText, changed ? '' : data.advisoryText].filter(Boolean).join('. '),
        nutrition: label.nutrition || (changed ? null : data.nutrition) };
    }
    root.AIR.storeAdapters[id] = { ...original, productId, productUrl, searchTiles, readProduct, productAnchor,
      isProductPage: loc => !!productId(loc?.href) };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.fromEntries(IDS.map(id => [id, root.AIR.storeAdapters[id]]));
})(typeof globalThis !== 'undefined' ? globalThis : self);
