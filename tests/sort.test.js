// Sort by score: order, settings, the sanitizer the worker applies, and the worker's handlers.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../src/engine/db/sorted-results.js');

const p = (asin, score, extra = {}) => ({ asin, url: `https://www.amazon.com/dp/${asin}`, title: asin, score, ...extra });

test('best score first; listings without a score last; ties keep Amazon\'s order', () => {
  const list = [p('B000000001', 40), p('B000000002', null), p('B000000003', 90), p('B000000004', 40),
    p('B000000005', undefined), p('B000000006', 95), p('B000000007', NaN), p('B000000008', 101)];
  assert.deepEqual(R.sortByScore(list).map(x => x.asin), [
    'B000000006', 'B000000003', 'B000000001', 'B000000004',     // 95, 90, then the two 40s in page order
    'B000000002', 'B000000005', 'B000000007', 'B000000008',     // null, undefined, NaN, out of range: page order
  ]);
  assert.deepEqual(R.sortByScore(null), []);
  const input = [p('B000000001', 10), p('B000000002', 20)];
  R.sortByScore(input);
  assert.deepEqual(input.map(x => x.asin), ['B000000001', 'B000000002'], 'the input is not reordered in place');
});

test('money parsing matches the Cost Sorter', () => {
  assert.equal(R.parseMoney('$1,234.56'), 1234.56);
  assert.equal(R.parseMoney('Price: $ 4.99 ($0.30/Ounce)'), 4.99);
  assert.equal(R.parseMoney('no price'), null);
});

test('sort settings are bounded', () => {
  assert.deepEqual(R.sanitizeSort({}), { sortMissing: 'rate-first', sortLoadMore: false, sortCount: 100 });
  assert.deepEqual(R.sanitizeSort({ sortMissing: 'end', sortLoadMore: true, sortCount: '250' }), { sortMissing: 'end', sortLoadMore: true, sortCount: 250 });
  assert.equal(R.sanitizeSort({ sortCount: 0 }).sortCount, 1);
  assert.equal(R.sanitizeSort({ sortCount: 9999 }).sortCount, 500);
  assert.equal(R.sanitizeSort({ sortCount: 'lots' }).sortCount, 100);
  assert.equal(R.sanitizeSort({ sortMissing: 'fetch-everything' }).sortMissing, 'rate-first');
  assert.equal(R.sanitizeSort({ sortLoadMore: 'yes' }).sortLoadMore, false);
});

test('the sorted list admits only Amazon links and Amazon images, bounded and typed', () => {
  const clean = R.sanitizeResults([
    p('B000000001', 88, { image: 'https://m.media-amazon.com/images/I/abc.jpg', listingPrice: 4.991, verdict: 'Good', source: 'scored', sponsored: true, pageNumber: 3 }),
    { asin: 'B000000002', url: 'javascript:alert(1)', title: 'x', score: 50 },
    { asin: 'B000000003', url: 'https://evil.example/dp/B000000003', image: 'https://evil.example/i.jpg', title: 'y' },
    { asin: 'not-an-asin', url: 'https://www.amazon.com/x', title: 'z' },
    { url: 'http://www.amazon.com/dp/B000000004', title: 'plain http' },
    p('B000000001', 10),                                         // duplicate ASIN
    { asin: 'B000000005', url: 'https://user:pw@www.amazon.com/dp/B000000005' },
    null, 'string', 42,
  ]);
  assert.deepEqual(clean.map(x => [x.asin, x.url]), [
    ['B000000001', 'https://www.amazon.com/dp/B000000001'],
    ['B000000002', ''], ['B000000003', ''],
    ['', 'https://www.amazon.com/x'],                            // no valid ASIN, kept by its Amazon link
    ['B000000005', ''],
  ]);
  const first = clean[0];
  assert.equal(first.image, 'https://m.media-amazon.com/images/I/abc.jpg');
  assert.equal(first.listingPrice, 4.99);
  assert.equal(first.pageNumber, 3);
  assert.equal(first.sponsored, true);
  assert.equal(clean[2].image, '', 'images only from Amazon image hosts');
  assert.equal(R.sanitizeProduct({ asin: 'B000000009', title: 'a'.repeat(900), details: 'd'.repeat(9000), score: 150, source: 'hacked', verdict: '<b>x</b>'.repeat(10) }).title.length, 400);
  const odd = R.sanitizeProduct({ asin: 'B000000009', score: 150, source: 'hacked', details: 'd'.repeat(9000), title: 'ok\u0000\u0007' });
  assert.equal(odd.score, null);
  assert.equal(odd.source, 'unrated');
  assert.equal(odd.details.length, 2600);
  assert.equal(odd.title, 'ok', 'control characters are dropped');
  assert.equal(R.sanitizeResults(Array.from({ length: 900 }, (_, i) => p('B' + String(i).padStart(9, '0'), i % 100))).length, R.MAX_RESULTS);
  assert.equal(R.sanitizeSourceUrl('https://www.amazon.co.uk/s?k=oats'), 'https://www.amazon.co.uk/s?k=oats');
  assert.equal(R.sanitizeSourceUrl('https://www.amazon.com.evil.example/s'), '');
});

