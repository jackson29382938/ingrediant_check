// USDA FoodData Central as a second barcode database (src/worker/usda.js, background.js lookupBarcode).
// The records below follow the documented /foods/search shape for Branded foods: gtinUpc, ingredients,
// brandName/brandOwner, foodCategory, servingSizeUnit and foodNutrients per 100 g or 100 ml.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadWorker } = require('./worker-scripts.js');

const KEY = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
const UPC = '028400064057';
const amazonTab = { id: 'ext', tab: { id: 3, url: 'https://www.amazon.com/dp/B00LOAW7U6' } };
const settingsPage = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
const popupPage = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };

const nutrients = { 1093: 590, 1258: 3.5, 2000: 1.2, 1003: 6.5, 1004: 31, 1005: 53, 1079: 3.1 };
const food = (over = {}) => ({
  fdcId: 1, dataType: 'Branded', description: 'POTATO CHIPS', brandName: 'ACME', brandOwner: 'ACME FOODS INC', gtinUpc: UPC,
  ingredients: 'POTATOES, VEGETABLE OIL (SUNFLOWER, CORN), SALT.', foodCategory: 'Potato Chips', servingSizeUnit: 'g',
  modifiedDate: '2024-03-01',
  foodNutrients: Object.entries(nutrients).map(([id, value]) => ({ nutrientId: Number(id), value })), ...over,
});
const res = (json, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => json });
const OFF_MISSING = res({ status: 0 });

function worker(initial, route, { granted = ['https://world.openfoodfacts.org/*', 'https://api.nal.usda.gov/*'] } = {}) {
  const data = structuredClone(initial);
  const calls = [];
  const event = { addListener() {} };
  let onMessage = null;
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options = {}) => { calls.push({ url: String(url), options }); return route(String(url), options); },
    chrome: {
      runtime: { id: 'ext', getManifest: () => ({ version: '1.0.0' }), getURL: p => `chrome-extension://ext/${p}`,
        sendMessage: async () => ({ ok: true }), getContexts: async () => [], onMessage: { addListener(fn) { onMessage = fn; } }, onStartup: event, onInstalled: event },
      permissions: { contains: async p => p.origins.every(o => granted.includes(o)) },
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
  context.AIR.usdaWorker.resetBackoff();
  return {
    data, calls, context,
    usda: () => calls.filter(c => c.url.includes('api.nal.usda.gov')),
    send: (msg, sender = amazonTab) => new Promise(resolve => { if (onMessage(msg, sender, v => resolve(v === undefined ? v : JSON.parse(JSON.stringify(v)))) !== true) resolve(undefined); }),
  };
}
const on = { useOpenFoodFacts: true, useUsda: true, usdaKey: KEY };
const routeOnly = usda => (url) => url.includes('api.nal.usda.gov') ? usda(url) : OFF_MISSING;
const lookup = (w, code = UPC, extra = {}) => w.send({ type: 'lookupBarcode', code, foodOnly: true, ...extra });

test('parseSearch: a record counts only for its own barcode, and carries its ingredients and per-100 g numbers', () => {
  const { parseSearch } = vm.runInContext('AIR.usdaWorker', worker(on, () => OFF_MISSING).context);
  const got = JSON.parse(JSON.stringify(parseSearch({ foods: [food()] }, UPC)));
  assert.equal(got.source, 'usda-fdc');
  assert.equal(got.ingredients_text, 'POTATOES, VEGETABLE OIL (SUNFLOWER, CORN), SALT');
  assert.equal(got.name, 'ACME POTATO CHIPS');
  assert.deepEqual(got.nutrition, { servingGrams: 100, sodium: 590, saturatedFat: 3.5, sugar: 1.2, protein: 6.5, fat: 31, carbs: 53, fibre: 3.1 });
  // A UPC-A and its EAN-13 form are one barcode.
  assert.ok(parseSearch({ foods: [food()] }, '0' + UPC));
  assert.ok(parseSearch({ foods: [food({ gtinUpc: '0' + UPC })] }, UPC));
  // Another product that merely matched the search text is never a label for this one.
  assert.equal(parseSearch({ foods: [food({ gtinUpc: '028400064058' })] }, UPC), null);
  assert.equal(parseSearch({ foods: [food({ gtinUpc: '' })] }, UPC), null);
  assert.equal(parseSearch({ foods: [food({ ingredients: '  ' })] }, UPC), null);
  assert.equal(parseSearch({ foods: [food({ ingredients: undefined })] }, UPC), null);
  for (const bad of [null, {}, { foods: 'x' }, { foods: [null, 3, 'x'] }]) assert.equal(parseSearch(bad, UPC), null);
  assert.equal(parseSearch({ foods: [food()] }, ''), null);
  assert.equal(parseSearch({ foods: [food()] }, '0000'), null);
});

