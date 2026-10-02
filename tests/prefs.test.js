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
  assert.strictEqual(clean.autoScoreSearch, false, 'search-page fetches are opt-in');
  assert.strictEqual(clean.hoverBreakdown, true);
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

console.log('\nendpoint');
check('only an Apps Script /exec URL is ever used as the endpoint', () => {
  const id = 'AKfycbyabcdefghijklmnopqrstuvwxyz012345';
  assert.strictEqual(prefs.toScriptUrl(`https://script.google.com/macros/s/${id}/exec?foo=1`),
    `https://script.google.com/macros/s/${id}/exec`);
  assert.strictEqual(prefs.toScriptUrl('https://example.test/exec'), null);
  assert.strictEqual(prefs.toScriptUrl(`https://script.google.com/macros/s/${id}/dev`), null);
  const saved = prefs.ENDPOINT;
  try {
    prefs.ENDPOINT = 'https://example.test/exec';
    assert.strictEqual(prefs.endpoint(), '');
    prefs.ENDPOINT = `https://script.google.com/macros/s/${id}/exec`;
    assert.strictEqual(prefs.endpoint(), `https://script.google.com/macros/s/${id}/exec`);
  } finally { prefs.ENDPOINT = saved; }
});
check('the build ships with no invented endpoint or OAuth client', () => {
  // Filled in only after docs/apps-script.gs is deployed (docs/SETTINGS-SYNC.md).
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'db', 'prefs.js'), 'utf8');
  const endpoint = src.match(/const ENDPOINT = '([^']*)';/)[1];
  assert.ok(endpoint === '' || prefs.toScriptUrl(endpoint), 'ENDPOINT must be empty or a real /exec URL');
});
check('Chrome backup defaults on; the shared database and sharing extras default off', () => {
  const t = prefs.sanitizeToggles({});
  assert.strictEqual(t.sharedCache, false);
  assert.strictEqual(t.settingsBackup, true);
  assert.strictEqual(t.shareContributions, false);
  assert.strictEqual(t.sendDiagnostics, false);
});

console.log('\nbackup');
check('a backup is the sanitized export plus toggles, never the master switch or stray keys', () => {
  const b = prefs.backupPayload({
    weights: { sugar: 1.2, notACategory: 9 }, allergens: ['milk', 'nope'], avoidList: ['carrageenan'],
    foodOnly: false, hoverScore: true, enabled: false, contributeUrl: 'https://evil.example',
    email: 'person@example.com', diagQueue: [{ secret: true }],
  }, new Date('2026-09-23T00:00:00.000Z'));
  assert.strictEqual(b._format, prefs.SETTINGS_FORMAT);
  assert.strictEqual(b.ts, '2026-09-23T00:00:00.000Z');
  assert.strictEqual(b.weights.sugar, 1.2);
  assert.ok(!('notACategory' in b.weights));
  assert.deepStrictEqual(b.allergens, ['milk']);
  assert.strictEqual(b.toggles.hoverScore, true);
  assert.ok(!('enabled' in b.toggles));
  for (const k of ['contributeUrl', 'email', 'diagQueue', 'enabled']) assert.ok(!(k in b), k);
});
check('a backup round-trips through chrome.storage.sync items and is re-sanitized on the way in', () => {
  const b = prefs.backupPayload({ weights: { sugar: 0.4 }, avoidList: Array.from({ length: 80 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(78)) });
  const items = prefs.toSyncItems(b);
  assert.ok(Object.keys(items).every(k => prefs.SYNC_KEYS.includes(k)));
  assert.ok(items.icBackup._syncVersion === 2);
  for (const v of Object.values(items)) assert.ok(JSON.stringify(v).length < 8192, 'each item fits the 8 KB cap');
  const back = prefs.fromSyncItems(items);
  assert.ok(back.ok);
  assert.strictEqual(back.values.weights.sugar, 0.4);
  assert.strictEqual(back.values.avoidList.length, 80);
  assert.ok(!('enabled' in back.values));
  const dirty = prefs.parseBackup({ ...b, weights: { sugar: 9 }, toggles: { enabled: false, badges: 'no' } });
  assert.strictEqual(dirty.values.weights.sugar, 2);
  assert.strictEqual(dirty.values.badges, true);
  assert.ok(!('enabled' in dirty.values));
  assert.strictEqual(prefs.fromSyncItems({}).ok, false);
  assert.strictEqual(prefs.parseBackup({ foo: 1 }).ok, false);
});
check('apps-script.gs knows every kind the extension sends', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'apps-script.gs'), 'utf8');
  for (const kind of ['lookup', 'products', 'account', 'accountGet', 'diagnostics', 'report']) {
    assert.ok(gs.includes(`body.kind === '${kind}'`), kind);
  }
  assert.ok(gs.includes("kind === 'provenance'"), 'GET must serve provenance');
  assert.ok(!/kind === 'settings'|kind === 'ratings'/.test(gs), 'the shared one-row settings and ratings kinds are gone');
  assert.ok(gs.match(/var DIAGNOSTIC_COLUMNS = (\[[\s\S]*?\]);/), 'diagnostic columns must stay parseable');
});



check('Unicode backups fit byte quotas, retain every term, and detect incomplete sync', () => {
  const avoidList = Array.from({ length: 80 }, (_, i) => String(i).padEnd(80, '漢'));
  const payload = prefs.backupPayload({ avoidList, speedMode: 'freshest', sortCount: 500,
    sortMissing: 'leave', sortLoadMore: true, unitMissing: 'displayed-only' });
  const items = prefs.toSyncItems(payload, 'b');
  for (const [key, value] of Object.entries(items)) {
    assert.ok(Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)) < 8192);
  }
  const restored = prefs.fromSyncItems(items);
  assert.deepStrictEqual(restored.values.avoidList, avoidList);
  assert.strictEqual(restored.values.speedMode, 'freshest');
  assert.strictEqual(restored.values.sortCount, 500);
  assert.strictEqual(restored.values.sortLoadMore, true);
  assert.strictEqual(restored.values.unitMissing, 'displayed-only');
  const intact = items.icBackupAvoid_b_0;
  items.icBackupAvoid_b_0 = ['stale part from another device'];
  assert.strictEqual(prefs.fromSyncItems(items).reason, 'incomplete-backup');
  items.icBackupAvoid_b_0 = intact;
  delete items.icBackupAvoid_b_0;
  assert.strictEqual(prefs.fromSyncItems(items).reason, 'incomplete-backup');
});
check('legacy backups restore and leave unspecified workflow preferences untouched', () => {
  const legacy = prefs.exportPayload({ avoidList: ['milk'], goals: ['weightLoss'] });
  const restored = prefs.fromSyncItems({ icBackup: legacy, icBackupAvoid: ['milk'] });
  assert.ok(restored.ok);
  assert.deepStrictEqual(restored.values.avoidList, ['milk']);
  assert.ok(!Object.hasOwn(restored.values, 'speedMode'));
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
