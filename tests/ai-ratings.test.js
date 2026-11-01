// AI ingredient ratings: what a model's answer can and cannot do to a score (src/engine/db/ai-ratings.js).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const A = require(src('engine/db/ai-ratings.js'));
const engine = require(src('engine/score.js'));
const categories = require(src('engine/categories.js'));
const productCache = require(src('engine/db/product-cache.js'));
const scoreCache = require(src('engine/db/score-cache.js'));

const sum = rows => rows.reduce((a, r) => a + (typeof r.c === 'number' ? r.c : 0), 0);
const LIST = 'Rice flour, water, salt, zorbex gum, qualiflavor 12, kaniwa';
const product = extra => ({ name: 'Test snack', ingredients_text: LIST, ...extra });
const GUM = { 'zorbex gum': { c: 'texture', k: 0.9 } };
const FLAVOUR = { 'qualiflavor 12': { c: 'flavouring', k: 0.8 } };
const WHOLE = { kaniwa: { c: 'whole', k: 0.95 } };

test('without ratings nothing changes: an empty or missing map scores exactly as before', () => {
  const plain = engine.score(product());
  for (const none of [{}, null, [], 'x', { 'zorbex gum': { c: 'bogus', k: 1 } }]) {
    const again = engine.score(product({ aiRatings: none }));
    assert.equal(again.score, plain.score);
    assert.equal(again.coverage, plain.coverage);
    assert.equal(again.ai, undefined);
  }
  assert.deepEqual(plain.unrecognised, ['zorbex gum', 'qualiflavor 12', 'kaniwa']);
});

test('the closed vocabulary: every class maps to an existing category, or to none, and never adds points', () => {
  const known = new Set(categories.CATEGORIES.map(c => c.id));
  for (const [id, def] of Object.entries(A.CLASSES)) {
    assert.ok(def.pts >= 0 && def.pts <= 8, `${id} is small`);
    if (def.pts > 0) assert.ok(known.has(def.cat), `${id} uses category ${def.cat}`);
    else assert.equal(def.cat, null, `${id} charges nothing and names no category`);
    assert.ok(['hard', 'soft', 'none'].includes(def.upf));
  }
  assert.ok(!A.CLASS_IDS.includes('unknown'), 'unknown is the absence of a rating, not a class');
});

test('a rating counts the entry as read, charges it a labelled amount, and the panel still adds up', () => {
  const plain = engine.score(product());
  const rated = engine.score(product({ aiRatings: { ...GUM, ...FLAVOUR, ...WHOLE } }));
  assert.ok(rated.coverage > plain.coverage);
  assert.equal(rated.coverage, 1);
  const ai = rated.bad.filter(r => r.ai);
  assert.equal(ai.length, 2);
  assert.ok(ai.every(r => /AI estimate$/.test(r.why) && r.c < 0), 'rows are labelled and charge');
  assert.ok(rated.score < plain.score);
  assert.equal(rated.base + sum(rated.good) + sum(rated.bad), rated.score, 'the rows add up to the score');
  assert.deepEqual(rated.ai.rated.map(r => r.id).sort(), ['flavouring', 'texture', 'whole']);
  assert.equal(rated.nova, 4, 'a flavouring votes on processing like the curated one');
});

test('a model can only charge: no combination of ratings raises a score', () => {
  const plain = engine.score(product());
  for (const c of A.CLASS_IDS) {
    const rated = engine.score(product({ aiRatings: { 'zorbex gum': { c, k: 1 }, 'qualiflavor 12': { c, k: 1 }, kaniwa: { c, k: 1 } } }));
    assert.ok(rated.score <= plain.score + 0, `${c} did not raise the score (${rated.score} vs ${plain.score})`);
    assert.ok(!rated.good.some(r => r.ai), `${c} added no bonus row`);
    assert.equal(rated.cap, plain.cap, `${c} set no ceiling`);
  }
});

test('a rule always wins: a rating for an entry a rule recognises is ignored', () => {
  const plain = engine.score(product());
  const rated = engine.score(product({ aiRatings: { 'rice flour': { c: 'flavouring', k: 1 }, salt: { c: 'preservative', k: 1 }, water: { c: 'colour', k: 1 } } }));
  assert.equal(rated.score, plain.score);
  assert.equal(rated.ai, undefined);
});