test('parseSearch: the newest matching record wins, a basis is needed for numbers, pet food is refused, "Pet" milk is food', () => {
  const { parseSearch } = vm.runInContext('AIR.usdaWorker', worker(on, () => OFF_MISSING).context);
  const newest = parseSearch({ foods: [food({ ingredients: 'OLD', modifiedDate: '2020-01-01' }), food({ ingredients: 'NEW', modifiedDate: '2025-01-01' })] }, UPC);
  assert.equal(newest.ingredients_text, 'NEW');
  assert.equal(parseSearch({ foods: [food({ servingSizeUnit: 'oz' })] }, UPC).nutrition, undefined, 'no basis, no numbers');
  assert.equal(parseSearch({ foods: [food({ servingSizeUnit: 'ml' })] }, UPC).nutrition.servingMl, 100);
  assert.equal(parseSearch({ foods: [food({ foodNutrients: [{ nutrientId: 1093, value: -5 }, { nutrientId: 1003, value: 'x' }] })] }, UPC).nutrition, undefined);
  const dog = parseSearch({ foods: [food({ description: 'ADULT DOG FOOD', foodCategory: 'Pet Food' })] }, UPC);
  assert.equal(dog.rejected, 'not-food');
  assert.ok(parseSearch({ foods: [food({ description: 'ADULT DOG FOOD' })] }, UPC, { foodOnly: false }).ingredients_text);
  assert.ok(parseSearch({ foods: [food({ brandName: 'PET', description: 'EVAPORATED MILK', foodCategory: 'Milk' })] }, UPC).ingredients_text);
});

test('Open Food Facts is asked first: a usable answer there means USDA is never contacted', async () => {
  const w = worker(on, url => url.includes('openfoodfacts') ? res({ product: { product_name: 'Chips', ingredients_text: 'potatoes, salt', labels_tags: [] } }) : res({ foods: [food()] }));
  const got = await lookup(w);
  assert.equal(got.ingredients_text, 'potatoes, salt');
  assert.equal(got.source, undefined);
  assert.equal(w.usda().length, 0);
});

test('with nothing at Open Food Facts, USDA answers: one request with the key in a header, kept 30 days, asked once', async () => {
  const w = worker(on, routeOnly(() => res({ foods: [food()] })));
  const got = await lookup(w);
  assert.equal(got.source, 'usda-fdc');
  assert.match(got.ingredients_text, /^POTATOES/);
  assert.equal(w.usda().length, 1);
  const call = w.usda()[0];
  const url = new URL(call.url);
  assert.equal(url.origin + url.pathname, 'https://api.nal.usda.gov/fdc/v1/foods/search');
  assert.equal(url.searchParams.get('query'), '28400064057', 'the barcode, as digits');
  assert.equal(url.searchParams.get('dataType'), 'Branded');
  assert.equal(call.options.headers['X-Api-Key'], KEY);
  assert.ok(!call.url.includes(KEY), 'the key is never in a URL');
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.referrerPolicy, 'no-referrer');
  assert.deepEqual((await lookup(w)).ingredients_text, got.ingredients_text);
  assert.equal(w.usda().length, 1, 'answered from this computer');
  assert.ok(w.data['usda:28400064057'].t > 0);
});

test('a wrong-barcode or empty answer is a miss, kept 3 days; a refusal is not kept', async () => {
  const miss = worker(on, routeOnly(() => res({ foods: [food({ gtinUpc: '999999999999' })] })));
  assert.equal(await lookup(miss), null);
  assert.equal(await lookup(miss), null);
  assert.equal(miss.usda().length, 1, 'a miss is not asked again at once');
  for (const status of [400, 403]) {
    const w = worker(on, routeOnly(() => res({}, status)));
    assert.equal(await lookup(w), null);
    assert.equal(await lookup(w), null);
    assert.equal(w.usda().length, 2, `${status}: not remembered as "no such product"`);
  }
});

test('a rate limit pauses USDA until it clears, and offline is only a miss', async () => {
  const w = worker(on, routeOnly(() => res({}, 429)));
  assert.equal(await lookup(w), null);
  assert.equal(await lookup(w, '012000001611'), null);
  assert.equal(w.usda().length, 1, 'no further request while paused');
  const offline = worker(on, routeOnly(() => { throw new Error('offline'); }));
  assert.equal(await lookup(offline), null);
});

test('nothing is sent unless the switch, the key, the permission and barcode lookup are all on', async () => {
  const route = routeOnly(() => res({ foods: [food()] }));
  const cases = [
    ['switch off', { ...on, useUsda: false }, undefined],
    ['no key', { ...on, usdaKey: undefined }, undefined],
    ['bad key', { ...on, usdaKey: 'short key!' }, undefined],
    ['no permission', on, { granted: ['https://world.openfoodfacts.org/*'] }],
    ['barcode lookup off', { ...on, useOpenFoodFacts: false }, undefined],
    ['paused', { ...on, enabled: false }, undefined],
  ];
  for (const [label, conf, opts] of cases) {
    const w = worker(conf, route, opts);
    assert.equal(await lookup(w), null, label);
    assert.equal(w.usda().length, 0, `${label}: no request`);
  }
  // The library's explicit Look up does not ask the switch, as for Open Food Facts, but still needs a key and the host.
  const library = worker({ ...on, useUsda: false }, route);
  const got = await library.send({ type: 'lookupBarcode', code: UPC, foodOnly: true }, { id: 'ext', url: 'chrome-extension://ext/src/options/library.html' });
  assert.equal(got.source, 'usda-fdc');
});

