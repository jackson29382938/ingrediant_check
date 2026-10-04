'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDocument } = require('./pages/load.js');
const extract = require('../src/content/extract.js');

// Sanitized structural excerpt of the public B0005Z6FYA page, fetched 2026-10-04.
// The live summary omits the fat rows that are present in the expanded Facts table.
const card = `<section id="nutritionalInfoAndIngredients_feature_div">
<table><tr><td>160</td><td>170mg</td><td>1g</td><td>1g</td><td>2g</td></tr>
<tr><td>Calories</td><td>Sodium</td><td>Dietary Fiber</td><td>Sugars</td><td>Protein</td></tr></table>
<div id="nic-nutrition-summary-serving">8 servings per container | 15 chips (28g)</div>
<table><tr><td>Calories</td><td>160</td></tr>
<tr><td>13%</td><td><span>Total Fat</span><span>10g</span></td></tr>
<tr><td>7%</td><td><span>Saturated Fat</span><span>1.5g</span></td></tr>
<tr><td></td><td><span>Trans Fat</span><span>0g</span></td></tr>
<tr><td></td><td><span>Sodium</span><span>170mg</span></td></tr>
<tr><td>6%</td><td><span>Total Carbohydrate</span><span>15g</span></td></tr>
<tr><td>5%</td><td><span>Dietary Fiber</span><span>1g</span></td></tr>
<tr><td></td><td><span>Sugars</span><span>1g</span></td></tr>
<tr><td></td><td><span>Protein</span><span>2g</span></td></tr></table></section>`;

test('Amazon expanded Facts supplement the summary with fat, trans fat and carbohydrate', () => {
  const nutrition = extract.nutritionFacts(createDocument(card));
  assert.equal(nutrition.calories, 160);
  assert.equal(nutrition.sodium, 170);
  assert.equal(nutrition.fat, 10);
  assert.equal(nutrition.saturatedFat, 1.5);
  assert.equal(nutrition.transFat, 0);
  assert.equal(nutrition.carbs, 15);
  assert.equal(nutrition.fibre, 1);
  assert.equal(nutrition.protein, 2);
  assert.equal(nutrition.servingGrams, 28);
});

test('Amazon nutrition tables convert declared units and reject percent-only amounts', () => {
  const doc = createDocument(`<section class="nicDesktop"><table>
  <tr><td>0.4g</td><td>2500mg</td><td>12%</td></tr>
  <tr><td>Sodium</td><td>Protein</td><td>Total Fat</td></tr></table></section>`);
  const nutrition = extract.nutritionFacts(doc);
  assert.equal(nutrition.sodium, 400);
  assert.equal(nutrition.protein, 2.5);
  assert.equal(nutrition.fat, undefined);
});

test('Amazon full Facts table works when no summary table is published', () => {
  const doc = createDocument(`<section class="nicDesktop"><table>
  <tr><td>Calories</td><td>160</td></tr>
  <tr><td>7%</td><td>Saturated Fat1.5g</td></tr>
  <tr><td>13%</td><td>Total Fat10g</td></tr></table></section>`);
  assert.deepEqual(extract.nutritionFacts(doc), { calories: 160, saturatedFat: 1.5, fat: 10 });
});


test('a mismatched declared product ID blocks ingredients and barcode extraction', () => {
  const doc = createDocument(`<input id="ASIN" value="B000000002"><h1 id="productTitle">Sugar snack</h1>
  <div id="nic-ingredients-content">Sugar, sucralose, red 40</div>`);
  assert.deepEqual(extract.extract(doc, { asin: 'B000000001', foodOnly: false }),
    { ok: false, asin: 'B000000001', reason: 'product-identity-mismatch' });
});

test('selected Amazon variant ASIN takes precedence over its parent canonical URL', () => {
  const doc = createDocument(`<link rel="canonical" href="https://www.amazon.com/dp/B000000002">
  <input id="ASIN" value="B000000001"><div id="nic-ingredients-content">Oats, salt</div>`);
  assert.equal(extract.extract(doc, { asin: 'B000000001', foodOnly: false }).ok, true);
});

test('canonical-only product identity mismatch declines a substitute product', () => {
  const doc = createDocument(`<link rel="canonical" href="https://www.amazon.com/dp/B000000002?variant=1">
  <div id="nic-ingredients-content">Oats, salt</div>`);
  assert.equal(extract.extract(doc, { asin: 'B000000001', foodOnly: false }).reason, 'product-identity-mismatch');
});


