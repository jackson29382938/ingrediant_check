// Regression tests for the 2026-11-20 audit fixes and new analytics/ranking helpers.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const analytics = require('../src/engine/db/purchase-analytics.js');
const sorted = require('../src/engine/db/sorted-results.js');
const { receiver } = require('./receiver-harness.js');

test('score.js: qualified hyphenated ingredients are penalized after qualifier stripping', () => {
  const plain = engine.score({ ingredients_text: 'Oats, soya-lecithin, salt' });
  const qualified = engine.score({ ingredients_text: 'Oats, organic soya-lecithin, salt' });
  const clean = engine.score({ ingredients_text: 'Oats, salt' });
  assert.ok(plain.score < clean.score, 'baseline hyphenated lecithin penalized');
  assert.ok(qualified.bad.some(r => /lecithin/i.test(r.why)), 'organic soya-lecithin must still match lecithin rule');
});

test('score.js: HTML-encoded tags do not hide ingredients', () => {
  const plain = engine.score({ ingredients_text: 'Oats, Sugar, Salt' });
  const encoded = engine.score({ ingredients_text: 'Oats, &lt;b&gt;Sugar&lt;/b&gt;, Salt' });
  assert.equal(encoded.score, plain.score);
  assert.ok(encoded.bad.some(r => /sugar/i.test(r.why)));
});

test('score.js: two-digit footnotes 10-19 are stripped when they hide a charge, while Vitamin B12 and Red 40 stay intact', () => {
  const plain = engine.score({ ingredients_text: 'Oats, cane sugar, salt' });
  const footnoted = engine.score({ ingredients_text: 'Oats, cane sugar 12, salt' });
  assert.equal(footnoted.score, plain.score);
  const dye = engine.score({ ingredients_text: 'Water, Red 40, salt' });
  assert.ok(dye.cap && /red 40|colour/i.test(dye.cap));
});

test('score.js: normaliseNutrition scales macro rounding tolerance for small servings', () => {
  // 10g serving of nuts with legal FDA +/-0.5g rounding per macro (5.4g fat + 3.4g carbs + 2.4g protein = 11.2g)
  const norm = engine.normaliseNutrition({ servingGrams: 10, fat: 5.4, carbs: 3.4, protein: 2.4 });
  assert.equal(norm.basis, 'per 100g');
  assert.ok(norm.values.protein > 20);
  // Wildly impossible values (e.g. 200g fat per 100g) still fail
  const impossible = engine.normaliseNutrition({ servingGrams: 10, fat: 15, carbs: 5, protein: 5 });
  assert.equal(impossible.basis, 'invalid');
});

test('worker/messages.js: isOwnExtension fails closed without sender.id and rejects subframes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'worker', 'messages.js'), 'utf8');
  const ctx = vm.createContext({ chrome: { runtime: { id: 'ext-1', getURL: p => `chrome-extension://ext-1/${p}` } }, URL });
  vm.runInContext(src, ctx);
  assert.equal(ctx.isOwnExtension({ tab: { url: 'https://www.amazon.com/dp/B00LOAW7U6' } }), false, 'missing sender.id must be rejected');
  assert.equal(ctx.isOwnExtension({ id: 'ext-1' }), true);
  assert.equal(ctx.isAmazonTabSender({ id: 'ext-1', frameId: 0, tab: { url: 'https://www.amazon.com/dp/B00LOAW7U6' } }), true);
  assert.equal(ctx.isAmazonTabSender({ id: 'ext-1', frameId: 1, tab: { url: 'https://www.amazon.com/dp/B00LOAW7U6' } }), false, 'subframe must be rejected');
  assert.equal(ctx.isRetailerTabSender({ id: 'ext-1', frameId: 2, tab: { url: 'https://www.walmart.com/ip/12345' } }), false, 'retailer subframe must be rejected');
});

