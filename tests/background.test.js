// Exercise the actual service worker with asynchronous, structured-clone storage.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadWorker } = require('./worker-scripts.js');
const ENDPOINT = 'https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz1234567890/exec';
function worker(initial = {}, fetcher, { alarms, endpoint = ENDPOINT, productsAllowed = true, offPermission = true, badgeTexts, badgeReader, paletteRead, getKeys } = {}) {
  const data = structuredClone(initial);
  const reads = [];
  const synced = {};
  const event = { addListener() {} };
  let created = 0;
  let onMessage = null;
  const badges = [];
  let changed;
  let syncFailure = false;
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch: fetcher || (async () => { throw new Error('offline'); }),
    chrome: {
      runtime: { id: 'ext', getManifest: () => ({ version: '1.0.0' }), getURL: p => `chrome-extension://ext/${p}`,
        sendMessage: async () => ({ ok: true }),
        getContexts: async () => [],
        onMessage: { addListener(fn) { onMessage = fn; } },
        onStartup: event, onInstalled: event },
      permissions: { contains: async () => offPermission },
      offscreen: { createDocument: async () => { created++; } },
      alarms: alarms || { create() {}, clear() {}, onAlarm: event },
      action: {
        setBadgeText(opts) { badges.push({ kind: 'text', ...opts }); },
        setBadgeBackgroundColor(opts) { badges.push({ kind: 'color', ...opts }); },
        setBadgeTextColor(opts) { badges.push({ kind: 'textColor', ...opts }); },
        getBadgeText: async opts => badgeReader ? badgeReader(opts) : badgeTexts?.[opts.tabId] || '',
      },
      tabs: badgeTexts ? { query: async () => Object.keys(badgeTexts).map(id => ({ id: Number(id) })), onRemoved: event } : undefined,
      storage: { onChanged: { addListener(fn) { changed = fn; } }, local: {
        ...(getKeys ? { async getKeys() { return Object.keys(data); } } : {}),
        async get(keys) {
          reads.push(keys);
          if (keys === 'palette' && paletteRead) return paletteRead();
          const result = keys == null ? data : Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]));
          return structuredClone(result);
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
      }, sync: {
        async get(keys) { return structuredClone(Object.fromEntries([].concat(keys).map(k => [k, synced[k]]))); },
        async set(values) { if (typeof syncFailure === 'function' ? syncFailure(values) : syncFailure) throw new Error('quota'); Object.assign(synced, structuredClone(values)); },
      } },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  // Exactly the scripts the worker imports, in its order. The build constant is pointed at a test
  // URL (or left empty to model an unconfigured build) once prefs.js has defined it.
  loadWorker(vm, context, { before: () => { if (context.AIR?.db?.prefs) { context.AIR.db.prefs.ENDPOINT = endpoint; context.AIR.db.prefs.SHARED_PRODUCTS_ALLOWED = productsAllowed; } } });
  return {
    failSync: value => { syncFailure = value; },
    data, synced, reads, call: (expression) => vm.runInContext(expression, context), created: () => created, badges,
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
test('diagnostic outcomes require a compatible backend before any row is uploaded', async () => {
  for (const status of [{ ok: true, service: 'ingredient-check' }, { ok: true, service: 'other', diagnosticsSchema: 2 }]) {
    let posts = 0;
    const w = worker({ ...enabled, diagQueue: [{ outcome: 'unreadable' }] }, async (_url, options) => {
      if (options.method === 'POST') posts++;
      return { ok: true, json: async () => status };
    });
    const reply = await w.call('flushDiagnostics()'); assert.equal(reply.reason, 'backend-update-required');
    assert.equal(posts, 0); assert.equal(w.data.diagQueue.length, 1); assert.equal(w.data.diagLastError, 'backend-update-required');
  }
});
test('new diagnostics clear only after a schema-aware receipt and retain stable IDs on retry', async () => {
  let receiptSchema = 0, gets = 0; const bodies = [];
  const w = worker({ ...enabled, diagQueue: [{ outcome: 'wrong-score', feedback: 'looks-wrong' }] }, async (_url, options) => {
    if (options.method !== 'POST') { gets++; return { ok: true, json: async () => ({ ok: true, service: 'ingredient-check', diagnosticsSchema: 2 }) }; }
    bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, wrote: 1, diagnosticsSchema: receiptSchema }) };
  });
  assert.equal((await w.call('flushDiagnostics()')).ok, false); assert.equal(w.data.diagQueue.length, 1);
  receiptSchema = 2; assert.equal((await w.call('flushDiagnostics()')).ok, true);
  assert.equal(gets, 1); assert.equal(bodies[0].diagnosticsSchema, 2);
  assert.equal(bodies[0].rows[0].rowId, bodies[1].rows[0].rowId); assert.equal(w.data.diagQueue.length, 0);
});
test('updating an old diagnostic backend can be retried immediately without losing queued outcomes', async () => {
  let schema = 0, gets = 0;
  const w = worker({ ...enabled, diagQueue: [{ outcome: 'unreadable' }] }, async (_url, options) => {
    if (options.method !== 'POST') { gets++; return { ok: true, json: async () => ({ service: 'ingredient-check', diagnosticsSchema: schema }) }; }
    return { ok: true, json: async () => ({ ok: true, wrote: 1, diagnosticsSchema: 2 }) };
  });
  assert.equal((await w.call('flushDiagnostics()')).reason, 'backend-update-required'); schema = 2;
  assert.equal((await w.call('flushDiagnostics()')).ok, true); assert.equal(gets, 2); assert.equal(w.data.diagLastError, '');
});
test('turning diagnostics off during a capability check prevents the pending upload', async () => {
  let release, started, posts = 0; const ready = new Promise(resolve => { started = resolve; });
  const w = worker({ ...enabled, diagQueue: [{ outcome: 'unreadable' }] }, async (_url, options) => {
    if (options.method === 'POST') posts++;
    started(); await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ service: 'ingredient-check', diagnosticsSchema: 2 }) };
  });
  const pending = w.call('flushDiagnostics()'); await ready; w.data.sendDiagnostics = false; release();
  assert.equal((await pending).reason, 'not-enabled'); assert.equal(posts, 0); assert.equal(w.data.diagQueue.length, 1);
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

