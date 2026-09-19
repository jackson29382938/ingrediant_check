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
        if (id === 'air-throttle-notice') return notices.find(n => n.id === 'air-throttle-notice' && n.isConnected) || null;
        return host.isConnected ? host : null;
      },
      querySelector: sel => {
        if (sel === 'body' || /(^|,)\s*body\s*$/.test(sel)) return body;
        return { parentNode: { insertBefore(next) { host = next; host.isConnected = true; } } };
      },
      querySelectorAll: s => s === '.air-badge' ? [...badges] : [],
      createElement: tag => {
        if (tag === 'span') {
          const el = { style: { cssText: '' }, textContent: '', className: '',
            setAttribute() {}, getAttribute: () => null, appendChild() {},
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
            appendChild() {},
            remove() { this.isConnected = false; },
          };
        }
        return { style: {}, setAttribute() {}, remove() { badges.splice(badges.indexOf(this), 1); } };
      },
    },
    fetch: (url, options) => new Promise(resolve => fetches.push({ url, options, resolve })),
    chrome: {
      runtime: { getManifest: () => ({ version: '0.9.0' }), sendMessage(m) { messages.push(m); } },
      i18n: { getMessage: () => '' },
      storage: { local: { get(keys, cb) {
        // Defer boot; selected preference reads happen after the script initializes.
        if (Array.isArray(keys) && keys.includes('enabled')) return;
        cb({});
      }, set: v => writes.push(v), remove(k, cb) { cb?.(); } },
      onChanged: { addListener: fn => { changed = fn; } } },
    },
    AIR: {
      db: { scoreCache: require('../src/engine/db/score-cache.js') },
      extract: {
        extract: () => ({ ok: true, title: 'Oats', text: 'oats' }),
        ocrReadyForHost: host => !/(?:^|\.)amazon\.(?:co\.jp|ae|sa)$/i.test(String(host || '').replace(/^www\./, '')),
      },
      engine: { score: (input, prefs) => ({ score: 90, verdict: 'Excellent', nova: 1, input, prefs }) },
      panel: { BAND_COLOR: () => ({ fg: '', bg: '', ring: '' }),
        renderFailure: m => { failMeta = m; return 'failure'; },
        render: r => { rendered.push(r); return r; },
        mount: (h, r, report, paste) => { if (paste) pasted = paste; } },
    },
  });
  // Expose closures only in this VM; the shipped content script remains an isolated IIFE.
  const source = fs.readFileSync(require.resolve('../src/content/main.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.hooks = {state, queue, scoreTile, enqueue, suspend, resetListState, showFailure, scoreCurrentPage, onNavigated, cacheScore, usableCache, TILE_FAIL_LIMIT, pauseForThrottle};})();'), context);
  const h = context.hooks;
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

test('manual scores are available to this tab but never stored as search scores', () => {
  const w = setup();
  w.h.cacheScore('B000000001', { score: 80 }, 'Food', 'manual-paste', 'Peanuts, salt');
  assert.equal(w.writes.length, 0);
  assert.equal(w.h.state.pageScore.source, 'manual-paste');
  w.h.cacheScore('B000000001', { score: 90 }, 'Food', 'page', 'Oats');
  const entry = Object.values(w.writes[0])[0];
  assert.equal(w.h.usableCache(entry, 'B000000001'), true);
  w.h.state.prefs.weights = { sugar: 2 };
  assert.equal(w.h.usableCache(entry, 'B000000001'), false);
});