// ------------------------------------------------------------------ worker
function worker() {
  const session = {};
  const created = [];
  const panels = [];
  let onMessage = null;
  const event = { addListener() {} };
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch: async () => { throw new Error('offline'); },
    chrome: {
      runtime: { id: 'ext', getManifest: () => ({ version: '1.1.0' }), getURL: p => `chrome-extension://ext/${p}`,
        sendMessage: async () => ({}), getContexts: async () => [],
        onMessage: { addListener(fn) { onMessage = fn; } }, onStartup: event, onInstalled: event },
      alarms: { create() {}, get: (n, cb) => cb({}), onAlarm: event },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      tabs: { create: async o => { created.push(o.url); return { id: 9 }; } },
      sidePanel: { open: async o => { panels.push(o.tabId); } },
      storage: {
        onChanged: { addListener() {} },
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        sync: { get: async () => ({}), set: async () => {} },
        session: { set: async v => Object.assign(session, JSON.parse(JSON.stringify(v))) },
      },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['engine/db/_module.js', 'engine/db/allergens.js', 'engine/categories.js', 'engine/db/ingestible.js',
    'engine/db/prefs.js', 'engine/db/ocr-text.js', 'engine/db/product-cache.js', 'engine/db/sorted-results.js',
    'worker/messages.js', 'worker/sheet-store.js', 'background.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/' + f), 'utf8'), context);
  }
  return { session, created, panels, call: e => vm.runInContext(e, context),
    send: (msg, sender) => new Promise(resolve => { if (onMessage(msg, sender, resolve) !== true) resolve(undefined); }) };
}
const amazonTab = { id: 'ext', tab: { id: 3, url: 'https://www.amazon.com/s?k=oats' } };
const targetTab = { id: 'ext', tab: { id: 4, url: 'https://www.target.com/s?searchTerm=oats' } };
const sortedPage = { id: 'ext', url: 'chrome-extension://ext/src/options/sorted.html', tab: { id: 7 } };
const settingsPage = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
const popup = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };

test('who may ask: Amazon tabs open the list and settings; only the list page opens the side panel', () => {
  const w = worker();
  const allow = (type, s) => w.call(`allowMessage({type:${JSON.stringify(type)}}, ${JSON.stringify(s)})`);
  for (const type of ['openSortedResults', 'openSortSettings']) {
    assert.equal(allow(type, amazonTab), true, type);
    for (const other of [targetTab, sortedPage, settingsPage, popup, { id: 'other', tab: amazonTab.tab }]) {
      assert.equal(allow(type, other), false, `${type} from ${JSON.stringify(other)}`);
    }
  }
  assert.equal(allow('openResultsSidePanel', sortedPage), true);
  for (const other of [amazonTab, popup, settingsPage, { id: 'ext', url: 'chrome-extension://ext/src/options/sidepanel.html' }]) {
    assert.equal(allow('openResultsSidePanel', other), false, JSON.stringify(other));
  }
});

test('the worker re-checks the list, keeps it in session storage and opens the list tab', async () => {
  const w = worker();
  const res = await w.send({ type: 'openSortedResults', sourceUrl: 'javascript:alert(1)', results: [
    p('B000000001', 70), { asin: 'B000000002', url: 'javascript:alert(1)', title: 'bad' }, 'junk',
  ] }, amazonTab);
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.deepEqual(w.created, ['chrome-extension://ext/src/options/sorted.html']);
  assert.equal(w.session.sortedResults.items[1].url, '');
  assert.equal(w.session.sortedResults.sourceUrl, '', 'a non-Amazon source link is dropped');
  const empty = await w.send({ type: 'openSortedResults', results: ['nothing useful'] }, amazonTab);
  assert.equal(empty.ok, false);
  assert.equal(w.created.length, 1, 'no tab for an empty list');
  assert.equal(await w.send({ type: 'openSortedResults', results: [p('B000000001', 70)] }, targetTab), undefined, 'refused from Target');
});

test('settings open at the sort section; the side panel opens for the list tab', async () => {
  const w = worker();
  assert.equal((await w.send({ type: 'openSortSettings' }, amazonTab)).ok, true);
  assert.deepEqual(w.created, ['chrome-extension://ext/src/options/options.html#sec-sort']);
  assert.equal((await w.send({ type: 'openResultsSidePanel' }, sortedPage)).ok, true);
  assert.deepEqual(w.panels, [7]);
});
