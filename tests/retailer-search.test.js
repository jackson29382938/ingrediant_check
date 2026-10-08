'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const prefs = require('../src/engine/db/prefs.js');
const scoreCache = require('../src/engine/db/score-cache.js');

function element(tag = 'div') {
  const node = { tagName: tag.toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [], isConnected: true,
    className: '', textContent: '', innerHTML: '', parentNode: null,
    setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = String(value); },
    getAttribute(key) { return key === 'class' ? this.className : this.attrs[key] ?? null; },
    removeAttribute(key) { delete this.attrs[key]; },
    appendChild(child) { return this.insertBefore(child, null); },
    append(...children) { children.forEach(child => this.appendChild(child)); },
    insertBefore(child, before) { child.parentNode = this; child.isConnected = this.isConnected;
      const index = before ? this.children.indexOf(before) : -1;
      if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child); return child; },
    remove() { this.isConnected = false; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },
    attachShadow() { this.shadowRoot = element('shadow'); return this.shadowRoot; },
    addEventListener() {},
    matches(selector) { return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
      if (/^[a-z0-9]+$/i.test(part)) return this.tagName === part.toUpperCase();
      const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return !!attribute && this.getAttribute(attribute[1]) != null && (attribute[2] == null || this.getAttribute(attribute[1]) === attribute[2]);
    }); },
    closest(selector) { for (let current = this; current; current = current.parentNode) if (current.matches(selector)) return current; return null; },
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  Object.defineProperties(node, {
    firstChild: { get: () => node.children[0] || null },
    nextSibling: { get: () => { const siblings = node.parentNode?.children || []; return siblings[siblings.indexOf(node) + 1] || null; } },
    nextElementSibling: { get: () => node.nextSibling },
    parentElement: { get: () => node.parentNode },
    innerText: { get: () => node.textContent },
    href: { get: () => node.attrs.href || '', set: value => { node.attrs.href = value; } },
  });
  return node;
}

