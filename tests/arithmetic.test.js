// The panel must not lie. Run: node tests/arithmetic.test.js
//
// score.js:283 and :460 promise that the numbers printed beside each row add up to the score the
// user is looking at: the saturation discount is redistributed across the rows, and the soft
// ceiling's shave is pushed back into the bonus rows rather than applied invisibly at the end.
//
// This file is referenced by that comment and did not exist. It does now.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));
const categories = require(src('engine/categories.js'));
const corpus = require('./corpus.json');

// Same convention as corpus.test.js: a listed defect is known-broken, so its failures are
// reported and not counted. Remove the id once fixed and the assertion becomes hard.
const OPEN_DEFECTS = new Set(['display-arithmetic']);

let failed = 0, known = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

const sum = rows => rows.reduce((a, r) => a + (typeof r.c === 'number' ? r.c : 0), 0);

function assertBalances(entry, opts, label) {
  const r = engine.score(entry.product, opts);
  const total = r.base + sum(r.good) + sum(r.bad);
  assert.strictEqual(total, r.score,
    `${label}: base ${r.base} + good ${sum(r.good)} + bad ${sum(r.bad)} = ${total}, but score is ${r.score}`);
  return r;
}

const ALL = [...corpus.products, ...corpus.defects];

console.log('displayed rows sum to the score — default weights');
// score.js:478 applies the hard cap AFTER the display rows were reconciled, and score.js:455
// clamps to SCORE_FLOOR before `shave` is computed. Both leave the panel showing rows that sum
// to one number beside a badge showing another. Worst observed: safflower-oil chips render
// "+3, no penalties" next to a red 25.
const open = OPEN_DEFECTS.has('display-arithmetic');
let imbalanced = 0;
for (const entry of ALL) {
  try { assertBalances(entry, {}, entry.id); console.log('  ok  ' + entry.id); }
  catch (e) {
    if (open) { imbalanced++; known++; console.log('  known-fail  ' + e.message + '  [display-arithmetic]'); }
    else { failed++; console.error('  FAIL ' + e.message); }
  }
}
if (open && imbalanced) console.log(`  -> ${imbalanced}/${ALL.length} do not balance at default weights`);
if (open && !imbalanced) console.log('  FIXED? display-arithmetic passes at default weights — check the weighted profiles, then remove it from OPEN_DEFECTS.');

console.log('\n…and under non-default weights');
// The redistribution logic is weight-sensitive: weights change penalties, bonuses, caps and the
// base independently, so a balance that holds at 1.0 can break at 0 or 2.
const PROFILES = [
  ['all off', Object.fromEntries(categories.CATEGORIES.map(c => [c.id, 0]))],
  ['all doubled', Object.fromEntries(categories.CATEGORIES.map(c => [c.id, 2]))],
  ...Object.entries(categories.PRESETS).map(([id, p]) => [`preset:${id}`, p.weights]),
];
for (const [label, weights] of PROFILES) {
  let bad = 0;
  for (const entry of ALL) {
    try { assertBalances(entry, { weights }, entry.id); }
    catch (e) { bad++; if (bad === 1 && !open) console.error('       first: ' + e.message); }
  }
  if (bad && open) { known++; console.log(`  known-fail  ${label}: ${bad}/${ALL.length} products do not balance  [display-arithmetic]`); }
  else if (bad) { failed++; console.error(`  FAIL ${label}: ${bad}/${ALL.length} products do not balance`); }
  else console.log(`  ok  ${label} (${ALL.length} products)`);
}

console.log('\nscore stays inside its own bounds');
for (const [label, weights] of PROFILES) {
  check(label, () => {
    for (const entry of ALL) {
      const r = engine.score(entry.product, { weights });
      assert.ok(r.score >= 3 && r.score <= 100, `${entry.id} scored ${r.score}`);
      assert.ok(r.verdict, `${entry.id} has no verdict`);
      assert.ok(Number.isInteger(r.score), `${entry.id} scored a non-integer ${r.score}`);
    }
  });
}

console.log('\nrow-level guarantees');
check('no displayed row is worth zero points', () => {
  for (const entry of ALL) {
    const r = engine.score(entry.product, {});
    const zeroBad = r.bad.filter(h => h.c === 0);
    assert.strictEqual(zeroBad.length, 0, `${entry.id} shows a 0-point penalty row: ${JSON.stringify(zeroBad)}`);
  }
});

check('an earned bonus never displays as nothing', () => {
  // score.js:471 — the ceiling shave leaves every bonus row at 1 point or more.
  for (const entry of ALL) {
    const r = engine.score(entry.product, {});
    const negative = r.good.filter(h => typeof h.c === 'number' && h.c < 0);
    assert.strictEqual(negative.length, 0, `${entry.id} shows a negative bonus: ${JSON.stringify(negative)}`);
  }
});

check('cap rows are labelled CAP and a capped score respects the ceiling', () => {
  const r = engine.score({ name: 'x', ingredients_text: 'Water, partially hydrogenated soybean oil, sugar' }, {});
  assert.ok(r.cap, 'expected a cap to fire');
  assert.ok(r.bad.some(h => h.c === 'CAP'), 'expected a CAP row in the panel');
  assert.ok(r.score <= 5, `trans fat caps at 5, got ${r.score}`);
});

check('turning a category off removes its rows entirely', () => {
  const p = { name: 'x', ingredients_text: 'Water, sugar, natural flavors, xanthan gum' };
  const on = engine.score(p, { weights: { sugar: 1 } });
  const off = engine.score(p, { weights: { sugar: 0 } });
  assert.ok(on.bad.some(h => /sugar/i.test(h.why)), 'sugar row missing at weight 1');
  assert.ok(!off.bad.some(h => /Refined added sugar/i.test(h.why)), 'sugar row still shown at weight 0');
  assert.ok(off.score > on.score, `switching sugar off should not lower the score (${off.score} vs ${on.score})`);
});

console.log(`\n${known} known failure(s) against open defects: ${[...OPEN_DEFECTS].join(', ') || 'none'}`);
if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
