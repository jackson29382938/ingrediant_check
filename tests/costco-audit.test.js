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
    assert.equal(C.searchQuery(at(`${href}?keyword=private`)), '');
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

test('Costco second live grocery sample remains unknown without assuming coffee has a single ingredient', () => {
  const doc = createDocument(fs.readFileSync('tests/pages/costco-audit-coffee.html', 'utf8'));
  const current = at('https://www.costco.com/p/-/kirkland-signature-house-blend-coffee-medium-roast-whole-bean-25-lbs/100493931');
  const data = C.readProduct(doc, current);
  assert.equal(data.id, '100493931');
  assert.match(data.title, /House Blend Coffee/);
  assert.equal(data.crumbs[2], 'Kirkland Signature Grocery');
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
  assert.equal(data.label, 'missing');
});

test('Costco hydrated fixture cards separate title badge anchors from image and card containers', () => {
  const doc = createDocument(`<main><article data-testid="ProductTile_100423971"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a><a href="/p/-/bars/100423971">Protein bars</a></article><article data-testid="ProductTile_10055555"><a href="/old.product.10055555.html" aria-label="Rolled oats"></a></article></main>`);
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 2);
  assert.deepEqual(tiles.map(t => t.title), ['Protein bars', 'Rolled oats']);
  assert.equal(tiles[0].tile.getAttribute('data-testid'), 'ProductTile_100423971');
  assert.equal(tiles[0].el, tiles[0].tile);
  assert.equal(tiles[0].anchor.tagName, 'A');
  assert.equal(tiles[0].anchor.innerText, 'Protein bars');
  assert.equal(tiles[0].badgePlacement, 'inline');
  assert.equal(tiles[1].anchor, tiles[1].tile);
  assert.equal(tiles[1].badgePlacement, 'corner');
});

test('Costco skips mixed-product cards instead of borrowing a title across item IDs', () => {
  const doc = createDocument(`<main><article data-testid="ProductTile_stale"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a><a href="/p/-/oats/10055555"><h3>Rolled oats</h3></a></article><article data-testid="ProductTile_10066666"><a href="/p/-/almonds/10066666"><h3>Almonds</h3></a></article></main>`);
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, '10066666');
  assert.equal(tiles[0].title, 'Almonds');
  assert.equal(tiles[0].anchor.tagName, 'H3');
  assert.equal(tiles[0].el, tiles[0].tile);
});

test('Costco accepts a mixed card only after hydration resolves all links to one product', () => {
  const doc = createDocument('<article data-testid="ProductTile_hydrating"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a><a href="/p/-/oats/10055555"><h3>Protein bars</h3></a></article>');
  assert.deepEqual(C.searchTiles(doc), []);
  doc.querySelector('h3').parentNode.setAttribute('href', '/p/-/bars/100423971');
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, '100423971');
  assert.equal(tiles[0].title, 'Protein bars');
  assert.equal(tiles[0].anchor.tagName, 'H3');
});

test('Costco card title links take precedence over generic image labels and decoration', () => {
  const doc = createDocument('<article data-testid="ProductTile_100423971"><img alt="Shop Costco"><a href="/p/-/bars/100423971" aria-label="View product image"><img alt="Front"></a><a href="/p/-/bars/100423971">Kirkland Signature Protein Bars</a></article>');
  assert.equal(C.searchTiles(doc)[0].title, 'Kirkland Signature Protein Bars');
});

test('Costco card image fallback must belong to its own product link', () => {
  const doc = createDocument('<article data-testid="ProductTile_100423971"><img alt="Rolled oats"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a></article><article data-testid="ProductTile_10055555"><img alt="Unrelated almonds"><a href="/p/-/oats/10055555"></a></article>');
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].title, 'Protein bars');
});

test('Costco card headings inside foreign links cannot name a different product', () => {
  const doc = createDocument('<article data-testid="ProductTile_100423971"><a href="https://evil.example/p/-/oats/10055555"><h3>Rolled oats</h3></a><a href="/p/-/bars/100423971"><img alt="Protein bars"></a></article>');
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, '100423971');
  assert.equal(tiles[0].title, 'Protein bars');
});

