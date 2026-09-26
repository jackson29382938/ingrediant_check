// Exercise the actual service worker with asynchronous, structured-clone storage.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ENDPOINT = 'https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz1234567890/exec';
function worker(initial = {}, fetcher, { alarms, endpoint = ENDPOINT } = {}) {
  const data = structuredClone(initial);
  const synced = {};
  const event = { addListener() {} };
  let created = 0;
  let onMessage = null;
  const badges = [];
  let changed;
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch: fetcher || (async () => { throw new Error('offline'); }),
    chrome: {
      runtime: { id: 'ext', getManifest: () => ({ version: '1.0.0' }), getURL: p => p,
        sendMessage: async () => ({ ok: true }),
        getContexts: async () => [],
        onMessage: { addListener(fn) { onMessage = fn; } },
        onStartup: event, onInstalled: event },
      offscreen: { createDocument: async () => { created++; } },
      alarms: alarms || { create() {}, onAlarm: event },
      action: {
        setBadgeText(opts) { badges.push({ kind: 'text', ...opts }); },
        setBadgeBackgroundColor(opts) { badges.push({ kind: 'color', ...opts }); },
      },
      storage: { onChanged: { addListener(fn) { changed = fn; } }, local: {
        async get(keys) {
          const result = keys == null ? data : Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]));
          return structuredClone(result);
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
      }, sync: {
        async get(keys) { return structuredClone(Object.fromEntries([].concat(keys).map(k => [k, synced[k]]))); },
        async set(values) { Object.assign(synced, structuredClone(values)); },
      } },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/_module.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/allergens.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/categories.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/ingestible.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/prefs.js'), 'utf8'), context);
  // The build constant, pointed at a test URL (or left empty to model an unconfigured build).
  context.AIR.db.prefs.ENDPOINT = endpoint;
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/ocr-text.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/product-cache.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/speed.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/worker/messages.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/worker/sheet-store.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/background.js'), 'utf8'), context);
  return {
    data, synced, call: (expression) => vm.runInContext(expression, context), created: () => created, badges,
    send(msg, sender) {
      return new Promise(resolve => {
        const async = onMessage(msg, sender, resolve);
        if (async !== true) resolve(undefined);
      });
    },
    change: values => {
    for (const [key, value] of Object.entries(values)) data[key] = value.newValue;
    changed(values, 'local');
  } };
}
const enabled = { sendDiagnostics: true, contributeUrl: ENDPOINT };
const amazonTab = { id: 'ext', tab: { id: 3, url: 'https://www.amazon.com/dp/B00LOAW7U6' } };
const settingsSender = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
const popupSender = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };
const offscreenSender = { id: 'ext', url: 'chrome-extension://ext/src/offscreen/ocr.html' };
const label = 'https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg';
test('simultaneous diagnostics preserve every row', async () => {
  const w = worker(enabled);
  await Promise.all(Array.from({ length: 10 }, (_, id) => w.call(`queueDiagnostic({id:${id}})`)));
  assert.deepEqual(w.data.diagQueue.map(r => r.id), Array.from({ length: 10 }, (_, i) => i));
});
test('a row arriving during a successful flush survives', async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const w = worker({ ...enabled, diagQueue: [{ id: 1 }] }, async () => {
    started();
    await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ ok: true, wrote: 1 }) };
  });
  const sending = w.call('flushDiagnostics()');
  await ready;
  const adding = w.call('queueDiagnostic({id:2})');
  release();
  await Promise.all([sending, adding]);
  assert.equal(w.data.diagQueue.length, 1);
  assert.equal(w.data.diagQueue[0].id, 2);
  assert.equal(typeof w.data.diagQueue[0].rowId, 'string');
});
test('disabled diagnostics and master pause prevent queued sends', async () => {
  for (const conf of [{ sendDiagnostics: false }, { enabled: false }]) {
    let requests = 0;
    const w = worker({ ...enabled, ...conf, diagQueue: [{ id: 1 }] }, async () => { requests++; });
    assert.equal((await w.call('flushDiagnostics()')).reason, 'not-enabled');
    assert.equal(requests, 0);
    assert.equal(w.data.diagQueue.length, 1);
  }
});
test('HTTP success without a confirmed write retains the batch', async () => {
  for (const receipt of [{ ok: false }, { ok: true, wrote: 0 }]) {
    const w = worker({ ...enabled, diagQueue: [{ id: 1 }] }, async () => ({ ok: true, json: async () => receipt }));
    assert.equal((await w.call('flushDiagnostics()')).ok, false);
    assert.equal(w.data.diagQueue.length, 1);
  }
});
test('offscreen document can be recreated after Chrome closes it', async () => {
  const w = worker();
  await w.call('ensureOffscreen()');
  await w.call('ensureOffscreen()');
  assert.equal(w.created(), 2);
});
test('queued diagnostics receive a stable row id', async () => {
  const w = worker(enabled);
  await w.call('queueDiagnostic({asin:"B00"})');
  assert.equal(typeof w.data.diagQueue[0].rowId, 'string');
  assert.ok(w.data.diagQueue[0].rowId.length > 4);
});
test('flush posts a batch id and clears after a duplicate acknowledgement', async () => {
  let body;
  const w = worker({ ...enabled, diagQueue: [{ id: 1, rowId: 'r1' }] }, async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ ok: true, wrote: 1, duplicate: true }) };
  });
  assert.equal((await w.call('flushDiagnostics()')).ok, true);
  assert.equal(body.kind, 'diagnostics');
  assert.ok(body.batchId);
  assert.equal(body.rows[0].rowId, 'r1');
  assert.equal(w.data.diagQueue.length, 0);
});
test('stored maps cannot return inherited properties as certifications', () => {
  const w = worker();
  assert.equal(w.call("lookupRecord({byAsin:{},byUpc:{},byBrand:{}}, {brand:'__proto__'})"), null);
  assert.equal(w.call("lookupRecord({byAsin:{},byUpc:{},byBrand:{}}, {brand:'constructor'})"), null);
});
test('pageScore paints and clears the toolbar badge for a tab', () => {
  const w = worker();
  assert.equal(w.call('paintActionBadge(7, 86)'), undefined);
  assert.equal(w.badges.find(b => b.kind === 'text' && b.tabId === 7).text, '86');
  assert.ok(w.badges.find(b => b.kind === 'color' && b.tabId === 7));
  w.call('paintActionBadge(7, null)');
  assert.equal(w.badges.filter(b => b.kind === 'text' && b.tabId === 7).at(-1).text, '');
});