test('apps-script.gs: USDA handles malformed JSON, shorter miss TTL, and skips >95KB cache writes', () => {
  const KEY = 'TESTKEY0123456789abcdefghijklmnopqrstuv';
  const badJson = receiver({ usdaKey: KEY, usdaFetch: () => ({ status: 200, text: '{not-json' }) });
  assert.deepEqual(badJson.post({ kind: 'usda', code: '028400064057' }), { ok: false, error: 'upstream invalid json' });

  const miss = receiver({ usdaKey: KEY, usdaFetch: () => ({ status: 200, text: JSON.stringify({ foods: [] }) }) });
  assert.deepEqual(miss.post({ kind: 'usda', code: '028400064057' }), { ok: true, foods: [] });
  assert.equal(miss.cache.get('usda2:28400064057').seconds, 1800, 'empty USDA miss cached 30 min, not 6 hours');

  const hugeFoods = Array.from({ length: 20 }, () => ({ gtinUpc: '028400064057', ingredients: 'A'.repeat(6000) }));
  const huge = receiver({ usdaKey: KEY, usdaFetch: () => ({ status: 200, text: JSON.stringify({ foods: hugeFoods }) }) });
  const reply = huge.post({ kind: 'usda', code: '028400064057' });
  assert.equal(reply.ok, true);
  assert.equal(huge.cache.has('usda2:28400064057'), false, 'oversized payload skips CacheService.put instead of crashing');
});

test('apps-script.gs: writeHistory batches inserts and writeRows preserves leading apostrophes', () => {
  const token = 'valid-token-12345678901234567890';
  const r = receiver({ tokens: { [token]: { aud: 'client-1', sub: 'user-1', expires_in: 3600 } } });
  const mkRec = i => ({
    key: String(i).padStart(64, 'a'),
    store: 'amazon.com',
    asin: 'B00000000' + i,
    date: '2026-10-0' + i,
    state: 'purchased',
    name: 'Item ' + i,
    score: 80,
    ingredients: 'Oats, salt',
    observedAt: Date.now() - 1000,
    scoredAt: Date.now() - 1000,
  });
  const res = r.post({ kind: 'historyPut', token, payload: { epoch: 0, records: [mkRec(1), mkRec(2), mkRec(3)] } });
  assert.equal(res.ok, true);
  assert.equal(res.count, 3);
  assert.equal(r.tabs.get('purchase-history').data.length, 4, 'header + 3 batched rows');

  const rep = r.post({ kind: 'report', product_name: "'Natural' Oats", asin: 'B00LOAW7U6' });
  assert.equal(rep.ok, true);
  const stored = r.tabs.get('reports').data[1];
  const nameIdx = r.tabs.get('reports').data[0].indexOf('product_name');
  assert.equal(r.context.unquote(stored[nameIdx]), "'Natural' Oats", 'leading apostrophe survives round-trip');
});

test('purchaseAnalytics.detectReformulations flags changed ingredients across repeat purchases', () => {
  const records = [
    { key: '1'.repeat(64), store: 'amazon.com', asin: 'B001111111', date: '2026-08-01', state: 'purchased', name: 'Granola', score: 85, ingredients: 'Oats, honey, olive oil' },
    { key: '2'.repeat(64), store: 'amazon.com', asin: 'B001111111', date: '2026-10-15', state: 'purchased', name: 'Granola', score: 52, ingredients: 'Oats, sugar, palm oil' },
    { key: '3'.repeat(64), store: 'amazon.com', asin: 'B002222222', date: '2026-08-01', state: 'purchased', name: 'Milk', score: 92, ingredients: 'Organic whole milk' },
    { key: '4'.repeat(64), store: 'amazon.com', asin: 'B002222222', date: '2026-10-15', state: 'purchased', name: 'Milk', score: 92, ingredients: '  organic   whole milk ' },
  ];
  const withSetup = records.map(record => ({ ...record, version: '1.27.0', profile: 'profile', rulesRevision: 'same' }));
  const changes = analytics.detectReformulations(withSetup);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].asin, 'B001111111');
  assert.equal(changes[0].delta, -33);
  assert.equal(changes[0].scoreDropped, true);
  assert.equal(analytics.detectReformulations(records)[0].delta, null, 'legacy scores have unknown comparability');
  assert.equal(analytics.detectReformulations([withSetup[0], { ...withSetup[1], rulesRevision: 'changed' }])[0].delta, null);
  assert.deepEqual(analytics.detectReformulations([withSetup[0], { ...withSetup[1], source: 'label-ai' }]), []);
  assert.deepEqual(analytics.detectReformulations([withSetup[0], { ...withSetup[1], date: withSetup[0].date }]), []);
  assert.deepEqual(analytics.detectReformulations([withSetup[0], { ...withSetup[1], ingredients: 'Ingredients: Oats , Honey, Olive Oil.' }]), []);
});

