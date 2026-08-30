// Food-only gate + settings wiring. Run: node tests/food-gate.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const ingestible = require(src('engine/db/ingestible.js'));
const extract = require(src('content/extract.js'));
const panel = require(src('content/panel.js'));

function stubDoc(title, extras = {}) {
  return {
    title,
    querySelector(sel) {
      for (const p of String(sel).split(',').map(s => s.trim())) {
        if (p === '#productTitle') return { innerText: title };
        if (extras[p]) return extras[p];
      }
      return null;
    },
    querySelectorAll() { return []; },
  };
}

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('ingestible.assess');

check('grocery oats pass', () => {
  const g = ingestible.assess(stubDoc('365 Everyday Value Organic Rolled Oats'), {
    title: '365 Everyday Value Organic Rolled Oats',
    text: 'Grocery & Gourmet Food  Serving size 40g  Nutrition Facts',
  });
  assert.ok(g.ok, JSON.stringify(g));
});

check('international store-brand milk passes on nutrition panel', () => {
  const g = ingestible.assess(stubDoc('Leche entera Kirkland'), {
    title: 'Leche entera Kirkland',
    text: 'Nutrition Facts  Serving size 240ml  Grocery & Gourmet Food',
  });
  assert.ok(g.ok, JSON.stringify(g));
});

check('shampoo is rejected', () => {
  const g = ingestible.assess(stubDoc('Head & Shoulders Classic Clean Shampoo'), {
    title: 'Head & Shoulders Classic Clean Shampoo',
    text: 'Beauty & Personal Care',
  });
  assert.ok(!g.ok);
  assert.ok(g.negatives.includes('cosmetic') || g.negatives.includes('nonFoodDept'));
});

check('beauty department is enough even without a cosmetic word', () => {
  const g = ingestible.assess(stubDoc('Glow Night Repair 30ml'), {
    title: 'Glow Night Repair 30ml',
    text: 'Beauty & Personal Care  For external use only',
  });
  assert.ok(!g.ok);
});

check('drug facts reject medicine', () => {
  const g = ingestible.assess(stubDoc('Store Brand Ibuprofen Tablets'), {
    title: 'Store Brand Ibuprofen Tablets',
    text: 'Drug Facts  Active ingredient Ibuprofen 200mg',
  });
  assert.ok(!g.ok);
  assert.ok(g.negatives.includes('drugFacts') || g.negatives.includes('medicine'));
});

check('essential oil is not food', () => {
  const g = ingestible.assess(stubDoc('Lavender Essential Oil 4oz'), {
    title: 'Lavender Essential Oil 4oz',
    text: '',
  });
  assert.ok(!g.ok);
  assert.ok(g.negatives.includes('essentialOil'));
});

check('olive oil food is not treated as essential oil', () => {
  const g = ingestible.assess(stubDoc('Kirkland Signature Extra Virgin Olive Oil'), {
    title: 'Kirkland Signature Extra Virgin Olive Oil',
    text: 'Grocery & Gourmet Food  Nutrition Facts  Serving size 15ml',
  });
  assert.ok(g.ok, JSON.stringify(g));
});

check('title prefilter skips shampoo but not generic oats', () => {
  assert.ok(ingestible.looksNonFoodFromTitle('Pantene Pro-V Daily Moisture Renewal Shampoo'));
  assert.ok(!ingestible.looksNonFoodFromTitle('Organic Rolled Oats 42 oz'));
  assert.ok(!ingestible.looksNonFoodFromTitle('Kirkland Signature'));
});

check('food titles are not treated as kitchen equipment', () => {
  assert.ok(!ingestible.looksNonFoodFromTitle('Peter Pan Creamy Peanut Butter'));
  assert.ok(!ingestible.looksNonFoodFromTitle("Marie Callender's Chicken Pot Pie"));
  assert.ok(!ingestible.looksNonFoodFromTitle('Storage onion 5lb'));
  assert.ok(!ingestible.looksNonFoodFromTitle('Grilled Chicken Breast'));
});

check('real kitchen equipment is still skipped', () => {
  assert.ok(ingestible.looksNonFoodFromTitle('Instant Pot Duo 7-in-1 Electric Pressure Cooker'));
  assert.ok(ingestible.looksNonFoodFromTitle('Cast Iron Skillet 12 inch'));
});

console.log('Open Food Facts filter');

check('explicit beauty product_type is rejected', () => {
  assert.ok(!ingestible.isOpenFoodFactsFood({ product_type: 'beauty', ingredients_text: 'aqua' }));
});

check('missing product_type with no beauty categories is accepted', () => {
  assert.ok(ingestible.isOpenFoodFactsFood({ ingredients_text: 'oats, salt' }));
});

check('en:shampoos category is rejected', () => {
  assert.ok(!ingestible.isOpenFoodFactsFood({
    product_type: 'food',
    categories_tags: ['en:shampoos', 'en:hair-care'],
  }));
});

console.log('extract() honors foodOnly');

