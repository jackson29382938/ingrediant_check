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

console.log('\nnumber formats');
check('a US thousands comma is a thousands separator, a decimal comma still a decimal', () => {
  assert.strictEqual(parsePanel('Nutrition Facts Calories 150 Sodium 1,200mg Protein 8g').sodium, 1200);
  assert.strictEqual(parsePanel('Nährwerte je 100 g Energie 180 Zucker 12,5 g Eiweiß 4 g').sugar, 12.5);
});
check('an EU "kJ / kcal" energy line reads the kcal, not the kilojoules', () => {
  const out = parsePanel('Nährwerte je 100 g Energie 1.580 kJ / 377 kcal Zucker 12 g Eiweiß 4 g Salz 0,02 g');
  assert.strictEqual(out.calories, 377);
  assert.strictEqual(out.sodium, 8, 'salt 0.02 g is 8 mg sodium');
});
check('EU salt stands in for sodium only when no sodium is given', () => {
  assert.strictEqual(parsePanel('Valeurs nutritionnelles Sucres 12 g Sel 1,5 g').sodium, 600);
  assert.strictEqual(parsePanel('Nutrition Facts Sodium 150mg Salt 0.4g Protein 3g').sodium, 150);
});

check('an EU panel declared per 100 g is scored and labelled per 100g', () => {
  const nutrition = parsePanel('Nährwerte je 100 g Energie 1.580 kJ / 377 kcal Zucker 22 g Eiweiß 4 g Salz 1,2 g');
  assert.strictEqual(nutrition.servingGrams, 100);
  const r = engine.score({ name: 'x', ingredients_text: 'Hafer, Zucker', nutrition },
    { weights: categories.PRESETS.conventional.weights });
  const sugar = r.bad.find(h => /^Total sugar/.test(h.why));
  assert.ok(sugar && /per 100g$/.test(sugar.why) && sugar.ing === '22g/100g', JSON.stringify(sugar));
  assert.strictEqual(parsePanel('Nutrition Facts Serving size 30g Calories 120 Sugars 6g Protein 3g').servingGrams, 30,
    'a declared serving still wins');
});

check('Dutch, Swedish, Polish and Portuguese panels are readable', () => {
  const panels = {
    nl: 'Voedingswaarde per 100 g Energie 1580 kJ / 377 kcal Verzadigde vetzuren 1,2 g Suikers 22 g Vezels 6 g Eiwitten 9 g Zout 0,5 g',
    se: 'Näringsvärde per 100 g Energi 1580 kJ / 377 kcal Mättat fett 1,2 g Sockerarter 22 g Kostfiber 6 g Protein 9 g Salt 0,5 g',
    pl: 'Wartość odżywcza w 100 g Wartość energetyczna 1580 kJ / 377 kcal Kwasy tłuszczowe nasycone 1,2 g Cukry 22 g Błonnik 6 g Białko 9 g Sól 0,5 g',
  };
  for (const [lang, text] of Object.entries(panels)) {
    const out = parsePanel(text);
    assert.deepStrictEqual({ ...out }, { saturatedFat: 1.2, sugar: 22, fibre: 6, protein: 9, calories: 377, sodium: 200, servingGrams: 100 }, lang);
  }
  const br = parsePanel('Informação nutricional Porção 30 g Valor energético 120 kcal Açúcares 6 g Proteínas 3 g Sódio 45 mg');
  assert.strictEqual(br.sugar, 6);
  assert.strictEqual(br.sodium, 45);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
