'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const timers = [], badges = [], fetches = [], writes = [], rendered = [];
  let changed, pasted;
  const host = { dataset: {}, isConnected: true, remove() { this.isConnected = false; } };
  const title = { innerText: 'Organic oats', insertBefore(b) { badges.push(b); } };
  const tile = { isConnected: true, getAttribute: () => 'B000000001',
    querySelector: s => s === '.air-badge' ? badges[0] : title };
  const context = vm.createContext({
    AbortController, URLSearchParams, console,
    location: { href: 'https://www.amazon.com/dp/B000000001', pathname: '/dp/B000000001', search: '' },
    setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, addEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    DOMParser: class { parseFromString() { return {}; } },
    document: {
      getElementById: () => host.isConnected ? host : null,
      querySelector: () => ({ parentNode: { insertBefore() { host.isConnected = true; } } }),
      querySelectorAll: s => s === '.air-badge' ? [...badges] : [],
      createElement: () => ({ style: {}, setAttribute() {}, remove() { badges.splice(badges.indexOf(this), 1); } }),
    },
    fetch: (url, options) => new Promise(resolve => fetches.push({ url, options, resolve })),
    chrome: {
      runtime: { getManifest: () => ({ version: '0.9.0' }), sendMessage() {} },
      storage: { local: { get(keys, cb) {
        // Defer boot; selected preference reads happen after the script initializes.
        if (Array.isArray(keys) && keys.includes('enabled')) return;
        cb({});
      }, set: v => writes.push(v), remove(k, cb) { cb?.(); } },
      onChanged: { addListener: fn => { changed = fn; } } },
    },
    AIR: {
      db: {},
      extract: { extract: () => ({ ok: true, title: 'Oats', text: 'oats' }) },
      engine: { score: (input, prefs) => ({ score: 90, verdict: 'Excellent', nova: 1, input, prefs }) },
      panel: { BAND_COLOR: () => ({ fg: '', bg: '', ring: '' }),
        renderFailure: () => 'failure', render: r => { rendered.push(r); return r; },
        mount: (h, r, report, paste) => { if (paste) pasted = paste; } },
    },
  });
  // Expose closures only in this VM; the shipped content script remains an isolated IIFE.
  const source = fs.readFileSync(require.resolve('../src/content/main.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.hooks = {state, queue, scoreTile, enqueue, suspend, resetListState, showFailure, scoreCurrentPage, onNavigated};})();'), context);
  const h = context.hooks;
  h.state.enabled = true; h.state.badges = true; h.state.foodOnly = false;
  h.state.autoScoreSearch = true;
  return { h, context, tile, host, timers, fetches, badges, writes, rendered,
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
