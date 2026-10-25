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
const { loadPage } = require('./pages/load.js');
const CHIPS_URL = 'https://www.target.com/p/chips/-/A-16600402';
function runner(file, url, stored = {}, adapter = T) {
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
        remove: (key, cb) => { delete data[key]; if (cb) cb(); },
      }, onChanged: { addListener() {} } },
    },
    AIR: {
      engine, storeAdapters: { target: adapter },
      db: { scoreCache, prefs, ingestible, speed: require('../src/engine/db/speed.js') },
      panel: {
        BAND_COLOR: () => ({ fg: '#000', bg: '#fff', ring: '#0f0' }),
        render: (r, meta) => `render:${r.score}:${meta.via}:report=${meta.report}`,
        renderNotFood: () => 'not-food anyway',
        renderNotice: meta => `notice notice-action ${meta.title}`,
        renderFailure: meta => `fail:${JSON.stringify(meta)}`,
        mount: (h, html, onReport, onPaste) => { h.html = html; h.onReport = onReport; h.onPaste = onPaste; return shadow(html); },
        openCard: h => { h.opened = true; },
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

test('retailer runner watches scored labels without repeated rendering or writes', () => {
  const w = runner('target-p-chips.html', CHIPS_URL);
  assert.equal(w.writes.length, 1);
  assert.ok(w.sandbox.module.exports.state.observer, 'late labels remain observed');
  w.pass(); w.pass();
  assert.equal(w.writes.length, 1, 'unchanged data must not repaint/cache');
});
test('opt-in grocery lifecycle restores an unchanged score panel discarded by hydration', () => {
  const w = runner('target-p-chips.html', CHIPS_URL, {}, { ...T, remountPanel: true });
  const first = w.host;
  first.remove();
  assert.equal(w.host, null);
  w.pass();
  assert.ok(w.host);
  assert.notEqual(w.host, first);
  assert.equal(w.host.dataset.airState, 'scored');
  assert.equal(w.writes.length, 2);
  w.pass();
  assert.equal(w.writes.length, 2, 'restored unchanged panel does not repeatedly render');
});
test('retailer runner replaces cached and toolbar scores after same-URL label hydration', () => {
  const w = runner('target-p-chips.html', CHIPS_URL);
  const first = w.messages.filter(m => typeof m.score === 'number').at(-1).score;
  const heading = [...w.page.querySelectorAll('h4')].find(el => /^Ingredients:/i.test(el.textContent));
  const children = [...heading.parentNode.children];
  children[children.indexOf(heading) + 1].textContent = 'potatoes, sugar, red 40, salt';
  w.pass();
  const second = w.messages.filter(m => typeof m.score === 'number').at(-1).score;
  assert.notEqual(second, first);
  assert.equal(w.writes.length, 2);
  assert.ok(w.messages.some(message => message.status === null));
});
test('retailer runner refuses an unparsed label instead of publishing a default score', () => {
  const w = runner('target-p-chips.html', CHIPS_URL);
  const heading = [...w.page.querySelectorAll('h4')].find(el => /^Ingredients:/i.test(el.textContent));
  const children = [...heading.parentNode.children];
  children[children.indexOf(heading) + 1].textContent = '%%%%';
  w.pass();
  assert.equal(w.host.dataset.airState, 'fail');
  assert.equal(w.messages.at(-1).status, 'fail');
  assert.equal(w.writes.length, 1, 'invalid hydrated data is never cached');
  assert.equal(w.data['s:target.com:16600402'], undefined, 'prior saved score is invalidated');
});

test('retailer warning-only hydration refreshes flags without changing the ingredient score', () => {
  const w = runner('target-p-oats.html', 'https://www.target.com/p/oats/-/A-79364857', { allergens: ['milk', 'peanut'] });
  const old = w.sandbox.module.exports.state.pageScore.score;
  const heading = [...w.page.querySelectorAll('h4')].find(el => /Allergens.*Warnings/i.test(el.textContent));
  const warningNode = [...heading.parentNode.childNodes].find(node => node.nodeType === 3);
  warningNode.textContent = 'May contain milk and peanuts.';
  warningNode.data = warningNode.textContent;
  w.pass();
  assert.equal(w.sandbox.module.exports.state.pageScore.score, old);
  assert.equal(w.writes.length, 2, 'warning hydration invalidates the settled view');
  const input = T.readProduct(w.page, { href: 'https://www.target.com/p/oats/-/A-79364857' });
  assert.match(input.advisoryText, /milk and peanuts/);
});
test('published retailer beauty department prevents scoring edible-sounding body butter', () => {
  const w = runner('target-p-shampoo.html', 'https://www.target.com/p/x/-/A-75570641');
  w.page.querySelector('h1[data-test="product-title"]').textContent = 'Body Butter';
  w.pass();
  assert.equal(w.host.dataset.airState, 'not-food');
  assert.equal(w.writes.length, 0);
});

test('"Open the score panel" opens a retailer product panel too, only when asked and only for a score', () => {
  const closed = runner('target-p-chips.html', CHIPS_URL);
  assert.equal(closed.host.dataset.airState, 'scored');
  assert.equal(closed.host.opened, undefined, 'off by default: the header only');
  const open = runner('target-p-chips.html', CHIPS_URL, { panelOpen: true });
  assert.equal(open.host.dataset.airState, 'scored');
  assert.equal(open.host.opened, true);
  const failed = runner('target-p-chips.html', CHIPS_URL, { panelOpen: true });
  const heading = [...failed.page.querySelectorAll('h4')].find(el => /^Ingredients:/i.test(el.textContent));
  const kids = [...heading.parentNode.children];
  kids[kids.indexOf(heading) + 1].textContent = '%%%%';
  failed.host.opened = undefined;
  failed.pass();
  assert.equal(failed.host.dataset.airState, 'fail');
  assert.equal(failed.host.opened, undefined, 'a failure card is never forced open');
});
