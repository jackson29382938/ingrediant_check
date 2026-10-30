// Sanitized Amazon HTML snapshots: extract() + food gate. Run: node tests/pages.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const ingestible = require(src('engine/db/ingestible.js'));
const extract = require(src('content/extract.js'));
const { loadPage, createDocument } = require('./pages/load.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

function tileTitles(doc) {
  return [...doc.querySelectorAll('[data-asin]')]
    .map(tile => {
      const el = tile.querySelector('h2 a, h2');
      return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

console.log('US product snapshot — oats');
const oats = loadPage('us-dp-oats.html');
check('extracts the published oats list', () => {
  const data = extract.extract(oats, { asin: 'B00TESTOATS', foodOnly: true, personalCareEnabled: false });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason, via: data.via }));
  assert.match(data.text, /organic whole grain oats/i);
  assert.ok(data.via && /nic-ingredients-content/.test(data.via), `via ${data.via}`);
  assert.strictEqual(data.asin, 'B00TESTOATS');
});
check('food gate lets the grocery oats page through', () => {
  const data = extract.extract(oats, { asin: 'B00TESTOATS', foodOnly: true, personalCareEnabled: false });
  assert.ok(data.ingestible && data.ingestible.ok, JSON.stringify(data.ingestible));
});

console.log('\nUS product snapshot — shampoo');
const shampoo = loadPage('us-dp-shampoo.html');
check('food gate refuses shampoo even though a list is published', () => {
  const data = extract.extract(shampoo, { asin: 'B00TESTSHAM', foodOnly: true, personalCareEnabled: false });
  assert.strictEqual(data.ok, false);
  assert.strictEqual(data.reason, 'not-ingestible');
  assert.ok(data.ingestible && !data.ingestible.ok, JSON.stringify(data.ingestible));
  assert.ok(
    data.ingestible.negatives.includes('cosmetic')
    || data.ingestible.negatives.includes('nonFoodDept')
    || data.ingestible.negatives.includes('externalUse'),
    JSON.stringify(data.ingestible)
  );
});
// The checks above run with personal care off (the food gate's own behavior). With it on, which is the
// default, the same saved page is a supported product and must be rated as one, never as food.
check('with personal care on, the saved shampoo page is read and rated as a shampoo', () => {
  const data = extract.extract(shampoo, { asin: 'B00TESTSHAM', foodOnly: true });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason }));
  assert.deepStrictEqual(data.ingestible.productCategory, { category: 'shampoo', status: 'recognized' });
  const engine = require(src('engine/score.js'));
  const result = engine.score({ name: data.title, ingredients_text: data.text }, {});
  assert.strictEqual(result.category, 'shampoo');
  assert.strictEqual(result.readable, true);
  assert.strictEqual(result.nova, undefined, 'no food class');
  assert.strictEqual(result.score, 88, '100, less the 12 a rinse-off fragrance costs');
});
check('with the category switch off, the saved shampoo page is skipped as before', () => {
  const data = extract.extract(shampoo, { asin: 'B00TESTSHAM', foodOnly: true, personalCareEnabled: false });
  assert.strictEqual(data.reason, 'not-ingestible');
});
check('with the food gate off, extract still finds the shampoo list', () => {
  const data = extract.extract(shampoo, { asin: 'B00TESTSHAM', foodOnly: false });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason }));
  assert.match(data.text, /sodium laureth sulfate/i);
});