test('master pause blocks every passive background entry point', async () => {
  let requests = 0;
  const w = worker({ enabled: false, ocrLabels: true, useOpenFoodFacts: true, shareContributions: true },
  async () => { requests++; throw new Error('unexpected fetch'); });
  for (const call of ['contribute({})', 'lookupBarcode("12345678")', 'ocrLabels(["image"])',
    'loadProvenance()', 'productsLookup("amazon.com", ["B000000001"])', 'flushProducts()']) await w.call(call);
  assert.equal(requests, 0);
  assert.equal(w.created(), 0);
});
test('contributions and reports require a confirmed single-row write', async () => {
  for (const receipt of [{ ok: false }, { ok: true }, { ok: true, wrote: 0 }, { ok: true, wrote: 1 }]) {
    const w = worker({ shareContributions: true, contributeUrl: enabled.contributeUrl },
      async (_url, opts) => {
        assert.ok(opts.signal);
        return { ok: true, json: async () => receipt };
      });
    const expected = receipt.ok === true && receipt.wrote === 1;
    assert.equal((await w.call('contribute({})')).ok, expected);
    assert.equal((await w.call(`postRecord(${JSON.stringify(enabled.contributeUrl)}, {kind:"report"})`)).ok, expected);
  }
});
test('postRecord rejects non-Apps-Script endpoints even if storage held them', async () => {
  const w = worker({}, async () => { throw new Error('unexpected fetch'); });
  assert.equal((await w.call('postRecord("https://example.test/exec", {kind:"report"})')).ok, false);
  assert.equal((await w.call('postRecord("https://example.test/exec", {kind:"report"})')).reason, 'bad-url');
});
test('pausing aborts an active background response body', async () => {
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const w = worker({ shareContributions: true, contributeUrl: enabled.contributeUrl },
    async (_url, { signal }) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      ready();
    }) }));
  const sending = w.call('contribute({})');
  await started;
  w.change({ enabled: { newValue: false } });
  assert.equal((await sending).ok, false);
});

