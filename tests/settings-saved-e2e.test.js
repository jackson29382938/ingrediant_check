// End to end: every setting is saved, at every step, for the Chrome profile and the Google account.
//
// The real service worker (the scripts Chrome loads, tests/worker-scripts.js) runs against in-memory
// chrome.storage.local and chrome.storage.sync (with Chrome's 8 KB item limit) and the real Apps Script
// (docs/apps-script.gs, tests/receiver-harness.js) with a simulated Gmail account behind Google's
// tokeninfo. Each setting is changed on its own and the saved copies are read back and compared with
// what the browser holds, so a setting that is stored but never backed up, or backed up but lost on
// restore, fails here by name.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');
const { loadWorker } = require('./worker-scripts.js');
const { receiver } = require('./receiver-harness.js');

const GMAIL = { token: 'g'.repeat(40), sub: 'gmail-1001', email: 'tester@gmail.com' };
const OTHER = { token: 'h'.repeat(40), sub: 'gmail-2002', email: 'someone.else@gmail.com' };
const PROFILE = { email: GMAIL.email, name: 'Test Er', picture: 'https://lh3.googleusercontent.com/a/x', at: 1 };
const drain = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const json = v => JSON.parse(JSON.stringify(v));

// --------------------------------------------------------------------------- the world
// A Chrome profile: its sync storage can be shared by several computers (worlds); local storage,
// the worker and the timers belong to one computer.
function newProfile() { return { sync: {}, syncBytes: () => 0 }; }

function area(name, store, quota, fire) {
  const listAll = keys => (keys == null ? Object.keys(store)
    : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
  const guard = values => {
    if (!quota) return;
    for (const [k, v] of Object.entries(values)) {
      const bytes = k.length + JSON.stringify(v).length;
      if (bytes > quota) throw new Error(`QUOTA_BYTES_PER_ITEM exceeded: ${k} is ${bytes} bytes`);
    }
  };
  return {
    data: store,
    async get(keys, cb) {
      const out = {};
      for (const k of listAll(keys)) if (k in store) out[k] = json(store[k]);
      if (typeof cb === 'function') { cb(out); return undefined; }
      return out;
    },
    async set(values, cb) {
      guard(values);
      const changes = {};
      for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: store[k], newValue: json(v) }; store[k] = json(v); }
      fire(changes, name);
      if (typeof cb === 'function') cb();
    },
    async remove(keys, cb) {
      const changes = {};
      for (const k of [].concat(keys)) { if (k in store) changes[k] = { oldValue: store[k] }; delete store[k]; }
      fire(changes, name);
      if (typeof cb === 'function') cb();
    },
  };
}

