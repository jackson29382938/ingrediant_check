// The unit price in Amazon's "Sort by" menu: one entry whose unit is the one most listings use, convertible
// within weight, volume and count, and changeable in the side panel. Run: node tests/unit-sort.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.self = global;
require('../src/engine/db/_module.js');
const U = require('../src/engine/db/unit-price.js');
const R = require('../src/engine/db/sorted-results.js');

const near = (a, e, tol = 1e-6) => assert.ok(a != null && Math.abs(a - e) <= tol * Math.max(1, Math.abs(e)), `${a} != ${e}`);
const card = (title, listingPrice, text = '', settings = {}, store = 'www.amazon.com') =>
  U.unitPricesFor({ title, text: text || title, listingPrice }, settings, store);

test('any unit in a family converts to any other, and the families never convert into each other', () => {
  const perOz = 0.25;                                  // $0.25 an ounce
  near(U.perUnit(perOz, 'oz', 'www.amazon.com'), 0.25);
  near(U.perUnit(perOz, 'lb', 'www.amazon.com'), 4);
  near(U.perUnit(perOz, 'kg', 'www.amazon.com'), 0.25 * 35.27396195);
  near(U.perUnit(perOz, '100g', 'www.amazon.com'), 0.25 * 3.527396195);
  const perFlOz = 0.03;
  near(U.perUnit(perFlOz, 'gal', 'www.amazon.com'), 3.84);
  near(U.perUnit(perFlOz, 'qt', 'www.amazon.com'), 0.96);
  near(U.perUnit(perFlOz, 'l', 'www.amazon.com'), 0.03 * 33.8140227);
  near(U.perUnit(perFlOz, '100ml', 'www.amazon.com'), 0.03 * 3.38140227);
  assert.equal(U.familyOf('lb'), 'weight');
  assert.equal(U.familyOf('gal'), 'fluid');
  assert.equal(U.familyOf('ct'), 'count');
  // A listing priced per ounce has no price per gallon: that needs a density.
  const oats = card('Rolled oats 32 oz', 6.4);
  assert.equal(U.priceIn(oats, 'fluid'), null);
  assert.equal(U.perUnit(U.priceIn(oats, 'fluid'), 'gal', 'www.amazon.com'), null);
  assert.equal(U.perUnit(0, 'oz', 'www.amazon.com'), null);
  assert.equal(U.perUnit(1, 'furlong', 'www.amazon.com'), null);
});

test('a UK gallon is bigger than a US gallon, and the store key works as well as the host', () => {
  const us = U.perUnit(0.03, 'gal', 'www.amazon.com');
  const uk = U.perUnit(0.03, 'gal', 'www.amazon.co.uk');
  assert.ok(uk > us * 1.19 && uk < us * 1.21, `${uk} vs ${us}`);
  assert.equal(U.perUnit(0.03, 'gal', 'co.uk'), uk);
  assert.equal(U.perUnit(0.03, 'gal', 'www.amazon.ie'), uk);
});

test('a size and a displayed unit price read the store key as they read the host', () => {
  // "co.uk" is the key the storefront table uses; before this, parsing took it for a US store (a pint as 16 oz, not 19.2).
  const hosts = ['www.amazon.co.uk', 'amazon.co.uk', 'co.uk', 'www.amazon.ie', 'ie'];
  const uk = U.parseQuantity('Milk 1 pint', 'www.amazon.co.uk');
  assert.ok(Math.abs(uk.ounces - 19.215) < 0.01, `${uk.ounces}`);
  for (const store of hosts) {
    assert.equal(U.parseQuantity('Milk 1 pint', store).ounces, uk.ounces, store);
    assert.equal(U.parseDisplayedUnit('£1.00/pint', store).perOz, U.parseDisplayedUnit('£1.00/pint', 'www.amazon.co.uk').perOz, store);
  }
  for (const store of ['www.amazon.com', 'com', 'www.amazon.ca', 'ca', '', undefined]) assert.equal(U.parseQuantity('Milk 1 pint', store).ounces, 16, String(store));
});

