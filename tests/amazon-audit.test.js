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