function world({ profile = newProfile(), db = receiver({ clientId: prefs.OAUTH_CLIENT_ID, tokens: {
  [GMAIL.token]: { aud: prefs.OAUTH_CLIENT_ID, azp: prefs.OAUTH_CLIENT_ID, sub: GMAIL.sub, email: GMAIL.email, expires_in: '3500' },
  [OTHER.token]: { aud: prefs.OAUTH_CLIENT_ID, azp: prefs.OAUTH_CLIENT_ID, sub: OTHER.sub, email: OTHER.email, expires_in: '3500' } } }),
account = GMAIL, local = {}, signedIn = true } = {}) {
  const listeners = [];
  const fire = (changes, areaName) => { if (Object.keys(changes).length) for (const l of listeners.slice()) l(changes, areaName); };
  const timers = [];
  let timerId = 0;
  const alarms = [];
  const cleared = [];
  const state = { account, silentWorks: signedIn, permission: true, authCalls: [], posts: [], network: true, onMessage: null, hold: false, holds: [] };
  const localArea = area('local', local, 0, fire);
  const syncArea = area('sync', profile.sync, 8192, fire);
  const sessionData = {};
  const sandbox = {
    console, URL, URLSearchParams, AbortSignal, AbortController, Promise,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.push({ id, fn, ms }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    fetch: async (url, options) => {
      if (!state.network) throw new Error('offline');
      assert.equal(String(url), prefs.endpoint(), `the worker may only call the database: ${url}`);
      const body = JSON.parse(options.body);
      if (state.hold) await new Promise(resolve => state.holds.push(resolve));
      state.posts.push(body.kind);
      const out = db.post(body);
      return { ok: true, status: 200, json: async () => out };
    },
    chrome: {
      runtime: { id: 'ext', lastError: undefined, getManifest: () => ({ version: '9.9.9' }), getURL: p => `chrome-extension://ext/${p}`,
        sendMessage: async () => ({}), getContexts: async () => [],
        onMessage: { addListener(fn) { state.onMessage = fn; } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
      alarms: { create: name => alarms.push(name), clear: async name => { cleared.push(name); return true; }, get: (n, cb) => cb(undefined), onAlarm: { addListener(fn) { state.onAlarm = fn; } } },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      tabs: { create: async () => ({ id: 1 }), sendMessage: async () => ({ ok: true }) },
      sidePanel: { open: async () => {} },
      commands: { onCommand: { addListener() {} } },
      permissions: { contains: async () => state.permission },
      identity: {
        getRedirectURL: () => 'https://ext.chromiumapp.org/',
        launchWebAuthFlow({ url, interactive }, cb) {
          const u = new URL(url);
          state.authCalls.push({ interactive, prompt: u.searchParams.get('prompt'), scope: u.searchParams.get('scope') });
          if (!interactive && !state.silentWorks) { sandbox.chrome.runtime.lastError = { message: 'User interaction required.' }; cb(undefined); sandbox.chrome.runtime.lastError = undefined; return; }
          cb(`https://ext.chromiumapp.org/#state=${u.searchParams.get('state')}&access_token=${state.account.token}&token_type=Bearer&expires_in=3500`);
        },
      },
      storage: { local: localArea, sync: syncArea,
        session: { get: async () => ({}), set: async v => Object.assign(sessionData, v) },
        onChanged: { addListener: fn => listeners.push(fn) } },
    },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  loadWorker(vm, context);
  const w = {
    state, db, profile, local: localArea, sync: syncArea, alarms, cleared,
    // A change made on the settings page: written, then the worker's debounce timers run.
    async change(values) { await localArea.set(values); await w.settle(); },
    async settle() { await drain(); while (timers.length) { const t = timers.shift(); t.fn(); await drain(); } await drain(); },
    send(msg, sender = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' }) {
      return new Promise(resolve => { const keep = state.onMessage(msg, sender, resolve); if (keep !== true) resolve(undefined); });
    },
    pending: () => timers.length,
    // Chrome suspended the worker: its timers are gone, only alarms survive.
    dropTimers: () => { timers.length = 0; },
    // Fire what is due now without waiting for the work to finish (for tests that hold a request open).
    fire: () => { for (const t of timers.splice(0)) t.fn(); },
    fireAlarm: name => state.onAlarm({ name }),
    // What this computer has, as the settings page would read it.
    snapshot: () => prefs.settingsSnapshot(local),
    // The Google copy as the database serves it, opened with this account's token.
    async googleCopy(token = GMAIL.token) {
      const out = db.post({ kind: 'accountGet', token });
      return out.payload ? prefs.parseBackup(out.payload) : { ok: false, reason: 'no-backup' };
    },
  };
  if (signedIn) local.googleProfile = { ...PROFILE };
  return w;
}

// --------------------------------------------------------------------------- one non-default value per setting
const TOGGLE_FLIPS = Object.fromEntries(Object.entries(prefs.TOGGLE_DEFAULTS)
  .filter(([k]) => k !== 'enabled').map(([k, v]) => [k, !v]));
const VARIANTS = {
  weights: { sugar: 1.7, sodium: 0.4 },
  goals: ['weightLoss'],
  goalImportance: { weightLoss: 2 },
  allergens: ['milk', 'egg'],
  diets: ['vegan'],
  avoidList: ['palm oil', 'red 40'],
  speedMode: 'fast',
  ratePace: 'quick',
  sortMissing: 'end',
  sortLoadMore: true,
  sortCount: 250,
  sortTimeLimit: 30,
  sortPriorities: { health: { health: 3, unitPrice: 9, price: 1, rating: 2, reviews: 4 } },
  unitMissing: 'infer-more',
  breakdownDetail: 'compact',
  breakdownDelayMs: 500,
  scoreHoverDelayMs: 1000,
  settingsLevel: 'simple',
  theme: 'dark',
  palette: 'cvd',
  accent: '#7a3fa6',
  ...TOGGLE_FLIPS,
};
// Turning these off changes what is saved, so each has its own test below.
const OWN_TEST = new Set(['settingsBackup', 'googleAutoSave']);
const SETTINGS = prefs.SETTING_KEYS.filter(k => k !== 'enabled');
const LOOP_KEYS = SETTINGS.filter(k => !OWN_TEST.has(k));
// foodOnly is a toggle and a scoring key; its flip comes from TOGGLE_FLIPS.

// The settings, spelled out. Written by hand on purpose: if a setting is dropped from the code that
// builds backups, it would also vanish from every list derived from that code and nothing would
// notice. Adding a setting means adding it here, with a test value above.
const EXPECTED_KEYS = ['accent', 'allergens', 'autoScoreSearch', 'avoidList', 'badges', 'breakdownDelayMs', 'breakdownDetail',
  'diets', 'foodOnly', 'goalImportance', 'goals', 'googleAutoSave', 'hoverBreakdown', 'hoverScore', 'ocrLabels',
  'palette', 'panelOpen', 'pointsEnabled', 'ratePace', 'scoreHoverDelayMs', 'sendDiagnostics', 'settingsBackup', 'settingsLevel',
  'shareContributions', 'sharedCache', 'sharedProducts', 'sortCount', 'sortLoadMore', 'sortMissing',
  'sortPriorities', 'sortRemember', 'sortTimeLimit', 'speedMode', 'theme', 'unitMissing', 'unitPrice', 'useOpenFoodFacts', 'weights'];

// What a saved copy must hold for `key` after VARIANTS[key] was set, judged against the test value
// itself rather than against the code under test. A key missing from the copy fails here.
function holds(values, key, label) {
  assert.ok(key in values, `${label}: ${key} is missing from the copy`);
  if (key === 'weights') {
    assert.equal(values.weights.sugar, 1.7, `${label}: weights.sugar`);
    assert.equal(values.weights.sodium, 0.4, `${label}: weights.sodium`);
    return;
  }
  assert.deepEqual(json(values[key]), json(VARIANTS[key]), `${label}: ${key} holds the changed value`);
}
// Every setting has an entry in the copy at all, changed or not.
const absent = values => SETTINGS.filter(k => !(k in values));

// --------------------------------------------------------------------------- the settings themselves
test('every setting has a test value that really differs from its default after sanitizing', () => {
  const base = prefs.settingsSnapshot({});
  const missing = SETTINGS.filter(k => !(k in VARIANTS));
  assert.deepEqual(missing, [], `add a test value for: ${missing.join(', ')}`);
  for (const k of SETTINGS) {
    assert.notEqual(JSON.stringify(prefs.settingsSnapshot({ [k]: VARIANTS[k] })[k]), JSON.stringify(base[k]),
      `${k}: the test value is sanitized back to the default, so it would prove nothing`);
  }
  assert.ok(SETTINGS.length >= 30, 'the list of settings is not unexpectedly short');
  assert.ok(!SETTINGS.includes('googleProfile') && !SETTINGS.includes('oauthClientId') && !SETTINGS.includes('googleLinked'),
    'sign-in details are never part of a backup');
});

test('the set of settings is exactly the one written down here', () => {
  assert.deepEqual([...SETTINGS].sort(), [...EXPECTED_KEYS].sort(),
    'a setting was added or dropped: update EXPECTED_KEYS and VARIANTS, and check backups and the settings file carry it');
});

test('every control on the settings page is a saved setting, or is listed here as not one', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'options', 'options.html'), 'utf8');
  const controls = new Set();
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    const type = (m[1].match(/type="(\w+)"/) || [])[1] || 'text';
    const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
    const name = (m[1].match(/\bname="([^"]+)"/) || [])[1];
    controls.add(type === 'radio' && name ? name : id);
  }
  for (const m of html.matchAll(/<(?:select|textarea)\b[^>]*\bid="([^"]+)"/g)) controls.add(m[1]);
  // Not settings: a file picker, a filter box, the store request form, the sign-in client id (kept
  // on purpose out of backups) and the depth choice, which is the sort count and load-more together.
  const notSettings = new Set(['importFile', 'catFilter', 'reqName', 'reqUrl', 'oauthClientId', 'sortDepth']);
  const unsaved = [...controls].filter(c => c && !notSettings.has(c) && !SETTINGS.includes(c));
  assert.deepEqual(unsaved, [], `these controls are not part of any backup: ${unsaved.join(', ')}`);
  assert.ok(controls.size > 25, 'the scan found the page controls');
});

