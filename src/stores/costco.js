// Costco preview: visible labels on the product page the reader opens. No internal API calls.
(function(root) {
  const L = root.AIR.retailerLabels;
  const matchesHost = host => /^(?:www\.)?costco\.com$/i.test(String(host || ''));
  function productId(raw) {
    try {
      const u = new URL(String(raw), 'https://www.costco.com');
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !matchesHost(u.hostname)) return '';
      return (u.pathname.match(/^\/[^/]+\.product\.(\d{5,15})\.html$/) || u.pathname.match(/^\/p\/(?:[^/]+\/)+(\d{5,15})\/?$/) || [])[1] || '';
    } catch { return ''; }
  }
  function readProduct(doc, loc) {
    const id = productId(loc.href);
    if (!id) return { id: '', title: '', crumbs: [], ingredients: '', labelText: '', label: 'missing', nutrition: null };
    const title = L.text(doc.querySelector('h1')) || L.clean(String(doc.title || '').replace(/\s*\|\s*Costco.*$/i, ''));
    const base = { id, title, crumbs: Array.from(doc.querySelectorAll('[aria-label="Breadcrumbs"] a')).map(L.text),
      ingredients: '', labelText: '', label: 'missing', nutrition: null };
    return L.sameCanonical(doc, id, productId) ? { ...base, ...L.readLabel(doc) } : base;
  }
  function isSearchPage(loc) {
    try {
      const u = new URL(loc.href);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password && matchesHost(u.hostname) && ['/s', '/CatalogSearch'].includes(u.pathname);
    } catch { return false; }
  }
  function searchTiles(doc) {
    const out = [], seen = new Set();
    for (const link of doc.querySelectorAll('a[href]')) {
      const id = productId(link.getAttribute('href'));
      if (!id || seen.has(id) || link.closest('header, nav, footer, aside')) continue;
      // Costco cards often separate their image and title links. Keep badges on the
      // complete tile and use its declared accessible title when the link is image-only.
      const tile = link.closest('[data-testid^="ProductTile"]') || link;
      // A reused/malformed card can contain links for multiple products during
      // hydration. Do not borrow one product's title or badge container for another.
      if (tile !== link && Array.from(tile.querySelectorAll('a[href]')).some(other => {
        const otherId = productId(other.getAttribute('href'));
        return otherId && otherId !== id;
      })) continue;
      const title = L.text(tile.querySelector('h2, h3, [data-testid="product-title"]')) || L.text(link) ||
        L.clean(link.getAttribute('aria-label')) || L.clean(tile.querySelector('img')?.getAttribute('alt'));
      if (!title || title.length > 300) continue;
      seen.add(id);
      out.push({ id, title, tile, anchor: tile });
    }
    return out;
  }
  const adapter = { id: 'costco', name: 'Costco', matchesHost, productId,
    isProductPage: loc => !!productId(loc.href), isSearchPage,
    searchQuery: loc => { try { const u = new URL(loc.href); return u.searchParams.get('keyword') || u.searchParams.get('searchTerm') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Nutritional Facts', searchTiles };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.costco = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
