const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyProduct } = require('../src/engine/db/ingestible.js');
const allergens = require('../src/engine/db/allergens.js');
const { personalCareReview } = require('../src/engine/db/ingestible.js');
const engine = require('../src/engine/score.js');
const panel = require('../src/content/panel.js');
globalThis.AIR.db.allergens = allergens;

test('recognizes the requested product types without treating food as personal care', () => {
  const examples = {
    'Fluoride toothpaste': 'toothpaste', 'Alcohol free mouthwash': 'mouthwash',
    'Antiperspirant deodorant': 'deodorant', 'Gentle shampoo': 'shampoo',
    'Hair conditioner': 'conditioner', 'Body wash': 'body-wash',
    'Body lotion': 'moisturizer', 'Vitamin D3 capsules': 'supplement',
    'Daily multivitamin': 'supplement',
  };
  for (const [title, category] of Object.entries(examples)) {
    assert.deepEqual(classifyProduct(title), { category, status: 'recognized' }, title);
  }
  assert.equal(classifyProduct('Vitamin D fortified milk').status, 'unknown');
  assert.equal(classifyProduct('Vitamin C face serum').status, 'unsupported');
  assert.equal(classifyProduct('Breakfast oats').status, 'unknown');
  assert.equal(classifyProduct('Fabric conditioner').status, 'unknown');
});

test('personal-care reviews report disclosed ingredients and preference matches without a score', () => {
  const review = personalCareReview('Fluoride toothpaste', 'Water, Sodium Fluoride, Fragrance', { avoidList: ['fragrance'] });
  assert.equal(review.category, 'toothpaste');
  assert.equal(review.flags[0].kind, 'avoid');
  assert.equal(review.notes.length, 2);
  assert.equal(Object.hasOwn(review, 'score'), false);
  assert.equal(personalCareReview('Fluoride toothpaste', ''), null);
  assert.equal(personalCareReview('Multivitamin', 'Vitamin C').category, 'supplement');
  const supplement = personalCareReview('Multivitamin', 'Vitamin C, gelatin', {}, '', 'Supplement Facts Serving Size 1 capsule Vitamin C 90 mg');
  assert.match(panel.renderPersonalCare(supplement), /Serving Size 1 capsule/);
  const html = panel.renderPersonalCare({ ...review, ingredients: '<script>unsafe</script>' });
  assert.match(html, /insufficient for the selected rating style/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /On your avoid list: fragrance/);
  const declarations = personalCareReview('Body wash', 'Water, without fragrance, glycerin',
    { avoidList: ['fragrance'], allergens: ['sesame'] }, 'May contain sesame');
  assert.equal(declarations.flags.some(f => f.kind === 'avoid'), false);
  assert.equal(declarations.flags.some(f => f.id === 'sesame'), true);
  assert.equal(declarations.notes.some(note => /Fragrance is listed/.test(note)), false);
  const moisturizer = personalCareReview('Body moisturizer', 'Water, glycerin, ceramide NP');
  assert.ok(moisturizer.notes.some(note => /moisturizing ingredient/.test(note)));
  assert.ok(moisturizer.sources.some(source => source.url.startsWith('https://www.aad.org/')));
  assert.doesNotMatch(panel.renderPersonalCare({ ...moisturizer, sources: [{ url: 'javascript:alert(1)', label: 'untrusted' }] }), /javascript:/);
});

test('food rules cannot rate identified personal-care products', () => {
  for (const name of ['Toothpaste', 'Shampoo', 'Sunscreen', 'Shampoo and conditioner', 'Multivitamin']) {
    assert.equal(engine.isReadable(engine.score({ name, ingredients_text: 'water, sugar, salt' })), false, name);
  }
  assert.equal(engine.isReadable(engine.score({ name: 'Oats', ingredients_text: 'oats' })), true);
});

test('declines ambiguous combinations and accessories', () => {
  for (const title of ['Shampoo and conditioner', 'Toothpaste and mouthwash bundle', 'Toothpaste dispenser']) {
    assert.equal(classifyProduct(title).status, 'ambiguous', title);
  }
  assert.equal(classifyProduct('Sunscreen').status, 'unsupported');
  assert.equal(classifyProduct('Fish oil', { supplementFacts: true }).category, 'supplement');
  assert.equal(classifyProduct('Fish oil softgels').category, 'supplement');
  assert.equal(classifyProduct('Shampoo with biotin', { supplementFacts: true }).category, 'shampoo');
});