test('a personal-care index paints the toolbar badge in its score\'s band, as a food score does', () => {
  const w = worker();
  w.call('paintActionBadge(7, 86, undefined, true)');
  w.call('paintActionBadge(8, 86)');
  const colorOf = tab => w.badges.filter(b => b.kind === 'color' && b.tabId === tab).at(-1).color;
  assert.notEqual(colorOf(7), '#565959', 'an index is no longer drawn in gray');
  assert.equal(colorOf(7), colorOf(8), 'the same score is the same color, food or not');
  w.call('paintActionBadge(9, 40, undefined, true)');
  assert.notEqual(colorOf(9), colorOf(7), 'and a lower score is a lower band');
  w.call('refreshActionBadges()');
  assert.equal(colorOf(7), colorOf(8));
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
  data: { inputSchema: 1, title: 'Oats', text: 'Organic rolled oats', advisory_text: '', via: 'nic-ingredients-content', confidence: 0.98 }, ...over });

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
  assert.deepEqual(JSON.parse(w.call('JSON.stringify(self.AIR.db.prefs.fromSyncItems(' + JSON.stringify(w.synced) + ').values.avoidList)')), ['red 40']);
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
      assert.equal(w.call(`allowMessage({type:"${type}"}, ${JSON.stringify(other)})`), type === 'accountSave' && other === setupSender, `${type} from ${other.url}`);
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
    const after = { t: now - (days + 7.5) * DAY };
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
    const bg = w.call(`self.AIR.db.theme.toolbar(${score}).bg`);
    assert.ok(contrast('#ffffff', bg) >= 4.5, `score ${score}: white on ${bg} is ${contrast('#ffffff', bg).toFixed(2)}:1`);
  }
  for (const bg of ['#767676', '#565959']) assert.ok(contrast('#ffffff', bg) >= 4.5, bg);
});

