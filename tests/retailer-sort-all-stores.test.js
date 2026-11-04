'use strict';
// The sorted list on every supported store (src/content/retailer-sort.js, the worker's scopes, the registry). The
// behaviour in a real browser is scripts/retailer-sort-harness.mjs (Walmart, Target, Kroger); this file covers what
// needs no browser and applies to ALL fifteen stores: that the registry and each adapter agree on what a search page
// is, that each store's real product ids survive the sanitizer that bounds its list, and the shared helpers that find
// the next page and the card around a listing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../src/stores/label-reader.js');
require('../src/stores/target.js');
require('../src/stores/walmart.js');
require('../src/stores/costco.js');
require('../src/stores/grocery.js');
require('../src/stores/grocery-pages.js');
const registry = require('../src/stores/registry.js');
const R = require('../src/engine/db/sorted-results.js');
const U = require('../src/engine/db/unit-price.js');
const { createDocument } = require('./pages/load.js');

const adapters = globalThis.AIR.storeAdapters;
const loc = href => { const u = new URL(href); return { href: u.href, hostname: u.hostname, pathname: u.pathname, protocol: u.protocol }; };
// One search address, one product address and one account address per store, in the shapes each adapter's tests use.
const SAMPLES = {
  target: { search: 'https://www.target.com/s?searchTerm=oats', product: 'https://www.target.com/p/oats/-/A-79364857' },
  walmart: { search: 'https://www.walmart.com/search?q=oats', product: 'https://www.walmart.com/ip/oats/10314926' },
  costco: { search: 'https://www.costco.com/CatalogSearch?keyword=oats', product: 'https://www.costco.com/oats.product.100423971.html' },
  instacart: { search: 'https://www.instacart.com/store/safeway/s?k=oats', product: 'https://www.instacart.com/store/items/2695935-quaker-oats' },
  kroger: { search: 'https://www.kroger.com/search?query=oats', product: 'https://www.kroger.com/p/oats/0003000001020' },
  frys: { search: 'https://www.frysfood.com/search?query=oats', product: 'https://www.frysfood.com/p/oats/0003000001020' },
  ralphs: { search: 'https://www.ralphs.com/search?query=oats', product: 'https://www.ralphs.com/p/oats/0003000001020' },
  kingsoopers: { search: 'https://www.kingsoopers.com/search?query=oats', product: 'https://www.kingsoopers.com/p/oats/0003000001020' },
  smiths: { search: 'https://www.smithsfoodanddrug.com/search?query=oats', product: 'https://www.smithsfoodanddrug.com/p/oats/0003000001020' },
  fredmeyer: { search: 'https://www.fredmeyer.com/search?query=oats', product: 'https://www.fredmeyer.com/p/oats/0003000001020' },
  qfc: { search: 'https://www.qfc.com/search?query=oats', product: 'https://www.qfc.com/p/oats/0003000001020' },
  harristeeter: { search: 'https://www.harristeeter.com/search?query=oats', product: 'https://www.harristeeter.com/p/oats/0003000001020' },
  dillons: { search: 'https://www.dillons.com/search?query=oats', product: 'https://www.dillons.com/p/oats/0003000001020' },
  safeway: { search: 'https://www.safeway.com/shop/search-results.html?q=oats', product: 'https://www.safeway.com/shop/product-details.111050071.html' },
  albertsons: { search: 'https://www.albertsons.com/shop/search-results.html?q=oats', product: 'https://www.albertsons.com/shop/product-details.111050071.html' },
};
const retailers = registry.STORES.filter(s => s.id !== 'amazon');

test('every supported store has a sample here, a search route, an adapter and a card reader', () => {
  assert.equal(retailers.length, 15);
  for (const store of retailers) {
    assert.ok(SAMPLES[store.id], `${store.id} has a sample`);
    assert.ok(store.search, `${store.id} has a search route in the registry`);
    const adapter = adapters[store.id];
    assert.ok(adapter, `${store.id} has an adapter`);
    for (const method of ['searchTiles', 'productUrl', 'productId', 'isSearchPage', 'matchesHost']) assert.equal(typeof adapter[method], 'function', `${store.id}.${method}`);
  }
});

test('the worker\'s idea of a search page is each adapter\'s own, for every store', () => {
  for (const store of retailers) {
    const { search, product } = SAMPLES[store.id], adapter = adapters[store.id];
    assert.equal(adapter.isSearchPage(loc(search)), true, `${store.id} adapter: ${search}`);
    assert.equal(registry.searchStore(search)?.id, store.id, `${store.id} registry: ${search}`);
    // A product page, the cart and an account page are not searches, and a look-alike host or a port is not the store.
    const host = new URL(search).hostname;
    for (const other of [product, `https://${host}/cart`, `https://${host}/account/orders`, search.replace(host, host + '.evil.example'),
      search.replace(host, host + ':8443'), search.replace('https:', 'http:'), search.replace('://', '://user:pass@')]) {
      assert.equal(registry.searchStore(other), null, `${store.id} registry refuses ${other}`);
    }
    assert.equal(adapter.isSearchPage(loc(product)), false, `${store.id} adapter: product page is not a search`);
  }
});

