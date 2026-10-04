'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDocument } = require('./pages/load.js');
require('../src/stores/target.js');
const reader = require('../src/stores/label-reader.js');
const W = require('../src/stores/walmart.js');
test('present invalid, foreign or empty canonical fails product identity', () => {
  for (const href of ['', 'https://evil.example/ip/oats/10314926', 'https://www.walmart.com/cart', '/ip/oats/99999999']) {
    assert.equal(reader.sameCanonical(createDocument(`<link rel="canonical" href="${href}">`), '10314926', W.productId), false, href);
  }
  assert.equal(reader.sameCanonical(createDocument(''), '10314926', W.productId), true);
  assert.equal(reader.sameCanonical(createDocument('<link rel="canonical" href="/ip/oats/10314926">'), '10314926', W.productId), true);
});
test('Contains-prefixed ingredient declarations remain independently readable', () => {
  const doc = createDocument('<section><h3>Ingredients</h3><p>Contains 2% or less of: salt, natural flavors.</p></section>');
  assert.equal(reader.readLabel(doc).ingredients, 'Contains 2% or less of: salt, natural flavors.');
});
test('adjacent headings and recommendation sections cannot become product labels', () => {
  for (const html of ['<section><h3>Ingredients</h3><h3>Nutrition Facts</h3></section>',
    '<aside><h3>Ingredients</h3><p>oats</p></aside>', '<footer><h3>Ingredients</h3><p>oats</p></footer>',
    '<div data-testid="recommendations"><h3>Ingredients</h3><p>oats</p><button>Ingredients</button></div>']) {
    assert.equal(reader.readLabel(createDocument(html)).ingredients, '', html);
    assert.equal(reader.labelToggle(createDocument(html)), null, html);
  }
});
test('oversized declarations are rejected without scoring a truncated prefix', () => {
  assert.equal(reader.readLabel(createDocument(`<section><h3>Ingredients</h3><p>${'oats, '.repeat(1100)}red 40</p></section>`)).ingredients, '');
});

test('Target rejects oversized declarations instead of losing late additives', () => {
  const T = require('../src/stores/target.js');
  const doc = createDocument(`<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><h4>Ingredients:</h4><div>${'oats, '.repeat(1100)}red 40</div></section>`);
  assert.equal(T.readProduct(doc, { href: 'https://www.target.com/p/oats/-/A-79364857' }).ingredients, '');
});

test('shared retailer labels retain multiparagraph declarations and stop before directions', () => {
  const doc = createDocument('<section><h3>Ingredients</h3><p>whole grain oats,</p><p>sugar, palm oil, salt</p><h3>Directions</h3><p>Decorate with red 40</p></section>');
  assert.equal(reader.readLabel(doc).ingredients, 'whole grain oats, sugar, palm oil, salt');
});
test('semantic definition/table labels are read without inventing marketing ingredients', () => {
  for (const html of ['<dl><dt>Ingredients</dt><dd>almonds, cocoa, salt</dd><dt>Nutrition Facts</dt><dd>Protein 5g</dd></dl>',
    '<table><tr><th>Ingredients</th><td>almonds, cocoa, salt</td></tr></table>']) {
    assert.equal(reader.readLabel(createDocument(html)).ingredients, 'almonds, cocoa, salt');
  }
});
test('hidden variants and account forms cannot supply a current-product label', () => {
  for (const html of ['<section hidden><h3>Ingredients</h3><p>sugar</p></section>', '<section aria-hidden="true"><h3>Ingredients</h3><p>sugar</p></section>',
    '<form><h3>Ingredients</h3><p>sugar</p></form>', '<section data-testid="RECOMMENDATIONS"><h3>Ingredients</h3><p>sugar</p></section>']) {
    assert.equal(reader.readLabel(createDocument(html)).ingredients, '');
  }
});
test('declared allergens and cross-contact statements survive without changing ingredient text', () => {
  const html = '<section><h3>Ingredients</h3><p>whole grain oats</p><h3>Allergens and Warnings</h3><p>Contains: milk. May contain peanuts. Store in a cool place. Contains no soy.</p></section>';
  const data = reader.readLabel(createDocument(html));
  assert.equal(data.ingredients, 'whole grain oats');
  assert.equal(data.advisoryText, 'Contains: milk. May contain peanuts');
  const engine = require('../src/engine/score.js');
  const result = engine.score({ ingredients_text: data.ingredients, advisory_text: data.advisoryText }, { allergens: ['milk', 'peanut'] });
  assert.ok(result.flags.some(flag => flag.id === 'milk'));
  assert.ok(result.flags.some(flag => flag.id === 'peanut'));
  assert.equal(result.score, engine.score({ ingredients_text: data.ingredients }, {}).score);
});
test('duplicate contradictory canonicals do not approve a wrong product label', () => {
  const doc = createDocument('<link rel="canonical" href="/ip/oats/10314926"><link rel="canonical" href="/ip/oats/99999999">');
  assert.equal(reader.sameCanonical(doc, '10314926', W.productId), false);
});

test('positive warning clauses cannot inherit explicitly negated allergens', () => {
  const doc = createDocument('<section><h3>Warnings</h3><p>Contains soy but does not contain milk. Contains no peanuts, may contain wheat.</p></section>');
  assert.equal(reader.readLabel(doc).advisoryText, 'Contains soy. may contain wheat');
});
