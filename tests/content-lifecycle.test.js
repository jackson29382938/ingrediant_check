'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const timers = [], badges = [], fetches = [], writes = [], rendered = [], messages = [], notices = [];
  let changed, pasted, failMeta;
  let host = { dataset: {}, isConnected: true, remove() { this.isConnected = false; } };
  const title = { innerText: 'Organic oats', insertBefore(b) { badges.push(b); } };
  const tile = { isConnected: true, getAttribute: () => 'B000000001',
    querySelector: s => s === '.air-badge' ? badges[0] : title };
  const bodyKids = [];
  const body = {
    tagName: 'BODY',
    firstChild: null,
    insertBefore(el) { el.isConnected = true; bodyKids.unshift(el); this.firstChild = el; notices.push(el); return el; },
    appendChild(el) { el.isConnected = true; bodyKids.push(el); notices.push(el); return el; },
  };
  const documentElement = { appendChild(el) { el.isConnected = true; notices.push(el); return el; } };
  const context = vm.createContext({
    AbortController, URLSearchParams, console,
    location: { hostname: 'www.amazon.com', href: 'https://www.amazon.com/dp/B000000001', pathname: '/dp/B000000001', search: '' },
    setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, addEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    DOMParser: class { parseFromString() { return {}; } },
    document: {
      documentElement,
      body,
      getElementById: id => {
        if (id === 'air-badge-style') return {};
        if (id === 'air-throttle-notice' || id === 'air-auto-notice') return notices.find(n => n.id === id && n.isConnected) || null;
        return host.isConnected ? host : null;
      },
      querySelector: sel => {
        if (sel === 'body' || /(^|,)\s*body\s*$/.test(sel)) return body;
        if (sel === '#search' || sel === '.s-main-slot') return null;   // a product page: no results container
        return { parentNode: { insertBefore(next) { host = next; host.isConnected = true; } } };
      },
      querySelectorAll: s => s === '.air-badge' ? [...badges] : [],
      createElement: tag => {
        if (tag === 'span') {
          const el = { style: { cssText: '' }, textContent: '', className: '',
            setAttribute() {}, removeAttribute() {}, getAttribute: () => null, appendChild() {},
            remove() { badges.splice(badges.indexOf(el), 1); } };
          return el;
        }
        if (tag === 'b') {
          return { style: { cssText: '' }, textContent: '', appendChild() {} };
        }
        if (tag === 'div') {
          return {
            dataset: {}, isConnected: false, id: '', style: { cssText: '' }, textContent: '',
            setAttribute(k, v) { if (k === 'id') this.id = v; },
            children: [],
            appendChild(child) { this.children.push(child); },
            remove() { this.isConnected = false; },
          };
        }
        return { tag, style: {}, setAttribute() {}, addEventListener(type, fn) { this.on = fn; },
          remove() { badges.splice(badges.indexOf(this), 1); } };
      },
    },
    fetch: (url, options) => new Promise(resolve => fetches.push({ url, options, resolve })),
    chrome: {
      // The worker answers a product lookup with no rows unless a test says otherwise.
      runtime: { getManifest: () => ({ version: '0.9.0' }),
        sendMessage(m, cb) { messages.push(m); if (m.type === 'productsLookup' && cb) cb({ rows: {} }); } },
      i18n: { getMessage: () => '' },
      storage: { local: { get(keys, cb) {
        // Defer boot; selected preference reads happen after the script initializes.
        if (Array.isArray(keys) && keys.includes('enabled')) return;
        cb({});
      }, set: v => writes.push(v), remove(k, cb) { cb?.(); } },
      onChanged: { addListener: fn => { changed = fn; } } },
    },
    AIR: {
      db: {
        scoreCache: require('../src/engine/db/score-cache.js'),
        prefs: require('../src/engine/db/prefs.js'),
        productCache: require('../src/engine/db/product-cache.js'),
      },
      extract: {
        extract: () => ({ ok: true, title: 'Oats', text: 'oats' }),
        ocrReadyForHost: host => !/(?:^|\.)amazon\.(?:co\.jp|ae|sa)$/i.test(String(host || '').replace(/^www\./, '')),
      },
      engine: { score: (input, prefs) => ({ score: 90, verdict: 'Excellent', nova: 1, input, prefs }) },
      panel: { BAND_COLOR: () => ({ fg: '', bg: '', ring: '' }),
        renderFailure: m => { failMeta = m; return 'failure'; },
        renderLoading: () => 'loading',
        render: r => { rendered.push(r); return r; },
        mount: (h, r, report, paste) => { if (paste) pasted = paste; } },
    },
  });
  // Load the split content modules in manifest order. Hooks live on AIR.page — no IIFE rewrite.
  for (const file of ['page.js', 'product.js', 'search.js', 'main.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/content/' + file), 'utf8'), context);
  }
  const h = context.AIR.page;
  h.state.enabled = true; h.state.badges = true; h.state.foodOnly = false;
  h.state.autoScoreSearch = true;
  return { h, context, tile, get host() { return host; }, timers, fetches, badges, writes, rendered,
    messages, notices, get failMeta() { return failMeta; },
    change: values => changed(values), paste: text => pasted(text) };
}

