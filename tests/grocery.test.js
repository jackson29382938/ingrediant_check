'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const stores = require('../src/stores/grocery.js');
const { createDocument } = require('./pages/load.js');
const at = href => ({ href, hostname: new URL(href).hostname, pathname: new URL(href).pathname });
const url = 'https://www.kroger.com/p/quaker-old-fashioned-oats/0003000001020';
const product = '<h1 data-testid="product-details-name">Quaker Old Fashioned Oats</h1><section><h3>Ingredients</h3><p>Whole Grain Rolled Oats.</p><h3>Allergen Info</h3><p>Contains Oats.</p><h3>Disclaimer</h3><p>Marketing sugar-free claims.</p></section>';
function nutrient(title, amount) {
  return `<div class="NutrientDetail-TitleAndAmount"><span class="NutrientDetail-Title">${title}</span><span class="NutrientDetail-Amount">${amount}</span><span>20%</span></div>`;
}
function nutrition(rows, size = '1/2 cup dry (40g)') {
  return `<div data-testid="nutrition-facts-container"><div class="NutritionLabel"><div class="NutritionLabel-ServingSize"><span>Serving size</span><span>${size}</span></div>${rows}</div></div>`;
}
test('twelve grocery adapters isolate hosts, public products, IDs and same-origin product URLs', () => {
  assert.equal(Object.keys(stores).length, 12);
  for (const adapter of Object.values(stores)) {
    const host = adapter.productUrl('0003000001020').split('/')[2];
    const route = adapter.productUrl('0003000001020');
    assert.equal(adapter.productId(route), '0003000001020', adapter.id);
    assert.equal(adapter.productUrl('0003000001020', at(route)), route);
    assert.equal(adapter.matchesHost(host), true);
    for (const invalid of [route.replace('https:', 'ftp:'), route.replace(host, host + '.evil.example'), route.replace(host, 'name:password@' + host), route + '/account', route.replace('0003000001020', 'bad-id')]) assert.equal(adapter.productId(invalid), '', invalid);
    for (const path of ['/account', '/cart', '/checkout', '/login', '/orders', '/search/account', '/store/cart/s']) {
      assert.equal(adapter.isProductPage(at(`https://${host}${path}`)), false);
      if (path !== '/store/cart/s') assert.equal(adapter.isSearchPage(at(`https://${host}${path}`)), false);
    }
    assert.equal(adapter.productUrl('../account'), '');
  }
  assert.equal(stores.frys.productId(url), '');
  assert.equal(stores.kroger.productId('https://www.kroger.com/p/oats/000300000102'), '000300000102');
});
test('Instacart product and item routes and Albertsons canonical formats remain store bound', () => {
  assert.equal(stores.instacart.searchQuery(at('https://www.instacart.com/store/s?k=organic+rolled+oats')), 'organic rolled oats');
  assert.equal(stores.instacart.searchQuery(at('https://www.instacart.com/store/account?k=chips')), '');
  for (const route of ['/products/169289-oats', '/store/products/169289-oats', '/store/items/169289-oats', '/store/retailer/items/169289-oats']) assert.equal(stores.instacart.productId('https://www.instacart.com' + route), '169289');
  assert.equal(stores.instacart.productId('https://www.instacart.com/store/products/bad/169289'), '');
  assert.equal(stores.safeway.productId('https://www.safeway.com/shop/product-details.184710125.html'), '184710125');
  assert.equal(stores.safeway.productId('https://www.safeway.com/shop/pd/product/184710125'), '184710125');
  assert.equal(stores.albertsons.productId('https://www.safeway.com/shop/pd/product/184710125'), '');
});
test('public grocery search routes expose queries without accepting private paths', () => {
  for (const adapter of Object.values(stores)) {
    const host = new URL(adapter.productUrl('0003000001020')).hostname;
    const path = adapter.id === 'instacart' ? '/store/retailer/s?query=oats' : ['safeway', 'albertsons'].includes(adapter.id) ? '/shop/search-results.html?q=oats' : '/search?query=oats';
    const loc = at(`https://${host}${path}`);
    assert.equal(adapter.isSearchPage(loc), true, adapter.id);
    assert.equal(adapter.searchQuery(loc), 'oats');
    assert.equal(adapter.searchQuery(at(`https://${host}/account?query=private`)), '');
  }
});
test('Kroger family reads observed declaration, advisory and exact nutrient quantities independently', () => {
  const doc = createDocument(product + nutrition(nutrient('Sodium', '1,200mg') + nutrient('Saturated Fat', '500mg') + nutrient('Sugar', '1g') + nutrient('Added Sugar', '0g') + nutrient('Dietary Fiber', '4g') + nutrient('Protein', '5g')));
  const data = stores.kroger.readProduct(doc, at(url));
  assert.equal(data.ingredients, 'Whole Grain Rolled Oats.');
  assert.equal(data.advisoryText, 'Contains Oats');
  assert.deepEqual(data.nutrition, { sodium: 1200, saturatedFat: 0.5, sugar: 1, addedSugar: 0, fibre: 4, protein: 5, servingGrams: 40 });
  assert.equal(data.labelText.includes('Disclaimer'), false);
});
test('missing, conflicting or ambiguous nutrition values remain unknown', () => {
  const adapter = stores.kroger;
  const rows = nutrient('Sodium', '20%') + nutrient('Sugar', '2g') + nutrient('Sugar', '5g') + nutrient('Protein', '-1g');
  const data = adapter.readProduct(createDocument(product + nutrition(rows, '1/2 cup')), at(url));
  assert.equal(data.nutrition, null);
  assert.equal(adapter.readProduct(createDocument(product + nutrition(nutrient('Protein', '5g')) + nutrition(nutrient('Protein', '10g'))), at(url)).nutrition, null);
  assert.equal(adapter.readProduct(createDocument(product + nutrition(nutrient('Protein', '5g'), '120ml')), at(url)).nutrition.servingMl, 120);
});
test('stale canonical or direct Product identities cannot supply declarations or nutrition', () => {
  const stale = url.replace('0003000001020', '0003000009999');
  for (const record of [`<link rel="canonical" href="${stale}">`, `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'Product', url: stale }] })}</script>`]) {
    const data = stores.kroger.readProduct(createDocument(record + product + nutrition(nutrient('Sugar', '1g'))), at(url));
    assert.equal(data.ingredients, '');
    assert.equal(data.nutrition, null);
  }
  const valid = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', url })}</script>`;
  assert.equal(stores.kroger.readProduct(createDocument(valid + product), at(url)).ingredients, 'Whole Grain Rolled Oats.');
});
test('recommendation and hidden declarations cannot supply main-product ingredients or nutrition', () => {
  const doc = createDocument(`<h1>Oats</h1><aside>${product}</aside><section hidden>${product}</section><div data-testid="recommended-products">${nutrition(nutrient('Sugar', '10g'))}</div>`);
  const data = stores.kroger.readProduct(doc, at(url));
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
  assert.equal(stores.kroger.readProduct(createDocument(`<div hidden>${product}</div>`), at(url)).title, '');
});
test('grocery searches deduplicate title and image links and exclude unrelated mixed cards', () => {
  const a = '/p/oats/0003000001020', b = '/p/bars/0003000009999';
  const doc = createDocument(`<nav><a href="${a}">Navigation oats</a></nav><div data-testid="recommended-products"><a href="${b}">Recommended bars</a></div><div data-testid="product-card"><a href="${a}"><img alt="Oats"></a><a href="${a}"><h3>Whole Grain Oats</h3></a></div><div data-testid="product-card"><a href="${b}">Bars</a><a href="${a}">Other oats</a></div>`);
  const tiles = stores.kroger.searchTiles(doc);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].title, 'Whole Grain Oats');
  assert.equal(tiles[0].id, '0003000001020');
  assert.equal(tiles[0].el.getAttribute('data-testid'), 'product-card');
  assert.equal(tiles[0].anchor.tagName, 'H3');
});
test('malformed JSON and missing visible labels never become ingredient script text', () => {
  const doc = createDocument('<h1>Oats</h1><script type="application/ld+json">{broken ingredients: sugar}</script><p>Ingredients you will love</p><script>{"ingredients":"sugar"}</script>');
  const data = stores.kroger.readProduct(doc, at(url));
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
});