test('Costco nested ProductTile wrappers do not blend independent product identities', () => {
  const doc = createDocument('<div data-testid="ProductTile_group"><article data-testid="ProductTile_100423971"><a href="/p/-/bars/100423971"><h3>Protein bars</h3></a></article><article data-testid="ProductTile_10055555"><a href="/p/-/oats/10055555"><h3>Rolled oats</h3></a></article></div>');
  const tiles = C.searchTiles(doc);
  assert.deepEqual(tiles.map(tile => [tile.id, tile.title]), [['100423971', 'Protein bars'], ['10055555', 'Rolled oats']]);
  assert.notEqual(tiles[0].anchor, tiles[1].anchor);
});

test('Costco image-only cards request corner placement without inserting badges inside image links', () => {
  const doc = createDocument('<article data-testid="ProductTile_100423971"><a href="/p/-/bars/100423971"><img alt="Protein bars"></a></article>');
  const tile = C.searchTiles(doc)[0];
  assert.equal(tile.badgePlacement, 'corner');
  assert.equal(tile.anchor.tagName, 'ARTICLE');
  assert.equal(tile.anchor, tile.el);
});

test('Costco badge text does not become part of product identity on a later search pass', () => {
  const doc = createDocument('<article data-testid="ProductTile_100423971"><a href="/p/-/bars/100423971"><h3><span class="air-badge">96</span>Protein bars</h3></a></article>');
  const tile = C.searchTiles(doc)[0];
  assert.equal(tile.title, 'Protein bars');
  assert.equal(tile.anchor.tagName, 'H3');
  assert.equal(tile.badgePlacement, 'inline');
});

test('Costco same-origin public product URL helper strips search tracking and rejects invalid origins or IDs', () => {
  assert.equal(C.productUrl('100493931', at('https://www.costco.com/s?keyword=coffee&utm_source=tracking')), 'https://www.costco.com/product.product.100493931.html');
  assert.equal(C.productUrl('100493931', at('https://costco.com/s?keyword=coffee')), 'https://costco.com/product.product.100493931.html');
  for (const id of ['12', '100493931/checkout', '100493931?email=private', '1e8', ' 100493931', {}, null]) {
    assert.equal(C.productUrl(id, at('https://www.costco.com/s')), '');
  }
  for (const url of ['https://sameday.costco.com/s', 'https://evil.example/s', 'https://user@www.costco.com/s', 'ftp://www.costco.com/s']) {
    assert.equal(C.productUrl('100493931', at(url)), '');
  }
});

test('Costco product panel anchor stays outside the immediate title and wishlist flex row', () => {
  const doc = createDocument('<div data-testid="product-description"><div class="title-row"><h1>Protein bars</h1><button>Add to list</button></div></div>');
  assert.equal(C.productAnchor(doc).getAttribute('data-testid'), 'product-description');
  assert.notEqual(C.productAnchor(doc), doc.querySelector('h1'));
  assert.equal(C.productAnchor(createDocument('<h1>Protein bars</h1>')).tagName, 'H1');
});

test('Costco search ignores off-store links and navigation even when they have valid item IDs', () => {
  const doc = createDocument(`<nav><a href="/p/-/bars/100423971">Promotion</a></nav><aside><a href="/p/-/bars/100423971">Recommendation</a></aside><footer><a href="/p/-/bars/100423971">Footer</a></footer><main><a href="https://evil.example/p/-/bars/100423971">Other</a><a href="/p/-/bars/100423971"><h3>Actual bars</h3></a><a href="/p/-/bars/100423971">Duplicate</a></main>`);
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].title, 'Actual bars');
});

