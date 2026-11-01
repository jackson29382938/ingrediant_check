// Where the purchase history lives in chrome.storage.local.
//
// It used to be one key, `purchaseHistory`, holding an array of up to 10,000 records (about 8 MB when full). Any
// change rewrote the whole thing: measured in Chromium with 8.3 MB of history, adding one record took 2.7 s, and
// every extension page and every Amazon tab listening to storage.onChanged was handed the full 8.7 MB value. Now
// the records are spread over BUCKETS keys by a hash of the record's key, plus a small index. A write puts only the
// buckets whose content changed (one record: 72 ms in the same measurement), and a listener is told about the
// index, which is a few hundred bytes.
//
//   purchaseHistoryIndex    { v, buckets, used: [bucket numbers that hold records], hashes: { n: hash }, count }
//   purchaseHistory:<n>     the records whose key hashes to n, in key order
//   purchaseHistory         the old single array. Still read when there is no index (an install from before this
//                           change); the first write moves it into buckets and removes it.
//
// One `set` carries the changed buckets, the index and any other keys the caller is saving, so a reader never sees
// a new index with old buckets.
//
// Used by the service worker (worker/purchase-history.js), the Orders page (content/orders.js) and the history
// page (options/history.js). Not part of the Apps Script schema copy: the server keeps its own layout.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const BUCKETS = 64;
  const INDEX_KEY = 'purchaseHistoryIndex';
  const LEGACY_KEY = 'purchaseHistory';
  const bucketKey = n => `${LEGACY_KEY}:${n}`;

  // FNV-1a, 32 bits: it only has to spread keys evenly and change when text changes.
  function fnv(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // FNV's low bits barely move when only the last characters of a key change (order ids and ASINs differ in just
  // those), so the bucket number takes a final mix first: 10,000 sequential keys used 32 of 64 buckets without it.
  function bucketOf(key) {
    let h = fnv(String(key));
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) % BUCKETS;
  }

  function validIndex(index) {
    return !!index && typeof index === 'object' && index.v === 1 && index.buckets === BUCKETS
      && Array.isArray(index.used) && index.used.every(n => Number.isInteger(n) && n >= 0 && n < BUCKETS)
      && index.hashes && typeof index.hashes === 'object';
  }

  // Records grouped by bucket, each group in key order so the same records always hash the same.
  function split(records) {
    const groups = Array.from({ length: BUCKETS }, () => []);
    for (const record of records) if (record && typeof record === 'object') groups[bucketOf(record.key)].push(record);
    for (const group of groups) group.sort((a, b) => (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0));
    return groups;
  }

  // Every stored record, in no particular order (callers merge, which orders). `area` is chrome.storage.local.
  async function read(area) {
    const head = await area.get([INDEX_KEY, LEGACY_KEY]);
    if (!validIndex(head[INDEX_KEY])) return Array.isArray(head[LEGACY_KEY]) ? head[LEGACY_KEY] : [];
    const keys = head[INDEX_KEY].used.map(bucketKey);
    if (!keys.length) return [];
    const stored = await area.get(keys);
    return keys.flatMap(key => (Array.isArray(stored[key]) ? stored[key] : []));
  }

  // How many records, without reading them.
  async function count(area) {
    const head = await area.get([INDEX_KEY, LEGACY_KEY]);
    if (validIndex(head[INDEX_KEY])) return Number(head[INDEX_KEY].count) || 0;
    return Array.isArray(head[LEGACY_KEY]) ? head[LEGACY_KEY].length : 0;
  }

  // Replace the whole history with `records`, writing only the buckets that differ. `extra` is other storage keys
  // to save in the same atomic set. -> the number of buckets written.
  async function write(area, records, extra = {}) {
    const list = Array.isArray(records) ? records : [];
    const head = await area.get([INDEX_KEY, LEGACY_KEY]);
    const old = validIndex(head[INDEX_KEY]) ? head[INDEX_KEY] : null;
    const set = { ...extra }, drop = [], hashes = {}, used = [];
    let written = 0;
    split(list).forEach((rows, n) => {
      if (!rows.length) {
        if (old && old.used.includes(n)) drop.push(bucketKey(n));
        return;
      }
      const hash = `${fnv(JSON.stringify(rows)).toString(16)}-${rows.length}`;
      hashes[n] = hash;
      used.push(n);
      if (!old || old.hashes[n] !== hash) { set[bucketKey(n)] = rows; written++; }
    });
    set[INDEX_KEY] = { v: 1, buckets: BUCKETS, used, hashes, count: list.length };
    await area.set(set);
    if (drop.length) await area.remove(drop);
    if (head[LEGACY_KEY] !== undefined) await area.remove(LEGACY_KEY);
    return written;
  }

  // Did this storage.onChanged event touch the history?
  const changed = changes => !!changes && (INDEX_KEY in changes || LEGACY_KEY in changes);

  const api = AIRmodule('purchaseStore', { BUCKETS, INDEX_KEY, LEGACY_KEY, bucketKey, bucketOf, read, count, write, changed });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
