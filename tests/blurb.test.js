// Product name published as an ingredient list. Run: node tests/blurb.test.js
//
// Amazon's ingredients field is sometimes populated with the product NAME and its pack specs.
// Verified on live amazon.com: Lifeway Low Fat Kefir (B00LOAW7U6) publishes
//   "Lifeway Lowfat Kefir, Strawberry, 32 Ounce, 11g Protein, 12 Live Active Cultures"
// which parsed as five ingredients and scored 86/100 Good. The actual label scores 31 Poor.
// A 55-point error on a real best-seller, from scoring marketing copy.
//
// The test that matters most here is the NEGATIVE one: a single-ingredient whole food repeats its
// own title verbatim and must still be read.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
require(src('engine/db/ingestible.js'));
const extract = require(src('content/extract.js'));
const engine = require(src('engine/score.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

const KEFIR_TITLE = 'Lifeway Low Fat Kefir – Probiotic Drink with 10g Protein, 12 Live Active '
  + 'Cultures - Up to 99% Lactose Free, Gluten Free – Strawberry, 32 oz.';

console.log('a product name published as ingredients is refused');
for (const [why, text, title] of [
  ['the live Lifeway case', 'Lifeway Lowfat Kefir, Strawberry, 32 Ounce, 11g Protein, 12 Live Active Cultures', KEFIR_TITLE],
  ['pack specs with no title', '32 Ounce, 12 Count, Pack of 6, 11g Protein', ''],
  ['name plus size', 'Chobani Greek Yogurt, Strawberry, 5.3 oz, 12 Count', 'Chobani Greek Yogurt Strawberry 5.3 oz 12 Count'],
  ['count and cfu claims', 'Probiotic Capsules, 60 Count, 50 billion CFU', 'Probiotic Capsules 60 Count 50 billion CFU'],
]) {
  check(why, () => assert.ok(!extract.looksLikeIngredients(text, title), `accepted: "${text}"`));
}

console.log('\na real list is still read, even when it echoes the title');
for (const [why, text, title] of [
  ['the actual Lifeway label',
   'Cultured Pasteurized Grade A Lowfat Milk, Strawberry, Cane Sugar, Natural Flavor, Pectin, Vitamin A Palmitate, Vitamin D3', KEFIR_TITLE],
  ['single-ingredient whole food', 'Organic Whole Grain Rolled Oats', "Bob's Red Mill Organic Whole Grain Rolled Oats, 32oz"],
  ['two ingredients, both in the title', 'Organic rolled oats, sea salt', 'Organic Rolled Oats with Sea Salt'],
  ['peanut butter', 'Peanuts, salt', "Smucker's Natural Creamy Peanut Butter, 16 oz"],
  ['a list that merely mentions a weight', 'Water, sugar, natural flavors, red 40', 'Fruit Punch Drink 64 oz'],
]) {
  check(why, () => assert.ok(extract.looksLikeIngredients(text, title), `rejected: "${text}"`));
}

console.log('\nthe blurb and the label do not score alike');
check('scoring the blurb would have been 50+ points wrong', () => {
  const blurb = engine.score({ name: KEFIR_TITLE,
    ingredients_text: 'Lifeway Lowfat Kefir, Strawberry, 32 Ounce, 11g Protein, 12 Live Active Cultures' }, {});
  const real = engine.score({ name: KEFIR_TITLE,
    ingredients_text: 'Cultured Pasteurized Grade A Lowfat Milk, Strawberry, Cane Sugar, Natural Flavor, Pectin, Vitamin A Palmitate, Vitamin D3' }, {});
  assert.ok(blurb.score - real.score > 40,
    `blurb ${blurb.score} vs real ${real.score} — the gap this test documents has closed, check why`);
});

console.log('\nfat-reduced dairy covers the nouns dairy actually comes as');
for (const t of ['Cultured lowfat kefir', 'Low fat cottage cheese, salt', 'Part-skim mozzarella cheese',
                 'Reduced-fat sour cream, cultures', 'Nonfat buttermilk']) {
  check(t, () => {
    const r = engine.score({ name: 'Dairy', ingredients_text: t }, {});
    assert.ok(r.bad.some(h => /fat-reduced dairy/i.test(h.why)), `no fat-reduced penalty for "${t}"`);
  });
}

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