test('Open Food Facts: allergen markup (_WHEAT_) is stripped from the text the page shows and saves', async () => {
  const product = { product: { product_name: 'Crackers', ingredients_text_en: '_WHEAT_ flour, palm oil, _EGG_', product_type: 'food', categories_tags: ['en:snacks'] } };
  const w = worker({ useOpenFoodFacts: true }, async () => ({ ok: true, json: async () => product }));
  const got = await w.send({ type: 'lookupBarcode', code: '0012345678929' }, amazonTab);
  assert.equal(got.ingredients_text, 'WHEAT flour, palm oil, EGG');
});

test('backup stages alternate banks, preserves the last copy on failure, and records recovery', async () => {
  const w = worker({ avoidList: ['milk'], speedMode: 'freshest', sortCount: 500 });
  assert.equal((await w.call('backupToChrome()')).ok, true);
  const saved = structuredClone(w.synced);
  w.data.avoidList = Array.from({length:80}, (_,i) => String(i).padEnd(80, '漢'));
  w.failSync(true);
  assert.equal((await w.call('backupToChrome()')).ok, false);
  assert.deepEqual(w.synced, saved);
  assert.equal(w.data.backupStatus.ok, false);
  w.failSync(false);
  await Promise.all([w.call('backupToChrome()'), w.call('backupToChrome()')]);
  assert.equal(w.data.backupStatus.ok, true);
  const restored = JSON.parse(w.call('JSON.stringify(self.AIR.db.prefs.fromSyncItems(' + JSON.stringify(w.synced) + '))'));
  assert.equal(restored.values.avoidList.length, 80);
  assert.equal(restored.values.speedMode, 'freshest');
});
test('Google save requires confirmed account receipt; restore sanitizes without persisting the token', async () => {
  let payload;
  const w = worker({ goals: ['weightLoss'], speedMode: 'freshest', sortLoadMore: true }, async (_url, opts) => {
    const req = JSON.parse(opts.body); payload = req.payload;
    return {ok:true,json:async()=>req.kind === 'account' ? {ok:true,tab:'accounts'}
      : {ok:true,payload:{_format:'ingredient-check-settings',weights:{sugar:9},workflow:{speedMode:'freshest',sortCount:500},toggles:{enabled:false}}}};
  });
  const token = 'a'.repeat(30);
  assert.equal((await w.call(`accountSave('${token}')`)).ok, true);
  assert.equal(payload.workflow.speedMode, 'freshest');
  assert.equal((await w.call(`accountLoad('${token}')`)).ok, true);
  assert.equal(w.data.weights.sugar, 2);
  assert.equal(w.data.sortCount, 500);
  assert.equal(w.data.enabled, undefined);
  assert.ok(!JSON.stringify(w.data).includes(token));
});

test('failed pointer commit leaves the prior backup readable after staged parts were written', async () => {
  const w = worker({avoidList:['milk']});
  await w.call('backupToChrome()');
  const pointer = structuredClone(w.synced.icBackup);
  w.data.avoidList = ['soy'];
  w.failSync(values => Object.hasOwn(values, 'icBackup'));
  assert.equal((await w.call('backupToChrome()')).ok, false);
  assert.deepEqual(w.synced.icBackup, pointer);
  const previous = JSON.parse(w.call('JSON.stringify(self.AIR.db.prefs.fromSyncItems(' + JSON.stringify(w.synced) + '))'));
  assert.deepEqual(previous.values.avoidList, ['milk']);
});

test('closed build prevents shared product reads and writes even with a saved opt-in', async () => {
  let calls = 0;
  const w = worker({sharedProducts:true, sharedCache:true}, async () => { calls++; throw new Error('network'); }, {productsAllowed:false});
  assert.equal(await w.call('sharedProductsEndpoint()'), '');
  await w.call("productsLookup('amazon.com', ['B00LOAW7U6'])");
  assert.equal(calls, 0);
});

