// Which heading in a search tile is its title (search.js listingTitle). The badge is painted into it and the
// side panel names the listing from it, so a hidden heading ahead of the real one hid every badge and named
// every grocery listing "Quantity not updated". tests/pages/amazon-same-day-grocery.html and the real-browser
// harness (scripts/same-day-grocery-harness.mjs) check the same thing on a page with layout.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.AIR = { db: {} };
globalThis.chrome = { runtime: {}, i18n: { getMessage: () => '' }, storage: { local: { get() {} } } };
globalThis.location = { href: 'https://www.amazon.com/s?k=bacon&i=same-day-grocery' };   // linkAsin resolves a link against the page
const { listingTitle, listingName, adoptItemIds } = require('../src/content/search.js');

// A heading as the page gives it: its text, the control or alert it sits in (what closest() finds), and whether
// it has a box on screen. `control: 'tile'` is the tile itself matching the control selector.
const heading = (text, { control = null, shown = true } = {}) => ({
  textContent: text, getClientRects: () => (shown ? [{}] : []),
  closest(selector) { assert.ok(selector.includes('[role="alert"]'), 'looks for alerts'); return control; },
});
// `live` is a tile on the page itself; a page read with DOMParser has no window, so no layout to ask.
const tileOf = (make, { live = true } = {}) => {
  const tile = { ownerDocument: { defaultView: live ? {} : null }, contains: node => node !== tile };
  const headings = make(tile);
  tile.querySelectorAll = () => headings;
  return tile;
};
const textOf = el => el && el.textContent;

test('a hidden add-to-cart heading ahead of the title is not the title', () => {
  const alert = {};
  const tile = tileOf(() => [heading('Quantity not updated', { control: alert, shown: false }), heading('Cut Watermelon, 32oz')]);
  assert.equal(textOf(listingTitle(tile)), 'Cut Watermelon, 32oz');
});

test('a control heading is skipped even where the page shows it, and so is wording that is never a title', () => {
  const shownAlert = tileOf(() => [heading('Out of stock', { control: {} }), heading('Cut Cantaloupe, 10oz')]);
  assert.equal(textOf(listingTitle(shownAlert)), 'Cut Cantaloupe, 10oz');
  const wording = tileOf(() => [heading('  Quantity not updated '), heading('Add to cart'), heading('Added to cart'), heading('Honeydew Melon')]);
  assert.equal(textOf(listingTitle(wording)), 'Honeydew Melon');
});

test('on the live page a heading with no box loses to one that has a box; a parsed page has no layout to ask', () => {
  const hiddenByStylesheet = options => tileOf(() => [heading('Hidden by a class nobody names', { shown: false }), heading('Whole Cantaloupe')], options);
  assert.equal(textOf(listingTitle(hiddenByStylesheet({ live: true }))), 'Whole Cantaloupe');
  assert.equal(textOf(listingTitle(hiddenByStylesheet({ live: false }))), 'Hidden by a class nobody names',
    'DOMParser documents have no layout: the first plain heading stands');
});

test('odd markup never costs the tile its title', () => {
  // The only heading sits inside something that looks like a control: still better than no badge.
  assert.equal(textOf(listingTitle(tileOf(() => [heading('Oats', { control: {} })]))), 'Oats');
  // Nothing has a box (a tile the browser has not laid out): the first plain heading is used.
  assert.equal(textOf(listingTitle(tileOf(() => [heading('Oats', { shown: false }), heading('Oat bar', { shown: false })]))), 'Oats');
  // The tile itself carrying a control-like class does not disqualify the headings inside it.
  assert.equal(textOf(listingTitle(tileOf(tile => [heading('Oat milk', { control: tile })]))), 'Oat milk');
  assert.equal(listingTitle(tileOf(() => [])), null, 'no heading at all');
  assert.equal(listingTitle(tileOf(() => [heading('Quantity not updated')])), null, 'only UI wording is not a title');
});

// ---- a card whose title is plain text in a link to its own product ----------------------------------------------
// Real grocery cards were never captured (Amazon refuses automated loads), so these are synthetic. The card has no
// heading and none of the title classes; before the last-resort rule it was not a listing at all.
const link = (href, text, { label = '', shown = true, control = null } = {}) => ({
  innerText: text, textContent: text, getClientRects: () => (shown ? [{}] : []),
  getAttribute: name => (name === 'href' ? href : name === 'aria-label' ? label : null),
  closest: () => control,
});
const cardOf = (links, { asin = 'B000000001', carousel = false, live = true } = {}) => {
  const card = { ownerDocument: { defaultView: live ? {} : null }, contains: node => node !== card,
    getAttribute: name => (name === 'data-asin' ? asin : null), closest: selector => (carousel && /carousel/.test(selector) ? {} : null),
    querySelectorAll: selector => (selector === 'a[href]' ? links : []) };
  return card;
};

