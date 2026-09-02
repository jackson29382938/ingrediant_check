// The extension must not run on non-food searches. Run: node tests/search-gate.test.js
//
// assess() answers "is this thing food". It never answered "is this SEARCH about food", so a
// search for running shoes still swept every result tile, armed a hover listener on each, and ran
// the IntersectionObserver across the page.
//
// The gate resolves ambiguity towards RUNNING, unlike the per-product gate: a search page makes no
// claim about anything, and the per-tile filter still stands behind it, so standing down on a
// grocery search is the worse error.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const gate = require(src('engine/db/ingestible.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};
const verdict = ctx => gate.assessSearch(ctx);
const runs = ctx => verdict(ctx).ok;

console.log('department is the strongest signal');
for (const alias of ['fashion', 'fashion-womens', 'shoes', 'electronics', 'computers', 'toys-and-games',
                     'tools', 'automotive', 'beauty', 'pets', 'office-products', 'videogames',
                     'stripbooks', 'furniture', 'kitchen', 'appliances', 'sporting']) {
  check(`stands down in i=${alias}`, () => {
    assert.ok(!runs({ alias, query: 'anything' }), `still ran in the ${alias} department`);
  });
}
for (const alias of ['grocery', 'amazonfresh', 'wholefoods', 'gourmet-food', 'beverages']) {
  check(`runs in i=${alias}`, () => {
    // A food department must win even when the query text looks like equipment: someone searching
    // "cast iron" inside Grocery is looking at seasoning, not cookware.
    assert.ok(runs({ alias, query: 'cast iron skillet' }), `stood down in the ${alias} department`);
  });
}

console.log('\nthe visible dropdown label covers the shapes where i= is absent');
check('Clothing, Shoes & Jewelry stands down', () =>
  assert.ok(!runs({ label: 'Clothing, Shoes & Jewelry', query: 'milk' })));
check('Grocery & Gourmet Food runs', () =>
  assert.ok(runs({ alias: 'aps', label: 'Grocery & Gourmet Food', query: 'cookware' })));

console.log('\nquery text, consulted only when the department says nothing');
for (const q of ['running shoes', 'nike sneakers', 'shampoo', 'laptop', 'cast iron skillet',
                 'instant pot', 'dog food', 'lavender essential oil', 'ibuprofen',
                 'wireless headphones', 'lego star wars', 'queen mattress', 'motor oil']) {
  check(`stands down for "${q}"`, () => assert.ok(!runs({ query: q }), `still ran for "${q}"`));
}
for (const q of ['organic rolled oats', 'grass fed ground beef', 'olive oil', 'protein powder',
                 'greek yogurt', 'almond butter', 'coffee', 'sourdough bread', 'kirkland signature',
                 'electrolyte powder', 'collagen peptides', 'baby formula']) {
  check(`runs for "${q}"`, () => assert.ok(runs({ query: q }), `stood down on a food search: "${q}"`));
}

console.log('\nAmazon\'s own results settle a search that names no category');
check('a page of shoes stands the extension down', () => {
  const titles = ['Nike Air Max 270 Mens Running Shoes', 'adidas Ultraboost Sneakers',
                  'ASICS Gel-Kayano Running Shoe', 'New Balance 990v5 Sneaker',
                  'Brooks Ghost 15 Running Shoes', 'Hoka Clifton 9 Shoes'];
  assert.ok(gate.looksNonFoodFromResults(titles));
});
check('a page of groceries does not', () => {
  const titles = ['365 Organic Rolled Oats 42oz', 'Kirkland Signature Almond Butter',
                  'Bobs Red Mill Steel Cut Oats', 'Quaker Old Fashioned Oats',
                  'Nature Valley Granola', 'Store Brand Whole Milk'];
  assert.ok(!gate.looksNonFoodFromResults(titles));
});
check('a thin sample concludes nothing', () => {
  // Refusing to decide on 4 tiles is the point: results stream in, and an early tick must not
  // latch a verdict formed before the page rendered.
  assert.ok(!gate.looksNonFoodFromResults(['Nike Running Shoes', 'adidas Sneakers', 'Puma Shoes']));
});
check('a mixed page keeps running', () => {
  const titles = ['Nike Running Shoes', 'Organic Rolled Oats', 'Whole Milk',
                  'adidas Sneakers', 'Almond Butter', 'Greek Yogurt'];
  assert.ok(!gate.looksNonFoodFromResults(titles));
});

console.log('\nthe new merchandise rule must not catch food');
for (const t of ['Chobani Greek Yogurt', 'Kettle Brand Potato Chips', 'Ghirardelli Chocolate Bar',
                 'Celestial Seasonings Herbal Tea', 'Bobs Red Mill Almond Flour',
                 'Vital Farms Pasture-Raised Eggs', 'Organic Medjool Dates', 'Nutella Hazelnut Spread',
                 'Table Water Crackers', 'Vegetable Broth', 'Cookie Dough Ice Cream']) {
  check(`"${t}" is still food`, () =>
    assert.ok(!gate.looksNonFoodFromTitle(t), `the merchandise rule swallowed a food title`));
}
for (const t of ['HP 15.6" Laptop', 'Sony WH-1000XM5 Headphones', 'Queen Size Mattress',
                 'LEGO Star Wars Millennium Falcon', 'DeWalt Cordless Drill']) {
  check(`"${t}" is merchandise`, () => assert.ok(gate.looksNonFoodFromTitle(t)));
}

console.log('\nturning the setting off is the user\'s call, not the gate\'s');
check('assessSearch is advisory only — main.js checks state.foodOnly first', () => {
  // Documented here because the bypass lives in the caller: searchAllowed() returns true
  // immediately when foodOnly is off, so this function is never consulted.
  assert.ok(!runs({ alias: 'fashion' }), 'sanity: fashion is a stand-down when the gate IS consulted');
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