for (const setting of ['enabled', 'badges', 'autoScoreSearch']) {
  test(`${setting} off aborts in-flight tile requests and suppresses late replies`, async () => {
    const w = setup();
    const request = w.h.scoreTile(w.tile, 'B000000001', w.h.queue.epoch, w.context.location.href);
    assert.equal(w.fetches.length, 1);
    w.change({ [setting]: { newValue: false } });
    assert.equal(w.fetches[0].options.signal.aborted, true);
    // Even an already-buffered response that ignores abort cannot resurrect its badge.
    w.fetches[0].resolve({ ok: true, text: async () => '<html></html>' });
    await request;
    assert.equal(w.badges.length, 0);
    assert.equal(w.writes.length, 0);
  });
}
test('a scheduled tile job does not start after pause', async () => {
  const w = setup();
  w.h.enqueue(w.tile, 'B000000001');
  w.change({ enabled: { newValue: false } });
  await w.timers[0]();
  assert.equal(w.fetches.length, 0);
});
test('resetting the search invalidates replies even when scoring stays enabled', async () => {
  const w = setup();
  const request = w.h.scoreTile(w.tile, 'B000000001', w.h.queue.epoch, w.context.location.href);
  w.h.resetListState();
  w.fetches[0].resolve({ ok: true, text: async () => '' });
  await request;
  assert.equal(w.badges.length, 0);
  assert.equal(w.writes.length, 0);
});
test('manual ingredients survive a preference rescore and clear on navigation', () => {
  const w = setup();
  w.h.state.lastKey = 'B000000001';
  w.h.showFailure(w.host, { title: 'Test food' }, 'B000000001');
  w.paste('Milk, cane sugar');
  w.h.state.prefs = { weights: { sugar: 2 } };
  w.h.state.lastKey = null;
  w.host.dataset.airState = '';
  w.h.scoreCurrentPage();
  const result = w.rendered.at(-1);
  assert.equal(result.input.ingredients_text, 'Milk, cane sugar');
  assert.equal(result.prefs.weights.sugar, 2);
  w.context.location.href = 'https://www.amazon.com/dp/B000000002';
  w.h.onNavigated();
  assert.equal(w.h.state.manual, null);
});

for (const oldState of ['loading', 'fail', 'scored']) {
  test(`navigation removes the old ${oldState} panel and renders the new product`, () => {
    const w = setup();
    w.host.dataset.airState = oldState;
    const oldHost = w.host;
    const requestId = w.h.state.requestId;
    w.context.AIR.extract.extract = () => ({ ok: false, title: 'New product', asin: 'B000000002' });
    w.context.location.href = 'https://www.amazon.com/dp/B000000002';
    w.context.location.pathname = '/dp/B000000002';
    w.h.onNavigated();
    assert.equal(oldHost.isConnected, false);
    assert.ok(w.h.state.requestId > requestId);
    w.h.scoreCurrentPage();
    assert.notEqual(w.host, oldHost);
    assert.equal(w.host.dataset.airState, 'fail');
    w.paste('Milk, sugar');
    assert.equal(w.rendered.at(-1).input.name, 'New product');
  });
}
test('leaving a product page tears the panel down and does not rescore', () => {
  const w = setup();
  w.host.dataset.airState = 'scored';
  const oldHost = w.host;
  w.context.location.href = 'https://www.amazon.com/gp/cart/view.html';
  w.context.location.pathname = '/gp/cart/view.html';
  w.context.location.search = '';
  w.h.onNavigated();
  assert.equal(oldHost.isConnected, false);
  assert.equal(w.h.state.settled, 'not a product or results page');
});

test('tile fetch failures stay in seen and pause auto-score after N 403s', async () => {
  const w = setup();
  const limit = w.h.TILE_FAIL_LIMIT;
  assert.ok(limit >= 3 && limit <= 8, `unexpected TILE_FAIL_LIMIT ${limit}`);
  const href = w.context.location.href;
  for (let i = 0; i < limit; i++) {
    const asin = `B00000000${i}`;
    const title = { innerText: 'Oats', insertBefore(b) { w.badges.push(b); } };
    const tile = { isConnected: true, getAttribute: () => asin,
      querySelector: s => s === '.air-badge' ? w.badges.find(b => b._asin === asin) : title };
    w.h.queue.seen.add(asin);
    const request = w.h.scoreTile(tile, asin, w.h.queue.epoch, href);
    assert.equal(w.fetches.length, i + 1);
    w.fetches[i].resolve({ ok: false, status: 403, text: async () => '' });
    await request;
    assert.equal(w.h.queue.seen.has(asin), true, 'failed ASIN must stay in seen — no retry-storm');
  }
  assert.equal(w.h.queue.throttled, true);
  assert.ok(w.notices.some(n => n.id === 'air-throttle-notice' && n.isConnected));
  const extra = { isConnected: true, getAttribute: () => 'B000000099',
    querySelector: () => null };
  w.h.enqueue(extra, 'B000000099');
  assert.equal(w.h.queue.pending.length, 0);
  assert.equal(w.fetches.length, limit);
});

