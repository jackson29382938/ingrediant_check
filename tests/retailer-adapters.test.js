'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const W = require('../src/stores/walmart.js');
const C = require('../src/stores/costco.js');
const { createDocument } = require('./pages/load.js');
const at = href => ({ href, pathname: new URL(href).pathname, hostname: new URL(href).hostname });
const walmart = 'https://www.walmart.com/ip/oats/10314926';
const costco = 'https://www.costco.com/p/-/protein-bars/100423971';
function productModel(productId = '10314926', ingredients = 'WHOLE GRAIN ROLLED OATS.') {
  return `<h1>Whole grain oats</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{initialData:{data:{product:{usItemId:productId,name:'Whole grain oats',category:{path:[{name:'Food'}]}},idml:{ingredients:{ingredients:{value:ingredients}}}}}}}})}</script>`;
}
test('retailer IDs reject foreign hosts, private routes and malformed identifiers', () => {
  assert.equal(W.productId(walmart), '10314926');
  assert.equal(C.productId(costco), '100423971');
  assert.equal(C.productId('https://www.costco.com/old.product.100423971.html'), '100423971');
  for (const [adapter, domain] of [[W,'walmart.com'],[C,'costco.com']]) {
    assert.equal(adapter.productId(`https://${domain}.evil.example/ip/oats/10314926`), '');
    for (const route of ['cart','checkout','account','login']) assert.equal(adapter.isProductPage(at(`https://www.${domain}/${route}`)), false);
    assert.equal(adapter.matchesHost(`sameday.${domain}`), false);
  }
});
test('Walmart accepts current-product embedded declaration and leaves nutrition unknown', () => {
  const data = W.readProduct(createDocument(productModel()), at(walmart));
  assert.equal(data.ingredients, 'WHOLE GRAIN ROLLED OATS.');
  assert.equal(data.nutrition, null);
  assert.deepEqual(data.crumbs, ['Food']);
});
test('sanitized live Walmart capture reads the declared current product', () => {
  const raw = fs.readFileSync('tests/pages/walmart-product.json', 'utf8');
  const doc = createDocument(`<script id="__NEXT_DATA__" type="application/json">${raw}</script>`);
  const data = W.readProduct(doc, at(walmart));
  assert.equal(data.ingredients, 'WHOLE GRAIN ROLLED OATS.');
  assert.match(data.title, /Quick Oats/);
});
test('Walmart rejects stale SPA data and mismatched canonical products', () => {
  assert.equal(W.readProduct(createDocument(productModel('99999999')), at(walmart)).ingredients, '');
  assert.equal(W.readProduct(createDocument(`<link rel="canonical" href="https://www.walmart.com/ip/x/99999999">${productModel()}`), at(walmart)).ingredients, '');
});
test('Walmart malformed or oversized boot data falls back to a declared DOM label', () => {
  for (const raw of ['{invalid', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    const data = W.readProduct(createDocument(`<script id="__NEXT_DATA__">${raw}</script><section><h3>Ingredients</h3><p>oats, salt</p></section>`), at(walmart));
    assert.equal(data.ingredients, 'oats, salt');
  }
});
test('Costco reads a visible label and refuses mismatched canonical products', () => {
  const html = '<h1>Protein bars</h1><section><h3>Ingredients:</h3><p>almonds, cocoa, salt</p></section>';
  assert.equal(C.readProduct(createDocument(html), at(costco)).ingredients, 'almonds, cocoa, salt');
  assert.equal(C.readProduct(createDocument(`<link rel="canonical" href="https://www.costco.com/p/-/x/99999999">${html}`), at(costco)).ingredients, '');
});
test('missing labels and marketing text never become ingredient declarations', () => {
  const html = '<h1>Protein bars</h1><img alt="Ingredients: almonds, cocoa"><script>var ingredients="almonds";</script><button aria-expanded="false">Nutritional Facts</button>';
  const data = C.readProduct(createDocument(html), at(costco));
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
  assert.equal(data.label, 'collapsed');
});
test('search adapters deduplicate product links and ignore off-store recommendations', () => {
  const html = '<a href="/ip/oats/10314926"><h3>Oats</h3></a><a href="/ip/oats/10314926">Oats</a><a href="https://evil.example/ip/oats/99999999">Other</a>';
  assert.equal(W.searchTiles(createDocument(html)).length, 1);
  assert.equal(W.searchQuery(at('https://www.walmart.com/search?q=rolled+oats')), 'rolled oats');
  assert.equal(C.searchQuery(at('https://www.costco.com/s?keyword=oats')), 'oats');
});
