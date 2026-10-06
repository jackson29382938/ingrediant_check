'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const original = require('../src/stores/grocery.js');
const before = { ...globalThis.AIR.storeAdapters };
const stores = require('../src/stores/grocery-bottom-five.js');
const { createDocument } = require('./pages/load.js');
const manifest = require('../manifest.json');
const ids = ['qfc', 'harristeeter', 'dillons', 'safeway', 'albertsons'];
const at = href => ({ href, hostname: new URL(href).hostname, pathname: new URL(href).pathname });
const fixtureModel = (store, kind = 'oats') => JSON.parse(fs.readFileSync(`tests/pages/bottom-five/${store}-${kind}.json`, 'utf8'));
const flight = response => `<script>self.__next_f.push(${JSON.stringify([1, '14:' + JSON.stringify(['$', '$L2f', null, { isSSR: true, initialPdpResponse: response }]) + '\n']).replace(/</g, '\\u003c')})</script>`;
const product = (store, response) => `<link rel="canonical" href="https://www.${store}.com/shop/pd/oats/111050071"><main><div data-bpn="111050071"><div class="product-info"></div></div></main>${flight(response)}`;

test('bottom-five enhancement leaves every other store adapter unchanged', () => {
  assert.deepEqual(Object.keys(stores), ids);
  for (const [id, adapter] of Object.entries(before)) if (!ids.includes(id)) assert.equal(globalThis.AIR.storeAdapters[id], adapter, id);
  assert.equal(original.kroger, before.kroger);
});

test('modern Albertsons banner routes accept only public store-bound product IDs', () => {
  for (const id of ['safeway', 'albertsons']) {
    const a = stores[id];
    for (const path of ['/shop/pd/rolled-oats/111050071', '/shop/pd/product/111050071', '/shop/product-details.111050071.html']) {
      assert.equal(a.productId(`https://www.${id}.com${path}`), '111050071');
      assert.equal(a.isProductPage(at(`https://www.${id}.com${path}`)), true);
    }
    for (const url of [`https://www.${id}.com/shop/pd/account/111050071`, `https://www.${id}.com/shop/pd/oats/111050071/checkout`,
      `https://www.${id}.com.evil.example/shop/pd/oats/111050071`, `https://user:pass@www.${id}.com/shop/pd/oats/111050071`,
      `ftp://www.${id}.com/shop/pd/oats/111050071`, `https://www.${id}.com/shop/pd/oats/not-an-id`]) assert.equal(a.productId(url), '', url);
  }
});

test('manifest actually injects the enhancement on modern products and trailing-slash searches', () => {
  const cs = manifest.content_scripts.find(cs => cs.js.includes('src/stores/grocery-bottom-five.js'));
  assert.ok(cs.js.indexOf('src/stores/grocery.js') < cs.js.indexOf('src/stores/grocery-bottom-five.js'));
  assert.ok(cs.js.indexOf('src/stores/grocery-bottom-five.js') < cs.js.indexOf('src/content/retailer.js'));
  for (const host of ['qfc.com', 'harristeeter.com', 'dillons.com']) assert.ok(cs.matches.includes(`https://www.${host}/search/*`));
  for (const host of ['safeway.com', 'albertsons.com']) assert.ok(cs.matches.includes(`https://www.${host}/shop/pd/*`));
});

test('observed public Next Flight oats/chips declarations score without a rendered h1', () => {
  for (const id of ['safeway', 'albertsons']) for (const kind of ['oats', 'chips']) {
    const r = fixtureModel(id, kind), p = r.catalog.response.docs[0];
    const href = `https://www.${id}.com/shop/pd/product/${p.id}`;
    const doc = createDocument(`<main><div data-bpn="${p.id}"><div class="product-info"></div></div></main>${flight(r)}`);
    const data = stores[id].readProduct(doc, at(href));
    assert.equal(data.id, p.id); assert.equal(data.title, p.name);
    assert.equal(data.ingredients, p.productDetail.details.find(d => d.header === 'Ingredients').value);
    assert.equal(data.label, 'open'); assert.ok(stores[id].productAnchor(doc));
    assert.ok(data.nutrition); assert.equal(data.nutrition.protein, kind === 'oats' ? 5 : 2);
    assert.equal(data.nutrition.servingGrams, undefined, 'cup/chip serving is not guessed from package weight');
  }
});