test('an aborted tile fetch does not count toward the throttle pause', async () => {
  const w = setup();
  const request = w.h.scoreTile(w.tile, 'B000000001', w.h.queue.epoch, w.context.location.href);
  w.change({ enabled: { newValue: false } });
  w.fetches[0].resolve({ ok: false, status: 403, text: async () => '' });
  await request;
  assert.equal(w.h.queue.failStreak, 0);
  assert.equal(w.h.queue.throttled, false);
});

test('navigation clears the throttle pause', async () => {
  const w = setup();
  w.h.queue.throttled = true;
  w.h.queue.failStreak = 5;
  w.h.pauseForThrottle();
  w.context.location.href = 'https://www.amazon.com/s?k=oats';
  w.context.location.pathname = '/s';
  w.context.location.search = '?k=oats';
  w.h.onNavigated();
  assert.equal(w.h.queue.throttled, false);
  assert.equal(w.h.queue.failStreak, 0);
});

test('JP/AR hosts skip English OCR and surface a locale decline', () => {
  const w = setup();
  w.context.location.hostname = 'www.amazon.co.jp';
  w.h.state.ocrLabels = true;
  w.h.state.lastKey = 'B000000001';
  w.h.showFailure(w.host, { title: 'お茶' }, 'B000000001');
  assert.equal(w.messages.filter(m => m.type === 'ocrLabels').length, 0);
  assert.equal(w.host.dataset.airState, 'fail');
  assert.equal(w.failMeta.localeDeclined, true);
});

test('manual paste declines low-coverage text instead of scoring it', () => {
  const w = setup();
  w.context.AIR.engine.score = () => ({
    score: 88, verdict: 'Excellent', nova: 4, parsed: 6, coverage: 0.1, bad: [], good: [],
  });
  w.host.dataset.airState = '';
  w.h.state.lastKey = 'B000000001';
  w.context.AIR.product.renderManual(w.host, { title: 'Polish snack', asin: 'B000000001' }, 'B000000001',
    'składniki: cukier, mąka, olej');
  assert.equal(w.host.dataset.airState, 'fail');
  assert.equal(w.failMeta.lowCoverage, true);
  assert.equal(w.rendered.length, 0);
  assert.equal(w.writes.length, 0);
});

test('manual scores are available to this tab but never stored as search scores', () => {
  const w = setup();
  w.h.cacheScore('B000000001', { score: 80 }, 'Food', 'manual-paste');
  assert.equal(w.writes.length, 0);
  assert.equal(w.h.state.pageScore.source, 'manual-paste');
  w.h.cacheScore('B000000001', { score: 90 }, 'Food', 'page');
  const entry = Object.values(w.writes[0])[0];
  assert.equal(w.h.usableCache(entry, 'B000000001'), true);
  w.h.state.prefs.weights = { sugar: 2 };
  assert.equal(w.h.usableCache(entry, 'B000000001'), false);
});

// ---------------------------------------------------------------- product cache (docs/CACHE.md)
const PC = require('../src/engine/db/product-cache.js');
// These tests are about sharing, so shared product readings (an opt-in, prefs.js) are on unless a
// test says otherwise.
function cacheSetup({ local = {}, shared = {}, sharing = true } = {}) {
  const w = setup();
  const c = w.context;
  c.AIR.db.productCache = PC;
  w.h.state.cacheOptions = sharing ? { sharedProducts: true } : {};
  w.lookups = [];
  c.chrome.storage.local.get = (keys, cb) => cb(Object.fromEntries([].concat(keys).filter(k => k in local).map(k => [k, local[k]])));
  c.chrome.storage.local.set = v => { w.writes.push(v); return Promise.resolve(); };
  c.chrome.runtime.sendMessage = (m, cb) => {
    w.messages.push(m);
    if (m.type === 'productsLookup') { w.lookups.push(m); cb({ rows: shared }); }
  };
  c.DOMParser = class { parseFromString() { return { querySelector: () => ({}) }; } };
  return w;
}
const cachedRow = (asin, over = {}) => PC.fromScan({ store: 'amazon.com', asin, input: { name: 'Oats', ingredients_text: 'oats' },
  via: 'nic-ingredients-content', t: Date.now() - 1000, ...over });
const tileFor = (w, asin) => {
  const own = [];
  const title = { innerText: 'Oats', insertBefore(b) { own.push(b); w.badges.push(b); } };
  return { isConnected: true, getAttribute: () => asin, querySelector: s => (s === '.air-badge' ? own[0] : title) };
};

