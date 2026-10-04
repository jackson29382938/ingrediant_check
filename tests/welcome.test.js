'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');
function setup(initial = {}, permission = true, auth = {}) {
  const elements = new Map();
  function element() {
    return { value: '', checked: false, disabled: false, hidden: false, dataset: {}, children: [],
      attributes: {}, querySelectorAll() { return this.children; },
      getAttribute(name) { return this.attributes[name]; },
      classList: { toggle() {} }, append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); }, setAttribute(name, value) { this.attributes[name] = String(value); }, focus() {},
      addEventListener(name, fn) { this[name] = fn; } };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const data = structuredClone(initial);
  let requests = 0;
  const backups = [];
  const air = { ...globalThis.AIR, googleAuth: { token: async () => { if (auth.pending) await auth.pending; if (auth.error) throw new Error(auth.error); return 'ephemeral-access-token'; } } };
  const context = vm.createContext({ AIR: air, console, location: { reload() { auth.reloaded = true; } },
    document: { getElementById: get, querySelectorAll: () => [], querySelector: () => element(), createElement: element },
    chrome: { identity: { getRedirectURL: () => 'https://test.chromiumapp.org/' }, runtime: { getURL: p => p, async sendMessage(message) { backups.push({ ...message, onboarded: data.onboarded }); if (auth.backupPending) await auth.backupPending; if (auth.backupError) throw new Error('offline'); return { ok: auth.backup !== false }; } }, i18n: { getMessage: () => '' }, tabs: { create() {}, getCurrent(cb) { cb({ id: 7 }); }, remove(id) { auth.closedTab = id; } },
      permissions: { request(_p, cb) { requests++; cb(auth.permission === undefined ? permission : auth.permission); }, remove(_p, cb) { cb(); } },
      storage: { local: { get(_keys, cb) { if (auth.initialReadError) context.chrome.runtime.lastError = { message: 'unavailable' }; cb(data); delete context.chrome.runtime.lastError; }, set(values, cb) { if (!auth.saveError) Object.assign(data, values); if (auth.saveError) context.chrome.runtime.lastError = { message: 'storage quota' }; cb(); delete context.chrome.runtime.lastError; } } } },
  });
  vm.runInContext(fs.readFileSync('src/options/welcome.js', 'utf8'), context);
  return { get, data, context, backups, requests: () => requests, finish: () => vm.runInContext('finish()', context) };
}
test('setup recommendations start checked and preserve existing opt-outs', () => {
  const fresh = setup();
  for (const id of ['autoScoreSearch', 'sharedCache', 'ocrLabels', 'useOpenFoodFacts']) assert.equal(fresh.get(id).checked, true);
  const previous = setup({ autoScoreSearch: false, useOpenFoodFacts: false });
  assert.equal(previous.get('autoScoreSearch').checked, false);
  assert.equal(previous.get('useOpenFoodFacts').checked, false);
});
test('Finish requests barcode permission and saves independent comma-separated avoid entries', async () => {
  const s = setup();
  s.get('avoidList').value = 'palm oil, natural flavors\nred 40';
  await s.finish();
  assert.equal(s.requests(), 1);
  assert.equal(s.data.useOpenFoodFacts, true);
  assert.deepEqual(Array.from(s.data.avoidList), ['palm oil', 'natural flavors', 'red 40']);
  assert.equal(s.data.onboarded, true);
});
test('denied barcode permission stays in setup and can finish with the opt-out', async () => {
  const s = setup({}, false);
  await s.finish();
  assert.equal(s.data.onboarded, undefined);
  assert.equal(s.get('useOpenFoodFacts').checked, false);
  assert.match(s.get('status').textContent, /did not grant/);
  assert.equal(s.get('next').disabled, false);
  await s.finish();
  assert.equal(s.data.onboarded, true);
  assert.equal(s.data.useOpenFoodFacts, false);
  assert.equal(s.requests(), 1);
});

