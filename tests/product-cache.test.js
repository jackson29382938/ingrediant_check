const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/engine/db/product-cache.js');
const engine = require('../src/engine/score.js');
const corpus = require('./corpus.json');

const NOW = Date.parse('2026-09-23T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const input = over => ({ name: 'Organic Oats', labels: 'USDA Organic whole grain', certifications: 'USDA Organic',
  nutrition: { sodium: 0, protein: 5, servingGrams: 40, servingSize: '1/2 cup (40g)' },
  ingredients_text: 'Organic whole grain rolled oats', ...over });
const scanned = over => C.fromScan({ store: 'www.amazon.com', asin: 'B00TESTOAT', input: input(),
  via: 'nic-ingredients-content', confidence: 0.98, t: NOW - DAY, ...over }, NOW);
const row = over => ({ scanned_at: new Date(NOW - DAY).toISOString(), pulls: 0, ...over });

test('stale by age: fresh under 30 days, due for a rescan at 30', () => {
  assert.equal(C.stale(row({ scanned_at: new Date(NOW - 29 * DAY).toISOString() }), NOW), false);
  assert.equal(C.stale(row({ scanned_at: new Date(NOW - 30 * DAY).toISOString() }), NOW), true);
  assert.equal(C.stale(row({ scanned_at: 'not a date' }), NOW), true);
});

test('stale by pulls: 99 is fresh, 100 is stale, whichever comes first', () => {
  assert.equal(C.stale(row({ pulls: 99 }), NOW), false);
  assert.equal(C.stale(row({ pulls: 100 }), NOW), true);
  assert.equal(C.stale(row({ pulls: '100' }), NOW), true);
  assert.equal(C.stale(row({ pulls: 5, scanned_at: new Date(NOW - 40 * DAY).toISOString() }), NOW), true);
});

test('sanitize keeps the columns and bounded engine input, and nothing else', () => {
  const r = scanned();
  assert.deepEqual(Object.keys(r), C.COLUMNS);
  assert.equal(r.key, 'amazon.com:B00TESTOAT');
  assert.equal(r.store, 'amazon.com');
  assert.equal(r.status, 'ok');
  assert.equal(r.pulls, 0);
  assert.deepEqual(Object.keys(r.data).sort(),
    ['certifications', 'confidence', 'food', 'labels', 'nutrition', 'text', 'title', 'via']);
  const dirty = C.sanitize({ ...r, data: { ...r.data, text: 'x'.repeat(9000), notes: 'mine', email: 'a@b.c',
    nutrition: { protein: 5, _normalised: true, sodium: -1, junk: 'x' } } }, NOW);
  assert.equal(dirty.data.text.length, 6000);
  assert.equal(dirty.data.notes, undefined);
  assert.equal(dirty.data.email, undefined);
  assert.deepEqual(dirty.data.nutrition, { protein: 5 });
  // Sheet cells arrive as JSON text, sometimes with Sheets' leading text marker.
  assert.equal(C.sanitize({ ...r, data: "'" + JSON.stringify(r.data) }, NOW).data.text, r.data.text);
  assert.equal(C.sanitize({ ...r, scanned_at: "'" + r.scanned_at }, NOW).scanned_at, r.scanned_at);
});

test('sanitize rejects private, malformed, future and textless rows', () => {
  assert.equal(scanned({ via: 'manual-paste' }), null);
  assert.equal(scanned({ via: 'food-override' }), null);
  assert.equal(scanned({ asin: 'nope' }), null);
  assert.equal(scanned({ store: 'evil' }), null);
  assert.equal(scanned({ status: 'great' }), null);
  assert.equal(scanned({ t: NOW + DAY }), null);
  assert.equal(scanned({ input: input({ ingredients_text: '' }) }), null, 'an ok row must carry text');
  assert.equal(scanned({ status: 'unreadable', input: { name: 'Oats' } }).status, 'unreadable');
  assert.equal(scanned({ status: 'not-food', input: { name: 'Shampoo' }, food: false }).data.food, false);
  assert.equal(C.sanitize({ ...scanned(), data: '{not json' }, NOW), null);
  assert.equal(C.sanitize({ ...scanned(), data: '[]' }, NOW), null);
});

test('a cached read scores exactly like the live read, under any weights', () => {
  const profiles = [{}, { weights: { sugar: 2, refinedOil: 0 } }, { weights: { processing: 0, sodium: 1, protein: 1 } }];
  const products = [...corpus.products, ...corpus.defects].map(e => e.product).filter(p => p.ingredients_text);
  assert.ok(products.length > 20);
  for (const product of products) {
    const r = C.fromScan({ store: 'amazon.com', asin: 'B00TESTOAT', input: product, via: 'nic-ingredients-content', t: NOW - DAY }, NOW);
    const again = C.sanitize(JSON.parse(JSON.stringify(r)), NOW);   // through a sheet cell and back
    for (const prefs of profiles) {
      assert.equal(engine.score(C.toInput(again), prefs).score, engine.score(product, prefs).score, product.ingredients_text);
    }
  }
  // score() marks nutrition as normalised in place; toInput hands out a fresh copy every time.
  const r = scanned();
  engine.score(C.toInput(r), { weights: { protein: 1 } });
  assert.equal(r.data.nutrition._normalised, undefined);
});

test('mergeQueue: newest scan wins per key, pulls add up only for the same scan', () => {
  let q = C.mergeQueue(null, { upserts: [scanned()] }, NOW);
  q = C.mergeQueue(q, { upserts: [scanned({ t: NOW - 2 * DAY, input: input({ ingredients_text: 'Sugar' }) })] }, NOW);
  const [key] = Object.keys(q.upserts);
  assert.equal(q.upserts[key].data.text, 'Organic whole grain rolled oats');
  const at = q.upserts[key].scanned_at;
  q = C.mergeQueue(q, { pulls: [{ key, scanned_at: at }, { key: 'bad', scanned_at: at }] }, NOW);
  q = C.mergeQueue(q, { pulls: [{ key, scanned_at: at }] }, NOW);
  assert.deepEqual(q.pulls, { [key]: { scanned_at: at, n: 2 } });
  q = C.mergeQueue(q, { pulls: [{ key, scanned_at: new Date(NOW).toISOString() }] }, NOW);
  assert.equal(q.pulls[key].n, 1, 'a pull of a different scan starts over');
  assert.equal(C.queueSize(q), 2);
});