test('a tile answered by product data on this computer needs no lookup and no Amazon fetch', () => {
  const row = cachedRow('B000000001');
  const w = cacheSetup({ local: { [PC.localKey('amazon.com', 'B000000001')]: { ...row, t: Date.parse(row.scanned_at) } } });
  const missed = [];
  w.context.AIR.search.resolveTiles([{ tile: w.tile, asin: 'B000000001' }], it => missed.push(it));
  assert.equal(w.badges.length, 1);
  assert.equal(w.lookups.length, 0);
  assert.equal(missed.length, 0);
  assert.equal(w.fetches.length, 0);
  const score = w.writes.map(x => x['s:amazon.com:B000000001']).find(Boolean);
  assert.equal(score.t, Date.parse(row.scanned_at), 'the score expires with the reading it came from');
});
test('local misses go to the shared cache in one lookup, count a pull, and are kept locally', () => {
  const w = cacheSetup({ shared: { B000000002: cachedRow('B000000002') } });
  const tiles = ['B000000002', 'B000000003'].map(a => ({ tile: tileFor(w, a), asin: a }));
  const missed = [];
  w.context.AIR.search.resolveTiles(tiles, it => missed.push(it.asin));
  assert.equal(w.lookups.length, 1);
  assert.deepEqual([...w.lookups[0].asins], ['B000000002', 'B000000003']);
  assert.deepEqual(missed, ['B000000003']);
  assert.ok(w.writes.some(x => x['p:amazon.com:B000000002']), 'the shared row is kept on this computer');
  const queued = w.messages.filter(m => m.type === 'productsQueue');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].pulls[0].key, 'amazon.com:B000000002');
  assert.equal(queued[0].upserts, undefined, 'a row that came from the shared cache is not uploaded back');
});
test('with the food gate on, a not-food row paints nothing and fetches nothing', () => {
  const w = cacheSetup({ shared: { B000000004: cachedRow('B000000004', { status: 'not-food', input: { name: 'Shampoo' }, food: false }) } });
  w.h.state.foodOnly = true;
  const missed = [];
  w.context.AIR.search.resolveTiles([{ tile: tileFor(w, 'B000000004'), asin: 'B000000004' }], it => missed.push(it));
  assert.equal(w.badges.length, 0);
  assert.equal(missed.length, 0);
});
test('a live tile read is kept locally and queued for the shared cache', async () => {
  const w = cacheSetup();
  const run = w.h.scoreTile(w.tile, 'B000000001', w.h.queue.epoch, w.context.location.href);
  w.fetches[0].resolve({ ok: true, text: async () => '<html></html>' });
  await run;
  const kept = w.writes.map(x => x['p:amazon.com:B000000001']).find(Boolean);
  assert.equal(kept.data.text, 'oats');
  const up = w.messages.find(m => m.type === 'productsQueue' && m.upserts);
  assert.equal(up.upserts[0].key, 'amazon.com:B000000001');
});

test('without the opt-in, tiles and product pages never ask for or upload shared readings', async () => {
  const w = cacheSetup({ shared: { B000000002: cachedRow('B000000002') }, sharing: false });
  const missed = [];
  w.context.AIR.search.resolveTiles([{ tile: tileFor(w, 'B000000002'), asin: 'B000000002' }], it => missed.push(it.asin));
  assert.equal(w.lookups.length, 0, 'no shared lookup');
  assert.deepEqual(missed, ['B000000002'], 'the tile is read from Amazon instead');
  const run = w.h.scoreTile(w.tile, 'B000000001', w.h.queue.epoch, w.context.location.href);
  w.fetches[0].resolve({ ok: true, text: async () => '<html></html>' });
  await run;
  assert.ok(w.writes.some(x => x['p:amazon.com:B000000001']), 'still kept on this computer');
  assert.equal(w.messages.filter(m => m.type === 'productsQueue').length, 0, 'nothing uploaded');
  const page = cacheSetup({ shared: { B000000001: cachedRow('B000000001') }, sharing: false });
  page.context.AIR.extract.extract = () => ({ ok: false, title: 'Oats', asin: 'B000000001' });
  page.h.scoreCurrentPage();
  assert.equal(page.lookups.length, 0, 'an unreadable product page does not ask either');
});

test('an unreadable product page is answered by a saved reading before OCR or the paste box', () => {
  const row = cachedRow('B000000001', { via: 'label-ocr', input: { name: 'Kefir', ingredients_text: 'cultured milk, cane sugar' } });
  const w = cacheSetup({ local: { [PC.localKey('amazon.com', 'B000000001')]: { ...row, t: Date.parse(row.scanned_at) } } });
  w.h.state.ocrLabels = true;
  w.context.AIR.extract.extract = () => ({ ok: false, title: 'Kefir', asin: 'B000000001' });
  w.h.scoreCurrentPage();
  assert.equal(w.host.dataset.airState, 'scored');
  assert.equal(w.rendered.at(-1).input.ingredients_text, 'cultured milk, cane sugar');
  assert.equal(w.messages.filter(m => m.type === 'productsLookup').length, 0, 'answered on this computer: no lookup');
  assert.equal(w.rendered.length, 1, 'shown at once, before any re-read');
});

