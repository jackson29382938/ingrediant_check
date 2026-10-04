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
    // Reads the product page you open; search shows scores only for products opened before.
    // Live pages were read correctly on 2026-09-25, but behind Target's bot check (docs/STORES.md).
    { id: 'target', name: 'Target', status: 'preview', domains: ['target.com'] },
    { id: 'walmart', name: 'Walmart', status: 'preview', domains: ['walmart.com'] },
    { id: 'costco', name: 'Costco', status: 'preview', domains: ['costco.com'] },
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
    if (store.id === 'walmart') return /^(?:www\.)?walmart\.com$/i.test(u.hostname) && (/^\/ip\/(?:[^/]+\/)?\d{5,15}\/?$/.test(u.pathname) || u.pathname === '/search');
    if (store.id === 'costco') return /^(?:www\.)?costco\.com$/i.test(u.hostname) && (/^\/[^/]+\.product\.\d{5,15}\.html$/.test(u.pathname) || /^\/p\/(?:[^/]+\/)+\d{5,15}\/?$/.test(u.pathname) || ['/s', '/CatalogSearch'].includes(u.pathname));
    return true;
  }

  const api = { STORES, storeForHost, storeForName, reportMayCapture };
  root.AIR = root.AIR || {};
  root.AIR.stores = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
