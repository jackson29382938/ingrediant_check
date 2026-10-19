'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const E = require('../src/engine/score.js');
const PC = require('../src/engine/db/product-cache.js');
const H = require('../src/engine/db/purchase-history.js');
const A = require('../src/engine/db/purchase-analytics.js');
const P = require('../src/content/panel.js');

test('review reproductions now satisfy the corrected extraction, product and Orders contracts', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '../docs/review-verification-2026-10-18.cjs')], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).probes, 11);
});

test('nested codes retain parents, optional E prefixes and decimal ingredient shares', () => {
  const text = codes => `chocolate (sugar 8,5%, cocoa butter, emulsifiers (${codes}))`;
  const a = E.score({ ingredients_text: text('322,471') });
  const b = E.score({ ingredients_text: text('E322, E471') });
  assert.equal(a.score, b.score);
  assert.equal(a.nova, b.nova);
  const entries = E.parseEntries(text('322, 471'));
  const emulsifier = entries.find(e => e.ing === 'emulsifiers');
  assert.equal(entries.find(e => e.ing === 'e471').parent, emulsifier.fam);
  assert.equal(entries.find(e => e.ing === 'e322').parent, emulsifier.fam);
});

test('long and depth-limited entries cannot produce a readable partial score', () => {
  for (const ingredients_text of ['oats, sunflower oil ' + 'processed '.repeat(8), 'oats (a (b (c (d (e (red 40))))))']) {
    const r = E.score({ ingredients_text });
    assert.equal(r.readable, false);
    assert.equal(E.isReadable(r), false);
    assert.ok(r.parseWarnings.length);
  }
});

test('known date varieties are recognized without relying on an organic claim', () => {
  for (const variety of ['medjool dates', 'deglet noor dates']) {
    assert.equal(E.score({ ingredients_text: variety }).readable, true);
    assert.equal(E.score({ ingredients_text: 'organic ' + variety }).coverage, 1);
  }
});

test('organic sourcing applies to the leading animal food and is never rewarded twice', () => {
  const score = ingredients_text => E.score({ ingredients_text });
  const a = score('beef, salt, pepper, garlic, onion');
  const b = score('beef, salt, pepper, garlic, organic onion');
  assert.equal(a.provenance.unknownCost, b.provenance.unknownCost);
  assert.ok(!b.provenance.claims.some(c => c.id === 'organicClaim'));
  const own = score('organic beef, salt, pepper, garlic, onion');
  assert.equal(own.good.filter(r => r.organic).length, 1);
});

test('nutrition quantities use explicit bases and reject contradictory mass compositions', () => {
  const product = { ingredients_text: 'oats' }, options = { weights: { sodium: 1, protein: 1 } };
  const at = servingGrams => E.score({ ...product, nutrition: { servingGrams, sodium: servingGrams * 4, protein: servingGrams * 0.1 } }, options);
  assert.equal(at(30).score, at(60).score);
  const missing = E.score({ ...product, nutrition: { sodium: 400 } }, options);
  assert.ok(missing.nutritionAssessment.every(f => f.status === 'unavailable'));
  assert.match(P.render(missing, { title: 'oats' }), /Not assessed:.*Sodium/);
  const bad = E.score({ ...product, nutrition: { servingGrams: 100, saturatedFat: 90, carbs: 90, protein: 10 } }, options);
  assert.ok(bad.nutritionAssessment.every(f => f.status === 'invalid'));
  const good = E.normaliseNutrition({ servingGrams: 100, fat: 10, saturatedFat: 5, carbs: 50, sugar: 20, fibre: 10, protein: 10 });
  assert.equal(good.basis, 'per 100g'); // Fibre/sugar are not independent macronutrients.
  assert.equal(E.normaliseNutrition({ servingMl: 100, sugar: 110 }).basis, 'per 100ml');
});

test('certification snapshots survive cache and history round trips without aliasing', () => {
  const input = { inputSchema: 1, ingredients_text: 'beef', provenanceRecord: {
    certifications: 'USDA Organic', source: 'owner registry', producerRegistry: { certifications: 'American Grassfed Association certified' }, token: 'discard' } };
  const row = PC.fromScan({ store: 'amazon.com', asin: 'B000000001', input });
  const saved = H.cleanInput(PC.toInput(row));
  assert.equal(E.score(saved).score, E.score(input).score);
  assert.equal(saved.provenanceRecord.token, undefined);
  saved.provenanceRecord.producerRegistry.certifications = '';
  assert.ok(row.data.provenanceRecord.producerRegistry.certifications);
  const modern = A.project({ input: H.cleanInput(input), score: E.score(input).score }, 'current', E.score);
  assert.equal(modern.partial, false);
  const legacy = A.project({ input: { ingredients_text: 'beef' }, score: 99 }, 'current', E.score);
  assert.equal(legacy.partial, true);
  delete row.data.inputSchema;
  assert.equal(PC.stale(row), true);
});

test('fallback nutrition retains explicit volume/mass basis and converts sodium grams to mg', () => {
  const p = { nutrition_data_per: '100ml', nutriments: { sodium_100g: 0.12, proteins_100g: 4 } };
  assert.deepEqual(PC.nutritionFromOff(p), { servingMl: 100, sodium: 120, protein: 4 });
  assert.equal(PC.nutritionFromOff({ ...p, nutrition_data_per: 'serving' }), null);
  assert.equal(PC.nutritionFromOff({ nutriments: p.nutriments }), null);
});

test('displayed dimensions add up under all presets without rewriting the score', () => {
  const cats = require('../src/engine/categories.js');
  for (const preset of Object.values(cats.PRESETS)) {
    const r = E.score({ ingredients_text: 'beef, salt, pepper, garlic, onion', certifications: 'USDA Organic', nutrition: { servingGrams: 100, protein: 20, sodium: 300 } }, { weights: preset.weights });
    assert.equal(Object.values(r.dimensions).reduce((a, b) => a + b, 0), r.score);
  }
});
