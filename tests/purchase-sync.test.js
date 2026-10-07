'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const H = require('../src/engine/db/purchase-history.js');
const { receiver } = require('./receiver-harness.js');
const r = (key = 'a', more = {}) => ({ key: key.repeat(64), store: 'amazon.com', asin: 'B000000001', date: '2026-09-01', state: 'purchased', name: 'Oats', score: 98, profile: 'f'.repeat(64), version: '1.11.0', ingredients: 'oats', flags: [], observedAt: Date.now(), scoredAt: Date.now(), ...more });
function client(initial = {}, opts = {}) {
  const data = { enabled: true, historyEnabled: true, historyAutoSync: true, googleProfile: { email: 'one@example.com' }, ...initial }, calls = [], alarms = [];
  const c = vm.createContext({ AIR: { db: { purchaseHistory: H, prefs: { endpoint: () => 'https://example.test/exec', oauthClientId: () => 'client', OAUTH_CLIENT_ID: 'client' } }, googleAuth: { token: async () => 'test-token', profile: async () => ({ email: opts.tokenEmail || 'one@example.com' }) } },
    chrome: { alarms: { create: (_n, v) => alarms.push(v), clear: async () => {}, onAlarm: { addListener() {} } }, permissions: { contains: async () => true }, storage: { onChanged: { addListener() {} }, local: { get: async () => structuredClone(data), set: async v => Object.assign(data, structuredClone(v)) } } },
    networkRequest: async () => { if (opts.offline) throw new Error('offline'); return { history: opts.oldBackend ? undefined : true, historySchema: 1 }; },
    accountRequest: async (kind, token, payload) => { calls.push({ kind, token, payload }); if (opts.request) return opts.request(kind, payload); return kind === 'historyGet' ? { ok: true, kind, account: opts.remoteAccount || 'c'.repeat(64), records: opts.remote || [], clearedAt: opts.clearedAt || 0 } : { ok: true, kind, clearedAt: Date.now() }; },
  }); vm.runInContext(fs.readFileSync('src/worker/purchase-history.js', 'utf8'), c);
  return { data, calls, alarms, api: c.AIR.historyWorker };
}
test('history import requires opt-in; repeat page imports merge instead of duplicating', async () => {
  const off = client({ historyEnabled: false }); assert.equal((await off.api.ingest({ records: [r()] })).reason, 'off'); assert.equal(off.data.purchaseHistory, undefined);
  const on = client(); await on.api.ingest({ records: [r()] }); await on.api.ingest({ records: [r()] }); assert.equal(on.data.purchaseHistory.length, 1); assert.ok(on.alarms.length);
});
test('older backend capability check prevents every token or history POST', async () => {
  const c = client({ purchaseHistory: [r()] }, { oldBackend: true }); assert.equal((await c.api.sync()).reason, 'backend-update-required'); assert.equal(c.calls.length, 0); assert.equal(c.data.purchaseHistory.length, 1);
});
test('Google account switch and wrong silent-token account cannot upload local history', async () => {
  const c = client({ historyOwner: 'another@example.com', purchaseHistory: [r()] }); assert.equal((await c.api.sync()).reason, 'account-changed'); assert.equal(c.calls.length, 0);
  const wrong = client({}, { tokenEmail: 'another@example.com' }); assert.equal((await wrong.api.sync()).reason, 'account-changed'); assert.equal(wrong.calls.length, 0);
});
test('automatic sync respects its switch, while Sync now still works', async () => {
  const c = client({ historyAutoSync: false, purchaseHistory: [r()] }); assert.equal((await c.api.sync()).reason, 'off'); assert.equal(c.calls.length, 0);
  assert.equal((await c.api.sync('test-token', true)).ok, true); assert.equal(c.calls[1].kind, 'historyPut');
});
test('cross-device pull merges before upload and never overwrites a saved first snapshot', async () => {
  const c = client({ purchaseHistory: [r('a', { score: 40, scoredAt: 1000 })] }, { remote: [r('a', { score: 98, scoredAt: 2000 }), r('b')] });
  assert.equal((await c.api.sync()).ok, true); assert.equal(c.data.purchaseHistory.length, 2); assert.equal(c.data.purchaseHistory.find(x => x.key === 'a'.repeat(64)).score, 40);
});
test('offline and unconfirmed writes preserve local history and a retry alarm', async () => {
  const offline = client({ purchaseHistory: [r()] }, { offline: true }); assert.equal((await offline.api.sync()).ok, false); assert.equal(offline.data.purchaseHistory.length, 1); assert.equal(offline.alarms.at(-1).delayInMinutes, 5);
  const c = client({ purchaseHistory: [r()] }, { request: kind => kind === 'historyGet' ? { ok: true, kind, account: 'c'.repeat(64), records: [], clearedAt: 0 } : { ok: true, wrote: 1 } }); assert.equal((await c.api.sync()).ok, false); assert.equal(c.data.purchaseHistory.length, 1);
});
test('remote deletion epoch prevents a stale device from re-uploading old purchases', async () => {
  const c = client({ purchaseHistory: [r()], historyEpoch: 0 }, { clearedAt: 1000 }); assert.equal((await c.api.sync()).ok, true); assert.equal(c.data.purchaseHistory.length, 0); assert.equal(c.calls.some(x => x.kind === 'historyPut'), false);
});
test('offline deletion clears local data, disables collection and retains explicit pending deletion', async () => {
  const c = client({ purchaseHistory: [r()], historyOwner: 'one@example.com' }, { offline: true }); assert.equal((await c.api.clear()).ok, false); assert.equal(c.data.purchaseHistory.length, 0); assert.equal(c.data.historyEnabled, false); assert.equal(c.data.historyDeletePending, true);
});
test('server authenticates each history read/write and isolates accounts', () => {
  const tokens = { ['a'.repeat(30)]: { aud: 'client-1', sub: 'one' }, ['b'.repeat(30)]: { aud: 'client-1', sub: 'two' }, ['c'.repeat(30)]: { aud: 'other-client', sub: 'one' } };
  const s = receiver({ tokens }); assert.equal(s.get({}).history, true);
  assert.equal(s.post({ kind: 'historyPut', token: 'a'.repeat(30), payload: { epoch: 0, records: [r()] } }).ok, true);
  assert.equal(s.post({ kind: 'historyGet', token: 'a'.repeat(30) }).records.length, 1);
  assert.equal(s.post({ kind: 'historyGet', token: 'b'.repeat(30) }).records.length, 0);
  assert.equal(s.post({ kind: 'historyGet', token: 'c'.repeat(30) }).ok, false);
  assert.equal(s.tabs.has('contributions'), false); assert.equal(s.tabs.has('accounts'), false);
});
test('server deduplicates retry after lost acknowledgement and clears only the caller account', () => {
  const tokens = { ['a'.repeat(30)]: { aud: 'client-1', sub: 'one' }, ['b'.repeat(30)]: { aud: 'client-1', sub: 'two' } }, s = receiver({ tokens });
  const write = token => s.post({ kind: 'historyPut', token, payload: { epoch: 0, records: [r()] } }); s.failNext(); assert.equal(write('a'.repeat(30)).ok, false); assert.equal(write('a'.repeat(30)).ok, true); assert.equal(s.post({ kind: 'historyGet', token: 'a'.repeat(30) }).records.length, 1);
  write('b'.repeat(30)); const cleared = s.post({ kind: 'historyClear', token: 'a'.repeat(30) }); assert.equal(cleared.ok, true);
  assert.equal(s.post({ kind: 'historyGet', token: 'a'.repeat(30) }).records.length, 0); assert.equal(s.post({ kind: 'historyGet', token: 'b'.repeat(30) }).records.length, 1);
  assert.equal(write('a'.repeat(30)).ok, false, 'stale epoch cannot resurrect deleted entries');
});
test('server rejects malformed or oversized batches without touching private rows', () => {
  const token = 'a'.repeat(30), s = receiver({ tokens: { [token]: { aud: 'client-1', sub: 'one' } } });
  for (const records of [[{ order: 'raw-order', address: 'PRIVATE' }], Array(101).fill(r())]) assert.equal(s.post({ kind: 'historyPut', token, payload: { epoch: 0, records } }).ok, false);
  assert.equal(s.tabs.has('purchase-history'), false);
});


test('same-email Google identities cannot transfer history to a different verified subject', async () => {
  const c = client({ historyAccount: 'd'.repeat(64), purchaseHistory: [r()] });
  assert.equal((await c.api.sync()).reason, 'account-changed');
  assert.equal(c.calls.some(x => x.kind === 'historyPut'), false);
});
test('account deletion verifies the bound subject before clearing the remote copy', async () => {
  const c = client({ historyOwner: 'one@example.com', historyAccount: 'd'.repeat(64), purchaseHistory: [r()] });
  assert.equal((await c.api.clear()).reason, 'account-changed');
  assert.equal(c.calls.some(x => x.kind === 'historyClear'), false);
  assert.equal(c.data.historyDeletePending, true);
});
