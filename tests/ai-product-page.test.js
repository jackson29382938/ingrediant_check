// The product page's use of AI ratings (src/content/product.js presentResult): what it asks, when it holds the
// score back, and that a late or failed answer cannot leave a wrong panel behind.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../src/engine/score.js');
const src = file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

const GUM_LIST = 'Rice flour, water, salt, zorbex gum, qualiflavor 12';
const UNREADABLE = 'zorbex, quillon, vandrel, tarsk, plimm';
const answerFor = names => Object.fromEntries(names.map(n => [n, { c: 'processed', k: 0.9 }]));

function setup({ ai = true, answer } = {}) {
  const sent = [], mounted = [], remembered = [], cached = [];
  const state = { requestId: 1, lastKey: 'B000000001', prefs: {}, cacheOptions: { aiRatings: ai, aiLabels: false }, ocrLabels: false, panelOpen: false };
  const replies = [];
  const page = {
    state, unreadable: r => !engine.isReadable(r), cacheScore: (...a) => cached.push(a), publishActionBadge() {}, sendDiagnostic() {},
    ingredientSig: () => '', rememberProduct: (key, scan, opts) => remembered.push({ key, scan, opts }), logAction() {},
  };
  const host = { dataset: {}, isConnected: true };
  const context = vm.createContext({
    console, location: { hostname: 'www.amazon.com', href: 'https://www.amazon.com/dp/B000000001' },
    document: {},
    AIR: {
      page, engine,
      db: { aiRatings: require('../src/engine/db/ai-ratings.js'), shopping: null, ingestible: {}, ocrText: {} },
      panel: { mount: (h, view) => mounted.push(view), render: (result, meta) => ({ rendered: result.score, ai: !!result.ai, rows: result.bad.filter(r => r.ai).length, meta }),
        renderLoading: () => ({ loading: true }), renderFailure: () => ({ failure: true }), openCard() {}, renderPersonalCare: () => ({}) },
      extract: {},
    },
    chrome: { runtime: { lastError: null, sendMessage(msg, cb) {
      sent.push(msg);
      replies.push(() => cb(answer ? answer(msg) : { ok: false, reason: 'unavailable' }));
    } } },
  });
  context.self = context;
  vm.runInContext(src('content/product.js'), context, { filename: 'content/product.js' });
  const product = context.AIR.product;
  return { sent, mounted, remembered, cached, state, host, replies, product, flush: () => replies.splice(0).forEach(f => f()) };
}

const data = { title: 'Test snack', text: '', ingestible: { ok: true } };
const inputFor = text => ({ name: 'Test snack', ingredients_text: text });
const present = (t, text) => {
  const input = inputFor(text);
  return t.product.presentResult(t.host, data, 'B000000001', engine.score(input, {}), { input, title: 'Test snack', confidence: 1, via: 'page', text });
};

test('with the switch off the page never asks', () => {
  const t = setup({ ai: false });
  assert.equal(present(t, GUM_LIST), true);
  assert.deepEqual(t.sent, []);
});

test('a list that scores is shown at once, and shown again only when the ratings move the score', () => {
  const t = setup({ answer: msg => ({ ok: true, ratings: answerFor(msg.names) }) });
  assert.equal(present(t, GUM_LIST), true);
  assert.equal(t.mounted.length, 1, 'the base score is on screen before any answer');
  assert.equal(t.sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.sent[0])), { type: 'aiRateIngredients', names: ['zorbex gum', 'qualiflavor 12'] }, 'only the names no rule recognises');
  t.flush();
  assert.equal(t.mounted.length, 2);
  const view = t.mounted[1];
  assert.equal(view.ai, true);
  assert.equal(view.rows, 2);
  assert.ok(view.rendered < t.mounted[0].rendered, 'the estimate lowered the score');
  assert.equal(t.sent.length, 1, 'the second pass does not ask again');
  const saved = t.remembered.at(-1);
  assert.deepEqual(Object.keys(saved.scan.input.aiRatings).sort(), ['qualiflavor 12', 'zorbex gum'], 'kept with the reading');
  assert.equal(saved.opts.share, false);
});

test('an answer that changes nothing leaves the panel alone but keeps the ratings', () => {
  const t = setup({ answer: msg => ({ ok: true, ratings: Object.fromEntries(msg.names.map(n => [n, { c: 'whole', k: 0.9 }])) }) });
  present(t, GUM_LIST);
  t.flush();
  assert.equal(t.mounted.length, 1);
  assert.equal(t.remembered.length >= 1, true);
  assert.ok(Object.keys(t.remembered.at(-1).scan.input.aiRatings).length === 2);
});

test('a list under the coverage gate is held while the model answers, then scored if the ratings made it readable', () => {
  const t = setup({ answer: msg => ({ ok: true, ratings: answerFor(msg.names) }) });
  assert.equal(present(t, UNREADABLE), false);
  assert.deepEqual(JSON.parse(JSON.stringify(t.mounted)), [{ loading: true }]);
  assert.equal(t.host.dataset.airState, 'loading');
  t.flush();
  assert.equal(t.mounted.length, 2);
  assert.equal(typeof t.mounted[1].rendered, 'number');
  assert.equal(t.host.dataset.airState, 'scored');
  assert.equal(t.sent.length, 1);
});

test('a refused or empty answer does not score an unreadable list, and is not asked for twice', () => {
  for (const answer of [() => ({ ok: false, reason: 'rate-limited' }), () => ({ ok: true, ratings: {} }), () => undefined]) {
    const t = setup({ answer });
    present(t, UNREADABLE);
    t.flush();
    assert.equal(t.sent.length, 1);
    assert.equal(t.mounted.filter(v => typeof v.rendered === 'number').length, 0, 'no score was shown');
  }
});

test('an answer for a page the reader has left is dropped', () => {
  const t = setup({ answer: msg => ({ ok: true, ratings: answerFor(msg.names) }) });
  present(t, UNREADABLE);
  t.state.requestId++;
  t.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(t.mounted)), [{ loading: true }]);
  const u = setup({ answer: msg => ({ ok: true, ratings: answerFor(msg.names) }) });
  present(u, GUM_LIST);
  u.state.lastKey = 'B000000002';
  u.flush();
  assert.equal(u.mounted.length, 1);
});

test('personal-care indices and manual pastes are never sent', () => {
  const t = setup({ answer: msg => ({ ok: true, ratings: answerFor(msg.names) }) });
  const input = inputFor(GUM_LIST);
  t.product.presentResult(t.host, data, 'B000000001', engine.score(input, {}), { title: 'x', confidence: 1, via: 'manual-paste', text: GUM_LIST });
  assert.deepEqual(t.sent, [], 'no input means a pasted list: not asked');
  t.product.presentResult(t.host, data, 'B000000001', { ...engine.score(input, {}), category: 'shampoo', unreadable: false }, { input, title: 'x', confidence: 1, via: 'page', text: GUM_LIST });
  assert.deepEqual(t.sent, []);
});
