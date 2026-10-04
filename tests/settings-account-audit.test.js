'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function page(options = {}, settings = false) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { disabled: false, value: '', textContent: '', hidden: false,
      classList: { toggle() {} }, addEventListener(type, fn) { this[type] = fn; } });
    return elements.get(id);
  };
  const timers = new Map();
  const changed = [];
  const writes = [];
  const calls = [];
  const guards = [];
  const state = {};
  const data = { oauthClientId: prefs.OAUTH_CLIENT_ID, ...options.initial };
  let reloads = 0, confirms = 0;
  const air = { ...globalThis.AIR, db: { ...globalThis.AIR.db, prefs: { ...prefs,
    endpoint: () => options.offline ? '' : 'https://example.test/db',
    readSync: async () => options.readSync ? options.readSync() : { ok: true, ts: 1, values: { avoidList: ['restored'] } } } },
    googleAuth: { token: async () => { if (options.authPending) await options.authPending; return 'a'.repeat(30); },
      cleanProfile: require('../src/options/google-auth.js').cleanProfile,
      ...(options.profile !== undefined ? { profile: async () => { if (options.profile instanceof Error) throw options.profile; return options.profile; } } : {}) },
    settingsRestore: { async begin() { guards.push('begin'); }, complete() { guards.push('complete'); } } };
  const context = vm.createContext({ AIR: air, console,
    document: { getElementById: get, querySelectorAll: () => [] },
    window: { addEventListener(type, fn) { this[type] = fn; }, confirm() { confirms++; return options.confirm !== false; } },
    location: { reload() { reloads++; } },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    PREFS: air.db.prefs, msg: (_key, fallback) => fallback, flash() {}, applyScoring(value) { Object.assign(state, value); },
    persist(values, cb) { writes.push(values); if (!options.saveError) Object.assign(data, values); cb(!options.saveError); },
    chrome: { runtime: { id: 'id', async sendMessage(message) { calls.push(message); if (options.requestPending) await options.requestPending; return options.result || { ok: true }; } },
      identity: { getRedirectURL: () => 'https://test.chromiumapp.org/' }, permissions: { async request() { return true; } },
      storage: { sync: {}, onChanged: { addListener(fn) { changed.push(fn); } }, local: {
        remove(key, cb) { delete data[key]; cb(); },
        get(keys, cb) { if (options.localReadError) context.chrome.runtime.lastError = { message: 'unavailable' }; cb(data); delete context.chrome.runtime.lastError; }, set(values, cb) { writes.push({ values, cb }); if (!options.deferredWrites) { Object.assign(data, values); cb(); } },
      } }, tabs: { async create() {} } },
  });
  if (settings) {
    vm.runInContext(fs.readFileSync('src/options/settings.js', 'utf8'), context);
  } else {
    vm.runInContext(fs.readFileSync('src/options/settings-database.js', 'utf8'), context);
  }
  return { get, context, writes, calls, guards, changed, state, data, timers,
    reloads: () => reloads, confirms: () => confirms,
    run: code => vm.runInContext(code, context),
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

test('Google account operation locks Chrome restore and client configuration until request completes', async () => {
  let release;
  const requestPending = new Promise(resolve => { release = resolve; });
  const p = page({ requestPending });
  p.run('wireBackup()');
  await tick();
  p.get('accountSave').click();
  await tick();
  for (const id of ['accountSave', 'accountLoad', 'restoreChrome', 'oauthClientId', 'saveAccountSetup']) assert.equal(p.get(id).disabled, true);
  p.get('oauthClientId').value = 'different.apps.googleusercontent.com';
  p.get('saveAccountSetup').click();
  await p.get('restoreChrome').click();
  p.get('accountLoad').click();
  assert.equal(p.writes.length, 0);
  assert.equal(p.calls.length, 1);
  assert.equal(p.confirms(), 0);
  release();
  await tick();
  assert.match(p.get('accountStatus').textContent, /Saved to your Google account/);
  for (const id of ['accountSave', 'accountLoad', 'restoreChrome', 'oauthClientId', 'saveAccountSetup']) assert.equal(p.get(id).disabled, false);
});

test('Google restore remains locked until local state is refreshed and reload executes', async () => {
  const p = page();
  p.run('wireBackup()');
  await tick();
  p.get('accountLoad').click();
  await tick();
  assert.deepEqual(p.guards, ['begin']);
  assert.equal(p.get('accountLoad').disabled, true);
  assert.equal(p.reloads(), 0);
  p.get('accountLoad').click();
  assert.equal(p.confirms(), 1);
  assert.equal(p.calls.length, 1);
  p.flushTimers();
  await tick();
  assert.equal(p.reloads(), 1);
  assert.deepEqual(p.guards, ['begin', 'complete']);
});

test('Chrome restore persistence failure releases locks without reloading or claiming success', async () => {
  const p = page({ saveError: true });
  p.run('wireBackup()');
  await tick();
  await p.get('restoreChrome').click();
  assert.equal(p.reloads(), 0);
  assert.match(p.get('backupStatus').textContent, /Could not restore settings/);
  assert.deepEqual(p.guards, ['begin', 'complete']);
  for (const id of ['accountSave', 'accountLoad', 'restoreChrome', 'oauthClientId', 'saveAccountSetup']) assert.equal(p.get(id).disabled, false);
});

test('unconfigured account endpoints cannot trigger Google auth through synthetic button clicks', async () => {
  const p = page({ offline: true });
  p.run('wireAccount()');
  p.get('accountSave').click();
  p.get('accountLoad').click();
  await tick();
  assert.equal(p.calls.length, 0);
  assert.equal(p.confirms(), 0);
  assert.equal(p.get('accountSave').disabled, true);
});

test('restore guard cancels debounced scoring saves, drains pending writes and suppresses pagehide writes', async () => {
  const p = page({ deferredWrites: true }, true);
  p.run('settingsReady = true');
  p.run('persist({ foodOnly: false })');
  p.run('persist({ autoScoreSearch: false })');
  p.run('save()');
  const waiting = p.run('AIR.settingsRestore.begin()');
  let finished = false;
  waiting.then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  p.writes[0].cb();
  await tick();
  assert.equal(finished, false);
  assert.equal(p.run('writing'), true);
  p.context.window.pagehide();
  p.run('save({ immediate: true })');
  p.flushTimers();
  assert.equal(p.writes.length, 2);
  p.writes[1].cb();
  await waiting;
  assert.equal(finished, true);
  p.run('AIR.settingsRestore.complete()');
  p.context.window.pagehide();
  assert.equal(p.writes.length, 3);
});

test('failed pending local writes still unblock restore waiting and preserve write-count state', async () => {
  const p = page({ deferredWrites: true }, true);
  p.run('persist({ foodOnly: false })');
  const waiting = p.run('AIR.settingsRestore.begin()');
  p.context.chrome.runtime.lastError = { message: 'quota' };
  p.writes[0].cb();
  delete p.context.chrome.runtime.lastError;
  await waiting;
  assert.equal(p.run('pendingWrites'), 0);
  assert.equal(p.run('writing'), false);
  p.run('AIR.settingsRestore.complete()');
  p.run('save({ immediate: true })');
  assert.equal(p.writes.length, 2);
});


test('settings startup read failure suppresses pagehide writes of default preferences', () => {
  const p = page({ localReadError: true }, true);
  p.run('startSettingsPage()');
  assert.match(p.get('status').textContent, /Could not load your settings/);
  p.context.window.pagehide();
  assert.equal(p.writes.length, 0);
  assert.equal(p.run('settingsReady'), false);
});

test('a committed restore reloads immediately under its write guard if the follow-up read fails', async () => {
  const p = page();
  p.run('wireBackup()');
  await tick();
  p.context.chrome.storage.local.get = (_keys, cb) => {
    p.context.chrome.runtime.lastError = { message: 'unavailable' };
    cb({});
    delete p.context.chrome.runtime.lastError;
  };
  p.get('accountLoad').click();
  await tick();
  assert.equal(p.reloads(), 1);
  assert.deepEqual(p.guards, ['begin', 'complete']);
  assert.equal(p.get('accountLoad').disabled, false);
});

test('late failed Chrome sync reads cannot overwrite a newer successful backup state', async () => {
  let fail;
  let reads = 0;
  const p = page({ readSync: () => {
    if (reads++ === 0) return new Promise((_resolve, reject) => { fail = reject; });
    return { ok: true, ts: 1 };
  } });
  p.run('wireBackup()');
  p.changed[0]({}, 'sync');
  await tick();
  assert.equal(p.get('restoreChrome').disabled, false);
  const status = p.get('backupStatus').textContent;
  fail(new Error('stale'));
  await tick();
  assert.equal(p.get('backupStatus').textContent, status);
  assert.equal(p.get('restoreChrome').disabled, false);
});

const ann = { email: 'ann@example.com', name: 'Ann', picture: 'https://lh3.googleusercontent.com/a/x' };

test('signing in shows who is signed in at the top, hides the sign-in prompt, and keeps the profile on this computer', async () => {
  const p = page({ profile: ann });
  p.run('wireAccount()');
  await tick();
  assert.equal(p.get('googleHeader').hidden, true, 'nobody signed in yet');
  assert.equal(p.get('accountSignedOut').hidden, false);
  p.get('accountSignIn').click();
  await tick(); await tick();
  assert.equal(p.get('googleHeader').hidden, false);
  assert.equal(p.get('googleEmail').textContent, 'ann@example.com');
  assert.equal(p.get('googleAvatar').src, ann.picture);
  assert.equal(p.get('accountSignedOut').hidden, true, 'the sign-in prompt is gone');
  assert.equal(p.get('accountSignedIn').hidden, false);
  assert.match(p.get('accountStatus').textContent, /Signed in with Google \(ann@example.com\)/);
  assert.equal(p.data.googleProfile.email, 'ann@example.com');
  assert.equal(p.calls.length, 0, 'signing in alone never touches the database or any saved copy');
});

test('the database not being set up is reported separately: sign-in still shows as a success', async () => {
  const p = page({ profile: ann, result: { ok: false, reason: 'Error: accounts are not configured' } });
  p.run('wireAccount()');
  await tick();
  p.get('accountSave').click();
  await tick(); await tick();
  assert.equal(p.get('googleHeader').hidden, false, 'the profile is shown even though storage is not ready');
  assert.match(p.get('accountStatus').textContent, /signed in \(ann@example.com\).*not been set up.*nothing can be saved/i);
  assert.equal(p.get('accountStatus').className, 'status error');
  assert.equal(p.get('accountSave').disabled, false, 'locks are released');
});

test('a profile Google will not share does not fail the sign-in', async () => {
  const p = page({ profile: new Error('profile-failed') });
  p.run('wireAccount()');
  await tick();
  p.get('accountSignIn').click();
  await tick(); await tick();
  assert.match(p.get('accountStatus').textContent, /did not share your email/);
  assert.equal(p.get('googleHeader').hidden, true);
  assert.equal(p.data.googleProfile, undefined);
});

test('a signed-in reader is shown on load, and signing out clears only the profile', async () => {
  const p = page({ initial: { googleProfile: { ...ann, at: 1 }, weights: { sugar: 1 } } });
  p.run('wireAccount()');
  await tick();
  assert.equal(p.get('googleHeader').hidden, false);
  assert.equal(p.get('accountSignedOut').hidden, true);
  p.get('googleSignOut').click();
  await tick();
  assert.equal(p.get('googleHeader').hidden, true);
  assert.equal(p.get('accountSignedOut').hidden, false);
  assert.equal(p.data.googleProfile, undefined);
  assert.deepEqual(p.data.weights, { sugar: 1 }, 'settings are untouched');
});
