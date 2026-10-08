'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/engine/db/purchase-history.js');
const O = require('../src/stores/amazon-orders.js');
const { createDocument } = require('./pages/load.js');
const loc = new URL('https://www.amazon.com/your-orders/orders?timeFilter=year-2026');
const record = (n = 1, more = {}) => ({ key: String(n).padStart(64, 'a'), store: 'amazon.com', asin: 'B000000001', date: '2026-09-01', state: 'purchased', name: 'Oats', score: 98, profile: 'f'.repeat(64), version: '1.11.0', ingredients: 'whole grain oats', flags: [], observedAt: 10000, scoredAt: 10000, ...more });
const card = (body, extra = '') => `<div class="order-card" data-order-id="123-1234567-1234567"><div class="order-header">Order placed September 1, 2026 ORDER #123-1234567-1234567<span>Ship to PRIVATE ADDRESS</span><span>Total $123</span></div>${extra}<div class="item-box">${body}</div></div>`;
test('orders reader accepts explicit cards and ignores recommendation links, addresses and actions', () => {
  const doc = createDocument(card('<a href="/Organic-Oats/dp/B000000001/ref=ppx">Whole grain oats</a><a href="/gp/returns">Return items</a>') + '<aside class="recommendations"><a href="/dp/B000000002">Suggested chips</a></aside>');
  const rows = O.read(doc, loc); assert.equal(rows.length, 1); assert.equal(rows[0].state, 'purchased'); assert.equal(rows[0].date, '2026-09-01'); assert.equal(rows[0].name, 'Whole grain oats');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['order', 'asin', 'name', 'date', 'state', 'anchor', 'imageOnly'].sort());
});
test('visible item cancellations and completed returns override purchase status; return buttons do not', () => {
  for (const [status, state] of [['Cancelled', 'cancelled'], ['Refund issued', 'returned'], ['Return requested', 'unknown'], ['Delivered September 5', 'purchased']]) {
    const rows = O.read(createDocument(card(`<span class="delivery-status">${status}</span><a href="/dp/B000000001">Oats</a>`)), loc); assert.equal(rows[0].state, state);
  }
});
test('missing order identities/dates and mixed or cross-origin product identities stay unknown', () => {
  for (const html of [card('<a href="https://evil.example/dp/B000000001">Oats</a>'), card('<a href="/dp/B000000001">Oats</a><a href="/dp/B000000002">Chips</a>'), '<div class="order-card"><div class="item-box"><a href="/dp/B000000001">Oats</a></div></div>']) assert.equal(O.read(createDocument(html), loc).length, 0);
  for (const url of ['https://www.amazon.com/cart', 'https://www.amazon.com/checkout', 'https://www.amazon.com/your-orders/order-details', 'https://www.amazon.com.evil.example/your-orders/orders', 'http://www.amazon.com/your-orders/orders']) assert.equal(O.allowed(new URL(url)), false);
});
test('order dates reject impossible dates without aborting the page', () => {
  assert.equal(O.date('Order placed February 31, 2026'), ''); assert.equal(O.date('2026-99-99'), ''); assert.equal(O.date('October 7, 2026'), '2026-10-07');
});
test('multi-product shipment tiles remain separate purchases and ignore buy-again recommendations', () => {
  const tile = (asin, name) => `<div class="product-box"><a href="/dp/${asin}"><img></a><a href="/dp/${asin}">${name}</a><button>Buy it again</button></div>`;
  const html = `<div class="order-card"><div class="order-header">ORDER #123-1234567-1234567 Order placed October 7, 2026</div><div class="a-fixed-left-grid">${tile('B000000001', 'Whole grain oats')}${tile('B000000002', 'Popcorn')}</div></div><aside class="recommendations">${tile('B000000003', 'Suggested food')}</aside>`;
  const rows = O.read(createDocument(html), loc);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.asin), ['B000000001', 'B000000002']);
  assert.ok(rows.every(r => r.date === '2026-10-07' && r.state === 'purchased'));
});
test('deduplication preserves first score and settings but updates later return status', () => {
  const first = record(), later = record(1, { score: 35, version: '2.0.0', profile: 'b'.repeat(64), state: 'returned', observedAt: 20000, scoredAt: 20000 });
  for (const inputs of [[first, later], [later, first]]) { const out = H.merge([], inputs); assert.equal(out.length, 1); assert.equal(out[0].score, 98); assert.equal(out[0].state, 'returned'); assert.equal(out[0].version, '1.11.0'); }
  assert.throws(() => H.merge([first], [record(1, { asin: 'B000000002' })]), /identity/);
});
test('an unavailable label can gain its first valid snapshot; later revisits do not replace it', () => {
  const out = H.merge([record(1, { score: null, scoredAt: 0 })], [record()]); assert.equal(out[0].score, 98);
});
test('trends exclude returns/cancellations and missing scores rather than counting them as zero', () => {
  const groups = H.trends([record(), record(2, { score: null }), record(3, { state: 'cancelled' }), record(4, { state: 'returned' }), record(5, { score: 30, profile: 'b'.repeat(64) })]);
  assert.equal(groups.length, 2); assert.equal(groups[0].average, 98); assert.equal(groups[0].rated, 1); assert.equal(groups[0].total, 2); assert.equal(groups[1].average, 30);
});
test('history schema strips sensitive/unrecognized fields and invalid records', () => {
  const clean = H.clean(record(1, { address: 'PRIVATE', price: 12, order: '123-1234567-1234567', token: 'secret', ingredients: 'oats'.repeat(1000) }));
  assert.ok(!('address' in clean) && !('order' in clean) && !('token' in clean) && !('price' in clean)); assert.equal(clean.ingredients.length, 2000);
  assert.equal(H.clean(record(1, { date: '2026-02-31' })), null);
  assert.equal(H.clean(record(1, { key: 'bad' })), null);
});
test('history capacity fails explicitly instead of silently deleting older purchases', () => {
  const all = Array.from({ length: H.MAX }, (_, i) => record(i + 1)); assert.equal(H.merge([], all).length, H.MAX); assert.throws(() => H.merge(all, [record(H.MAX + 1)]), /history-full/);
});
test('order import messages require the top-level exact order page; sync stays extension-only', () => {
  const ctx = vm.createContext({ chrome: { runtime: { id: 'ext' } }, URL }); vm.runInContext(fs.readFileSync('src/worker/messages.js', 'utf8'), ctx);
  const order = { id: 'ext', frameId: 0, url: loc.href, tab: { url: loc.href } };
  assert.equal(ctx.allowMessage({ type: 'purchaseImport' }, order), true);
  assert.equal(ctx.allowMessage({ type: 'purchaseImport' }, { ...order, frameId: 1 }), false);
  assert.equal(ctx.allowMessage({ type: 'purchaseImport' }, { ...order, tab: { url: 'https://www.amazon.com/checkout' } }), false);
  assert.equal(ctx.allowMessage({ type: 'purchaseSync' }, order), false);
  assert.equal(ctx.allowMessage({ type: 'purchaseSync' }, { id: 'ext', url: 'chrome-extension://ext/src/options/history.html' }), true);
});
test('settings imports and backups cannot enable or carry purchase history', () => {
  const P = require('../src/engine/db/prefs.js'); assert.ok(!P.SETTING_KEYS.includes('historyEnabled') && !P.SETTING_KEYS.includes('purchaseHistory'));
  const parsed = P.parseBackup(P.backupPayload({ historyEnabled: true, historyAutoSync: true, purchaseHistory: [record()] })); assert.ok(!('historyEnabled' in parsed.values));
});
test('backend history schema matches the extension schema exactly', () => {
  assert.ok(fs.readFileSync('docs/apps-script.gs', 'utf8').endsWith(fs.readFileSync('src/engine/db/purchase-history.js', 'utf8')));
});


