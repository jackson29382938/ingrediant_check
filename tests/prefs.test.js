// Settings sanitizer. Run: node tests/prefs.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
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

console.log('\ndefault sheet');
check('a missing sheet URL becomes the shared spreadsheet', () => {
  assert.strictEqual(prefs.DEFAULT_SHEET_ID, '1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y');
  for (const raw of [undefined, null, {}, { enabled: true }]) {
    assert.strictEqual(prefs.sanitizeUrls(raw).sheetUrl, prefs.DEFAULT_SHEET_URL);
    assert.strictEqual(prefs.resolveSheetUrl(raw), prefs.DEFAULT_SHEET_URL);
  }
  const csv = prefs.toSheetUrl(prefs.DEFAULT_SHEET_URL);
  assert.ok(csv.includes(prefs.DEFAULT_SHEET_ID));
  assert.ok(csv.includes('tqx=out:csv'));
});
check('an explicit empty sheet URL stays empty', () => {
  assert.strictEqual(prefs.sanitizeUrls({ sheetUrl: '' }).sheetUrl, '');
  assert.strictEqual(prefs.sanitizeUrls({ sheetUrl: '   ' }).sheetUrl, '');
  assert.strictEqual(prefs.resolveSheetUrl(''), '');
  assert.strictEqual(prefs.toSettingsSheetUrl(''), null);
  assert.strictEqual(prefs.sanitizeUrls({}).contributeUrl, '');
});
check('the settings tab URL names the settings sheet and drops gid', () => {
  const named = new URL(prefs.toSettingsSheetUrl(prefs.DEFAULT_SHEET_URL));
  assert.strictEqual(named.searchParams.get('sheet'), 'settings');
  assert.strictEqual(named.searchParams.get('gid'), null);
  assert.ok(named.pathname.includes(prefs.DEFAULT_SHEET_ID));
  const published = prefs.toSettingsSheetUrl(
    'https://docs.google.com/spreadsheets/d/e/2PACXabcdefghijklmnopqrstuvwxyz/pubhtml?gid=42');
  const pub = new URL(published);
  assert.strictEqual(pub.searchParams.get('sheet'), 'settings');
  assert.strictEqual(pub.searchParams.get('gid'), null);
});

console.log('\nsettings sync');
check('the save body is the sanitized export and nothing else', () => {
  const body = prefs.settingsSaveBody({
    weights: { sugar: 1.2, notACategory: 9 },
    allergens: ['milk', 'nope'],
    diets: [],
    avoidList: ['carrageenan'],
    foodOnly: false,
    contributeUrl: 'https://script.google.com/macros/s/AKfycbyabcdefghijklmnopqrstuvwxyz012345/exec',
    sheetUrl: 'https://evil.example/secret',
    email: 'person@example.com',
    diagQueue: [{ secret: true }],
  }, new Date('2026-09-22T00:00:00.000Z'));
  assert.deepStrictEqual(Object.keys(body).sort(), ['kind', 'payload', 'ts']);
  assert.strictEqual(body.kind, 'settings');
  assert.strictEqual(body.ts, '2026-09-22T00:00:00.000Z');
  assert.strictEqual(body.payload._format, prefs.SETTINGS_FORMAT);
  assert.strictEqual(body.payload.weights.sugar, 1.2);
  assert.ok(!('notACategory' in body.payload.weights));
  assert.deepStrictEqual(body.payload.allergens, ['milk']);
  assert.strictEqual(body.payload.foodOnly, false);
  for (const key of ['contributeUrl', 'sheetUrl', 'email', 'diagQueue']) {
    assert.ok(!(key in body), key);
    assert.ok(!(key in body.payload), key);
  }
  const again = prefs.parseSettingsExport(body);
  assert.ok(again.ok);
  assert.strictEqual(again.prefs.weights.sugar, 1.2);
  assert.ok(!('email' in again.prefs));
});
check('a settings-tab CSV and a GET body both re-sanitize', () => {
  const body = prefs.settingsSaveBody({
    weights: { sugar: 0.4 }, allergens: ['peanut'], foodOnly: false,
  }, new Date('2026-01-02T03:04:05.000Z'));
  const dirty = { ...body.payload, email: 'person@example.com', contributeUrl: 'https://evil.example' };
  const csv = 'key,value,ts\npayload,"' + JSON.stringify(dirty).replace(/"/g, '""') + '",' + body.ts + '\n';
  const fromCsv = prefs.parseSettingsExport(csv);
  assert.ok(fromCsv.ok);
  assert.strictEqual(fromCsv.prefs.weights.sugar, 0.4);
  assert.deepStrictEqual(fromCsv.prefs.allergens, ['peanut']);
  assert.strictEqual(fromCsv.prefs.foodOnly, false);
  assert.ok(!('email' in fromCsv.prefs));
  const fromGet = prefs.parseSettingsExport({ ok: true, kind: 'settings', payload: dirty, ts: body.ts });
  assert.ok(fromGet.ok);
  assert.ok(!('contributeUrl' in fromGet.prefs));
  assert.strictEqual(prefs.parseSettingsExport('asin,certifications\nB00,Organic\n').reason, 'no-settings');
  assert.strictEqual(prefs.parseSettingsExport({ ok: true, payload: null }).reason, 'no-settings');
  assert.strictEqual(prefs.parseSettingsExport('<html>ServiceLogin</html>').reason, 'sheet-private');
});
check('apps-script.gs accepts a settings upsert and can serve it', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'apps-script.gs'), 'utf8');
  assert.ok(gs.includes("body.kind === 'settings'"), 'POST must branch on settings');
  assert.ok(gs.includes("kind === 'settings'"), 'GET must branch on settings');
  assert.ok(gs.includes("var SETTINGS_COLUMNS = ['key', 'value', 'ts']"));
  assert.ok(gs.includes('ingredient-check-settings'));
  const diag = gs.match(/var DIAGNOSTIC_COLUMNS = (\[[\s\S]*?\]);/);
  assert.ok(diag, 'diagnostic columns must stay parseable');
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