// --------------------------------------------------------------------------- Chrome profile backup
test('Chrome profile: every setting, changed one at a time, is in the profile backup and survives a restore', async () => {
  const w = world();
  await w.settle();
  const steps = [];
  for (const key of LOOP_KEYS) {
    await w.change({ [key]: VARIANTS[key] });
    const got = await prefs.readSync(w.sync);
    assert.equal(got.ok, true, `${key}: a readable backup exists after the change (${got.reason})`);
    const d = prefs.diffSettings(w.local.data, got.values);
    assert.deepEqual(d.differing, [], `${key}: the profile backup differs from this browser in ${d.differing.join(', ')}`);
    holds(got.values, key, `${key} (Chrome profile backup)`);
    assert.deepEqual(absent(got.values), [], `${key}: the Chrome profile backup is missing settings`);
    steps.push(key);
  }
  assert.deepEqual(steps, LOOP_KEYS, 'every step was checked');
  const status = w.local.data.backupStatus;
  assert.equal(status.ok, true);

  // Another computer on the same Chrome profile starts empty, restores, and ends up identical.
  const other = world({ profile: w.profile, signedIn: false });
  const copy = await prefs.readSync(other.sync);
  assert.equal(copy.ok, true);
  await other.local.set(copy.values);
  const d = prefs.diffSettings(other.local.data, (await prefs.readSync(w.sync)).values);
  assert.deepEqual(d.differing, []);
  assert.deepEqual(json(other.snapshot()), json(w.snapshot()), 'the restored computer holds every setting');
  for (const key of LOOP_KEYS) holds(other.snapshot(), key, `${key} (restored computer)`);
});