test('barcode lookup never contacts Open Food Facts without its Chrome host permission', async () => {
  let requests = 0;
  const w = worker({}, async () => { requests++; throw new Error('must not fetch'); }, { offPermission: false });
  assert.equal(await w.call('lookupBarcode("12345678")'), null);
  assert.equal(requests, 0);
});

test('retailer previews can update toolbar scores but cannot invoke network or account handlers', () => {
  const w = worker();
  for (const host of ['www.target.com', 'target.com', 'www.walmart.com', 'walmart.com', 'www.costco.com', 'costco.com']) {
    const sender = { id: 'ext', tab: { url: `https://${host}/p/oats` } };
    assert.equal(w.call(`allowMessage({type:"pageScore"}, ${JSON.stringify(sender)})`), true);
    for (const type of ['ocrLabels', 'lookupBarcode', 'productsLookup', 'productsQueue', 'diagnostic', 'accountSave', 'accountLoad']) {
      assert.equal(w.call(`allowMessage({type:"${type}"}, ${JSON.stringify(sender)})`), false, `${type} on ${host}`);
    }
  }
  assert.equal(w.call('allowMessage({type:"pageScore"}, {id:"ext", tab:{url:"https://sameday.costco.com/p/oats"}})'), false);
});

test('disabling Chrome backup during staging preserves the last committed copy', async () => {
  const w = worker({ settingsBackup: true, avoidList: ['palm oil'] });
  assert.equal((await w.call('backupToChrome()')).ok, true);
  const old = structuredClone(w.synced.icBackup);
  w.data.avoidList = ['natural flavors'];
  w.failSync(values => {
    if (!values.icBackup) w.data.settingsBackup = false;
    return false;
  });
  const result = await w.call('backupToChrome()');
  assert.equal(result.reason, 'not-enabled');
  assert.deepEqual(w.synced.icBackup, old);
});

// Palette integration exercises the worker's actual startup/storage/message paths.
const settleBadges = () => new Promise(resolve => setImmediate(resolve));
test('toolbar uses stored colour-blind palette and readable text at all five band thresholds', async () => {
  const w = worker({ palette: 'cvd' }); await settleBadges();
  for (const score of [100, 90, 89, 75, 74, 50, 49, 25, 24, 0]) {
    await w.send({ type: 'pageScore', score }, amazonTab);
    const expected = w.call(`self.AIR.db.theme.toolbar(${score}, 'cvd')`);
    assert.equal(w.badges.filter(b => b.kind === 'color').at(-1).color, expected.bg);
    assert.equal(w.badges.filter(b => b.kind === 'textColor').at(-1).color, expected.fg);
    assert.ok(w.call(`self.AIR.db.theme.contrast('${expected.bg}', '${expected.fg}')`) >= 4.5);
  }
});
test('palette changes repaint existing tab badges without another page-score message', async () => {
  const w = worker({ palette: 'standard' }); await settleBadges();
  w.call('paintActionBadge(7, 89.8)'); w.call('paintActionBadge(8, null, "fail")');
  const old = w.badges.filter(b => b.kind === 'color' && b.tabId === 7).at(-1).color;
  w.change({ palette: { newValue: 'cvd' } }); await settleBadges();
  assert.notEqual(w.badges.filter(b => b.kind === 'color' && b.tabId === 7).at(-1).color, old);
  assert.equal(w.badges.filter(b => b.kind === 'color' && b.tabId === 7).at(-1).color, w.call('self.AIR.db.theme.toolbar(89.8, "cvd").bg'), 'keep the exact band despite rounding text');
  assert.equal(w.badges.filter(b => b.kind === 'text' && b.tabId === 8).at(-1).text, '?');
  assert.equal(w.badges.filter(b => b.kind === 'color' && b.tabId === 8).at(-1).color, '#767676');
  const count = w.badges.length;
  w.change({ accent: { newValue: '#ff0000' }, theme: { newValue: 'dark' } }); await settleBadges();
  assert.equal(w.badges.length, count, 'theme/accent do not change toolbar score bands');
});
test('worker restart recovers numeric badges already held by Chrome without rescanning or persisting tab records', async () => {
  const w = worker({ palette: 'cvd' }, undefined, { badgeTexts: { 7: '95', 8: '?', 9: '–', 10: '', 11: 'invalid' } });
  await settleBadges();
  assert.deepEqual(w.badges.filter(b => b.kind === 'color').map(b => b.tabId), [7]);
  assert.equal(w.badges.find(b => b.kind === 'color').color, w.call('self.AIR.db.theme.toolbar(95, "cvd").bg'));
  assert.deepEqual(Object.keys(w.data), ['palette'], 'no browsing metadata is saved');
});
test('a pending Chrome badge read cannot resurrect a cleared or newly scored badge', async () => {
  for (const newer of [null, 30]) {
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const w = worker({ palette: 'cvd' }, undefined, { badgeTexts: { 7: '95' }, badgeReader: () => waiting });
    await settleBadges();
    w.call(`paintActionBadge(7, ${newer})`); release('95'); await settleBadges();
    assert.equal(w.badges.filter(b => b.kind === 'text' && b.tabId === 7).at(-1).text, newer == null ? '' : '30');
  }
});
test('a late startup settings read cannot replace a newly selected toolbar palette', async () => {
  let release;
  const initial = new Promise(resolve => { release = resolve; });
  const w = worker({}, undefined, { paletteRead: () => initial });
  w.call('paintActionBadge(7, 95)'); w.change({ palette: { newValue: 'cvd' } });
  release({ palette: 'standard' }); await settleBadges();
  assert.equal(w.badges.filter(b => b.kind === 'color' && b.tabId === 7).at(-1).color, w.call('self.AIR.db.theme.toolbar(95, "cvd").bg'));
});

