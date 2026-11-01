// A test's stand-in for chrome.storage.local, seen the way the tests were written before the purchase history moved
// into buckets (src/engine/db/purchase-store.js): `data.purchaseHistory` reads the records wherever they are stored, and
// assigning to it seeds a single-key history, as an install from before the change would have.
'use strict';
const store = require('../src/engine/db/purchase-store.js');

function recordsIn(data) {
  const index = data[store.INDEX_KEY];
  if (!index) return data.purchaseHistory;   // the old single key, or nothing
  return index.used.flatMap(n => data[store.bucketKey(n)] || []);
}

function withHistoryView(data) {
  return new Proxy(data, {
    get: (target, prop) => (prop === 'purchaseHistory' ? recordsIn(target) : target[prop]),
    set(target, prop, value) {
      if (prop === 'purchaseHistory') {
        delete target[store.INDEX_KEY];
        for (const key of Object.keys(target)) if (/^purchaseHistory:\d+$/.test(key)) delete target[key];
      }
      target[prop] = value;
      return true;
    },
  });
}

const byKey = list => [...list].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

module.exports = { withHistoryView, recordsIn, byKey };
