// Diagnostic rows. Run: node tests/diagnostics.test.js
//
// These rows exist to answer "is the score right", so the properties that matter are: the evidence
// travels with the answer, nothing about the person travels at all, and one row is one sheet line
// no matter what a product page throws at it.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);
const fs = require('fs');

require(src('engine/db/_module.js'));
const diagnostics = require(src('engine/db/diagnostics.js'));
const categories = require(src('engine/categories.js'));
const engine = require(src('engine/score.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

const TEXT = 'Pasteurized lowfat milk, nonfat milk, cane sugar, pectin, natural strawberry flavor, '
  + 'natural flavors, vitamin a palmitate, vitamin d3';
const DATA = { asin: 'B00LOAW7U6', upc: '017077103329', brand: 'Lifeway',
  title: 'Lifeway Low Fat Kefir Strawberry 32oz', via: 'label-ocr', confidence: 0.7,
  text: TEXT, ingestible: { reason: 'Food evidence present' } };
const build = (over = {}) => {
  const result = engine.score({ name: DATA.title, ingredients_text: TEXT }, {});
  return diagnostics.buildRecord(DATA, result, {
    version: '0.9.0', store: 'amazon.com', source: 'label-ocr', text: TEXT,
    weights: { ...categories.DEFAULT_WEIGHTS, sugar: 1.5 },
    defaultWeights: categories.DEFAULT_WEIGHTS, ...over,
  });
};

console.log('the evidence travels with the answer');
check('the scored text is on the row', () => {
  assert.ok(/cane sugar/i.test(build().ingredients), 'ingredient text missing — the row cannot diagnose anything');
});
check('the rules that fired are on the row', () => {
  const r = build();
  assert.ok(/Cane sugar|Refined added sugar/i.test(r.penalties), `penalties column: ${r.penalties}`);
  assert.ok(r.score && r.verdict && r.nova, 'the outcome is incomplete');
});
check('which path produced the text is recorded', () => {
  assert.strictEqual(build().source, 'label-ocr');
  assert.strictEqual(build({ source: 'open-food-facts' }).source, 'open-food-facts');
});
check('only non-default weights are recorded, so a row is reproducible', () => {
  assert.strictEqual(build().weights, 'sugar=1.5');
  assert.strictEqual(build({ weights: categories.DEFAULT_WEIGHTS }).weights, '');
});

console.log('\nnothing about the person is on the row');
check('no identifiers beyond the product', () => {
  const keys = Object.keys(build());
  const forbidden = keys.filter(k => /user|session|client|account|email|ip\b|cookie|history|device/i.test(k));
  assert.strictEqual(forbidden.length, 0, `identity-ish columns: ${forbidden.join(', ')}`);
});
check('the row has exactly the declared columns', () => {
  // A stray field would silently shift every column in the sheet.
  assert.deepStrictEqual(Object.keys(build()).sort(), [...diagnostics.COLUMNS].sort());
});

console.log('\none row survives whatever a page throws at it');
check('missing data does not throw or produce undefined cells', () => {
  const r = diagnostics.buildRecord(null, null, {});
  assert.deepStrictEqual(Object.keys(r).sort(), [...diagnostics.COLUMNS].sort());
  for (const [k, v] of Object.entries(r)) {
    assert.ok(v === '' || typeof v === 'string' || typeof v === 'number', `${k} is ${typeof v}`);
    assert.ok(!/undefined|\[object/.test(String(v)), `${k} leaked a raw value: ${v}`);
  }
});
check('long fields are bounded', () => {
  const huge = 'sugar, '.repeat(4000);
  const result = engine.score({ name: 'x', ingredients_text: huge }, {});
  const r = diagnostics.buildRecord({ title: 'y'.repeat(5000), text: huge }, result,
    { text: huge, weights: categories.DEFAULT_WEIGHTS, defaultWeights: categories.DEFAULT_WEIGHTS });
  assert.ok(r.ingredients.length <= 1200, `ingredients ${r.ingredients.length} chars`);
  assert.ok(r.product_name.length <= 200, `product_name ${r.product_name.length} chars`);
  assert.ok(r.penalties.length <= 900, `penalties ${r.penalties.length} chars`);
});
check('newlines never break the row', () => {
  const r = diagnostics.buildRecord({ title: 'a\nb\tc', text: 'milk,\nsugar' },
    engine.score({ name: 'x', ingredients_text: 'milk, sugar' }, {}), { text: 'milk,\nsugar' });
  for (const [k, v] of Object.entries(r)) {
    assert.ok(!/[\n\r\t]/.test(String(v)), `${k} contains a line break`);
  }
});

console.log('\nthe sheet and the extension agree on the columns');
check('apps-script.gs declares the same columns in the same order', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'apps-script.gs'), 'utf8');
  const m = gs.match(/var DIAGNOSTIC_COLUMNS = (\[[\s\S]*?\]);/);
  assert.ok(m, 'DIAGNOSTIC_COLUMNS not found in docs/apps-script.gs');
  assert.deepStrictEqual(JSON.parse(m[1]), diagnostics.COLUMNS,
    'the sheet would put values under the wrong headers');
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