test('the housekeeping alarm is created once and never re-timed on worker restart', () => {
  const event = { addListener() {} };
  const created = [];
  let existing = null;
  const alarms = { onAlarm: event, get: (name, cb) => cb(existing), create: (name, spec) => { created.push({ name, spec }); existing = { name }; } };
  worker({}, undefined, { alarms });     // first start: nothing scheduled yet
  worker({}, undefined, { alarms });     // restart: alarm exists, must be left alone
  worker({}, undefined, { alarms });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'air-housekeeping');
  assert.equal(created[0].spec.periodInMinutes, 720);
  assert.ok(created[0].spec.delayInMinutes > 0);
});
test('OCR fetch URLs must be Amazon product images', () => {
  const w = worker();
  assert.deepEqual([...w.call(`allowedOcrUrls(${JSON.stringify([label, 'https://www.amazon.com/dp/B00LOAW7U6', 'https://example.test/x.jpg'])})`)], [label]);
  assert.deepEqual([...w.call('allowedOcrUrls(["image"])')], []);
});

test('message allowlist is inverted: page / settings / offscreen / deny-unknown', async () => {
  const w = worker({ ocrLabels: true });
  assert.equal(w.call('allowMessage({type:"ocrLabels"}, {id:"other", tab:{url:"https://www.amazon.com/dp/B00"}})'), false);
  assert.equal(w.call('allowMessage({type:"ocrLabels"}, {id:"ext"})'), false);
  assert.equal(w.call('allowMessage({type:"ocrLabels"}, {id:"ext", tab:{url:"https://example.test/"}})'), false);
  assert.equal(w.call(`allowMessage({type:"ocrLabels"}, ${JSON.stringify(amazonTab)})`), true);
  assert.equal(w.call('allowMessage({type:"flushDiagnostics"}, {id:"ext"})'), false);
  assert.equal(w.call(`allowMessage({type:"flushDiagnostics"}, ${JSON.stringify(settingsSender)})`), true);
  assert.equal(w.call(`allowMessage({type:"flushDiagnostics"}, ${JSON.stringify(popupSender)})`), false);
  assert.equal(w.call(`allowMessage({type:"diagnosticsStatus"}, ${JSON.stringify(popupSender)})`), false);
  assert.equal(w.call(`allowMessage({type:"refreshSheet"}, ${JSON.stringify(amazonTab)})`), false);
  assert.equal(w.call(`allowMessage({type:"accountSave"}, ${JSON.stringify(settingsSender)})`), true);
  assert.equal(w.call(`allowMessage({type:"accountLoad"}, ${JSON.stringify(amazonTab)})`), false);
  assert.equal(w.call(`allowMessage({type:"productsLookup"}, ${JSON.stringify(amazonTab)})`), true);
  assert.equal(w.call(`allowMessage({type:"productsQueue"}, ${JSON.stringify(settingsSender)})`), false);
  assert.equal(w.call(`allowMessage({type:"ocrIdle"}, ${JSON.stringify(offscreenSender)})`), true);
  assert.equal(w.call(`allowMessage({type:"ocrIdle"}, ${JSON.stringify(settingsSender)})`), false);
  assert.equal(w.call('allowMessage({type:"futureType"}, {id:"ext"})'), false);
  assert.equal(w.call('allowMessage({type:"ping"}, {id:"ext"})'), true);
  assert.equal(await w.send({ type: 'ocrLabels', urls: [label] }, { id: 'other', tab: amazonTab.tab }), undefined);
  assert.equal(w.created(), 0);
  const allowed = await w.send({ type: 'ocrLabels', urls: [label] }, amazonTab);
  assert.equal(allowed.ok, true);
  assert.equal(w.created(), 1);
  const blocked = await w.send({ type: 'ocrLabels', urls: ['https://www.amazon.com/dp/B00LOAW7U6'] }, amazonTab);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'no-images');
});


// ---------------------------------------------------------------- shared database (docs/CACHE.md)
const provenanceBody = (rows, producers = [['brand', 'certifications']]) =>
  ({ ok: true, text: async () => JSON.stringify({ ok: true, provenance: rows, producers }) });
const scan = (i, over = {}) => ({ store: 'amazon.com', asin: `B00TEST${String(i).padStart(3, '0')}`, status: 'ok',
  scanned_at: new Date(Date.now() - 1000).toISOString(), pulls: 0,
  data: { title: 'Oats', text: 'Organic rolled oats', via: 'nic-ingredients-content', confidence: 0.98 }, ...over });

