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
const entry = { schema: cache.SCHEMA, t: now, v: context.version, store: context.store,
  asin: context.asin, prefs: cache.fingerprint({}), source: 'page', ingredients: 'Oats', score: 90 };
test('cache rejects expired, mismatched, incomplete, and manual records', () => {
  assert.equal(cache.valid(entry, context, now), true);
  for (const patch of [{ t: now - cache.TTL_MS }, { t: now + 1 }, { schema: 1 },
    { v: '1.0.0' }, { store: 'www.amazon.co.uk' }, { asin: 'B000000002' },
    { prefs: cache.fingerprint({ weights: { sugar: 2 } }) }, { source: '' },
    { ingredients: '' }, { score: NaN }, { source: 'manual-paste' }, { source: 'food-override' }]) {
    assert.equal(cache.valid({ ...entry, ...patch }, context, now), false, JSON.stringify(patch));
  }
  assert.equal(cache.valid({ ...entry, source: 'manual-paste' }, { ...context, allowManual: true }, now), true);
  assert.notEqual(cache.key(context.store, context.asin), cache.key('www.amazon.co.uk', context.asin));
});
test('fingerprints track effective weights, fallbacks, food gate and provenance revisions', () => {
  assert.equal(cache.fingerprint({}), cache.fingerprint({ weights: cats.DEFAULT_WEIGHTS }));
  for (const prefs of [{ weights: { sugar: 2 } }, { foodOnly: false }, { ocrLabels: true },
    { useOpenFoodFacts: true }, { sheetUrl: 'sheet' }, { producersUrl: 'producer' },
    { sheetIndex: { t: 10 } }, { producerIndex: { t: 10 } }]) {
    assert.notEqual(cache.fingerprint(prefs), cache.fingerprint({}));
  }
});
