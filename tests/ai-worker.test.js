// The OpenRouter client in the service worker (src/worker/ai.js): what it sends, what it keeps, what it refuses.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadWorker } = require('./worker-scripts.js');

const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';
const IMG = 'https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg';
const amazonTab = { id: 'ext', tab: { id: 3, url: 'https://www.amazon.com/dp/B00LOAW7U6' } };
const targetTab = { id: 'ext', tab: { id: 4, url: 'https://www.target.com/p/x/-/A-1' } };
const settingsPage = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
const popupPage = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };

function reply(content, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[String(k).toLowerCase()] ?? null },
    json: async () => ({ choices: [{ message: { content } }] }) };
}

function worker(initial, answer, { permission = true } = {}) {
  const data = structuredClone(initial);
  const calls = [];
  const event = { addListener() {} };
  let onMessage = null;
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, body });
      return answer(body, calls.length);
    },
    chrome: {
      runtime: { id: 'ext', getManifest: () => ({ version: '1.0.0' }), getURL: p => `chrome-extension://ext/${p}`,
        sendMessage: async () => ({ ok: true }), getContexts: async () => [], onMessage: { addListener(fn) { onMessage = fn; } }, onStartup: event, onInstalled: event },
      permissions: { contains: async origins => permission && origins.origins.includes('https://openrouter.ai/*') },
      offscreen: { createDocument: async () => {} },
      alarms: { create() {}, clear() {}, onAlarm: event },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {}, getBadgeText: async () => '' },
      storage: { onChanged: { addListener() {} }, local: {
        async get(keys) { return structuredClone(keys == null ? data : Object.fromEntries([].concat(keys).map(k => [k, data[k]]))); },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
      }, sync: { async get() { return {}; }, async set() {} } },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  loadWorker(vm, context);
  context.AIR.aiWorker.resetBackoff();
  context.AIR.aiWorker.setGap(0);
  return { data, calls, // Replies come from the worker's own realm; a JSON round trip makes them comparable with deepEqual.
    send: (msg, sender) => new Promise(resolve => { if (onMessage(msg, sender, value => resolve(value === undefined ? value : JSON.parse(JSON.stringify(value)))) !== true) resolve(undefined); }) };
}

const on = { aiRatings: true, aiLabels: true, openrouterKey: KEY };
const ratingsReply = ratings => reply(JSON.stringify({ ratings }));

test('only the pages meant to ask can ask: Amazon tabs for ratings and labels, the settings page for the key check', async () => {
  const w = worker(on, () => ratingsReply([]));
  for (const type of ['aiRateIngredients', 'aiReadLabels']) {
    assert.ok(await w.send({ type, names: ['zorbex'], urls: [IMG] }, amazonTab), `${type} from an Amazon tab`);
    assert.equal(await w.send({ type, names: ['zorbex'], urls: [IMG] }, targetTab), undefined, `${type} from a retailer preview`);
    assert.equal(await w.send({ type, names: ['zorbex'], urls: [IMG] }, popupPage), undefined, `${type} from the popup`);
  }
  assert.ok(await w.send({ type: 'aiTest' }, settingsPage));
  assert.equal(await w.send({ type: 'aiTest' }, amazonTab), undefined);
  assert.equal(await w.send({ type: 'aiTest' }, popupPage), undefined);
});

test('nothing is sent unless the reader switched it on, gave a key and granted the host', async () => {
  const ask = { type: 'aiRateIngredients', names: ['zorbex gum'] };
  const cases = [
    [{ openrouterKey: KEY }, {}, 'not-enabled'],
    [{ aiRatings: true }, {}, 'no-key'],
    [{ aiRatings: true, openrouterKey: 'short' }, {}, 'no-key'],
    [{ aiRatings: true, openrouterKey: 'sk or key with spaces and more' }, {}, 'no-key'],
    [{ ...on, enabled: false }, {}, 'paused'],
    [on, { permission: false }, 'no-permission'],
  ];
  for (const [conf, opts, reason] of cases) {
    const w = worker(conf, () => ratingsReply([]), opts);
    const res = await w.send(ask, amazonTab);
    assert.deepEqual([res.ok, res.reason], [false, reason]);
    assert.equal(w.calls.length, 0, `${reason}: no request`);
  }
  const w = worker({ aiLabels: false, aiRatings: true, openrouterKey: KEY }, () => ratingsReply([]));
  assert.equal((await w.send({ type: 'aiReadLabels', urls: [IMG] }, amazonTab)).reason, 'not-enabled');
  assert.equal(w.calls.length, 0);
});