test('Chrome profile: a different Chrome profile never sees this profile\'s backup', async () => {
  const w = world();
  await w.change({ ratePace: 'fast' });
  assert.equal((await prefs.readSync(w.sync)).ok, true);
  const elsewhere = world({ signedIn: false });
  assert.equal((await prefs.readSync(elsewhere.sync)).reason, 'no-backup');
});

test('Chrome profile: the backup fits Chrome sync limits even with everything set and a full avoid list', async () => {
  const w = world();
  const every = Object.fromEntries(LOOP_KEYS.map(k => [k, VARIANTS[k]]));
  every.avoidList = Array.from({ length: 80 }, (_, i) => `ingredient ${i} ${'x'.repeat(60)}`);
  every.weights = Object.fromEntries(Object.keys(prefs.settingsSnapshot({}).weights).map(k => [k, 1.9]));
  await w.change(every);
  const got = await prefs.readSync(w.sync);
  assert.equal(got.ok, true, got.reason);
  assert.equal(w.local.data.backupStatus.ok, true, 'no item exceeded the sync quota');
  assert.deepEqual(prefs.diffSettings(w.local.data, got.values).differing, []);
  assert.equal(got.values.avoidList.length, 80);
});

test('Chrome profile: switching the backup off keeps the last copy; switching it on writes again at once', async () => {
  const w = world();
  await w.change({ ratePace: 'fast' });
  const before = json(await prefs.readSync(w.sync));
  await w.change({ settingsBackup: false });
  await w.change({ sortCount: 400 });
  const during = await prefs.readSync(w.sync);
  assert.equal(during.values.sortCount, before.values.sortCount, 'nothing was written while it was off');
  assert.equal(during.values.ratePace, 'fast', 'and the previous copy is still readable');
  await w.change({ settingsBackup: true });
  const after = await prefs.readSync(w.sync);
  assert.equal(after.values.sortCount, 400, 'turning it back on saves what changed meanwhile');
  assert.deepEqual(prefs.diffSettings(w.local.data, after.values).differing, []);
});

test('Chrome profile: a failed write keeps the old copy and says so; the next change recovers', async () => {
  const w = world();
  await w.change({ ratePace: 'fast' });
  const good = json(await prefs.readSync(w.sync));
  const set = w.sync.set;
  w.sync.set = async () => { throw new Error('sync is unavailable'); };
  await w.change({ sortCount: 123 });
  assert.equal(w.local.data.backupStatus.ok, false);
  assert.equal(json(await prefs.readSync(w.sync)).values.ratePace, good.values.ratePace, 'the previous copy is intact');
  w.sync.set = set;
  await w.change({ sortCount: 124 });
  assert.equal(w.local.data.backupStatus.ok, true);
  assert.equal((await prefs.readSync(w.sync)).values.sortCount, 124);
});

test('Chrome profile: the master switch is never carried, so a restore cannot leave a computer paused', async () => {
  const w = world();
  await w.change({ enabled: false, ratePace: 'fast' });
  const got = await prefs.readSync(w.sync);
  assert.ok(!('enabled' in got.values));
  assert.equal(got.values.ratePace, 'fast');
});

// --------------------------------------------------------------------------- Google account (Gmail)
async function linked(w) {
  // The first save from this computer: signing in has happened, the reader presses Save.
  const reply = await w.send({ type: 'accountSave', token: GMAIL.token });
  assert.deepEqual(json(reply), { ok: true });
  assert.equal(w.local.data.googleLinked, true, 'saving links this computer to the account');
  return reply;
}

test('Google: before this computer has saved or restored once, nothing is written automatically', async () => {
  const w = world();
  await w.change({ ratePace: 'fast', sortCount: 222 });
  assert.deepEqual(w.state.posts, [], 'no request reached the database');
  assert.deepEqual(w.state.authCalls, [], 'and Google was not even asked for a token');
  assert.equal((await w.googleCopy()).ok, false, 'a new computer cannot overwrite a saved copy with its defaults');
});