test('a card that draws its title as plain text in a link to its own product is still a listing', () => {
  const bacon = link('/Wright-Brand-Bacon/dp/B000000001?ref=x', 'Wright Brand Thick Cut Bacon, 12 oz');
  const card = cardOf([link('/dp/B000000001', ''), bacon]);
  assert.equal(listingTitle(card), bacon);
  assert.equal(listingName(card), 'Wright Brand Thick Cut Bacon, 12 oz');
  assert.equal(listingTitle(cardOf([link('/gp/product/B000000001', 'Turkey Bacon, 12 oz')])).textContent, 'Turkey Bacon, 12 oz', '/gp/product/ links count');
  const named = link('/dp/B000000001', '', { label: 'Applegate Uncured Bacon, 8 oz' });
  assert.equal(listingName(cardOf([named])), 'Applegate Uncured Bacon, 8 oz', 'an aria-label stands in for text');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Bacon bits'), link('/dp/B000000001', 'Bacon bits, real, 3 oz')])).textContent, 'Bacon bits, real, 3 oz', 'the longest text is the title');
});

test('the last-resort title never takes a link to another product, a control, a hidden link, wording or a carousel card', () => {
  assert.equal(listingTitle(cardOf([link('/dp/B000000002', 'Some other product, 12 oz')])), null, 'another product');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Add to cart')])), null, 'UI wording');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Sponsored')])), null);
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Bacon')])), null, 'too short to be a title');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Quantity not updated, try again', { control: {} })])), null, 'inside a control or alert');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Thick cut bacon, 12 oz', { shown: false })])), null, 'a link with no box on the live page');
  assert.ok(listingTitle(cardOf([link('/dp/B000000001', 'Thick cut bacon, 12 oz', { shown: false })], { live: false })), 'a parsed page has no layout to ask');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Thick cut bacon, 12 oz')], { carousel: true })), null, 'a carousel card');
  assert.equal(listingTitle(cardOf([link('/dp/B000000001', 'Thick cut bacon, 12 oz')], { asin: '' })), null, 'no ASIN on the card');
  assert.equal(listingTitle(cardOf([link('/gp/help/B000000001', 'Thick cut bacon, 12 oz')])), null, 'not a product address');
  assert.equal(listingName(cardOf([])), '');
});

test('a card with a real heading never reaches the last-resort rule', () => {
  const title = heading('Cut Watermelon, 32oz');
  const card = tileOf(() => [title]);
  card.getAttribute = () => 'B000000001';
  assert.equal(listingTitle(card), title);
});

// ---- cards that carry their ASIN only as data-csa-c-item-id --------------------------------------------------------
const el = (attrs, { inside = null } = {}) => {
  const node = { attrs: { ...attrs }, getAttribute: n => (n in node.attrs ? node.attrs[n] : null), setAttribute: (n, v) => { node.attrs[n] = String(v); },
    parentElement: inside ? { closest: () => inside } : null };
  return node;
};
const docOf = nodes => ({ querySelectorAll: selector => (selector === '[data-asin]' ? nodes.filter(n => 'data-asin' in n.attrs)
  : selector.includes('amzn1.asin') ? nodes.filter(n => (n.attrs['data-csa-c-item-id'] || '').includes('amzn1.asin')) : []) });

test('a page with no data-asin at all takes each card\'s ASIN from its item id, outermost element only', () => {
  const outer = el({ 'data-csa-c-item-id': 'amzn1.asin.1.B07ABCDEFG' });
  const inner = el({ 'data-csa-c-item-id': 'amzn1.asin.1.B07ABCDEFG' }, { inside: outer });
  const plain = el({ 'data-csa-c-item-id': 'amzn1.asin.B08ZZZZZZZ' });
  const junk = el({ 'data-csa-c-item-id': 'amzn1.asin.1.short' });
  assert.equal(adoptItemIds(docOf([outer, inner, plain, junk])), 2);
  assert.equal(outer.attrs['data-asin'], 'B07ABCDEFG');
  assert.equal(plain.attrs['data-asin'], 'B08ZZZZZZZ');
  assert.equal('data-asin' in inner.attrs, false, 'a nested element is left alone');
  assert.equal('data-asin' in junk.attrs, false, 'an id that is not an ASIN is left alone');
});

test('a page that already has data-asin elements is never touched', () => {
  const real = el({ 'data-asin': 'B000000001' });
  const other = el({ 'data-csa-c-item-id': 'amzn1.asin.1.B07ABCDEFG' });
  assert.equal(adoptItemIds(docOf([real, other])), 0);
  assert.equal('data-asin' in other.attrs, false);
  assert.equal(adoptItemIds({ querySelectorAll() { throw new Error('no DOM'); } }), 0, 'a failure is swallowed, not thrown');
});