test('ratings: only the ingredient names are sent, the answer is cached, and it is asked once', async () => {
  const w = worker(on, body => ratingsReply(JSON.parse(body.messages[1].content).ingredients.map(name => ({ name, class: 'texture', confidence: 0.9 }))));
  const res = await w.send({ type: 'aiRateIngredients', names: ['Zorbex Gum', 'zorbex gum', 'qualiflavor 12', '12345'] }, amazonTab);
  assert.deepEqual(res, { ok: true, ratings: { 'zorbex gum': { c: 'texture', k: 0.9 }, 'qualiflavor 12': { c: 'texture', k: 0.9 } } });
  assert.equal(w.calls.length, 1);
  const call = w.calls[0];
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.referrerPolicy, 'no-referrer');
  assert.equal(call.options.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.body.model, 'openrouter/free');
  assert.equal(call.body.temperature, 0);
  assert.deepEqual(JSON.parse(call.body.messages[1].content), { ingredients: ['zorbex gum', 'qualiflavor 12'] }, 'names and nothing else');
  assert.deepEqual(Object.keys(call.body.messages[1]).sort(), ['content', 'role']);
  assert.ok(!JSON.stringify(call.body).includes('amazon'), 'no store or page in the request');
  assert.ok(!JSON.stringify(call.body).includes(KEY), 'the key goes in the header only');
  // Again: answered from this computer, even with one new name only that name is asked.
  const again = await w.send({ type: 'aiRateIngredients', names: ['zorbex gum', 'qualiflavor 12'] }, amazonTab);
  assert.deepEqual(again.ratings, res.ratings);
  assert.equal(w.calls.length, 1);
  await w.send({ type: 'aiRateIngredients', names: ['zorbex gum', 'plimm'] }, amazonTab);
  assert.deepEqual(JSON.parse(w.calls[1].body.messages[1].content).ingredients, ['plimm']);
  assert.ok(w.data.aiIngredientCache['zorbex gum'].t > 0);
});

test('a hostile or broken reply rates nothing it was not asked about, and "unknown" is remembered briefly', async () => {
  const w = worker(on, () => reply('Sure! ```{"ratings":[{"name":"plimm","class":"colour","confidence":1}]}``` and also ' + JSON.stringify({ ratings: [{ name: 'other', class: 'colour', confidence: 1 }] })));
  const res = await w.send({ type: 'aiRateIngredients', names: ['plimm'] }, amazonTab);
  assert.deepEqual(res, { ok: true, ratings: {} });
  const second = await w.send({ type: 'aiRateIngredients', names: ['plimm'] }, amazonTab);
  assert.deepEqual(second, { ok: true, ratings: {} });
  assert.equal(w.calls.length, 1, 'an unanswered name is not asked again at once');
  assert.equal(w.data.aiIngredientCache.plimm.u, 1);
  const v = worker(on, () => ratingsReply([{ name: 'plimm', class: 'unknown', confidence: 0.9 }, { name: 'tarsk', class: 'sugar', confidence: 0.2 }, { name: 'vandrel', class: 'sweetener', confidence: 0.8 }]));
  assert.deepEqual((await v.send({ type: 'aiRateIngredients', names: ['plimm', 'tarsk', 'vandrel'] }, amazonTab)).ratings,
    { tarsk: { c: 'sugar', k: 0.2 }, vandrel: { c: 'sweetener', k: 0.8 } }, 'a low confidence is returned and the engine decides to ignore it');
});