test('provenance comes from the endpoint, never from a sheet URL, and revisions follow content', async () => {
  const urls = [];
  const w = worker({}, async url => { urls.push(url); return provenanceBody([['asin', 'certifications'], ['B000000001', 'USDA Organic']]); });
  const value = await w.call('loadProvenance(true)');
  assert.equal(urls[0], `${ENDPOINT}?kind=provenance`);
  assert.equal(value.index.count, 1);
  const first = w.data.sheetIndexRev;
  await w.call('loadProvenance(true)');
  assert.ok(first);
  assert.equal(w.data.sheetIndexRev, first);
  assert.ok(w.data.producerIndexRev);
});
test('offline: an unconfigured build or the shared database switched off makes no request', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return provenanceBody([]); };
  for (const w of [worker({}, fetcher, { endpoint: '' }), worker({ sharedCache: false }, fetcher)]) {
    assert.equal(await w.call('loadProvenance(true)'), null);
    assert.deepEqual({ ...(await w.call('productsLookup("amazon.com", ["B000000001"])')).rows }, {});
    assert.equal((await w.send({ type: 'productsQueue', upserts: [scan(1)] }, amazonTab)).reason, 'not-enabled');
  }
  assert.equal(requests, 0);
  // A hand-edited endpoint that is not an Apps Script /exec URL is never called.
  const bad = worker({}, fetcher, { endpoint: 'https://example.test/exec' });
  assert.equal(await bad.call('loadProvenance(true)'), null);
  assert.equal(requests, 0);
});
test('an oversized or malformed provenance reply keeps the previous copy', async () => {
  let body = provenanceBody([['asin', 'certifications'], ['B000000001', 'USDA Organic']]);
  const w = worker({}, async () => body);
  assert.equal((await w.call('loadProvenance(true)')).index.count, 1);
  body = { ok: true, text: async () => 'x'.repeat(2 * 1024 * 1024 + 1) };
  assert.equal((await w.call('loadProvenance(true)')).index.count, 1);
  body = { ok: true, text: async () => JSON.stringify({ ok: true, provenance: 'nope', producers: [] }) };
  assert.equal((await w.call('loadProvenance(true)')).index.count, 1);
});
// Shared product readings are opt-in (prefs.js sharedProducts).
const sharing = { sharedProducts: true };
test('lookup: one request for all tiles, stale rows dropped, answers memoised', async () => {
  const posts = [];
  const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  const w = worker(sharing, async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push(body);
    return { ok: true, json: async () => ({ ok: true, rows: [scan(1), scan(2, { scanned_at: old }), scan(3, { pulls: 100 }),
      { ...scan(4), data: { text: 'x', via: 'manual-paste' } }] }) };
  });
  const asins = ['B00TEST001', 'B00TEST002', 'B00TEST003', 'B00TEST004', 'B00TEST005'];
  const first = await w.send({ type: 'productsLookup', store: 'amazon.com', asins }, amazonTab);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, 'lookup');
  assert.deepEqual([...posts[0].keys], asins.map(a => `amazon.com:${a}`));
  assert.deepEqual(Object.keys(first.rows), ['B00TEST001']);
  await w.send({ type: 'productsLookup', store: 'amazon.com', asins }, amazonTab);
  assert.equal(posts.length, 1, 'misses and hits are both memoised');
});
test('writes are batched: no POST per tile, one POST when the batch fills, no retry storm', async () => {
  const posts = [];
  const w = worker(sharing, async (url, init) => {
    posts.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, wrote: 1, tab: 'products' }) };
  });
  for (let i = 0; i < 24; i++) await w.send({ type: 'productsQueue', upserts: [scan(i)] }, amazonTab);
  assert.equal(posts.length, 0);
  assert.equal((await w.send({ type: 'productsQueue', upserts: [scan(24)] }, amazonTab)).sent, 25);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, 'products');
  assert.equal(posts[0].upserts.length, 25);
  assert.equal(typeof posts[0].upserts[0].data.text, 'string');
  assert.equal(w.data.productsQueue, undefined);
  const down = worker(sharing, async () => { posts.push('down'); return { ok: false }; });
  for (let i = 0; i < 30; i++) await down.send({ type: 'productsQueue', upserts: [scan(i)] }, amazonTab);
  assert.equal(posts.filter(p => p === 'down').length, 1, 'a failed send must not retry on every tile');
  // An older deployment files unknown kinds as a contribution; that is not a delivery.
  const old = worker(sharing, async () => ({ ok: true, json: async () => ({ ok: true, wrote: 1, tab: 'contributions' }) }));
  for (let i = 0; i < 25; i++) await old.send({ type: 'productsQueue', upserts: [scan(i)] }, amazonTab);
  assert.equal(Object.keys(old.data.productsQueue.upserts).length, 25);
});
test('install drops the pasted-URL era keys', async () => {
  const w = worker({ sheetUrl: 'x', producersUrl: 'y', contributeUrl: ENDPOINT, syncSettings: true, ratingsQueue: {}, weights: { sugar: 2 } });
  w.call('dropLegacy()');
  await new Promise(r => setTimeout(r, 0));
  for (const k of ['sheetUrl', 'producersUrl', 'contributeUrl', 'syncSettings', 'ratingsQueue']) assert.equal(k in w.data, false, k);
  assert.deepEqual(w.data.weights, { sugar: 2 });
});