test('public model rejects stale IDs, mixed catalogs, missing identity and unavailable catalog entries', () => {
  for (const change of [r => { r.catalog.response.docs[0].pid = '999999999'; }, r => { delete r.catalog.response.docs[0].id; },
    r => { r.catalog.response.docs.push(r.catalog.response.docs[0]); }, r => { r.catalog.response.numFound = 0; }]) {
    const r = fixtureModel('safeway'); change(r);
    const data = stores.safeway.readProduct(createDocument(product('safeway', r)), at('https://www.safeway.com/shop/pd/oats/111050071'));
    assert.equal(data.ingredients, ''); assert.equal(data.nutrition, null);
  }
});

test('canonical and page wrapper mismatches refuse identity-bound labels', () => {
  for (const markup of [product('safeway', fixtureModel('safeway')).replace('href="https://www.safeway.com/shop/pd/oats/111050071"', 'href="https://www.safeway.com/shop/pd/oats/999999999"'),
    product('safeway', fixtureModel('safeway')).replace('data-bpn="111050071"', 'data-bpn="999999999"')]) {
    assert.equal(stores.safeway.readProduct(createDocument(markup), at('https://www.safeway.com/shop/pd/oats/111050071')).ingredients, '');
  }
});

test('duplicate disagreeing public models and conflicting ingredients stay unknown', () => {
  const r = fixtureModel('safeway'), changed = fixtureModel('safeway');
  changed.catalog.response.docs[0].productDetail.details[0].value = 'sugar, salt';
  const href = at('https://www.safeway.com/shop/pd/oats/111050071');
  assert.equal(stores.safeway.readProduct(createDocument(product('safeway', r) + flight(changed)), href).ingredients, '');
  r.catalog.response.docs[0].productDetail.details.push({ header: 'Ingredients', value: 'sugar, salt' });
  assert.equal(stores.safeway.readProduct(createDocument(product('safeway', r)), href).ingredients, '');
});

test('script text, malformed Flight data, unresolved references and marketing do not become ingredients', () => {
  const href = at('https://www.safeway.com/shop/pd/oats/111050071');
  for (const value of ['$33', '<p>oats</p>', 'x'.repeat(6001)]) {
    const r = fixtureModel('safeway'); r.catalog.response.docs[0].productDetail.details[0].value = value;
    assert.equal(stores.safeway.readProduct(createDocument(product('safeway', r)), href).ingredients, '');
  }
  const raw = '<h1>Oats</h1><script>self.__next_f.push([1,"broken initialPdpResponse"]);globalThis.__bad=true</script><p>Ingredients you will love</p>';
  assert.equal(stores.safeway.readProduct(createDocument(raw), href).ingredients, '');
  assert.equal(globalThis.__bad, undefined);
});

test('observed nested nutrient quantities convert explicit units and never substitute daily percentages', () => {
  const r = fixtureModel('safeway');
  const facts = r.nutritionPanels[0].nutritionFacts;
  facts.dailyValue.push({ nutritionName: 'Sodium', quantity: '0', uom: 'mg', percentage: '90' });
  facts.servingDetails = { servingSizeText: '40', servingSizeUOM: 'g' };
  const data = stores.safeway.readProduct(createDocument(product('safeway', r)), at('https://www.safeway.com/shop/pd/oats/111050071'));
  assert.deepEqual(data.nutrition, { saturatedFat: 0.5, transFat: 0, sodium: 0, carbs: 27, fibre: 4, sugar: 1, addedSugar: 0, protein: 5, servingGrams: 40 });
});

test('conflicting, invalid and ambiguous nutrition quantities remain unknown independently', () => {
  const r = fixtureModel('safeway');
  r.nutritionPanels[0].nutritionFacts.dailyValue.push({ nutritionName: 'Sodium', quantity: '12', uom: 'mg' }, { nutritionName: 'Protein', quantity: '-5', uom: 'g' });
  const href = at('https://www.safeway.com/shop/pd/oats/111050071');
  let data = stores.safeway.readProduct(createDocument(product('safeway', r)), href);
  assert.equal(data.nutrition.sodium, undefined); assert.equal(data.nutrition.protein, undefined);
  r.nutritionPanels.push(r.nutritionPanels[0]);
  data = stores.safeway.readProduct(createDocument(product('safeway', r)), href);
  assert.equal(data.nutrition, null); assert.equal(data.ingredients, 'Whole Grain Rolled Oats.');
});

