// Denials must not erase ingredients. Run: node tests/negation.test.js
//
// The regression this locks down: stripNegations() consumes from the negation word to the next
// delimiter, so running it over an ingredient list deleted the rest of the ingredient.
// "Water, Non-GMO Soybean Oil, Sugar" became "Water, , Sugar" and a product that caps at 25
// scored 68. Both halves matter, so both are asserted here:
//
//   1. a denial ADJECTIVE on a real ingredient must leave the ingredient scoreable
//   2. a denial PHRASE must still not be read as a presence
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};
const scoreOf = t => engine.score({ name: 'Test', ingredients_text: t }, {}).score;
const capOf = t => engine.score({ name: 'Test', ingredients_text: t }, {}).cap;

// Every ingredient that sets a hard ceiling, with the marketing adjectives that really appear
// beside it on a US panel. Each must still trip its cap.
const CAPPED = [
  'soybean oil', 'canola oil', 'sunflower oil', 'corn oil', 'cottonseed oil', 'vegetable oil',
  'partially hydrogenated soybean oil', 'high fructose corn syrup', 'corn syrup', 'sucralose',
  'aspartame', 'acesulfame potassium', 'saccharin', 'red 40', 'yellow 5', 'blue 1',
  'titanium dioxide', 'caramel color', 'carrageenan', 'BHA', 'BHT', 'TBHQ', 'potassium bromate',
];
// Denial adjectives that really appear glued to an ingredient, plus two denial phrases that a
// badly punctuated panel can run into it. None of these may launder the cap. Cold-pressed and
// expeller-pressed are deliberately NOT here: those are not denials, and oils.UNREFINED softens
// the ceiling for them on purpose (asserted separately below).
const PREFIXES = ['Non-GMO', 'Non GMO', 'No cholesterol added', 'Zero trans fat'];

console.log('a capped ingredient still caps behind a denial adjective');
for (const ing of CAPPED) {
  check(ing, () => {
    const bare = scoreOf(`Water, ${ing}, salt`);
    assert.ok(capOf(`Water, ${ing}, salt`), `${ing} does not cap even bare — test list is stale`);
    for (const p of PREFIXES) {
      const withPrefix = scoreOf(`Water, ${p} ${ing}, salt`);
      assert.ok(withPrefix <= bare + 2,
        `"${p} ${ing}" scored ${withPrefix} but bare "${ing}" scored ${bare} — the adjective laundered it`);
    }
  });
}

console.log('\na denial phrase is still not read as a presence');
const CLEAN = 'Organic cream, sea salt';
const baseline = scoreOf(CLEAN);
for (const denial of [
  'contains no artificial colors', 'made with no preservatives', 'made without artificial flavors',
  'free from artificial colors', 'absolutely no msg', '100% free of high fructose corn syrup',
  'no artificial colours', 'msg free', 'gluten free', 'zero trans fat',
]) {
  check(`"${denial}"`, () => {
    const withDenial = scoreOf(`${CLEAN}, ${denial}`);
    assert.ok(withDenial >= baseline - 2,
      `denial "${denial}" cost ${baseline - withDenial} points — it was read as a presence`);
  });
}

console.log('\ningredients that merely start with a denial-like prefix survive');
for (const [text, why] of [
  ['Non-Dairy Creamer, sugar', '"non-dairy" is an ingredient, not a denial'],
  ['Nonfat Dry Milk, sugar', '"nonfat" has no word boundary after "non"'],
  ['Water, Not From Concentrate Orange Juice', 'a juice, not a denial'],
  ['Nori, sesame seeds', 'plain word starting with "no"'],
  ['Nutmeg, cinnamon', 'plain word starting with "n"'],
]) {
  check(why, () => {
    const parsed = engine.score({ name: 'x', ingredients_text: text }, {}).parsed;
    const items = text.split(',').length;
    assert.strictEqual(parsed, items, `parsed ${parsed} of ${items} entries from "${text}" — one was eaten`);
  });
}

console.log('\nthe unrefined qualifier softens rather than launders');
check('cold-pressed seed oil lands between the cap and a clean score', () => {
  const capped = scoreOf('Sunflower oil');
  const softened = scoreOf('Cold-pressed unrefined sunflower oil');
  assert.ok(softened > capped, `cold-pressed scored ${softened}, refined ${capped} — softening is inert`);
  assert.ok(softened < 75, `cold-pressed scored ${softened} — softened into "Good", which is not softening`);
});
check('a qualifier on one oil does not lift the cap on another', () => {
  const mixed = engine.score(
    { name: 'x', ingredients_text: 'Potatoes, sunflower oil, cold-pressed olive oil, salt' }, {});
  assert.ok(mixed.score <= 30, `scored ${mixed.score} — the olive oil qualifier lifted the sunflower cap`);
});

console.log('\nthe two surfaces stay separate');
check('a title denial does not condemn, an ingredient adjective does not launder', () => {
  const laundered = engine.score(
    { name: 'Heart Healthy Mayo — No Artificial Anything', labels: 'No preservatives, non-gmo',
      ingredients_text: 'Water, Non-GMO Soybean Oil, sugar' }, {});
  assert.ok(laundered.cap, 'the seed oil must still cap despite clean marketing copy');
  assert.ok(laundered.score <= 30, `scored ${laundered.score}, expected the cap to bind`);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
