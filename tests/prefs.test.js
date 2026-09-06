// Settings sanitizer. Run: node tests/prefs.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
require(src('engine/db/allergens.js'));
require(src('engine/categories.js'));
const prefs = require(src('engine/db/prefs.js'));
const categories = require(src('engine/categories.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

console.log('toggles');
check('unknown and non-boolean values fall back to defaults', () => {
  const clean = prefs.sanitizeToggles({ enabled: 'yes', badges: 0, ocrLabels: true, extra: true });
  assert.strictEqual(clean.enabled, true);
  assert.strictEqual(clean.badges, true);
  assert.strictEqual(clean.ocrLabels, true);
  assert.strictEqual(clean.autoScoreSearch, false);
  assert.ok(!('extra' in clean));
});
check('false is kept for on-by-default keys', () => {
  assert.strictEqual(prefs.sanitizeToggles({ enabled: false, foodOnly: false }).enabled, false);
  assert.strictEqual(prefs.sanitizeToggles({ enabled: false, foodOnly: false }).foodOnly, false);
});

console.log('\nscoring');
check('weights are clamped and unknown ids dropped', () => {
  const clean = prefs.sanitizeScoring({
    weights: { sugar: 9, notACategory: 2, flavour: -1 },
    allergens: ['sesame', 'unicorn', 'sesame', 12],
    diets: ['vegan', 'carnivore'],
    avoidList: ['  Red 40  ', 'x', 'red 40', 'a'.repeat(200), '', 3],
    foodOnly: 'no',
  });
  assert.strictEqual(clean.weights.sugar, 2);
  assert.strictEqual(clean.weights.flavour, 0);
  assert.ok(!('notACategory' in clean.weights));
  assert.deepStrictEqual(clean.allergens, ['sesame']);
  assert.deepStrictEqual(clean.diets, ['vegan']);
  assert.deepStrictEqual(clean.avoidList, ['Red 40', 'a'.repeat(prefs.AVOID_MAX_LEN)]);
  assert.strictEqual(clean.foodOnly, true);
});
check('avoid list is capped and de-duplicated', () => {
  const lines = Array.from({ length: 120 }, (_, i) => `term-${i}`);
  const clean = prefs.sanitizeAvoidList(lines);
  assert.strictEqual(clean.length, prefs.AVOID_MAX_LINES);
  assert.strictEqual(clean[0], 'term-0');
});
check('defaults fill a missing or garbage object', () => {
  const clean = prefs.sanitizeScoring(null);
  assert.deepStrictEqual(clean.weights, categories.DEFAULT_WEIGHTS);
  assert.deepStrictEqual(clean.allergens, []);
  assert.strictEqual(clean.foodOnly, true);
});

console.log('\nimport / export');
check('export is stamped and re-imports identically', () => {
  const payload = prefs.exportPayload({
    weights: { sugar: 1.5 }, allergens: ['milk'], diets: [], avoidList: ['carrageenan'], foodOnly: false,
  });
  assert.strictEqual(payload._format, prefs.SETTINGS_FORMAT);
  assert.strictEqual(payload._version, prefs.SETTINGS_VERSION);
  const again = prefs.parseImport(JSON.stringify(payload));
  assert.ok(again.ok);
  assert.strictEqual(again.prefs.weights.sugar, 1.5);
  assert.deepStrictEqual(again.prefs.allergens, ['milk']);
  assert.strictEqual(again.prefs.foodOnly, false);
});
check('a random JSON file is refused', () => {
  assert.strictEqual(prefs.parseImport('not json').reason, 'not-json');
  assert.strictEqual(prefs.parseImport('[]').reason, 'not-settings');
  assert.strictEqual(prefs.parseImport('{"foo":1}').reason, 'not-settings');
});
check('a legacy file without _format still imports if it looks like settings', () => {
  const got = prefs.parseImport(JSON.stringify({ weights: { sugar: 0 }, allergens: ['egg'] }));
  assert.ok(got.ok);
  assert.strictEqual(got.prefs.weights.sugar, 0);
  assert.deepStrictEqual(got.prefs.allergens, ['egg']);
});

console.log('\nurls');
check('sheet share links are accepted and other hosts are not', () => {
  assert.ok(prefs.toSheetUrl('https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit#gid=7'));
  assert.strictEqual(prefs.toSheetUrl('https://example.test/sheet'), null);
  assert.strictEqual(prefs.toSheetUrl('https://user:pass@docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit'), null);
  assert.strictEqual(prefs.sanitizeUrls({ sheetUrl: 'https://evil.example/x' }).sheetUrl, '');
});
check('only Apps Script exec URLs are kept as contribution endpoints', () => {
  const id = 'AKfycbyabcdefghijklmnopqrstuvwxyz012345';
  assert.strictEqual(
    prefs.toScriptUrl(`https://script.google.com/macros/s/${id}/exec?foo=1`),
    `https://script.google.com/macros/s/${id}/exec`);
  assert.strictEqual(prefs.toScriptUrl('https://example.test/exec'), null);
  assert.strictEqual(prefs.toScriptUrl(`https://script.google.com/macros/s/${id}/dev`), null);
  assert.strictEqual(prefs.sanitizeUrls({ contributeUrl: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit' }).contributeUrl, '');
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
