// Exercise the actual service worker with asynchronous, structured-clone storage.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function worker(initial = {}, fetcher, { alarms } = {}) {
  const data = structuredClone(initial);
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
        async remove(keys) { for (const k of keys) delete data[k]; },
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
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/ocr-text.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/ratings-cache.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/worker/messages.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/worker/sheet-store.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/background.js'), 'utf8'), context);
  return {
    data, call: (expression) => vm.runInContext(expression, context), created: () => created, badges,
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
const enabled = {
  sendDiagnostics: true,
  contributeUrl: 'https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz1234567890/exec',
};
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
test('failed refresh never reuses another configured sheet', async () => {
  const w = worker({
    sheetUrl: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit',
    producersUrl: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit',
    sheetIndex: { url: 'https://old.test', index: { count: 1 } },
    producerIndex: { url: 'https://old.test', index: { brand: {} } },
  });
  assert.equal(await w.call('loadSheetIndex()'), null);
  assert.equal(await w.call('loadProducerIndex()'), null);
});
test('empty producer sheet replaces previously cached producers', async () => {
  const url = 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/gviz/tq?tqx=out:csv';
  const w = worker({ producersUrl: url, producerIndex: { url, t: 0, index: { old: {} } } },
    async () => ({ ok: true, text: async () => '' }));
  assert.equal(Object.keys(await w.call('loadProducerIndex(true)')).length, 0);
});
test('offscreen document can be recreated after Chrome closes it', async () => {
  const w = worker();
  await w.call('ensureOffscreen()');
  await w.call('ensureOffscreen()');
  assert.equal(w.created(), 2);
});
test('published sheet URLs retain their public export route and tab', () => {
  const w = worker();
  assert.equal(w.call("toCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACXabcdefghijklmnopqrstuvwxyz/pubhtml?gid=42')"),
    'https://docs.google.com/spreadsheets/d/e/2PACXabcdefghijklmnopqrstuvwxyz/pub?output=csv&gid=42');
  assert.equal(w.call("toCsvUrl('https://example.test/?output=csv')"), null);
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
  const w = worker({ enabled: false, ocrLabels: true, useOpenFoodFacts: true,
    shareContributions: true, contributeUrl: enabled.contributeUrl,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit',
    producersUrl: 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit' },
  async () => { requests++; throw new Error('unexpected fetch'); });
  for (const call of ['contribute({})', 'lookupBarcode("12345678")', 'ocrLabels(["image"])',
    'loadSheetIndex()', 'loadProducerIndex()']) await w.call(call);
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
test('sheet revisions follow the CSV content, not the fetch time', async () => {
  const w = worker({ sheetUrl: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz0123/edit' },
    async () => ({ ok: true, text: async () => 'asin,certifications\nB000000001,USDA Organic\n' }));
  await w.call('loadSheetIndex(true)');
  const first = w.data.sheetIndexRev;
  await w.call('loadSheetIndex(true)');
  assert.ok(first && typeof first === 'string');
  assert.equal(w.data.sheetIndexRev, first);
  assert.notEqual(await w.call("revisionOf('a,b')"), await w.call("revisionOf('a,c')"));
  assert.ok(!('ingredients' in (w.data.sheetIndex || {})));
});

const amazonTab = { id: 'ext', tab: { id: 3, url: 'https://www.amazon.com/dp/B00LOAW7U6' } };
const settingsSender = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
const popupSender = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };
const offscreenSender = { id: 'ext', url: 'chrome-extension://ext/src/offscreen/ocr.html' };
const label = 'https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg';

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
  assert.equal(w.call(`allowMessage({type:"diagnosticsStatus"}, ${JSON.stringify(popupSender)})`), true);
  assert.equal(w.call(`allowMessage({type:"refreshSheet"}, ${JSON.stringify(amazonTab)})`), false);
  assert.equal(w.call(`allowMessage({type:"saveSettings"}, ${JSON.stringify(settingsSender)})`), true);
  assert.equal(w.call(`allowMessage({type:"loadSettings"}, ${JSON.stringify(amazonTab)})`), false);
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

test('missing sheet URL reads the default shared sheet', async () => {
  let fetched = '';
  const w = worker({}, async (url) => {
    fetched = url;
    return { ok: true, text: async () => 'asin,certifications\n' };
  });
  await w.call('loadSheetIndex(true)');
  const parsed = new URL(fetched);
  assert.equal(parsed.hostname, 'docs.google.com');
  assert.match(parsed.pathname, /1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y/);
  assert.equal(parsed.searchParams.get('tqx'), 'out:csv');
  assert.equal(parsed.searchParams.get('sheet'), null);
});
test('an empty sheet URL does not fetch the shared sheet', async () => {
  let requests = 0;
  const w = worker({ sheetUrl: '' }, async () => { requests++; });
  assert.equal(await w.call('loadSheetIndex(true)'), null);
  assert.equal(requests, 0);
});
test('settings save posts the sanitized export and drops raw storage', async () => {
  let body;
  let url;
  const w = worker({
    contributeUrl: enabled.contributeUrl,
    weights: { sugar: 1.4, notACategory: 9 },
    allergens: ['milk', 'nope'],
    email: 'person@example.com',
    sheetUrl: 'https://evil.example/x',
  }, async (fetched, opts) => {
    url = fetched;
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ ok: true, wrote: 1, tab: 'settings' }) };
  });
  const res = await w.call('saveSettingsToEndpoint()');
  assert.equal(res.ok, true);
  assert.equal(url, enabled.contributeUrl);
  assert.deepEqual(Object.keys(body).sort(), ['kind', 'payload', 'ts']);
  assert.equal(body.kind, 'settings');
  assert.equal(body.payload._format, 'ingredient-check-settings');
  assert.equal(body.payload.weights.sugar, 1.4);
  assert.equal(body.payload.weights.notACategory, undefined);
  assert.deepEqual(body.payload.allergens, ['milk']);
  assert.equal(body.payload.email, undefined);
  assert.equal(body.payload.contributeUrl, undefined);
  assert.equal(body.payload.sheetUrl, undefined);
});
test('a settings save is not confirmed when an old script files it as a contribution', async () => {
  const w = worker({ contributeUrl: enabled.contributeUrl, weights: { sugar: 1 } }, async () => ({
    ok: true, json: async () => ({ ok: true, wrote: 1, tab: 'contributions' }),
  }));
  assert.equal((await w.call('saveSettingsToEndpoint()')).ok, false);
});
test('settings save does nothing without an Apps Script URL or the auto-sync toggle', async () => {
  let requests = 0;
  const idle = worker({
    sheetUrl: 'https://docs.google.com/spreadsheets/d/1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y/edit',
  }, async () => { requests++; });
  assert.equal((await idle.call('saveSettingsToEndpoint()')).reason, 'no-endpoint');
  const held = worker({ contributeUrl: enabled.contributeUrl }, async () => { requests++; });
  assert.equal((await held.call('saveSettingsToEndpoint({ onlyIfEnabled: true })')).reason, 'not-enabled');
  assert.equal(requests, 0);
});
test('settings load reads the settings tab and sanitizes the payload', async () => {
  const payload = {
    _format: 'ingredient-check-settings', _version: 1,
    weights: { sugar: 0.5 }, allergens: ['soy', 'bogus'], diets: [], avoidList: [], foodOnly: false,
    email: 'person@example.com', contributeUrl: 'https://evil.example',
  };
  const csv = 'key,value,ts\npayload,"' + JSON.stringify(payload).replace(/"/g, '""') + '",2026-09-22T00:00:00.000Z\n';
  let fetched = '';
  const w = worker({
    sheetUrl: 'https://docs.google.com/spreadsheets/d/1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y/edit',
    contributeUrl: enabled.contributeUrl,
  }, async (url) => {
    fetched = url;
    return { ok: true, text: async () => csv };
  });
  const res = await w.call('loadSettingsFromSheet()');
  assert.equal(res.ok, true);
  const parsed = new URL(fetched);
  assert.equal(parsed.searchParams.get('sheet'), 'settings');
  assert.match(parsed.pathname, /1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y/);
  assert.equal(w.data.weights.sugar, 0.5);
  assert.deepEqual(w.data.allergens, ['soy']);
  assert.equal(w.data.foodOnly, false);
  assert.equal(w.data.email, undefined);
  assert.equal(w.data.contributeUrl, enabled.contributeUrl);
});
test('settings load uses Apps Script GET when the sheet URL is cleared', async () => {
  const payload = {
    _format: 'ingredient-check-settings', _version: 1,
    weights: { sugar: 0.2 }, allergens: [], diets: [], avoidList: ['carrageenan'], foodOnly: true,
  };
  const calls = [];
  const w = worker({ sheetUrl: '', contributeUrl: enabled.contributeUrl }, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ ok: true, kind: 'settings', payload }) };
  });
  const res = await w.call('loadSettingsFromSheet()');
  assert.equal(res.ok, true);
  assert.deepEqual(calls, [`${enabled.contributeUrl}?kind=settings`]);
  assert.deepEqual(w.data.avoidList, ['carrageenan']);
});