test('Amazon per-100g table amounts retain their basis despite a per-serving summary', () => {
  const doc = createDocument(`<section class="nicDesktop">
  <div id="nic-nutrition-summary-serving">1 bar (25g)</div>
  <table><tr><td>100</td><td>50mg</td><td>2g</td></tr>
  <tr><td>Calories</td><td>Sodium</td><td>Protein</td></tr></table>
  <table><tr><th>Nutrition per 100g</th></tr><tr><td>Calories</td><td>400</td></tr>
  <tr><td>Saturated Fat</td><td>8g</td></tr></table></section>`);
  const nutrition = extract.nutritionFacts(doc);
  assert.equal(nutrition.calories, 400);
  assert.equal(nutrition.saturatedFat, 8);
  assert.equal(nutrition.servingGrams, 100);
  assert.equal(nutrition.sodium, undefined, 'the portion summary cannot supply a 100g sodium value');
  assert.equal(nutrition.protein, undefined);
});

test('Amazon dual-basis table is declined instead of selecting an arbitrary amount column', () => {
  const doc = createDocument(`<section id="nutritionalInfoAndIngredients_feature_div"><table>
  <tr><th>Nutrient</th><th>Per serving</th><th>Per 100g</th></tr>
  <tr><td>Calories</td><td>100</td><td>400</td></tr>
  <tr><td>Saturated Fat</td><td>2g</td><td>8g</td></tr></table></section>`);
  assert.equal(extract.nutritionSummaryTable(doc), null);
  assert.equal(extract.nutritionFacts(doc), null, 'prose fallback must not revive an ambiguous basis');
});


test('Amazon expanded Facts serving declaration supplies the basis without a summary widget', () => {
  const doc = createDocument(`<section class="nicDesktop"><table>
  <tr><td>Serving size</td><td>1 bar (40g)</td></tr>
  <tr><td>Calories</td><td>180</td></tr><tr><td>Sodium</td><td>200mg</td></tr>
  </table></section>`);
  const nutrition = extract.nutritionFacts(doc);
  assert.equal(nutrition.calories, 180);
  assert.equal(nutrition.sodium, 200);
  assert.equal(nutrition.servingGrams, 40);
});


test('Amazon ingredient section stops before preparation suggestions in the same wrapper', () => {
  const doc = createDocument(`<div id="important-information"><div class="content">
  <h3>Ingredients</h3><p>Organic oats, sea salt.</p>
  <h3>Directions</h3><p>Mix with sugar, oil, red 40 for decorating.</p></div></div>`);
  const data = extract.extract(doc, { asin: 'B000000001', foodOnly: false });
  assert.equal(data.ok, true);
  assert.equal(data.text, 'Organic oats, sea salt.');
  assert.doesNotMatch(data.text, /sugar|red 40/);
});

test('Amazon section-boundary handling preserves all ingredient paragraphs and cross-contact warning', () => {
  const doc = createDocument(`<div id="important-information"><div class="content">
  <h3>Ingredients</h3><p>Organic oats,</p><p>sucralose, red 40.</p><p>May contain peanuts.</p>
  <strong>Legal disclaimer</strong><p>Packaging changes, promotional recipe sugar, butter.</p></div></div>`);
  const data = extract.extract(doc, { asin: 'B000000001', foodOnly: false });
  assert.equal(data.ok, true);
  assert.equal(data.text, 'Organic oats, sucralose, red 40.');
  assert.equal(data.advisoryText, 'May contain peanuts.');
});


// Public UK B0168UUHQ2 capture on2026-10-04: advisory is a sibling, not ingredients text.
test('Amazon separate allergen widget keeps cross-contact warnings apart from ingredients', () => {
  const doc = createDocument(`<section id="nutritionalInfoAndIngredients_feature_div">
  <div id="nic-ingredients-content">Oat flakes, sugar, sunflower oil, honey</div>
  <div id="nic-allergens-May contain:">May contain: Hazelnuts, Mustard</div></section>`);
  const data = extract.extract(doc, { asin: 'B0168UUHQ2', foodOnly: false });
  assert.equal(data.ok, true);
  assert.equal(data.advisoryText, 'May contain: Hazelnuts, Mustard');
  assert.doesNotMatch(data.text, /hazelnuts|mustard/i);
});

test('Amazon advisory sibling survives unreadable ingredients for barcode/photo fallback', () => {
  const doc = createDocument(`<section class="nicDesktop">
  <div id="nic-ingredients-content">See package</div>
  <div id="nic-allergens-May contain:">May contain peanuts.</div></section>`);
  const data = extract.extract(doc, { asin: 'B000000001', foodOnly: false });
  assert.equal(data.ok, false);
  assert.equal(data.advisoryText, 'May contain peanuts.');
});

test('allergen widgets outside the product nutrition card do not supply product advisory', () => {
  const doc = createDocument(`<div id="nic-ingredients-content">Oats, salt</div>
  <aside><div id="nic-allergens-May contain:">May contain peanuts.</div></aside>`);
  const data = extract.extract(doc, { asin: 'B000000001', foodOnly: false });
  assert.equal(data.advisoryText, '');
});