test('comma-separated avoid phrases produce distinct product warnings', () => {
  const engine = require('../src/engine/score.js');
  const avoidList = prefs.sanitizeAvoidList('palm oil, natural flavors');
  const result = engine.score({ ingredients_text: 'potatoes, palm oil, natural flavors, salt' }, { avoidList });
  assert.deepEqual(result.flags.filter(flag => flag.kind === 'avoid').map(flag => flag.id), ['palm oil', 'natural flavors']);
});

test('typed avoid entries and chip removals stay synchronized', () => {
  const s = setup();
  s.get('avoidList').value = 'palm oil, natural flavors';
  s.get('avoidList').input();
  const palm = s.get('avoidHints').children.find(button => button.textContent === 'palm oil');
  assert.equal(palm.getAttribute('aria-pressed'), 'true');
  assert.equal(s.get('avoidCount').textContent, '2 / 80 entries');
  palm.click();
  assert.equal(s.get('avoidList').value, 'natural flavors');
  assert.equal(palm.getAttribute('aria-pressed'), 'false');
  assert.equal(s.get('avoidCount').textContent, '1 / 80 entries');
});
test('rerunning setup preserves weighted goal priorities and their active description', async () => {
  const categories = require('../src/engine/categories.js');
  const goals = ['weightLoss', 'wholeFood'];
  const goalImportance = { weightLoss: 2, wholeFood: 1 };
  const weights = categories.goalWeights(goals, goalImportance);
  const s = setup({ goals, weights, goalImportance, useOpenFoodFacts: false });
  assert.match(s.get('goalSummary').textContent, /Selected goals \(2\)/);
  await s.finish();
  assert.deepEqual(JSON.parse(JSON.stringify(s.data.goalImportance)), categories.sanitizeGoalImportance(goalImportance));
  assert.equal(categories.describeGoals(s.data.weights, s.data.goals, s.data.goalImportance).custom, false);
});

test('Google setup signs in optionally and backs up only after choices are saved', async () => {
  const s = setup({ useOpenFoodFacts: false });
  assert.equal(s.get('googleRedirect').textContent, 'https://test.chromiumapp.org/');
  await s.get('googleSignIn').click();
  assert.equal(s.backups.length, 0);
  await s.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.backups.length, 1);
  assert.equal(s.backups[0].type, 'accountSave');
  assert.equal(s.backups[0].onboarded, true);
  assert.equal(s.data.token, undefined);
  assert.equal(vm.runInContext('setupToken', s.context), null);
});
test('Google cancellation, permission denial and backend failure keep setup usable', async () => {
  const cancelled = setup({ useOpenFoodFacts: false }, true, { error: 'cancelled' });
  await cancelled.get('googleSignIn').click();
  assert.match(cancelled.get('googleStatus').textContent, /cancelled/);
  await cancelled.finish();
  assert.equal(cancelled.data.onboarded, true);
  assert.equal(cancelled.backups.length, 0);
  const denied = setup({ useOpenFoodFacts: false }, false);
  await denied.get('googleSignIn').click();
  assert.match(denied.get('googleStatus').textContent, /not granted/);
  const failed = setup({ useOpenFoodFacts: false }, true, { backup: false });
  await failed.get('googleSignIn').click();
  await failed.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failed.data.onboarded, true);
  assert.match(failed.get('backupStatus').textContent, /saved locally/);
  assert.equal(vm.runInContext('setupToken', failed.context), null);
  assert.equal(failed.get('next').disabled, false);
});


