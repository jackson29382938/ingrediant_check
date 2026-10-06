'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
require('../src/stores/walmart.js');
require('../src/stores/costco.js');
require('../src/stores/grocery.js');
const separate = Object.fromEntries(['target', 'walmart', 'costco', 'instacart'].map(id => [id, globalThis.AIR.storeAdapters[id]]));
const adapters = require('../src/stores/grocery-pages.js');
const { createDocument, loadPage } = require('./pages/load.js');
const manifest = require('../manifest.json');
const banners = { kroger: 'kroger.com', frys: 'frysfood.com', ralphs: 'ralphs.com', kingsoopers: 'kingsoopers.com', smiths: 'smithsfoodanddrug.com', fredmeyer: 'fredmeyer.com' };
const at = href => ({ href, hostname: new URL(href).hostname, pathname: new URL(href).pathname });
const fixture = fs.readFileSync('tests/pages/bottom-five/qfc-search.html', 'utf8');

test('all eleven grocery enhancements keep the top-five pipelines intact', () => {
  assert.equal(Object.keys(adapters).length, 11);
  for (const [id, adapter] of Object.entries(separate)) assert.equal(globalThis.AIR.storeAdapters[id], adapter, id);
  for (const cs of manifest.content_scripts.filter(cs => cs.js.includes('src/content/main.js'))) assert.equal(cs.js.includes('src/stores/grocery-pages.js'), false);
});

for (const [id, host] of Object.entries(banners)) {
  test(`${id}: both search route forms are injected and discover unclipped product cards`, () => {
    const a = adapters[id];
    for (const path of ['/search?query=chips', '/search/?query=chips&page=2']) {
      assert.equal(a.isSearchPage(at(`https://www.${host}${path}`)), true);
      assert.equal(a.searchQuery(at(`https://www.${host}${path}`)), 'chips');
    }
    const cs = manifest.content_scripts.find(cs => cs.js.includes('src/stores/grocery-pages.js'));
    assert.ok(cs.matches.includes(`https://www.${host}/search/*`));
    const tiles = a.searchTiles(createDocument(fixture));
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0].anchor.tagName, 'DIV');
    assert.equal(tiles[0].tile.getAttribute('data-testid'), 'product-card-0');
    assert.equal(a.productUrl(tiles[0].id, at(`https://www.${host}/search?query=chips`)),
      `https://www.${host}/p/doritos-nacho-cheese-tortilla-chips/0002840051646?fulfillment=PICKUP`);
  });
  test(`${id}: product labels, exact nutrition and identity checks survive the search enhancement`, () => {
    const a = adapters[id], loc = at(`https://www.${host}/p/whole-grain-oats/0003000001020`);
    const data = a.readProduct(loadPage('kroger-public-oats.html'), loc);
    assert.equal(data.ingredients, 'Whole Grain Rolled Oats.');
    assert.equal(data.nutrition.servingGrams, 40); assert.equal(data.nutrition.protein, 5);
    assert.equal(data.advisoryText, 'Contains Oats');
    const stale = `<link rel="canonical" href="https://www.${host}/p/other/0003000009999"><h1>Oats</h1><h3>Ingredients</h3><p>oats</p>`;
    assert.equal(a.readProduct(createDocument(stale), loc).ingredients, '');
    assert.equal(a.productId(`https://www.${host}.evil.example/p/oats/0003000001020`), '');
  });
  test(`${id}: recycled cards replace the old product URL and never accept foreign/private links`, () => {
    const a = adapters[id], doc = createDocument(fixture), loc = at(`https://www.${host}/search?query=chips`);
    let [tile] = a.searchTiles(doc);
    assert.match(a.productUrl(tile.id, loc), /doritos-nacho-cheese/);
    for (const link of doc.querySelectorAll('a[href]')) link.setAttribute('href', '/p/whole-grain-oats/0003000001020?fulfillment=DELIVERY');
    [tile] = a.searchTiles(doc);
    assert.equal(tile.id, '0003000001020');
    assert.equal(a.productUrl(tile.id, loc), `https://www.${host}/p/whole-grain-oats/0003000001020?fulfillment=DELIVERY`);
    for (const link of doc.querySelectorAll('a[href]')) link.setAttribute('href', 'https://www.evil.example/p/oats/0003000001020');
    assert.equal(a.searchTiles(doc).length, 0);
    assert.equal(a.isSearchPage(at(`https://www.${host}/account?query=chips`)), false);
  });
}