function runner({ ids = ['79364857'], stored = {}, query = 'oats' } = {}) {
  const body = element('body'), nodes = [], requests = [], writes = [], timers = [], intervals = [], observers = [];
  const location = { origin: 'https://www.target.com', href: `https://www.target.com/s?searchTerm=${query}`, hostname: 'www.target.com', pathname: '/s', search: `?searchTerm=${query}` };
  let now = Date.now(), settingsChanged;
  const settings = { autoScoreSearch: true, foodOnly: true, ...stored };
  const productId = url => { try { const parsed = new URL(url, location.href); return parsed.hostname === 'www.target.com' ? (parsed.pathname.match(/^\/p\/(\d{8})\/?$/) || [])[1] || null : null; } catch { return null; } };
  const tiles = ids.map(id => {
    const card = element('article'), titleLink = element('a'), title = element('h3');
    card.style.display = 'grid'; titleLink.href = `https://www.target.com/p/${id}`;
    title.textContent = 'Organic oats'; titleLink.appendChild(title); card.appendChild(titleLink); body.appendChild(card);
    return { id, title: 'Organic oats', anchor: title, link: titleLink, card };
  });
  const adapter = { id: 'target', name: 'Target', matchesHost: host => host === 'www.target.com', productId,
    isProductPage: loc => !!productId(loc.href), isSearchPage: loc => loc.pathname === '/s', searchQuery: () => query,
    productUrl: id => `https://www.target.com/p/${id}`,
    searchTiles: () => tiles.map(tile => ({ ...tile, id: productId(tile.link.href) })),
    readProduct: (doc, loc) => ({ id: productId(loc.href), title: 'Organic oats', crumbs: ['Grocery'],
      labelText: '', label: 'missing', ingredients: '', nutrition: null, ...(doc.productData || {}) }),
  };
  const sandbox = { console, URL, URLSearchParams, AbortController, AbortSignal, Promise, Object, Array, JSON, String, Number, Math,
    Date: class extends Date { static now() { return now; } }, location,
    setTimeout: (fn, ms = 0) => { timers.push({ fn, at: now + ms, active: true }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].active = false; },
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {},
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} },
    DOMParser: class { parseFromString(html) { return { productData: JSON.parse(html), querySelector: () => null, querySelectorAll: () => [] }; } },
    fetch: (url, options = {}) => new Promise((resolve, reject) => {
      const request = { url: String(url), options, resolve, reject }; requests.push(request);
      options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
    }),
    document: { body, documentElement: body, title: 'Oats', URL: location.href,
      querySelector: selector => body.querySelector(selector), querySelectorAll: selector => body.querySelectorAll(selector),
      getElementById: id => nodes.find(node => node.id === id && node.isConnected) || null,
      createElement: tag => { const node = element(tag); nodes.push(node); return node; } },
    chrome: { i18n: { getMessage: () => '' },
      runtime: { getManifest: () => ({ version: '2.0.0' }), sendMessage: (_message, callback) => callback?.(), onMessage: { addListener() {} } },
      storage: { local: { get: (keys, callback) => callback(Object.fromEntries([].concat(keys).map(key => [key, settings[key]]))),
        set: values => { Object.assign(settings, values); writes.push(values); return Promise.resolve(); }, remove: (key, callback) => { delete settings[key]; callback?.(); } },
        onChanged: { addListener: callback => { const previous = settingsChanged; settingsChanged = (...args) => { previous?.(...args); callback(...args); }; } } } },
    AIR: { storeAdapters: { target: adapter }, db: { prefs, scoreCache,
      ingestible: { RESULT_SAMPLE_MIN: 4, assessSearch: () => ({ ok: true }), looksNonFoodFromResults: () => false,
        assess: () => ({ ok: true, negatives: [] }), looksNonFoodFromTitle: () => false } },
      engine: { score: input => ({ score: input.ingredients_text.includes('sugar') ? 40 : 93, verdict: 'Excellent', nova: 1, parsed: 2, coverage: 1 }) },
      panel: { BAND_COLOR: () => ({ fg: '#000', bg: '#fff', ring: '#080' }), mount() {}, render() {}, renderFailure() {}, renderNotFood() {} } },
    module: { exports: {} },
  };
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/content/retailer.js'), 'utf8'), sandbox);
  const api = sandbox.module.exports;
  const flush = async (rounds = 5) => { for (let round = 0; round < rounds; round++) {
    await new Promise(resolve => setImmediate(resolve)); now += 250;
    for (const timer of timers) if (timer.active && timer.at <= now) { timer.active = false; timer.fn(); }
  } };
  const reply = (index, data = { ingredients: 'organic oats, salt' }, extra = {}) => {
    const request = requests[index]; assert.ok(request, `request ${index} exists`);
    request.resolve({ ok: true, status: 200, url: request.url, text: async () => JSON.stringify(data), ...extra });
  };
  return { api, tiles, body, nodes, requests, writes, observers, intervals, settings, location, flush, reply,
    badges: () => body.querySelectorAll('.air-badge'),
    change: values => { Object.assign(settings, values); settingsChanged(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }])), 'local'); },
    navigate: href => { const next = new URL(href); Object.assign(location, { href: next.href, hostname: next.hostname, origin: next.origin, pathname: next.pathname, search: next.search }); intervals.forEach(fn => fn()); } };
}

const waitForRequest = async w => { await w.flush(); assert.ok(w.requests.length, 'uncached grocery product page is requested'); };

test('retailer search rates a previously unopened product and caches its score', async () => {
  const w = runner(); await waitForRequest(w); w.reply(0); await w.flush();
  assert.equal(w.badges()[0]?.textContent, '93');
  assert.ok(w.writes.some(write => write['s:target.com:79364857']?.score === 93));
  assert.equal(new URL(w.requests[0].url).origin, 'https://www.target.com');
});

test('retailer search displays unavailable status when the public product page has no declared list', async () => {
  const w = runner(); await waitForRequest(w); w.reply(0, {}); await w.flush();
  assert.equal(w.badges()[0]?.textContent, 'Label unavailable');
  assert.equal(w.writes.length, 0);
});

for (const [reason, url] of [['foreign origin', 'https://evil.example/p/79364857'], ['wrong product', 'https://www.target.com/p/79364858']]) {
  test(`retailer search rejects a ${reason} redirect without caching a score`, async () => {
    const w = runner(); await waitForRequest(w); w.reply(0, { ingredients: 'oats, salt' }, { url }); await w.flush();
    assert.equal(w.writes.length, 0);
    assert.equal(w.badges().some(badge => /^\d+$/.test(badge.textContent)), false);
    assert.equal(w.badges()[0]?.textContent, 'Label unavailable');
  });
}