check('foodOnly on: shampoo does not parse ingredients', () => {
  const doc = stubDoc('Head & Shoulders Classic Clean Shampoo', {
    '#nic-ingredients-content': { innerText: 'Water, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Fragrance' },
  });
  const out = extract.extract(doc, { foodOnly: true });
  assert.strictEqual(out.reason, 'not-ingestible');
  assert.ok(!out.ok);
  assert.ok(!out.text);
});

check('foodOnly off: shampoo ingredients are parsed', () => {
  const doc = stubDoc('Head & Shoulders Classic Clean Shampoo', {
    '#nic-ingredients-content': { innerText: 'Water, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Fragrance' },
  });
  const out = extract.extract(doc, { foodOnly: false });
  assert.ok(out.ok, JSON.stringify({ ok: out.ok, reason: out.reason, text: out.text }));
  assert.ok(/Sodium Laureth Sulfate/i.test(out.text));
});

check('food product still extracts when foodOnly is on', () => {
  const doc = stubDoc('Organic Rolled Oats', {
    '#nic-ingredients-content': { innerText: 'Organic rolled oats' },
    '#nutritionalInfoAndIngredients_feature_div': { innerText: 'Nutrition Facts Serving size 40g Calories 150' },
    '#wayfinding-breadcrumbs_feature_div': { innerText: 'Grocery & Gourmet Food' },
  });
  const out = extract.extract(doc, { foodOnly: true });
  assert.ok(out.ok, JSON.stringify({ ok: out.ok, reason: out.reason, ingestible: out.ingestible }));
  assert.ok(/rolled oats/i.test(out.text));
});

console.log('looksLikeIngredients accepts short whole foods');

check('short and long single-ingredient phrases are accepted', () => {
  assert.ok(extract.looksLikeIngredients('Whole Milk'));
  assert.ok(extract.looksLikeIngredients('Organic Milk'));
  assert.ok(extract.looksLikeIngredients('Eggs'));
  assert.ok(extract.looksLikeIngredients('Honey'));
  assert.ok(extract.looksLikeIngredients('Organic extra virgin olive oil'));
  assert.ok(extract.looksLikeIngredients('Organic whole grain rolled oats'));
  assert.ok(extract.looksLikeIngredients('Organic Rolled Oats.'));
});

check('headings and logistics copy are still rejected', () => {
  assert.ok(!extract.looksLikeIngredients('Ingredients'));
  assert.ok(!extract.looksLikeIngredients('About this item'));
  assert.ok(!extract.looksLikeIngredients('See label for ingredients.'));
  assert.ok(!extract.looksLikeIngredients('Product of USA, Keep refrigerated, Best by date on package'));
});

check('short whole-food text extracts from the nutrition card', () => {
  const doc = stubDoc('Organic Valley Whole Milk', {
    '#nic-ingredients-content': { innerText: 'Whole Milk' },
    '#nutritionalInfoAndIngredients_feature_div': { innerText: 'Nutrition Facts Serving size 240ml Calories 150' },
    '#wayfinding-breadcrumbs_feature_div': { innerText: 'Grocery & Gourmet Food' },
  });
  const out = extract.extract(doc, { foodOnly: true });
  assert.ok(out.ok, JSON.stringify({ ok: out.ok, reason: out.reason, text: out.text }));
  assert.ok(/whole milk/i.test(out.text));
});

check('manual paste accepts a real list and rejects a stub', () => {
  assert.ok(panel.pasteLooksValid('Whole Milk'));
  assert.ok(panel.pasteLooksValid('organic rolled oats, salt'));
  assert.ok(!panel.pasteLooksValid('hi'));
  assert.ok(!panel.pasteLooksValid('See label for ingredients.'));
});

console.log('settings prefs reach the scorer');

const engine = require(src('engine/score.js'));

check('allergen and avoid-list settings flag a food without changing the score', () => {
  const product = {
    name: 'Sesame crackers',
    ingredients_text: 'wheat flour, sesame seeds, sunflower oil, salt',
  };
  const bare = engine.score(product, { weights: {}, allergens: [], diets: [], avoidList: [] });
  const flagged = engine.score(product, {
    weights: {},
    allergens: ['sesame', 'wheat'],
    diets: ['glutenFree'],
    avoidList: ['sunflower oil'],
  });
  assert.strictEqual(bare.score, flagged.score, 'flags must not move the score');
  assert.ok(flagged.flags.some(f => f.id === 'sesame'));
  assert.ok(flagged.flags.some(f => f.id === 'wheat'));
  assert.ok(flagged.flags.some(f => f.kind === 'diet'));
  assert.ok(flagged.flags.some(f => f.kind === 'avoid'));
  assert.strictEqual(bare.flags.length, 0);
});

check('sugar weight setting changes the score', () => {
  const product = { name: 'Candy', ingredients_text: 'cane sugar, water, natural flavors' };
  const on = engine.score(product, { weights: { sugar: 1, flavour: 1 } });
  const off = engine.score(product, { weights: { sugar: 0, flavour: 1 } });
  assert.ok(on.score < off.score, `expected sugar weight to lower score (${on.score} vs ${off.score})`);
});

if (failed) {
  console.error('\n' + failed + ' failed');
  process.exit(1);
}
console.log('\nall passed');
