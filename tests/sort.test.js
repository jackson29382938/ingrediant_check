// Amazon's sort menu -> side panel: order, price per ounce, priorities, speed, the sanitizer the
// worker applies, and the worker's handlers.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadWorker } = require('./worker-scripts.js');
const R = require('../src/engine/db/sorted-results.js');
const U = require('../src/engine/db/unit-price.js');
const SP = require('../src/engine/db/speed.js');
const SC = require('../src/engine/db/score-cache.js');
const PC = require('../src/engine/db/product-cache.js');

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
  assert.equal(R.parseMoney('Price: $\u00a04.99 ($0.30/Ounce)'), 4.99);
  assert.equal(R.parseMoney('no price'), null);
});

test('sort settings are bounded', () => {
  assert.deepEqual(R.sanitizeSort({}), { sortMissing: 'rate-first', sortLoadMore: false, sortCount: 100, sortTimeLimit: 60 });
  assert.deepEqual(R.sanitizeSort({ sortMissing: 'end', sortLoadMore: true, sortCount: '250' }), { sortMissing: 'end', sortLoadMore: true, sortCount: 250, sortTimeLimit: 60 });
  assert.equal(R.sanitizeSort({ sortTimeLimit: 0 }).sortTimeLimit, 0, 'no limit is allowed');
  assert.equal(R.sanitizeSort({ sortTimeLimit: '30' }).sortTimeLimit, 30);
  assert.equal(R.sanitizeSort({ sortTimeLimit: 7 }).sortTimeLimit, 60, 'an odd value falls back to the default');
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


test('price per ounce: the Cost Sorter\'s own cases', () => {
  const near = (a, e) => assert.ok(Math.abs(a - e) < 1e-3, `${a} != ${e}`);
  near(U.parseDisplayedUnitPrice('$12.99 ($0.81/Ounce)'), 0.81);
  near(U.parseDisplayedUnitPrice('$3.49 (38.1\u00a2/Ounce)'), 0.381);
  near(U.parseDisplayedUnitPrice('$9.99 ($4.99/Pound)'), 4.99 / 16);
  near(U.parseDisplayedUnitPrice('$5.00 ($1.25/100 g)'), 1.25 / (100 * 0.03527396195));
  near(U.parseDisplayedUnitPrice('$4 ($0.25/Fl Oz)'), 0.25);
  assert.equal(U.parseDisplayedUnitPrice('$9.99 ($0.50/Count)'), null);
  assert.equal(U.parseWeightToOunces('Coffee 12 oz (Pack of 6)'), 72);
  assert.equal(U.parseWeightToOunces('Beans 15 oz, 12-Pack'), 180);
  assert.equal(U.parseWeightToOunces('Green Tea, 100 Count, 7 oz'), null, 'a count may be per item: no guess');
  assert.equal(U.parseWeightToOunces('Mints .5 oz'), 0.5);
  assert.equal(U.parseWeightToOunces('Almonds 39 oz (2.4 lb)'), 39, 'equivalent weights are one size');
  // The Cost Sorter gave up here (two different weights); "25g Protein" is a nutrient, so it is 2 lb.
  assert.equal(U.parseWeightToOunces('Protein Powder 2 lb, 25g Protein'), 32);
  assert.equal(U.parseWeightToOunces('Trail mix 2 lb (16 oz)'), null, 'two different sizes: no guess');
  // The Cost Sorter left fluid ounces unread (null); they are read now, per fluid ounce.
  assert.equal(U.parseWeightToOunces('Sparkling Water 12 fl oz, 12-Pack'), 144);
  near(U.parseWeightToOunces('Rice 2 kg'), 70.548);
});

test('price per ounce: Amazon\'s unit price wins; the setting decides the rest', () => {
  const card = { title: 'Rolled Oats, 32 oz', text: 'Rolled Oats\n$6.40\n2K bought in past month', listingPrice: 6.4 };
  assert.deepEqual(U.unitPriceFor(card, {}), { unitPrice: 0.2, unitSource: 'calculated', unitKind: 'weight' });
  assert.deepEqual(U.unitPriceFor(card, { unitMissing: 'displayed-only' }), { unitPrice: null, unitSource: 'none', unitKind: '' });
  assert.deepEqual(U.unitPriceFor({ ...card, text: '$6.40 ($0.18/Ounce)' }, { unitMissing: 'displayed-only' }), { unitPrice: 0.18, unitSource: 'amazon', unitKind: 'weight' });
  const weightInText = { title: 'Rolled Oats', text: 'Rolled Oats\nNet Wt 32 oz\n$6.40', listingPrice: 6.4 };
  assert.equal(U.unitPriceFor(weightInText, {}).unitPrice, null, 'by default only the title is read for a weight');
  assert.equal(U.unitPriceFor(weightInText, { unitMissing: 'infer-more' }).unitPrice, 0.2);
  assert.equal(U.sanitizeUnit({ unitMissing: 'guess' }).unitMissing, 'calculate-clear');
});

test('price per ounce on the owner\'s kefir search (2026-09-25): fluid ounces, FZ, counts, nutrient grams', () => {
  const near = (a, e) => assert.ok(a != null && Math.abs(a - e) < 0.002, `${a} != ${e}`);
  const per = (title, price, extra = '') => U.unitPriceFor({ title, text: `${title}\n${extra}`, listingPrice: price }, {});
  // Amazon's own "$0.11/fluid ounce" was not recognised, so these showed "No price per ounce".
  const plain = per('Lifeway Low Fat Kefir – Probiotic Drink with 10g Protein, 12 Live Active Cultures – Plain, 32 oz.', 3.5, '$3.50 ($0.11/fluid ounce)');
  assert.deepEqual([plain.unitPrice, plain.unitSource, plain.unitKind], [0.11, 'amazon', 'fluid']);
  assert.equal(U.parseDisplayedUnit('$4.99 ($0.16/FZ)').kind, 'fluid');
  near(U.parseDisplayedUnitPrice('$3.50 ($0.11/fluid\u00a0ounce)'), 0.11);   // Amazon's no-break space
  near(U.parseDisplayedUnitPrice('$2.99 ($0.30/100 ml)'), 0.30 / (100 / 29.5735295625));
  // "10g Protein" was taken for the package: an 8 fl oz bottle at $2.59 showed $7.34/oz.
  near(per('Lifeway Organic Whole Milk Kefir, Mixed Berry, 8 Fl Oz, 10g Protein, 12 Live Active Cultures', 2.59).unitPrice, 2.59 / 8);
  near(per('Lifeway Organic Whole Milk Kefir, 10g Protein, Mixed Berry, 32 Fl Oz', 6.99).unitPrice, 6.99 / 32);
  near(per('Chobani® 20g Protein Lowfat Greek Yogurt Drink Strawberries & Cream 10 fl oz 4PK', 9.79).unitPrice, 9.79 / 40);
  near(per('Lifeway Organic Low Fat Kefir, Plain, 32 Ounce, 11g Protein, 12 Live Active Cultures', 6.99).unitPrice, 6.99 / 32);
  // "32 Fl Oz" and Whole Foods' "32 FZ" were not read at all.
  near(per('Meyenberg Goat Dairy, Kefir Goat Plain, 32 Fl Oz', 9.49).unitPrice, 9.49 / 32);
  near(per('365 by Whole Foods Market Plain Kefir, 32 FZ', 4.99).unitPrice, 4.99 / 32);
  assert.equal(per('365 by Whole Foods Market Plain Kefir, 32 FZ', 4.99).unitKind, 'fluid');
  // A liquid's size is per bottle next to a count; a weight next to a count stays unsorted.
  near(per('LifeWay Kefir Multi Pack Organic Low Fat Mixed Berry, 3.5 Fl Oz, 4 Count', 5.99).unitPrice, 5.99 / 14);
  near(per('Activia Dailies Vanilla Low Fat Yogurt Drink, 3.1 fl oz, 8 Count', 4.99).unitPrice, 4.99 / 24.8);
  assert.equal(per('Green Tea, 100 Count, 7 oz', 5).unitPrice, null);
  near(per('Whole Milk, 1 Gallon', 4.99).unitPrice, 4.99 / 128);
  near(per('Orange Juice 52 fl oz (1.53 L)', 4.5).unitPrice, 4.5 / 52);
  near(per('Optimum Nutrition Gold Standard Whey Protein 5 lb, 24g Protein, 5.5g BCAA', 59.99).unitPrice, 59.99 / 80);
  near(per('Monster Energy Ultra 16 Fl Oz, 24 Pack, 384 Fl Oz Total', 35.99).unitPrice, 35.99 / 384);
  assert.equal(per('Mooala Bananamilk, Plant-Based Beverage, On the Go 12 Pack', 35.99).unitPrice, null, 'no size: no guess');
  assert.equal(U.parseQuantity('Protein shake 32 fl oz, 2 lb tub'), null, 'volume and weight together: no guess');
});

test('priorities: presets, bounds, missing values last, ties in Amazon\'s order', () => {
  const items = [
    p('B000000001', 90, { unitPrice: 0.5, listingPrice: 5, ratingValue: 4.5, reviewCount: 100 }),
    p('B000000002', 40, { unitPrice: 0.2, listingPrice: 3, ratingValue: 4.8, reviewCount: 9000 }),
    p('B000000003', null, { unitPrice: null, listingPrice: 9 }),
    p('B000000004', 40, { unitPrice: 0.2, listingPrice: 3 }),
  ];
  const order = w => R.rank(items, w).map(r => r.product.asin.slice(-1)).join('');
  assert.equal(order(R.presetFor('health')), '1243', 'health: best first, the two 40s in page order, no score last');
  assert.equal(order(R.presetFor('unitPrice')), '2413', 'price per ounce: cheapest first, none last');
  assert.equal(order(R.presetFor('price')), '2413');
  assert.equal(order(R.presetFor('rating')), '2134', 'no rating counts as the worst; those tie in Amazon\'s order');
  assert.equal(R.rank(items, R.presetFor('health'))[0].match, 90);
  assert.deepEqual(R.rank(items, R.presetFor('health'))[3].missing, ['health']);
  assert.deepEqual(R.sanitizeWeights({ health: 99, unitPrice: -3, price: '4', rating: 'x' }), { health: 10, unitPrice: 0, price: 4, rating: 0, reviews: 0 });
  assert.deepEqual(R.sanitizeWeights({}), R.presetFor('health'), 'nothing weighted falls back to health');
  assert.equal(R.sanitizeWeights(R.presetFor('unitPrice'), { unitEnabled: false }).health, 10, 'price per ounce off: back to health');
  assert.deepEqual(R.rank([], R.presetFor('balanced')), []);
});

test('the speed setting: Balanced is exactly the old behaviour', () => {
  const b = SP.profile('balanced');
  assert.equal(SP.sanitizeSpeed({}).speedMode, 'balanced');
  assert.equal(SP.sanitizeSpeed({ speedMode: 'ludicrous' }).speedMode, 'balanced');
  assert.equal(b.maxAgeMs, SC.TTL_MS, 'score cache age');
  assert.equal(b.maxAgeMs, PC.MAX_AGE_MS, 'saved readings age');
  assert.equal(b.autoFetches, 60, 'search.js MAX_AUTO_FETCHES');
  assert.equal(b.sharedMs, PC.MAX_AGE_MS, 'shared readings: the worker\'s own limit');
  const ages = SP.MODES.map(m => SP.profile(m).maxAgeDays);
  assert.deepEqual(ages, [...ages].sort((a, c) => c - a), 'fastest keeps scores longest, freshest shortest');
  for (const m of SP.MODES) assert.ok(SP.profile(m).sharedDays <= 30, `${m}: the worker drops shared rows past 30 days anyway`);
  const now = Date.parse('2026-09-25T12:00:00Z');
  const daysAgo = d => new Date(now - d * SP.DAY).toISOString();
  assert.equal(SP.sharedUsable(daysAgo(10), 'balanced', now), true);
  assert.equal(SP.sharedUsable(daysAgo(10), 'fresh', now), false);
  assert.equal(SP.sharedUsable(daysAgo(0.1), 'freshest', now), false, 'most up to date never uses shared readings');
  assert.equal(SP.sharedUsable('not a date', 'balanced', now), false);
  const hit = { schema: SC.SCHEMA, v: '1', store: 'amazon.com', asin: 'B000000001', prefs: SC.fingerprint({}, 'page'), score: 80, t: now - 10 * SP.DAY, source: 'page' };
  const ask = maxAgeMs => SC.valid(hit, { store: 'amazon.com', asin: 'B000000001', version: '1', prefs: {}, maxAgeMs }, now);
  assert.equal(ask(undefined), true, 'default age limit unchanged');
  assert.equal(ask(SP.profile('fresh').maxAgeMs), false);
  const row = { scanned_at: new Date(now - 10 * SP.DAY).toISOString(), pulls: 0 };
  assert.equal(PC.stale(row, now), false);
  assert.equal(PC.stale(row, now, SP.profile('fresh').maxAgeMs), true);
});

test('the list keeps price per ounce, rating and reviews, bounded', () => {
  const clean = R.sanitizeProduct(p('B000000001', 70, { unitPrice: 0.123456, unitSource: 'amazon', ratingValue: 4.6, reviewCount: 12345.4 }));
  assert.equal(clean.unitPrice, 0.1235);
  assert.equal(clean.unitSource, 'amazon');
  assert.equal(clean.ratingValue, 4.6);
  assert.equal(clean.reviewCount, 12345);
  const odd = R.sanitizeProduct(p('B000000002', 70, { unitPrice: -1, unitSource: 'amazon', ratingValue: 9, reviewCount: 'lots' }));
  assert.equal(odd.unitPrice, null);
  assert.equal(odd.unitSource, 'none', 'no price, no source');
  assert.equal(odd.ratingValue, null);
  assert.equal(odd.reviewCount, null);
  assert.equal(R.sanitizeStatus('a\u0007b'.repeat(200)).length, 300);
});

// ------------------------------------------------------------------ worker
function worker({ panelFails = false, local = {}, answer = 'ok' } = {}) {
  const session = {};
  const created = [];
  const calls = [];
  const sent = [];
  let onMessage = null;
  let onCommand = null;
  const event = { addListener() {} };
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout, Promise,
    fetch: async () => { throw new Error('offline'); },
    chrome: {
      runtime: { id: 'ext', getManifest: () => ({ version: '1.1.0' }), getURL: p => `chrome-extension://ext/${p}`,
        sendMessage: async () => ({}), getContexts: async () => [],
        onMessage: { addListener(fn) { onMessage = fn; } }, onStartup: event, onInstalled: event },
      alarms: { create() {}, get: (n, cb) => cb({}), onAlarm: event },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      tabs: { create: async o => { created.push(o.url); return { id: 9 }; },
        sendMessage: async (id, m) => {
          sent.push([id, m]);
          if (answer === 'throw') throw new Error('Could not establish connection. Receiving end does not exist.');
          return answer === 'ok' ? { ok: true } : undefined;
        } },
      commands: { onCommand: { addListener(fn) { onCommand = fn; } } },
      sidePanel: { open: o => { calls.push(['sidePanel.open', o.tabId]); return panelFails ? Promise.reject(new Error('user gesture')) : Promise.resolve(); } },
      storage: {
        onChanged: { addListener() {} },
        local: { get: async () => ({ ...local }), set: async () => {}, remove: async () => {} },
        sync: { get: async () => ({}), set: async () => {} },
        session: {
          set: async v => { calls.push(['session.set', Object.keys(v).join()]); Object.assign(session, JSON.parse(JSON.stringify(v))); },
          get: async k => ({ [k]: session[k] && JSON.parse(JSON.stringify(session[k])) }),
        },
      },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  loadWorker(vm, context);   // exactly the scripts the worker imports (tests/worker-scripts.js)
  return { session, created, calls, sent, call: e => vm.runInContext(e, context),
    // A key press: the browser hands the command and the tab; what runs first is recorded in `calls`.
    command: (name, tab) => { onCommand(name, tab); return new Promise(r => setImmediate(r)).then(() => new Promise(r => setImmediate(r))).then(() => new Promise(r => setImmediate(r))); },
    hasCommandListener: () => typeof onCommand === 'function',
    // Returns the synchronous calls made before the listener returned, then the reply.
    send: (msg, sender) => {
      let sync;
      const reply = new Promise(resolve => {
        const async = onMessage(msg, sender, resolve);
        sync = calls.slice();
        if (async !== true) resolve(undefined);
      });
      return reply.then(r => ({ reply: r, sync }));
    } };
}
const amazonTab = { id: 'ext', tab: { id: 3, windowId: 1, url: 'https://www.amazon.com/s?k=oats' } };
const otherAmazonTab = { id: 'ext', tab: { id: 5, windowId: 1, url: 'https://www.amazon.com/s?k=rice' } };
const targetTab = { id: 'ext', tab: { id: 4, url: 'https://www.target.com/s?searchTerm=oats' } };
const sortedPage = { id: 'ext', url: 'chrome-extension://ext/src/options/sorted.html', tab: { id: 7 } };
const panelPage = { id: 'ext', url: 'chrome-extension://ext/src/options/sidepanel.html' };
const settingsPage = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
const popup = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };

test('who may ask: only Amazon tabs; the list pages send no messages at all', () => {
  const w = worker();
  const allow = (type, s) => w.call(`allowMessage({type:${JSON.stringify(type)}}, ${JSON.stringify(s)})`);
  for (const type of ['openSortedPanel', 'updateSortedResults', 'openSortedTab']) {
    assert.equal(allow(type, amazonTab), true, type);
    for (const other of [targetTab, sortedPage, panelPage, settingsPage, popup, { id: 'other', tab: amazonTab.tab }]) {
      assert.equal(allow(type, other), false, `${type} from ${JSON.stringify(other)}`);
    }
  }
  for (const gone of ['openSortedResults', 'openSortSettings', 'openResultsSidePanel']) {
    assert.equal(allow(gone, amazonTab) || allow(gone, sortedPage), false, `${gone} is no longer a message`);
  }
});

test('choosing a menu option opens the side panel before anything else, then stores an empty list', async () => {
  const w = worker();
  const { reply, sync } = await w.send({ type: 'openSortedPanel', mode: 'unitPrice', sourceUrl: 'https://www.amazon.com/s?k=oats', unitEnabled: true }, amazonTab);
  assert.deepEqual(sync[0], ['sidePanel.open', 3], 'sidePanel.open is the first call, while the click still counts');
  assert.equal(reply.ok, true);
  assert.ok(reply.runId);
  const list = w.session.sortedResults;
  assert.equal(list.runId, reply.runId);
  assert.equal(list.mode, 'unitPrice');
  assert.equal(list.loading, true);
  assert.deepEqual(list.items, []);
  assert.equal(list.sourceTabId, 3);
  assert.deepEqual(w.session.sortWeights, R.presetFor('unitPrice'), 'the chosen option sets the priorities');
  const odd = await w.send({ type: 'openSortedPanel', mode: 'everything', sourceUrl: 'javascript:alert(1)' }, amazonTab);
  assert.equal(w.session.sortedResults.mode, 'health');
  assert.equal(w.session.sortedResults.sourceUrl, '', 'a non-Amazon source link is dropped');
  assert.notEqual(odd.reply.runId, reply.runId);
});

test('the list reopens with the priorities last set for that menu option, unless remembering is off', async () => {
  const mine = { health: 3, unitPrice: 9, price: 0, rating: 0, reviews: 0 };
  const local = { sortPriorities: { unitPrice: mine } };
  const open = async (mode, conf) => {
    const w = worker({ local: conf });
    await w.send({ type: 'openSortedPanel', mode, sourceUrl: 'https://www.amazon.com/s?k=oats', unitEnabled: true }, amazonTab);
    return w.session.sortWeights;
  };
  assert.deepEqual(await open('unitPrice', local), mine, 'remembered for this option');
  assert.deepEqual(await open('health', local), R.presetFor('health'), 'another option keeps its own default');
  assert.deepEqual(await open('unitPrice', { ...local, sortRemember: false }), R.presetFor('unitPrice'), 'off: the default again');
  assert.deepEqual(await open('unitPrice', { sortPriorities: { unitPrice: { health: 'x', unitPrice: 99 } } }),
    R.sanitizeWeights({ unitPrice: 99 }), 'what is stored is re-bounded on the way out');
});

test('priorities are kept per menu option, bounded, and unknown options dropped', () => {
  const clean = R.sanitizePriorities({ sortPriorities: { health: { health: 50, price: -3 }, unitPrice: 'x', rating: { health: 1 } } }).sortPriorities;
  assert.deepEqual(Object.keys(clean), ['health']);
  assert.equal(clean.health.health, 10);
  assert.equal(clean.health.price, 0);
  assert.deepEqual(R.sanitizePriorities(null), { sortPriorities: {} });
});

// ------------------------------------------------------------------ keyboard shortcuts
const searchTab = { id: 3, windowId: 1, url: 'https://www.amazon.com/s?k=oats' };
const nextTick = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

test('shortcut: the worker listens for the two commands the manifest declares', () => {
  const manifest = require('../manifest.json');
  assert.deepEqual(Object.keys(manifest.commands).sort(), ['sort-health', 'sort-price']);
  assert.ok(manifest.commands['sort-health'].suggested_key.default, 'the health sort has a default key');
  assert.ok(!manifest.commands['sort-price'].suggested_key, 'price per ounce has no default key, so it cannot collide with another extension');
  assert.ok(worker().hasCommandListener(), 'chrome.commands.onCommand is wired');
});

test('shortcut: the health sort opens the side panel first, then tells the page to start gathering', async () => {
  const w = worker();
  await w.command('sort-health', searchTab);
  await nextTick();
  assert.deepEqual(w.calls[0], ['sidePanel.open', 3], 'sidePanel.open is the very first call, while the key press still counts');
  const list = w.session.sortedResults;
  assert.equal(list.mode, 'health');
  assert.equal(list.loading, true);
  assert.equal(list.sourceTabId, 3);
  assert.equal(list.sourceUrl, 'https://www.amazon.com/s?k=oats');
  assert.deepEqual(w.sent.map(([id, m]) => [id, m.type, m.mode, m.runId]), [[3, 'sortStart', 'health', list.runId]]);
  assert.deepEqual(w.session.sortWeights, R.presetFor('health'));
});

test('shortcut: the price shortcut sorts by price per ounce', async () => {
  const w = worker();
  await w.command('sort-price', searchTab);
  await nextTick();
  assert.equal(w.session.sortedResults.mode, 'unitPrice');
  assert.deepEqual(w.session.sortWeights, R.presetFor('unitPrice'));
  assert.equal(w.sent[0][1].mode, 'unitPrice');
});

test('shortcut: it does nothing off Amazon search pages, and ignores commands it does not know', async () => {
  const w = worker();
  for (const url of ['https://www.amazon.com/dp/B000000001', 'https://www.target.com/s?searchTerm=oats', 'https://example.com/s?k=oats',
    'https://www.amazon.com.evil.example/s?k=oats', 'chrome://extensions', '']) {
    await w.command('sort-health', { id: 3, url });
  }
  await w.command('something-else', searchTab);
  await w.command('sort-health', undefined);
  await w.command('sort-health', { url: searchTab.url });
  await nextTick();
  assert.deepEqual(w.calls, [], 'no side panel was opened');
  assert.deepEqual(w.sent, []);
  assert.equal(w.session.sortedResults, undefined);
  await w.command('sort-health', { id: 4, url: 'https://www.amazon.de/s?k=hafer' });
  await w.command('sort-health', { id: 5, url: 'https://www.amazon.co.uk/b/?node=123&k=oats' });
  await nextTick();
  assert.equal(w.calls.filter(c => c[0] === 'sidePanel.open').length, 2, 'other Amazon stores work, including a search carrying only k=');
});

test('shortcut: with nobody to answer on the page, the panel says why instead of staying on "loading"', async () => {
  for (const answer of ['throw', 'none', 'no']) {
    const w = worker({ answer });
    await w.command('sort-health', searchTab);
    await nextTick();
    const list = w.session.sortedResults;
    assert.equal(list.loading, false, `${answer}: not left loading`);
    assert.match(list.status, /not sorting this page/);
  }
});

test('shortcut: price per ounce switched off says so and sends nothing to the page', async () => {
  const w = worker({ local: { unitPrice: false } });
  await w.command('sort-price', searchTab);
  await nextTick();
  assert.equal(w.sent.length, 0);
  assert.equal(w.session.sortedResults.loading, false);
  assert.match(w.session.sortedResults.status, /switched off/);
  const health = worker({ local: { unitPrice: false } });
  await health.command('sort-health', searchTab);
  await nextTick();
  assert.equal(health.sent.length, 1, 'the health sort does not depend on price per ounce');
});

test('shortcut: no side panel (older Chrome) opens the list in a tab and still starts gathering', async () => {
  const w = worker({ panelFails: true });
  await w.command('sort-health', searchTab);
  await nextTick();
  assert.deepEqual(w.created, ['chrome-extension://ext/src/options/sorted.html']);
  assert.equal(w.sent.length, 1);
});

test('shortcut: it starts from the priorities the reader last set for that option, like the menu', async () => {
  const mine = { health: 1, unitPrice: 9, price: 0, rating: 0, reviews: 0 };
  const w = worker({ local: { sortPriorities: { unitPrice: mine } } });
  await w.command('sort-price', searchTab);
  await nextTick();
  assert.deepEqual(w.session.sortWeights, mine);
});

test('shortcut: pressing it twice starts a newer list; only the newest run id is told to the page', async () => {
  const w = worker();
  await w.command('sort-health', searchTab);
  await w.command('sort-health', searchTab);
  await nextTick();
  assert.equal(w.sent.length, 2);
  assert.notEqual(w.sent[0][1].runId, w.sent[1][1].runId);
  assert.equal(w.session.sortedResults.runId, w.sent[1][1].runId);
});

test('no side panel: the reply says so and the content script opens a tab instead', async () => {
  const w = worker({ panelFails: true });
  const { reply } = await w.send({ type: 'openSortedPanel', mode: 'health', sourceUrl: 'https://www.amazon.com/s?k=oats' }, amazonTab);
  assert.equal(reply.ok, false);
  assert.ok(reply.runId, 'the list is still kept for the tab');
  assert.equal(w.session.sortedResults.loading, true);
  await w.send({ type: 'openSortedTab' }, amazonTab);
  assert.deepEqual(w.created, ['chrome-extension://ext/src/options/sorted.html']);
});

test('updates are re-checked, and only the newest run from its own tab lands', async () => {
  const w = worker();
  const { reply } = await w.send({ type: 'openSortedPanel', mode: 'health', sourceUrl: 'https://www.amazon.com/s?k=oats' }, amazonTab);
  const items = [p('B000000001', 70, { unitPrice: 0.2, unitSource: 'calculated' }), { asin: 'B000000002', url: 'javascript:alert(1)', title: 'bad' }, 'junk'];
  const ok = (await w.send({ type: 'updateSortedResults', runId: reply.runId, items, loading: true, status: 'Reading\u0000…' }, amazonTab)).reply;
  assert.equal(ok.ok, true);
  assert.equal(ok.count, 2);
  assert.equal(w.session.sortedResults.items[1].url, '');
  assert.equal(w.session.sortedResults.status, 'Reading…');
  assert.equal(w.session.sortedResults.mode, 'health', 'an update keeps what the choice set');
  const wrongTab = (await w.send({ type: 'updateSortedResults', runId: reply.runId, items: [], loading: false }, otherAmazonTab)).reply;
  assert.equal(wrongTab.stale, true);
  const old = (await w.send({ type: 'updateSortedResults', runId: 'older', items: [], loading: false }, amazonTab)).reply;
  assert.equal(old.stale, true);
  assert.equal(w.session.sortedResults.items.length, 2, 'refused updates change nothing');
  assert.equal((await w.send({ type: 'updateSortedResults', runId: reply.runId, items: [] }, targetTab)).reply, undefined, 'refused from Target');
});

test('why it scored: bounded rows, points or CAP, only for a scored listing', () => {
  const why = { plus: [{ c: 8, why: 'Organic label claim' }, { c: 5, why: 'Fermented / live cultures', ing: 'cultures' }],
    minus: [{ c: -5, why: 'Naturally occurring sugar', ing: 'pasteurized organic milk' }, { c: 'CAP', why: 'Capped' }, { c: 500, why: 'absurd' },
      { c: -3, why: '' }, null, 'junk'], neutral: Array.from({ length: 9 }, (_, i) => ({ c: 0, why: `n${i}` })), extra: [{ c: 1, why: 'x' }] };
  const clean = R.sanitizeProduct(p('B000000001', 78, { why })).why;
  assert.deepEqual(clean.plus.map(r => [r.c, r.why, r.ing]), [[8, 'Organic label claim', ''], [5, 'Fermented / live cultures', 'cultures']]);
  assert.deepEqual(clean.minus.map(r => r.c), [-5, 'CAP'], 'out-of-range points and empty reasons dropped');
  assert.equal(clean.neutral.length, 3);
  assert.equal(clean.extra, undefined);
  assert.equal(R.sanitizeProduct(p('B000000002', null, { why })).why, null, 'no score, no reasons');
  assert.equal(R.sanitizeProduct(p('B000000003', 60)).why, null, 'reasons not kept: null');
  assert.equal(R.sanitizeProduct(p('B000000004', 99, { why: {} })).why.clean, true, 'nothing moved the score');
  assert.equal(R.sanitizeProduct(p('B000000005', 70, { why: { plus: [{ c: 3, why: 'x'.repeat(500) }] } })).why.plus[0].why.length, 140);
});

test('price-only priorities cannot retain health weights or fall back to health sorting', () => {
  const unit=R.sanitizeWeights({health:10},{healthEnabled:false});assert.equal(unit.health,0);assert.equal(unit.unitPrice,10);
  const price=R.sanitizeWeights({health:10},{healthEnabled:false,unitEnabled:false});assert.equal(price.health,0);assert.equal(price.price,10);
});
