'use strict';
// Walmart and Target: how the extension reaches a search that starts on another page, and what the sort panel
// reads from a result card. The panel's behaviour in a real browser (docking, ranking, the unit picker, ads
// hidden) is scripts/retailer-sort-harness.mjs; this file covers the parts that need no browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/stores/target.js');
require('../src/stores/label-reader.js');
const U = require('../src/engine/db/unit-price.js');
const W = require('../src/stores/walmart.js');
const T = globalThis.AIR.storeAdapters.target;
const L = globalThis.AIR.retailerLabels;
const { createDocument, loadPage } = require('./pages/load.js');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const entry = manifest.content_scripts.find(cs => cs.matches.includes('https://www.target.com/p/*'));
const pathOf = pattern => new URL(pattern.replace('*', 'x')).pathname;

test('Walmart and Target are injected on the public pages a search starts from, not only on results', () => {
  // Both sites are single-page apps: a search typed in the header changes the address without loading a page, so a
  // script that matched only /search or /s was never present for a search started on the home or a category page.
  for (const host of ['www.walmart.com', 'walmart.com']) {
    for (const route of ['/', '/?*', '/browse/*', '/cp/*', '/shop/*', '/search', '/ip/*']) assert.ok(entry.matches.includes(`https://${host}${route}`), `${host}${route}`);
  }
  for (const host of ['www.target.com', 'target.com']) {
    for (const route of ['/', '/?*', '/c/*', '/pl/*', '/b/*', '/s', '/p/*']) assert.ok(entry.matches.includes(`https://${host}${route}`), `${host}${route}`);
  }
});

