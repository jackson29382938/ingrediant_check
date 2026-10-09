const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/engine/db/purchase-analytics.js'), H = require('../src/engine/db/purchase-history.js');
const r = (id, order = 'a', more = {}) => H.clean({ key: id.toString(16).padStart(64, '0'), orderKey: order?.repeat(64), store: 'amazon.com', asin: 'B000000001', date: '2026-09-01', state: 'purchased', name: 'Oats', score: 50, version: '1.13.0', profile: 'f'.repeat(64), ingredients: 'oats', flags: [], scoredAt: 1000, observedAt: 1000, ...more });
const rows = records => records.map(record => A.project(record, 'recorded'));
test('multiple product entries sum within distinct orders without treating entries as quantities', () => {
  const s = A.stats(rows([r(1, 'a', { score: 10 }), r(2, 'a', { score: 30 }), r(3, 'b', { score: 80 }), r(4, null)]));
  assert.equal(s.items, 4); assert.equal(s.orders, 2); assert.equal(s.ungrouped, 1); assert.equal(s.mean, 42.5);
  assert.equal(A.stats(rows([r(1, 'a', { score: 10 }), r(2, 'a', { score: 30 }), r(3, 'b', { score: 80 })]), 'order').mean, 50);
});
test('snapshots preserve original full inputs and order grouping through older backend replies', () => {
  const first = r(1, 'a', { input: { ingredients_text: 'oats', nutrition: { protein: 5 }, address: 'PRIVATE' } });
  const later = r(1, null, { score: 90, scoredAt: 2000, observedAt: 2000, input: { ingredients_text: 'sugar' } });
  const merged = H.merge([first], [later])[0]; assert.equal(merged.score, 50); assert.equal(merged.input.nutrition.protein, 5); assert.equal(merged.orderKey, 'a'.repeat(64)); assert.ok(!('address' in merged.input));
  assert.throws(() => H.merge([first], [r(1, 'b')]), /invalid-history-identity/);
});
test('current-goal comparison is separate, coverage gated, and cannot change snapshots', () => {
  const record = r(1), original = JSON.stringify(record);
  const compared = A.project(record, 'current', () => ({ parsed: 1, coverage: 1, score: 70 }));
  assert.equal(compared.score, 70); assert.equal(compared.recorded, 50); assert.equal(compared.delta, 20); assert.equal(compared.partial, true); assert.equal(JSON.stringify(record), original);
  assert.equal(A.project(record, 'current', () => ({ parsed: 1, coverage: 0.1, score: 90 })).score, null);
  assert.equal(A.project(r(2, 'a', { ingredients: '' }), 'current', () => { throw Error('should not score'); }).score, null);
});
test('filters and score sorts keep missing ratings missing and support status/date/text bounds', () => {
  const input = rows([r(1, 'a', { score: null }), r(2, 'b', { score: 80 }), r(3, 'c', { score: 20, state: 'returned' })]);
  assert.deepEqual(A.filter(input, { sort: 'lowest' }).map(r => r.score), [20, 80, null]);
  assert.equal(A.filter(input, { status: 'purchased', min: 50, search: 'oat' }).length, 1);
  assert.equal(A.filter(input, { rating: 'missing' }).length, 1); assert.equal(A.filter(input, { from: '2026-10-01' }).length, 0);
  assert.equal(A.stats(input).items, 2); assert.equal(A.stats(input).mean, 80);
});
test('median and IQR use interpolation; confidence requires enough complete order clusters', () => {
  const s = A.stats(rows([r(1, 'a', { score: 10 }), r(2, 'a', { score: 30 }), r(3, 'b', { score: 80 })]));
  assert.equal(s.median, 30); assert.equal(s.q1, 20); assert.equal(s.q3, 55); assert.ok(s.ci[0] <= s.mean && s.ci[1] >= s.mean);
  assert.equal(A.stats(rows([r(1), r(2)])).ci, null);
  assert.equal(A.stats(rows([r(1), r(2, null)])).ci, null);
  assert.equal(A.stats([]).mean, null); assert.equal(A.stats(rows([r(1, 'a', { score: null })])).mean, null);
});
test('periods keep original scoring setups separate but combine current comparisons', () => {
  const records = [r(1), r(2, 'b', { version: 'older' }), r(3, 'c', { date: '2025-09-01' })];
  assert.equal(A.periods(rows(records)).length, 3);
  assert.equal(A.periods(records.map(r => A.project(r, 'current', () => ({ parsed: 1, coverage: 1, score: 80 }))), { mode: 'current' }).length, 2);
});
test('score drivers net opposing contributions, count entries/orders once and exclude returns', () => {
  const breakdown = { base: 50, rows: [{ why: 'Protein', c: 10, kind: 'factor' }, { why: 'Protein', c: -5, kind: 'factor' }, { why: 'Sugar', c: -10, kind: 'factor' }, { why: 'Seed oil — cap of 25', c: -20, kind: 'limit' }] };
  const records = [r(1, 'a', { score: 25, breakdown }), r(2, 'a', { score: 25, breakdown }), r(3, 'b', { score: 25, breakdown, state: 'returned' }), r(4, 'b')];
  const result = A.drivers(rows(records), 'recorded');
  assert.equal(result.eligible, 3); assert.equal(result.covered, 2); assert.equal(result.base, 100);
  assert.equal(result.positives[0].net, 10); assert.equal(result.positives[0].positive, 20); assert.equal(result.positives[0].negative, -10);
  assert.equal(result.positives[0].items, 2); assert.equal(result.positives[0].orders, 1);
  assert.equal(result.negatives[0].net, -40); assert.equal(result.negatives[0].why, 'Score limit: Seed oil');
});
test('breakdown snapshots require exact arithmetic and retain their original recording', () => {
  const breakdown = { base: 50, rows: [{ why: 'Oats', c: 10, kind: 'factor' }] };
  assert.equal(H.cleanBreakdown(breakdown, 50), null);
  const first = r(1, 'a', { score: 60, breakdown });
  assert.deepEqual(first.breakdown, breakdown);
  const later = r(1, 'a', { score: 70, breakdown: { base: 60, rows: breakdown.rows }, observedAt: 2000, scoredAt: 2000 });
  assert.deepEqual(H.merge([first], [later])[0].breakdown, breakdown);
  assert.equal(H.fromResult({ score: 60, base: 50, good: [{ c: 10, why: 'Oats' }], bad: [{ c: 'CAP', why: 'No extra deduction' }] }).rows.length, 1);
});
test('current score drivers gate missing/low coverage labels without changing recorded data', () => {
  const records = [r(1), r(2, 'b', { ingredients: '' })], original = JSON.stringify(records);
  const result = A.drivers(rows(records), 'current', () => ({ parsed: 1, coverage: 1 }), () => ({ base: 50, rows: [{ c: -5, why: 'Sugar', kind: 'factor' }] }));
  assert.equal(result.covered, 1); assert.equal(result.negatives[0].net, -5); assert.equal(JSON.stringify(records), original);
  assert.equal(A.drivers(rows(records), 'current', () => ({ parsed: 1, coverage: 0.1 }), () => { throw Error('invalid coverage'); }).covered, 0);
});
test('real engine snapshots reconcile every corpus score including limits and floors', () => {
  const engine = require('../src/engine/score.js'), cats = require('../src/engine/categories.js'), corpus = require('./corpus.json');
  for (const entry of [...corpus.products, ...corpus.defects]) for (const weights of [{}, ...Object.values(cats.PRESETS).map(p => p.weights)]) {
    const scored = engine.score(entry.product, { weights });
    const breakdown = H.fromResult(scored);
    assert.ok(breakdown, entry.id + ': exact point snapshot');
    assert.equal(breakdown.base + breakdown.rows.reduce((sum, row) => sum + row.c, 0), scored.score);
  }
});
