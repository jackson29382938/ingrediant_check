'use strict';
// db/purchase-store.js: the purchase history in buckets instead of one 8 MB key. Measured in Chromium with 8.3 MB
// of history: adding one record to the single key took 2.7 s; one bucket took 72 ms.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/engine/db/purchase-store.js');

// chrome.storage.local in memory, counting what each set and get moved.
function area(initial = {}) {
  const data = structuredClone(initial);
  const calls = { sets: [], removes: [], gets: [] };
  return { data, calls,
    async get(keys) { calls.gets.push([].concat(keys)); return structuredClone(Object.fromEntries([].concat(keys).filter(k => k in data).map(k => [k, data[k]]))); },
    async set(values) { calls.sets.push(Object.keys(values)); Object.assign(data, structuredClone(values)); },
    async remove(keys) { calls.removes.push([].concat(keys)); for (const k of [].concat(keys)) delete data[k]; } };
}
const record = i => ({ key: `order-${i}-B0${String(i).padStart(8, '0')}`, asin: `B0${String(i).padStart(8, '0')}`, name: `Oats ${i}`, observedAt: 1_700_000_000_000 + i, score: 50 + (i % 50) });
const many = n => Array.from({ length: n }, (_, i) => record(i));
const sortedKeys = list => list.map(r => r.key).sort();

test('records written come back, from any bucket, with nothing lost or doubled', async () => {
  const a = area(), list = many(1500);
  await store.write(a, list);
  assert.deepEqual(sortedKeys(await store.read(a)), sortedKeys(list));
  assert.equal(await store.count(a), 1500);
  assert.equal(a.data[store.INDEX_KEY].count, 1500);
  assert.ok(Object.keys(a.data).filter(k => k.startsWith('purchaseHistory:')).length > 40, 'spread over the buckets');
  assert.equal(a.data.purchaseHistory, undefined, 'no single big key');
});

test('changing one record rewrites one bucket; an unchanged history writes none', async () => {
  const a = area(), list = many(4000);
  await store.write(a, list);
  a.calls.sets.length = 0;
  assert.equal(await store.write(a, list), 0, 'the same records write no bucket');
  assert.deepEqual(a.calls.sets[0], [store.INDEX_KEY], 'only the index');
  const changed = list.map((r, i) => (i === 7 ? { ...r, score: 99 } : r));
  assert.equal(await store.write(a, changed), 1);
  assert.equal(a.calls.sets.at(-1).filter(k => k.startsWith('purchaseHistory:')).length, 1);
  const added = [...changed, record(99999)];
  assert.equal(await store.write(a, added), 1, 'a new record lands in one bucket');
  assert.equal(await store.count(a), 4001);
});

test('input order does not matter: the same records in another order are the same history', async () => {
  const a = area(), list = many(900);
  await store.write(a, list);
  assert.equal(await store.write(a, [...list].reverse()), 0);
});

test('extra keys are saved in the same set as the buckets and the index', async () => {
  const a = area();
  await store.write(a, many(10), { historySyncStatus: { ok: false } });
  assert.equal(a.calls.sets.length, 1, 'one atomic set');
  assert.ok(a.calls.sets[0].includes('historySyncStatus') && a.calls.sets[0].includes(store.INDEX_KEY));
});

test('emptying the history removes the buckets that held records', async () => {
  const a = area();
  await store.write(a, many(300));
  await store.write(a, []);
  assert.deepEqual(Object.keys(a.data).filter(k => k.startsWith('purchaseHistory:')), []);
  assert.deepEqual(await store.read(a), []);
  assert.equal(await store.count(a), 0);
});

test('shrinking the history drops the buckets that became empty', async () => {
  const a = area(), list = many(40);
  await store.write(a, list);
  await store.write(a, list.slice(0, 3));
  assert.equal((await store.read(a)).length, 3);
  assert.ok(Object.keys(a.data).filter(k => /^purchaseHistory:\d+$/.test(k)).length <= 3);
});

test('an install from before the buckets reads its single array, and the first write converts it', async () => {
  const legacy = many(120), a = area({ purchaseHistory: legacy });
  assert.deepEqual(sortedKeys(await store.read(a)), sortedKeys(legacy));
  assert.equal(await store.count(a), 120);
  await store.write(a, [...legacy, record(500)]);
  assert.equal(a.data.purchaseHistory, undefined, 'the old key is gone');
  assert.equal((await store.read(a)).length, 121);
});

test('a half-finished migration (index and old array both present) reads the index', async () => {
  const a = area();
  await store.write(a, many(30));
  a.data.purchaseHistory = [record(1)];
  assert.equal((await store.read(a)).length, 30);
  await store.write(a, many(30));
  assert.equal(a.data.purchaseHistory, undefined, 'the leftover is cleaned up by the next write');
});

test('a damaged index is ignored rather than trusted', async () => {
  const a = area({ [store.INDEX_KEY]: { v: 2, buckets: 7, used: ['x'], hashes: null }, purchaseHistory: many(5) });
  assert.equal((await store.read(a)).length, 5);
});

test('changed() sees a history write by its index, whichever shape it was saved in', () => {
  assert.equal(store.changed({ [store.INDEX_KEY]: {} }), true);
  assert.equal(store.changed({ purchaseHistory: {} }), true);
  assert.equal(store.changed({ 'purchaseHistory:3': {} }), false, 'a bucket on its own is not the event; the index comes with it');
  assert.equal(store.changed({ historyEnabled: {} }), false);
  assert.equal(store.changed(undefined), false);
});

test('ten thousand records spread evenly enough that no bucket is a second big key', async () => {
  const a = area(), list = many(10000);
  await store.write(a, list);
  const sizes = Object.entries(a.data).filter(([k]) => /^purchaseHistory:\d+$/.test(k)).map(([, rows]) => rows.length);
  assert.equal(sizes.length, store.BUCKETS);
  assert.ok(Math.max(...sizes) < 10000 / store.BUCKETS * 1.5, `largest bucket ${Math.max(...sizes)} of an even ${Math.round(10000 / store.BUCKETS)}`);
});