test('setup blocks navigation and duplicate operations while Google sign-in is pending', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const s = setup({ useOpenFoodFacts: false }, true, { pending });
  const signIn = s.get('googleSignIn').click();
  for (const id of ['next', 'back', 'skip', 'googleSignIn']) assert.equal(s.get(id).disabled, true);
  s.get('back').click();
  await s.get('skip').click();
  await s.finish();
  await s.get('googleSignIn').click();
  assert.equal(s.data.onboarded, undefined);
  assert.equal(s.requests(), 1);
  assert.equal(vm.runInContext('step', s.context), 0, 'still on the first step (steps count from 0)');
  release();
  await signIn;
  for (const id of ['next', 'back', 'skip', 'googleSignIn']) assert.equal(s.get(id).disabled, false);
});

test('retrying sign-in cannot back up with an earlier account token after permission denial', async () => {
  const auth = {};
  const s = setup({ useOpenFoodFacts: false }, true, auth);
  await s.get('googleSignIn').click();
  auth.permission = false;
  await s.get('googleSignIn').click();
  await s.finish();
  assert.equal(s.backups.length, 0);
  assert.equal(vm.runInContext('setupToken', s.context), null);
  assert.match(s.get('backupStatus').textContent, /saved on this computer/);
});

test('local save failure keeps setup open and prevents account backup until retry succeeds', async () => {
  const auth = { saveError: true };
  const s = setup({ useOpenFoodFacts: false }, true, auth);
  await s.get('googleSignIn').click();
  await s.finish();
  assert.equal(s.data.onboarded, undefined);
  assert.equal(s.backups.length, 0);
  assert.match(s.get('status').textContent, /Could not save your choices/);
  assert.equal(s.get('next').disabled, false);
  auth.saveError = false;
  await s.finish();
  assert.equal(s.backups.length, 1);
  assert.equal(s.data.onboarded, true);
});

test('Skip clears the pending Google token and reports a failed setup-status save', async () => {
  const auth = { saveError: true };
  const s = setup({ useOpenFoodFacts: false }, true, auth);
  await s.get('googleSignIn').click();
  await s.get('skip').click();
  assert.equal(vm.runInContext('setupToken', s.context), null);
  assert.equal(auth.closedTab, undefined);
  assert.match(s.get('status').textContent, /Could not save setup status/);
  auth.saveError = false;
  await s.get('skip').click();
  assert.equal(auth.closedTab, 7);
  assert.equal(s.data.onboarded, true);
  assert.equal(s.backups.length, 0);
});


test('Finish keeps saved choices safe while Google backup is pending or throws', async () => {
  let release;
  const backupPending = new Promise(resolve => { release = resolve; });
  const s = setup({ useOpenFoodFacts: false }, true, { backupPending, backupError: true });
  await s.get('googleSignIn').click();
  const finishing = s.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.data.onboarded, true);
  assert.equal(s.backups.length, 1);
  assert.match(s.get('status').textContent, /Backing up/);
  for (const id of ['next', 'back', 'skip', 'googleSignIn']) assert.equal(s.get(id).disabled, true);
  await s.finish();
  await s.get('skip').click();
  assert.equal(s.backups.length, 1);
  release();
  await finishing;
  assert.match(s.get('backupStatus').textContent, /saved locally/);
  assert.equal(vm.runInContext('step', s.context), 6);
  assert.equal(vm.runInContext('setupToken', s.context), null);
  assert.equal(s.get('next').disabled, false);
});


test('setup startup storage failure cannot replace existing choices with defaults', async () => {
  const auth = { initialReadError: true };
  const s = setup({ avoidList: ['existing preference'], useOpenFoodFacts: false }, true, auth);
  assert.match(s.get('status').textContent, /Could not load/);
  assert.equal(s.get('next').textContent, 'Retry loading');
  for (const id of ['back', 'skip', 'googleSignIn']) assert.equal(s.get(id).disabled, true);
  await s.finish();
  await s.get('skip').click();
  await s.get('googleSignIn').click();
  assert.equal(s.data.onboarded, undefined);
  assert.deepEqual(s.data.avoidList, ['existing preference']);
  assert.equal(s.requests(), 0);
  s.get('next').click();
  assert.equal(auth.reloaded, true);
});