test('Open Food Facts calling a product not food is final, and a pet product is refused for a food-only caller', async () => {
  const w = worker(on, url => url.includes('openfoodfacts')
    ? res({ product: { product_name: 'Shampoo', ingredients_text: 'water', product_type: 'beauty', categories_tags: ['en:shampoos'] } })
    : res({ foods: [food()] }));
  assert.equal((await lookup(w)).rejected, 'not-food');
  assert.equal(w.usda().length, 0);
  const pet = worker(on, routeOnly(() => res({ foods: [food({ description: 'DOG FOOD', foodCategory: 'Pet Food' })] })));
  assert.equal((await lookup(pet)).rejected, 'not-food');
  assert.ok((await lookup(pet, UPC, { foodOnly: false })).ingredients_text, 'the same record is a reading for a caller with the food gate off');
});

test('the key check: settings page only, names why it failed, and the key lives in a key no backup reads', async () => {
  const ok = worker(on, routeOnly(() => res({ foods: [] })));
  assert.deepEqual(await ok.send({ type: 'usdaTest' }, settingsPage), { ok: true });
  assert.equal(await ok.send({ type: 'usdaTest' }, amazonTab), undefined);
  assert.equal(await ok.send({ type: 'usdaTest' }, popupPage), undefined);
  assert.equal((await worker(on, routeOnly(() => res({}, 403))).send({ type: 'usdaTest' }, settingsPage)).reason, 'bad-key');
  assert.equal((await worker(on, routeOnly(() => res({}, 429))).send({ type: 'usdaTest' }, settingsPage)).reason, 'rate-limited');
  assert.equal((await worker({ ...on, usdaKey: undefined }, routeOnly(() => res({}))).send({ type: 'usdaTest' }, settingsPage)).reason, 'no-key');
  const P = require('../src/engine/db/prefs.js');
  assert.ok(!P.SETTING_KEYS.includes('usdaKey'));
  assert.ok(!JSON.stringify(P.backupPayload({ ...on })).includes(KEY));
  assert.ok(!JSON.stringify(P.exportPayload({ ...on })).includes(KEY));
  assert.ok(P.SHARING_KEYS.includes('useUsda'), 'a settings file never turns it on');
  assert.equal(P.TOGGLE_DEFAULTS.useUsda, false);
});

test('a saved reading is usable only while its source\'s switches are on, and is labelled with the database that answered', () => {
  require('../src/engine/db/_module.js');
  const P = require('../src/engine/db/prefs.js');
  const C = require('../src/engine/db/product-cache.js');
  const S = require('../src/engine/db/score-cache.js');
  const t = (useOpenFoodFacts, useUsda) => ({ useOpenFoodFacts, useUsda });
  assert.equal(P.barcodeReadingAllowed('open-food-facts', t(true, false)), true);
  assert.equal(P.barcodeReadingAllowed('open-food-facts', t(false, true)), false);
  assert.equal(P.barcodeReadingAllowed('usda-fdc', t(true, true)), true);
  assert.equal(P.barcodeReadingAllowed('usda-fdc', t(true, false)), false);
  assert.equal(P.barcodeReadingAllowed('usda-fdc', t(false, true)), false);
  assert.equal(P.barcodeReadingAllowed('page', t(false, false)), true);
  assert.equal(P.barcodeReadingAllowed('label-ocr', t(false, false)), true);
  assert.equal(C.barcodeVia({ source: 'usda-fdc' }), 'usda-fdc');
  assert.equal(C.barcodeVia({ ingredients_text: 'x' }), 'open-food-facts');
  assert.equal(C.barcodeVia(null), 'open-food-facts');
  // A saved score read from USDA is retired by either switch; a page-read one by neither.
  assert.notEqual(S.fingerprint(t(true, true), 'usda-fdc'), S.fingerprint(t(true, false), 'usda-fdc'));
  assert.notEqual(S.fingerprint(t(true, true), 'usda-fdc'), S.fingerprint(t(false, true), 'usda-fdc'));
  assert.equal(S.fingerprint(t(true, true), 'page'), S.fingerprint(t(false, false), 'page'));
  // The row round-trips with its source, and the shared tab is not told about a source it cannot check.
  const row = C.fromScan({ store: 'amazon.com', asin: 'B00LOAW7U6', input: { name: 'Chips', ingredients_text: 'potatoes, salt' }, via: 'usda-fdc', confidence: 0.55 });
  assert.equal(row.data.via, 'usda-fdc');
});