test('visible product label replaces hydration text without including dialogs or recommendations', () => {
  const html = product('safeway', fixtureModel('safeway')).replace('<div class="product-info"></div>', '<div class="product-info"><h3>Ingredients</h3><p>oats, sugar, salt</p></div>') +
    '<div role="dialog"><h1>Sign in</h1><h3>Ingredients</h3><p>soap</p></div><aside><h3>Ingredients</h3><p>almonds</p></aside>';
  const data = stores.safeway.readProduct(createDocument(html), at('https://www.safeway.com/shop/pd/oats/111050071'));
  assert.equal(data.ingredients, 'oats, sugar, salt'); assert.match(data.title, /Quaker/);
  assert.equal(data.nutrition, null, 'changed visible ingredients cannot borrow the old declaration\'s nutrition');
});

test('recommended and hidden declarations inside the product area cannot replace its public label', () => {
  const html = product('safeway', fixtureModel('safeway')).replace('<div class="product-info"></div>',
    '<div class="product-info"><div class="recommended-products"><h3>Ingredients</h3><p>soap</p></div><section style="display:none"><h3>Ingredients</h3><p>almonds</p></section></div>');
  const data = stores.safeway.readProduct(createDocument(html), at('https://www.safeway.com/shop/pd/oats/111050071'));
  assert.equal(data.ingredients, 'Whole Grain Rolled Oats.');
});

test('report capture recognizes modern products while refusing private-looking slugs', () => {
  const registry = require('../src/stores/registry.js');
  for (const id of ['safeway', 'albertsons']) {
    assert.equal(registry.reportMayCapture(`https://www.${id}.com/shop/pd/oats/111050071`), true);
    for (const slug of ['account', 'login', 'cart', 'checkout', 'orders']) assert.equal(registry.reportMayCapture(`https://www.${id}.com/shop/pd/${slug}/111050071`), false);
  }
});

test('observed Kroger banner cards mount outside truncated links and preserve actual product URLs', () => {
  for (const id of ['qfc', 'harristeeter', 'dillons']) {
    const html = fs.readFileSync(`tests/pages/bottom-five/${id === 'harristeeter' ? 'qfc' : id}-search.html`, 'utf8');
    const doc = createDocument(html), tiles = stores[id].searchTiles(doc);
    assert.equal(tiles.length, 1, id); const tile = tiles[0];
    assert.equal(tile.tile.getAttribute('data-testid'), 'product-card-0');
    assert.equal(tile.anchor.tagName, 'DIV'); assert.equal(tile.badgePlacement, 'inline');
    const url = stores[id].productUrl(tile.id, at(`https://www.${id}.com/search?query=chips`));
    assert.match(url, /\/p\/doritos-nacho-cheese-tortilla-chips\/0002840051646\?fulfillment=PICKUP$/);
  }
});

test('modern Safeway/Albertsons search links stay on their own origin and accept filters/pagination', () => {
  for (const id of ['safeway', 'albertsons']) {
    const doc = createDocument('<div class="product-card"><div class="product-description"><a href="/shop/pd/rolled-oats/111050071?loc=3132"><h3>Whole grain oats</h3></a></div><button>Add</button></div>');
    const tiles = stores[id].searchTiles(doc);
    assert.equal(tiles.length, 1); assert.equal(tiles[0].anchor.className, 'product-description');
    assert.equal(stores[id].productUrl('111050071', at(`https://www.${id}.com/shop/search-results.html?q=oats&page=2`)), `https://www.${id}.com/shop/pd/rolled-oats/111050071?loc=3132`);
    assert.equal(stores[id].isSearchPage(at(`https://www.${id}.com/shop/search-results.html?q=oats&page=2`)), true);
  }
});

test('mixed cards, hidden controls and recommendations cannot receive a bottom-five search score', () => {
  for (const id of ids) {
    const a = stores[id], url = a.productUrl('0003000001020'), other = a.productUrl('0003000009999');
    const doc = createDocument(`<nav><a href="${url}">Oats</a></nav><div class="recommended-products"><a href="${url}">Oats</a></div><div hidden><a href="${url}">Oats</a></div><div class="product-card"><a href="${url}">Oats</a><a href="${other}">Other oats</a></div>`);
    assert.equal(a.searchTiles(doc).length, 0, id);
  }
});

test('image-only bottom-five cards use corner badges outside image links', () => {
  for (const id of ids) {
    const a = stores[id], url = a.productUrl('0003000001020');
    const doc = createDocument(`<div class="product-card"><a href="${url}" aria-label="Whole grain oats"><img alt="Whole grain oats"></a><button>Add</button></div>`);
    const [tile] = a.searchTiles(doc);
    assert.equal(tile.anchor.className, 'product-card'); assert.equal(tile.badgePlacement, 'corner');
  }
});