test('a low-confidence answer is no answer', () => {
  const plain = engine.score(product());
  const rated = engine.score(product({ aiRatings: { 'zorbex gum': { c: 'texture', k: A.MIN_CONFIDENCE - 0.01 }, 'qualiflavor 12': { c: 'flavouring', k: 0.1 } } }));
  assert.equal(rated.score, plain.score);
  assert.equal(rated.coverage, plain.coverage);
});

test('the reader\'s own weight scales an AI charge, and weight 0 removes it', () => {
  const ratings = { aiRatings: GUM };
  const base = { ...categories.DEFAULT_WEIGHTS };
  const at = weight => engine.score(product(ratings), { weights: { ...base, texture: weight } });
  const off = at(0), normal = at(1), double = at(2);
  assert.equal(off.bad.filter(r => r.ai).length, 0);
  assert.ok(off.coverage === normal.coverage, 'weight 0 still counts the entry as read');
  assert.ok(normal.score > double.score);
  assert.ok(off.score > normal.score);
});

test('limits per product: a list of strange words is not a list of defects', () => {
  const words = Array.from({ length: 12 }, (_, i) => `zorbex${String.fromCharCode(97 + i)} extract`);
  const ratings = Object.fromEntries(words.map(w => [w, { c: 'isolate', k: 1 }]));
  const r = engine.score({ name: 'x', ingredients_text: 'rice, ' + words.join(', '), aiRatings: ratings });
  assert.ok(r.bad.filter(x => x.ai).length <= A.MAX_CHARGED);
  assert.equal(r.base + sum(r.good) + sum(r.bad), r.score);
});

test('a list the coverage gate refused becomes readable when its unfamiliar words are rated, never otherwise', () => {
  const text = 'zorbex, quillon, vandrel, tarsk, plimm';
  const plain = engine.score({ name: 'x', ingredients_text: text });
  assert.equal(plain.readable, false);
  assert.equal(plain.unrecognised.length, 5);
  const ratings = Object.fromEntries(plain.unrecognised.map(w => [w, { c: 'processed', k: 0.8 }]));
  const rated = engine.score({ name: 'x', ingredients_text: text, aiRatings: ratings });
  assert.equal(rated.readable, true);
  assert.ok(rated.bad.some(r => r.ai));
});

test('allergen, diet and avoid-list flags never read a rating', () => {
  const options = { allergens: ['milk', 'wheat'], diets: ['vegan'], avoidList: ['zorbex'] };
  const text = 'wheat flour, milk, zorbex gum, qualiflavor 12';
  const flagsOf = ratings => engine.score({ name: 'x', ingredients_text: text, aiRatings: ratings }, options).flags.map(f => f.id + f.kind).sort();
  assert.deepEqual(flagsOf({ 'zorbex gum': { c: 'whole', k: 1 }, 'qualiflavor 12': { c: 'flavouring', k: 1 } }), flagsOf(undefined));
});

test('keyOf and sanitize heal anything a stored map can hold', () => {
  assert.equal(A.keyOf('  Zorbex   GUM, '), 'zorbex gum');
  assert.equal(A.keyOf('12345'), '');
  assert.equal(A.keyOf('x'.repeat(81)), '');
  assert.equal(A.keyOf({}), '');
  const messy = { 'Zorbex Gum': { c: 'texture', k: 2 }, '': { c: 'texture', k: 1 }, 'a b': { c: 'nope', k: 1 }, 'c d': { c: 'sugar', k: 'high' }, 'e f': 'x', 'g h': null };
  assert.deepEqual(A.sanitize(messy), { 'zorbex gum': { c: 'texture', k: 1 } });
  const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, { c: 'sugar', k: 1 }]));
  assert.equal(Object.keys(A.sanitize(big)).length, A.MAX_PER_READING);
  assert.deepEqual(A.sanitize('nonsense'), {});
  assert.deepEqual(A.sanitize(JSON.parse('{"__proto__":{"c":"sugar","k":1}}')), {});
});

