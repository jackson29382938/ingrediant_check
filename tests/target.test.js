// Target: the store adapter against pages captured live (tests/pages/target-*.html, 2026-09-25),
// synthetic layout changes, and the content-script runner. Run: node --test tests/target.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadPageReader } = require('./page-reader.js');

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
function runner(file, url, stored = {}, productOverride = null) {
  const page = loadPage(file);
  const loc = new URL(url);
  const writes = [], messages = [], fetches = [], timers = [];
  let host = null;
  const clicks = [];
  // The loader's elements lack isConnected and insertBefore; real DOM elements have both.
  const insertInto = el => {
    el.isConnected = true;
    const original = el.querySelector.bind(el);
    el.querySelector = selector => selector === '.air-badge' ? el.inserted?.find(child => !child.removed) || null : original(selector);
    el.appendChild = child => { (el.inserted = el.inserted || []).push(child); child.isConnected = true; };
  };
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
  const data = { autoScoreSearch: false, ...stored };
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
        remove() { this.removed = true; if (host === this) host = null; } }),
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
      engine, storeAdapters: { target: productOverride ? { ...T, readProduct: () => productOverride } : T },
      db: { scoreCache, prefs, ingestible, speed: require('../src/engine/db/speed.js') },
      panel: {
        BAND_COLOR: () => ({ fg: '#000', bg: '#fff', ring: '#0f0' }),
        render: (r, meta) => `render:${r.score}:${meta.via}:report=${meta.report}`,
        renderNotFood: () => 'not-food anyway',
        renderPersonalCare: r => `personal-care:${r.category}:${r.ingredients}`,
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
  loadPageReader(vm, sandbox);   // the shared page reader
  return { get host() { return host; }, writes, messages, fetches, timers, clicks, shadow, data, page,
    pass: () => sandbox.module.exports.pass(), sandbox };
}

test('runner: personal-care labels use the ingredient review, not food scoring or score cache', () => {
  const data = { id: '75570641', title: 'Gentle shampoo', ingredients: 'Water, Fragrance',
    label: 'open', labelText: 'Ingredients: Water, Fragrance', crumbs: ['Beauty & Personal Care'] };
  const w = runner('target-p-shampoo.html', 'https://www.target.com/p/x/-/A-75570641', { foodOnly: false }, data);
  assert.equal(w.host.dataset.airState, 'personal-care');
  assert.match(w.host.html, /personal-care:shampoo:Water, Fragrance/);
  assert.equal(w.writes.length, 0);
  assert.equal(w.messages.some(m => typeof m.score === 'number'), false);
});

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
  assert.deepEqual(w.messages.map(m => m.type), ['pageScore', 'pageScore'], 'the only message is the toolbar badge');
  assert.ok(w.messages.at(-1).score >= 90);
  assert.equal(w.fetches.length, 0);
});