// ---------------------------------------------------------------- settings online (docs/SETTINGS-SYNC.md)
test('settings back up to the Chrome account, sanitized and split under the 8 KB item cap', async () => {
  const w = worker({ weights: { sugar: 1.4, notACategory: 9 }, allergens: ['milk', 'nope'], avoidList: ['red 40'],
    hoverScore: true, enabled: false, email: 'person@example.com' });
  assert.equal((await w.call('backupToChrome()')).ok, true);
  const main = w.synced.icBackup;
  assert.equal(main._format, 'ingredient-check-settings');
  assert.equal(main.weights.sugar, 1.4);
  assert.equal(main.weights.notACategory, undefined);
  assert.deepEqual(main.allergens, ['milk']);
  assert.equal(main.toggles.hoverScore, true);
  assert.equal('enabled' in main.toggles, false, 'the master switch is never backed up');
  assert.equal(main.email, undefined);
  assert.deepEqual(w.synced.icBackupAvoid, ['red 40']);
  const off = worker({ settingsBackup: false });
  assert.equal((await off.call('backupToChrome()')).reason, 'not-enabled');
  assert.equal(off.synced.icBackup, undefined);
});
test('a backup is never applied on its own: local settings stay in force', async () => {
  const w = worker({ weights: { sugar: 2 } });
  w.synced.icBackup = { _format: 'ingredient-check-settings', weights: { sugar: 0 }, toggles: {} };
  w.change({ weights: { newValue: { sugar: 1.5 } } });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(w.data.weights, { sugar: 1.5 });
});
test('account save and restore carry a token and the sanitized backup only', async () => {
  const bodies = [];
  const payload = { _format: 'ingredient-check-settings', weights: { sugar: 0.3 }, allergens: ['soy', 'bogus'],
    avoidList: ['carrageenan'], toggles: { hoverScore: true, enabled: false }, contributeUrl: 'https://evil.example' };
  const w = worker({ weights: { sugar: 1.2 }, allergens: ['milk'] }, async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return { ok: true, json: async () => body.kind === 'account'
      ? { ok: true, wrote: 1, tab: 'accounts' } : { ok: true, payload } };
  });
  const token = 'ya29.' + 'a'.repeat(40);
  assert.equal((await w.send({ type: 'accountSave', token }, settingsSender)).ok, true);
  assert.equal(bodies[0].kind, 'account');
  assert.equal(bodies[0].token, token);
  assert.equal(bodies[0].payload.weights.sugar, 1.2);
  assert.equal((await w.send({ type: 'accountLoad', token }, settingsSender)).ok, true);
  assert.equal(bodies[1].kind, 'accountGet');
  assert.equal(w.data.weights.sugar, 0.3);
  assert.deepEqual(w.data.allergens, ['soy']);
  assert.equal(w.data.hoverScore, true);
  assert.equal(w.data.enabled, undefined, 'a restore never touches the master switch');
  assert.equal(w.data.contributeUrl, undefined);
  assert.equal((await w.send({ type: 'accountSave', token: 'short' }, settingsSender)).ok, false);
  assert.equal(bodies.length, 2);
});

