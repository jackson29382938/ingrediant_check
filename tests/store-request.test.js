// Store wishlist: validation, what goes into the email draft, and how it is encoded.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/options/store-request.js');
const stores = require('../src/stores/registry.js');

const build = (name, url) => R.buildRequest({ name, url }, stores);
const decode = mailto => {
  const u = new URL(mailto);
  return { to: u.pathname, subject: decodeURIComponent(u.search.match(/subject=([^&]*)/)[1]),
    body: decodeURIComponent(u.search.match(/body=([^&]*)/)[1]) };
};

test('empty, whitespace-only and missing names are refused', () => {
  for (const name of ['', '   ', '\n\t', undefined, null]) {
    const r = build(name, '');
    assert.equal(r.ok, false);
    assert.equal(r.errors.name, 'name-empty', JSON.stringify(name));
    assert.equal(r.mailto, undefined, 'no draft for an invalid request');
  }
});

test('names are length-limited and restricted to name characters', () => {
  assert.equal(build('W', '').errors.name, 'name-short');
  assert.equal(build('W'.repeat(R.NAME_MAX + 1), '').errors.name, 'name-long');
  assert.equal(build('W'.repeat(R.NAME_MAX), '').ok, true);
  for (const bad of ['<script>alert(1)</script>', 'Shop; DROP', '1234', '!!!', 'Tesco%0ABcc', 'a"b']) {
    assert.equal(build(bad, '').ok, false, bad);
  }
  assert.equal(build('me@example.com', '').errors.name, 'name-looks-like-address');
  assert.equal(build('https://shop.example', '').errors.name, 'name-looks-like-address');
  for (const good of ["Trader Joe's", 'H-E-B', 'Marks & Spencer', 'Sprouts Farmers Market (US)', 'Rewe', 'Migros', 'Ländle Markt', 'イオン']) {
    assert.equal(build(good, '').ok, true, good);
  }
});

test('whitespace and line breaks in a name collapse, so nothing can add a mail header', () => {
  const r = build('  Whole\r\nFoods\n\nBcc: someone  ', '');
  // The colon makes this an address-like name, so it is refused outright.
  assert.equal(r.ok, false);
  const ok = build('  Whole\r\n  Foods  ', '');
  assert.equal(ok.ok, true);
  assert.equal(decode(ok.mailto).subject, 'Store request: Whole Foods');
});

test('the website is optional and cut down to its origin', () => {
  const none = build('Wegmans', '');
  assert.equal(none.ok, true);
  assert.match(decode(none.mailto).body, /Website: \(not given\)/);

  const product = build('Wegmans', 'https://shop.wegmans.com/product/12345/organic-oats?utm_source=x&session=abc#reviews');
  assert.equal(product.ok, true);
  assert.deepEqual(product.notes, ['url-trimmed']);
  const body = decode(product.mailto).body;
  assert.match(body, /Website: https:\/\/shop\.wegmans\.com\r\n/);
  assert.doesNotMatch(body, /12345|organic|utm|session|reviews/, 'product, query and fragment are dropped');

  assert.equal(R.cleanUrl('wegmans.com').value, 'https://wegmans.com', 'a bare domain gets https://');
  assert.equal(R.cleanUrl('http://www.aldi.us/').value, 'http://www.aldi.us');
  assert.equal(R.cleanUrl('https://www.aldi.us/').trimmed, false, 'a bare "/" is not a trim');
});

test('malformed, non-web, private and oversized addresses are refused', () => {
  const cases = {
    'not a url': 'url-invalid', 'https://': 'url-invalid', 'https://shop': 'url-invalid',
    'https://shop.123': 'url-invalid', 'ftp://shop.example.com': 'url-scheme',
    'javascript:alert(1)': 'url-scheme', 'mailto:x@example.com': 'url-scheme', 'data:text/html,hi': 'url-scheme',
    'https://user:pw@shop.example.com': 'url-credentials', 'https://localhost:3000': 'url-not-public',
    'http://192.168.1.10/shop': 'url-not-public', 'http://[::1]/': 'url-not-public',
    ['https://shop.example.com/' + 'a'.repeat(R.URL_MAX)]: 'url-long',
  };
  for (const [url, error] of Object.entries(cases)) {
    const r = build('Some Store', url);
    assert.equal(r.ok, false, url);
    assert.equal(r.errors.url, error, url);
  }
});

test('the draft is addressed to the maintainer, fully percent-encoded, and holds only the two fields', () => {
  const r = build('Marks & Spencer', 'https://www.marksandspencer.com/food?x=1');
  assert.equal(r.ok, true);
  assert.equal(r.to, 'jackson29382938@gmail.com');
  assert.ok(r.mailto.startsWith('mailto:jackson29382938@gmail.com?subject='));
  // "&" in the name must not start a new mailto parameter, and spaces are %20, never "+".
  const query = r.mailto.slice(r.mailto.indexOf('?') + 1);
  assert.deepEqual(query.split('&').map(p => p.split('=')[0]), ['subject', 'body']);
  assert.doesNotMatch(r.mailto, /[ +\r\n]/);
  assert.match(r.mailto, /Marks%20%26%20Spencer/);
  const d = decode(r.mailto);
  assert.equal(d.subject, 'Store request: Marks & Spencer');
  assert.equal(d.body, r.body, 'the preview shown is exactly what the draft contains');
  const lines = d.body.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 4, d.body);
  assert.deepEqual(lines.slice(1, 3), ['Store: Marks & Spencer', 'Website: https://www.marksandspencer.com']);
});

test('supported stores are not requested again; planned ones are noted', () => {
  assert.equal(build('Amazon', '').errors.name, 'already-supported');
  assert.equal(build('My shop', 'https://www.amazon.co.uk/dp/B000000000').errors.name, 'already-supported');
  assert.equal(build('Not Amazon', 'https://notamazon.com').ok, true, 'a look-alike domain is not Amazon');
  const target = build('Target', 'https://www.target.com');
  assert.equal(target.ok, true);
  assert.ok(target.notes.includes('already-planned'));
  assert.ok(R.MESSAGES['already-supported'] && Object.keys(R.MESSAGES).every(k => R.MESSAGES[k]));
});