// Opening the product page always reads it again: the saved reading shows first, then the label
// photo (or the barcode lookup) is read, and replaces the saved one only when it differs.
function refreshSetup(ocrText) {
  const row = cachedRow('B000000001', { via: 'label-ocr', input: { name: 'Kefir', ingredients_text: 'cultured milk, cane sugar' } });
  const w = cacheSetup({ local: { [PC.localKey('amazon.com', 'B000000001')]: { ...row, t: Date.parse(row.scanned_at) } } });
  w.h.state.ocrLabels = true;
  w.context.AIR.extract.extract = () => ({ ok: false, title: 'Kefir', asin: 'B000000001' });
  w.context.AIR.extract.looksLikeIngredients = () => true;
  w.context.AIR.db.ocrText = { imageCandidates: () => ['https://m.media-amazon.com/images/I/label._SL1600_.jpg'],
    bestBlock: results => (results && results[0] ? { text: results[0] } : null) };
  const send = w.context.chrome.runtime.sendMessage;
  w.context.chrome.runtime.sendMessage = (m, cb) => {
    if (m.type === 'ocrLabels') { w.messages.push(m); cb(ocrText == null ? { ok: false } : { ok: true, results: [ocrText] }); return; }
    send(m, cb);
  };
  w.h.scoreCurrentPage();
  return w;
}
test('a saved reading shows first, then the label photo is read again and a different reading replaces it', () => {
  const w = refreshSetup('cultured lowfat milk, strawberries, cane sugar, pectin');
  assert.equal(w.messages.filter(m => m.type === 'ocrLabels').length, 1, 'the label photo is read again');
  assert.equal(w.rendered.length, 2);
  assert.equal(w.rendered[0].input.ingredients_text, 'cultured milk, cane sugar', 'saved reading first');
  assert.equal(w.rendered[1].input.ingredients_text, 'cultured lowfat milk, strawberries, cane sugar, pectin', 'then the fresh one');
  assert.equal(w.host.dataset.airState, 'scored');
  const kept = w.writes.map(x => x['p:amazon.com:B000000001']).filter(Boolean).at(-1);
  assert.equal(kept.data.text, 'cultured lowfat milk, strawberries, cane sugar, pectin', 'the fresh reading is saved');
});
test('the same reading, or a re-read that fails, leaves the saved score in place', () => {
  const same = refreshSetup('Cultured milk,  cane sugar');
  assert.equal(same.messages.filter(m => m.type === 'ocrLabels').length, 1);
  assert.equal(same.rendered.length, 1, 'nothing changed: not re-rendered');
  const failed = refreshSetup(null);
  assert.equal(failed.rendered.length, 1);
  assert.equal(failed.host.dataset.airState, 'scored', 'no failure card over a good saved score');
});

test('speed: "Most up to date" reads pages itself instead of asking the shared database', () => {
  const w = cacheSetup({ shared: { B000000002: cachedRow('B000000002') } });
  w.context.AIR.db.speed = require('../src/engine/db/speed.js');
  w.h.state.speedMode = 'freshest';
  const missed = [];
  w.context.AIR.search.resolveTiles([{ tile: tileFor(w, 'B000000002'), asin: 'B000000002' }], it => missed.push(it.asin));
  assert.equal(w.lookups.length, 0, 'no shared-database lookup');
  assert.deepEqual(missed, ['B000000002'], 'goes to the product page instead');
  w.h.state.speedMode = 'balanced';
  w.context.AIR.search.resolveTiles([{ tile: tileFor(w, 'B000000002'), asin: 'B000000002' }], it => missed.push(it.asin));
  assert.equal(w.lookups.length, 1, 'Balanced asks the shared database as before');
});
test('speed: "Fresher" re-reads a product saved 10 days ago; Balanced still uses it', () => {
  const tenDays = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const row = cachedRow('B000000001', { t: tenDays });
  const local = { [PC.localKey('amazon.com', 'B000000001')]: { ...row, t: tenDays } };
  const fresh = cacheSetup({ local });
  fresh.context.AIR.db.speed = require('../src/engine/db/speed.js');
  fresh.h.state.speedMode = 'fresh';
  const missed = [];
  fresh.context.AIR.search.resolveTiles([{ tile: fresh.tile, asin: 'B000000001' }], it => missed.push(it.asin));
  assert.equal(fresh.badges.length, 0);
  assert.deepEqual(missed, ['B000000001']);
  const balanced = cacheSetup({ local });
  balanced.context.AIR.db.speed = require('../src/engine/db/speed.js');
  balanced.context.AIR.search.resolveTiles([{ tile: balanced.tile, asin: 'B000000001' }], () => {});
  assert.equal(balanced.badges.length, 1);
});
test('a shared reading answers an unreadable page and counts a pull; a miss falls through to OCR', () => {
  const w = cacheSetup({ shared: { B000000001: cachedRow('B000000001', { via: 'label-ocr' }) } });
  w.context.AIR.extract.extract = () => ({ ok: false, title: 'Oats', asin: 'B000000001' });
  w.h.scoreCurrentPage();
  assert.equal(w.host.dataset.airState, 'scored');
  assert.ok(w.writes.some(x => x['p:amazon.com:B000000001']));
  assert.equal(w.messages.find(m => m.type === 'productsQueue').pulls[0].key, 'amazon.com:B000000001');
  const miss = cacheSetup();
  miss.h.state.ocrLabels = true;
  miss.context.AIR.db.ocrText = { imageCandidates: () => ['https://m.media-amazon.com/images/I/label._SL1600_.jpg'] };
  miss.context.AIR.extract.extract = () => ({ ok: false, title: 'Oats', asin: 'B000000001' });
  miss.h.scoreCurrentPage();
  assert.equal(miss.lookups.length, 1);
  assert.ok(miss.messages.some(m => m.type === 'ocrLabels'), 'nothing saved anywhere: read the label');
});