test('automatic Google backup checks token identity and consent after authentication', async () => {
  for (const mode of ['different-account', 'disabled', 'signed-out', 'same-account']) {
    let posts = 0;
    const w = worker({ googleProfile: { email: 'a@example.com' }, googleLinked: true, googleAutoSave: true }, async () => {
      posts++; return { ok: true, json: async () => ({ ok: true, tab: 'accounts' }) };
    });
    w.call(`self.AIR.googleAuth.token = async () => 'a'.repeat(30); self.AIR.googleAuth.profile = async () => ({email: '${mode === 'different-account' ? 'b' : 'a'}@example.com'})`);
    if (mode === 'disabled') w.call("self.AIR.googleAuth.token = async () => { await chrome.storage.local.set({googleAutoSave:false}); return 'a'.repeat(30); }");
    if (mode === 'signed-out') w.call("self.AIR.googleAuth.token = async () => { await chrome.storage.local.remove('googleProfile'); return 'a'.repeat(30); }");
    const result = await w.call('googleSaveOnce()');
    assert.equal(posts, mode === 'same-account' ? 1 : 0, mode);
    assert.equal(result.ok, mode === 'same-account', mode);
  }
});

test('housekeeping retains both readings and scores throughout recall grace', async () => {
  const now = Date.now(), day = 86400000;
  const w = worker({ speedMode: 'freshest', cacheGraceDays: 7, 's:amazon.com:B000000001': {t:now-2*day}, 'p:amazon.com:B000000001': {t:now-2*day}, 's:amazon.com:B000000002': {t:now-9*day} });
  await w.call(`sweepCache(${now})`);
  assert.ok(w.data['s:amazon.com:B000000001']); assert.ok(w.data['p:amazon.com:B000000001']); assert.equal(w.data['s:amazon.com:B000000002'], undefined);
});

