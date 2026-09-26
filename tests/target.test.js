// Target: the store adapter against pages captured live (tests/pages/target-*.html, 2026-09-25),
// synthetic layout changes, and the content-script runner. Run: node --test tests/target.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../src/engine/db/_module.js');
require('../src/engine/categories.js');
require('../src/engine/db/revision.js');
const prefs = require('../src/engine/db/prefs.js');
const ingestible = require('../src/engine/db/ingestible.js');
const scoreCache = require('../src/engine/db/score-cache.js');
const engine = require('../src/engine/score.js');
const T = require('../src/stores/target.js');
const { loadPage, createDocument } = require('./pages/load.js');

const at = href => ({ href, pathname: new URL(href).pathname, hostname: new URL(href).hostname });
const CHIPS_URL = 'https://www.target.com/p/boulder-kettle-cooked-avocado-oil-canyon-cut-sea-salt-potato-chips-5-25oz/-/A-16600402';
const read = (file, url) => T.readProduct(loadPage(file), at(url));
const food = data => ingestible.assess({ querySelector: () => null },
  { title: data.title, text: [data.crumbs.join(' › '), data.title, data.labelText].join(' \n ') });

// ------------------------------------------------------------------ adapter
test('product ids come from /p/…/-/A-<TCIN> only', () => {
  assert.equal(T.productId(CHIPS_URL), '16600402');
  assert.equal(T.productId('https://www.target.com/p/bare-simply-dried-banana-2-7oz/-/A-1010017135?preselect=1#lnk=sametab'), '1010017135');
  assert.equal(T.productId('/p/organic-old-fashioned-oats-18oz-good-38-gather-8482/-/A-79364857'), '79364857');
  for (const other of ['https://www.target.com/c/grocery/-/N-5xt1a', 'https://www.target.com/s?searchTerm=oats',
    'https://www.target.com/p/no-id-here', 'https://www.target.com/', 'not a url at all']) {
    assert.equal(T.productId(other), '', other);
  }
  assert.ok(T.matchesHost('www.target.com'));
  for (const h of ['target.com.evil.example', 'notwww.target.com', 'www.amazon.com']) assert.ok(!T.matchesHost(h), h);
});

test('search pages and their query', () => {
  assert.ok(T.isSearchPage(at('https://www.target.com/s?searchTerm=organic+oats')));
  assert.ok(T.isSearchPage(at('https://www.target.com/s/rolled+oats+organic')));
  assert.ok(!T.isSearchPage(at('https://www.target.com/sale')));
  assert.equal(T.searchQuery(at('https://www.target.com/s?searchTerm=organic+oats')), 'organic oats');
  assert.equal(T.searchQuery(at('https://www.target.com/s/rolled+oats+organic')), 'rolled oats organic');
});

test('grocery product with the label open: list, crumbs and nutrition are read (live capture)', () => {
  const chips = read('target-p-chips.html', CHIPS_URL);
  assert.equal(chips.id, '16600402');
  assert.equal(chips.label, 'open');
  assert.equal(chips.ingredients, 'potatoes, avocado oil, sea salt.');
  assert.deepEqual(chips.crumbs.slice(0, 2), ['Grocery', 'Snacks']);
  assert.equal(chips.nutrition.sodium, 120);
  assert.ok(food(chips).ok, 'grocery crumbs pass the food gate');
  const r = engine.score({ name: chips.title, ingredients_text: chips.ingredients, nutrition: chips.nutrition }, {});
  assert.ok(r.coverage >= 0.34 && r.score >= 90, `avocado-oil chips: ${r.score} at ${r.coverage}`);

  const oats = read('target-p-oats.html', 'https://www.target.com/p/x/-/A-79364857');
  assert.equal(oats.ingredients, 'organic whole grain rolled oats.');
  assert.ok(engine.score({ ingredients_text: oats.ingredients }, {}).score >= 88);
});

test('non-food product with the label collapsed: nothing to read, and the food gate refuses it', () => {
  const shampoo = read('target-p-shampoo.html', 'https://www.target.com/p/x/-/A-75570641');
  assert.equal(shampoo.label, 'collapsed');
  assert.equal(shampoo.ingredients, '');
  const verdict = food(shampoo);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.negatives.includes('cosmetic'), JSON.stringify(verdict));
});

