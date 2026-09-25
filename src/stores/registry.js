// Which online stores Ingredient Check works on, and which are planned.
//
// One list for the settings page's store wishlist, docs/STORES.md and the tests, so the UI cannot
// claim a store the extension does not support. `supported` means the extension runs there today.
// `planned` means it does not run there yet: no host permission, no content script, nothing read.
// A store moves to `supported` only after its product page and search flow are checked in a real
// browser (docs/STORES.md explains the steps and records the date).

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
    { id: 'target', name: 'Target', status: 'planned', domains: ['target.com'] },
    { id: 'walmart', name: 'Walmart', status: 'planned', domains: ['walmart.com'] },
    { id: 'costco', name: 'Costco', status: 'planned', domains: ['costco.com'] },
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

  const api = { STORES, storeForHost, storeForName };
  root.AIR = root.AIR || {};
  root.AIR.stores = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
