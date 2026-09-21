// Chrome injects a content script only when a match pattern hits the URL.
// Run: node tests/content-matches.test.js
//
// URLPattern compares the pattern path to GURL::PathForRequest(), which is the path
// plus the query string. `/s` and `/s/*` therefore miss https://www.amazon.com/s?k=oats,
// the URL almost every grocery search uses. The content script never loads, so search
// tiles never get a badge. This is the regression.
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'content-matches.mjs')));
  const { AMAZON_HOSTS, PATH_PATTERNS, buildContentMatches, contentScriptWouldRun } = mod;

  let failed = 0;
  const check = (name, fn) => {
    try { fn(); console.log('  ok  ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
  };

  const matches = buildContentMatches();
  const runs = url => contentScriptWouldRun(url, matches);

  console.log('canonical search URLs inject');
  const SHOULD = [
    'https://www.amazon.com/s?k=organic+oats',
    'https://www.amazon.com/s?k=organic+oats&i=grocery&ref=nb_sb_noss',
    'https://amazon.com/s?k=peanut+butter',
    'http://www.amazon.com/s?k=olive+oil',
    'https://www.amazon.com/s',
    'https://www.amazon.com/s/ref=nb_sb_noss_2?url=search-alias%3Dgrocery&field-keywords=oats',
    'https://www.amazon.com/-/en/s?k=oat+milk',
    'https://www.amazon.de/-/en/s?k=haferflocken',
    'https://www.amazon.com/gp/aw/s?k=greek+yogurt',
    'https://www.amazon.com/b?node=16310101',
    'https://www.amazon.com/dp/B00LOAW7U6',
    'https://www.amazon.com/Organic-Rolled-Oats/dp/B00LOAW7U6?ref=sr_1_1',
    'https://www.amazon.com/gp/product/B00LOAW7U6',
    'https://www.amazon.co.uk/s?k=porridge+oats',
    'https://www.amazon.co.jp/s?k=oats',
  ];
  for (const url of SHOULD) {
    check(url, () => assert.ok(runs(url), 'content script would not inject'));
  }

  console.log('\nevery store covers a query-string search');
  for (const host of AMAZON_HOSTS) {
    check(host, () => {
      assert.ok(runs(`https://www.${host}/s?k=oats`), `www.${host} /s?k= missed`);
      assert.ok(runs(`https://${host}/s?k=oats`), `${host} apex /s?k= missed`);
    });
  }

  console.log('\nthe patterns that shipped in PR #10 do not');
  const before = buildContentMatches(AMAZON_HOSTS, PATH_PATTERNS.filter(p => p !== '/s?*' && p !== '/b?*' && !p.startsWith('/*/s')));
  check('/s and /s/* miss /s?k=', () => {
    const url = 'https://www.amazon.com/s?k=organic+oats&i=grocery';
    assert.ok(!contentScriptWouldRun(url, before), 'the old list unexpectedly matched');
    assert.ok(runs(url));
  });

  console.log('\naccount and cart pages stay quiet');
  for (const url of [
    'https://www.amazon.com/gp/cart/view.html',
    'https://www.amazon.com/cart/add-to-cart',
    'https://www.amazon.com/ap/signin',
    'https://www.amazon.com/gp/css/order-history',
    'https://www.amazon.com/gp/your-account/order-history',
    'https://www.amazon.com/your-account',
    'https://www.amazon.com/gp/buy/spc/handlers/display.html',
    'https://www.amazon.com/checkout/entry/cart',
    'https://www.amazon.com/sp?k=oats',
    'https://www.amazon.com/stores/WholeFoodsMarket/page/ABC',
  ]) {
    // Store pages are an intentional list surface. The rest must not inject.
    if (url.includes('/stores/')) {
      check(url + ' (stores still inject)', () => assert.ok(runs(url)));
      continue;
    }
    check(url, () => assert.ok(!runs(url), 'content script would inject'));
  }

  check('manifest list equals the builder', () => {
    const manifest = require('../manifest.json');
    assert.deepStrictEqual(manifest.content_scripts[0].matches, matches);
  });

  if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
