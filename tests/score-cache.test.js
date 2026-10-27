const { test } = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/engine/db/score-cache.js');
const engine = require('../src/engine/score.js');
const cats = require('../src/engine/categories.js');
const corpus = require('./corpus.json');

test('NOVA stays constant across preferences for every corpus label', () => {
  const profiles = [
    ...Object.values(cats.PRESETS).map(p => p.weights),
    ...[0, 0.01, 0.5, 2].map(n => Object.fromEntries(cats.CATEGORIES.map(c => [c.id, n]))),
  ];
  for (const entry of [...corpus.products, ...corpus.defects]) {
    const expected = engine.score(entry.product).nova;
    for (const weights of profiles) assert.equal(engine.score(entry.product, { weights }).nova, expected, entry.id);
  }
  const product = { ingredients_text: 'Milk, sugar, natural flavors' };
  assert.equal(engine.score(product).nova, 4);
  const off = engine.score(product, { weights: profiles[5] });
  assert.equal(off.nova, 4);
  assert.notEqual(off.score, engine.score(product).score);
});

const now = 1800000000000;
const context = { store: 'www.amazon.com', asin: 'B000000001', version: '1.0.1', prefs: {} };
const entry = { schema: cache.SCHEMA, t: now, v: context.version, store: 'amazon.com',
  asin: context.asin, prefs: cache.fingerprint({}), source: 'page', score: 90 };
