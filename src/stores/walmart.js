// Walmart preview: read the current product's embedded ingredient declaration or visible label.
// The captured __NEXT_DATA__ schema was observed on October 4, 2026. Identity must match the URL.
(function(root) {
  const L = root.AIR.retailerLabels;
  const matchesHost = host => /^(?:www\.)?walmart\.com$/i.test(String(host || ''));
  function productId(raw) {
    try {
      const u = new URL(String(raw), 'https://www.walmart.com');
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !matchesHost(u.hostname)) return '';
      return (u.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d{5,15})\/?$/) || [])[1] || '';
    } catch { return ''; }
  }
  function productUrl(id, loc) {
    try {
      const u = new URL(loc.href);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !matchesHost(u.hostname) || !/^\d{5,15}$/.test(String(id))) return '';
      // Use the public item route on the currently open origin, without ad/tracking parameters.
      return new URL(`/ip/${id}`, u.origin).href;
    } catch { return ''; }
  }
  let lastNode, lastText, lastData;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  // Decode text without inserting retailer HTML into the page or executing its scripts.
  function declaration(value) {
    if (typeof value !== 'string' || value.length > 6000) return '';
    const entities = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>' };
    const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()];
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : match;
    });
    return L.clean(decoded.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, ' '));
  }
  function embedded(doc) {
    const node = doc.querySelector('#__NEXT_DATA__');
    if (!node) return null;
    const raw = node.textContent;
    if (node === lastNode && raw === lastText) return lastData;
    lastNode = node; lastText = raw; lastData = null;
    if (!raw || raw.length > 8 * 1024 * 1024) return null;
    try {
      const data = JSON.parse(raw)?.props?.pageProps?.initialData?.data;
      lastData = record(data) ? data : null;
    } catch { /* incomplete page */ }
    return lastData;
  }
  function readProduct(doc, loc) {
    const id = productId(loc.href);
    const model = embedded(doc);
    const product = record(model?.product) ? model.product : null;
    const heading = L.text(doc.querySelector('h1'));
    const modelTitle = typeof product?.name === 'string' ? L.clean(product.name) : '';
    const title = modelTitle || heading;
    const base = { id, title, crumbs: [], ingredients: '', labelText: '', nutrition: null, label: 'missing' };
    const declaredId = product?.usItemId;
    if (!id || !L.sameCanonical(doc, id, productId) || (model && !product) || (product &&
      !((typeof declaredId === 'string' || typeof declaredId === 'number') && String(declaredId) === id))) return base;
    // SPA navigation can update the matching boot model before the previous product's DOM.
    // Do not combine the new product's declaration with the previous title or nutrient table.
    const aligned = !heading || !modelTitle || heading.toLowerCase() === modelTitle.toLowerCase();
    const visible = aligned ? L.readLabel(doc) : { ingredients: '', labelText: '', nutrition: null, label: 'missing' };
    const declared = product && model.idml?.ingredients?.ingredients?.value;
    const ingredients = declaration(declared) || visible.ingredients;
    return { ...base, ...visible, ingredients, labelText: ingredients, label: ingredients ? 'open' : visible.label,
      crumbs: (Array.isArray(product?.category?.path) ? product.category.path : []).map(item => typeof item?.name === 'string' ? L.clean(item.name) : '').filter(Boolean) };
  }
  const CARD = '[data-item-id], [data-testid="product-card"], [data-testid="list-view"], [role="group"]';
  const AD_ATTRS = ['data-testid', 'data-test', 'data-automation-id', 'aria-label'];
  function sponsored(node) {
    return node.getAttribute('data-sponsored') === 'true' || AD_ATTRS.some(attr =>
      /sponsored|advertisement|(?:^|[-_])ad(?:[-_]|$)|^sp-(?:search|carousel|brand)(?:-|$)/i.test(node.getAttribute(attr) || ''));
  }
  function sponsoredCard(card) {
    return sponsored(card) || Array.from(card.querySelectorAll('span, p, [aria-label], [data-testid], [data-automation-id]'))
      .some(node => sponsored(node) || /^sponsored$/i.test(L.text(node)));
  }
  // Hide instead of deleting React-owned nodes. Recheck recycled cards before each pass,
  // and restore only our own changes when paused or navigating away from search.
  function restoreSponsored(doc) {
    for (const node of doc.querySelectorAll('[data-air-sponsored-hidden]')) {
      node.style.removeProperty('display');
      const display = node.getAttribute('data-air-sponsored-display');
      if (display) node.style.setProperty('display', display, node.getAttribute('data-air-sponsored-priority') || '');
      node.removeAttribute('data-air-sponsored-hidden');
      node.removeAttribute('data-air-sponsored-display');
      node.removeAttribute('data-air-sponsored-priority');
    }
  }
  function hideSponsored(doc) {
    restoreSponsored(doc);
    const candidates = new Set(doc.querySelectorAll(CARD));
    for (const node of doc.querySelectorAll('[data-testid], [data-automation-id], [aria-label], [data-sponsored]')) {
      if (sponsored(node)) candidates.add(node.querySelector('a[href]') ? node : node.closest(CARD) || node);
    }
    for (const node of candidates) {
      if (!sponsoredCard(node)) continue;
      // A generic role=group may be the whole results grid. Never hide organic siblings.
      const ids = new Set(Array.from(node.querySelectorAll('a[href]')).map(link => productId(link.getAttribute('href'))).filter(Boolean));
      if (ids.size > 1 && !sponsored(node)) continue;
      node.setAttribute('data-air-sponsored-hidden', 'true');
      node.setAttribute('data-air-sponsored-display', node.style.getPropertyValue('display'));
      node.setAttribute('data-air-sponsored-priority', node.style.getPropertyPriority('display'));
      node.style.setProperty('display', 'none', 'important');
    }
  }
  function searchTiles(doc) {
    const out = [], seen = new Set();
    for (const link of doc.querySelectorAll('a[href]')) {
      const id = productId(link.getAttribute('href'));
      if (!id || seen.has(id) || link.closest('nav, aside, footer, [data-air-sponsored-hidden]') || L.hiddenFromSight(link)) continue;
      let excluded = false;
      for (let parent = link; parent && parent.getAttribute; parent = parent.parentNode) {
        if (['data-testid', 'data-test', 'data-automation-id', 'aria-label'].some(attr => /recommend|promot|sponsored|advertis/i.test(parent.getAttribute(attr) || ''))) {
          excluded = true; break;
        }
      }
      if (excluded) continue;
      // The public grid uses role=group cards with an overlay link and a separate title span.
      // item-stack is the entire grid. Never borrow that grid's first product title.
      const card = link.closest('[data-item-id], [data-testid="product-card"], [data-testid="list-view"]') || link.closest('[role="group"]');
      if (card && sponsoredCard(card)) continue;
      if (card && Array.from(card.querySelectorAll('a[href]')).some(other => {
        const otherId = productId(other.getAttribute('href'));
        return otherId && otherId !== id;
      })) continue;
      const titleNode = (card || link).querySelector('h2, h3, [data-automation-id="product-title"]');
      const titleOwner = titleNode && titleNode.closest('a[href]');
      const heading = !titleOwner || productId(titleOwner.getAttribute('href')) === id ? titleNode : null;
      // Accessible names cover image-only links without borrowing another product's image.
      const image = link.querySelector('img[alt]');
      const title = L.text(heading)
        || L.clean(link.getAttribute('aria-label')) || L.text(link)
        || L.clean(image && image.getAttribute('alt'));
      if (!title || title.length > 300) continue;
      seen.add(id);
      out.push({ id, title, tile: card || link, el: card || undefined, anchor: heading || link });
    }
    return out;
  }
  const adapter = { id: 'walmart', name: 'Walmart', matchesHost, productId, productUrl, remountPanel: true,
    alwaysRateSearch: true, hideSponsored, restoreSponsored,
    isProductPage: loc => !!productId(loc.href), isSearchPage: loc => matchesHost(loc.hostname) && /^\/search\/?$/.test(loc.pathname),
    searchQuery: loc => { try { return new URL(loc.href).searchParams.get('q') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Ingredients', searchTiles };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.walmart = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