test('only the settings page can send settings messages; the popup and pages cannot', async () => {
  let posts = 0;
  const w = worker({ ...enabled, diagQueue: [{ id: 1, rowId: 'r1' }] }, async () => {
    posts++;
    return { ok: true, json: async () => ({ ok: true, wrote: 1 }) };
  });
  const otherExtension = { id: 'other', url: 'chrome-extension://other/src/options/options.html' };
  for (const sender of [popupSender, amazonTab, offscreenSender, otherExtension, { id: 'ext' }]) {
    assert.equal(await w.send({ type: 'flushDiagnostics' }, sender), undefined, JSON.stringify(sender));
  }
  assert.equal(posts, 0, 'a rejected sender still reached the endpoint');
  assert.equal(w.data.diagQueue.length, 1);
  // Every settings message has one caller, the settings page, and only it is accepted.
  const setupSender = { id: 'ext', url: 'chrome-extension://ext/src/options/welcome.html' };
  for (const type of ['flushDiagnostics', 'diagnosticsStatus', 'refreshSheet', 'accountSave', 'accountLoad']) {
    assert.equal(w.call(`allowMessage({type:"${type}"}, ${JSON.stringify(settingsSender)})`), true, type);
    for (const other of [popupSender, setupSender]) {
      assert.equal(w.call(`allowMessage({type:"${type}"}, ${JSON.stringify(other)})`), false, `${type} from ${other.url}`);
    }
  }
  const res = await w.send({ type: 'flushDiagnostics' }, settingsSender);
  assert.equal(res.ok, true);
  assert.equal(res.sent, 1);
  assert.equal(posts, 1);
  assert.equal(w.data.diagQueue.length, 0);
});

test('the sender rule does not stop the alarm flush or a full batch', async () => {
  let alarm = null;
  const alarms = { onAlarm: { addListener(fn) { alarm = fn; } }, get: (name, cb) => cb({ name }), create() {} };
  const bodies = [];
  const fetcher = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    return { ok: true, json: async () => ({ ok: true, wrote: body.rows ? body.rows.length : 1 }) };
  };
  const w = worker({ ...enabled, diagQueue: [{ id: 1, rowId: 'r1' }] }, fetcher, { alarms });
  alarm({ name: 'air-housekeeping' });
  for (let i = 0; i < 20 && w.data.diagQueue.length; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(w.data.diagQueue.length, 0, 'the housekeeping alarm no longer flushed');
  assert.equal(bodies.filter(b => b.kind === 'diagnostics').length, 1);
  // A page's twelfth row flushes from inside the worker, whoever the page is.
  for (let i = 0; i < 12; i++) await w.send({ type: 'diagnostic', record: { id: i } }, amazonTab);
  assert.equal(bodies.filter(b => b.kind === 'diagnostics').length, 2);
  assert.equal(w.data.diagQueue.length, 0);
});

test('the housekeeping sweep keeps scores and readings as long as the speed setting says', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const ages = { fastest: 90, fast: 60, balanced: 30, fresh: 7, freshest: 1 };
  for (const [speedMode, days] of Object.entries(ages)) {
    const before = { t: now - (days - 0.5) * DAY };
    const after = { t: now - (days + 0.5) * DAY };
    const w = worker({
      speedMode,
      's:amazon.com:B000000001': before, 'p:amazon.com:B000000001': before,
      's:amazon.com:B000000002': after, 'p:amazon.com:B000000002': after,
      // Open Food Facts records keep their own month whatever the speed.
      'off:0000000000017': { t: now - 29 * DAY }, 'off:0000000000024': { t: now - 31 * DAY },
    });
    await w.call(`sweepCache(${now})`);
    const kept = Object.keys(w.data).filter(k => k !== 'speedMode').sort();
    assert.deepEqual(kept, ['off:0000000000017', 'p:amazon.com:B000000001', 's:amazon.com:B000000001'],
      `${speedMode}: keeps ${days} days`);
  }
  // No speed saved yet: Balanced, 30 days.
  const w = worker({ 's:amazon.com:B000000001': { t: now - 45 * DAY }, 'p:amazon.com:B000000002': { t: now - 20 * DAY } });
  await w.call(`sweepCache(${now})`);
  assert.deepEqual(Object.keys(w.data), ['p:amazon.com:B000000002']);
});