test('tiles answered without a fetch do not use up the auto-score budget', () => {
  const w = cacheSetup();
  w.h.state.foodOnly = false;
  const S = w.context.AIR.search;
  // Fifty tiles already painted from the cache on this page.
  for (let i = 0; i < 50; i++) S.queue.seen.add(`B0CACHED${String(i).padStart(2, '0')}`);
  S.enqueue(tileFor(w, 'B000000100'), 'B000000100');
  assert.equal(S.queue.fetches, 1, 'a real fetch is still allowed after fifty cache hits');
  for (let i = 1; i < S.MAX_AUTO_FETCHES + 5; i++) S.enqueue(tileFor(w, `B0000${String(i).padStart(5, '0')}`), `B0000${String(i).padStart(5, '0')}`);
  assert.equal(S.queue.fetches, S.MAX_AUTO_FETCHES, 'fetches stop at the cap');
  w.h.state.hoverScore = true;
  S.enqueue(tileFor(w, 'B0HOVER001'), 'B0HOVER001', { front: true });
  assert.equal(S.queue.fetches, S.MAX_AUTO_FETCHES, 'hover is never capped or counted');
  assert.ok(S.queue.seen.has('B0HOVER001'));
  S.cancelTileWork();
  assert.equal(S.queue.fetches, 0, 'a new search starts a new budget');
});

test('carousel cards with no title are never armed for auto-score', () => {
  const w = setup();
  const c = w.context;
  Object.assign(c.location, { pathname: '/s', search: '?k=kefir', href: 'https://www.amazon.com/s?k=kefir' });
  const observed = [];
  c.IntersectionObserver = class { observe(t) { observed.push(t.getAttribute('data-asin')); } disconnect() {} unobserve() {} };
  const attrs = () => { const a = {}; return { getAttribute: k => (k === 'data-asin' ? a.asin : a[k] ?? null), setAttribute: (k, v) => { a[k] = v; }, a }; };
  const titled = attrs(); titled.a.asin = 'B000000010'; titled.querySelector = s => (/h2/.test(s) ? {} : null);
  const card = attrs(); card.a.asin = 'B000000011'; card.querySelector = () => null;
  c.document.querySelectorAll = sel => (/data-air-auto/.test(sel) ? [titled, card] : []);
  c.AIR.search.armAutoScorePass();
  assert.deepEqual(observed, ['B000000010']);
  assert.equal(card.getAttribute('data-air-auto'), null, 'left unmarked, so a card that renders a title later is armed then');
});

test('the first automatic fetch explains itself once, and its button turns auto-rating off', () => {
  const w = setup();
  w.h.enqueue(w.tile, 'B000000001');
  const notice = w.notices.find(n => n.id === 'air-auto-notice');
  assert.ok(notice && notice.isConnected, 'no notice before the first automatic Amazon request');
  // Informational only: the request is scheduled whether or not anyone answers the notice.
  assert.equal(w.h.queue.fetches, 1);
  assert.ok(w.timers.length > 0, 'scoring waited on the notice');
  w.h.enqueue({ ...w.tile, getAttribute: () => 'B000000002' }, 'B000000002');
  assert.equal(w.notices.filter(n => n.id === 'air-auto-notice').length, 1, 'shown once per page, not per tile');
  const [off, ok] = notice.children.filter(c => c.tag === 'button');
  assert.ok(off && ok, 'the notice needs a turn-off button and an OK button');
  off.on();
  assert.equal(notice.isConnected, false);
  assert.deepEqual(JSON.parse(JSON.stringify(w.writes.at(-1))), { autoScoreSearch: false, autoScoreNoticeSeen: true });
});

test('OK dismisses the notice for good without touching the setting', () => {
  const w = setup();
  w.h.enqueue(w.tile, 'B000000001');
  const notice = w.notices.find(n => n.id === 'air-auto-notice');
  notice.children.filter(c => c.tag === 'button')[1].on();
  assert.deepEqual(JSON.parse(JSON.stringify(w.writes.at(-1))), { autoScoreNoticeSeen: true });
});

