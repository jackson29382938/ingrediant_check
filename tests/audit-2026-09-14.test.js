// Regressions for docs/AUDIT-2026-09-14.md. Every case here reproduced against the code as it stood
// that morning; each is pinned so the fix cannot quietly rot. Run: node tests/audit-2026-09-14.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));
const allergens = require(src('engine/db/allergens.js'));
const ingestible = require(src('engine/db/ingestible.js'));
const extract = require(src('content/extract.js'));

const score = (text, options) => engine.score({ ingredients_text: text }, options);
const reasons = r => r.bad.map(h => h.why);

// ---------------------------------------------------------------- 1. "organic" laundered sweeteners
test('a marketing qualifier in front of a sweetener does not remove its penalty', () => {
  const pairs = [
    ['agave nectar', 'organic agave nectar'], ['brown rice syrup', 'organic brown rice syrup'],
    ['tapioca syrup', 'organic tapioca syrup'], ['coconut sugar', 'organic coconut sugar'],
    ['erythritol', 'organic erythritol'], ['dextrose', 'organic dextrose'],
    ['glucose syrup', 'organic glucose syrup'], ['brown sugar', 'dark brown sugar'],
    ['agave nectar', 'raw blue agave nectar'], ['maltitol', 'non-gmo maltitol'],
  ];
  for (const [plain, dressed] of pairs) {
    const a = score(`Oats, ${plain}`), b = score(`Oats, ${dressed}`);
    assert.ok(reasons(a).length, `${plain} should be penalised`);
    assert.deepEqual(reasons(b).filter(w => !/organic/i.test(w)), reasons(a), dressed);
    // The organic bonus may still apply; the score must not otherwise move.
    assert.ok(b.score - a.score <= 8, `${dressed}: ${b.score} vs ${a.score}`);
  }
});

// ---------------------------------------------------------------- 2. food gate: "Case of 24"
test('pack and case wording is not evidence against food', () => {
  for (const title of [
    'LaCroix Sparkling Water, Lime, 12 Fl Oz (Case of 24)',
    'Blue Diamond Almonds, Case of 6',
    'Polar Seltzer Water Variety Case, 12 Fl Oz Cans',
    'Optimum Nutrition Whey Protein with Scoop',
    'Whey Protein 5 lb, Scoop Included',
  ]) assert.equal(ingestible.looksNonFoodFromTitle(title), false, title);
  for (const title of ['OtterBox iPhone 15 Case', 'Stainless Steel Ice Cream Scoop', 'Pill Organizer Case Weekly']) {
    assert.equal(ingestible.looksNonFoodFromTitle(title), true, title);
  }
});

test('a sparkling-water search does not stand down on its own result titles', () => {
  const titles = [
    'LaCroix Sparkling Water, Pamplemousse, 12 Fl Oz (Case of 24)',
    'Spindrift Sparkling Water, Raspberry Lime, 12 Fl Oz Cans (Case of 24)',
    'bubly Sparkling Water, Lime, 12 fl oz cans (Case of 18)',
    'Waterloo Sparkling Water, Black Cherry, 12 Fl Oz Cans, Case of 12',
    'Polar Seltzer Water Variety Case, 12 Fl Oz Cans',
    'Perrier Carbonated Mineral Water, Slim Cans, 8.45 Fl Oz (Case of 30)',
  ];
  assert.equal(ingestible.looksNonFoodFromResults(titles), false);
});

// ---------------------------------------------------------------- 3. trailing boilerplate sentence
test('a published list survives a trailing logistics sentence', () => {
  const cases = [
    ['Peanuts, Salt. Made in a facility that processes tree nuts.', 'Peanuts, Salt.'],
    ['Organic rolled oats. Product of Canada.', 'Organic rolled oats.'],
    ['Almonds, sea salt. Contains: tree nuts (almonds). Packed in the USA.', 'Almonds, sea salt. Contains: tree nuts (almonds).'],
    ['Cultured pasteurized milk, salt, enzymes. Keep refrigerated.', 'Cultured pasteurized milk, salt, enzymes.'],
  ];
  for (const [text, kept] of cases) {
    assert.equal(extract.looksLikeIngredients(text), true, text);
    assert.equal(extract.stripBoilerplate(text), kept);
  }
  // Boilerplate alone is still boilerplate.
  assert.equal(extract.looksLikeIngredients('Product of USA. Keep refrigerated. Best by date on package.'), false);
  assert.equal(extract.looksLikeIngredients('See label for ingredients.'), false);
});

// ---------------------------------------------------------------- 4. dairy flags on non-dairy
test('nut butters, plant milks and cream of tartar are not dairy', () => {
  const all = allergens.ALLERGENS.map(a => a.id), diets = allergens.DIETS.map(d => d.id);
  const flags = ing => allergens.detect([ing], all, diets).map(f => f.label);
  for (const ing of ['peanut butter', 'cocoa butter', 'shea butter', 'coconut milk', 'oat milk', 'cream of tartar', 'coconut cream']) {
    for (const wrong of ['Milk', 'Not vegan', 'Not dairy-free']) assert.ok(!flags(ing).includes(wrong), `${ing} → ${wrong}`);
  }
  for (const ing of ['butter', 'whole milk', 'heavy cream', 'buttermilk', 'milk chocolate', 'ice cream']) {
    assert.deepEqual(flags(ing).filter(f => /Milk|vegan|dairy/.test(f)), ['Milk', 'Not vegan', 'Not dairy-free'], ing);
  }
  assert.ok(!flags('eggplant').includes('Not vegan'));
  assert.ok(flags('egg noodles').includes('Egg'));
  assert.ok(!flags('almond flour').includes('Not keto-friendly'));
  assert.ok(!flags('coconut flour').includes('Not keto-friendly'));
  assert.ok(flags('wheat flour').includes('Not keto-friendly'));
  assert.ok(!flags('corned beef').includes('Corn'));
  assert.ok(flags('popcorn').includes('Corn'));
});

