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
    console, URL, URLSearchParams, AbortSignal, AbortController,
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
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/prefs.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/engine/db/ocr-text.js'), 'utf8'), context);
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
const label = 'https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg';

test('OCR fetch URLs must be Amazon product images', () => {
  const w = worker();
  assert.deepEqual([...w.call(`allowedOcrUrls(${JSON.stringify([label, 'https://www.amazon.com/dp/B00LOAW7U6', 'https://example.test/x.jpg'])})`)], [label]);
  assert.deepEqual([...w.call('allowedOcrUrls(["image"])')], []);
});

test('content-script messages are ignored unless they come from an Amazon tab of this extension', async () => {
  const w = worker({ ocrLabels: true });
  assert.equal(w.call('allowMessage({type:"ocrLabels"}, {id:"other", tab:{url:"https://www.amazon.com/dp/B00"}})'), false);
  assert.equal(w.call('allowMessage({type:"ocrLabels"}, {id:"ext"})'), false);
  assert.equal(w.call('allowMessage({type:"ocrLabels"}, {id:"ext", tab:{url:"https://example.test/"}})'), false);
  assert.equal(w.call(`allowMessage({type:"ocrLabels"}, ${JSON.stringify(amazonTab)})`), true);
  assert.equal(w.call('allowMessage({type:"flushDiagnostics"}, {id:"ext"})'), true);
  assert.equal(await w.send({ type: 'ocrLabels', urls: [label] }, { id: 'other', tab: amazonTab.tab }), undefined);
  assert.equal(w.created(), 0);
  const allowed = await w.send({ type: 'ocrLabels', urls: [label] }, amazonTab);
  assert.equal(allowed.ok, true);
  assert.equal(w.created(), 1);
  const blocked = await w.send({ type: 'ocrLabels', urls: ['https://www.amazon.com/dp/B00LOAW7U6'] }, amazonTab);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'no-images');
});