test('oversized sheet CSV is refused and leaves a prior index alone', async () => {
  const url = 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz0123/edit';
  const prior = { byAsin: Object.create(null), byUpc: Object.create(null), byBrand: Object.create(null), count: 1 };
  prior.byAsin.B000000001 = { asin: 'B000000001', certifications: 'USDA Organic', source: 'shared database' };
  const maxBytes = 2 * 1024 * 1024;
  const w = worker({ sheetUrl: url }, async () => ({
    ok: true, text: async () => 'x'.repeat(maxBytes + 1),
  }));
  const csvUrl = w.call('toCsvUrl(' + JSON.stringify(url) + ')');
  w.data.sheetIndex = { url: csvUrl, t: Date.now(), index: prior };
  const index = await w.call('loadSheetIndex(true)');
  assert.equal(index.count, 1);
  assert.equal(index.byAsin.B000000001.asin, 'B000000001');
  assert.equal(w.data.sheetIndex.index, prior); // storage write skipped
  assert.equal(w.call('MAX_SHEET_BYTES'), maxBytes);
});

test('ratings writes are batched: no POST per tile, one POST when the batch fills', async () => {
  const posts = [];
  const w = worker({ shareContributions: true, contributeUrl: enabled.contributeUrl }, async (url, init) => {
    posts.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, wrote: 1, tab: 'ratings_cache' }) };
  });
  const entry = i => ({ schema: 3, v: '1.0.0', t: Date.now() - 1000, store: 'amazon.com',
    asin: `B00TEST${String(i).padStart(3, '0')}`, prefs: 'fp', score: 70, verdict: 'Good', source: 'search-tile' });
  for (let i = 0; i < 24; i++) await w.send({ type: 'ratingsQueue', upserts: [entry(i)] }, amazonTab);
  assert.equal(posts.length, 0);
  assert.equal((await w.send({ type: 'ratingsQueue', upserts: [entry(24)] }, amazonTab)).sent, 25);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, 'ratings');
  assert.equal(posts[0].upserts.length, 25);
  assert.equal(w.data.ratingsQueue, undefined);
  const down = worker({ shareContributions: true, contributeUrl: enabled.contributeUrl }, async () => {
    posts.push('down');
    return { ok: false };
  });
  for (let i = 0; i < 30; i++) await down.send({ type: 'ratingsQueue', upserts: [entry(i)] }, amazonTab);
  assert.equal(posts.filter(p => p === 'down').length, 1, 'a failed send must not retry on every tile');
  const off = worker({ contributeUrl: enabled.contributeUrl });
  assert.equal((await off.send({ type: 'ratingsQueue', upserts: [entry(1)] }, amazonTab)).reason, 'not-enabled');
});