test('cache rejects expired, mismatched, incomplete, and manual records', () => {
  assert.equal(cache.SCHEMA, 3);
  assert.equal(cache.valid(entry, context, now), true);
  assert.equal(cache.valid(entry, { ...context, store: 'amazon.com' }, now), true);
  for (const patch of [{ t: now - cache.TTL_MS }, { t: now + 1 }, { schema: 1 }, { schema: 2 },
    { v: '1.0.0' }, { store: 'amazon.co.uk' }, { asin: 'B000000002' },
    { prefs: cache.fingerprint({ weights: { sugar: 2 } }) }, { source: '' },
    { score: NaN }, { source: 'manual-paste' }, { source: 'food-override' }]) {
    assert.equal(cache.valid({ ...entry, ...patch }, context, now), false, JSON.stringify(patch));
  }
  assert.equal(cache.valid({ ...entry, source: 'manual-paste' }, { ...context, allowManual: true }, now), true);
  assert.equal(cache.key('www.amazon.com', context.asin), cache.key('amazon.com', context.asin));
  assert.notEqual(cache.key(context.store, context.asin), cache.key('www.amazon.co.uk', context.asin));
});
test('routine releases retain compatible scores but changes to rules, extraction, preferences or age do not', () => {
  const next = { ...context, version: '1.15.2' };
  for (const version of ['1.15.0', '1.15.1']) assert.equal(cache.valid({ ...entry, v: version }, next, now), true);
  const stamped = { ...entry, cacheRevision: cache.CACHE_REVISION };
  assert.equal(cache.valid(stamped, next, now), true);
  for (const patch of [{ cacheRevision: 0 }, { cacheRevision: 999 }, { prefs: JSON.stringify({ rules: 'old' }) },
    { t: now - cache.TTL_MS }, { source: 'manual-paste' }, { v: '' }]) {
    assert.equal(cache.valid({ ...stamped, ...patch }, next, now), false, JSON.stringify(patch));
  }
  assert.equal(cache.valid({ ...entry, v: '1.14.0' }, next, now), false, 'unknown legacy extraction is not migrated');
});
test('a future extraction-contract bump cannot retain unstamped legacy or prior-contract scores', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const sandbox = { AIR: { db: { ...AIR.db }, stores: AIR.stores } };
  sandbox.AIRmodule = (name, api) => { sandbox.AIR.db[name] = api; return api; };
  const futureRevision = cache.CACHE_REVISION + 1;
  const source = fs.readFileSync(require.resolve('../src/engine/db/score-cache.js'), 'utf8')
    .replace(/const CACHE_REVISION = \d+;/, `const CACHE_REVISION = ${futureRevision};`);
  vm.runInNewContext(source, sandbox);
  const future = sandbox.AIR.db.scoreCache, ask = { ...context, version: '2.0.0' };
  assert.equal(future.valid({ ...entry, v: '1.15.1' }, ask, now), false);
  assert.equal(future.valid({ ...entry, cacheRevision: cache.CACHE_REVISION }, ask, now), false);
  assert.equal(future.valid({ ...entry, cacheRevision: futureRevision }, ask, now), true);
});
test('comparison includes every active registered domain and rejects unknown stores', () => {
  const stores = require('../src/stores/registry.js');
  const domains = stores.STORES.filter(s => s.status !== 'planned').flatMap(s => s.domains);
  const all = Object.fromEntries([...domains, 'amazon.evil', 'unknown.example'].map(store => {
    const asin = '1234567890'; return [cache.key(store, asin), { ...entry, store, asin }];
  }));
  const listed = cache.listScores(all, { version: context.version, prefs: {} }, now);
  assert.deepEqual(listed.map(hit => hit.store).sort(), domains.sort());
});
test('listScores returns valid s: entries newest first and skips off: / stale', () => {
  const prefs = {};
  const a = { ...entry, asin: 'B000000001', t: now - 1000, name: 'Oats', verdict: 'Excellent', nova: 1 };
  const b = { ...entry, asin: 'B000000002', store: 'amazon.com', t: now - 100, name: 'Milk', verdict: 'Good', nova: 1 };
  const stale = { ...entry, asin: 'B000000003', t: now - cache.TTL_MS };
  const all = {
    [cache.key('www.amazon.com', 'B000000001')]: a,
    [cache.key('amazon.com', 'B000000002')]: { ...b, asin: 'B000000002' },
    [cache.key('www.amazon.com', 'B000000003')]: stale,
    'off:12345678': { score: 10, schema: cache.SCHEMA, v: context.version, store: 'amazon.com', asin: 'B000000099', prefs: cache.fingerprint({}), source: 'page', t: now },
    's:amazon.com:B000000004': { ...entry, store: 'amazon.co.uk', asin: 'B000000004', t: now },
  };
  const listed = cache.listScores(all, { version: context.version, prefs }, now);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].asin, 'B000000002');
  assert.equal(listed[1].asin, 'B000000001');
  assert.equal(cache.parseKey(cache.key('www.amazon.com', 'B000000001')).asin, 'B000000001');
  assert.equal(cache.parseKey('off:1'), null);
});
test('fingerprints track weights, food gate, provenance revisions; OCR/OFF only for those sources', () => {
  assert.equal(cache.fingerprint({}), cache.fingerprint({ weights: cats.DEFAULT_WEIGHTS }));
  // The endpoint is a build constant now; a leftover sheet URL in storage must not split the cache.
  assert.equal(cache.fingerprint({ sheetUrl: 'sheet', producersUrl: 'producer' }), cache.fingerprint({}));
  for (const prefs of [{ weights: { sugar: 2 } }, { foodOnly: false },
    { sheetIndexRev: 'a1b2-120' }, { producerIndexRev: 'c3d4-80' }]) {
    assert.notEqual(cache.fingerprint(prefs), cache.fingerprint({}), JSON.stringify(prefs));
  }
  // Toggling OCR / OFF must not retire DOM-extracted chips.
  assert.equal(cache.fingerprint({ ocrLabels: true }), cache.fingerprint({}));
  assert.equal(cache.fingerprint({ useOpenFoodFacts: true }), cache.fingerprint({}));
  assert.notEqual(
    cache.fingerprint({ ocrLabels: false }, 'label-ocr'),
    cache.fingerprint({}, 'label-ocr'));
  assert.notEqual(cache.fingerprint({ ocrLabels: false }, 'ocr'), cache.fingerprint({}, 'ocr'));
  assert.notEqual(
    cache.fingerprint({ useOpenFoodFacts: false }, 'open-food-facts'),
    cache.fingerprint({}, 'open-food-facts'));
  assert.equal(cache.fingerprint({ ocrLabels: false }, 'page'), cache.fingerprint({}, 'page'));
  assert.equal(cache.fingerprint({ ocrLabels: true }, 'ocr'), cache.fingerprint({}, 'ocr'));
  assert.equal(cache.fingerprint({ useOpenFoodFacts: true }, 'open-food-facts'), cache.fingerprint({}, 'open-food-facts'));
});