console.log('\nUS product snapshot — antiperspirant (Drug Facts, no "Ingredients" heading)');
// Deodorants and antiperspirants are over-the-counter drugs: a page can print "Active ingredient" and "Inactive
// ingredients" and no heading called plain "Ingredients", so no tier found a list and the search tile said "?".
const drugPage = (body, extra = '') => createDocument(`<!doctype html><html><body>
  <h1 id="productTitle">Secret Clinical Strength Antiperspirant Deodorant Stick, 1.6 oz</h1>
  <div id="wayfinding-breadcrumbs_feature_div">Beauty &amp; Personal Care › Deodorants &amp; Antiperspirants</div>
  <div id="centerCol"><div id="feature-bullets"><ul><li>Clinical strength protection</li></ul></div>${extra}
  <div id="important-information">${body}</div></div>
</body></html>`);
const care = require(src('engine/score.js'));
check('a Drug Facts block with no "Ingredients" heading is read, active ingredient first', () => {
  const doc = drugPage(`<div class="a-section"><h4>Drug Facts</h4>
    <p>Active ingredient</p><p>Aluminum zirconium tetrachlorohydrex GLY (20%)</p>
    <p>Purpose</p><p>Antiperspirant</p><p>Uses reduces underarm perspiration</p><p>Warnings For external use only</p>
    <p>Inactive ingredients cyclopentasiloxane, stearyl alcohol, PPG-14 butyl ether, hydrogenated castor oil, fragrance, talc</p>
    <p>Questions? Call 1-800-000-0000</p></div>`);
  const data = extract.extract(doc, { asin: 'B00TESTDEOD', foodOnly: true });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason, via: data.via }));
  assert.strictEqual(data.via, 'drug-facts');
  const result = care.score({ name: data.title, ingredients_text: data.text }, {});
  assert.strictEqual(result.category, 'deodorant');
  assert.strictEqual(result.readable, true, result.reason);
  assert.ok(result.good.some(row => /aluminum zirconium/.test(row.ing)), 'the active ingredient was read');
  assert.ok(result.bad.some(row => /fragrance/i.test(row.why)), 'and so was the inactive list');
  assert.strictEqual(result.score, 85);
  assert.doesNotMatch(data.text, /Questions|Call 1-800/, 'a trailing contact line is not an ingredient');
});
check('an "Ingredients" list of inactive names gets the active ingredient the page prints beside it', () => {
  const doc = drugPage(`<div class="a-section"><h4>Ingredients</h4><p>Cyclopentasiloxane, Stearyl Alcohol, PPG-14 Butyl Ether, Hydrogenated Castor Oil, Fragrance</p></div>
    <div class="a-section"><h4>Drug Facts</h4><p>Active ingredient Aluminum zirconium tetrachlorohydrex GLY (20%) Purpose Antiperspirant</p></div>`);
  const data = extract.extract(doc, { asin: 'B00TESTDEOD', foodOnly: true });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason }));
  assert.match(data.text, /^Active ingredient: aluminum zirconium tetrachlorohydrex gly\. Inactive ingredients: cyclopentasiloxane/i);
  const result = care.score({ name: data.title, ingredients_text: data.text }, {});
  assert.strictEqual(result.score, 85, 'not charged for a missing active, and not charged twice');
  assert.strictEqual(result.bad.length, 1);
});
check('a list that already names its active ingredient is left as the page wrote it', () => {
  const doc = drugPage(`<div class="a-section"><h4>Ingredients</h4><p>Aluminum Zirconium Tetrachlorohydrex GLY (Active Ingredient), Cyclopentasiloxane, Stearyl Alcohol</p></div>
    <div class="a-section"><h4>Drug Facts</h4><p>Active ingredient Aluminum zirconium tetrachlorohydrex GLY Purpose Antiperspirant</p></div>`);
  const data = extract.extract(doc, { asin: 'B00TESTDEOD', foodOnly: true });
  assert.ok(data.ok);
  assert.doesNotMatch(data.text, /^Active ingredient:/);
});
check('food and supplements never read an "inactive ingredients" block as a label', () => {
  const food = createDocument(`<!doctype html><html><body><h1 id="productTitle">Rolled Oats</h1>
    <div id="important-information"><p>Active ingredient Sodium fluoride</p><p>Inactive ingredients water, sorbitol</p></div></body></html>`);
  assert.strictEqual(extract.extract(food, { asin: 'B00TESTFOOD', foodOnly: false }).ok, false);
  const off = extract.extract(drugPage('<p>Active ingredient Aluminum chlorohydrate</p><p>Inactive ingredients water, glycerin</p>'), { asin: 'B00TESTDEOD', foodOnly: false, personalCareEnabled: false });
  assert.strictEqual(off.ok, false, 'with the category switch off nothing here is read');
});