test('each store\'s real product ids are accepted in its own list, and nothing off the store is', () => {
  for (const store of retailers) {
    const { search, product } = SAMPLES[store.id], adapter = adapters[store.id];
    const id = adapter.productId(product);
    assert.ok(id, `${store.id} reads an id from ${product}`);
    const scope = R.scopeFor(search);
    assert.equal(scope.kind, 'store', store.id);
    assert.equal(scope.name, store.name);
    const url = adapter.productUrl(id, loc(search));
    assert.ok(url && adapter.productId(url) === id, `${store.id} builds a product link it can read back`);
    const [kept] = R.sanitizeResults([{ asin: id, title: 'Oats', url, listingPrice: 3.99 }], scope);
    assert.equal(kept.asin, id, `${store.id}: id ${id} survives`);
    assert.equal(kept.url, url, `${store.id}: its own product link survives`);
    const [foreign] = R.sanitizeResults([{ asin: id, title: 'Oats', url: 'https://evil.example/p/1', image: 'https://evil.example/a.png' }], scope);
    assert.deepEqual([foreign.url, foreign.image], ['', ''], `${store.id}: foreign link and picture dropped`);
    assert.equal(R.sanitizeSourceUrl(search), search, `${store.id}: its search is a valid back link`);
  }
});

test('a list may show pictures from the store\'s own site and the CDNs named for it, no others', () => {
  const walmart = registry.storeForHost('walmart.com'), target = registry.storeForHost('target.com'), kroger = registry.storeForHost('kroger.com');
  assert.equal(registry.imageHostOk(walmart, 'i5.walmartimages.com'), true);
  assert.equal(registry.imageHostOk(walmart, 'www.walmart.com'), true);
  assert.equal(registry.imageHostOk(target, 'target.scene7.com'), true);
  assert.equal(registry.imageHostOk(kroger, 'www.kroger.com'), true);
  for (const bad of ['evil.example', 'walmartimages.com.evil.example', 'notwalmartimages.com', '']) assert.equal(registry.imageHostOk(walmart, bad), false, bad);
  assert.equal(registry.imageHostOk(kroger, 'i5.walmartimages.com'), false, 'one store\'s CDN is not another\'s');
});

// ---------------------------------------------------------------- the gatherer's helpers, in a sandbox with a stand-in store
function sorter({ paging, readListing, href = 'https://www.fake.test/search?q=oats' } = {}) {
  const url = new URL(href);
  const fake = {
    name: 'Fake', matchesHost: h => h === 'www.fake.test', searchTiles: () => [], isSearchPage: l => l.pathname === '/search',
    productId: raw => (String(raw).match(/\/p\/(\d{5,})/) || [])[1] || '', productUrl: id => `https://www.fake.test/p/${id}`, paging, readListing,
  };
  const sandbox = { AIR: { storeAdapters: { fake }, db: { unitPrice: U, sortedResults: R } }, location: { hostname: url.hostname, href: url.href, origin: url.origin, pathname: url.pathname },
    chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {} } }, i18n: { getMessage: () => '' }, storage: { local: { get() {} } } },
    URL, URLSearchParams, Promise, setTimeout, clearTimeout, console, AbortController, Set, Map, Array, Date, JSON, Number, String, RegExp, Math, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/content/retailer-sort.js'), 'utf8'), sandbox);
  return sandbox.AIR.retailerSort;
}

test('a store that numbers its pages gets the next one by number or by offset, keeping the rest of the search', () => {
  const counter = sorter({ paging: { param: 'page', first: 1 } });
  assert.equal(counter.pagedUrl('https://www.fake.test/search?q=oats&facet=a%3Ab', 1, 40), 'https://www.fake.test/search?q=oats&facet=a%3Ab&page=2');
  assert.equal(counter.pagedUrl('https://www.fake.test/search?q=oats&page=2', 2, 40), 'https://www.fake.test/search?q=oats&page=3');
  const offset = sorter({ paging: { param: 'Nao', offset: true, size: 24 } });
  assert.equal(offset.pagedUrl('https://www.fake.test/search?q=oats', 1, 30), 'https://www.fake.test/search?q=oats&Nao=24');
  assert.equal(offset.pagedUrl('https://www.fake.test/search?q=oats&Nao=24', 2, 30), 'https://www.fake.test/search?q=oats&Nao=48');
  const unsized = sorter({ paging: { param: 'start', offset: true } });
  assert.equal(unsized.pagedUrl('https://www.fake.test/search?q=oats', 1, 36), 'https://www.fake.test/search?q=oats&start=36', 'the offset step is the first page\'s size');
  assert.equal(sorter({}).pagedUrl('https://www.fake.test/search?q=oats', 1, 40), null, 'a store with no known numbering is scrolled instead');
});

