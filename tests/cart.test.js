'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
require('../src/stores/walmart.js');
require('../src/stores/costco.js');
require('../src/stores/grocery.js');
require('../src/stores/grocery-pages.js');
const stores = require('../src/stores/registry.js');
const cart = require('../src/stores/cart.js');
const { createDocument } = require('./pages/load.js');
const manifest = require('../manifest.json');
const paths = { amazon: '/dp/B000000001', target: '/p/oats/-/A-79364857', walmart: '/ip/oats/10314926', costco: '/p/-/oats/100423971', instacart: '/products/2695935-oats?retailerSlug=dillons', safeway: '/shop/pd/product/111050071', albertsons: '/shop/pd/product/111050071' };
for (const s of stores.STORES) {
  const host = s.domains[0], route = paths[s.id] || '/p/oats/0003000001020';
  test(`${s.name}: cart line identity and route exclude private data and unrelated links`, () => {
    const loc = new URL(`https://www.${host}/cart`);
    assert.equal(cart.isCartPage(loc), true);
    const doc = createDocument(`<main><article data-testid="cart-item"><a href="${route}">Whole grain oats</a><input value="2"><span>$5</span></article><div id="recommendations"><article data-testid="cart-item"><a href="${route}">More oats</a></article></div><a href="#">Checkout</a></main>`);
    const t = cart.tiles(doc, loc);
    assert.equal(t.length, 1); assert.equal(t[0].title, 'Whole grain oats');
    assert.equal(new URL(t[0].url).origin, loc.origin);
    for (const path of ['/checkout', '/account/cart', '/orders', '/login', '/cart/checkout']) assert.equal(cart.allowed(new URL(loc.origin + path)), false);
    assert.equal(stores.reportMayCapture(loc.href), false, 'cart screenshots remain opt-in');
    assert.equal(cart.tiles(createDocument(`<article data-testid="cart-item"><a href="https://evil.example${route}">Oats</a></article>`), loc).length, 0);
    assert.equal(cart.tiles(createDocument(`<article data-testid="cart-item"><a href="${route}">Oats</a></article>`), new URL(`https://www.${host}.evil.example/cart`)).length, 0);
    assert.ok(manifest.content_scripts.some(cs => cs.js.includes('src/content/cart.js') && cs.matches.includes(`https://www.${host}/cart`)));
  });
}
test('cart drawers work on product/search pages; stray cart-like cards do not', () => {
  const loc = new URL('https://www.target.com/s?searchTerm=oats');
  const row = '<article data-testid="cart-item"><a href="/p/oats/-/A-79364857">Oats</a></article>';
  assert.equal(cart.tiles(createDocument(row), loc).length, 0);
  assert.equal(cart.tiles(createDocument(`<aside data-testid="cart-drawer">${row}</aside>`), loc).length, 1);
  const mixed = '<article data-testid="cart-item"><a href="/p/oats/-/A-79364857">Oats</a><a href="/p/chips/-/A-16600402">Chips</a></article>';
  assert.equal(cart.tiles(createDocument(mixed), new URL('https://www.target.com/cart')).length, 0);
});
test('two cart lines of the same product can each display a rating without titles absorbing badges', () => {
  const doc = createDocument('<article data-testid="cart-item"><a href="/ip/oats/10314926">Oats <span class="air-cart-badge">98</span></a></article><article data-testid="cart-item"><a href="/ip/oats/10314926">Oats</a></article>');
  const items = cart.tiles(doc, new URL('https://www.walmart.com/cart'));
  assert.equal(items.length, 2); assert.deepEqual(items.map(x => x.title), ['Oats', 'Oats']);
});
test('all Amazon locales and retailer-specific cart routes are scoped', () => {
  for (const host of stores.STORES[0].domains) assert.equal(cart.isCartPage(new URL(`https://www.${host}/gp/cart/view.html`)), true);
  for (const url of ['https://www.costco.com/CartView', 'https://www.safeway.com/shop/cart.html', 'https://www.instacart.com/store/dillons/cart']) assert.equal(cart.isCartPage(new URL(url)), true);
});
test('Amazon cart markup accepts title-slug product links and skips saved-for-later items', () => {
  const doc = createDocument('<div id="sc-active-cart"><div class="sc-list-item" data-asin="B000000001"><a href="/Organic-Oats/dp/B000000001/ref=cart_title"><span class="sc-product-title">Organic oats</span></a></div></div><div id="sc-saved-cart"><div class="sc-list-item" data-asin="B000000002"><a href="/dp/B000000002">Saved oats</a></div></div>');
  const items = cart.tiles(doc, new URL('https://www.amazon.com/gp/cart/view.html'));
  assert.equal(items.length, 1); assert.equal(items[0].id, 'B000000001');
  assert.equal(items[0].url, 'https://www.amazon.com/dp/B000000001');
});
test('semantic cart rows support markup without retailer test attributes and exclude hidden rows', () => {
  const doc = createDocument('<ul><li><a href="/ip/oats/10314926">Oats</a></li><li hidden><a href="/ip/chips/10314927">Chips</a></li></ul>');
  const items = cart.tiles(doc, new URL('https://www.walmart.com/cart'));
  assert.equal(items.length, 1); assert.equal(items[0].id, '10314926');
});
