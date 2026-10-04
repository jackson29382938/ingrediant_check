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
  function structuredIdentityMatches(doc, id) {
    // Observed public Costco pages provide a direct Product.url declaration.
    // Its SKU is a warehouse item number, not the URL's product ID. Only the URL
    // can protect against a stale product record during client-side navigation.
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      if (node.closest('aside, footer, nav') || inRecommendations(node)) continue;
      const raw = node.textContent;
      if (!raw || raw.length > 256 * 1024) continue;
      let data;
      try { data = JSON.parse(raw); } catch { continue; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
      if (!types.includes('Product') || data.url == null) continue;
      if (typeof data.url !== 'string' || productId(data.url) !== id) return false;
    }
    return true;
  }
  function readProduct(doc, loc) {
    const id = productId(loc.href);
    if (!id) return { id: '', title: '', crumbs: [], ingredients: '', labelText: '', label: 'missing', nutrition: null };
    const title = L.text(doc.querySelector('[data-testid="product-description"] h1')) || L.text(doc.querySelector('h1')) ||
      L.clean(String(doc.title || '').replace(/\s*\|\s*Costco.*$/i, ''));
    const base = { id, title, crumbs: Array.from(doc.querySelectorAll('[aria-label="Breadcrumbs"] a')).map(L.text),
      ingredients: '', labelText: '', label: 'missing', nutrition: null };
    return L.sameCanonical(doc, id, productId) && structuredIdentityMatches(doc, id) ? { ...base, ...L.readLabel(doc) } : base;
  }
  function isSearchPage(loc) {
    try {
      const u = new URL(loc.href);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password && matchesHost(u.hostname) && ['/s', '/CatalogSearch'].includes(u.pathname);
    } catch { return false; }
  }
  function inRecommendations(link) {
    for (let node = link; node && node.getAttribute; node = node.parentNode) {
      if (['data-testid', 'data-test', 'data-automation-id', 'aria-label', 'id'].some(attr =>
        /recommend|related[-_ ]*(?:products|items)|sponsored|recently[-_ ]?viewed|customers[-_ ]also|you[-_ ]may[-_ ]also/i.test(node.getAttribute(attr) || ''))) return true;
    }
    return false;
  }
  function searchTiles(doc) {
    const out = [], seen = new Set();
    for (const link of doc.querySelectorAll('a[href]')) {
      const id = productId(link.getAttribute('href'));
      if (!id || seen.has(id) || link.closest('header, nav, footer, aside') || inRecommendations(link)) continue;
      // Costco cards often separate their image and title links. Keep badges on the
      // complete tile and use its declared accessible title when the link is image-only.
      const tile = link.closest('[data-testid^="ProductTile"]') || link;
      // A reused/malformed card can contain links for multiple products during
      // hydration. Do not borrow one product's title or badge container for another.
      if (tile !== link && Array.from(tile.querySelectorAll('a[href]')).some(other => {
        const otherId = productId(other.getAttribute('href'));
        return otherId && otherId !== id;
      })) continue;
      const ownLinks = tile === link ? [link] : Array.from(tile.querySelectorAll('a[href]'))
        .filter(other => productId(other.getAttribute('href')) === id);
      const heading = Array.from(tile.querySelectorAll('h2, h3, [data-testid="product-title"]')).find(el => {
        const owner = el.closest('a[href]');
        return !owner || productId(owner.getAttribute('href')) === id;
      });
      // Prefer the title link over generic image/accessibility text. An unrelated
      // decorative image elsewhere in the card must never supply the product name.
      const title = L.text(heading) || ownLinks.map(L.text).find(Boolean) ||
        ownLinks.map(other => L.clean(other.getAttribute('aria-label'))).find(Boolean) ||
        ownLinks.map(other => L.clean(other.querySelector('img')?.getAttribute('alt'))).find(Boolean);
      if (!title || title.length > 300) continue;
      seen.add(id);
      out.push({ id, title, tile, anchor: tile });
    }
    return out;
  }
  const adapter = { id: 'costco', name: 'Costco', matchesHost, productId,
    isProductPage: loc => !!productId(loc.href), isSearchPage,
    searchQuery: loc => { try { if (!isSearchPage(loc)) return ''; const u = new URL(loc.href); return u.searchParams.get('keyword') || u.searchParams.get('searchTerm') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Nutritional Facts', searchTiles };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.costco = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