test('fresh produce has no label section at all', () => {
  const banana = read('target-p-banana.html', 'https://www.target.com/p/x/-/A-15013944');
  assert.equal(banana.label, 'missing');
  assert.equal(banana.ingredients, '');
  assert.ok(food(banana).ok, 'still food: the runner fails honestly instead of calling it non-food');
});

test('search tiles: id, title and badge anchor for every result (live capture)', () => {
  const tiles = T.searchTiles(loadPage('target-s-oats.html'));
  assert.equal(tiles.length, 6);
  assert.ok(tiles.every(x => /^\d{6,12}$/.test(x.id) && x.title && x.anchor.tagName.toLowerCase() === 'h3'));
  assert.ok(tiles.some(x => x.id === '79364857' && /Organic Old Fashioned/.test(x.title)));
});

// Synthetic layout changes: not captured, written to prove the adapter degrades to "nothing read".
test('layout changes (synthetic): other heading tags still read; a renamed section reads nothing', () => {
  const label = inner => createDocument(`<html><body><h1 data-test="product-title">Oats</h1>
    <div data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><button aria-expanded="true">Label info</button>
    <div>${inner}</div></div></body></html>`);
  assert.equal(T.readProduct(label('<div><b>Ingredients:</b><span>oats, salt</span></div>'), at(CHIPS_URL)).ingredients, 'oats, salt');
  assert.equal(T.readProduct(label('<div><h4>Ingredients</h4><div>oats</div></div>'), at(CHIPS_URL)).ingredients, 'oats');
  assert.equal(T.readProduct(label('<div><h4>Nutrition only</h4><div>Calories 150</div></div>'), at(CHIPS_URL)).ingredients, '');
  const renamed = createDocument(`<html><body><h1 data-test="product-title">Oats</h1>
    <div data-test="LabelInfoV2"><h4>Ingredients:</h4><div>oats</div></div></body></html>`);
  const r = T.readProduct(renamed, at(CHIPS_URL));
  assert.equal(r.label, 'missing');
  assert.equal(r.ingredients, '', 'a renamed section is not guessed at');
  const tiles = createDocument(`<html><body>
    <div data-test="ListingPageProductListing"><a href="/c/oats/-/N-1">Oats</a><h3>Category, not a product</h3></div>
    <div data-test="ListingPageProductListing"><a href="/p/x/-/A-12345678">No title</a></div>
    <div data-test="ListingPageProductListing"><a href="/p/y/-/A-87654321"><h3>Real tile</h3></a></div></body></html>`);
  assert.deepEqual(T.searchTiles(tiles).map(x => x.id), ['87654321']);
});

