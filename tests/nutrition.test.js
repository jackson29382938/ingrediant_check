// Nutrition panel parsing and per-100g normalisation. Run: node tests/nutrition.test.js
//
// These categories all default to 0, so nothing here is reachable until a user enables one — but
// the "Conventional nutrition" preset enables five of them in a single click, and the bug this
// file was written for turned plain bread into 15/100 "Avoid" by reading a ONE GRAM serving off
// the Total Fat line and multiplying every figure by a hundred.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));
const categories = require(src('engine/categories.js'));
const extract = require(src('content/extract.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};
const parsePanel = text =>
  extract.nutritionFacts({ querySelector: s => (s.includes('nic-nutrition') ? { innerText: text } : null) });

console.log('serving weight is read from the size, not from the rows beneath it');
const SIZES = [
  ['1 cup (55g) Calories 200 Total Fat 3g Sodium 150mg', 55, 'parenthetical grams'],
  ['1 cup (240ml) Calories 120 Sodium 45mg Protein 8g', 240, 'millilitres, for drinks'],
  ['1 bar (40g) Servings per container 12 Calories 190 Total Fat 8g', 40, 'servings-per-container follows'],
  ['2 tbsp (32 g) Calories 190 Total Fat 16g', 32, 'space before the unit'],
  ['1 slice Calories 80 Total Fat 1g Sodium 170mg', undefined, 'no declared weight — must stay unknown'],
  ['1 cup Calories 120 Total Fat 5g Sodium 200mg', undefined, 'no declared weight, fat follows'],
];
for (const [size, expected, why] of SIZES) {
  check(why, () => {
    const out = parsePanel('Nutrition Facts Serving size ' + size);
    assert.strictEqual(out && out.servingGrams, expected,
      `"${size}" -> ${out && out.servingGrams}, expected ${expected}`);
  });
}

console.log('\nnormalisation is refused when it would produce impossible food');
check('a bad serving weight does not multiply everything by a hundred', () => {
  // Belt and braces: even if a weight is misread, no food holds >100g of a macronutrient per 100g.
  const nutrition = { sodium: 170, sugar: 2, protein: 4, servingGrams: 1 };
  const r = engine.score(
    { name: 'Bread', ingredients_text: 'Organic wheat flour, water, sea salt, yeast', nutrition },
    { weights: categories.PRESETS.conventional.weights });
  const sugarRow = r.bad.find(h => /sugar/i.test(h.why) && /100g/.test(h.why));
  assert.ok(!sugarRow, `normalised anyway: ${sugarRow && sugarRow.ing}`);
  assert.ok(r.score > 40, `scored ${r.score}; the impossible-value guard did not fire`);
});

check('nothing out-salts pure salt', () => {
  const r = engine.score({ name: 'x', ingredients_text: 'Water, salt',
    nutrition: { sodium: 500, servingGrams: 0.5 } }, { weights: { sodium: 1 } });
  const row = r.bad.find(h => /sodium/i.test(h.why));
  assert.ok(!row || !/100g/.test(row.why), 'normalised a 0.5g serving into 100,000mg/100g');
});

check('a real serving weight still normalises', () => {
  const r = engine.score({ name: 'Cereal', ingredients_text: 'Corn, sugar, salt',
    nutrition: { sugar: 12, servingGrams: 30 } }, { weights: { totalSugar: 1 } });
  const row = r.bad.find(h => /sugar/i.test(h.why) && /100g/.test(h.why));
  assert.ok(row, 'a 30g serving should normalise to 40g/100g');
  assert.ok(/40g\/100g/.test(row.ing), `reported ${row.ing}`);
});

console.log('\nserving size is what makes two identical foods comparable');
check('the same cereal scores alike at 28g and 55g declared servings', () => {
  const at = grams => engine.score(
    { name: 'Cereal', ingredients_text: 'Corn, sugar, salt',
      nutrition: { sugar: 12 * grams / 100, sodium: 400 * grams / 100, servingGrams: grams } },
    { weights: { totalSugar: 1, sodium: 1 } }).score;
  assert.strictEqual(at(28), at(55), `28g -> ${at(28)}, 55g -> ${at(55)}`);
});

check('a German nutrition panel is readable', () => {
  const out = extract.nutritionFacts({
    querySelector: s => (s.includes('nic-nutrition')
      ? { innerText: 'Nährwertangaben / 100g Energie 180 Natrium 150mg Zucker 12g Eiweiß 4g Ballaststoffe 3g' }
      : null),
  });
  assert.ok(out, 'expected a nutrition object');
  assert.strictEqual(out.sodium, 150);
  assert.strictEqual(out.sugar, 12);
  assert.strictEqual(out.protein, 4);
  assert.strictEqual(out.fibre, 3);
});

console.log('\nmissing data is not zero');
check('no panel means no nutrition rows at all', () => {
  const r = engine.score({ name: 'x', ingredients_text: 'Organic rolled oats' },
    { weights: categories.PRESETS.conventional.weights });
  assert.ok(!r.bad.some(h => /per serving|per 100g/i.test(h.why)), 'invented nutrition rows');
  assert.ok(!r.good.some(h => /per serving|per 100g/i.test(h.why)), 'invented a fibre or protein bonus');
});
check('a panel with only one readable field is discarded', () => {
  // nutritionFacts requires two fields; one number in a wall of prose is noise, not a panel.
  assert.strictEqual(parsePanel('Nutrition Facts Calories 120'), null);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