test('Costco recommendations and sponsored sections cannot hide the actual search result with the same ID', () => {
  const doc = createDocument('<section data-testid="ProductRecommendations"><a href="/p/-/bars/100423971">Recommended bars</a></section><section aria-label="Related products"><a href="/p/-/oats/10055555">Related oats</a></section><section id="SponsoredProducts"><a href="/p/-/bars/100423971">Sponsored bars</a></section><main><article data-testid="ProductTile_100423971"><a href="/p/-/bars/100423971"><h3>Actual bars</h3></a></article></main>');
  const tiles = C.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, '100423971');
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

test('Costco direct Product URL identity catches stale SPA labels independently of warehouse SKU', () => {
  const json = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  const matching = { '@type': 'Product', url: product, sku: '1263673' };
  assert.equal(C.readProduct(createDocument(`${json(matching)}${label}`), at(product)).ingredients, 'almonds, cocoa, salt');
  for (const url of ['https://www.costco.com/p/-/oats/10055555', 'https://evil.example/p/-/bars/100423971', 'ftp://www.costco.com/p/-/bars/100423971', {}]) {
    const doc = createDocument(`<link rel="canonical" href="${product}">${json({ ...matching, url })}${label}`);
    assert.equal(C.readProduct(doc, at(product)).ingredients, '');
  }
});

test('Costco structured identity resumes when deferred Product URL catches up with the route', () => {
  const doc = createDocument(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', url: 'https://www.costco.com/p/-/oats/10055555' })}</script>${label}`);
  assert.equal(C.readProduct(doc, at(product)).ingredients, '');
  doc.querySelector('script').textContent = JSON.stringify({ '@type': 'Product', url: product });
  assert.equal(C.readProduct(doc, at(product)).ingredients, 'almonds, cocoa, salt');
});

test('Costco unrelated or incomplete structured metadata does not invent ingredients or block a valid DOM declaration', () => {
  for (const raw of ['{invalid', 'x'.repeat(256 * 1024 + 1), JSON.stringify({ '@type': 'BreadcrumbList', url: 'https://evil.example' }), JSON.stringify({ '@type': 'Product', sku: '1263673' })]) {
    const doc = createDocument(`<script type="application/ld+json">${raw}</script>${label}`);
    assert.equal(C.readProduct(doc, at(product)).ingredients, 'almonds, cocoa, salt');
  }
  const doc = createDocument(`<h1>Protein bars</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', url: product, description: 'Ingredients: almonds, salt' })}</script>`);
  assert.equal(C.readProduct(doc, at(product)).ingredients, '');
});

test('Costco scoped public product title outranks unrelated page headings', () => {
  const doc = createDocument('<aside><h1>Suggested oats</h1></aside><div data-testid="product-description"><h1>Kirkland Signature Protein Bars</h1><p>Item 1263673</p></div><section><h3>Ingredients</h3><p>almonds, salt</p></section>');
  assert.equal(C.readProduct(doc, at(product)).title, 'Kirkland Signature Protein Bars');
});

test('Costco recommendation product metadata cannot override current-page structured identity', () => {
  const main = JSON.stringify({ '@type': 'Product', url: product });
  const other = JSON.stringify({ '@type': 'Product', url: 'https://www.costco.com/p/-/oats/10055555' });
  const doc = createDocument(`<script type="application/ld+json">${main}</script><aside><script type="application/ld+json">${other}</script></aside><section data-testid="ProductRecommendations"><script type="application/ld+json">${other}</script></section>${label}`);
  assert.equal(C.readProduct(doc, at(product)).ingredients, 'almonds, cocoa, salt');
});

test('Costco ingredient-looking image alt, marketing and serialized script data stay unscored', () => {
  const doc = createDocument('<h1>Protein bars</h1><img alt="Ingredients: almonds"><script type="application/ld+json">{"ingredients":"almonds"}</script><p>Made with almonds</p><button aria-expanded="false">Nutritional Facts</button>');
  const data = C.readProduct(doc, at(product));
  assert.equal(data.ingredients, '');
  assert.equal(data.label, 'collapsed');
  assert.equal(C.labelToggle(doc).innerText, 'Nutritional Facts');
});
