'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/engine/db/order-overview.js');
const row = (date, score, state = 'purchased') => ({ date, score, state });
test('compact overview omits empty periods and ignores missing, future and excluded ratings', () => {
  const now = new Date(2026, 9, 30, 12);
  assert.deepEqual(summarize([], now), { averages: [], points: [] });
  const out = summarize([row('2026-09-01', 80), row('2026-10-30', null), row('2026-10-30', 0, 'returned'), row('2026-11-01', 100), row('2026-02-31', 90)], now);
  assert.deepEqual(out.averages, []);
  assert.deepEqual(out.points, [{ date: '2026-09-01', score: 80 }]);
});
test('daily, Monday-based weekly and calendar-month averages use eligible product entries', () => {
  const out = summarize([row('2026-10-30', 60), row('2026-10-30', 100), row('2026-10-26', 20), row('2026-10-25', 100), row('2026-09-30', 0)], new Date(2026, 9, 30, 23));
  assert.deepEqual(out.averages, [{ period: 'day', count: 2, score: 80 }, { period: 'week', count: 3, score: 60 }, { period: 'month', count: 4, score: 70 }]);
  assert.equal(out.points.at(-1).score, 80);
});
test('a period without purchases is omitted independently, including week/month boundaries', () => {
  const out = summarize([row('2026-10-30', 90)], new Date(2026, 10, 1, 12));
  assert.deepEqual(out.averages, [{ period: 'week', count: 1, score: 90 }]);
  const many = Array.from({ length: 31 }, (_, i) => row(`2026-10-${String(i + 1).padStart(2, '0')}`, i));
  assert.equal(summarize(many, new Date(2026, 10, 1)).points.length, 30);
});