// ------------------------------------------------------------------ runner
function runner(file, url, stored = {}) {
  const page = loadPage(file);
  const loc = new URL(url);
  const writes = [], messages = [], fetches = [], timers = [];
  let host = null;
  const clicks = [];
  // The loader's elements lack isConnected and insertBefore; real DOM elements have both.
  const insertInto = el => { el.isConnected = true; el.insertBefore = (child) => { (el.inserted = el.inserted || []).push(child); child.isConnected = true; }; };
  const title = page.querySelector('h1[data-test="product-title"]');
  if (title) title.parentNode.insertBefore = child => { host = child; child.isConnected = true; };
  for (const h3 of page.querySelectorAll('h3')) insertInto(h3);
  const toggle = T.labelToggle(page);
  if (toggle) toggle.click = () => clicks.push('label');
  const shadow = html => ({ querySelector: sel => {
    const cls = sel.split('.').pop();
    if (!html.includes(cls)) return null;
    return { addEventListener: (type, fn) => { shadow.handlers[cls] = fn; } };
  } });
  shadow.handlers = {};
  const data = { ...stored };
  const sandbox = {
    console, URL, Date, Math, JSON, Object, Array, String, Number,
    location: { href: loc.href, hostname: loc.hostname, pathname: loc.pathname, search: loc.search },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0,
    MutationObserver: class { observe() {} disconnect() {} },
    fetch: (...a) => { fetches.push(a); throw new Error('the Target runner must never fetch'); },
    document: {
      querySelector: s => page.querySelector(s), querySelectorAll: s => page.querySelectorAll(s),
      getElementById: id => (id === 'air-score-panel' ? host : null),
      createElement: tag => ({ tagName: tag, style: {}, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, querySelector: () => null,
        remove() { if (host === this) host = null; } }),
      body: {}, documentElement: {}, title: page.title, URL: url,
    },
    chrome: {
      runtime: { getManifest: () => ({ version: '1.1.0' }), sendMessage: (m, cb) => { messages.push(m); if (cb) cb(); },
        onMessage: { addListener() {} }, lastError: null },
      i18n: { getMessage: () => '' },
      storage: { local: {
        get: (keys, cb) => cb(Object.fromEntries([].concat(keys).map(k => [k, data[k]]))),
        set: v => { writes.push(v); Object.assign(data, v); },
      }, onChanged: { addListener() {} } },
    },
    AIR: {
      engine, storeAdapters: { target: T },
      db: { scoreCache, prefs, ingestible, speed: require('../src/engine/db/speed.js') },
      panel: {
        BAND_COLOR: () => ({ fg: '#000', bg: '#fff', ring: '#0f0' }),
        render: (r, meta) => `render:${r.score}:${meta.via}:report=${meta.report}`,
        renderNotFood: () => 'not-food anyway',
        renderNotice: meta => `notice notice-action ${meta.title}`,
        renderFailure: meta => `fail:${JSON.stringify(meta)}`,
        mount: (h, html, onReport, onPaste) => { h.html = html; h.onReport = onReport; h.onPaste = onPaste; return shadow(html); },
      },
    },
  };
  sandbox.self = sandbox;
  sandbox.module = { exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'retailer.js'), 'utf8'), sandbox);
  return { get host() { return host; }, writes, messages, fetches, timers, clicks, shadow, data, page,
    pass: () => sandbox.module.exports.pass(), sandbox };
}

test('runner: a Target product page is scored locally, cached for this computer, and never fetched', () => {
  const w = runner('target-p-chips.html', CHIPS_URL, { enabled: true });
  assert.equal(w.host.dataset.airState, 'scored');
  assert.match(w.host.html, /^render:9\d:page:report=false$/, 'no "Looks wrong?" report on Target: nothing goes to the shared database');
  const key = 's:target.com:16600402';
  const write = w.writes.find(x => x[key]);
  assert.ok(write, 'the score is cached under the Target key');
  assert.equal(write[key].source, 'page');
  assert.ok(scoreCache.valid(write[key], { store: 'target.com', asin: '16600402', version: '1.1.0', prefs: {} }),
    'the entry validates the way the popup and badges check it');
  assert.deepEqual(w.messages.map(m => m.type), ['pageScore'], 'the only message is the toolbar badge');
  assert.ok(w.messages[0].score >= 90);
  assert.equal(w.fetches.length, 0);
});

test('runner: shampoo is refused as non-food; "Score anyway" then asks for the collapsed label', () => {
  const w = runner('target-p-shampoo.html', 'https://www.target.com/p/x/-/A-75570641', {});
  assert.equal(w.host.dataset.airState, 'not-food');
  assert.deepEqual(JSON.parse(JSON.stringify(w.messages.at(-1))), { type: 'pageScore', status: 'not-food' });
  w.shadow.handlers.anyway();
  assert.equal(w.host.dataset.airState, 'waiting', 'label closed: prompt, not a score');
  assert.match(w.host.html, /notice/);
  w.shadow.handlers['notice-action']();
  assert.deepEqual(w.clicks, ['label'], 'the page is touched only when the visitor presses the button');
  assert.equal(w.fetches.length, 0);
  assert.equal(w.writes.length, 0, 'nothing cached');
});

test('runner: a missing label waits for the page, then fails honestly with Target named', () => {
  const w = runner('target-p-banana.html', 'https://www.target.com/p/x/-/A-15013944', {});
  assert.equal(w.host, null, 'no card while the page may still be rendering');
  assert.ok(w.timers.length, 'a timer makes sure it gives up even if the page goes quiet');
  const realNow = Date.now;
  w.sandbox.Date = { now: () => realNow() + 16000 };
  try { w.timers.at(-1).fn(); } finally { w.sandbox.Date = Date; }
  assert.equal(w.host.dataset.airState, 'fail');
  assert.match(w.host.html, /"storeName":"Target"/);
  assert.equal(typeof w.host.onPaste, 'function', 'the paste box works on Target too');
  w.host.onPaste('Bananas');
  assert.match(w.host.html, /^render:\d+:manual-paste/);
  assert.equal(w.writes.length, 0, 'pasted scores stay on the tab, as on Amazon');
});

