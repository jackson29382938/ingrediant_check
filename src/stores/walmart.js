// Walmart preview: read the current product's embedded ingredient declaration or visible label.
// The captured __NEXT_DATA__ schema was observed on October 4, 2026. Identity must match the URL.
(function(root) {
  const L = root.AIR.retailerLabels;
  const matchesHost = host => /^(?:www\.)?walmart\.com$/i.test(String(host || ''));
  function productId(raw) {
    try {
      const u = new URL(String(raw), 'https://www.walmart.com');
      if (!matchesHost(u.hostname)) return '';
      return (u.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d{5,15})\/?$/) || [])[1] || '';
    } catch { return ''; }
  }
  let lastNode, lastText, lastData;
  function embedded(doc) {
    const node = doc.querySelector('#__NEXT_DATA__');
    if (!node) return null;
    const raw = node.textContent;
    if (node === lastNode && raw === lastText) return lastData;
    lastNode = node; lastText = raw; lastData = null;
    if (!raw || raw.length > 8 * 1024 * 1024) return null;
    try { lastData = JSON.parse(raw).props?.pageProps?.initialData?.data || null; } catch { /* incomplete page */ }
    return lastData;
  }
  function readProduct(doc, loc) {
    const id = productId(loc.href);
    const model = embedded(doc);
    const product = model && model.product;
    const title = L.text(doc.querySelector('h1')) || L.clean(product && product.name);
    const base = { id, title, crumbs: [], ingredients: '', labelText: '', nutrition: null, label: 'missing' };
    if (!L.sameCanonical(doc, id, productId) || (product && String(product.usItemId) !== id)) return base;
    const visible = L.readLabel(doc);
    const declared = product && model.idml?.ingredients?.ingredients?.value;
    const ingredients = typeof declared === 'string' ? L.clean(declared.replace(/<[^>]*>/g, ' ')).slice(0, 6000) : visible.ingredients;
    return { ...base, ...visible, ingredients, labelText: ingredients, label: ingredients ? 'open' : visible.label,
      crumbs: (Array.isArray(product?.category?.path) ? product.category.path : []).map(item => L.clean(item && item.name)).filter(Boolean) };
  }
  const adapter = { id: 'walmart', name: 'Walmart', matchesHost, productId,
    isProductPage: loc => !!productId(loc.href), isSearchPage: loc => loc.pathname === '/search',
    searchQuery: loc => { try { return new URL(loc.href).searchParams.get('q') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Ingredients', searchTiles: doc => L.searchTiles(doc, productId) };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.walmart = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
