// Prices, unit prices, package sizes, ratings and Amazon's sort menu, per storefront
// (src/engine/db/storefronts.js). Each supported currency and a non-English menu has a fixture here.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SF = require('../src/engine/db/storefronts.js');
const R = require('../src/engine/db/sorted-results.js');
const U = require('../src/engine/db/unit-price.js');

const near = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≈ ${b}`);
const G = 0.03527396195;          // ounces per gram
const ML = 1 / 29.5735295625;     // fluid ounces per millilitre

test('every Amazon store the manifest serves has a storefront', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
  const hosts = new Set(manifest.host_permissions.map(h => h.replace(/^\*:\/\/\*\./, '').replace(/\/\*$/, '')));
  for (const host of hosts) assert.equal(SF.storefront(`www.${host}`).known, true, host);
  assert.equal(Object.keys(SF.STORES).length, hosts.size, 'no storefront without a host permission');
});

// Listing prices as each store writes them (the screen-reader text of Amazon's price).
const PRICES = [
  ['www.amazon.com', '$4.99', 4.99], ['www.amazon.com', '$1,234.56', 1234.56],
  ['www.amazon.ca', '$5.99', 5.99], ['www.amazon.ca', 'CDN$ 5.99', 5.99],
  ['www.amazon.com.au', '$12.50', 12.5], ['www.amazon.sg', 'S$5.90', 5.9],
  ['www.amazon.co.uk', '£4.99', 4.99], ['www.amazon.co.uk', '£1,049.00', 1049],
  ['www.amazon.ie', '€4.99', 4.99], ['www.amazon.in', '₹1,299.00', 1299], ['www.amazon.in', '₹1,23,456', 123456],
  ['www.amazon.ae', 'AED 12.50', 12.5], ['www.amazon.sa', 'SAR 12.50', 12.5],
  ['www.amazon.co.jp', '￥1,280', 1280], ['www.amazon.co.jp', '¥1,280', 1280], ['www.amazon.com.mx', '$89.00', 89],
  ['www.amazon.de', '4,99 €', 4.99], ['www.amazon.de', '€4,99', 4.99], ['www.amazon.de', '1.234,56 €', 1234.56],
  ['www.amazon.fr', '4,99\u00a0€', 4.99], ['www.amazon.fr', '1\u202f234,56 €', 1234.56],
  ['www.amazon.es', '4,99 €', 4.99], ['www.amazon.it', '4,99 €', 4.99], ['www.amazon.nl', '€ 4,99', 4.99],
  ['www.amazon.com.be', '4,99 €', 4.99], ['www.amazon.se', '49,90 kr', 49.9], ['www.amazon.se', '1 234,56 kr', 1234.56],
  ['www.amazon.pl', '19,99 zł', 19.99], ['www.amazon.com.tr', '149,90 TL', 149.9], ['www.amazon.com.tr', '₺149,90', 149.9],
  ['www.amazon.com.br', 'R$ 4,99', 4.99], ['www.amazon.com.br', 'R$ 1.234,56', 1234.56],
];
test('listing prices parse the way each store writes them', () => {
  for (const [host, text, want] of PRICES) assert.equal(R.parseMoney(text, host), want, `${host} ${JSON.stringify(text)}`);
  assert.equal(R.parseMoney('$4.99 5 pack', 'www.amazon.com'), 4.99, 'a space never joins two numbers');
  assert.equal(R.parseMoney('no price', 'www.amazon.de'), null);
  assert.equal(R.parseMoney('$1,234.56'), 1234.56, 'no store: amazon.com');
});

test("Amazon's unit prices parse per store, and commas are decimals where the store says so", () => {
  near(U.parseDisplayedUnitPrice('($0.81/Ounce)', 'www.amazon.com'), 0.81);
  near(U.parseDisplayedUnitPrice('(£1.25/100 g)', 'www.amazon.co.uk'), 1.25 / (100 * G));
  near(U.parseDisplayedUnitPrice('(£3.20/kg)', 'www.amazon.co.uk'), 3.2 / (1000 * G));
  near(U.parseDisplayedUnitPrice('(€2.10/kg)', 'www.amazon.ie'), 2.1 / (1000 * G));
  near(U.parseDisplayedUnitPrice('($1.10/100 g)', 'www.amazon.ca'), 1.1 / (100 * G));
  near(U.parseDisplayedUnitPrice('($0.90/100 g)', 'www.amazon.com.au'), 0.9 / (100 * G));
  near(U.parseDisplayedUnitPrice('(₹49.90/100 g)', 'www.amazon.in'), 49.9 / (100 * G));
  near(U.parseDisplayedUnitPrice('(9,98 €/kg)', 'www.amazon.de'), 9.98 / (1000 * G));
  near(U.parseDisplayedUnitPrice('(0,30 €/100 ml)', 'www.amazon.de'), 0.3 / (100 * ML));
  near(U.parseDisplayedUnitPrice('(1,99 €/l)', 'www.amazon.fr'), 1.99 / (1000 * ML));
  near(U.parseDisplayedUnitPrice('R$ 4,99/kg', 'www.amazon.com.br'), 4.99 / (1000 * G), 'was 100 times too high');
  near(U.parseDisplayedUnitPrice('(99,80 kr/kg)', 'www.amazon.se'), 99.8 / (1000 * G));
  const fluid = U.parseDisplayedUnit('(0,30 €/100 ml)', 'www.amazon.de');
  assert.equal(fluid.kind, 'fluid');
});

test('package sizes in titles read decimal commas on comma-decimal stores only', () => {
  near(U.parseWeightToOunces('Haferflocken 1,5 kg', 'www.amazon.de'), 1500 * G);
  near(U.parseWeightToOunces('Rice 1,000 g', 'www.amazon.com'), 1000 * G, 'a thousands comma');
  near(U.parseWeightToOunces('Lait demi-écrémé 6 x 1 L, Pack of 6', 'www.amazon.fr'), 6000 * ML);
  near(U.parseWeightToOunces('Mandeln 200 Gramm', 'www.amazon.de'), 200 * G);
  const card = { title: 'Porridge Oats 1,5 kg', text: 'Porridge Oats 1,5 kg\n3,00 €', listingPrice: 3 };
  near(U.unitPriceFor(card, {}, 'www.amazon.de').unitPrice, 3 / (1500 * G));
});

test('the list shows per ounce on amazon.com and per 100 g / 100 ml on metric stores', () => {
  assert.equal(SF.storefront('www.amazon.com').units, 'imperial');
  for (const host of ['www.amazon.co.uk', 'www.amazon.de', 'www.amazon.ca', 'www.amazon.in']) assert.equal(SF.storefront(host).units, 'metric', host);
  assert.deepEqual(U.displayUnit(0.5, 'weight', 'imperial'), { value: 0.5, per: 'oz' });
  assert.deepEqual(U.displayUnit(0.5, 'fluid', 'imperial'), { value: 0.5, per: 'floz' });
  const g = U.displayUnit(1.25 / (100 * G), 'weight', 'metric');
  assert.equal(g.per, '100g'); near(g.value, 1.25);
  const ml = U.displayUnit(0.3 / (100 * ML), 'fluid', 'metric');
  assert.equal(ml.per, '100ml'); near(ml.value, 0.3);
  assert.equal(U.displayUnit(null, 'weight', 'metric'), null);
});

test('the sort options are on only where the tests cover the store', () => {
  const on = Object.entries(SF.STORES).filter(([, s]) => s.sort).map(([k]) => k).sort();
  assert.deepEqual(on, ['ca', 'co.uk', 'com', 'com.au', 'ie', 'in', 'sg']);
  for (const host of ['www.amazon.de', 'www.amazon.co.jp', 'www.amazon.com.br', 'www.amazon.com.mx']) assert.equal(SF.sortEnabled(host), false, host);
  assert.equal(SF.sortEnabled('www.example.com'), false);
  assert.equal(SF.sortEnabled('https://www.amazon.co.uk/s?k=oats'), true, 'a URL works as well as a host');
});

// ---------------------------------------------------------------- the content script (sort.js)
// A tiny DOM: enough for the menu finder, the price reader and the gate.
function el(tag, { attrs = {}, text = '', kids = [], cls = '' } = {}) {
  const node = {
    tagName: tag.toUpperCase(), attrs, kids, textContent: text, parentElement: null,
    classList: { contains: c => cls.split(' ').includes(c) },
    get value() { return attrs.value || ''; },
    get options() { return kids.filter(k => k.tagName === 'OPTION'); },
    get id() { return attrs.id || ''; },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    matches(sel) { return sel.split(',').some(one => match(node, one.trim())); },
    closest(sel) { for (let n = node; n; n = n.parentElement) if (n.matches(sel)) return n; return null; },
    querySelectorAll(sel) { const out = []; const walk = n => { for (const k of n.kids) { if (k.matches(sel)) out.push(k); walk(k); } }; walk(node); return out; },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
  };
  node._cls = cls;
  kids.forEach(k => { k.parentElement = node; });
  return node;
}
function match(n, sel) {
  const not = sel.match(/^(.*):not\((.*)\)$/);
  if (not) return match(n, not[1]) && !match(n, not[2]);
  const m = sel.match(/^([a-z]*)((?:\.[\w-]+)*)(?:#([\w-]+))?(?:\[([\w-]+)\*?="?([^"\]]*)"?\])?$/i);
  if (!m) return false;
  const [, tag, classes, id, attr, value] = m;
  if (tag && n.tagName !== tag.toUpperCase()) return false;
  if (classes && !classes.split('.').filter(Boolean).every(c => n._cls.split(' ').includes(c))) return false;
  if (id && n.attrs.id !== id) return false;
  if (attr && (n.attrs[attr] == null || (value && !String(n.attrs[attr]).includes(value)))) return false;
  return true;
}
function loadSort(hostname) {
  const context = vm.createContext({
    location: { hostname, pathname: '/s', search: '?k=oats', href: `https://${hostname}/s?k=oats`, origin: `https://${hostname}` },
    URL, URLSearchParams, console,
    chrome: { i18n: { getMessage: () => '' }, runtime: {} },
    document: { querySelectorAll: () => [] },
    AIR: { db: { storefronts: SF, sortedResults: R, unitPrice: U }, page: { state: { enabled: true, unitPrice: true } } },
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(require.resolve('../src/content/sort.js'), 'utf8'), context);
  return context.AIR.sort;
}