test('Google: Save writes the whole settings copy to the Gmail account and shows it saved', async () => {
  const w = world();
  await w.change({ ratePace: 'quick', allergens: ['milk'] });
  await linked(w);
  assert.equal(w.local.data.googleBackupStatus.ok, true);
  const copy = await w.googleCopy();
  assert.equal(copy.ok, true);
  assert.deepEqual(prefs.diffSettings(w.local.data, copy.values).differing, []);
  assert.equal(w.db.tabs.get('accounts').data.length, 2, 'one header and one row');
  const row = JSON.stringify(w.db.tabs.get('accounts').data[1]);
  assert.ok(!row.includes(GMAIL.email) && !row.includes(GMAIL.sub), 'the row is keyed by a hash: no email, no raw account id');
  assert.ok(!JSON.stringify(copy).includes(GMAIL.email));
});

test('Google: every setting, changed one at a time while signed in, reaches the Gmail copy automatically', async () => {
  const w = world();
  await linked(w);
  const writes = [];
  for (const key of LOOP_KEYS) {
    const before = w.state.posts.length;
    await w.change({ [key]: VARIANTS[key] });
    assert.ok(w.state.posts.length > before, `${key}: a save reached the database`);
    const copy = await w.googleCopy();
    assert.equal(copy.ok, true, `${key}: the Google copy is readable`);
    const d = prefs.diffSettings(w.local.data, copy.values);
    assert.deepEqual(d.differing, [], `${key}: the Google copy differs from this browser in ${d.differing.join(', ')}`);
    holds(copy.values, key, `${key} (Google copy)`);
    assert.deepEqual(absent(copy.values), [], `${key}: the Google copy is missing settings`);
    writes.push(key);
  }
  assert.deepEqual(writes, LOOP_KEYS);
  assert.ok(w.state.authCalls.every(c => c.interactive === false && c.prompt === 'none'), 'every automatic save asked Google without opening a window');
  assert.ok(w.state.authCalls.every(c => c.scope === 'openid email profile'));
  assert.equal(w.local.data.googleBackupStatus.ok, true);
});

test('Google: a burst of changes is saved once, a few seconds later, with the latest values', async () => {
  const w = world();
  await linked(w);
  const start = w.state.posts.length;
  await w.local.set({ sortCount: 111 });
  await w.local.set({ sortCount: 222 });
  await w.local.set({ sortCount: 333 });
  assert.equal(w.state.posts.length, start, 'nothing is sent while the changes keep coming');
  assert.equal(w.pending() >= 1, true);
  await w.settle();
  assert.equal(w.state.posts.length - start, 1, 'one save for the burst');
  assert.equal((await w.googleCopy()).values.sortCount, 333);
});

test('Google: when Google needs the reader again, saving pauses with a clear status and opens no window', async () => {
  const w = world();
  await linked(w);
  w.state.silentWorks = false;
  const before = w.state.posts.length;
  await w.change({ ratePace: 'fast' });
  assert.equal(w.state.posts.length, before, 'nothing was sent');
  assert.deepEqual(w.local.data.googleBackupStatus.reason, 'needs-sign-in');
  assert.equal(w.local.data.googleBackupStatus.ok, false);
  assert.ok(w.state.authCalls.every(c => c.interactive === false), 'the worker never opens a sign-in window');
  // The reader signs in again by pressing Save, and automatic saving resumes.
  await w.send({ type: 'accountSave', token: GMAIL.token });
  w.state.silentWorks = true;
  await w.change({ ratePace: 'gentle' });
  assert.equal(w.local.data.googleBackupStatus.ok, true);
  assert.equal((await w.googleCopy()).values.ratePace, 'gentle');
});

test('Google: the identity permission being withdrawn pauses saving the same way', async () => {
  const w = world();
  await linked(w);
  w.state.permission = false;
  const before = w.state.posts.length;
  await w.change({ ratePace: 'fast' });
  assert.equal(w.state.posts.length, before);
  assert.equal(w.local.data.googleBackupStatus.reason, 'needs-sign-in');
});

test('Google: automatic saving can be turned off, and signing out stops it', async () => {
  const w = world();
  await linked(w);
  await w.change({ googleAutoSave: false });
  const before = w.state.posts.length;
  await w.change({ ratePace: 'fast' });
  assert.equal(w.state.posts.length, before, 'off means off');
  await w.change({ googleAutoSave: true });
  await w.change({ ratePace: 'gentle' });
  assert.equal((await w.googleCopy()).values.ratePace, 'gentle', 'on again: saved');
  // Signing out removes the profile and the link.
  await w.local.remove(['googleProfile', 'googleLinked', 'googleBackupStatus']);
  const after = w.state.posts.length;
  await w.change({ ratePace: 'quick' });
  assert.equal(w.state.posts.length, after, 'signed out: nothing is sent');
  assert.equal((await w.googleCopy()).values.ratePace, 'gentle', 'the saved copy is left as it was');
});