test('runner: search badges come only from this computer\'s cache; nothing is requested', () => {
  const oats = engine.score({ ingredients_text: 'organic whole grain rolled oats.' }, {});
  const entry = { schema: scoreCache.SCHEMA, v: '1.1.0', t: Date.now() - 1000, store: 'target.com', asin: '79364857',
    prefs: scoreCache.fingerprint({}, 'page'), score: oats.score, verdict: oats.verdict, nova: oats.nova, source: 'page',
    provenanceSource: '', name: 'Oats' };
  const w = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=organic+oats', { 's:target.com:79364857': entry });
  const painted = [...w.page.querySelectorAll('h3')].filter(h => h.inserted && h.inserted.length);
  assert.equal(painted.length, 1, 'only the product opened before gets a badge');
  assert.equal(painted[0].inserted[0].textContent, String(oats.score));
  assert.equal(painted[0].inserted[0].attrs.role, 'img', 'named for screen readers, not a bare number');
  assert.match(painted[0].inserted[0].attrs['aria-label'], new RegExp(`${oats.score}/100`));
  assert.equal(w.fetches.length, 0);
  assert.equal(w.messages.length, 0);

  // A second pass over an unchanged badge must not touch it: a rewrite is a DOM change, and the
  // page watcher answers every change with another pass.
  const badge = painted[0].inserted[0];
  let rewrites = 0;
  let text = badge.textContent;
  Object.defineProperty(badge, 'textContent', { get: () => text, set: v => { rewrites++; text = v; } });
  painted[0].querySelector = sel => (sel === '.air-badge' ? badge : null);
  w.pass();
  assert.equal(rewrites, 0, 'an unchanged badge is left alone');

  const shampoo = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=shampoo', { 's:target.com:79364857': entry });
  assert.equal([...shampoo.page.querySelectorAll('h3')].filter(h => h.inserted).length, 0, 'a non-food search stands down');
});

test('runner: the master switch off means nothing on the page', () => {
  const w = runner('target-p-chips.html', CHIPS_URL, { enabled: false });
  assert.equal(w.host, null);
  assert.equal(w.writes.length, 0);
  assert.equal(w.fetches.length, 0);
});

test('nutrition rows read thousands commas and decimals', () => {
  const html = `<html><body><h1 data-test="product-title">Soup</h1>
    <div data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><button aria-expanded="true">Label info</button>
    <div><p>Serving size: 1 cup (245g)</p><div><b>Sodium</b> 1,200mg</div><div><b>Protein</b> 7.5g</div>
    <div><b>Total Sugars</b> 2g</div><h4>Ingredients:</h4><div>Water, chicken, salt</div></div></div></body></html>`;
  const data = T.readProduct(createDocument(html), at('https://www.target.com/p/soup/-/A-12345678'));
  assert.equal(data.nutrition.sodium, 1200, 'not 1');
  assert.equal(data.nutrition.protein, 7.5);
  assert.equal(data.nutrition.sugar, 2);
  assert.equal(data.nutrition.servingGrams, 245);
});

test('runner: search badges keep a saved score as long as the speed setting says', () => {
  const oats = engine.score({ ingredients_text: 'organic whole grain rolled oats.' }, {});
  const entry = { schema: scoreCache.SCHEMA, v: '1.1.0', t: Date.now() - 45 * 24 * 60 * 60 * 1000, store: 'target.com', asin: '79364857',
    prefs: scoreCache.fingerprint({}, 'page'), score: oats.score, verdict: oats.verdict, nova: oats.nova, source: 'page',
    provenanceSource: '', name: 'Oats' };
  const painted = speedMode => {
    const w = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=organic+oats', { 's:target.com:79364857': entry, speedMode });
    return [...w.page.querySelectorAll('h3')].filter(h => h.inserted && h.inserted.length).length;
  };
  assert.equal(painted('balanced'), 0, 'Balanced: 45 days is past 30');
  assert.equal(painted('fastest'), 1, 'Fastest keeps 90 days');
});