test("Amazon's sort menu is found by its values in any language", () => {
  const sort = loadSort('www.amazon.de');
  const option = (value, text) => el('option', { attrs: { value }, text });
  const german = el('select', { attrs: { id: 's-result-sort-select' }, kids: [
    option('relevanceblender', 'Empfohlen'), option('price-asc-rank', 'Preis: aufsteigend'),
    option('price-desc-rank', 'Preis: absteigend'), option('review-rank', 'Durchschn. Kundenbewertung'),
  ] });
  const japanese = el('select', { attrs: { id: 's-result-sort-select' }, kids: [
    option('relevanceblender', 'おすすめ順'), option('price-asc-rank', '価格の安い順番'),
  ] });
  const unrelated = el('select', { attrs: { id: 'quantity-sort-select' }, kids: [option('1', '1'), option('2', '2')] });
  const doc = el('div', { kids: [german, japanese, unrelated] });
  assert.equal(sort.sortSelects(doc).length, 2);
});

test('the sort menu stays out of stores the tests do not cover', () => {
  assert.equal(loadSort('www.amazon.com').storeSupported(), true);
  assert.equal(loadSort('www.amazon.co.uk').storeSupported(), true);
  assert.equal(loadSort('www.amazon.de').storeSupported(), false);
  assert.equal(loadSort('www.amazon.com.br').storeSupported(), false);
});