// ---------------------------------------------------------------- 7. derived products are not whole foods
test('a product derived from a whole food is not classed as the whole food', () => {
  for (const one of ['Milk chocolate', 'Butter flavored oil', 'Chicken flavor', 'Beef stock', 'Peanut butter']) {
    assert.notEqual(score(one).nova, 1, one);
  }
  for (const one of ['Peanuts', 'Black beans', 'Cream cheese', 'Whole milk', 'Chicken breast', 'Raw almonds']) {
    assert.equal(score(one).nova, 1, one);
  }
});

// ---------------------------------------------------------------- 11. calibration
test('plain flour is processed, not ultra-processed; sugar and oil earn no whole-food bonus', () => {
  assert.equal(score('Whole wheat flour, water, salt, yeast').nova, 3);
  assert.equal(score('Enriched flour (wheat flour, niacin, reduced iron), water, salt, yeast').nova, 4);
  for (const lone of ['Sugar', 'Sunflower oil', 'Milk chocolate']) {
    assert.ok(!score(lone).good.some(g => /Single-ingredient/.test(g.why)), lone);
  }
  assert.ok(score('Peanuts').good.some(g => /Single-ingredient/.test(g.why)));
});

// ---------------------------------------------------------------- 12. locale twins
test('the same chocolate scores the same in five languages', () => {
  const en = score('Sugar, cocoa butter, whole milk powder, emulsifier (soy lecithin), flavor').score;
  const twins = {
    es: 'Azúcar, manteca de cacao, leche entera en polvo, emulsionante (lecitina de soja), aroma',
    fr: 'Sucre, beurre de cacao, lait entier en poudre, émulsifiant (lécithine de soja), arôme',
    de: 'Zucker, Kakaobutter, Vollmilchpulver, Emulgator (Sojalecithin), Aroma',
    it: 'Zucchero, burro di cacao, latte intero in polvere, emulsionante (lecitina di soia), aromi',
  };
  for (const [lang, text] of Object.entries(twins)) {
    const r = score(text);
    assert.ok(Math.abs(r.score - en) <= 4, `${lang}: ${r.score} vs en ${en}`);
    assert.ok(r.coverage >= 0.6, `${lang}: coverage ${r.coverage}`);
  }
  // A bilingual label is charged once for its flavouring.
  assert.equal(reasons(score('Natural flavour / arôme naturel, water')).filter(w => /flavo/i.test(w)).length, 1);
});

// ---------------------------------------------------------------- then: parser and cap rows
test('decimal percentages and "contains less than" do not create junk entries', () => {
  assert.deepEqual(engine.parse('Water, contains 2.5% or less of: salt, vitamin b12, sodium benzoate (0.1%)'),
    ['water', 'salt', 'vitamin b12', 'sodium benzoate', '0.1%']);
  assert.deepEqual(engine.parse('Chicken stock, contains less than 2% of salt, yeast extract'),
    ['chicken stock', 'salt', 'yeast extract']);
});

test('one oil produces one cap row', () => {
  const caps = r => r.bad.filter(h => h.c === 'CAP' || h.cap === true).map(h => h.why);
  assert.equal(caps(score('Potatoes, high oleic sunflower oil, salt')).length, 1);
  const trans = caps(score('Water, partially hydrogenated soybean oil, salt'));
  assert.ok(trans.some(w => /trans fat/i.test(w)));
  assert.ok(!trans.some(w => /^Hydrogenated oil/.test(w)));
});

// ---------------------------------------------------------------- then: nutrition numbers
test('nutrition values parse with decimal commas and added sugar reads its own row', () => {
  const doc = text => ({ querySelector: sel => (sel === '#nic-nutrition-facts-content' ? { innerText: text } : null), querySelectorAll: () => [] });
  const us = extract.nutritionFacts(doc('Nutrition Facts Serving size 1 cup (240ml) Calories 120 Sodium 125mg Dietary Fiber 4g Total Sugars 12g\nIncludes 10g Added Sugars\nProtein 8g'));
  assert.equal(us.addedSugar, 10);
  assert.equal(us.fibre, 4);
  assert.equal(us.servingGrams, 240);
  const de = extract.nutritionFacts(doc('Nährwertangaben Portion 30 g Energie 450 kcal gesättigte Fettsäuren 2,5 g Zucker 12,5 g Ballaststoffe 3,1 g Eiweiß 8,2 g Natrium 120 mg'));
  assert.deepEqual([de.saturatedFat, de.sugar, de.fibre, de.protein, de.sodium], [2.5, 12.5, 3.1, 8.2, 120]);
});
