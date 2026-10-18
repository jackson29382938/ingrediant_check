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