test('Google: an unreachable database is reported and never loses the local settings', async () => {
  const w = world();
  await linked(w);
  w.state.network = false;
  await w.change({ sortCount: 321 });
  assert.equal(w.local.data.googleBackupStatus.ok, false);
  assert.equal(w.local.data.sortCount, 321, 'the setting itself is untouched');
  assert.equal((await prefs.readSync(w.sync)).values.sortCount, 321, 'and the Chrome profile backup still has it');
  w.state.network = true;
  await w.change({ sortCount: 322 });
  assert.equal(w.local.data.googleBackupStatus.ok, true);
  assert.equal((await w.googleCopy()).values.sortCount, 322);
});

test('Google: a second computer restores the Gmail copy, matches it exactly, and then saves automatically', async () => {
  const a = world();
  const every = Object.fromEntries(LOOP_KEYS.map(k => [k, VARIANTS[k]]));
  await a.change(every);
  await linked(a);

  const b = world({ db: a.db, profile: newProfile() });   // another computer, another Chrome profile
  assert.deepEqual(prefs.diffSettings(b.local.data, (await a.googleCopy()).values).differing.length > 0, true, 'it starts different');
  await b.change({ ratePace: 'gentle' });
  assert.deepEqual(b.state.posts, [], 'and writes nothing before the reader chooses');
  const restored = await b.send({ type: 'accountLoad', token: GMAIL.token });
  assert.equal(restored.ok, true);
  assert.equal(b.local.data.googleLinked, true);
  const d = prefs.diffSettings(b.local.data, (await a.googleCopy()).values);
  assert.deepEqual(d.differing, [], `after restoring, this computer matches the Google copy (${d.differing.join(', ')})`);
  assert.deepEqual(json(b.snapshot()), json(a.snapshot()));
  for (const key of LOOP_KEYS) holds(b.snapshot(), key, `${key} (second computer)`);
  await b.change({ sortCount: 77 });
  assert.equal((await a.googleCopy()).values.sortCount, 77, 'and now it saves automatically too');
});

test('Google: two Gmail accounts never see each other\'s settings', async () => {
  const a = world();
  await linked(a);
  await a.change({ allergens: ['milk'] });
  const copyForOther = await a.googleCopy(OTHER.token);
  assert.equal(copyForOther.ok, false, 'a different account has no copy');
  const b = world({ db: a.db, account: OTHER, signedIn: false });
  b.local.data.googleProfile = { ...PROFILE, email: OTHER.email };
  const saved = await b.send({ type: 'accountSave', token: OTHER.token });
  assert.equal(saved.ok, true);
  assert.equal(a.db.tabs.get('accounts').data.length, 3, 'two rows, one per account');
  assert.deepEqual((await a.googleCopy(GMAIL.token)).values.allergens, ['milk']);
  assert.deepEqual((await a.googleCopy(OTHER.token)).values.allergens, [], 'the other account kept its own');
});

test('Google: a token that was not issued to this extension is refused and changes nothing', async () => {
  const w = world();
  const forged = 'z'.repeat(40);
  const reply = await w.send({ type: 'accountSave', token: forged });
  assert.equal(reply.ok, false);
  assert.match(String(reply.reason), /token rejected/);
  assert.equal(w.local.data.googleLinked, undefined, 'a refused save does not link the computer');
  assert.equal(w.local.data.googleBackupStatus.ok, false);
});

test('Google: the saved copy never carries sign-in details, caches or the master switch', async () => {
  const w = world();
  await w.local.set({ oauthClientId: 'x.apps.googleusercontent.com', backupDeviceId: 'a'.repeat(32), 's:amazon.com:B000000001': { score: 80 } });
  await linked(w);
  // Paused: the master switch stops every request, saving included, and is never part of a copy.
  await w.change({ enabled: false, ratePace: 'fast' });
  const paused = w.state.posts.length;
  await w.change({ ratePace: 'gentle' });
  assert.equal(w.state.posts.length, paused, 'while paused, nothing is sent to the database');
  await w.change({ enabled: true });
  await w.change({ ratePace: 'quick' });
  const text = JSON.stringify(w.db.tabs.get('accounts').data);
  for (const secret of ['googleProfile', 'tester@gmail.com', 'oauthClientId', 'backupDeviceId', 'B000000001', GMAIL.token]) {
    assert.ok(!text.includes(secret), `${secret} is not in the saved copy`);
  }
  const copy = await w.googleCopy();
  assert.ok(!('enabled' in copy.values));
  assert.equal(copy.values.ratePace, 'quick', 'after resuming, saving carries on');
});