test("a listing's price comes from Amazon's whole and fraction parts, else the store's own format", () => {
  const priceCard = (parts, host) => {
    const sort = loadSort(host);
    return sort.getPrice(el('div', { kids: [el('span', { cls: 'a-price', kids: parts })] }));
  };
  const whole = t => el('span', { cls: 'a-price-whole', text: t });
  const fraction = t => el('span', { cls: 'a-price-fraction', text: t });
  const offscreen = t => el('span', { cls: 'a-offscreen', text: t });
  assert.equal(priceCard([offscreen('$4.99'), whole('4.'), fraction('99')], 'www.amazon.com'), 4.99);
  assert.equal(priceCard([offscreen('1.234,56 €'), whole('1.234,'), fraction('56')], 'www.amazon.de'), 1234.56);
  assert.equal(priceCard([offscreen('₹1,299.00'), whole('1,299.'), fraction('00')], 'www.amazon.in'), 1299);
  assert.equal(priceCard([offscreen('￥1,280'), whole('1,280')], 'www.amazon.co.jp'), 1280, 'no fraction part');
  assert.equal(priceCard([offscreen('£4.99')], 'www.amazon.co.uk'), 4.99, 'text only');
  assert.equal(priceCard([offscreen('4,99 €')], 'www.amazon.de'), 4.99);
});