test('Amazon\'s own unit, per count included, is read and its unit remembered', () => {
  const shown = (text, store) => U.parseDisplayedUnit(text, store);
  assert.deepEqual([shown('$12.99 ($0.81/Ounce)').kind, shown('$12.99 ($0.81/Ounce)').unit], ['weight', 'oz']);
  assert.equal(shown('$9.99 ($4.99/Pound)').unit, 'lb');
  assert.equal(shown('$5.00 ($1.25/100 g)').unit, '100g');
  assert.equal(shown('$2.99 ($0.30/100 ml)').unit, '100ml');
  assert.equal(shown('$4 ($0.25/Fl Oz)').unit, 'floz');
  assert.equal(shown('$3.99 ($3.99/Gallon)').unit, 'gal');
  assert.deepEqual([shown('$9.99 ($0.50/Count)').kind, shown('$9.99 ($0.50/Count)').unit], ['count', 'ct']);
  assert.equal(shown('$9.99 ($0.83/Each)').unit, 'ct');
  assert.equal(shown('$6 ($0.50/Piece)').kind, 'count');
  assert.equal(shown('$5 ($0.02/50 g)').unit, null, 'an amount nobody sorts by names no unit, but is still read');
  assert.equal(shown('$5 ($0.02/50 g)').kind, 'weight');
});

test('the old per-ounce functions never return a price per count', () => {
  assert.equal(U.parseDisplayedUnitPrice('$9.99 ($0.50/Count)'), null);
  const legacy = U.unitPriceFor({ title: 'Tea 100 Count', text: '$6.99 ($0.07/Count)', listingPrice: 6.99 }, {});
  assert.deepEqual(legacy, { unitPrice: null, unitSource: 'none', unitKind: '' });
});

test('item counts are read from pack words and count words, and refused when they disagree', () => {
  assert.equal(U.parseCount('Coca-Cola 12 fl oz cans, Pack of 12'), 12);
  assert.equal(U.parseCount('Kind Bars, 12 Count'), 12);
  assert.equal(U.parseCount('Soda 24-pack'), 24);
  assert.equal(U.parseCount('Water 6 bottles'), 6);
  assert.equal(U.parseCount('Snack Variety Pack, 40 Count'), 40);
  assert.equal(U.parseCount('12 Pack, 12 Count'), 12, 'the same number twice is one count');
  assert.equal(U.parseCount('Honey 12 oz (Pack of 1)'), 1);
  assert.equal(U.parseCount('12 Count (Pack of 1)'), 12, 'a pack of one leaves the item count');
  assert.equal(U.parseCount('Pack of 6, 12 ct each'), null, 'six packs of twelve, or twelve in all: no guess');
  assert.equal(U.parseCount('8 pack 6 count'), null);
  assert.equal(U.parseCount('Protein Bars 10g Protein, 12 Count'), 12, 'the grams of protein are not a count');
  assert.equal(U.parseCount('Oats 42 oz'), null);
  assert.equal(U.parseCount('Probiotic 30 servings'), null, 'a serving is not an item');
  assert.equal(U.parseCount('Mega pack of 99999'), null);
});

test('a listing is priced in every family it can supply', () => {
  const soda = card('Coca-Cola 12 fl oz cans, Pack of 12', 8.99);
  near(soda.unitPrices.fluid, 8.99 / 144);
  near(soda.unitPrices.count, 8.99 / 12);
  assert.equal(soda.unitKind, 'fluid', 'the main price stays the weight or volume one');
  assert.equal(soda.unitSources.count, 'calculated');
  const bars = card('Kind Bars Almond, 1.4 oz, 12 Count', 14.88);
  assert.equal(bars.unitPrices.weight, undefined, 'a weight beside a count may be per bar or in all: no guess');
  near(bars.unitPrices.count, 1.24);
  assert.deepEqual([bars.unitPrice, bars.unitKind, bars.unitSource], [null, '', 'none'], 'a count-only listing has no price per ounce');
  const meat = card('Chicken Breast Boneless', 11.98, '$11.98 ($5.99/Pound)');
  near(meat.unitPrices.weight, 5.99 / 16);
  assert.deepEqual([meat.unitSources.weight, meat.unitId], ['amazon', 'lb']);
  const tea = card('Tea Bags 100 Count, 7 oz', 6.99, '$6.99 ($0.07/Count)');
  assert.deepEqual([tea.unitId, tea.unitSources.count], ['ct', 'amazon']);
});