test('sortedResults.paretoFront returns only non-dominated score-vs-unit-price picks', () => {
  assert.ok(sorted.PRESETS.valueClean);
  const items = [
    { asin: 'A', score: 95, unitPrice: 1.00 }, // Pareto optimal (highest score)
    { asin: 'B', score: 85, unitPrice: 0.50 }, // Pareto optimal (good balance)
    { asin: 'C', score: 80, unitPrice: 0.70 }, // Dominated by B (worse score AND higher price)
    { asin: 'D', score: 60, unitPrice: 0.30 }, // Pareto optimal (cheapest)
    { asin: 'E', score: null, unitPrice: 0.20 }, // Unscored, excluded
  ];
  const front = sorted.paretoFront(items).map(p => p.asin);
  assert.deepEqual(front, ['A', 'B', 'D']);
});

test('shopping.cleanerSwaps finds higher-scoring same-category swaps sorted by score then unit price', () => {
  require('../src/engine/db/unit-price.js');
  const shopping = require('../src/engine/db/shopping.js');
  const target = { asin: 'LOW', title: 'Sugary Cereal', score: 40, unitPrice: 0.30, unitKind: 'weight', category: 'food' };
  const candidates = [
    target,
    { asin: 'HIGHA', title: 'Clean Oats Expensive', score: 88, unitPrice: 0.60, unitKind: 'weight', category: 'food' },
    { asin: 'HIGHB', title: 'Clean Oats Value', score: 88, unitPrice: 0.35, unitKind: 'weight', category: 'food' },
    { asin: 'FLUID', title: 'Oat Drink', score: 88, unitPrice: 0.05, unitKind: 'fluid', category: 'food' },
    { asin: 'CARE', title: 'Shampoo', score: 95, unitPrice: 0.20, category: 'shampoo' },
    { asin: 'CLOSE', title: 'Slightly Better', score: 45, unitPrice: 0.25, category: 'food' },
  ];
  const swaps = shopping.cleanerSwaps(target, candidates, { minGain: 15, family: 'weight' });
  assert.equal(swaps.length, 3);
  assert.equal(swaps[0].product.asin, 'HIGHB');
  assert.equal(swaps[0].scoreDelta, 48);
  assert.equal(swaps[0].unitPriceDelta, 0.05);
  assert.equal(swaps[1].product.asin, 'HIGHA');
  assert.equal(swaps[2].product.asin, 'FLUID');
  assert.equal(swaps[2].unitPriceDelta, null);
});

test('best-value badges require a comparable score and unit-price peer', () => {
  const sorted = require('../src/engine/db/sorted-results.js');
  const items = [
    { asin: 'FOOD1', score: 85, unitPrice: 0.25, unitKind: 'weight' },
    { asin: 'FOOD2', score: 65, unitPrice: 0.35, unitKind: 'weight' },
    { asin: 'FLUID', score: 95, unitPrice: 0.05, unitKind: 'fluid' },
    { asin: 'CARE1', score: 99, unitPrice: 0.10, unitKind: 'weight', category: 'shampoo', ratingStyle: 'evidence' },
    { asin: 'CARE2', score: 78, unitPrice: 0.16, unitKind: 'weight', category: 'shampoo', ratingStyle: 'minimal' },
  ];
  assert.deepEqual(sorted.paretoFront(items).map(p => p.asin), ['FOOD1']);
  assert.deepEqual(sorted.paretoFront([items[0], items[2]], { family: 'weight' }), []);
});
