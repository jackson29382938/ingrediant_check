// Probiotic strain lists. Lifeway Organic Whole Milk Kefir (B0DX45213W) publishes its twelve strains
// on Amazon's card as "B, BREVE, B, LACTIS, …" before the milk. Split at those commas, the strains
// became fragments the rulebase could not read, coverage fell to 33%, and a plain kefir was
// declined as an unreadable label.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');

const REAL = 'PASTEURIZED ORGANIC MILK, ORGANIC NONFAT MILK, PECTIN, LACTASE ENZYME, VITAMIN D3, CULTURES';
const AMAZON = 'B, BREVE, B, LACTIS, B, LONGUM, L, ACIDOPHILUS, L, CASEI, L, CREMORIS, L, LACTIS, L, PLANTARUM, '
  + 'L, REUTERI, L, RHAMNOSUS, S, DIACETYLACTIS, S, FLORENTINUS, ' + REAL;
const product = text => ({ ingredients_text: text, name: 'Lifeway Organic Whole Milk Kefir, Plain' });

test('a kefir that names its strains is read, and scores exactly like its list without them', () => {
  const named = engine.score(product(AMAZON));
  const plain = engine.score(product(REAL));
  assert.equal(named.coverage, 1);
  assert.equal(named.score, plain.score);
  assert.deepEqual(named.bad, plain.bad);
});

test('each strain is one entry, and a run of strains shares one position', () => {
  const entries = engine.parseEntries(AMAZON);
  const strains = entries.filter(e => /^[bls] /.test(e.ing));
  assert.equal(strains.length, 12);
  assert.deepEqual([...new Set(strains.map(e => e.pos))], [0]);
  assert.deepEqual(entries.find(e => e.ing === 'pasteurized organic milk').pos, 1);
});

test('the period, run-together and colon forms join too; a lone letter before a non-species does not', () => {
  const ings = text => engine.parse(text);
  assert.ok(ings('Milk, live active cultures (B. breve, S. thermophilus)').includes('b breve'));
  assert.ok(ings('Milk, cultures: L.acidophilus, L. casei').includes('cultures: l acidophilus'));
  assert.ok(ings('Milk, L. casei').includes('l casei'));
  assert.deepEqual(ings('Water, sugar, B, niacin'), ['water', 'sugar', 'niacin']);
});

test('twenty strains are not a "very long ingredient list"', () => {
  const species = ['breve', 'lactis', 'longum', 'acidophilus', 'casei', 'paracasei', 'cremoris', 'plantarum', 'reuteri',
    'rhamnosus', 'diacetylactis', 'florentinus', 'bulgaricus', 'thermophilus', 'bifidum', 'infantis', 'helveticus',
    'fermentum', 'salivarius', 'gasseri'];
  const r = engine.score(product(species.map(s => `L. ${s}`).join(', ') + ', ' + REAL));
  assert.ok(!r.bad.some(b => /long ingredient list/i.test(b.why)));
});