test('ratings and review counts read in each store\'s wording', () => {
  const sort = loadSort('www.amazon.de');
  assert.equal(sort.ratingValue('4.6 out of 5 stars'), 4.6);
  assert.equal(sort.ratingValue('4,6 von 5 Sternen'), 4.6);
  assert.equal(sort.ratingValue('4,6 sur 5 étoiles'), 4.6);
  assert.equal(sort.ratingValue('5つ星のうち4.6'), 4.6);
  assert.equal(sort.ratingValue('no rating'), null);
  assert.equal(sort.reviewCount('(12,345)', 'www.amazon.com'), 12345);
  assert.equal(sort.reviewCount('(12.345)', 'www.amazon.de'), 12345, 'a thousands dot');
  assert.equal(sort.reviewCount('(2.3K)', 'www.amazon.com'), 2300);
  assert.equal(sort.reviewCount('1K+', 'www.amazon.com'), 1000);
  assert.equal(sort.reviewCount('2,310 ratings', 'www.amazon.com'), 2310);
});

test('price and size parsing stays linear on long runs of digits', () => {
  // "\d*\.?\d+" in the size pattern split a digit run every possible way from every position:
  // 6,000 digits took 226 seconds. Each input here must take well under a second.
  const budget = (label, f) => {
    const start = process.hrtime.bigint();
    f();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 1000, `${label} took ${ms.toFixed(0)} ms`);
  };
  for (const text of ['1'.repeat(6000), '1 '.repeat(3000) + 'g', '1.2,3.4,'.repeat(750), '1 '.repeat(3000) + '€']) {
    budget(`unitPriceFor ${JSON.stringify(text.slice(0, 8))}…`, () => U.unitPriceFor({ title: text.slice(0, 400), text, listingPrice: 5 }, { unitMissing: 'infer-more' }, 'www.amazon.de'));
    budget(`parsePrice ${JSON.stringify(text.slice(0, 8))}…`, () => R.parseMoney(text, 'www.amazon.de'));
  }
  // And the anchored patterns still read what they did.
  assert.equal(U.parseWeightToOunces('Mints .5 oz'), 0.5);
  near(U.parseDisplayedUnitPrice('$3.49 (38.1¢/Ounce)'), 0.381);
  assert.equal(R.parseMoney('Preis: 4,99 €', 'www.amazon.de'), 4.99);
});

test('UK imperial pints and litres agree; US pints remain US units', () => {
  const U = require('../src/engine/db/unit-price.js');
  assert.ok(Math.abs(U.parseQuantity('Milk 1 pint', 'amazon.co.uk').ounces - 568.26125 / 29.5735295625) < 1e-8);
  assert.ok(U.parseQuantity('Milk 1 litre (1.76 pints)', 'amazon.co.uk'));
  assert.equal(U.parseQuantity('Milk 1 pint', 'amazon.com').ounces, 16);
  assert.ok(U.parseQuantity('Milk 1 pint (20 fl oz)', 'amazon.co.uk'));
  assert.ok(U.parseQuantity('Milk 1 pint (16 fl oz)', 'amazon.com'));
  assert.ok(Math.abs(U.parseDisplayedUnit('£1.00/20 fl oz', 'amazon.co.uk').perOz - 29.5735295625 / 568.26125) < 1e-8);
  assert.ok(Math.abs(U.parseDisplayedUnit('£1.00/Pint', 'amazon.co.uk').perOz - 29.5735295625 / 568.26125) < 1e-8);
});
