// Which heading in a search tile is its title (search.js listingTitle). The badge is painted into it and the
// side panel names the listing from it, so a hidden heading ahead of the real one hid every badge and named
// every grocery listing "Quantity not updated". tests/pages/amazon-same-day-grocery.html and the real-browser
// harness (scripts/same-day-grocery-harness.mjs) check the same thing on a page with layout.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.AIR = { db: {} };
globalThis.chrome = { runtime: {}, i18n: { getMessage: () => '' }, storage: { local: { get() {} } } };
const { listingTitle } = require('../src/content/search.js');

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
