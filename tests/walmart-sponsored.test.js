'use strict';
// Walmart sponsored placements. The detector must hide an ad by any one of several independent signals,
// because Walmart's markup is generated and has changed under this extension before, and it must never
// hide an organic result. Real-browser behaviour (styles, grid closing up, late ads, pause) is covered by
// scripts/walmart-search-harness.mjs; this file covers the decision itself on the dependency-free test DOM.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/stores/label-reader.js');
const W = require('../src/stores/walmart.js');
const { createDocument } = require('./pages/load.js');

const organic = (id, title = `Great Value oats ${id}`, extra = '') => `<div role="group" data-item-id="${id}"><a href="/ip/oats/${id}"><span>${title}</span></a>`
  + `<span data-automation-id="product-title">${title}</span><span>$3.97</span>${extra}</div>`;
const grid = inner => `<form><main><div data-testid="item-stack">${inner}</div></main></form>`;
// The item ids a pass would hide: the ids inside each hidden slot.
function hidden(html) {
  const doc = createDocument(html);
  return Array.from(W.sponsoredSlots(doc)).flatMap(slot => {
    const own = slot.getAttribute('data-item-id');
    return own ? [own] : Array.from(slot.querySelectorAll('[data-item-id]')).map(n => n.getAttribute('data-item-id'));
  }).sort();
}

test('an ordinary grid has nothing to hide', () => {
  assert.deepEqual(hidden(grid(organic('10000001') + organic('10000002') + organic('10000003'))), []);
});

test('the visible Sponsored label marks its own card, in any case and with the usual suffixes', () => {
  for (const label of ['Sponsored', 'SPONSORED', 'sponsored', 'Sponsored Product', 'Sponsored Ad', 'Advertisement', 'Ad']) {
    assert.deepEqual(hidden(grid(organic('10000001') + organic('10000002', undefined, `<div class="x"><span>${label}</span></div>`) + organic('10000003'))), ['10000002'], label);
  }
});

test('a screen-reader sentence that ends in the disclosure marks the card; the word inside a title does not', () => {
  const sr = (id, text) => `<div role="group" data-item-id="${id}"><a href="/ip/oats/${id}"><span class="sr">${text}</span></a><span data-automation-id="product-title">Great Value oats</span></div>`;
  assert.deepEqual(hidden(grid(organic('10000001') + sr('10000002', 'Great Value oats, current price $3.97, Sponsored') + organic('10000003'))), ['10000002']);
  assert.deepEqual(hidden(grid(sr('10000001', 'Sponsored Child card game, current price $3.97') + sr('10000002', 'Great Value oats, current price $3.97'))), []);
});

test('a label wrapped in extra elements, with an icon beside it, still marks the card', () => {
  const label = '<div><div><span>Sponsored</span></div><svg aria-hidden="true"></svg></div>';
  assert.deepEqual(hidden(grid(organic('10000001') + organic('10000002', undefined, label))), ['10000002']);
});

test('an accessible name ending in the disclosure marks the card (the way Target and Walmart write it)', () => {
  const overlay = `<div role="group" data-item-id="10000002"><a href="/ip/oats/10000002" aria-label="Great Value oats, 42 oz, Sponsored"><span>Great Value oats</span></a>`
    + '<span data-automation-id="product-title">Great Value oats</span></div>';
  assert.deepEqual(hidden(grid(organic('10000001') + overlay)), ['10000002']);
  const button = organic('10000003', undefined, '<button aria-label="Sponsored ad information">i</button>');
  assert.deepEqual(hidden(grid(organic('10000001') + button)), ['10000003']);
});

test("a click-through via Walmart's ad tracker is an ad, even with no label and no product link of its own", () => {
  const tracked = '/sp/track?bt=1&eventST=click&plmt=sp-search-middle~desktop~-~list&pos=3&rdf=1&rd=https%3A%2F%2Fwww.walmart.com%2Fip%2Foats%2F10000002%3FadsRedirect%3Dtrue';
  const card = `<div role="group" data-item-id="10000002"><a href="${tracked}"><span>Great Value oats</span></a><span data-automation-id="product-title">Great Value oats</span></div>`;
  assert.deepEqual(hidden(grid(organic('10000001') + card + organic('10000003'))), ['10000002']);
  // The tracked link's destination is still the advertised product, so a duplicate organic card of it survives.
  assert.deepEqual(hidden(grid(card + organic('10000002'))), ['10000002']);
  const doc = createDocument(grid(card));
  assert.deepEqual(W.searchTiles(doc), [], 'an ad is never rated or sorted');
});

