'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../src/engine/score.js');
require('../src/stores/registry.js');
const S = require('../src/engine/db/shopping.js');
test('saved inputs preserve vertical labels, nutrition and sourcing for score replay', () => {
  const input = { name: 'Oats', ingredients_text: 'oats\nwater\nsalt\nsugar', nutrition: { protein: 9, servingGrams: 100 }, provenanceRecord: { certifications: 'USDA Organic', source: 'page' } };
  const clean = S.cleanInput(input);
  assert.equal(clean.ingredients_text, input.ingredients_text);
  assert.equal(engine.score(clean).score, engine.score(input).score);
  assert.equal(S.cleanInput({ ingredients_text: '' }), null);
  const markup = { ingredients_text: 'oats<br>water<br>salt<br>sugar' };
  assert.equal(engine.score(S.cleanInput(markup)).score, engine.score(markup).score);
  assert.equal(S.cleanInput({ ingredients_text: 'oats,'.repeat(1300) }), null);
});
test('budget, score and evidence constraints run independently, keeping unknown amounts distinct', () => {
  const evidence = S.evidence(engine.score({ ingredients_text: 'oats' }, { weights: { protein: 1 } }), { source: 'page' });
  const product = { score: 98, listingPrice: 4, evidence };
  assert.equal(S.matches(product, { maxPrice: 3 }), false);
  assert.equal(S.matches({ ...product, listingPrice: null }, { maxPrice: 5 }), false);
  assert.equal(S.matches(product, { minScore: 99 }), false);
  assert.equal(S.matches(product, { complete: true }), false);
  assert.equal(S.matches(product, { maxPrice: 4, minScore: 98 }), true);
  assert.equal(S.matches({ score: 0 }, { minScore: 0 }), true);
  assert.equal(S.matches({ score: null }, { minScore: 0 }), false);
});
test('warning filters exclude detected matches and treat unknown or partial checks explicitly', () => {
  const assessed = S.evidence(engine.score({ ingredients_text: 'oats' }, { allergens: ['milk'] }));
  assert.equal(S.matches({ evidence: assessed }, { noMatches: true }), true);
  assert.equal(S.matches({}, { noMatches: true }), false);
  assert.equal(S.matches({}, { noMatches: true, unknown: 'include' }), true);
  assert.equal(S.matches({ evidence: { ...assessed, coverage: 0.5 } }, { noMatches: true }), false);
  const match = S.evidence(engine.score({ ingredients_text: 'oats, milk' }, { allergens: ['milk'] }));
  assert.equal(S.matches({ evidence: match }, { noMatches: true, unknown: 'include' }), false);
  assert.equal(S.matches({ evidence: { ...match, coverage: 0.5 } }, { noMatches: true, unknown: 'include' }), false);
});
test('allergen evidence distinguishes ingredients, declarations and mixed cross-contact advisories without changing points', () => {
  const input = { ingredients_text: 'oats, milk', advisory_text: 'Contains soy. May contain peanuts.' };
  const result = engine.score(input, { allergens: ['milk', 'soy', 'peanut'] });
  assert.deepEqual(result.flags.map(f => [f.id, f.evidence]), [['milk', 'ingredient'], ['peanut', 'cross-contact'], ['soy', 'contains']]);
  assert.equal(result.score, engine.score(input).score);
  assert.match(result.flags.find(f => f.id === 'peanut').evidenceText, /may contain peanuts/i);
  const noMilk = engine.score({ ingredients_text: 'oats', advisory_text: 'May contain milk.' }, { allergens: ['milk'] });
  assert.equal(noMilk.flags[0].evidence, 'cross-contact');
});
test('saved records reject invalid IDs and untrusted links and remove retailer tracking parameters', () => {
  const raw = { id: 'product:amazon.com:B000000001', name: 'Oats', input: { ingredients_text: 'oats' }, url: 'https://www.amazon.com/dp/B000000001/ref=order?private=1#tracking' };
  assert.equal(S.cleanSaved(raw).url, 'https://www.amazon.com/dp/B000000001');
  for (const url of ['javascript:alert(1)', 'https://www.amazon.com.evil.example/dp/B000000001', 'https://user:pass@www.amazon.com/dp/B000000001']) assert.equal(S.cleanSaved({ ...raw, url }).url, '');
  assert.equal(S.cleanSaved({ ...raw, id: '__proto__' }), null);
  assert.equal(S.cleanSaved(raw).capturedAt, null);
});
test('changing warning choices makes cached warning matches unknown until assessed again', () => {
  const previous = { allergens: ['milk'], avoidList: [] }, current = { allergens: ['soy'], avoidList: ['palm oil'] };
  const ev = S.evidence(engine.score({ ingredients_text: 'oats, milk' }, previous), { prefs: previous });
  const product = { evidence: ev }, profile = S.warningProfile(current);
  assert.equal(S.matches(product, { noMatches: true, warningProfile: profile }), false);
  assert.equal(S.matches(product, { noMatches: true, warningProfile: profile, unknown: 'include' }), true);
  const updated = S.evidence(engine.score({ ingredients_text: 'oats, milk' }, current), { prefs: current });
  assert.equal(S.matches({ evidence: updated }, { noMatches: true, warningProfile: profile }), true);
  assert.equal(S.cleanEvidence(updated).warningProfile, profile);
  assert.equal(S.warningProfile({ allergens: ['soy', 'milk', 'milk'] }), S.warningProfile({ allergens: ['milk', 'soy'] }));
});
test('durable shortlist entries are separate from caches and history, and concurrent product saves do not overwrite each other', async () => {
  const data = { purchaseHistory: ['private'], 's:amazon.com:B000000001': { score: 98 } }, reads = [];
  const area = { getKeys: async () => Object.keys(data), get: async keys => { reads.push(keys); return Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])); }, set: async rows => Object.assign(data, rows) };
  const raw = { id: 'product:amazon.com:B000000001', input: { ingredients_text: 'oats' }, list: 'Breakfast' };
  await Promise.all([S.save(area, raw), S.save(area, { ...raw, id: 'product:amazon.com:B000000002' })]);
  delete data['s:amazon.com:B000000001'];
  assert.equal((await S.list(area)).length, 2);
  assert.ok(reads.every(keys => keys.every(k => k.startsWith(S.PREFIX))));
  assert.deepEqual(data.purchaseHistory, ['private']);
});
test('only the own label-checker page gains explicit barcode lookup, without account/import privileges', () => {
  const context = vm.createContext({ URL, Set, chrome: { runtime: { id: 'ours', getURL: path => 'chrome-extension://ours/' + path } } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/worker/messages.js'), 'utf8'), context);
  const sender = { id: 'ours', url: 'chrome-extension://ours/src/options/library.html?a=example' };
  assert.equal(context.allowMessage({ type: 'lookupBarcode' }, sender), true);
  for (const type of ['purchaseImport', 'productsQueue', 'accountSave', 'ocrLabels']) assert.equal(context.allowMessage({ type }, sender), false);
  assert.equal(context.allowMessage({ type: 'lookupBarcode' }, { ...sender, url: 'https://example.com/src/options/library.html' }), false);
});