test('storedKeys lists keys without reading values when Chrome can, and falls back when it cannot', async () => {
  let fullReads = 0;
  const data = { 's:amazon.com:B000000001': { score: 1 }, 'p:amazon.com:B000000001': { data: 'x'.repeat(6000) }, weights: {} };
  const modern = { getKeys: async () => Object.keys(data), get: async () => { fullReads++; return data; } };
  assert.deepEqual((await cache.storedKeys(modern)).sort(), Object.keys(data).sort());
  assert.equal(fullReads, 0, 'getKeys, not get(null)');
  const older = { get: async keys => { assert.equal(keys, null); fullReads++; return data; } };
  assert.deepEqual((await cache.storedKeys(older)).sort(), Object.keys(data).sort());
  assert.equal(fullReads, 1);
  assert.deepEqual(Object.keys(data).filter(cache.isCacheKey).sort(), ['p:amazon.com:B000000001', 's:amazon.com:B000000001']);
});

test('listScores follows the speed setting age it is given', () => {
  const speed = require('../src/engine/db/speed.js');
  const DAY = 24 * 60 * 60 * 1000;
  const old = { ...entry, asin: 'B000000005', t: now - 45 * DAY };
  const all = { [cache.key('amazon.com', 'B000000005')]: old };
  assert.equal(cache.listScores(all, { version: context.version, prefs: {} }, now).length, 0, 'Balanced: past 30 days');
  assert.equal(cache.listScores(all, { version: context.version, prefs: {}, maxAgeMs: speed.profile('fastest').maxAgeMs }, now).length, 1,
    'Fastest keeps 90 days, and the popup lists it');
});

test('listScores includes Amazon and all retailer previews', () => {
  const target = { ...entry, store: 'target.com', asin: '1234567890', prefs: cache.fingerprint({}), t: now };
  const all = {
    [cache.key('amazon.com', 'B000000001')]: entry,
    [cache.key('target.com', '1234567890')]: target,
    [cache.key('target.com', '16600402')]: { ...target, asin: '16600402' },
    [cache.key('walmart.com', '10314926')]: { ...target, store: 'walmart.com', asin: '10314926' },
    [cache.key('costco.com', '100423971')]: { ...target, store: 'costco.com', asin: '100423971' },
  };
  const listed = cache.listScores(all, { version: context.version, prefs: {} }, now);
  assert.deepEqual(listed.map(x => x.asin).sort(), ['100423971', '10314926', '1234567890', '16600402', 'B000000001']);
});


test('recall only relaxes age within the chosen grace; fresh hits never refresh', () => {
  const day = 86400000, old = { ...entry, t: now - 31 * day };
  assert.deepEqual(cache.recall(entry, context, now), { hit: entry, stale: false, refresh: false });
  assert.deepEqual(cache.recall(old, context, now), { hit: old, stale: true, refresh: true });
  assert.equal(cache.recall(old, { ...context, prefs: { cacheGraceDays: 0 } }, now), null);
  assert.equal(cache.recall(old, { ...context, prefs: { cacheBackgroundRefresh: false } }, now).refresh, false);
  assert.equal(cache.recall(entry, { ...context, prefs: { cacheFirst: false } }, now), null);
  assert.equal(cache.recall({ ...old, t: now - 38 * day }, context, now), null);
  for (const patch of [{ v: 'old' }, { asin: 'B000000002' }, { prefs: 'different' }, { source: 'manual-paste' }]) {
    assert.equal(cache.recall({ ...old, ...patch }, context, now), null);
  }
});