test('placement attributes mark a card and a whole module', () => {
  assert.deepEqual(hidden(grid(organic('10000001') + `<div data-item-id="10000002" data-sponsored="true"><a href="/ip/x/10000002">X</a></div>`)), ['10000002']);
  const carousel = `<section data-testid="sp-search-brand-carousel">${organic('20000001')}${organic('20000002')}</section>`;
  assert.deepEqual(hidden(grid(organic('10000001') + carousel + organic('10000003'))), ['20000001', '20000002']);
});

test('a banner or video ad that is not one product card is hidden by its label, without taking organic results with it', () => {
  const banner = '<div class="banner"><span>Sponsored</span><a href="/brand/acme"><img alt="Acme"></a></div>';
  const doc = createDocument(grid(organic('10000001') + banner + organic('10000002')));
  const slots = Array.from(W.sponsoredSlots(doc));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].getAttribute('class'), 'banner', 'only the banner, not the grid or an organic card');
});

test('the grid, the page and organic cards are never hidden, however the ad is wrapped', () => {
  const wrapped = `<div class="cell"><div class="inner">${organic('10000002', undefined, '<span>Sponsored</span>')}</div></div>`;
  const doc = createDocument(grid(organic('10000001') + wrapped + organic('10000003')));
  const slots = Array.from(W.sponsoredSlots(doc));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].getAttribute('class'), 'cell', 'the cell around the ad closes up; the grid and the organic cells stay');
  for (const bad of ['main', 'form', 'body', 'html']) assert.ok(!slots.some(slot => slot.tagName.toLowerCase() === bad));
});

test('words that merely contain "sponsored" or "ad" never hide an organic result', () => {
  const near = [
    organic('10000001', 'Sponsored Child Kids Birthday Card'),
    organic('10000002', 'Ad Astra oats'),
    organic('10000003', 'Add to cart oats'),
    organic('10000004', 'Great Value oats', '<span>Ad-free recipe</span><button aria-label="Add to cart, Great Value oats">Add</button>'),
    organic('10000005', 'Great Value oats', '<span>Roadside brand</span><span>Shipping, arrives tomorrow</span>'),
    organic('10000006', 'Notebook, 3 Pack, Sponsorship edition'),
  ].join('');
  assert.deepEqual(hidden(grid(near)), []);
});

test('only one slot per ad, and it is the OUTERMOST card: nested cards never leave an empty cell behind', () => {
  // Walmart nests its cards: role=group > wrapper > list-view. The label is deepest. The old and the first rewritten
  // detector both returned a node inside the group, so the cell stayed on the page.
  const walmartShape = id => `<div role="group" data-item-id="${id}" class="outer"><div class="pad"><div data-testid="list-view" class="inner">`
    + `<a href="/ip/oats/${id}"><span>Great Value oats</span></a><div class="flag"><span>Sponsored</span></div></div></div></div>`;
  const doc = createDocument(grid(organic('10000001') + walmartShape('10000002') + organic('10000003')));
  const slots = Array.from(W.sponsoredSlots(doc));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].getAttribute('class'), 'outer', 'the whole card is hidden, not a wrapper inside it');
  const withCell = createDocument(grid(organic('10000001') + `<div class="cell">${walmartShape('10000002')}</div>`));
  assert.equal(Array.from(W.sponsoredSlots(withCell))[0].getAttribute('class'), 'cell', 'and the cell around it when the card sits in one');
});

test('a page with nothing but one ad still hides just that ad, not the page chrome', () => {
  const doc = createDocument('<form><main><h1>Results</h1><input type="search"><div role="group" data-item-id="10000002"><a href="/ip/oats/10000002">Oats</a><span>Sponsored</span></div></main></form>');
  const slots = Array.from(W.sponsoredSlots(doc));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].getAttribute('data-item-id'), '10000002');
});
