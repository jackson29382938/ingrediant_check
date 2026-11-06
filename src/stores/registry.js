// Which online stores Ingredient Check works on, and which are planned.
//
// One list for the settings page's store wishlist, docs/STORES.md and the tests, so the UI cannot
// claim a store the extension does not support.
//   supported  runs there, and its product page and search flow were checked in a real browser
//              in normal use (docs/STORES.md records when)
//   preview    runs there and read the live pages correctly, but that check is not complete: say so
//   planned    does not run there: no host permission, no content script, nothing read

(function (root) {
  const STORES = [
    {
      id: 'amazon', name: 'Amazon', status: 'supported',
      // Must equal manifest.json host_permissions (tests/stores.test.js).
      domains: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.com.au', 'amazon.ie', 'amazon.in',
        'amazon.sg', 'amazon.ae', 'amazon.sa', 'amazon.de', 'amazon.fr', 'amazon.es', 'amazon.it',
        'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.com.be', 'amazon.com.tr', 'amazon.com.mx',
        'amazon.com.br', 'amazon.co.jp'],
    },
    // Public product/search previews; search scans can fetch same-origin public declarations.
    // Live pages were read correctly on 2026-09-25, but behind Target's bot check (docs/STORES.md).
    { id: 'target', name: 'Target', status: 'preview', domains: ['target.com'], search: '^/(?:$|(?:s|c|pl|b|sale|deals|offers|finds)(?:/|$))', images: ['scene7.com', 'targetimg1.com'] },
    { id: 'walmart', name: 'Walmart', status: 'preview', domains: ['walmart.com'], search: '^/(?:$|search/?$|(?:browse|cp|shop|m|global/promo)(?:/|$))', images: ['walmartimages.com'] },
    { id: 'costco', name: 'Costco', status: 'preview', domains: ['costco.com'], search: '^/(?:s|CatalogSearch)$', images: ['bfldr.com', 'costco-static.com'] },
    {"id": "instacart", "name": "Instacart", "status": "preview", "domains": ["instacart.com"], "search": "^/store/(?:[^/]+/)?s/?$"},
    {"id": "kroger", "name": "Kroger", "status": "preview", "domains": ["kroger.com"], "search": "^/search/?$"},
    {"id": "frys", "name": "Fry’s", "status": "preview", "domains": ["frysfood.com"], "search": "^/search/?$"},
    {"id": "ralphs", "name": "Ralphs", "status": "preview", "domains": ["ralphs.com"], "search": "^/search/?$"},
    {"id": "kingsoopers", "name": "King Soopers", "status": "preview", "domains": ["kingsoopers.com"], "search": "^/search/?$"},
    {"id": "smiths", "name": "Smith’s", "status": "preview", "domains": ["smithsfoodanddrug.com"], "search": "^/search/?$"},
    {"id": "fredmeyer", "name": "Fred Meyer", "status": "preview", "domains": ["fredmeyer.com"], "search": "^/search/?$"},
    {"id": "qfc", "name": "QFC", "status": "preview", "domains": ["qfc.com"], "search": "^/search/?$"},
    {"id": "harristeeter", "name": "Harris Teeter", "status": "preview", "domains": ["harristeeter.com"], "search": "^/search/?$"},
    {"id": "dillons", "name": "Dillons", "status": "preview", "domains": ["dillons.com"], "search": "^/search/?$"},
    {"id": "safeway", "name": "Safeway", "status": "preview", "domains": ["safeway.com"], "search": "^/shop/search-results\\.html$"},
    {"id": "albertsons", "name": "Albertsons", "status": "preview", "domains": ["albertsons.com"], "search": "^/shop/search-results\\.html$"},
  ];

  const bareHost = host => String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

  // The store a hostname belongs to, or null. "smile.amazon.co.uk" is Amazon; "notamazon.com" is not.
  function storeForHost(host) {
    const h = bareHost(host);
    if (!h) return null;
    return STORES.find(s => s.domains.some(d => h === d || h.endsWith('.' + d))) || null;
  }

  // The store a typed name refers to: "Amazon", "amazon.co.uk", "Walmart Grocery" is not matched.
  function storeForName(name) {
    const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!n) return null;
    return STORES.find(s => s.name.toLowerCase() === n || s.id === n || s.domains.includes(bareHost(n))) || null;
  }

  // May "Report a problem" take a screenshot of this tab, and note its address, without asking? Only
  // on a store Ingredient Check runs on (supported or preview), over https. Any other tab (a bank, an
  // email) starts the report with neither; the reader can add an image themselves.
  function reportMayCapture(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (e) { return false; }
    if (u.protocol !== 'https:') return false;
    const store = storeForHost(u.hostname);
    if (!store || store.status === 'planned') return false;
    if (/\/(?:cart|checkout|account|login|orders|your-account|gp\/(?:cart|buy|css)|ap)(?:[/.]|$)/i.test(u.pathname)) return false;
    if (store.id === 'target') return /^(?:www\.)?target\.com$/i.test(u.hostname) && /^\/(?:p\/|s(?:\/|$))/.test(u.pathname);
    if (store.id === 'walmart') return /^(?:www\.)?walmart\.com$/i.test(u.hostname) && (/^\/ip\/(?:[^/]+\/)?\d{5,15}\/?$/.test(u.pathname) || /^\/search\/?$/.test(u.pathname));
    if (store.id === 'costco') return /^(?:www\.)?costco\.com$/i.test(u.hostname) && (/^\/[^/]+\.product\.\d{5,15}\.html$/.test(u.pathname) || /^\/p\/(?:[^/]+\/)+\d{5,15}\/?$/.test(u.pathname) || ['/s', '/CatalogSearch'].includes(u.pathname));
    if (store.id !== 'amazon') {
      if (!store.domains.some(domain => u.hostname === domain || u.hostname === 'www.' + domain)) return false;
      if (store.id === 'instacart') return /^\/(?:store\/)?products\/\d{5,15}(?:-[^/]+)?\/?$/.test(u.pathname)
        || /^\/store\/(?:[^/]+\/)?items\/\d{5,15}(?:-[^/]+)?\/?$/.test(u.pathname) || /^\/store\/(?:[^/]+\/)?s\/?$/.test(u.pathname);
      if (['safeway', 'albertsons'].includes(store.id)) return /^\/shop\/(?:product-details\.\d{5,15}\.html|pd\/(?!(?:cart|checkout|account|login|orders)\/)[^/]+\/\d{5,15}\/?|search-results\.html)$/.test(u.pathname);
      return /^\/p\/[^/]+\/\d{10,14}\/?$/.test(u.pathname) || /^\/search\/?$/.test(u.pathname);
    }
    return true;
  }

  // The retailer store a result-page address belongs to, or null: https, no credentials or port, the store's own
  // host (or www.), and that store's search route. Used by the worker to decide which tabs may be sorted, and by
  // the sorted-list page to name and link the store; it must agree with each adapter's isSearchPage
  // (tests/retailer-sort.test.js checks that it does).
  function searchStore(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const store = STORES.find(s => s.search && s.domains.some(d => u.hostname === d || u.hostname === 'www.' + d));
    return store && new RegExp(store.search).test(u.pathname) ? store : null;
  }
  // May a list for this store show a picture from this host? The store's own site always; a CDN only when it is
  // named here (the sorted list is an extension page, so a picture is a request to that host).
  function imageHostOk(store, hostname) {
    const h = String(hostname || '').toLowerCase();
    return !!store && [...store.domains, ...(store.images || [])].some(d => h === d || h.endsWith('.' + d));
  }

  const api = { STORES, storeForHost, storeForName, reportMayCapture, searchStore, imageHostOk };
  root.AIR = root.AIR || {};
  root.AIR.stores = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
