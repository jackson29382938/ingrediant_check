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
    cache.fingerprint({ ocrLabels: true }, 'label-ocr'),
    cache.fingerprint({}, 'label-ocr'));
  assert.notEqual(
    cache.fingerprint({ useOpenFoodFacts: true }, 'open-food-facts'),
    cache.fingerprint({}, 'open-food-facts'));
  assert.equal(cache.fingerprint({ ocrLabels: true }, 'page'), cache.fingerprint({}, 'page'));
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

test('listScores lists Amazon scores only, even when a Target id is ten digits long', () => {
  const target = { ...entry, store: 'target.com', asin: '1234567890', t: now };
  const all = {
    [cache.key('amazon.com', 'B000000001')]: entry,
    [cache.key('target.com', '1234567890')]: target,
    [cache.key('target.com', '16600402')]: { ...target, asin: '16600402' },
  };
  const listed = cache.listScores(all, { version: context.version, prefs: {} }, now);
  assert.deepEqual(listed.map(x => x.asin), ['B000000001']);
});
