// Exercise the actual service worker with asynchronous, structured-clone storage.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function worker(initial = {}, fetcher) {
  const data = structuredClone(initial);
  const event = { addListener() {} };
  let created = 0;
  const badges = [];
  const context = vm.createContext({
    self: {}, console, URL, URLSearchParams, AbortSignal,
    fetch: fetcher || (async () => { throw new Error('offline'); }),
    chrome: {
      runtime: { getManifest: () => ({ version: '1.0.0' }), getURL: p => p,
        getContexts: async () => [], onMessage: event, onStartup: event, onInstalled: event },
      offscreen: { createDocument: async () => { created++; } },
      alarms: { create() {}, onAlarm: event },
      action: {
        setBadgeText(opts) { badges.push({ kind: 'text', ...opts }); },
        setBadgeBackgroundColor(opts) { badges.push({ kind: 'color', ...opts }); },
      },
      storage: { local: {
        async get(keys) {
          const result = keys == null ? data : Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]));
          return structuredClone(result);
        },
        async set(values) { Object.assign(data, structuredClone(values)); },
        async remove(keys) { for (const k of keys) delete data[k]; },
      } },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/background.js'), 'utf8'), context);
  return { data, call: (expression) => vm.runInContext(expression, context), created: () => created, badges };
}
const enabled = { sendDiagnostics: true, contributeUrl: 'https://example.test/exec' };
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