test('Google: the copy stays within the size one spreadsheet cell holds, even with everything set', async () => {
  const w = world();
  const every = Object.fromEntries(LOOP_KEYS.map(k => [k, VARIANTS[k]]));
  every.avoidList = Array.from({ length: 80 }, (_, i) => `ingredient ${i} ${'x'.repeat(60)}`);
  await w.change(every);
  await linked(w);
  const row = w.db.tabs.get('accounts').data[1];
  assert.ok(row.every(cell => String(cell).length < 50000), 'no cell reaches the 50,000 character limit');
});

test('both copies agree with each other and with the browser after a long mixed session', async () => {
  const w = world();
  await linked(w);
  const ops = [
    { ratePace: 'gentle' }, { allergens: ['milk'] }, { weights: { sugar: 0.2 } }, { goals: ['weightLoss'] },
    { sortLoadMore: true, sortCount: 300 }, { allergens: [] }, { settingsLevel: 'advanced' }, { avoidList: ['a1', 'b2'] },
    { panelOpen: true }, { hoverScore: true }, { sortPriorities: VARIANTS.sortPriorities }, { ratePace: 'fast' },
    { avoidList: [] }, { goals: [] }, { speedMode: 'freshest' }, { sortTimeLimit: 0 },
  ];
  for (const [i, op] of ops.entries()) {
    await w.change(op);
    const profileCopy = await prefs.readSync(w.sync);
    const googleCopy = await w.googleCopy();
    assert.deepEqual(prefs.diffSettings(w.local.data, profileCopy.values).differing, [], `step ${i + 1} ${JSON.stringify(op)}: Chrome profile copy`);
    assert.deepEqual(prefs.diffSettings(w.local.data, googleCopy.values).differing, [], `step ${i + 1} ${JSON.stringify(op)}: Google copy`);
  }
});

// --------------------------------------------------------------------------- who may ask the worker
test('account messages carry a Google token, so only the pages meant to send them are heard', async () => {
  const w = world();
  const settings = { id: 'ext', url: 'chrome-extension://ext/src/options/options.html' };
  const welcome = { id: 'ext', url: 'chrome-extension://ext/src/options/welcome.html' };
  const popup = { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' };
  const amazon = { id: 'ext', tab: { id: 3, url: 'https://www.amazon.com/s?k=oats' }, url: 'https://www.amazon.com/s?k=oats' };
  const stranger = { id: 'another-extension', url: 'chrome-extension://another-extension/options.html' };
  const heard = async (type, sender) => (await w.send({ type, token: GMAIL.token }, sender)) !== undefined;

  assert.equal(await heard('accountSave', settings), true);
  assert.equal(await heard('accountSave', welcome), true, 'setup may save after its Google step');
  for (const type of ['accountLoad', 'accountFetch']) {
    assert.equal(await heard(type, settings), true, `${type} from settings`);
  }
  assert.equal(await heard('accountFetch', welcome), true, 'setup may look for a saved copy before writing one');
  assert.equal(await heard('accountLoad', welcome), false, 'but never restores: that overwrites this computer');
  for (const type of ['accountSave', 'accountLoad', 'accountFetch']) {
    for (const [name, sender] of [['popup', popup], ['an Amazon page', amazon], ['another extension', stranger]]) {
      assert.equal(await heard(type, sender), false, `${type} from ${name} is ignored`);
    }
  }
});

test('Check my backups can read the Google copy but never changes this computer', async () => {
  const w = world();
  await w.change({ ratePace: 'fast', allergens: ['milk'] });
  await linked(w);
  const other = world({ db: w.db, profile: newProfile() });
  const before = json(other.local.data);
  const got = await other.send({ type: 'accountFetch', token: GMAIL.token });
  assert.equal(got.ok, true);
  assert.equal(got.values.ratePace, 'fast');
  assert.deepEqual(json(other.local.data), before, 'nothing was written locally');
  assert.equal(other.local.data.googleLinked, undefined, 'and fetching does not link the computer');
  const none = await other.send({ type: 'accountFetch', token: OTHER.token });
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'no-backup');
});