test('grocery allergen declarations keep positive warnings separate from negated claims', () => {
  const doc = createDocument('<h1>Oats</h1><h3>Allergen Info</h3><p>Contains soy but does not contain milk. May contain peanuts.</p>');
  const data = stores.kroger.readProduct(doc, at(url));
  assert.equal(data.advisoryText, 'Contains soy. May contain peanuts');
  assert.equal(/milk/.test(data.advisoryText), false);
});

test('observed public oats declaration and nutrition works across all nine Kroger-family banners', () => {
  const { loadPage } = require('./pages/load.js');
  for (const id of ['kroger', 'frys', 'ralphs', 'kingsoopers', 'smiths', 'fredmeyer', 'qfc', 'harristeeter', 'dillons']) {
    const adapter = stores[id];
    const data = adapter.readProduct(loadPage('kroger-public-oats.html'), at(adapter.productUrl('0003000001020')));
    assert.equal(data.ingredients, 'Whole Grain Rolled Oats.', id);
    assert.equal(data.nutrition.servingGrams, 40, id);
    assert.equal(data.nutrition.protein, 5, id);
    assert.equal(data.advisoryText, 'Contains Oats', id);
  }
});

// ---------------------------------------------------------------- Instacart page state
// Instacart renders the label with scripts, but its page state (a percent-encoded Apollo cache) carries it
// in the HTML, so a page fetched without running scripts can still be read (found on the live site).
const icUrl = 'https://www.instacart.com/products/17848209-organic-rolled-oats-bulk-1-lb?retailerSlug=sprouts';
const icCanonical = '<link rel="canonical" href="https://www.instacart.com/store/products/17848209-organic-rolled-oats-bulk-1-lb">';
const icState = (id, ingredients, warnings = 'Produced In A Facility That Handles Allergens-Wheat, Soy, and Tree Nuts.') => {
  const sections = [{ bodyString: ingredients, headerString: 'Ingredients' }, { bodyString: warnings, headerString: 'Warnings' },
    { bodyString: 'Cook for 3 minutes.', headerString: 'Directions' }];
  const cache = { __META: { type: 'DocumentCache' }, ItemDetailData: { [JSON.stringify({ id, isFeatured: false, shopId: '2726' })]: { itemDetail: { viewSection: { detailSections: sections } } } } };
  return `<script id="node-apollo-state" type="application/json">${encodeURIComponent(JSON.stringify(cache))}</script>`;
};
const icPage = (state, body = '') => createDocument(`${icCanonical}<h1>Organic Rolled Oats</h1>${body}${state}`);

