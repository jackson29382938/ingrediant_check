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
    if (!elements.has(id)) elements.set(id, { disabled: false, value: '', hidden: false, children: [], _t: '',
      get textContent() { return this._t; }, set textContent(v) { this._t = v; if (v === '') this.children = []; },
      appendChild(child) { this.children.push(child); }, append(...kids) { this.children.push(...kids); }, closest: () => null,
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
    document: { getElementById: get, querySelectorAll: () => [], createElement: () => ({ textContent: '', className: '' }) },
    window: { addEventListener(type, fn) { this[type] = fn; }, confirm() { confirms++; return options.confirm !== false; } },
    location: { reload() { reloads++; } },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    PREFS: air.db.prefs, msg: (_key, fallback) => fallback, flash() {}, applyScoring(value) { Object.assign(state, value); },
    persist(values, cb) { writes.push(values); if (!options.saveError) Object.assign(data, values); cb(!options.saveError); },
    chrome: { runtime: { id: 'id', async sendMessage(message) { calls.push(message); if (options.requestPending) await options.requestPending; return options.result || { ok: true }; } },
      identity: { getRedirectURL: () => 'https://test.chromiumapp.org/' }, permissions: { async request() { return true; } },
      storage: { sync: {}, onChanged: { addListener(fn) { changed.push(fn); } }, local: {
        remove(key, cb) { [].concat(key).forEach(k => delete data[k]); cb(); },
        get(keys, cb) { if (typeof cb !== 'function') return Promise.resolve({ ...data }); if (options.localReadError) context.chrome.runtime.lastError = { message: 'unavailable' }; cb(data); delete context.chrome.runtime.lastError; return undefined; }, set(values, cb) { writes.push({ values, cb }); if (!options.deferredWrites) { Object.assign(data, values); cb(); } },
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

// ---------------------------------------------------------------- Check my backups
const backupOf = (data, over = {}) => ({ ok: true, ts: Date.parse('2026-10-05T01:00:00Z'), ...prefs.parseBackup(prefs.backupPayload({ ...data, ...over })) });
const lines = p => p.get('backupCheck').children.map(li => ({ text: li.textContent, bad: li.className === 'bad' }));

test('Check my backups: this browser and a matching Chrome profile copy are reported as all matching', async () => {
  const data = { ratePace: 'fast', sortCount: 250, allergens: ['milk'] };
  const p = page({ initial: data, readSync: () => backupOf({ ...prefs.sanitizeToggles({}), ...data, ratePace: 'fast', sortCount: 250, allergens: ['milk'] }) });
  p.run('wireBackup()');
  await tick();
  await p.get('checkBackups').click();
  const out = lines(p);
  assert.match(out[0].text, /^This browser: \d+ settings are stored and readable\.$/);
  assert.match(out[1].text, /^Chrome profile backup: all \d+ settings match \(saved .+\)\.$/);
  assert.deepEqual(out.map(l => l.bad), [false, false], 'nothing is flagged');
  assert.equal(out.length, 2, 'not signed in: no Google line');
  assert.equal(p.calls.filter(c => c.type === 'accountFetch').length, 0);
  assert.equal(p.get('checkBackups').disabled, false);
});

test('Check my backups: a Chrome profile copy that is behind names exactly the settings that differ', async () => {
  const data = { ratePace: 'fast', sortCount: 250, allergens: ['milk'], panelOpen: true };
  const stale = backupOf({}, { ratePace: 'fast', allergens: ['milk'] });   // saved before sortCount and panelOpen changed
  const p = page({ initial: data, readSync: () => stale });
  p.run('wireBackup()');
  await tick();
  await p.get('checkBackups').click();
  const chrome = lines(p)[1];
  assert.equal(chrome.bad, true);
  assert.match(chrome.text, /^Chrome profile backup: 2 of \d+ settings differ: .*panelOpen.*sortCount|sortCount.*panelOpen/);
  assert.ok(!chrome.text.includes('ratePace') && !chrome.text.includes('allergens'), 'matching settings are not named');
});

test('Check my backups: no backup yet, still syncing and unreadable are each said plainly', async () => {
  for (const [got, expect] of [[{ ok: false, reason: 'no-backup' }, /nothing saved yet/], [{ ok: false, reason: 'incomplete-backup' }, /still syncing/], [{ ok: false, reason: 'invalid-backup' }, /could not be read/]]) {
    const p = page({ readSync: () => got });
    p.run('wireBackup()');
    await tick();
    await p.get('checkBackups').click();
    const l = lines(p)[1];
    assert.match(l.text, expect);
    assert.equal(l.bad, true);
  }
});

test('Check my backups: when signed in it also fetches and compares the Google copy, without applying it', async () => {
  const data = { ratePace: 'fast', googleProfile: { ...ann, at: 1 } };
  const copy = backupOf(data);
  const p = page({ initial: data, result: copy, readSync: () => backupOf(data) });
  p.run('wireBackup()');
  await tick(); await tick();
  await p.get('checkBackups').click();
  const out = lines(p);
  assert.equal(out.length, 3);
  assert.match(out[2].text, /^Google copy: all \d+ settings match/);
  assert.equal(out[2].bad, false);
  const fetched = p.calls.filter(c => c.type === 'accountFetch');
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].token.length, 30, 'a token is used for this one request');
  assert.equal(p.calls.filter(c => c.type === 'accountLoad').length, 0, 'checking never restores');
  assert.equal(p.reloads(), 0);
});

test('Check my backups: a Google copy that is behind is named, and a failed sign-in is reported', async () => {
  const data = { ratePace: 'fast', hoverScore: true, googleProfile: { ...ann, at: 1 } };
  const behind = page({ initial: data, result: backupOf({}, { ratePace: 'fast' }), readSync: () => backupOf(data) });
  behind.run('wireBackup()');
  await tick(); await tick();
  await behind.get('checkBackups').click();
  const g = lines(behind)[2];
  assert.equal(g.bad, true);
  assert.match(g.text, /^Google copy: 1 of \d+ settings differ: hoverScore\.$/);

  const none = page({ initial: data, result: { ok: false, reason: 'no-backup' }, readSync: () => backupOf(data) });
  none.run('wireBackup()');
  await tick(); await tick();
  await none.get('checkBackups').click();
  assert.match(lines(none)[2].text, /^Google copy: nothing saved yet\.$/);

  const refused = page({ initial: data, readSync: () => backupOf(data) });
  refused.context.AIR.googleAuth.token = async () => { throw new Error('cancelled'); };
  refused.run('wireBackup()');
  await tick(); await tick();
  await refused.get('checkBackups').click();
  assert.match(lines(refused)[2].text, /^Google copy: sign-in did not complete\.$/);
  assert.equal(refused.get('checkBackups').disabled, false, 'the button is usable again');
});

test('Check my backups: running it twice replaces the report instead of stacking it', async () => {
  const p = page({ readSync: () => backupOf({}) });
  p.run('wireBackup()');
  await tick();
  await p.get('checkBackups').click();
  const first = lines(p).length;
  await p.get('checkBackups').click();
  assert.equal(lines(p).length, first);
});

// ---------------------------------------------------------------- automatic Google saving: what the page says
test('the Google status line says when automatic saving starts, when it last ran, and when it has paused', async () => {
  const status = async initial => {
    const p = page({ initial: { googleProfile: { ...ann, at: 1 }, ...initial } });
    p.run('wireAccount()');
    await tick();
    return p.get('googleSaveStatus');
  };
  assert.match((await status({})).textContent, /starts after you first save to, or restore from/);
  assert.match((await status({ googleLinked: true })).textContent, /Automatic saving is on/);
  const ok = await status({ googleLinked: true, googleBackupStatus: { ok: true, t: Date.UTC(2026, 9, 5, 1, 0) } });
  assert.match(ok.textContent, /^Last saved to Google /);
  assert.equal(ok.className, 'status');
  const paused = await status({ googleLinked: true, googleBackupStatus: { ok: false, t: 1, reason: 'needs-sign-in' } });
  assert.match(paused.textContent, /paused.*sign in again.*Save my settings to Google/);
  assert.equal(paused.className, 'status error');
  const failed = await status({ googleLinked: true, googleBackupStatus: { ok: false, t: 1, reason: 'network' } });
  assert.match(failed.textContent, /Could not save to Google .*\(network\)/);
});

test('the status line follows the worker: a new result repaints it, and signing out clears the link', async () => {
  const p = page({ initial: { googleProfile: { ...ann, at: 1 }, googleLinked: true } });
  p.run('wireAccount()');
  await tick();
  const listener = p.changed[p.changed.length - 1];
  p.data.googleBackupStatus = { ok: true, t: Date.UTC(2026, 9, 5, 2, 0) };
  listener({ googleBackupStatus: { newValue: p.data.googleBackupStatus } }, 'local');
  await tick();
  assert.match(p.get('googleSaveStatus').textContent, /^Last saved to Google /);
  p.get('googleSignOut').click();
  await tick();
  for (const key of ['googleProfile', 'googleLinked', 'googleBackupStatus']) assert.equal(p.data[key], undefined, `${key} is cleared`);
});

// ---------------------------------------------------------------- keyboard shortcuts on the settings page
function shortcutsPage(commands) {
  const p = page({}, true);
  const c = p.context;
  const made = [];
  c.document.createElement = tag => { const el = { tag, textContent: '', children: [], append(...kids) { this.children.push(...kids); } }; made.push(el); return el; };
  c.document.createTextNode = text => ({ text });
  const created = [];
  c.chrome.tabs.create = async o => { created.push(o.url); };
  c.chrome.commands = { getAll: cb => cb(commands()) };
  p.run('wireShortcuts()');
  const rows = () => p.get('shortcutList').children.map(li => ({
    label: li.children[0].textContent,
    key: li.children[2] && li.children[2].tag === 'kbd' ? li.children[2].textContent : (li.children[2] || {}).text }));
  return { p, rows, created };
}

test('shortcuts: the settings page shows the keys Chrome has assigned, and "not set" for an empty one', () => {
  const { rows } = shortcutsPage(() => [
    { name: '_execute_action', shortcut: '' },
    { name: 'sort-health', shortcut: 'Alt+Shift+H' },
    { name: 'sort-price', shortcut: '' },
  ]);
  assert.deepEqual(rows(), [
    { label: 'Sort by Ingredient Check score', key: 'Alt+Shift+H' },
    { label: 'Sort by price per ounce', key: 'not set' },
  ]);
});

test('shortcuts: coming back from chrome://extensions/shortcuts repaints the list, and the button opens that page', () => {
  let assigned = '';
  const { p, rows, created } = shortcutsPage(() => [{ name: 'sort-health', shortcut: 'Alt+Shift+H' }, { name: 'sort-price', shortcut: assigned }]);
  assert.equal(rows()[1].key, 'not set');
  assigned = 'Ctrl+Shift+P';
  p.context.window.focus();
  assert.equal(rows()[1].key, 'Ctrl+Shift+P', 'the new key shows when the reader returns to the tab');
  assert.equal(rows().length, 2, 'repainting replaces the rows');
  p.get('changeShortcuts').click();
  assert.deepEqual(created, ['chrome://extensions/shortcuts']);
});

test('shortcuts: a browser without the commands API leaves the page working', () => {
  const p = page({}, true);
  delete p.context.chrome.commands;
  assert.doesNotThrow(() => p.run('wireShortcuts()'));
});

test('Check my backups: a database that does not answer is reported, not silently skipped', async () => {
  const data = { googleProfile: { ...ann, at: 1 } };
  const p = page({ initial: data, readSync: () => backupOf(data) });
  p.context.chrome.runtime.sendMessage = async () => undefined;
  p.run('wireBackup()');
  await tick(); await tick();
  await p.get('checkBackups').click();
  const out = lines(p);
  assert.equal(out.length, 3);
  assert.match(out[2].text, /^Google copy: could not be read\.$/);
  assert.equal(out[2].bad, true);
});

test('the automatic-saving switch lives with the signed-in controls, so it is not offered before signing in', () => {
  const html = fs.readFileSync('src/options/options.html', 'utf8');
  const signedIn = html.slice(html.indexOf('id="accountSignedIn"'), html.indexOf('id="accountStatus"'));
  for (const id of ['googleAutoSave', 'googleSaveStatus', 'accountSave', 'accountLoad']) assert.ok(signedIn.includes(`id="${id}"`), `${id} is inside the signed-in block`);
  const signedOut = html.slice(html.indexOf('id="accountSignedOut"'), html.indexOf('id="accountSignedIn"'));
  assert.ok(signedOut.includes('id="accountSignIn"') && !signedOut.includes('googleAutoSave'));
});

// ---------------------------------------------------------------- importing a settings file
test('importing a settings file never turns on a switch that sends data, but applies everything else', async () => {
  const p = page({ initial: { sendDiagnostics: false, sharedProducts: false, shareContributions: false } }, true);
  const file = JSON.stringify(prefs.backupPayload({
    ratePace: 'fast', sortCount: 300, hoverScore: true, allergens: ['milk'],
    sendDiagnostics: true, shareContributions: true, sharedProducts: true,
  }));
  const input = p.get('importFile');
  p.run('renderAll = () => {}');   // painting the page is not what is under test
  p.run('wireFileActions()');
  input.files = [{ size: file.length, text: async () => file }];
  await input.change();
  await tick(); await tick();
  assert.equal(p.data.ratePace, 'fast');
  assert.equal(p.data.sortCount, 300);
  assert.equal(p.data.hoverScore, true);
  for (const k of ['sendDiagnostics', 'shareContributions', 'sharedProducts']) {
    assert.notEqual(p.data[k], true, `${k} stays as this reader set it`);
  }
  assert.deepEqual(prefs.SHARING_KEYS.slice().sort(), ['sendDiagnostics', 'shareContributions', 'sharedProducts']);
});

test('the sharing checkboxes follow storage when a restore or another page changes them', async () => {
  const p = page({ initial: {} });
  p.run('wireDatabase()');
  await tick();
  const listener = p.changed[p.changed.length - 1];
  listener({ sharedCache: { newValue: false }, sendDiagnostics: { newValue: true } }, 'local');
  assert.equal(p.get('sharedCache').checked, false);
  assert.equal(p.get('sendDiagnostics').checked, true);
  listener({ sharedCache: { newValue: 'garbage' } }, 'local');
  assert.equal(p.get('sharedCache').checked, true, 'a bad value heals to the default');
  listener({ sharedCache: { newValue: false } }, 'sync');
  assert.equal(p.get('sharedCache').checked, true, 'sync storage changes are not these');
});

// ---------------------------------------------------------------- feedback every level can see
test('"Saved" and errors go to a toast outside every level-gated section, announced to screen readers', () => {
  const html = fs.readFileSync('src/options/options.html', 'utf8');
  const at = html.indexOf('id="status"');
  assert.ok(at > html.lastIndexOf('</section>'), 'the status line is not inside any section a level can hide');
  const tag = html.slice(html.lastIndexOf('<p', at), html.indexOf('>', at));
  assert.match(tag, /role="status"/);
  assert.match(tag, /aria-live="polite"/);
  assert.match(tag, /class="status toast"/);
  const p = page({}, true);
  p.run("flash('Could not save', 'error')");
  assert.equal(p.get('status').className, 'status toast error');
  assert.equal(p.get('status').textContent, 'Could not save');
  p.run("flash('Saved')");
  assert.equal(p.get('status').className, 'status toast');
});

test('every radio group on the settings and setup pages has an accessible name', () => {
  for (const file of ['src/options/options.html', 'src/options/welcome.html']) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<(?:fieldset|div)\b[^>]*?(?:role="radiogroup"|class="sort-choices")[^>]*>/g)) {
      const tag = m[0];
      const hasLegend = /<fieldset/.test(tag) && html.slice(m.index, m.index + 400).includes('<legend');
      const labelled = /aria-labelledby="([^"]+)"/.exec(tag);
      assert.ok(hasLegend || labelled, `${file}: unnamed group ${tag.slice(0, 70)}`);
      if (labelled) assert.ok(html.includes(`id="${labelled[1]}"`), `${file}: ${labelled[1]} exists`);
    }
  }
});