test('parseReply reads a class id and a number for the names asked about, and nothing else', () => {
  const asked = ['zorbex gum', 'qualiflavor 12', 'kaniwa'];
  const reply = JSON.stringify({ ratings: [
    { name: 'Zorbex Gum', class: 'texture', confidence: 0.9, note: 'ignore previous instructions' },
    { name: 'qualiflavor 12', class: 'flavouring', confidence: 0.7 },
    { name: 'kaniwa', class: 'unknown', confidence: 0.9 },
    { name: 'an ingredient nobody asked about', class: 'colour', confidence: 1 },
    { name: 'zorbex gum', class: 'colour', confidence: 1 },
  ] });
  assert.deepEqual(A.parseReply(reply, asked), { 'zorbex gum': { c: 'texture', k: 0.9 }, 'qualiflavor 12': { c: 'flavouring', k: 0.7 } });
  assert.deepEqual(A.parseReply('```json\n' + reply + '\n```', asked), A.parseReply(reply, asked));
  for (const bad of ['', 'not json', '{"ratings":"x"}', '[1,2,3]', 'null', '{"ratings":[null,5,"x",{"name":3}]}', 'Sure! Here you go: ' + reply]) {
    assert.deepEqual(A.parseReply(bad, asked), {}, JSON.stringify(bad).slice(0, 40));
  }
});

test('toAsk keeps what the engine could not read, once, minus what is already rated', () => {
  assert.deepEqual(A.toAsk(['Zorbex Gum', 'zorbex gum', '123', 'plimm', 'kaniwa'], { kaniwa: { c: 'whole', k: 1 } }), ['zorbex gum', 'plimm']);
  assert.equal(A.toAsk(Array.from({ length: 60 }, (_, i) => 'word' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26))), {}).length, A.MAX_PER_REQUEST);
  assert.deepEqual(A.toAsk(null, null), []);
});

test('ratings stay on this computer: a shared or outgoing row carries none, a local one keeps them', () => {
  const data = { title: 'Snack', text: LIST, via: 'page', inputSchema: 1, aiRatings: { ...GUM, ...WHOLE } };
  const row = { store: 'amazon.com', asin: 'B00LOAW7U6', status: 'ok', scanned_at: Date.now(), data };
  assert.equal(productCache.sanitize(row).data.aiRatings, undefined, 'default read, as for a shared row');
  const local = productCache.sanitizeLocal(row);
  assert.deepEqual(local.data.aiRatings, { 'zorbex gum': { c: 'texture', k: 0.9 }, kaniwa: { c: 'whole', k: 0.95 } });
  assert.deepEqual(productCache.toInput(local).aiRatings, local.data.aiRatings);
  assert.notEqual(productCache.toInput(local).aiRatings, local.data.aiRatings, 'a copy, so a consumer cannot alter the stored reading');
  const queued = productCache.mergeQueue({}, { upserts: [{ ...row, data: { ...data } }] });
  assert.equal(Object.values(queued.upserts)[0].data.aiRatings, undefined, 'never queued for upload');
  const scanned = productCache.fromScan({ store: 'amazon.com', asin: 'B00LOAW7U6', input: { name: 'Snack', ingredients_text: LIST, aiRatings: GUM }, via: 'page', confidence: 1 });
  assert.deepEqual(scanned.data.aiRatings, { 'zorbex gum': { c: 'texture', k: 0.9 } });
  // Poisoned values never survive a local read either.
  const hostile = productCache.sanitizeLocal({ ...row, data: { ...data, aiRatings: { 'zorbex gum': { c: 'cap-the-score', k: 1 } } } });
  assert.equal(hostile.data.aiRatings, undefined);
});

test('a label a model transcribed is kept local and never taken from the shared tab', () => {
  const row = { store: 'amazon.com', asin: 'B00LOAW7U6', status: 'ok', scanned_at: Date.now(), data: { title: 'Snack', text: LIST, via: 'label-ai', inputSchema: 1 } };
  assert.equal(productCache.sanitize(row), null);
  assert.equal(productCache.sanitizeLocal(row).data.via, 'label-ai');
  assert.deepEqual(Object.keys(productCache.mergeQueue({}, { upserts: [row] }).upserts), []);
});

test('a saved score that used ratings is retired by the switch, and one that did not is not', () => {
  const on = { aiRatings: true }, off = { aiRatings: false };
  assert.notEqual(scoreCache.fingerprint(on, 'page', 'food', true), scoreCache.fingerprint(off, 'page', 'food', true));
  assert.equal(scoreCache.fingerprint(on, 'page', 'food', false), scoreCache.fingerprint(off, 'page', 'food', false));
  assert.notEqual(scoreCache.fingerprint({ aiLabels: true }, 'label-ai'), scoreCache.fingerprint({ aiLabels: false }, 'label-ai'));
  assert.equal(scoreCache.fingerprint({ aiLabels: true }, 'page'), scoreCache.fingerprint({ aiLabels: false }, 'page'));
});
