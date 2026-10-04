'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/stores/target.js');
const { createDocument } = require('./pages/load.js');
const sample = require('./pages/target-search-product-model.json');
const url = 'https://www.target.com/p/-/A-16600402';
function page({ id = '16600402', variants = [structuredClone(sample)], extra = '', key = 'platform/domain-cdui-orchestrations/fetch-cdui-layout-v1' } = {}) {
  const data = { props: { dehydratedState: { queries: [{ queryKey: [key, { tcin: id }], state: { data: { data: {
    data_source_modules: [{ module_type: 'ProductDetailWebDatasourceCore', module_data: { data: { product: { tcin: '1012844978', children: variants } } } }],
  } } } }] } } };
  const doc = createDocument(`<title>${sample.item.product_description.title} : Target</title>${extra}<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
  doc.querySelector("#__NEXT_DATA__").textContent = JSON.stringify(data);
  return doc;
}
test('Target public hydration exposes the exact child ingredients and explicit nutrition without opening an accordion', () => {
  const data = T.readProduct(page(), new URL(url));
  assert.equal(data.ingredients, 'POTATOES, AVOCADO OIL, SEA SALT.');
  assert.equal(data.nutrition.sodium, 120);
  assert.equal(data.nutrition.sugar, 0);
  assert.ok(Math.abs(data.nutrition.servingGrams - 28.3495) < 0.001);
});
test('Target public hydration never borrows a parent, sibling, foreign buy URL, or different query product', () => {
  const wrongVariant = structuredClone(sample); wrongVariant.tcin = '99999999';
  const foreign = structuredClone(sample); foreign.item.enrichment.buy_url = 'https://evil.example/p/-/A-16600402';
  for (const doc of [page({ id: '99999999' }), page({ variants: [wrongVariant] }), page({ variants: [foreign] }),
    page({ key: 'some-other-query' }), page({ extra: '<link rel="canonical" href="https://www.target.com/p/-/A-99999999">' })]) {
    const data = T.readProduct(doc, new URL(url));
    assert.equal(data.ingredients, ''); assert.equal(data.nutrition, null);
  }
});
test('Target contradictory current-product declarations and ambiguous prepared nutrition remain unknown', () => {
  const changed = structuredClone(sample); changed.item.enrichment.nutrition_facts.ingredients = 'sugar, salt';
  assert.equal(T.readProduct(page({ variants: [sample, changed] }), new URL(url)).ingredients, '');
  const two = structuredClone(sample); two.item.enrichment.nutrition_facts.value_prepared_list.push(structuredClone(two.item.enrichment.nutrition_facts.value_prepared_list[0]));
  const data = T.readProduct(page({ variants: [two] }), new URL(url));
  assert.equal(data.ingredients, 'POTATOES, AVOCADO OIL, SEA SALT.'); assert.equal(data.nutrition, null);
});
test('Target search fallback reads unwrapped title links and excludes hidden variants', () => {
  const doc = createDocument('<a href="/p/chips/-/A-16600402" data-test="product-title">Chips</a><div hidden><a href="/p/oats/-/A-79364857"><h3>Hidden oats</h3></a></div>');
  assert.deepEqual(T.searchTiles(doc).map(tile => [tile.id, tile.title]), [['16600402', 'Chips']]);
});

test('Target public declared quantities preserve comparison signs and later allergens', () => {
  const variant = structuredClone(sample);
  variant.item.enrichment.nutrition_facts.ingredients = 'Potatoes, <2% peanut flour, salt (>0g)';
  assert.equal(T.readProduct(page({ variants: [variant] }), new URL(url)).ingredients, 'Potatoes, <2% peanut flour, salt (>0g)');
});