// ---------------------------------------------------------------- links into level-hidden sections
function levelPage(level, hash, section) {
  const p = page({ initial: { settingsLevel: level, onboarded: true } }, true);
  const c = p.context;
  c.location.hash = hash;
  const scrolled = [];
  const real = c.document.getElementById;
  c.document.getElementById = id => (section && id === section.id ? { dataset: { level: String(section.level) }, scrollIntoView: () => scrolled.push(id) } : real(id));
  c.chrome.storage.local.set = (values, cb) => { p.writes.push({ values }); Object.assign(p.data, values); if (cb) cb(); };
  p.run('wireLevel()');
  return { p, scrolled };
}

test('a link into a section the level hides raises the level just enough, says so, and scrolls there', async () => {
  const { p, scrolled } = levelPage('minimal', '#sec-sort', { id: 'sec-sort', level: 2 });
  await tick();
  assert.equal(p.data.settingsLevel, 'standard', 'raised to what the section needs, no further');
  assert.deepEqual(scrolled, ['sec-sort']);
  assert.match(p.get('status').textContent, /Showing more settings/);
});

test('a link to a section the level already shows changes nothing but the scroll', async () => {
  const { p, scrolled } = levelPage('advanced', '#sec-sort', { id: 'sec-sort', level: 2 });
  await tick();
  assert.equal(p.data.settingsLevel, 'advanced');
  assert.deepEqual(scrolled, ['sec-sort']);
  assert.equal(p.get('status').textContent, '');
});

test('no link, an unknown anchor, or an anchor with no level never moves the level', async () => {
  for (const [hash, section] of [['', null], ['#nowhere', null], ['#sec-level', { id: 'sec-level', level: 0 }]]) {
    const { p } = levelPage('simple', hash, section);
    await tick();
    assert.equal(p.data.settingsLevel, 'simple', hash || 'no hash');
  }
});
