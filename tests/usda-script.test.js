// The Apps Script side of the USDA lookup (docs/apps-script.gs, kind 'usda'): it holds the api.data.gov key as a
// script property so the key never ships in the extension, and it must never hand that key, or an upstream error
// body, to a caller.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { receiver } = require('./receiver-harness.js');

// A made-up key: the real one is only ever a script property.
const KEY = 'TESTKEY0123456789abcdefghijklmnopqrstuv';
const UPC = '028400064057';
const food = (over = {}) => ({
  fdcId: 7, description: 'POTATO CHIPS', brandName: 'ACME', brandOwner: 'ACME FOODS', gtinUpc: UPC, ingredients: 'POTATOES, SALT.',
  foodCategory: 'Chips', servingSizeUnit: 'g', modifiedDate: '2024-01-02', secretField: 'do not pass on',
  foodNutrients: [{ nutrientId: 1093, nutrientName: 'Sodium', value: 590, unitName: 'MG' }, { nutrientId: 9999, value: 1 }, { nutrientId: 1003, value: 'x' }], ...over,
});
const ok = foods => ({ status: 200, text: JSON.stringify({ foods }) });
const ask = (r, code = UPC) => r.post({ kind: 'usda', code });

test('without the property the script says so, spends nothing, and a bad barcode never reaches USDA', () => {
  const r = receiver({ usdaFetch: () => ok([food()]) });
  assert.deepEqual(ask(r), { ok: false, error: 'usda not configured' });
  const s = receiver({ usdaKey: KEY, usdaFetch: () => ok([food()]) });
  for (const code of ['', 'abc', '123456', '1'.repeat(15), null, { a: 1 }]) assert.equal(ask(s, code).ok, false, String(code));
  assert.equal(s.post({ kind: 'usda' }).ok, false, 'no code at all');
  assert.equal(r.usdaCalls.length + s.usdaCalls.length, 0);
});

test('the key goes to USDA in a header, the barcode in the query, and only matching, trimmed records come back', () => {
  const r = receiver({ usdaKey: KEY, usdaFetch: () => ok([food(), food({ gtinUpc: '999999999999' }), food({ ingredients: undefined }), null, 7]) });
  const reply = ask(r, '0' + UPC);
  assert.equal(reply.ok, true);
  assert.equal(reply.foods.length, 1);
  assert.deepEqual(Object.keys(reply.foods[0]).sort(), ['brandName', 'brandOwner', 'description', 'foodCategory', 'foodNutrients', 'gtinUpc', 'ingredients', 'modifiedDate', 'servingSizeUnit']);
  assert.deepEqual(reply.foods[0].foodNutrients, [{ nutrientId: 1093, value: 590 }], 'only the nutrients the extension reads, numbers only');
  const call = r.usdaCalls[0];
  assert.equal(new URL(call.url).searchParams.get('query'), '028400064057 0028400064057 00028400064057', 'USDA matches the stored, zero-padded text: the stripped digits find nothing');
  assert.equal(new URL(call.url).searchParams.get('dataType'), 'Branded');
  assert.equal(call.options.headers['X-Api-Key'], KEY);
  assert.ok(!call.url.includes(KEY), 'never in the URL');
  assert.ok(!JSON.stringify(reply).includes(KEY), 'never in the answer');
});

test('an answer is kept six hours; a miss is kept too; a changed barcode is a new question', () => {
  let n = 0;
  const r = receiver({ usdaKey: KEY, usdaFetch: () => { n++; return ok([food()]); } });
  ask(r); ask(r); ask(r, '0' + UPC);
  assert.equal(n, 1);
  const held = r.cache.get('usda2:' + UPC.replace(/^0+/, ''));
  assert.equal(held.seconds, 21600);
  ask(r, '036000291452');
  assert.equal(n, 2);
  r.expireCache();
  ask(r);
  assert.equal(n, 3);
});

test('an upstream refusal is reported as a status only: no body, no key', () => {
  for (const [status, error] of [[403, 'upstream 403'], [500, 'upstream 500'], [429, 'busy; retry later']]) {
    const r = receiver({ usdaKey: KEY, usdaFetch: () => ({ status, text: `{"error":{"message":"bad key ${KEY}"}}` }) });
    const reply = ask(r);
    assert.deepEqual(reply, { ok: false, error });
    assert.ok(!JSON.stringify(reply).includes(KEY));
    assert.equal(r.cache.has('usda2:' + UPC.replace(/^0+/, '')), false, 'a refusal is not cached as an answer');
  }
});

test('at most 600 upstream requests an hour: a flood uses up the budget, not the owner\'s key', () => {
  const r = receiver({ usdaKey: KEY, usdaFetch: () => ok([]) });
  let busy = 0;
  for (let i = 0; i < 650; i++) { const reply = ask(r, String(1000000000000 + i)); if (reply.error === 'busy; retry later') busy++; }
  assert.equal(r.usdaCalls.length, 600);
  assert.equal(busy, 50);
  // A barcode already answered is still served while the budget is spent.
  assert.equal(ask(r, '1000000000000').ok, true);
  assert.equal(r.usdaCalls.length, 600);
});

test('no other request kind can read the property: a contribution cannot be coaxed into returning it', () => {
  const r = receiver({ usdaKey: KEY, usdaFetch: () => ok([food()]) });
  for (const body of [{ kind: 'lookup', keys: ['USDA_API_KEY'] }, { kind: 'usda-key' }, { kind: 'accountGet', token: 'x' }]) {
    assert.ok(!JSON.stringify(r.post(body)).includes(KEY));
  }
  assert.ok(!JSON.stringify(r.get({ kind: 'tables' })).includes(KEY));
});

test('the lookup is a read: it does not spend the per-minute allowance that anonymous writes share, and is listed as accepted', () => {
  const r = receiver({ usdaKey: KEY, usdaFetch: () => ok([food()]), anonLimits: { writes: 1, rows: 1 } });
  for (let i = 0; i < 5; i++) assert.equal(ask(r, String(2000000000000 + i)).ok, true);
  assert.equal(r.post({ kind: 'report', product_name: 'x' }).ok !== undefined, true);
  assert.ok(r.get({}).accepts.includes('usda'));
});

test('the query lists the padded forms FoodData Central stores: 12, 13 and 14 digits, once each', () => {
  const queries = code => {
    const r = receiver({ usdaKey: KEY, usdaFetch: () => ok([]) });
    ask(r, code);
    return new URL(r.usdaCalls[0].url).searchParams.get('query');
  };
  assert.equal(queries('016000275683'), '016000275683 0016000275683 00016000275683');
  assert.equal(queries('722252100900'), '722252100900 0722252100900 00722252100900');
  assert.equal(queries('4006381333931'), '4006381333931 04006381333931', 'an EAN-13 is already 13 digits');
  assert.equal(queries('40084107'), '000040084107 0000040084107 00000040084107', 'an 8-digit EAN is padded to the stored length');
});