test('no notice once seen, for hover scoring, or while paused', () => {
  const seen = setup();
  seen.context.chrome.storage.local.get = (keys, cb) => cb({ autoScoreNoticeSeen: true });
  seen.h.enqueue(seen.tile, 'B000000001');
  assert.equal(seen.h.queue.fetches, 1);
  assert.equal(seen.notices.filter(n => n.id === 'air-auto-notice').length, 0);

  const hover = setup();
  hover.h.state.hoverScore = true;
  hover.h.enqueue(hover.tile, 'B000000001', { front: true });
  assert.equal(hover.notices.filter(n => n.id === 'air-auto-notice').length, 0,
    'hover asks for one product the reader pointed at; the popup already says so');

  const paused = setup();
  paused.h.state.enabled = false;
  paused.h.enqueue(paused.tile, 'B000000001');
  assert.equal(paused.notices.filter(n => n.id === 'air-auto-notice').length, 0);
});

test('a score from a saved reading survives the next Amazon page update', () => {
  const row = cachedRow('B000000001', { via: 'label-ocr', input: { name: 'Kefir', ingredients_text: 'lowfat milk, cane sugar' } });
  const w = cacheSetup({ local: { [PC.localKey('amazon.com', 'B000000001')]: { ...row, t: Date.parse(row.scanned_at) } } });
  const removed = [];
  w.context.chrome.storage.local.remove = (k, cb) => { removed.push(k); cb?.(); };
  w.context.AIR.extract.extract = () => ({ ok: false, title: 'Kefir', asin: 'B000000001' });
  // Amazon's card carries the product NAME where the list should be (the Lifeway case): readable
  // text, not an ingredient list. The old code compared it with the saved reading and re-read.
  const realQuery = w.context.document.querySelector;
  w.context.document.querySelector = sel => Object.assign(realQuery(sel) || {},
    { innerText: 'Lifeway Lowfat Kefir, Strawberry, 32 Ounce, 11g Protein' });
  w.h.scoreCurrentPage();
  assert.equal(w.host.dataset.airState, 'scored');
  const renders = w.rendered.length;
  const removals = removed.length;
  for (let i = 0; i < 3; i++) w.h.scoreCurrentPage();   // ad refresh, carousel, lazy image
  assert.equal(w.host.dataset.airState, 'scored', 'not replaced by the failure card');
  assert.equal(w.rendered.length, renders, 'not re-rendered either');
  assert.equal(removed.length, removals, 'the saved score is not deleted by a later update');
});

// ---------------------------------------------------------------- one request queue (search.js, sort.js)
// The badges and the sorted list share one queue for Amazon product pages: one request per product,
// the same three slots, one throttle pause and one per-results-page budget.
function sortSetup() {
  const w = cacheSetup({ sharing: false });
  w.context.location.pathname = '/s';
  w.context.location.search = '?k=oats';
  w.context.location.href = 'https://www.amazon.com/s?k=oats';
  vm.runInContext(fs.readFileSync(require.resolve('../src/content/sort.js'), 'utf8'), w.context);
  w.S = w.context.AIR.search;
  w.sort = w.context.AIR.sort;
  // Run the queue's waits (the sandbox collects timers instead of running them).
  // A collected timer runs at once, so each run also lets the 250 ms gap between starts pass.
  const tick = () => { const f = w.timers.shift(); if (f) { w.S.queue.lastStart = 0; f(); } };
  w.flush = async () => { for (let i = 0; i < 50; i++) { await new Promise(r => setImmediate(r)); tick(); } };
  // Keep running timers, answering new requests with `reply`, until `promise` settles.
  w.until = async (promise, reply = ok) => {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 400 && !done; i++) {
      await new Promise(r => setImmediate(r));
      for (const f of w.fetches) if (!f.answered) { f.answered = true; f.resolve(reply); }
      tick();
    }
    assert.ok(done, 'settled');
    return promise;
  };
  return w;
}
const ok = { ok: true, text: async () => '<html></html>' };

test('a product the badges are already requesting is not requested again for the sorted list', async () => {
  const w = sortSetup();
  const tile = tileFor(w, 'B000000001');
  const badge = w.S.scoreTile(tile, 'B000000001', w.S.queue.epoch, w.context.location.href);
  assert.equal(w.fetches.length, 1);
  const rating = w.sort.rateByProductPage(['B000000001'], 0, () => {}, () => 60);
  await w.flush();
  assert.equal(w.fetches.length, 1, 'joined the request in flight');
  w.fetches[0].resolve(ok);
  await badge;
  const { scores } = await rating;
  assert.equal(scores.get('B000000001').score, 90);
  assert.equal(w.writes.filter(x => x['p:amazon.com:B000000001']).length, 1, 'recorded once');
  // And a later badge for the same product reuses the finished reading.
  const again = tileFor(w, 'B000000001');
  await w.S.scoreTile(again, 'B000000001', w.S.queue.epoch, w.context.location.href);
  assert.equal(w.fetches.length, 1);
});

test('the sorted list and the badges share three request slots', async () => {
  const w = sortSetup();
  for (const a of ['B000000001', 'B000000002', 'B000000003']) w.S.scoreTile(tileFor(w, a), a, w.S.queue.epoch, w.context.location.href);
  w.S.queue.active = 3;   // what pump() holds while those three run
  const rating = w.sort.rateByProductPage(['B000000004'], 0, () => {}, () => 60);
  await w.flush();
  assert.equal(w.fetches.length, 3, 'no fourth request while three are in flight');
  w.S.releaseSlot();
  await w.flush();
  assert.equal(w.fetches.length, 4);
  w.fetches.forEach(f => f.resolve(ok));
  await rating;
});

