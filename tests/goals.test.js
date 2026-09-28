// Goal-based scoring: signed weights turn minuses into pluses, goals combine by averaging, and no
// goal can launder a product past a hard cap.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const C = require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');

const score = (text, goals) => engine.score({ ingredients_text: text }, { weights: C.goalWeights(goals) });
const row = (r, re) => [...r.good, ...r.bad].find(h => re.test(h.why));
const KEFIR = 'Cultured pasteurized lowfat milk, cane sugar, natural flavors, pectin, vitamin A palmitate, vitamin D3';

test('Weight loss: fat-reduced dairy becomes a big plus, natural flavors barely count', () => {
  const plain = score(KEFIR, []);
  const cut = score(KEFIR, ['weightLoss']);
  assert.ok(row(plain, /^Fat-reduced dairy/).c < 0);
  const dairy = row(cut, /^Fat-reduced dairy/);
  assert.ok(dairy.c >= 12, `fat-reduced dairy should be a big plus, got ${dairy.c}`);
  assert.match(dairy.why, /a plus for your goals/);
  assert.ok(Math.abs(row(cut, /Natural flavors/).c) <= 3, 'natural flavors nearly off');
  assert.ok(Math.abs(row(plain, /Natural flavors/).c) >= 10);
});

// Lifeway Organic Plain Kefir (amazon.com B0DX45213W): whole milk first, some nonfat milk after it.
// 8 g fat in a 150-calorie bottle, so not a fat-reduced product, and Weight loss must not reward it.
const WHOLE_KEFIR = 'PASTEURIZED ORGANIC MILK, ORGANIC NONFAT MILK, PECTIN, LACTASE ENZYME, VITAMIN D3, CULTURES';
test('full-fat dairy first: the nonfat milk after it is neither a plus nor a penalty', () => {
  for (const goals of [[], ['weightLoss'], ['strength'], ['endurance']]) {
    const r = score(WHOLE_KEFIR, goals);
    assert.equal(row(r, /^Fat-reduced dairy/), undefined, `goals ${goals}: no fat-reduced dairy row`);
    assert.equal(row(r, /^Mostly full-fat dairy/), undefined, 'excluded fat-reduced ingredients need no zero-point row');
  }
  const LOWFAT_KEFIR = 'PASTEURIZED ORGANIC LOWFAT MILK, PECTIN, LACTASE ENZYME, VITAMIN D3, CULTURES';
  assert.ok(score(WHOLE_KEFIR, ['weightLoss']).score < score(LOWFAT_KEFIR, ['weightLoss']).score,
    'the same kefir made with lowfat milk still ranks above it for weight loss');
  // The title settles it even when nonfat milk comes first.
  const titled = engine.score({ name: 'Whole Milk Kefir', ingredients_text: 'Pasteurized nonfat milk, cream, cultures' }, { weights: C.goalWeights(['weightLoss']) });
  assert.equal(row(titled, /^Fat-reduced dairy/), undefined);
});
test('fat-reduced dairy still counts when it leads, or only milk fractions or plant milks come first', () => {
  for (const text of ['Cultured pasteurized nonfat milk, live cultures', 'Skim milk, vitamin A palmitate, vitamin D3',
    'Water, milk protein concentrate, nonfat milk, sucralose', 'Oat milk, nonfat milk, coffee', 'Whey protein, nonfat dry milk, cocoa']) {
    assert.ok(row(score(text, ['weightLoss']), /^Fat-reduced dairy — a plus/), text);
    assert.ok(row(score(text, []), /^Fat-reduced dairy/).c < 0, text);
  }
});

test('Vitamins & minerals: added vitamins count in favour', () => {
  const r = score('Oats, vitamin D3, niacin, folic acid', ['vitamins']);
  assert.ok(r.good.some(g => g.goal && /Folic acid/.test(g.why)));
  assert.ok(!r.bad.some(b => /Folic acid|vitamin D|niacin/i.test(b.why)));
});

test('goal rewards are capped at +20 and never lift a product past a hard cap', () => {
  const r = score('Nonfat milk, reduced fat cheese, skim milk, vitamin D3, folic acid, niacin, reduced iron, riboflavin',
    ['weightLoss', 'vitamins']);
  assert.ok(r.good.filter(g => g.goal).reduce((a, g) => a + g.c, 0) <= 20);
  const candy = score('Sugar, corn syrup, red 40, folic acid, niacin, vitamin B6', ['vitamins']);
  assert.ok(candy.score <= 18, `Red 40 caps at 18, got ${candy.score}`);
  assert.ok(candy.good.some(g => g.goal), 'the vitamins still show as pluses');
});