test('Google: a second save cannot start while the first is in flight, so the copy ends with the latest values', async () => {
  const w = world();
  await linked(w);
  w.state.hold = true;                       // every request now waits until the test lets it through
  await w.local.set({ sortCount: 111 });
  w.fire();
  await drain();
  assert.equal(w.state.holds.length, 1, 'the first save is waiting on the network');
  await w.local.set({ sortCount: 222, ratePace: 'fast' });
  w.fire();
  await drain();
  assert.equal(w.state.holds.length, 1, 'the second save has not started: saves never overlap, so an older one cannot land last');
  w.state.holds.shift()();                   // the first completes ...
  await drain();
  assert.equal(w.state.holds.length, 1, '... and only then does the second begin');
  w.state.hold = false;
  w.state.holds.shift()();
  await drain();
  await w.settle();
  const copy = await w.googleCopy();
  assert.equal(copy.values.sortCount, 222);
  assert.equal(copy.values.ratePace, 'fast');
  assert.deepEqual(prefs.diffSettings(w.local.data, copy.values).differing, []);
});

test('Google: if Chrome suspends the worker and its timer is lost, the alarm still saves the change', async () => {
  const w = world();
  await linked(w);
  await w.local.set({ sortCount: 345 });
  assert.ok(w.alarms.includes('ic-google-save'), 'an alarm was set alongside the timer');
  w.dropTimers();
  await drain();
  assert.notEqual((await w.googleCopy()).values.sortCount, 345, 'not saved yet: the timer is gone');
  await w.fireAlarm('ic-google-save');
  await drain();
  assert.equal((await w.googleCopy()).values.sortCount, 345, 'the alarm saved it');
});

test('Chrome profile: the same alarm fallback keeps the profile backup too', async () => {
  const w = world({ signedIn: false });
  await w.local.set({ sortCount: 456 });
  assert.ok(w.alarms.includes('ic-backup-retry'));
  w.dropTimers();
  await w.fireAlarm('ic-backup-retry');
  await drain();
  assert.equal((await prefs.readSync(w.sync)).values.sortCount, 456);
});

test('fallback alarms are cleared once a save is done, so a change is never saved twice', async () => {
  const w = world();
  await linked(w);
  const before = w.state.posts.length;
  await w.change({ sortCount: 150 });
  assert.equal(w.state.posts.length - before, 1, 'one save for the change');
  assert.ok(w.cleared.includes('ic-backup-retry'), 'the Chrome profile alarm was cleared after its save');
  assert.ok(w.cleared.includes('ic-google-save'), 'and so was the Google one');
  // The alarms were only there for a suspended worker; with them cleared, Chrome never fires them.
  assert.equal((await w.googleCopy()).values.sortCount, 150);
});

test('an unsigned or unlinked computer does not keep a Google alarm waiting', async () => {
  const w = world({ signedIn: false });
  await w.change({ sortCount: 151 });
  assert.deepEqual(w.state.posts, []);
  assert.ok(w.cleared.includes('ic-google-save'), 'nothing to save, so the alarm is cleared');
});

test('a Google save that failed on the network keeps its alarm for one more try, which then succeeds', async () => {
  const w = world();
  await linked(w);
  w.state.network = false;
  w.cleared.length = 0;
  await w.change({ sortCount: 152 });
  assert.equal(w.cleared.includes('ic-google-save'), false, 'a failure that may pass leaves the alarm');
  w.state.network = true;
  await w.fireAlarm('ic-google-save');
  await drain();
  assert.equal((await w.googleCopy()).values.sortCount, 152);
  assert.ok(w.cleared.includes('ic-google-save'), 'cleared after the retry succeeded');
});

test('Chrome profile: turning the backup off clears its alarm instead of leaving it to fire', async () => {
  const w = world({ signedIn: false });
  await w.change({ settingsBackup: false });
  w.cleared.length = 0;
  await w.change({ sortCount: 153 });
  assert.ok(w.cleared.includes('ic-backup-retry'));
});

test('first-run setup on a second computer cannot overwrite the Gmail copy another computer saved', async () => {
  const a = world();
  await a.change({ allergens: ['milk', 'egg'], sortCount: 321 });
  await linked(a);
  const b = world({ db: a.db, profile: newProfile(), signedIn: false });
  const welcome = { id: 'ext', url: 'chrome-extension://ext/src/options/welcome.html' };
  // What welcome.js does after Finish: look first; write only when there is no copy.
  const found = await b.send({ type: 'accountFetch', token: GMAIL.token }, welcome);
  assert.equal(found.ok, true, 'the existing copy is found');
  assert.deepEqual((await a.googleCopy()).values.allergens, ['milk', 'egg']);
  assert.equal(b.local.data.googleLinked, undefined, 'looking does not link the computer');
  // A first-ever account has nothing: that is the only case setup writes.
  const fresh = await b.send({ type: 'accountFetch', token: OTHER.token }, welcome);
  assert.equal(fresh.reason, 'no-backup');
});
