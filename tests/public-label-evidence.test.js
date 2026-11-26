const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const engine = require('../src/engine/score.js');
const allergens = require('../src/engine/db/allergens.js');
const evidence = require('./public-label-evidence.json');
test('captured public labels have traceable intact responses and reviewed multilingual allergen expectations', () => {
  assert.equal(evidence.entries.length, 7);
  const languages = new Set();
  for (const entry of evidence.entries) {
    assert.match(entry.sourceUrl, /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/\d+\.json\?/);
    assert.equal(createHash('sha256').update(entry.responseJson).digest('hex'), entry.responseSha256);
    const response = JSON.parse(entry.responseJson); assert.equal(response.code, entry.barcode); assert.equal(response.status, 1);
    const product = response.product; languages.add(product.lang);
    const result = engine.score({ name: product.product_name, ingredients_text: product.ingredients_text }, { allergens: allergens.ALLERGENS.map(a => a.id) });
    assert.ok(result.parsed > 0 && result.coverage >= 0.34, entry.barcode + ' must clear the label coverage gate');
    for (const id of entry.requiredAllergens) assert.ok(result.flags.some(f => f.id === id), entry.barcode + ' missed ' + id);
    for (const id of entry.excludedAllergens) assert.ok(!result.flags.some(f => f.id === id), entry.barcode + ' falsely flagged ' + id);
  }
  assert.deepEqual([...languages].sort(), ['en', 'es', 'fr']);
});
test('free-from label notes cannot create a wheat flag or erase actual ingredients and cross-contact declarations', () => {
  for (const note of ['sans gluten', 'sin gluten', 'gluten free', 'glutenfrei', 'senza glutine']) {
    assert.ok(!engine.score({ ingredients_text: 'Oats, ' + note }, { allergens: ['wheat'] }).flags.some(f => f.id === 'wheat'), note);
    assert.ok(engine.score({ ingredients_text: 'Wheat flour, ' + note }, { allergens: ['wheat'] }).flags.some(f => f.id === 'wheat'), 'actual wheat must survive ' + note);
  }
  for (const declaration of ['May contain wheat', 'gluten içerir']) {
    assert.ok(engine.score({ ingredients_text: 'Oats, ' + declaration }, { allergens: ['wheat'] }).flags.some(f => f.id === 'wheat'), declaration);
  }
});

test('flattened and multiline allergen warnings retain their declaration and cross-contact evidence', () => {
  for (const [advisory_text, expected] of [
    ['Enthält Milch Kann Spuren von Soja enthalten', [['milk', 'contains'], ['soy', 'cross-contact']]],
    ['Contient du lait Peut contenir du soja', [['milk', 'contains'], ['soy', 'cross-contact']]],
    ['Contains milk. This product can also contain: soy', [['milk', 'contains'], ['soy', 'cross-contact']]],
    ['This product contains: milk; soy', [['milk', 'contains'], ['soy', 'contains']]],
    ['Contains: milk; manufactured in a shared facility with soy', [['milk', 'contains'], ['soy', 'cross-contact']]],
    ['Contains: _MILK_&nbsp;May contain soy', [['milk', 'contains'], ['soy', 'cross-contact']]],
  ]) {
    const result = engine.score({ ingredients_text: 'Oats, salt', advisory_text }, { allergens: ['milk', 'soy'] });
    assert.deepEqual(result.flags.map(f => [f.id, f.evidence]), expected, advisory_text);
    for (const flag of result.flags.filter(f => f.evidence === 'cross-contact')) assert.doesNotMatch(flag.evidenceText, /milk|milch|lait/i);
  }
});

test('possible dairy cross-contact warns an allergy but does not establish a dietary conflict', () => {
  const options = { allergens: ['milk'], diets: ['vegan'] };
  const check = advisory_text => engine.score({ ingredients_text: 'Oats, salt', advisory_text }, options);
  for (const phrase of ['May contain milk', 'Allergy advice: not suitable for those with a milk allergy']) {
    assert.deepEqual(check(phrase).flags.map(f => f.id), ['milk'], phrase);
  }
  assert.deepEqual(check('Contains: milk').flags.map(f => f.id), ['milk', 'vegan']);
  assert.equal(check('Contains: milk').score, check('May contain milk').score);
});