test('runner: shampoo is refused as non-food; "Score anyway" then asks for the collapsed label', () => {
  const w = runner('target-p-shampoo.html', 'https://www.target.com/p/x/-/A-75570641', { personalCareEnabled: false });
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

test('runner: search badges come only from this computer\'s cache; nothing is requested', async () => {
  const oats = engine.score({ ingredients_text: 'organic whole grain rolled oats.' }, {});
  const entry = { schema: scoreCache.SCHEMA, v: '1.1.0', t: Date.now() - 1000, store: 'target.com', asin: '79364857',
    prefs: scoreCache.fingerprint({}, 'page'), score: oats.score, verdict: oats.verdict, nova: oats.nova, source: 'page',
    provenanceSource: '', name: 'Oats' };
  const w = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=organic+oats', { 's:target.com:79364857': entry });
  await new Promise(setImmediate);
  const painted = [...w.page.querySelectorAll('h3')].filter(h => h.inserted?.some(b => /^\d+$/.test(b.textContent)));
  assert.equal(painted.length, 1, 'only the product opened before gets a badge');
  assert.equal(painted[0].inserted[0].textContent, String(oats.score));
  assert.equal(painted[0].inserted[0].attrs.role, 'img', 'named for screen readers, not a bare number');
  assert.match(painted[0].inserted[0].attrs['aria-label'], new RegExp(`${oats.score}/100`));
  assert.equal(w.fetches.length, 0);
  assert.equal(w.messages.length, 1);
  assert.equal(w.messages[0].status, null);

  // A second pass over an unchanged badge must not touch it: a rewrite is a DOM change, and the
  // page watcher answers every change with another pass.
  const badge = painted[0].inserted[0];
  let rewrites = 0;
  let text = badge.textContent;
  Object.defineProperty(badge, 'textContent', { get: () => text, set: v => { rewrites++; text = v; } });
  painted[0].querySelector = sel => (sel === '.air-badge' ? badge : null);
  w.pass();
  await new Promise(setImmediate);
  assert.equal(rewrites, 0, 'an unchanged badge is left alone');

  const shampoo = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=shampoo', { 's:target.com:79364857': entry, personalCareEnabled: false });
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

test('runner: search badges keep a saved score as long as the speed setting says', async () => {
  const oats = engine.score({ ingredients_text: 'organic whole grain rolled oats.' }, {});
  const entry = { schema: scoreCache.SCHEMA, v: '1.1.0', t: Date.now() - 45 * 24 * 60 * 60 * 1000, store: 'target.com', asin: '79364857',
    prefs: scoreCache.fingerprint({}, 'page'), score: oats.score, verdict: oats.verdict, nova: oats.nova, source: 'page',
    provenanceSource: '', name: 'Oats' };
  const painted = async speedMode => {
    const w = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=organic+oats', { 's:target.com:79364857': entry, speedMode });
    await new Promise(setImmediate);
    return [...w.page.querySelectorAll('h3')].filter(h => h.inserted?.some(b => /^\d+$/.test(b.textContent))).length;
  };
  assert.equal(await painted('balanced'), 0, 'Balanced: 45 days is past 30');
  assert.equal(await painted('fastest'), 1, 'Fastest keeps 90 days');
});

test('Target removes invalid badges and clears the toolbar on SPA navigation', async () => {
  const key = 's:target.com:79364857';
  const hit = {schema:scoreCache.SCHEMA,v:'1.1.0',t:Date.now()-1000,store:'target.com',asin:'79364857',
    prefs:scoreCache.fingerprint({},'page'),score:98,verdict:'Excellent',source:'page'};
  const w = runner('target-s-oats.html', 'https://www.target.com/s?searchTerm=organic+oats', {[key]:hit});
  await new Promise(setImmediate);
  const anchor = [...w.page.querySelectorAll('h3')].find(h=>h.inserted?.length);
  const badge = anchor.inserted[0]; let removed = false;
  badge.remove = () => { removed = true; };
  anchor.querySelector = s => s === '.air-badge' ? badge : null;
  delete w.data[key]; w.pass();
  assert.equal(removed, false, 'replace a stale score with a visible open-to-rate status');
  assert.equal(badge.textContent, 'Open to rate');
  const product = runner('target-p-chips.html', CHIPS_URL, {});
  product.sandbox.location.href = 'https://www.target.com/c/grocery/-/N-5xt1a';
  product.sandbox.location.pathname = '/c/grocery/-/N-5xt1a';
  product.sandbox.module.exports.reset();
  assert.equal(product.messages.at(-1).status, null);
});

test('Target rejects stale canonical product labels and foreign product links', () => {
  const html = '<link rel="canonical" href="https://www.target.com/p/oats/-/A-79364857"><section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><h4>Ingredients:</h4><div>whole grain oats</div></section>';
  assert.equal(T.readProduct(createDocument(html), at(CHIPS_URL)).ingredients, '');
  assert.equal(T.productId('https://evil.example/p/oats/-/A-79364857'), '');
});

test('Target uses explicit serving weights and volumes without guessing cups or pieces', () => {
  const facts = size => T.nutritionFacts(createDocument(`<section><p>Serving Size: ${size}</p>
    <div><b>Sodium</b> 120mg</div><div><b>Saturated Fat</b> .5g</div></section>`));
  assert.equal(facts('1 oz').servingGrams, 28.349523125, 'the live chips serving size is usable');
  assert.equal(facts('40 grams').servingGrams, 40);
  assert.equal(facts('1 cup (240ml)').servingMl, 240);
  assert.equal(facts('8 fl oz').servingMl, 236.5882365, 'fluid ounces are volume, not weight');
  assert.equal(facts('8 fl. oz (240 ml)').servingMl, 240, 'printed metric value takes precedence');
  assert.equal(facts('1 cup').servingGrams, undefined);
  assert.equal(facts('1/2 oz').servingGrams, undefined, 'an unsupported fraction must not become 2 oz');
  assert.equal(facts('1 oz').saturatedFat, 0.5);
  assert.equal(read('target-p-chips.html', CHIPS_URL).nutrition.servingGrams, 28.349523125);
});

test('Target nutrition conflicts remain unknown instead of overwriting values from another panel', () => {
  const facts = html => T.nutritionFacts(createDocument(`<section>${html}</section>`));
  const repeated = facts('<div><b>Sodium</b> 120mg</div><div><b>Sodium</b> .12g</div>');
  assert.equal(repeated.sodium, 120, 'equivalent units are consistent');
  const conflicting = facts('<div><b>Sodium</b> 120mg</div><div><b>Sodium</b> 240mg</div><div><b>Protein</b> 3g</div>');
  assert.equal(conflicting.sodium, undefined);
  assert.equal(conflicting.protein, 3);
  assert.equal(facts('<p>Serving Size: 1 oz</p><p>Serving Size: 2 oz</p><div><b>Sodium</b> 120mg</div>'), null);
  assert.equal(facts('<div><b>Sodium</b> 1,20mg</div><div><b>Protein</b> -3g</div>'), null);
});

test('Target missing ingredients cannot consume the next label heading or warning text', () => {
  const readLabel = inner => T.readProduct(createDocument(`<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo">
    <h4>Ingredients:</h4>${inner}</section>`), at(CHIPS_URL));
  assert.equal(readLabel('<h4>Allergens &amp; Warnings:</h4><div>Contains wheat, soy</div>').ingredients, '');
  assert.equal(readLabel('<h4>Nutrition Facts:</h4><div>Protein 3g</div>').ingredients, '');
  assert.equal(readLabel('<div>whole grain oats. Allergens & Warnings: May contain wheat.</div>').ingredients, 'whole grain oats.');
  assert.equal(readLabel('<div>whole grain oats, contains 2% or less of salt.</div>').ingredients, 'whole grain oats, contains 2% or less of salt.');
});

test('Target badges identify the visible title rather than an unrelated first product link', () => {
  const tile = inner => createDocument(`<div data-test="ListingPageProductListing">${inner}</div>`);
  const image = '<a href="/p/other/-/A-11111111">Image</a>';
  assert.deepEqual(T.searchTiles(tile(`${image}<a href="/p/oats/-/A-79364857"><h3>Oats</h3></a>`)).map(t => t.id), ['79364857']);
  assert.deepEqual(T.searchTiles(tile(`${image}<a href="/p/oats/-/A-79364857">Oats</a><h3>Unknown title</h3>`)), []);
  assert.deepEqual(T.searchTiles(tile(`${image}<a href="https://evil.example/p/oats/-/A-79364857"><h3>Foreign link</h3></a>`)), []);
  assert.deepEqual(T.searchTiles(tile('<a href="/p/oats/-/A-79364857"><h3> </h3></a>')), []);
});

test('Target refuses labels with a foreign or invalid declared canonical identity', () => {
  const label = '<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><h4>Ingredients:</h4><div>whole grain oats</div><div><b>Sodium</b> 120mg</div></section>';
  for (const href of ['https://evil.example/p/oats/-/A-16600402', '/s?searchTerm=oats', '', 'ftp://www.target.com/p/oats/-/A-16600402']) {
    const product = T.readProduct(createDocument(`<link rel="canonical" href="${href}">${label}`), at(CHIPS_URL));
    assert.equal(product.ingredients, '', href);
    assert.equal(product.nutrition, null, href);
  }
  for (const href of ['ftp://www.target.com/p/oats/-/A-16600402', 'https://user:password@www.target.com/p/oats/-/A-16600402']) {
    assert.equal(T.productId(href), '', href);
  }
  assert.equal(T.readProduct(createDocument(`<link rel="canonical" href="/p/chips/-/A-16600402">${label}`), at(CHIPS_URL)).ingredients, 'whole grain oats');
});

test('fresh Target public HTML keeps its grocery label collapsed until the visitor opens it', () => {
  const url = 'https://www.target.com/p/oats/-/A-79364857';
  const data = read('target-p-oats-collapsed-2026-10-04.html', url);
  assert.equal(data.id, '79364857');
  assert.equal(data.label, 'collapsed');
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
  assert.ok(food(data).ok);
  const w = runner('target-p-oats-collapsed-2026-10-04.html', url, {});
  assert.equal(w.host.dataset.airState, 'waiting');
  assert.equal(w.writes.length, 0);
  assert.equal(w.fetches.length, 0);
  w.shadow.handlers['notice-action']();
  assert.deepEqual(w.clicks, ['label']);
});

test('Target keeps collapsed accordions actionable despite auxiliary text and retained hidden labels', () => {
  const doc = createDocument(`<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo">
    <button aria-expanded="false">Label info</button><p>Show nutrition details</p>
    <div hidden><h4>Ingredients:</h4><div>old product sugar, palm oil</div><p>Serving Size: 20g</p><div><b>Sodium</b> 500mg</div></div>
    <div aria-hidden="true"><h4>Ingredients:</h4><div>other variant salt</div><div><b>Protein</b> 3g</div></div></section>`);
  const data = T.readProduct(doc, at(CHIPS_URL));
  assert.equal(data.label, 'collapsed');
  assert.equal(data.ingredients, '');
  assert.equal(data.nutrition, null);
  const label = doc.querySelector('[hidden]');
  delete label.attributes.hidden;
  T.labelToggle(doc).setAttribute('aria-expanded', 'true');
  const expanded = T.readProduct(doc, at(CHIPS_URL));
  assert.equal(expanded.label, 'open');
  assert.equal(expanded.ingredients, 'old product sugar, palm oil');
  assert.equal(expanded.nutrition.sodium, 500);
  assert.equal(expanded.nutrition.protein, undefined, 'another hidden variant remains excluded');
});

test('Target multi-column nutrition rows cannot mix serving and container quantities', () => {
  const facts = T.nutritionFacts(createDocument(`<section><p>Serving Size: 40g</p>
    <div><b>Sodium</b> 120mg 240mg</div><div><b>Total Sugars</b> 2g / 4g</div>
    <div><b>Protein</b> 3g 6%</div><div><b>Saturated Fat</b> .5g 3%</div></section>`));
  assert.equal(facts.sodium, undefined);
  assert.equal(facts.sugar, undefined);
  assert.equal(facts.protein, 3, 'a percent daily value is not a second quantity');
  assert.equal(facts.saturatedFat, 0.5);
  assert.equal(facts.servingGrams, 40);
});

test('Target ingredient extraction retains later paragraphs and loose text until the next label heading', () => {
  const readLabel = inner => T.readProduct(createDocument(`<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo">
    <div><h4>Ingredients:</h4>${inner}</div></section>`), at(CHIPS_URL)).ingredients;
  assert.equal(readLabel('water, oats<h4>Allergens:</h4><p>Contains wheat</p>'), 'water, oats');
  assert.equal(readLabel('<p>whole grain oats,</p><p>sugar, palm oil, salt.</p><h4>Allergens & Warnings</h4><p>Contains wheat</p>'), 'whole grain oats, sugar, palm oil, salt.');
  assert.equal(readLabel('<div><span>oats, </span><strong>sugar</strong><span>, salt.</span><h4>Nutrition Facts</h4><p>Protein 3g</p></div>'), 'oats, sugar, salt.');
  assert.equal(readLabel('<p>oats, <span>su</span><strong>gar</strong>, <span>palm</span> oil.</p>'), 'oats, sugar, palm oil.');
  assert.equal(readLabel('<div hidden>old product milk</div><p>oats, salt</p><strong>Warnings:</strong><p>Keep away from children</p>'), 'oats, salt');
});

test('Target separately exposes allergen and cross-contact warnings without nutrition or unrelated cautions', () => {
  const oats = read('target-p-oats.html', 'https://www.target.com/p/oats/-/A-79364857');
  assert.equal(oats.advisoryText, 'MAY CONTAIN WHEAT', 'the captured hot-bowl caution is excluded');
  const readWarnings = value => T.readProduct(createDocument(`<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo">
    <div><h4>Ingredients:</h4><p>organic whole grain oats.</p></div>
    <div><h4>Allergens & Warnings:</h4><p>${value}</p></div></section>`), at(CHIPS_URL));
  const data = readWarnings('May contain wheat, milk and soy. Made on shared equipment that processes peanuts. Keep refrigerated.');
  assert.equal(data.advisoryText, 'May contain wheat, milk and soy. Made on shared equipment that processes peanuts');
  assert.equal(data.ingredients, 'organic whole grain oats.');
  assert.equal(readWarnings('Contains milk. Keep refrigerated.').advisoryText, 'Contains milk');
  assert.equal(readWarnings('Contains: milk and soy.').advisoryText, 'Contains: milk and soy');
  assert.equal(readWarnings('Contains no milk. Does not contain peanuts.').advisoryText, '');
  assert.equal(readWarnings('Contains soy but does not contain milk.').advisoryText, 'Contains soy');
  assert.equal(readWarnings('Contains no peanuts, may contain milk.').advisoryText, 'may contain milk');
  assert.equal(readWarnings('Not made in a facility that processes milk. May contain no wheat.').advisoryText, '');
  const baseline = engine.score({ ingredients_text: data.ingredients }, {});
  const warned = engine.score({ ingredients_text: data.ingredients, advisory_text: data.advisoryText }, { allergens: ['wheat', 'milk', 'soy', 'peanut'] });
  assert.equal(warned.score, baseline.score, 'cross-contact does not change ingredient scoring');
  assert.ok(warned.flags.some(f => f.id === 'milk' && /may contain/i.test(f.ingredient)), JSON.stringify(warned.flags));
  assert.ok(warned.flags.some(f => f.id === 'peanut'), 'shared-equipment peanuts stay visible');
  const declared = engine.score({ ingredients_text: data.ingredients, advisory_text: readWarnings('Contains: milk and soy.').advisoryText }, { allergens: ['milk', 'soy'] });
  assert.equal(declared.score, baseline.score);
  assert.deepEqual(declared.flags.map(f => f.id).sort(), ['milk', 'soy']);
});

test('Target department provenance recognizes nonfood categories while preserving published crumbs', () => {
  const shampoo = read('target-p-shampoo.html', 'https://www.target.com/p/shampoo/-/A-75570641');
  assert.equal(shampoo.department, 'Beauty & Personal Care');
  assert.deepEqual(shampoo.crumbs.slice(0, 2), ['Beauty', 'Hair Care']);
  const cosmetic = T.readProduct(createDocument('<a data-test="@web/Breadcrumbs/BreadcrumbLink">Beauty</a><h1 data-test="product-title">Avocado Body Butter</h1>'), at(CHIPS_URL));
  const gate = ingestible.assess({ querySelector: () => null }, { title: cosmetic.title, text: cosmetic.department });
  assert.equal(gate.ok, false);
  assert.ok(gate.negatives.includes('nonFoodDept'));
  assert.equal(read('target-p-oats.html', 'https://www.target.com/p/oats/-/A-79364857').department, '');
});

test('Target cannot borrow a known serving basis for a different unconvertible panel', () => {
  const data = T.nutritionFacts(createDocument(`<section><p>Serving Size: 40g</p><p>Serving Size: 1 cup prepared</p>
    <div><b>Sodium</b> 120mg</div><div><b>Protein</b> 3g</div></section>`));
  assert.equal(data, null, 'the cup panel cannot be normalized using the other panel\'s 40 grams');
});

test('Target contradictory canonical identities and hidden search variants stay unscored', () => {
  const doc = createDocument(`<link rel="canonical" href="/p/chips/-/A-16600402"><link rel="canonical" href="/p/oats/-/A-79364857">
    <section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><h4>Ingredients:</h4><p>salt, sugar</p></section>`);
  assert.equal(T.readProduct(doc, at(CHIPS_URL)).ingredients, '');
  const search = createDocument(`<div hidden data-test="ListingPageProductListing"><a href="/p/oats/-/A-79364857"><h3>Hidden old variant</h3></a></div>
    <div data-test="ListingPageProductListing"><a href="/p/oats/-/A-79364857"><h3 aria-hidden="true">Hidden title</h3></a></div>
    <div data-test="ListingPageProductListing"><a href="/p/chips/-/A-16600402"><h3>Visible chips</h3></a></div>`);
  assert.deepEqual(T.searchTiles(search).map(t => t.id), ['16600402']);
  assert.equal(T.isSearchPage(at('https://evil.example/s?searchTerm=oats')), false);
});
