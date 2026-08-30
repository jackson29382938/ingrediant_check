// Calibration corpus. Run: node tests/corpus.test.js
//
// Pins ~40 products to score BANDS rather than exact numbers, so the engine can be recalibrated
// deliberately but cannot drift silently. This is the harness whose absence let the negation,
// unknown-text and dead-oil-rule defects survive.
//
// OPEN_DEFECTS lists bugs that are known and not yet fixed. Their corpus entries encode the
// CORRECT answer, so they are expected to fail; the runner reports them separately and does not
// count them against the suite. Delete an id from OPEN_DEFECTS as it is fixed and the entry
// becomes a hard assertion from then on.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));
const corpus = require('./corpus.json');

const OPEN_DEFECTS = new Set([]);

let failed = 0, known = 0, fixed = [];

function bandCheck(entry) {
  const r = engine.score(entry.product, {});
  const [lo, hi] = entry.band;
  return { r, ok: r.score >= lo && r.score <= hi,
    msg: `${entry.id}: scored ${r.score} (${r.verdict}), expected ${lo}-${hi}` };
}

console.log('corpus — calibration bands');
for (const entry of corpus.products) {
  const { ok, msg } = bandCheck(entry);
  if (ok) { console.log('  ok  ' + msg); }
  else { failed++; console.error('  FAIL ' + msg + (entry.note ? '\n       ' + entry.note : '')); }
}

console.log('\ncorpus — defect cases');
for (const entry of corpus.defects) {
  const open = entry.defect && OPEN_DEFECTS.has(entry.defect);
  const { ok, msg } = bandCheck(entry);
  if (ok && open) { fixed.push(entry); console.log('  FIXED? ' + msg + `\n       "${entry.defect}" now passes — remove it from OPEN_DEFECTS to lock it in.`); }
  else if (ok) { console.log('  ok  ' + msg); }
  else if (open) { known++; console.log('  known-fail  ' + msg + `  [${entry.defect}]`); }
  else { failed++; console.error('  FAIL ' + msg + (entry.note ? '\n       ' + entry.note : '')); }
}

console.log('\ncorpus — recognition coverage');
// The gate that stops unreadable text from being scored. Entries carrying an explicit expectation
// assert it; everything else must clear the threshold content/main.js uses, or the tool would go
// silent on a product it can actually read.
const MIN_COVERAGE = 0.34;
for (const entry of [...corpus.products, ...corpus.defects]) {
  const { coverage } = engine.score(entry.product, {});
  const pct = (coverage * 100).toFixed(0) + '%';
  if (typeof entry.maxCoverage === 'number') {
    if (coverage < entry.maxCoverage) console.log(`  ok  ${entry.id}: ${pct} — correctly unreadable`);
    else { failed++; console.error(`  FAIL ${entry.id}: ${pct} coverage, expected below ${entry.maxCoverage}`); }
  } else if (typeof entry.minCoverage === 'number') {
    if (coverage >= entry.minCoverage) console.log(`  ok  ${entry.id}: ${pct} — readable, so it gets scored`);
    else { failed++; console.error(`  FAIL ${entry.id}: ${pct} coverage, expected at least ${entry.minCoverage}`); }
  } else if (coverage >= MIN_COVERAGE) {
    console.log(`  ok  ${entry.id}: ${pct}`);
  } else {
    failed++;
    console.error(`  FAIL ${entry.id}: ${pct} coverage — a real product would be suppressed as unreadable`);
  }
}

// Cross-checks that state the defect as a relationship rather than an absolute number. These are
// the assertions that actually encode the bug, and they survive any recalibration of the bands.
console.log('\ncorpus — invariants between paired products');
function pair(name, aId, bId, cmp, why) {
  const find = id => [...corpus.products, ...corpus.defects].find(e => e.id === id);
  const A = engine.score(find(aId).product, {}), B = engine.score(find(bId).product, {});
  const entry = find(aId);
  const open = entry.defect && OPEN_DEFECTS.has(entry.defect);
  const ok = cmp(A.score, B.score);
  const msg = `${name}: ${aId}=${A.score} vs ${bId}=${B.score} — ${why}`;
  if (ok) console.log('  ok  ' + msg);
  else if (open) { known++; console.log('  known-fail  ' + msg + `  [${entry.defect}]`); }
  else { failed++; console.error('  FAIL ' + msg); }
}

pair('negation must not launder a capped oil', 'non-gmo-soybean-oil', 'english-junk-panel',
  (a) => a <= 30, 'a Non-GMO seed oil must still trip the refined-oil cap');
pair('language must not change the verdict', 'spanish-junk-panel', 'english-junk-panel',
  (a, b) => Math.abs(a - b) <= 15, 'the same product in two languages must score alike');
pair('unrefined oil must beat refined', 'cold-pressed-sunflower-oil', 'refined-sunflower-oil',
  (a, b) => a > b, 'oils.UNREFINED is meant to soften the cap');
pair('audited beef must beat silent commodity beef', 'aga-grassfed-beef', 'commodity-ground-beef',
  (a, b) => a > b, 'certifications are where the real variation lives');
pair('clean chips must beat seed-oil chips', 'potato-chips-avocado-oil', 'potato-chips-plain',
  (a, b) => a > b, 'avocado oil vs safflower oil is the whole difference');

if (fixed.length) {
  console.log(`\n${fixed.length} defect case(s) now pass — update OPEN_DEFECTS.`);
}
console.log(`\n${known} known failure(s) against open defects: ${[...OPEN_DEFECTS].join(', ') || 'none'}`);
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