test('retailer search repeated passes join one request and reuse its finished score', async () => {
  const w = runner(); await waitForRequest(w);
  for (let i = 0; i < 6; i++) w.api.pass(); await w.flush();
  assert.equal(w.requests.length, 1); w.reply(0); await w.flush();
  for (let i = 0; i < 6; i++) w.api.pass(); await w.flush();
  assert.equal(w.requests.length, 1); assert.equal(w.badges().length, 1);
});

for (const setting of ['enabled', 'badges', 'autoScoreSearch']) {
  test(`retailer search aborts pending product reads when ${setting} is disabled`, async () => {
    const w = runner(); await waitForRequest(w); w.change({ [setting]: false }); await w.flush();
    assert.equal(w.requests[0].options.signal.aborted, true);
    w.reply(0); await w.flush(); assert.equal(w.writes.length, 0);
    assert.equal(w.badges().some(badge => /^\d+$/.test(badge.textContent)), false);
  });
}

test('retailer search navigation aborts old-page requests and ignores their replies', async () => {
  const w = runner(); await waitForRequest(w); w.navigate('https://www.target.com/account'); await w.flush();
  assert.equal(w.requests[0].options.signal.aborted, true);
  w.reply(0); await w.flush(); assert.equal(w.writes.length, 0); assert.equal(w.badges().length, 0);
});

test('retailer search a recycled product card never receives the previous product score', async () => {
  const w = runner(); await waitForRequest(w); w.tiles[0].link.href = 'https://www.target.com/p/79364858';
  w.api.pass(); w.reply(0); await w.flush();
  assert.equal(w.badges().some(badge => badge.dataset.airProduct === '79364858' && badge.textContent === '93'), false);
  assert.equal(w.badges().some(badge => badge.dataset.airProduct === '79364857' && /^\d+$/.test(badge.textContent)), false);
});

test('retailer badges are placed beside the product title without adding a grid card child', async () => {
  const w = runner(); await waitForRequest(w); w.reply(0); await w.flush();
  const badge = w.badges()[0]; assert.ok(badge);
  assert.notEqual(badge.parentNode, w.tiles[0].card);
  assert.equal(w.tiles[0].card.children.length, 1, 'retailer grid children are preserved');
  assert.ok(badge.shadowRoot, 'retailer page CSS cannot distort badge internals');
});

test('retailer search fetch work has bounded concurrency', async () => {
  const w = runner({ ids: ['79364857', '79364858', '79364859', '79364860', '79364861', '79364862'] });
  await waitForRequest(w); assert.equal(w.requests.length, 2, 'only two requests run concurrently');
  for (let i = 0; i < 6; i++) { if (w.requests[i]) w.reply(i); await w.flush(); }
  assert.equal(w.badges().filter(badge => badge.textContent === '93').length, 6);
});

for (const [description, extra] of [['rate limit', { ok: false, status: 429 }], ['forbidden', { ok: false, status: 403 }]]) {
  test(`retailer search stops queued public requests after ${description}`, async () => {
    const w = runner({ ids: ['79364857', '79364858', '79364859', '79364860'] });
    await waitForRequest(w); w.reply(0, {}, extra); w.reply(1, {}, extra); await w.flush();
    assert.equal(w.requests.length, 2); assert.equal(w.writes.length, 0);
    assert.ok(w.badges().every(b => b.textContent === 'Label unavailable'));
  });
}
test('retailer search rejects non-HTML and oversized responses without inventing ratings', async () => {
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-length': String(9 * 1024 * 1024) }]) {
    const w = runner(); await waitForRequest(w);
    w.reply(0, { ingredients: 'oats' }, { headers: { get: name => headers[name] || null } }); await w.flush();
    assert.equal(w.writes.length, 0); assert.equal(w.badges()[0].textContent, 'Label unavailable');
  }
});
test('retailer automatic-rating opt-out keeps status visible without requesting pages', async () => {
  const w = runner({ stored: { autoScoreSearch: false } }); await w.flush();
  assert.equal(w.requests.length, 0); assert.equal(w.badges()[0].textContent, 'Open to rate');
});