test('purchase sync uploads only records that differ from the remote copy', async () => {
  const row={key:'a'.repeat(64),store:'amazon.com',asin:'B000000001',date:'2026-09-01',state:'purchased',name:'Oats',score:98,profile:'b'.repeat(64),version:'1.17.1',ingredients:'oats',flags:[],scoredAt:10000,observedAt:10000};
  const clean=require('../src/engine/db/purchase-history.js').clean(row);let puts=0;
  const w=worker({historyEnabled:true,historyAutoSync:true,historyOwner:'a@example.com',googleProfile:{email:'a@example.com'},purchaseHistory:[clean]},async (_url,opts)=>{
    if(opts.method!=='POST')return{ok:true,json:async()=>({history:true,historySchema:1,historyCapacity:10000})};
    const body=JSON.parse(opts.body);
    if(body.kind==='historyGet')return{ok:true,json:async()=>({ok:true,kind:'historyGet',records:[clean],account:'c'.repeat(64),clearedAt:0})};
    assert.equal(body.kind,'historyPut');puts++;return{ok:true,json:async()=>({ok:true,kind:'historyPut'})};
  });
  w.call("self.AIR.googleAuth.profile=async()=>({email:'a@example.com'})");
  assert.equal((await w.call("self.AIR.historyWorker.sync('a'.repeat(30),true)")).ok,true);assert.equal(puts,0);
  w.data.purchaseHistory=[{...clean,name:'Updated oats',observedAt:20000}];
  assert.equal((await w.call("self.AIR.historyWorker.sync('a'.repeat(30),true)")).ok,true);assert.equal(puts,1);
});

test('search following requires an open view, enabled preference and the original source tab', async () => {
  const url='https://www.amazon.com/s?k=milk',old='https://www.amazon.com/s?k=oats';
  const w=worker({});
  w.call(`self.__session={sortedResults:{runId:'old',sourceTabId:3,sourceUrl:'${old}',mode:'health',items:[{score:90}],loading:false}};chrome.storage.session={get:async()=>self.__session,set:async v=>Object.assign(self.__session,v)}`);
  const sender={id:'ext',frameId:0,url,tab:{id:3,url}};
  assert.equal((await w.call(`followSortedSearch({sourceUrl:'${url}'},${JSON.stringify(sender)})`)).ok,false);
  w.call('sortedViews.add({})');
  assert.equal((await w.call(`followSortedSearch({sourceUrl:'${url}'},${JSON.stringify({...sender,tab:{id:8,url}})})`)).ok,false);
  w.data.sortFollowSearch=false;
  assert.equal((await w.call(`followSortedSearch({sourceUrl:'${url}'},${JSON.stringify(sender)})`)).ok,false);
  w.data.sortFollowSearch=true;
  const replies=await w.call(`Promise.all([followSortedSearch({sourceUrl:'${url}',priceOnly:true},${JSON.stringify(sender)}),followSortedSearch({sourceUrl:'${url}',priceOnly:true},${JSON.stringify(sender)})])`);
  assert.equal(replies.filter(r=>r.ok).length,1);
  const list=w.call('self.__session.sortedResults');assert.equal(list.sourceUrl,url);assert.equal(list.items.length,0);assert.equal(list.mode,'unitPrice');assert.equal(list.priceOnly,true);
});

// ---------------------------------------------------------------- replies, trail, sweep, history import