test('Amazon refusing the badges pauses the sorted list too, and the reverse', async () => {
  const w = sortSetup();
  w.S.pauseForThrottle();
  const { stopped } = await w.sort.rateByProductPage(['B000000001', 'B000000002'], 0, () => {}, () => 60);
  assert.equal(w.fetches.length, 0);
  assert.match(stopped, /stopped answering/);

  const r = sortSetup();
  const asins = Array.from({ length: r.S.TILE_FAIL_LIMIT + 2 }, (_, i) => `B00000001${i}`);
  const result = await r.until(r.sort.rateByProductPage(asins, 0, () => {}, () => 60),
    { ok: false, status: 503, text: async () => '' });
  assert.equal(r.S.queue.throttled, true, "the sorted list's refusals pause the badges");
  assert.equal(r.fetches.length, r.S.TILE_FAIL_LIMIT, 'no request after the pause');
  assert.match(result.stopped, /stopped answering/);
});

test("the sorted list's product pages count toward the per-results-page budget", async () => {
  const w = sortSetup();
  const cap = w.S.MAX_AUTO_FETCHES;
  w.S.queue.fetches = cap - 1;   // the badges already spent all but one on this page
  const { stopped } = await w.until(w.sort.rateByProductPage(['B000000001', 'B000000002', 'B000000003'], 0, () => {}, () => cap));
  assert.equal(w.fetches.length, 1);
  assert.equal(w.S.queue.fetches, cap);
  assert.match(stopped, new RegExp(`at ${cap} product pages`));
});

test('one product page view asks Open Food Facts once, however often Amazon updates the page', () => {
  const w = cacheSetup({ sharing: false });
  w.h.state.cacheOptions.useOpenFoodFacts = true;
  w.context.AIR.extract.extract = () => ({ ok: false, title: 'Kefir', asin: 'B000000001', upc: '0012345678905' });
  const barcode = () => w.messages.filter(m => m.type === 'lookupBarcode').length;
  w.h.scoreCurrentPage();
  assert.equal(barcode(), 1);
  assert.equal(w.host.dataset.airState, 'loading');
  for (let i = 0; i < 5; i++) w.h.scoreCurrentPage();   // Amazon's page updates while the answer is coming
  assert.equal(barcode(), 1, 'no second lookup for the same barcode');
});

test('changing the speed setting reworks the badges already on the page', () => {
  const w = setup();
  w.context.AIR.db.speed = require('../src/engine/db/speed.js');
  w.h.queue.fetches = 7;
  w.h.queue.seen.add('B000000001');
  w.change({ speedMode: { oldValue: 'balanced', newValue: 'fastest' } });
  assert.equal(w.h.state.speedMode, 'fastest');
  assert.equal(w.h.queue.seen.size, 0, 'tiles are resolved again under the new ages');
  assert.equal(w.h.queue.fetches, 0, 'and the new budget starts from zero');
});

test('a failed product-page request is not held: the next caller asks again', async () => {
  const w = sortSetup();
  const first = w.S.readProductPage('B000000001', 'search-tile');
  w.fetches[0].resolve({ ok: false, status: 500, text: async () => '' });
  await assert.rejects(first);
  assert.equal(w.S.knownRead('B000000001'), null);
  const second = w.S.readProductPage('B000000001', 'search-tile');
  assert.equal(w.fetches.length, 2);
  w.fetches[1].resolve(ok);
  assert.equal((await second).outcome, 'scored');
});

test('a list read from the label photo keeps the nutrition numbers the page published', () => {
  const w = cacheSetup({ sharing: false });
  w.h.state.ocrLabels = true;
  w.context.AIR.extract.extract = () => ({ ok: false, title: 'Soup', asin: 'B000000001', nutrition: { sodium: 900, servingGrams: 245 } });
  w.context.AIR.extract.looksLikeIngredients = () => true;
  w.context.AIR.db.ocrText = { imageCandidates: () => ['https://m.media-amazon.com/images/I/label._SL1600_.jpg'],
    bestBlock: results => (results && results[0] ? { text: results[0] } : null) };
  const send = w.context.chrome.runtime.sendMessage;
  w.context.chrome.runtime.sendMessage = (m, cb) => {
    if (m.type === 'ocrLabels') { cb({ ok: true, results: ['water, chicken, salt'] }); return; }
    send(m, cb);
  };
  w.h.scoreCurrentPage();
  const input = w.rendered.at(-1).input;
  assert.equal(input.ingredients_text, 'water, chicken, salt');
  assert.equal(input.nutrition.sodium, 900);
  const kept = w.writes.map(x => x['p:amazon.com:B000000001']).filter(Boolean).at(-1);
  assert.equal(kept.data.nutrition.sodium, 900, 'the saved reading keeps them too');
});
