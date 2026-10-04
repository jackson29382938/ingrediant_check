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