test('no Walmart or Target route that holds an account, cart or checkout is added to the retailer script', () => {
  const store = entry.matches.filter(m => /^https:\/\/(?:www\.)?(?:walmart|target)\.com\//.test(m));
  assert.ok(store.length >= 24);
  for (const match of store) {
    assert.ok(!/(?:^|\/)(?:cart|checkout|account|login|orders|signin|wallet|payment|pharmacy|lists|registry)(?:[/*?]|$)/i.test(pathOf(match)), match);
  }
  // Exactly these routes per site, so a private page can never be added by a wildcard.
  const allowed = {
    walmart: ['/', '/?*', '/browse/*', '/cp/*', '/shop/*', '/search', '/search?*', '/search/*', '/ip/*'],
    target: ['/', '/?*', '/c/*', '/pl/*', '/b/*', '/s', '/s?*', '/s/*', '/p/*'],
  };
  for (const site of ['walmart', 'target']) {
    const routes = store.filter(m => new RegExp(`^https://(?:www\\.)?${site}\\.com/`).test(m)).map(m => m.replace(/^https:\/\/[^/]+/, ''));
    assert.deepEqual([...new Set(routes)].sort(), allowed[site].slice().sort(), `${site}: only public browsing and results routes`);
  }
});

test('the sort panel is loaded after the store adapters and before the runner that calls it, and nowhere else', () => {
  for (const cs of manifest.content_scripts) {
    const at = cs.js.indexOf('src/content/retailer-sort.js');
    if (!entry.js.includes('src/content/retailer.js') || at < 0) continue;
    for (const dependency of ['src/stores/target.js', 'src/stores/walmart.js', 'src/stores/label-reader.js', 'src/engine/db/unit-price.js', 'src/engine/db/sorted-results.js']) {
      assert.ok(cs.js.indexOf(dependency) >= 0 && cs.js.indexOf(dependency) < at, `${dependency} before the panel`);
    }
    assert.ok(at < cs.js.indexOf('src/content/retailer.js'));
  }
  const withPanel = manifest.content_scripts.filter(cs => cs.js.includes('src/content/retailer-sort.js'));
  assert.ok(withPanel.length >= 1);
  for (const cs of withPanel) assert.ok(cs.js.includes('src/content/retailer.js'), 'the panel only loads where its runner does');
  assert.ok(!manifest.content_scripts.some(cs => cs.js.includes('src/content/walmart-sort.js')), 'the old walmart-only file is gone');
});

// ---------------------------------------------------------------- reading a card
test('a card states its price once: a was-price, a savings line or a unit price never replace it', () => {
  assert.equal(L.firstPrice('Now $3.97 Was $4.50'), 3.97);
  assert.equal(L.firstPrice('Was $4.50 current price $3.97'), 3.97);
  assert.equal(L.firstPrice('$3.97 ($0.09/ounce)'), 3.97);
  assert.equal(L.firstPrice('Save $1.00 $2.99 reg $3.99'), 2.99);
  assert.equal(L.firstPrice('$1,234.50'), 1234.5);
  assert.equal(L.firstPrice('Price $9.00 $9.00/lb'), 9);
});

test('a price range has no single price to sort on, and a card with no price has none', () => {
  assert.equal(L.firstPrice('$3.99 - $5.99'), null);
  assert.equal(L.firstPrice('$3.99 to $5.99'), null);
  assert.equal(L.firstPrice('Out of stock'), null);
  assert.equal(L.firstPrice(''), null);
});

test('stars and review counts are read from the accessible text a card carries', () => {
  assert.deepEqual(L.ratingFrom('4.5 out of 5 Stars. 1,234 reviews'), { ratingValue: 4.5, reviewCount: 1234 });
  assert.deepEqual(L.ratingFrom('4.7 out of 5 stars with 87 ratings'), { ratingValue: 4.7, reviewCount: 87 });
  assert.deepEqual(L.ratingFrom('4 out of 5 stars, 1.2K reviews'), { ratingValue: 4, reviewCount: 1200 });
  assert.deepEqual(L.ratingFrom('No reviews yet'), { ratingValue: null, reviewCount: null });
  assert.equal(L.ratingFrom('9 out of 5').ratingValue, null, 'a value outside 0-5 is not a rating');
});

test('Walmart reads the exact price from its screen-reader node, and the unit price from the card text', () => {
  const doc = createDocument('<div role="group" data-item-id="10314926"><a href="/ip/oats/10314926"><span>Great Value oats</span></a>'
    + '<div data-automation-id="product-price"><span data-testid="unified-global-product-price-a11y-text">current price $3.97</span><div aria-hidden="true">$397</div></div>'
    + '<div>9.5 ¢/oz</div><span data-automation-id="product-title">Great Value oats</span><span aria-label="4.7 out of 5 Stars. 8123 reviews">4.7</span></div>');
  const [tile] = W.searchTiles(doc);
  const facts = W.readListing(tile);
  assert.equal(facts.listingPrice, 3.97, 'not the visible "$397"');
  assert.equal(facts.ratingValue, 4.7);
  assert.equal(facts.reviewCount, 8123);
  assert.equal(facts.sponsored, false);
  assert.match(facts.unitText, /9\.5 ¢\/oz/);
  const unit = U.unitPricesFor({ title: tile.title, text: facts.unitText, listingPrice: facts.listingPrice }, {}, 'walmart.com');
  assert.ok(Math.abs(unit.unitPrices.weight - 0.095) < 1e-9);
});

test('pictures are taken from the retailer image host only', () => {
  const card = createDocument('<div><img src="https://evil.example/x.png"><img src="data:image/gif;base64,AAAA"><img src="/relative.png"><img src="https://i5.walmartimages.com/seo/a.jpeg"></div>').querySelector('div');
  assert.equal(L.listingFacts(card, { imageHost: /(?:^|\.)walmartimages\.com$/i }).image, 'https://i5.walmartimages.com/seo/a.jpeg');
  assert.equal(L.listingFacts(card, {}).image, '');
  const none = createDocument('<div><img src="https://evil.example/x.png"></div>').querySelector('div');
  assert.equal(L.listingFacts(none, { imageHost: /(?:^|\.)walmartimages\.com$/i }).image, '');
});

// ---------------------------------------------------------------- Target, on the real capture
test("Target's real captured results mark exactly their three advertisements as Sponsored", () => {
  // tests/pages/target-s-oats.html: the first six tiles of the live "organic oats" results (2026-09-25).
  const doc = loadPage('target-s-oats.html');
  const tiles = T.searchTiles(doc);
  assert.equal(tiles.length, 6);
  assert.deepEqual(tiles.map(tile => T.isSponsored(tile)), [true, true, true, false, false, false]);
  assert.deepEqual(tiles.map(tile => T.readListing(tile).sponsored), [true, true, true, false, false, false]);
});

test('Target reads price, unit price and rating from a card, and a card with none stays unpriced', () => {
  const card = id => `<div data-test="ListingPageProductListing"><a data-test="assets" href="/p/oats/-/A-${id}"></a>`
    + `<a data-test="content" aria-label="Oats - 18oz" href="/p/oats/-/A-${id}"><h3><span>Oats - 18oz</span></h3></a>`
    + '<span data-test="current-price"><span>$3.59</span></span> <span data-test="unit-price">($0.20/ounce)</span>'
    + '<div aria-label="4.7 out of 5 stars with 1289 ratings">4.7</div></div>';
  const [priced] = T.searchTiles(createDocument(`<div data-test="product-grid">${card('79364857')}</div>`));
  const facts = T.readListing(priced);
  assert.equal(facts.listingPrice, 3.59);
  assert.equal(facts.ratingValue, 4.7);
  assert.equal(facts.reviewCount, 1289);
  const unit = U.unitPricesFor({ title: priced.title, text: facts.unitText, listingPrice: facts.listingPrice }, {}, 'target.com');
  assert.ok(Math.abs(unit.unitPrices.weight - 0.20) < 1e-9);
  const bare = '<div data-test="ListingPageProductListing"><a data-test="content" aria-label="Variety box" href="/p/box/-/A-13012351"><h3>Variety box</h3></a></div>';
  const [unpriced] = T.searchTiles(createDocument(`<div data-test="product-grid">${bare}</div>`));
  assert.equal(T.readListing(unpriced).listingPrice, null);
  assert.equal(T.readListing(unpriced).image, '');
});

test('an ordinary Target title that ends in the word does not make a different card an ad', () => {
  const card = (id, label) => `<div data-test="ListingPageProductListing"><a data-test="content" aria-label="${label}" href="/p/x/-/A-${id}"><h3>${label}</h3></a></div>`;
  const doc = createDocument(`<div data-test="product-grid">${card('13012345', 'Sponsored Child card game - 2ct')}${card('13012346', 'Oats - 18oz')}${card('13012347', 'Oats - 18oz Sponsored')}</div>`);
  assert.deepEqual(T.searchTiles(doc).map(tile => T.isSponsored(tile)), [false, false, true]);
});
