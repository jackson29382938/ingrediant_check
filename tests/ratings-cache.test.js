const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/engine/db/ratings-cache.js');

const NOW = Date.parse('2026-09-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const row = over => ({ scanned_at: new Date(NOW - DAY).toISOString(), pulls: 0, ...over });
const entry = over => ({ schema: 3, v: '1.0.0', t: NOW - DAY, store: 'www.amazon.com', asin: 'B00TESTOAT',
  prefs: '{"rules":"r1"}', score: 82.4, verdict: 'Good', nova: 1, source: 'nic-ingredients-content',
  provenanceSource: '', name: '  Organic   Oats ', text: 'oats, salt', notes: 'mine', ...over });

test('stale by age: fresh under 14 days, stale at 14 days', () => {
  assert.equal(R.stale(row({ scanned_at: new Date(NOW - 13 * DAY).toISOString() }), NOW), false);
  assert.equal(R.stale(row({ scanned_at: new Date(NOW - 14 * DAY).toISOString() }), NOW), true);
  assert.equal(R.stale(row({ scanned_at: 'not a date' }), NOW), true);
});

test('stale by pulls: 99 is fresh, 100 is stale, whichever comes first', () => {
  assert.equal(R.stale(row({ pulls: 99 }), NOW), false);
  assert.equal(R.stale(row({ pulls: 100 }), NOW), true);
  assert.equal(R.stale(row({ pulls: '100' }), NOW), true);
});

test('sanitize keeps only the shared columns and rejects private or malformed rows', () => {
  const r = R.fromEntry(entry(), NOW);
  assert.deepEqual(Object.keys(r), R.COLUMNS);
  assert.equal(r.store, 'amazon.com');
  assert.equal(r.score, 82);
  assert.equal(r.name, 'Organic Oats');
  assert.equal(r.prefs, R.prefsHash('1.0.0', '{"rules":"r1"}'));
  assert.equal(r.key, `amazon.com:B00TESTOAT:${r.prefs}`);
  assert.equal(r.scanned_at, new Date(NOW - DAY).toISOString());
  assert.equal(R.fromEntry(entry({ source: 'manual-paste' }), NOW), null);
  assert.equal(R.fromEntry(entry({ asin: 'nope' }), NOW), null);
  assert.equal(R.fromEntry(entry({ score: 101 }), NOW), null);
  assert.equal(R.fromEntry(entry({ t: NOW + DAY }), NOW), null);
  assert.equal(R.sanitize({ ...r, name: "'=HYPERLINK(1)", verdict: '=1' }, NOW).verdict, '');
  assert.notEqual(R.prefsHash('1.0.1', '{"rules":"r1"}'), r.prefs);
});

test('indexRows drops stale rows and round-trips through toEntry', () => {
  const r = R.fromEntry(entry(), NOW);
  const old = { ...r, key: 'x', scanned_at: new Date(NOW - 20 * DAY).toISOString() };
  const csv = [R.COLUMNS, R.COLUMNS.map(c => String(r[c])), R.COLUMNS.map(c => String(old[c]))];
  const index = R.indexRows(csv, NOW);
  assert.equal(index['amazon.com:B00TESTOAT'].length, 1);
  const back = R.toEntry(index['amazon.com:B00TESTOAT'][0], '{"rules":"r1"}', { schema: 3, version: '1.0.0' });
  assert.equal(back.t, NOW - DAY);
  assert.equal(back.score, 82);
});

test('mergeQueue: newest scan wins per key, pulls add up only for the same scan', () => {
  let q = R.mergeQueue(null, { upserts: [entry()] }, NOW);
  q = R.mergeQueue(q, { upserts: [entry({ t: NOW - 2 * DAY, score: 10 })] }, NOW);
  const [key] = Object.keys(q.upserts);
  assert.equal(q.upserts[key].score, 82);
  const at = q.upserts[key].scanned_at;
  q = R.mergeQueue(q, { pulls: [{ key, scanned_at: at }, { key: 'bad', scanned_at: at }] }, NOW);
  q = R.mergeQueue(q, { pulls: [{ key, scanned_at: at }] }, NOW);
  assert.deepEqual(q.pulls, { [key]: { scanned_at: at, n: 2 } });
  assert.equal(R.queueSize(q), 2);
});
