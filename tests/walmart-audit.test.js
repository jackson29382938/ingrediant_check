'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const W = require('../src/stores/walmart.js');
const engine = require('../src/engine/score.js');
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
  const result = W.readProduct(documentFor('<p>Oats&nbsp;&amp; salt, natural flavo&#114;s, &#x61;lmonds.</p><script>fetch("secret")</script><!-- draft: add peanut oil -->'), at(url));
  assert.equal(result.ingredients, 'Oats & salt, natural flavors, almonds.');
  assert.equal(result.nutrition, null);
});

test('Walmart encoded markup remains text and invalid code points never crash reading', () => {
  assert.equal(W.readProduct(documentFor('&lt;b&gt;oats&lt;/b&gt;, salt'), at(url)).ingredients, 'oats , salt');
  assert.doesNotThrow(() => W.readProduct(documentFor('oats, &#1114112;, &#0;, &#xD800;'), at(url)));
});

test('Walmart markup cleanup preserves ingredient quantities written with comparison symbols', () => {
  const ingredients = 'oats, contains <2% of salt, peanut oil; protein >0g';
  assert.equal(W.readProduct(documentFor(`<p>${ingredients}</p>`), at(url)).ingredients, ingredients);
  assert.equal(W.readProduct(documentFor('oats, contains &lt;2% of salt, peanut oil; protein &gt;0g'), at(url)).ingredients, ingredients);
  const result = engine.score({ ingredients_text: W.readProduct(documentFor(`<p>${ingredients}</p>`), at(url)).ingredients }, { allergens: ['peanut'] });
  assert.ok(result.flags.some(flag => flag.kind === 'allergen' && flag.id === 'peanut'), 'the comparison symbols must not hide a declared allergen');
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

test('Walmart coherent boot data with a malformed or absent product never authenticates a stale DOM label', () => {
  for (const product of [null, [], '10314926', false]) {
    assert.equal(W.readProduct(documentFor('oats', product, visible), at(url)).ingredients, '');
  }
  const doc = documentFor('oats', null, visible);
  const node = doc.querySelector('#__NEXT_DATA__');
  const model = JSON.parse(node.textContent);
  delete model.props.pageProps.initialData.data.product;
  node.textContent = JSON.stringify(model);
  assert.equal(W.readProduct(doc, at(url)).ingredients, '');
  assert.equal(W.readProduct(createDocument(visible), at(url)).ingredients, 'oats, salt', 'an ordinary DOM label still works when the boot model is unavailable');
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

test('Walmart SPA transitions never mix identity-bound ingredients with an old title or nutrient table', () => {
  const html = '<h1>Peanut butter</h1><section><h3>Ingredients</h3><p>peanuts, palm oil</p></section>'
    + '<section data-testid="nutrition-facts"><p>Serving Size: 40g</p><div><b>Sodium</b> 120mg</div></section>';
  const result = W.readProduct(documentFor('oats', { usItemId: '10314926', name: 'Rolled oats' }, html), at(url));
  assert.equal(result.title, 'Rolled oats');
  assert.equal(result.ingredients, 'oats');
  assert.equal(result.nutrition, null);
  const waiting = W.readProduct(documentFor('', { usItemId: '10314926', name: 'Rolled oats' }, html), at(url));
  assert.equal(waiting.ingredients, '');
  assert.equal(waiting.label, 'missing');
});

test('Walmart aligned headings still allow current DOM declarations and nutrition', () => {
  const html = '<h1>ROLLED OATS</h1>' + visible
    + '<section data-testid="nutrition-facts"><p>Serving Size: 40g</p><div><b>Sodium</b> 120mg</div></section>';
  const result = W.readProduct(documentFor('', undefined, html), at(url));
  assert.equal(result.ingredients, 'oats, salt');
  assert.equal(result.nutrition.sodium, 120);
  assert.equal(result.nutrition.servingGrams, 40);
});

test('Walmart search accepts its own trailing-slash route and rejects foreign pages', () => {
  assert.equal(W.isSearchPage(at('https://www.walmart.com/search/?q=oats')), true);
  assert.equal(W.isSearchPage(at('https://evil.example/search?q=oats')), false);
  for (const raw of ['ftp://www.walmart.com/ip/oats/10314926', 'https://user:password@www.walmart.com/ip/oats/10314926', 'https://walmart.com.evil.example/ip/oats/10314926', '/ip/oats/not-an-id']) assert.equal(W.productId(raw), '');
});

test('Walmart image-only search links use their own accessible names and deduplicate products', () => {
  const doc = createDocument('<div data-testid="item-stack"><a href="/ip/oats/10314926" aria-label="Rolled oats"><img alt="Oats package"></a>'
    + '<a href="/ip/oats/10314926">Rolled oats</a><a href="/ip/almonds/10314925"><img alt="Whole almonds"></a></div>');
  const hits = W.searchTiles(doc);
  assert.deepEqual(hits.map(hit => [hit.id, hit.title]), [['10314926', 'Rolled oats'], ['10314925', 'Whole almonds']]);
  assert.equal(hits[1].anchor.getAttribute('href'), '/ip/almonds/10314925');
});

test('Walmart search refuses hidden/navigation/promotional links and never borrows another product image', () => {
  const excluded = ['<nav>', '<aside>', '<section hidden>', '<section aria-hidden="true">', '<section data-testid="product-recommendations">', '<section aria-label="Promotions">'];
  for (const wrapper of excluded) {
    const doc = createDocument(`${wrapper}<a href="/ip/oats/10314926" aria-label="Rolled oats"></a></${wrapper.startsWith('<section') ? 'section' : wrapper.slice(1, -1)}>`);
    assert.deepEqual(W.searchTiles(doc), []);
  }
  const doc = createDocument('<div data-testid="item-stack"><a href="/ip/oats/10314926"></a><a href="/ip/almonds/10314925"><img alt="Almonds"></a></div>');
  assert.deepEqual(W.searchTiles(doc).map(hit => [hit.id, hit.title]), [['10314925', 'Almonds']]);
});