test('the missing-price setting still decides how much of the card is read', () => {
  const titled = { title: 'Oats', text: 'Oats\nNet Wt 32 oz, Pack of 2\n$6.40', listingPrice: 6.4 };
  assert.deepEqual(U.unitPricesFor(titled, { unitMissing: 'calculate-clear' }, 'www.amazon.com').unitPrices, {});
  const more = U.unitPricesFor(titled, { unitMissing: 'infer-more' }, 'www.amazon.com');
  near(more.unitPrices.weight, 6.4 / 64);   // 32 oz, Pack of 2
  near(more.unitPrices.count, 3.2);
  const onlyShown = U.unitPricesFor({ title: 'Oats 32 oz', text: '$6.40 ($0.18/Ounce)', listingPrice: 6.4 }, { unitMissing: 'displayed-only' }, 'www.amazon.com');
  assert.deepEqual(Object.keys(onlyShown.unitPrices), ['weight']);
  assert.equal(U.unitPricesFor({ title: 'Oats 32 oz', text: 'Oats', listingPrice: 6.4 }, { unitMissing: 'displayed-only' }, 'www.amazon.com').unitPrice, null);
});

test('the likely unit is the one most listings are already priced in', () => {
  const lb = () => ({ unitKind: 'weight', unitId: 'lb', unitPrices: { weight: 0.3 } });
  const floz = () => ({ unitKind: 'fluid', unitId: 'floz', unitPrices: { fluid: 0.04 } });
  const found = U.likelyUnit([lb(), lb(), lb(), floz()], 'imperial');
  assert.deepEqual([found.unit, found.family, found.votes, found.listings], ['lb', 'weight', 3, 4]);
  // A listing with no Amazon unit price votes for the store's usual unit of its family.
  const calculated = { unitKind: 'weight', unitPrices: { weight: 0.2 } };
  assert.equal(U.likelyUnit([calculated, calculated, floz()], 'imperial').unit, 'oz');
  assert.equal(U.likelyUnit([calculated, calculated, floz()], 'metric').unit, '100g');
  assert.equal(U.likelyUnit([{ unitKind: 'fluid', unitPrices: { fluid: 1 } }], 'metric').unit, '100ml');
  // Count-only listings vote for count.
  const count = { unitKind: '', unitId: 'ct', unitPrices: { count: 0.5 } };
  assert.deepEqual(U.likelyUnit([count, count, calculated], 'imperial'), { unit: 'ct', family: 'count', votes: 2, listings: 3 });
  assert.equal(U.likelyUnit([], 'imperial'), null);
  assert.equal(U.likelyUnit([{ title: 'no unit price' }], 'imperial'), null);
  assert.equal(U.likelyUnit(null, 'imperial'), null);
});

test('a tie goes to the family more listings can be priced in, then to weight, volume, count', () => {
  const both = { unitKind: 'fluid', unitId: 'floz', unitPrices: { fluid: 0.05, count: 0.6 } };
  const countOnly = { unitKind: '', unitId: 'ct', unitPrices: { count: 0.5 } };
  // one vote each, but two listings can be priced per count
  assert.equal(U.likelyUnit([both, countOnly], 'imperial').unit, 'ct');
  const weight = { unitKind: 'weight', unitPrices: { weight: 0.2 } };
  const fluid = { unitKind: 'fluid', unitPrices: { fluid: 0.04 } };
  assert.equal(U.likelyUnit([fluid, weight], 'imperial').unit, 'oz');
});

test('servings come from the label line, and only when it says how many', () => {
  assert.equal(U.servingsOf({ servingSize: '19.0 servings per container | 0.5 cup' }), 19);
  assert.equal(U.servingsOf({ servingSize: '1.0 servings per container | 1 container (60g)' }), 1);
  assert.equal(U.servingsOf({ servingSize: '2,5 servings per bottle' }), 2.5);
  assert.equal(U.servingsOf({ servingSize: '1 cup (55g)' }), null);
  assert.equal(U.servingsOf({ servingSize: '5000 servings per container' }), null);
  assert.equal(U.servingsOf(null), null);
  assert.equal(U.servingsOf({}), null);
});