test('the page\'s own next link is followed; a disabled, foreign, same-page or non-search link is not', () => {
  const sort = sorter();
  const find = html => sort.findNextLink(createDocument(html), 'https://www.fake.test/search?q=oats');
  assert.equal(find('<a rel="next" href="/search?q=oats&page=2">more</a>'), 'https://www.fake.test/search?q=oats&page=2');
  assert.equal(find('<a aria-label="Next page" href="/search?q=oats&page=2"></a>'), 'https://www.fake.test/search?q=oats&page=2');
  assert.equal(find('<a href="/search?q=oats&page=2">Next</a>'), 'https://www.fake.test/search?q=oats&page=2');
  assert.equal(find('<a href="/search?q=oats&page=2">›</a>'), 'https://www.fake.test/search?q=oats&page=2');
  assert.equal(find('<a aria-label="Next page" aria-disabled="true" href="/search?q=oats&page=2"></a>'), null, 'disabled');
  assert.equal(find('<a aria-label="Next page" disabled href="/search?q=oats&page=2"></a>'), null, 'disabled');
  assert.equal(find('<a aria-label="Next page" href="https://evil.example/search?q=oats&page=2"></a>'), null, 'another site');
  assert.equal(find('<a aria-label="Next page" href="/search?q=oats"></a>'), null, 'the page we are on');
  assert.equal(find('<a aria-label="Next page" href="/account/orders"></a>'), null, 'not a results page');
  assert.equal(find('<a href="/search?q=oats&page=2">Next steps for your recipe</a>'), null, 'a link that only starts with the word');
});

test('a listing returned as a bare link is read from the widest wrapper that holds only that product', () => {
  const sort = sorter();
  const doc = createDocument('<main><ul><li id="item-a"><div id="card"><div id="inner"><a id="link" href="/p/11111">Oats</a></div><span>$3.99</span></div></li>'
    + '<li id="item-b"><div id="two"><a id="rice" href="/p/22222">Rice</a><a href="/p/33333">Beans</a></div></li></ul></main>');
  const tile = (id, selector) => ({ id, el: doc.querySelector(selector) });
  assert.equal(sort.cardOf(tile('11111', '#link')).getAttribute('id'), 'item-a', 'up to the list item that holds the price, and no further than the list');
  // A wrapper that also holds another product is never the card, and neither is a list.
  const rice = sort.cardOf(tile('22222', '#rice'));
  assert.equal(rice.getAttribute('id'), 'rice', 'stays on the link itself when its only wrapper holds two products');
  for (const found of [sort.cardOf(tile('11111', '#link')), rice]) assert.ok(!['UL', 'OL', 'MAIN', 'BODY'].includes(found.tagName));
});

test('a listing is turned into the list\'s fields: units per family, the store\'s own link, its page, stars and reviews', () => {
  const facts = { listingPrice: 3.99, unitText: 'Great Value oats ($0.095/ounce) 12 Count', ratingValue: 4.5, reviewCount: 120, image: 'https://www.fake.test/a.jpg', sponsored: true };
  const sort = sorter({ readListing: () => facts });
  const product = sort.extractProduct({ id: '11111', title: 'Great Value Oats, 42 oz, 12 Count', el: {} }, 3, {});
  assert.equal(product.asin, '11111');
  assert.equal(product.url, 'https://www.fake.test/p/11111');
  assert.equal(product.pageNumber, 3);
  assert.equal(product.listingPrice, 3.99);
  assert.ok(Math.abs(product.unitPrices.weight - 0.095) < 1e-9, 'the store\'s own price per ounce');
  assert.equal(product.unitSources.weight, 'amazon', 'marked as the store\'s own (the field name is historical)');
  assert.ok(Math.abs(product.unitPrices.count - 3.99 / 12) < 1e-9, 'and the price per item the title gives');
  assert.deepEqual([product.ratingValue, product.reviewCount, product.rating, product.reviews], [4.5, 120, '4.5 out of 5 stars', '120']);
  assert.equal(product.sponsored, true);
  const off = sort.extractProduct({ id: '11111', title: 'Great Value Oats, 42 oz', el: {} }, 1, { unitPrice: false });
  assert.equal(Object.keys(off.unitPrices).length, 0, 'unit prices switched off in the popup: none are worked out');
  // The worker decides what a list may link to from the sending tab's own address: another store's link is blanked.
  const [kept] = R.sanitizeResults([product], R.scopeFor('https://www.walmart.com/search?q=oats'));
  assert.equal(kept.url, '', 'a Walmart list does not accept another store\'s link');
  assert.equal(kept.image, '');
  assert.equal(kept.asin, '11111', 'the row itself is kept');
});