test('bounded memory reader reuses batches, respects opt-out and invalidates writes/deletes', async () => {
  let calls = 0, notify; const values = { 's:amazon.com:B000000001': entry };
  const read = cache.createReader({ get(keys, cb) { calls++; cb(Object.fromEntries(keys.filter(k => values[k]).map(k => [k, values[k]]))); } },
    { addListener(fn) { notify = fn; } });
  const keys = Object.keys(values);
  assert.equal((await read(keys))[keys[0]].score, 90);
  await read(keys); assert.equal(calls, 1);
  values[keys[0]] = { ...entry, score: 50 }; notify({ [keys[0]]: { newValue: values[keys[0]] } }, 'local');
  assert.equal((await read(keys))[keys[0]].score, 50); assert.equal(calls, 2);
  delete values[keys[0]]; notify({ [keys[0]]: {} }, 'local');
  assert.deepEqual(await read(keys), {});
  values[keys[0]] = entry;
  await read(keys, { cacheMemory: false }); await read(keys, { cacheMemory: false }); assert.equal(calls, 5);
  for (let i = 0; i < 257; i++) values[`s:test:${i}`] = entry;
  await read(Object.keys(values));
  await read(['s:test:0']); assert.equal(calls, 7, 'oldest entry is evicted');
});

test('an invalidation during disk read does not repopulate memory with an old reading', async () => {
  let notify, finish, calls = 0;
  const key = 's:amazon.com:B000000001';
  const read = cache.createReader({ get(keys, cb) { calls++; finish = cb; } }, { addListener(fn) { notify = fn; } });
  const first = read([key]); notify({ [key]: {} }, 'local'); finish({ [key]: entry }); await first;
  const second = read([key]); assert.equal(calls, 2); finish({}); await second;
});

// A saved score is retired when something it was computed from changes. A food score is computed from
// the food weights and the provenance indexes; a personal-care or supplement index from the rating
// style, the switch and (for the preference-focused style) the avoid list. Changing one of those used
// to retire every saved score of both kinds, so choosing a different shampoo style sent the cart,
// the search page and the popup back to the network for every food they had already rated.
test('a saved food score and a saved personal-care index are retired only by their own settings', () => {
  const food = raw => cache.fingerprint(raw, 'page');
  const care = raw => cache.fingerprint(raw, 'page', 'shampoo');
  for (const patch of [{ ratingStyle: 'minimal' }, { personalCareEnabled: false }, { ratingStyle: 'preferences', avoidList: ['fragrance'] }]) {
    assert.equal(food(patch), food({}), `food ignores ${JSON.stringify(patch)}`);
    assert.notEqual(care(patch), care({}), `care reads ${JSON.stringify(patch)}`);
  }
  assert.notEqual(food({ weights: { sugar: 2 } }), food({}));
  assert.notEqual(food({ foodOnly: false }), food({}));
  assert.notEqual(food({ sheetIndexRev: 'x' }), food({}));
  for (const patch of [{ weights: { sugar: 2 } }, { foodOnly: false }, { sheetIndexRev: 'x' }, { producerIndexRev: 'y' }]) {
    assert.equal(care(patch), care({}), `care ignores ${JSON.stringify(patch)}`);
  }
  // The avoid list is part of the preference-focused index only.
  assert.equal(care({ avoidList: ['fragrance'] }), care({}));
  assert.notEqual(care({ ratingStyle: 'preferences', avoidList: ['fragrance'] }), care({ ratingStyle: 'preferences', avoidList: ['sulfate'] }));
  assert.equal(cache.fingerprint({}, 'page', 'food'), food({}));
});

test('a saved entry is checked against the fingerprint of its own kind', () => {
  const care = { ...entry, category: 'shampoo', ratingStyle: 'evidence', prefs: cache.fingerprint({}, 'page', 'shampoo') };
  assert.equal(cache.valid(care, context, now), true);
  assert.equal(cache.valid(care, { ...context, prefs: { ratingStyle: 'minimal' } }, now), false, 'a new style retires the index');
  assert.equal(cache.valid(care, { ...context, prefs: { weights: { sugar: 2 } } }, now), true, 'a food weight does not');
  assert.equal(cache.valid(entry, { ...context, prefs: { ratingStyle: 'minimal', personalCareEnabled: false } }, now), true, 'a care setting does not retire a food score');
  assert.equal(cache.valid(entry, { ...context, prefs: { weights: { sugar: 2 } } }, now), false);
});

test('a saved personal-care index is not a food rating', () => {
  assert.equal(cache.isFood(entry), true, 'entries written before categories existed');
  assert.equal(cache.isFood({ ...entry, category: 'food' }), true);
  assert.equal(cache.isFood({ ...entry, category: 'shampoo' }), false);
  assert.equal(cache.isFood({ ...entry, category: 'supplement' }), false);
});