test('terminal return or cancellation cannot be undone by a stale generic Delivered status', () => {
  for (const state of ['returned', 'cancelled']) {
    const first = record(1, { state }), later = record(1, { observedAt: 20000, state: 'purchased' });
    assert.equal(H.merge([first], [later])[0].state, state);
    assert.equal(H.trends(H.merge([first], [later])).length, 0);
  }
});


test('legacy order pagination ref paths are accepted without widening into private routes', () => {
  assert.equal(O.allowed(new URL('https://www.amazon.com/gp/your-account/order-history/ref=ppx_yo_pagination_2?page=2')), true);
  assert.equal(O.allowed(new URL('https://www.amazon.com/gp/your-account/order-history/ref=ppx_yo/checkout')), false);
  const cs = require('../manifest.json').content_scripts.find(c => c.js.includes('src/content/orders.js'));
  assert.ok(cs.matches.includes('https://www.amazon.com/gp/your-account/order-history/ref=*'));
});

test('actual order carousels and image-only compact tiles are imported; recommendation carousels are not', () => {
  const image = (asin, name) => `<a href="/dp/${asin}"><img alt="${name}"><span class="aok-hidden">Opens in a new tab</span></a>`;
  const html = card(`<div class="a-carousel"><div class="a-carousel-card">${image('B000000001', 'Whole grain oats')}</div><div class="a-carousel-card"><a href="/dp/B000000002">Popcorn</a></div></div>`) + `<div class="order-card" data-order-id="222-1234567-1234567"><div class="order-header">Order placed October 7, 2026</div><section class="compact-grid"><div>${image('B000000003', 'Cheddar cheese')}<a class="air-order-badge" href="/dp/B000000003">78/100</a></div><div>${image('B000000004', 'Oranges')}</div></section><aside class="recommendations"><div class="a-carousel-card">${image('B000000005', 'Suggested oats')}</div></aside></div>`;
  const rows = O.read(createDocument(html), loc);
  assert.deepEqual(rows.map(r => r.name), ['Whole grain oats', 'Popcorn', 'Cheddar cheese', 'Oranges']);
  assert.deepEqual(rows.map(r => r.asin), ['B000000001', 'B000000002', 'B000000003', 'B000000004']);
});
test('hidden compact products and conflicting declared ASINs cannot borrow order identities', () => {
  const html = card('<div class="a-carousel-card" data-asin="B000000002"><a href="/dp/B000000001">Oats</a></div><div style="display:none"><a href="/dp/B000000003"><img alt="Hidden oats"></a></div>');
  // The mixed explicit item is rejected, and its child identity must also match its declared tile.
  assert.equal(O.read(createDocument(html), loc).length, 0);
});
test('camping tables and knee braces are non-food without misclassifying groceries or vitamins', () => {
  const gate = require('../src/engine/db/ingestible.js');
  for (const title of ['Beach Table Folding Camping Portable Table', 'Knee Braces for Running, Compression Knee Sleeve']) {
    const food = gate.assess({ querySelector: () => null }, { title, text: title });
    assert.equal(food.ok, false); assert.ok(food.negatives.includes('furnitureOrSupport'));
  }
  for (const title of ['Table Salt', 'Coffee Beans', 'Hair Skin and Nails Vitamins', 'Protein Tablets', 'Knee Support Vitamins']) {
    const food = gate.assess({ querySelector: () => null }, { title, text: title });
    assert.ok(!food.negatives.includes('furnitureOrSupport'));
  }
});

test('multi-product shipment wrappers are split only at distinct image-bearing product tiles', () => {
  const tile = (id, name) => `<section><div><a href="/dp/${id}"><img alt="${name}"></a></div><a href="/dp/${id}">${name}</a></section>`;
  const rows = O.read(createDocument(card(tile('B000000001', 'Vitamin gummies') + tile('B000000002', 'Protein bars'))), loc);
  assert.deepEqual(rows.map(r => r.name), ['Vitamin gummies', 'Protein bars']);
  assert.equal(O.read(createDocument(card('<span><a href="/dp/B000000001">Oats</a></span><span><a href="/dp/B000000002">Chips</a></span>')), loc).length, 0);
});