// Values built inside the worker's VM carry its prototypes; compare them as data.
const plain = value => JSON.parse(JSON.stringify(value === undefined ? null : value));
const within = (ms, promise, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no reply to ${what} within ${ms} ms`)), ms))]);

// A handler that returns true owes its sender a reply. `work().then(reply)` answered nobody when the work
// rejected (a storage error outside a try block), and the sender waited until Chrome stopped the worker.
test('a handler whose work fails still answers its sender, and leaves a trace', async () => {
  const w = worker({ useOpenFoodFacts: true, ocrLabels: true, shareContributions: true, sendDiagnostics: true, contributeUrl: ENDPOINT });
  w.call('chrome.storage.local.get = async () => { throw new Error("storage unavailable"); }');
  const warned = [], warn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    const cases = [
      [{ type: 'lookupBarcode', code: '0012345678905' }, null],
      [{ type: 'ocrLabels', urls: [label] }, { ok: false, reason: 'worker-error' }],
      [{ type: 'provenanceLookup', key: { asin: 'B00LOAW7U6' } }, null],
      [{ type: 'contribute', payload: {} }, { ok: false, reason: 'worker-error' }],
      [{ type: 'diagnostic', record: { id: 1 } }, { ok: false, reason: 'worker-error' }],
      [{ type: 'productsLookup', store: 'amazon.com', asins: ['B000000001'] }, { rows: {} }],
      [{ type: 'productsQueue', upserts: [] }, { ok: false }],
    ];
    for (const [msg, expected] of cases) {
      assert.deepEqual(plain(await within(2000, w.send(msg, amazonTab), msg.type)), expected, msg.type);
    }
    assert.deepEqual(plain(await within(2000, w.send({ type: 'flushDiagnostics' }, settingsSender), 'flushDiagnostics')), { ok: false, reason: 'worker-error' });
    assert.deepEqual(plain(await within(2000, w.send({ type: 'refreshSheet' }, settingsSender), 'refreshSheet')), { ok: false, count: 0, producers: 0 });
  } finally { console.warn = warn; }
  assert.ok(warned.some(line => /lookupBarcode: storage unavailable/.test(line)), `the failure is logged: ${warned.join(' | ')}`);
});

// get(null) read the purchase history too: up to 10,000 records, copied into the worker at every start
// and every twelve hours, to delete cache entries that are a few hundred bytes each.
test('the housekeeping sweep reads the cache keys, not the purchase history, where the browser can list keys', async () => {
  const DAY = 24 * 60 * 60 * 1000, now = Date.now();
  const initial = {
    speedMode: 'balanced', purchaseHistory: [{ key: 'x' }], sendDiagnostics: false, diagQueue: [{ big: 'x'.repeat(100) }],
    's:amazon.com:B000000001': { t: now }, 'p:amazon.com:B000000001': { t: now - 45 * DAY }, 'off:0000000000017': { t: now },
  };
  const w = worker(initial, undefined, { getKeys: true });
  const result = await w.call(`sweepCache(${now})`);
  assert.deepEqual(plain(result), { removed: 1, kept: 2 });
  assert.deepEqual(Object.keys(w.data).sort(), ['diagQueue', 'off:0000000000017', 's:amazon.com:B000000001', 'purchaseHistory', 'sendDiagnostics', 'speedMode'].sort());
  const asked = w.reads.flat().filter(k => typeof k === 'string');
  assert.ok(!w.reads.includes(null), 'get(null) reads everything');
  assert.ok(!asked.includes('purchaseHistory') && !asked.includes('diagQueue'), `read: ${asked.join(', ')}`);
  // Without getKeys (Firefox, older Chrome) the sweep still works the old way.
  const withoutKeys = worker(initial);
  assert.deepEqual(plain(await withoutKeys.call(`sweepCache(${now})`)), { removed: 1, kept: 2 });
});

// The import path re-cleaned the whole history three times to learn that nothing changed. It now compares
// the stored records that share a key with the arriving ones, and must still behave as the full comparison
// did: the same write or no write, the same reply, the same refusals.
function purchase(n, extra = {}) {
  return { key: n.toString(16).padStart(64, '0'), orderKey: 'b'.repeat(64), store: 'amazon.com', asin: `B${String(n).padStart(9, '0')}`,
    name: 'Rolled oats', date: `2026-0${1 + n % 9}-1${n % 9}`, state: 'purchased', score: 80, profile: 'c'.repeat(64), version: '1.0.0',
    scoredAt: 5, observedAt: 10, flags: [], ingredients: 'oats', ...extra };
}
const fullComparison = (stored, incoming) => {
  const H = require('../src/engine/db/purchase-history.js');
  const records = H.merge(stored, incoming);
  const comparable = values => JSON.stringify(H.merge([], values).map(({ observedAt: _o, ...r }) => r));
  return { unchanged: comparable(stored) === comparable(records), records: records.filter(r => incoming.some(x => x.key === r.key)), all: records };
};
const importer = history => {
  const w = worker({ historyEnabled: true, historyAutoSync: false, purchaseHistory: history });
  w.call('(() => { const set = chrome.storage.local.set; globalThis.historyWrites = 0; chrome.storage.local.set = v => { if (v.purchaseHistory) historyWrites++; return set(v); }; })()');
  return w;
};
const ingest = (w, records) => w.call(`AIR.historyWorker.ingest(${JSON.stringify({ records })})`);

test('importing what is already stored writes nothing; a changed or new purchase is written', async () => {
  const history = Array.from({ length: 40 }, (_, n) => purchase(n));
  const w = importer(history);
  // Seen again later: only observedAt moves, which was never a change.
  let reply = await ingest(w, [purchase(3, { observedAt: 99 }), purchase(4, { observedAt: 99 })]);
  assert.equal(reply.ok, true);
  assert.equal(await w.call('historyWrites'), 0, 'nothing changed');
  assert.deepEqual(plain(reply.records.map(r => r.key).sort()), [purchase(3).key, purchase(4).key].sort(), 'the arriving records come back');
  // A return is a change.
  reply = await ingest(w, [purchase(3, { state: 'returned', observedAt: 120 })]);
  assert.equal(await w.call('historyWrites'), 1);
  assert.equal(w.data.purchaseHistory.find(r => r.key === purchase(3).key).state, 'returned');
  assert.equal(reply.records[0].state, 'returned');
  // A new purchase is a change.
  await ingest(w, [purchase(77)]);
  assert.equal(await w.call('historyWrites'), 2);
  assert.equal(w.data.purchaseHistory.length, 41);
  // The first usable score is kept: a later, different score is not a change.
  await ingest(w, [purchase(5, { score: 12, scoredAt: 500, observedAt: 300 })]);
  assert.equal(await w.call('historyWrites'), 2);
  assert.equal(w.data.purchaseHistory.find(r => r.key === purchase(5).key).score, 80);
});

test('the import behaves as the full comparison did, over many histories and batches', async () => {
  let seed = 20261025;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = list => list[Math.floor(next() * list.length)];
  for (let round = 0; round < 120; round++) {
    const stored = [];
    for (let n = 0; n < Math.floor(next() * 12); n++) stored.push(purchase(n, next() < 0.3 ? { score: null, scoredAt: 0 } : {}));
    if (next() < 0.2 && stored.length) stored.push({ ...stored[0], observedAt: 50, state: 'cancelled' });   // a duplicate key in storage
    if (next() < 0.15) stored.push({ key: 'not-a-record' });                                                 // junk that cleaning drops
    const incoming = [];
    for (let i = 0; i < 1 + Math.floor(next() * 4); i++) {
      const n = Math.floor(next() * 16);
      incoming.push(purchase(n, pick([{}, {}, { observedAt: 99 }, { state: 'returned', observedAt: 99 }, { score: 33, scoredAt: 9, observedAt: 99 },
        { name: 'Renamed', observedAt: 99 }, { score: null, scoredAt: 0 }, next() < 0.1 ? { date: '2025-12-31' } : {}])));
    }
    let expected, thrown;
    try { expected = fullComparison(stored, incoming); } catch (e) { thrown = e.message; }
    const w = importer(stored);
    let reply, failure;
    try { reply = await ingest(w, incoming); } catch (e) { failure = e.message; }
    const label = `round ${round}`;
    assert.equal(failure, thrown, label);
    if (thrown) { assert.equal(await w.call('historyWrites'), 0, `${label}: nothing written on a refusal`); continue; }
    assert.equal(reply.ok, true, label);
    assert.equal(await w.call('historyWrites'), expected.unchanged ? 0 : 1, `${label}: ${expected.unchanged ? 'no write' : 'one write'}`);
    assert.deepEqual(w.data.purchaseHistory, expected.unchanged ? stored : expected.all, `${label}: stored history`);
    assert.deepEqual(JSON.parse(JSON.stringify(reply.records)), JSON.parse(JSON.stringify(expected.records)), `${label}: reply`);
  }
});
