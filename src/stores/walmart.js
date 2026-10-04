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
    return L.clean(decoded.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' '));
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
    const title = L.text(doc.querySelector('h1')) || (typeof product?.name === 'string' ? L.clean(product.name) : '');
    const base = { id, title, crumbs: [], ingredients: '', labelText: '', nutrition: null, label: 'missing' };
    const declaredId = product?.usItemId;
    if (!id || !L.sameCanonical(doc, id, productId) || (product &&
      !((typeof declaredId === 'string' || typeof declaredId === 'number') && String(declaredId) === id))) return base;
    const visible = L.readLabel(doc);
    const declared = product && model.idml?.ingredients?.ingredients?.value;
    const ingredients = declaration(declared) || visible.ingredients;
    return { ...base, ...visible, ingredients, labelText: ingredients, label: ingredients ? 'open' : visible.label,
      crumbs: (Array.isArray(product?.category?.path) ? product.category.path : []).map(item => typeof item?.name === 'string' ? L.clean(item.name) : '').filter(Boolean) };
  }
  const adapter = { id: 'walmart', name: 'Walmart', matchesHost, productId,
    isProductPage: loc => !!productId(loc.href), isSearchPage: loc => matchesHost(loc.hostname) && /^\/search\/?$/.test(loc.pathname),
    searchQuery: loc => { try { return new URL(loc.href).searchParams.get('q') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Ingredients', searchTiles: doc => L.searchTiles(doc, productId) };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.walmart = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
