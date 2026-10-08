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
