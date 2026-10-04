// Costco preview: visible labels on the product page the reader opens. No internal API calls.
(function(root) {
  const L = root.AIR.retailerLabels;
  const matchesHost = host => /^(?:www\.)?costco\.com$/i.test(String(host || ''));
  function productId(raw) {
    try {
      const u = new URL(String(raw), 'https://www.costco.com');
      if (!matchesHost(u.hostname)) return '';
      return (u.pathname.match(/^\/[^/]+\.product\.(\d{5,15})\.html$/) || u.pathname.match(/^\/p\/(?:[^/]+\/)+(\d{5,15})\/?$/) || [])[1] || '';
    } catch { return ''; }
  }
  function readProduct(doc, loc) {
    const id = productId(loc.href);
    const title = L.text(doc.querySelector('h1')) || L.clean(String(doc.title || '').replace(/\s*\|\s*Costco.*$/i, ''));
    const base = { id, title, crumbs: Array.from(doc.querySelectorAll('[aria-label="Breadcrumbs"] a')).map(L.text),
      ingredients: '', labelText: '', label: 'missing', nutrition: null };
    return L.sameCanonical(doc, id, productId) ? { ...base, ...L.readLabel(doc) } : base;
  }
  const adapter = { id: 'costco', name: 'Costco', matchesHost, productId,
    isProductPage: loc => !!productId(loc.href), isSearchPage: loc => loc.pathname === '/s' || loc.pathname === '/CatalogSearch',
    searchQuery: loc => { try { const u = new URL(loc.href); return u.searchParams.get('keyword') || u.searchParams.get('searchTerm') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Nutritional Facts', searchTiles: doc => L.searchTiles(doc, productId) };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.costco = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