console.log('\nSE product snapshot — havregryn');
const havre = loadPage('se-dp-havre.html');
check('Ingredienser heading is read from the expander sibling', () => {
  const data = extract.extract(havre, { asin: 'B00TESTHAVR', foodOnly: true, personalCareEnabled: false });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason, via: data.via }));
  assert.match(data.text, /havregryn/i);
});
check('Swedish grocery crumbs pass the food gate', () => {
  const data = extract.extract(havre, { asin: 'B00TESTHAVR', foodOnly: true, personalCareEnabled: false });
  assert.ok(data.ingestible && data.ingestible.ok, JSON.stringify(data.ingestible));
});

console.log('\nUS search snapshot — organic rolled oats');
const search = loadPage('us-s-grocery.html');
check('search department + query are a food search', () => {
  const label = search.querySelector('.nav-search-label');
  const selected = search.querySelector('#searchDropdownBox option:checked');
  const query = (search.querySelector('input[name="k"]') || {}).attributes
    ? search.querySelector('input[name="k"]').getAttribute('value')
    : 'organic rolled oats';
  const verdict = ingestible.assessSearch({
    query,
    alias: selected ? selected.getAttribute('value') : 'grocery',
    label: label ? label.textContent.trim() : '',
  });
  assert.ok(verdict.ok, JSON.stringify(verdict));
});
check('result titles are not a non-food majority', () => {
  const titles = tileTitles(search);
  assert.ok(titles.length >= 5, `only ${titles.length} titles`);
  assert.strictEqual(ingestible.looksNonFoodFromResults(titles), false);
});
check('extract() on a search page does not invent a product list', () => {
  const data = extract.extract(search, { foodOnly: true, personalCareEnabled: false });
  assert.strictEqual(data.ok, false);
});

console.log('\nTurkish heading (inline, same loader)');
check('İçindekiler is recognised as an ingredient heading', () => {
  const doc = createDocument(`<!doctype html><html lang="tr"><body>
    <h1 id="productTitle">Organik Yulaf Ezmesi 500g</h1>
    <div id="wayfinding-breadcrumbs_feature_div">Gıda › Kahvaltı</div>
    <div id="detailBullets_feature_div">ASIN : B00TESTYULF EAN : 8690000000000</div>
    <div id="important-information">
      <div class="a-expander-container">
        <span>İçindekiler</span>
        <div class="a-expander-content"><p>Yulaf ezmesi</p></div>
      </div>
    </div>
  </body></html>`);
  assert.ok(extract.INGREDIENT_HEADING.test('İçindekiler'));
  assert.ok(extract.INGREDIENT_HEADING.test('Icindekiler'));
  const data = extract.extract(doc, { asin: 'B00TESTYULF', foodOnly: true, personalCareEnabled: false });
  assert.ok(data.ok, JSON.stringify({ ok: data.ok, reason: data.reason, via: data.via }));
  assert.match(data.text, /yulaf/i);
});

console.log('\n"See nutrition panel" placeholder (live Lay\'s, B0005Z6FYA)');
check('placeholder is rejected and the feature-bullet list is read instead', () => {
  const doc = createDocument(`<!doctype html><html><body>
    <h1 id="productTitle">Lay's Classic Potato Chips, 8 oz</h1>
    <div id="wayfinding-breadcrumbs_feature_div">Grocery › Snacks › Chips</div>
    <div id="feature-bullets"><ul><li>Made with just three ingredients: potatoes, vegetable oil, and salt.</li> <li>Gluten Free Snack: no gluten, 0.5g fat.</li></ul></div>
    <div id="nic-ingredients-content"><span>See nutrition panel</span></div>
  </body></html>`);
  assert.strictEqual(extract.looksLikeIngredients('See nutrition panel'), false);
  const data = extract.extract(doc, { asin: 'B0005Z6FYA', foodOnly: true, personalCareEnabled: false });
  assert.strictEqual(data.via, 'feature-bullets', JSON.stringify({ ok: data.ok, reason: data.reason, via: data.via }));
  assert.match(data.text, /potatoes/);
  assert.doesNotMatch(data.text, /gluten/i);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
