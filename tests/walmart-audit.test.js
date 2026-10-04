'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const W = require('../src/stores/walmart.js');
const { createDocument } = require('./pages/load.js');
const url = 'https://www.walmart.com/ip/oats/10314926';
const at = href => ({ href, hostname: new URL(href).hostname, pathname: new URL(href).pathname });
function documentFor(value, product = { usItemId: '10314926', name: 'Rolled oats' }, html = '') {
  const doc = createDocument(html);
  const node = { textContent: JSON.stringify({ props: { pageProps: { initialData: { data: {
    product, idml: { ingredients: { ingredients: { value } } },
  } } } } }) };
  const select = doc.querySelector.bind(doc);
  doc.querySelector = selector => selector === '#__NEXT_DATA__' ? node : select(selector);
  return doc;
}
const visible = '<section><h3>Ingredients</h3><p>oats, salt</p></section>';

test('Walmart empty and malformed embedded declarations fall back to the current visible label', () => {
  for (const value of ['', '  ', null, {}, [], 42, '<span> </span>']) {
    const result = W.readProduct(documentFor(value, undefined, visible), at(url));
    assert.equal(result.ingredients, 'oats, salt');
    assert.equal(result.label, 'open');
  }
});

test('Walmart declarations decode retailer HTML entities without executing markup', () => {
  const result = W.readProduct(documentFor('<p>Oats&nbsp;&amp; salt, natural flavo&#114;s, &#x61;lmonds.</p><script>fetch("secret")</script>'), at(url));
  assert.equal(result.ingredients, 'Oats & salt, natural flavors, almonds.');
  assert.equal(result.nutrition, null);
});

test('Walmart encoded markup remains text and invalid code points never crash reading', () => {
  assert.equal(W.readProduct(documentFor('&lt;b&gt;oats&lt;/b&gt;, salt'), at(url)).ingredients, 'oats , salt');
  assert.doesNotThrow(() => W.readProduct(documentFor('oats, &#1114112;, &#0;, &#xD800;'), at(url)));
});

test('Walmart rejects overlong embedded labels instead of scoring a truncated declaration', () => {
  const result = W.readProduct(documentFor('oats, '.repeat(1001)), at(url));
  assert.equal(result.ingredients, '');
  assert.equal(result.label, 'missing');
  assert.equal(W.readProduct(documentFor('oats, '.repeat(1001), undefined, visible), at(url)).ingredients, 'oats, salt');
});

test('Walmart identity accepts scalar IDs and rejects coerced arrays or other products', () => {
  for (const usItemId of [['10314926'], {}, '99999999', null]) {
    assert.equal(W.readProduct(documentFor('oats', { usItemId }, visible), at(url)).ingredients, '');
  }
  assert.equal(W.readProduct(documentFor('oats', { usItemId: 10314926 }), at(url)).ingredients, 'oats');
});

test('Walmart does not read unrelated embedded product data on non-product routes', () => {
  for (const route of ['search?q=oats', 'cart', 'account']) {
    assert.equal(W.readProduct(documentFor('oats'), at(`https://www.walmart.com/${route}`)).ingredients, '');
  }
});

test('Walmart malformed display metadata never becomes stringified object text', () => {
  const result = W.readProduct(documentFor('oats', { usItemId: '10314926', name: {}, category: { path: [{ name: {} }, { name: 'Food' }, null] } }), at(url));
  assert.equal(result.title, '');
  assert.deepEqual(result.crumbs, ['Food']);
});

test('Walmart memoized model refreshes when a reused SPA script changes', () => {
  const doc = documentFor('oats');
  assert.equal(W.readProduct(doc, at(url)).ingredients, 'oats');
  const node = doc.querySelector('#__NEXT_DATA__');
  const model = JSON.parse(node.textContent);
  model.props.pageProps.initialData.data.idml.ingredients.ingredients.value = 'almonds';
  node.textContent = JSON.stringify(model);
  assert.equal(W.readProduct(doc, at(url)).ingredients, 'almonds');
  node.textContent = '{unfinished';
  assert.equal(W.readProduct(doc, at(url)).ingredients, '');
});

test('Walmart search accepts its own trailing-slash route and rejects foreign pages', () => {
  assert.equal(W.isSearchPage(at('https://www.walmart.com/search/?q=oats')), true);
  assert.equal(W.isSearchPage(at('https://evil.example/search?q=oats')), false);
  for (const raw of ['ftp://www.walmart.com/ip/oats/10314926', 'https://user:password@www.walmart.com/ip/oats/10314926', 'https://walmart.com.evil.example/ip/oats/10314926', '/ip/oats/not-an-id']) assert.equal(W.productId(raw), '');
});
