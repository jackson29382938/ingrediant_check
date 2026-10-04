'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const C = require('../src/stores/costco.js');
const { createDocument } = require('./pages/load.js');
const product = 'https://www.costco.com/p/-/protein-bars/100423971';
const at = href => ({ href, hostname: new URL(href).hostname, pathname: new URL(href).pathname });
const label = '<h1>Protein bars</h1><section><h3>Ingredients</h3><p>almonds, cocoa, salt</p></section>';

test('Costco recognizes old and modern products without mixing subdomains or schemes', () => {
  for (const href of [product, 'https://costco.com/old.product.100423971.html', '/p/-/bars/100423971?langId=-1']) {
    assert.equal(C.productId(href), '100423971');
  }
  for (const href of [
    'ftp://www.costco.com/p/-/bars/100423971',
    'https://name:password@www.costco.com/p/-/bars/100423971',
    'https://sameday.costco.com/p/-/bars/100423971',
    'https://www.costco.com.evil.example/p/-/bars/100423971',
    '/p/-/bars/12', '/p/-/bars/100423971-extra', '/p/-/bars/100423971/reviews',
    '/p/-/bars/1234567890123456',
  ]) assert.equal(C.productId(href), '', href);
});

test('Costco does not extract private or nonproduct pages even when they contain labels', () => {
  for (const path of ['/account', '/checkout', '/cart', '/s?keyword=bars', '/help']) {
    const data = C.readProduct(createDocument(label), at(`https://www.costco.com${path}`));
    assert.equal(data.id, '');
    assert.equal(data.ingredients, '');
    assert.equal(data.title, '');
    assert.equal(data.nutrition, null);
  }
});

test('Costco search detection accepts only supported public routes on its own host', () => {
  for (const href of ['https://www.costco.com/s?keyword=bars', 'https://costco.com/CatalogSearch?searchTerm=bars']) {
    assert.equal(C.isSearchPage(at(href)), true);
    assert.equal(C.searchQuery(at(href)), 'bars');
  }
  for (const href of ['https://evil.example/s', 'https://sameday.costco.com/s', 'ftp://costco.com/s', 'https://user@costco.com/s', product, 'https://costco.com/cart']) {
    assert.equal(C.isSearchPage(at(href)), false);
  }
});

test('Costco captured public product exposes identity and breadcrumbs while leaving absent labels unknown', () => {
  const doc = createDocument(fs.readFileSync('tests/pages/costco-audit-product.html', 'utf8'));
  const data = C.readProduct(doc, at(product));
  assert.equal(data.id, '100423971');
  assert.match(data.title, /Kirkland Signature Protein Bars/);
  assert.equal(data.crumbs[2], 'Snacks');
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
  assert.equal(data.label, 'missing');
});

test('Costco captured initial search does not turn a header advertisement into a search result', () => {
  const doc = createDocument(fs.readFileSync('tests/pages/costco-audit-search.html', 'utf8'));
  assert.deepEqual(C.searchTiles(doc), []);
});

test('Costco hydrated fixture cards keep one badge on the whole tile with an image-only link', () => {
  const doc = createDocument(`<main><article data-testid="ProductTile_100423971"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a><a href="/p/-/bars/100423971">Protein bars</a></article><article data-testid="ProductTile_10055555"><a href="/old.product.10055555.html" aria-label="Rolled oats"></a></article></main>`);
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 2);
  assert.deepEqual(tiles.map(t => t.title), ['Protein bars', 'Rolled oats']);
  assert.equal(tiles[0].tile.getAttribute('data-testid'), 'ProductTile_100423971');
  assert.equal(tiles[0].anchor, tiles[0].tile);
  assert.equal(tiles[0].anchor.tagName, 'ARTICLE');
});

test('Costco skips mixed-product cards instead of borrowing a title across item IDs', () => {
  const doc = createDocument(`<main><article data-testid="ProductTile_stale"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a><a href="/p/-/oats/10055555"><h3>Rolled oats</h3></a></article><article data-testid="ProductTile_10066666"><a href="/p/-/almonds/10066666"><h3>Almonds</h3></a></article></main>`);
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, '10066666');
  assert.equal(tiles[0].title, 'Almonds');
  assert.equal(tiles[0].anchor, tiles[0].tile);
});

test('Costco accepts a mixed card only after hydration resolves all links to one product', () => {
  const doc = createDocument('<article data-testid="ProductTile_hydrating"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a><a href="/p/-/oats/10055555"><h3>Protein bars</h3></a></article>');
  assert.deepEqual(C.searchTiles(doc), []);
  doc.querySelector('h3').parentNode.setAttribute('href', '/p/-/bars/100423971');
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, '100423971');
  assert.equal(tiles[0].title, 'Protein bars');
  assert.equal(tiles[0].anchor.tagName, 'ARTICLE');
});

test('Costco search ignores off-store links and navigation even when they have valid item IDs', () => {
  const doc = createDocument(`<nav><a href="/p/-/bars/100423971">Promotion</a></nav><aside><a href="/p/-/bars/100423971">Recommendation</a></aside><footer><a href="/p/-/bars/100423971">Footer</a></footer><main><a href="https://evil.example/p/-/bars/100423971">Other</a><a href="/p/-/bars/100423971"><h3>Actual bars</h3></a><a href="/p/-/bars/100423971">Duplicate</a></main>`);
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].title, 'Actual bars');
});

test('Costco declared labels retain multiword ingredients and never infer absent nutrition', () => {
  const doc = createDocument('<h1>Protein bars</h1><section><h3>Ingredients</h3><p>almonds, natural flavors, palm oil</p></section>');
  const data = C.readProduct(doc, at(product));
  assert.equal(data.ingredients, 'almonds, natural flavors, palm oil');
  assert.equal(data.label, 'open');
  assert.equal(data.nutrition, null);
});

test('Costco stale canonical identity cannot reuse a prior page label', () => {
  const doc = createDocument(`<link rel="canonical" href="https://www.costco.com/p/-/different-bars/99999999">${label}`);
  assert.equal(C.readProduct(doc, at(product)).ingredients, '');
});

test('Costco ingredient-looking image alt, marketing and serialized script data stay unscored', () => {
  const doc = createDocument('<h1>Protein bars</h1><img alt="Ingredients: almonds"><script type="application/ld+json">{"ingredients":"almonds"}</script><p>Made with almonds</p><button aria-expanded="false">Nutritional Facts</button>');
  const data = C.readProduct(doc, at(product));
  assert.equal(data.ingredients, '');
  assert.equal(data.label, 'collapsed');
  assert.equal(C.labelToggle(doc).innerText, 'Nutritional Facts');
});