test('the list gate keeps every unit price, bounded and typed', () => {
  const [one] = R.sanitizeResults([{
    asin: 'B000000001', title: 'Soda', listingPrice: 8.99, unitPrice: 0.0624, unitKind: 'fluid', unitSource: 'amazon', unitId: 'floz',
    unitPrices: { fluid: 0.0624, count: 0.749, weight: -1, other: 5 }, unitSources: { fluid: 'amazon', count: 'bogus' }, servings: 12.04,
  }]);
  assert.deepEqual(one.unitPrices, { fluid: 0.0624, count: 0.7490 });
  assert.deepEqual(one.unitSources, { fluid: 'amazon', count: 'calculated' });
  assert.equal(one.unitId, 'floz');
  assert.equal(one.servings, 12);
  const [bad] = R.sanitizeResults([{ asin: 'B000000002', title: 'x', unitId: 'furlong', unitPrices: { weight: 'abc', fluid: 1e9 }, servings: 99999 }]);
  assert.deepEqual(bad.unitPrices, {});
  assert.equal(bad.unitId, '');
  assert.equal(bad.servings, null);
  const [countOnly] = R.sanitizeResults([{ asin: 'B000000003', title: 'Tea', unitId: 'ct', unitPrices: { count: 0.07 } }]);
  assert.equal(countOnly.unitId, 'ct', 'a count-only listing keeps the unit Amazon shows');
  assert.equal(countOnly.unitKind, '');
  assert.equal(R.sanitizeUnitChoice('gal'), 'gal');
  assert.equal(R.sanitizeUnitChoice('auto'), 'auto');
  assert.equal(R.sanitizeUnitChoice('<script>'), 'auto');
  assert.equal(R.sanitizeUnitChoice(undefined), 'auto');
  assert.equal(R.sanitizeUnitId('lb'), 'lb');
  assert.equal(R.sanitizeUnitId('nope'), '');
});

test('ranking follows the chosen family, and a listing that cannot be priced in it goes last', () => {
  const soda = { asin: 'B000000001', title: 'soda', unitKind: 'fluid', unitPrice: 0.06, unitPrices: { fluid: 0.06, count: 0.75 } };
  const water = { asin: 'B000000002', title: 'water', unitKind: 'fluid', unitPrice: 0.01, unitPrices: { fluid: 0.01, count: 0.5 } };
  const bars = { asin: 'B000000003', title: 'bars', unitKind: '', unitPrice: null, unitPrices: { count: 0.4 } };
  const oats = { asin: 'B000000004', title: 'oats', unitKind: 'weight', unitPrice: 0.15, unitPrices: { weight: 0.15 } };
  const only = { health: 0, unitPrice: 10, price: 0, rating: 0, reviews: 0 };
  const order = family => R.rank([soda, water, bars, oats], only, { family }).map(r => r.product.title);
  assert.deepEqual(order('fluid').slice(0, 2), ['water', 'soda']);
  assert.deepEqual(order('count').slice(0, 3), ['bars', 'water', 'soda']);
  assert.deepEqual(order('weight')[0], 'oats');
  const ranked = R.rank([soda, water, bars, oats], only, { family: 'fluid' });
  assert.deepEqual(ranked.slice(2).map(r => r.product.title).sort(), ['bars', 'oats']);
  assert.ok(ranked.slice(2).every(r => r.missing.includes('unitPrice') && r.match === 0));
  // Without a family, the listing's main unit price is read, as lists saved before units were.
  assert.equal(R.rank([oats, soda], only)[0].product.title, 'soda', 'the cheaper main price, whatever its unit');
});

test('prices compare by ratio, so the unit chosen within a family never changes the order', () => {
  const a = { asin: 'B000000001', title: 'a', unitKind: 'weight', unitPrices: { weight: 0.1 } };
  const b = { asin: 'B000000002', title: 'b', unitKind: 'weight', unitPrices: { weight: 0.3 } };
  const c = { asin: 'B000000003', title: 'c', unitKind: 'weight', unitPrices: { weight: 0.2 } };
  const once = R.rank([b, c, a], { unitPrice: 10 }, { family: U.familyOf('lb') }).map(r => r.product.title);
  assert.deepEqual(once, ['a', 'c', 'b']);
});

test('one unit table: every unit has a family, a size, and a name', () => {
  assert.equal(new Set(U.UNIT_IDS).size, U.UNIT_IDS.length);
  for (const unit of U.UNIT_CHOICES) {
    assert.ok(U.FAMILIES.includes(unit.family), unit.id);
    assert.ok(unit.size > 0 && unit.short && unit.long, unit.id);
  }
  assert.equal(U.defaultUnit('weight', 'imperial'), 'oz');
  assert.equal(U.defaultUnit('weight', 'metric'), '100g');
  assert.equal(U.defaultUnit('fluid', 'imperial'), 'floz');
  assert.equal(U.defaultUnit('fluid', 'metric'), '100ml');
  assert.equal(U.defaultUnit('count', 'metric'), 'ct');
});