test('Instacart: a page nothing rendered is read from its page state, bound to the product in the URL', () => {
  const data = stores.instacart.readProduct(icPage(icState('items_40056-17848209', 'Organic Oats.')), at(icUrl));
  assert.equal(data.ingredients, 'Organic Oats.');
  assert.equal(data.label, 'open');
  assert.match(data.advisoryText, /Wheat/);
  assert.equal(data.title, 'Organic Rolled Oats');
});

test('Instacart: another item\'s state, a malformed state, or a wrong shape reads nothing', () => {
  for (const state of [icState('items_40056-99999999', 'Sugar.'), icState('items_x-17848209', 'Sugar.'), icState('17848209', 'Sugar.'),
    '<script id="node-apollo-state">%7Bnot json</script>', '<script id="node-apollo-state">%7B%22ItemDetailData%22%3A5%7D</script>', '']) {
    const data = stores.instacart.readProduct(icPage(state), at(icUrl));
    assert.equal(data.ingredients, '', state.slice(0, 60));
    assert.equal(data.label, 'missing');
  }
});

test('Instacart: a label the page shows wins over the page state, and other stores never read it', () => {
  const shown = '<section><h3>Ingredients</h3><p>Rolled Oats.</p></section>';
  const data = stores.instacart.readProduct(icPage(icState('items_40056-17848209', 'Sugar.'), shown), at(icUrl));
  assert.equal(data.ingredients, 'Rolled Oats.');
  const krogerPage = createDocument('<link rel="canonical" href="https://www.kroger.com/p/quaker-old-fashioned-oats/0003000001020"><h1 data-testid="product-details-name">Oats</h1>' + icState('items_40056-17848209', 'Sugar.'));
  assert.equal(stores.kroger.readProduct(krogerPage, at(url)).ingredients, '');
});

test('Instacart: an oversized or ingredient-less state is refused', () => {
  assert.equal(stores.instacart.readProduct(icPage(icState('items_40056-17848209', '')), at(icUrl)).ingredients, '');
  assert.equal(stores.instacart.readProduct(icPage(icState('items_40056-17848209', 'x'.repeat(4001))), at(icUrl)).ingredients, '');
});

test('a modal that marks the page aria-hidden does not hide a product that is on screen', () => {
  const L = require('../src/stores/label-reader.js') && globalThis.AIR.retailerLabels;
  const el = (hiddenRoot, layout) => ({ closest: sel => (sel.includes('[aria-hidden') && hiddenRoot ? {} : null),
    ownerDocument: { defaultView: layout ? {} : null }, getClientRects: layout ? () => [{}] : undefined });
  assert.equal(L.hiddenFromSight(el(true, true)), false, 'rendered: visible whatever the ancestors say');
  assert.equal(L.hiddenFromSight(el(true, false)), true, 'no layout: the attribute decides, as in saved test pages');
  assert.equal(L.hiddenFromSight(el(false, true)), false);
  const notRendered = { closest: sel => (sel.includes('[aria-hidden') ? {} : null), ownerDocument: { defaultView: {} }, getClientRects: () => [] };
  assert.equal(L.hiddenFromSight(notRendered), true, 'aria-hidden and not rendered stays hidden');
  assert.equal(L.hiddenFromSight({ closest: sel => (sel === '[hidden]' ? {} : null) }), true, '[hidden] always hides');
  assert.equal(L.hiddenFromSight(null), false);
});