test('several goals combine: overlapping dials average, others stay default', () => {
  const both = C.goalWeights(['weightLoss', 'generalWellbeing']);
  assert.equal(both.artificialSweetener, (C.PRESETS.weightLoss.weights.artificialSweetener
    + C.PRESETS.generalWellbeing.weights.artificialSweetener) / 2);
  assert.equal(both.reducedFatDairy, C.PRESETS.weightLoss.weights.reducedFatDairy, 'only one goal sets it');
  for (const other of ['weightLoss', 'muscleGain', 'wholeFood', 'animalBased']) {
    assert.equal(C.goalWeights(['vitamins', other]).fortification, -1.5, `${other} must not dilute the vitamins goal`);
  }
  assert.deepEqual(C.goalWeights([]), C.DEFAULT_WEIGHTS);
  assert.deepEqual(C.goalWeights(['balanced']), C.DEFAULT_WEIGHTS);
});

test('Weight loss lifts the artificial-sweetener cap; adding General wellbeing pulls it back down', () => {
  const drink = 'Carbonated water, citric acid, sucralose, natural flavors, potassium benzoate';
  const base = score(drink, []).score;
  const cut = score(drink, ['weightLoss']).score;
  const both = score(drink, ['weightLoss', 'generalWellbeing']).score;
  assert.ok(cut > base, `weight loss ${cut} should beat default ${base}`);
  assert.ok(both < cut, `with wellbeing ${both} should be below weight loss alone ${cut}`);
  assert.ok(cut < 75, 'a zero-calorie drink is never a top score');
});

test('Animal-based: nuts, seeds and legumes count against, honey counts for; off for everyone else', () => {
  const text = 'Organic oats, almonds, chia seeds, black beans, honey';
  const ab = score(text, ['animalBased']);
  assert.ok(ab.bad.some(b => /Tree nuts/.test(b.why)));
  assert.ok(ab.bad.some(b => /Legumes/.test(b.why)));
  assert.ok(ab.good.some(g => g.goal && /Honey/.test(g.why)));
  const plain = score(text, []);
  assert.ok(!plain.bad.some(b => /Tree nuts|Legumes|Seeds —/.test(b.why)));
  assert.ok(!score('Coconut milk, nutmeg, sunflower oil, pea protein', ['animalBased']).bad
    .some(b => /Tree nuts|Legumes|Seeds —/.test(b.why)), 'coconut, nutmeg, oils and pea protein are not caught');
});

test('Animal-based: soy lecithin and soy oil are not legumes in any language the stores use', () => {
  // The English exclusion already named oil, protein and lecithin. Turkish writes soy lecithin as
  // "soya lesitini" and soy oil as "soya yağı", and both were charged as legumes.
  for (const text of ['Sugar, cocoa butter, emulsifier (soya lecithin)', 'Şeker, kakao yağı, emülgatör (soya lesitini)',
    'Sucre, émulsifiant (soya lécithine)', 'Patates, soya yağı, tuz']) {
    assert.ok(!score(text, ['animalBased']).bad.some(b => /Legumes/.test(b.why)), text);
  }
  assert.ok(score('Soya, water', ['animalBased']).bad.some(b => /Legumes/.test(b.why)), 'the bean itself still counts');
});

test('signed categories clamp to -2..2, everything else to 0..2', () => {
  const w = C.resolveWeights({ reducedFatDairy: -9, fortification: -1.5, colour: -1, sugar: 5 });
  assert.equal(w.reducedFatDairy, -2);
  assert.equal(w.fortification, -1.5);
  assert.equal(w.colour, 0, 'a cap can never be a plus');
  assert.equal(w.sugar, 2);
});

test('toggling and describing goals; goals travel with exports', () => {
  let g = C.toggleGoal([], 'weightLoss');
  g = C.toggleGoal(g, 'vitamins');
  assert.deepEqual(g, ['weightLoss', 'vitamins']);
  assert.deepEqual(C.toggleGoal(g, 'weightLoss'), ['vitamins']);
  assert.deepEqual(C.toggleGoal(g, 'balanced'), []);
  assert.deepEqual(C.describeGoals(C.goalWeights(g), g), { ids: g, custom: false });
  const moved = { ...C.goalWeights(g), sugar: 0.3 };
  assert.equal(C.describeGoals(moved, g).custom, true);
  assert.deepEqual(C.describeGoals(C.presetWeightMap('lowCarb'), []).ids, ['lowCarb'], 'pre-combination settings still resolve');
  const exported = prefs.exportPayload({ weights: C.goalWeights(g), goals: [...g, 'nope'] });
  assert.deepEqual(exported.goals, g);
  assert.deepEqual(prefs.parseImport(JSON.stringify(exported)).prefs.goals, g);
});
