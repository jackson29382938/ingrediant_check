// Optional points for good items in a cart (src/engine/db/points.js, prefs pointsEnabled, off by default).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const points = require('../src/engine/db/points.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 7, 12);
const item = (key, score) => ({ key, score });

test('only good ratings earn points: 20 at 90 or more, 10 at 75 or more, nothing below', () => {
  assert.equal(points.worth(100), 20);
  assert.equal(points.worth(90), 20);
  assert.equal(points.worth(89), 10);
  assert.equal(points.worth(75), 10);
  assert.equal(points.worth(74), 0);
  assert.equal(points.worth(0), 0);
  for (const bad of [NaN, Infinity, -5, undefined, null, '96', {}]) assert.equal(points.worth(bad), 0, String(bad));
});

test('a cart earns for each good line once; reopening it the same day earns nothing', () => {
  const cart = [item('amazon.com:B0AAAAAAA1', 96), item('amazon.com:B0AAAAAAA2', 80), item('amazon.com:B0AAAAAAA3', 40)];
  const first = points.earn(undefined, cart, NOW);
  assert.equal(first.gained, 30);
  assert.deepEqual(first.earned.map(e => [e.key, e.xp]), [['amazon.com:B0AAAAAAA1', 20], ['amazon.com:B0AAAAAAA2', 10]]);
  assert.equal(first.xp.total, 30);
  const again = points.earn(first.xp, cart, NOW + 60 * 1000);
  assert.equal(again.gained, 0);
  assert.equal(again.xp.total, 30, 'the total is unchanged');
  assert.deepEqual(again.earned, []);
});

test('the same product earns again after a week, not before', () => {
  const key = 'amazon.com:B0AAAAAAA1';
  const first = points.earn(undefined, [item(key, 96)], NOW);
  assert.equal(points.earn(first.xp, [item(key, 96)], NOW + 6 * DAY).gained, 0);
  const later = points.earn(first.xp, [item(key, 96)], NOW + 7 * DAY);
  assert.equal(later.gained, 20);
  assert.equal(later.xp.total, 40);
});

test('a product listed twice in one cart earns once, and the same id in two stores is two products', () => {
  const twice = points.earn(undefined, [item('amazon.com:B0AAAAAAA1', 96), item('amazon.com:B0AAAAAAA1', 96)], NOW);
  assert.equal(twice.gained, 20);
  const two = points.earn(undefined, [item('amazon.com:123456', 96), item('target.com:123456', 96)], NOW);
  assert.equal(two.gained, 40);
});

test('a line with no key, or a score that is not a number, earns nothing and breaks nothing', () => {
  const r = points.earn(undefined, [item('', 96), item(undefined, 96), item('amazon.com:B0AAAAAAA1', NaN), null, undefined, {}], NOW);
  assert.equal(r.gained, 0);
  assert.deepEqual(r.xp, { total: 0, seen: {} });
});

test('what was seen is bounded: expired entries go first, then the oldest beyond the cap', () => {
  const seen = {};
  for (let i = 0; i < points.MAX_SEEN + 50; i++) seen[`amazon.com:P${i}`] = NOW - (i % 5) * 1000;
  seen['amazon.com:OLD'] = NOW - 8 * DAY;
  const r = points.earn({ total: 5, seen }, [item('amazon.com:NEW', 96)], NOW);
  assert.ok(Object.keys(r.xp.seen).length <= points.MAX_SEEN);
  assert.ok(!('amazon.com:OLD' in r.xp.seen), 'a week-old entry cannot block anything any more');
  assert.ok('amazon.com:NEW' in r.xp.seen, 'the newest entry is kept');
});

test('stored data is never trusted: junk becomes zero points and an empty history', () => {
  for (const junk of [null, undefined, 'xp', 7, [], { total: 'many', seen: 'x' }, { total: -50, seen: { a: 'b' } }, { total: NaN }, { total: Infinity, seen: [] }]) {
    const clean = points.sanitize(junk);
    assert.ok(Number.isFinite(clean.total) && clean.total >= 0, JSON.stringify(junk));
    assert.equal(typeof clean.seen, 'object');
    assert.ok(!Array.isArray(clean.seen));
  }
  assert.equal(points.sanitize({ total: 1e15 }).total, points.MAX_TOTAL, 'the total is capped');
  assert.deepEqual(points.sanitize({ total: 12.9, seen: { 'k:1': NOW, 'k:2': 'soon', 'k:3': -1, ['x'.repeat(200)]: NOW } }), { total: 12, seen: { 'k:1': NOW } });
});

test('a clock that moved back does not hand out points twice', () => {
  const key = 'amazon.com:B0AAAAAAA1';
  const first = points.earn(undefined, [item(key, 96)], NOW);
  assert.equal(points.earn(first.xp, [item(key, 96)], NOW - 3 * DAY).gained, 0);
});

test('levels: each one costs 100 times its number in points', () => {
  assert.deepEqual(points.level(0), { level: 1, into: 0, need: 100 });
  assert.deepEqual(points.level(99), { level: 1, into: 99, need: 100 });
  assert.deepEqual(points.level(100), { level: 2, into: 0, need: 200 });
  assert.deepEqual(points.level(299), { level: 2, into: 199, need: 200 });
  assert.deepEqual(points.level(300), { level: 3, into: 0, need: 300 });
  assert.deepEqual(points.level(600), { level: 4, into: 0, need: 400 });
  assert.deepEqual(points.level(-4), { level: 1, into: 0, need: 100 });
  assert.ok(points.level(points.MAX_TOTAL).level > 1000, 'a huge total still resolves');
});