test('a rate limit pauses everything until it clears, and a bad key or no credit is named', async () => {
  const limited = worker(on, () => reply('', 429, { 'retry-after': '120' }));
  assert.equal((await limited.send({ type: 'aiRateIngredients', names: ['plimm'] }, amazonTab)).reason, 'rate-limited');
  assert.equal((await limited.send({ type: 'aiRateIngredients', names: ['tarsk'] }, amazonTab)).reason, 'rate-limited');
  assert.equal((await limited.send({ type: 'aiReadLabels', urls: [IMG] }, amazonTab)).reason, 'rate-limited');
  assert.equal(limited.calls.length, 1, 'no further request while paused');
  assert.equal((await worker(on, () => reply('', 401)).send({ type: 'aiTest' }, settingsPage)).reason, 'bad-key');
  assert.equal((await worker(on, () => reply('', 402)).send({ type: 'aiTest' }, settingsPage)).reason, 'no-credits');
  assert.equal((await worker(on, () => reply('', 503)).send({ type: 'aiTest' }, settingsPage)).reason, 'unavailable');
  const offline = worker(on, () => { throw new Error('offline'); });
  assert.equal((await offline.send({ type: 'aiTest' }, settingsPage)).reason, 'unavailable');
});

test('a model without structured output is asked again without the schema', async () => {
  const w = worker(on, (body, n) => n === 1 ? reply('', 400) : ratingsReply([{ name: 'plimm', class: 'sugar', confidence: 0.9 }]));
  const res = await w.send({ type: 'aiRateIngredients', names: ['plimm'] }, amazonTab);
  assert.deepEqual(res.ratings, { plimm: { c: 'sugar', k: 0.9 } });
  assert.ok(w.calls[0].body.response_format && !w.calls[1].body.response_format);
});

test('label photos: only the product-image CDN, only a list that looks like a list, and each photo once', async () => {
  const text = 'INGREDIENTS: Water, cane sugar, citric acid, natural flavor. Contains: none';
  const w = worker(on, () => reply(text));
  const none = await w.send({ type: 'aiReadLabels', urls: ['https://evil.example/images/I/514iQ-HJVEL._SL1600_.jpg', 'http://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg', 'https://m.media-amazon.com/other/x.jpg'] }, amazonTab);
  assert.deepEqual([none.ok, none.reason], [false, 'no-images']);
  assert.equal(w.calls.length, 0);
  const got = await w.send({ type: 'aiReadLabels', urls: [IMG] }, amazonTab);
  assert.equal(got.ok, true);
  assert.equal(got.results.length, 1);
  assert.equal(got.results[0].url, IMG);
  const content = w.calls[0].body.messages[1].content;
  assert.deepEqual(content.filter(part => part.type === 'image_url').map(part => part.image_url.url), [IMG], 'the address, not the pixels');
  assert.equal(w.calls[0].body.model, 'openrouter/free');
  const again = await w.send({ type: 'aiReadLabels', urls: [IMG] }, amazonTab);
  assert.equal(again.results.length, 1);
  assert.equal(w.calls.length, 1, 'kept on this computer');
  // A refusal, a description or "no list" is not a label.
  for (const prose of ['NONE', 'I cannot read this image.', 'The image shows a bottle of juice on a table.', 'Sure! This is a cereal box.']) {
    const v = worker(on, () => reply(prose));
    const res = await v.send({ type: 'aiReadLabels', urls: [IMG] }, amazonTab);
    assert.deepEqual([res.ok, res.results.length], [true, 0], prose);
  }
});

test('the key check reports success, and the key lives in one storage key that no backup reads', async () => {
  const w = worker(on, () => reply('ok'));
  assert.deepEqual(await w.send({ type: 'aiTest' }, settingsPage), { ok: true });
  const P = require('../src/engine/db/prefs.js');
  assert.ok(!P.SETTING_KEYS.includes('openrouterKey'));
  assert.ok(!JSON.stringify(P.backupPayload({ ...on })).includes(KEY));
  assert.ok(!JSON.stringify(P.exportPayload({ ...on })).includes(KEY));
  assert.ok(P.SHARING_KEYS.includes('aiRatings') && P.SHARING_KEYS.includes('aiLabels'), 'a settings file never turns AI help on');
  assert.deepEqual([P.TOGGLE_DEFAULTS.aiRatings, P.TOGGLE_DEFAULTS.aiLabels], [false, false]);
});