test('shared product readings stay off until the reader turns them on', async () => {
  const posts = [];
  const fetcher = async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, rows: [], wrote: 1, tab: 'products' }) }; };
  // Default, and an install that saved the old on-by-default sharedCache: no lookup, nothing queued.
  for (const initial of [{}, { sharedCache: true }]) {
    const w = worker(initial, fetcher);
    assert.equal(JSON.stringify(await w.send({ type: 'productsLookup', store: 'amazon.com', asins: ['B00TEST001'] }, amazonTab)), '{"rows":{}}');
    for (let i = 0; i < 30; i++) await w.send({ type: 'productsQueue', upserts: [scan(i)] }, amazonTab);
    assert.equal(w.data.productsQueue, undefined);
    await w.call('flushProducts()');
  }
  assert.equal(posts.length, 0);
  // The certification tables still count as the shared database; switching it off wins over the opt-in.
  const off = worker({ sharedProducts: true, sharedCache: false }, fetcher);
  assert.equal(JSON.stringify(await off.send({ type: 'productsLookup', store: 'amazon.com', asins: ['B00TEST001'] }, amazonTab)), '{"rows":{}}');
  assert.equal(posts.length, 0);
});

test('turning shared product readings off drops what was waiting to upload', async () => {
  const w = worker({ sharedProducts: true }, async () => ({ ok: false }));
  await w.send({ type: 'productsQueue', upserts: [scan(1)] }, amazonTab);
  assert.ok(w.data.productsQueue);
  w.change({ sharedProducts: { oldValue: true, newValue: false } });
  await w.call('productsWork');
  assert.equal(w.data.productsQueue, undefined);
});

test('Open Food Facts: simultaneous lookups for one barcode send one request', async () => {
  const gets = [];
  let answer;
  const product = { product: { product_name: 'Kefir', ingredients_text: 'cultured milk', product_type: 'food', categories_tags: ['en:dairies'] } };
  const w = worker({ useOpenFoodFacts: true }, url => {
    gets.push(url);
    return new Promise(resolve => { answer = () => resolve({ ok: true, json: async () => product }); });
  });
  const first = w.send({ type: 'lookupBarcode', code: '0012345678905' }, amazonTab);
  const second = w.send({ type: 'lookupBarcode', code: '0012345678905', foodOnly: false }, amazonTab);
  for (let i = 0; i < 10 && !answer; i++) await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(gets.length, 1, 'the second caller joins the first request');
  answer();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ingredients_text, 'cultured milk');
  assert.equal(b.ingredients_text, 'cultured milk');
  assert.ok(w.data['off:0012345678905'], 'cached once');
  await w.send({ type: 'lookupBarcode', code: '0012345678905' }, amazonTab);
  assert.equal(gets.length, 1, 'then answered from the cache');
});

test('Open Food Facts: a failed lookup is not remembered, and the food check stays per caller', async () => {
  let calls = 0;
  const shampoo = { product: { product_name: 'Shampoo', ingredients_text: 'aqua, sodium laureth sulfate', product_type: 'beauty' } };
  const w = worker({ useOpenFoodFacts: true }, async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { ok: true, json: async () => shampoo };
  });
  assert.equal(await w.send({ type: 'lookupBarcode', code: '0012345678912' }, amazonTab), null);
  const [gated, open] = await Promise.all([
    w.send({ type: 'lookupBarcode', code: '0012345678912' }, amazonTab),
    w.send({ type: 'lookupBarcode', code: '0012345678912', foodOnly: false }, amazonTab),
  ]);
  assert.equal(calls, 2, 'retried after the failure, once for both callers');
  assert.equal(gated.rejected, 'not-food');
  assert.equal(open.name, 'Shampoo');
});

test('toolbar badge colours keep white text readable (WCAG AA, 4.5:1)', () => {
  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const w = worker({});
  for (const score of [96, 80, 60, 30, 5]) {
    const bg = w.call(`badgeColor(${score})`);
    assert.ok(contrast('#ffffff', bg) >= 4.5, `score ${score}: white on ${bg} is ${contrast('#ffffff', bg).toFixed(2)}:1`);
  }
  for (const bg of ['#767676', '#565959']) assert.ok(contrast('#ffffff', bg) >= 4.5, bg);
});
