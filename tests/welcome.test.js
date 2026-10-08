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
  let keydown = null;
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
    document: { getElementById: get, querySelectorAll: () => [], querySelector: () => element(), createElement: element,
      addEventListener(type, fn) { if (type === 'keydown') keydown = fn; } },
    chrome: { identity: { getRedirectURL: () => 'https://test.chromiumapp.org/' }, runtime: { getURL: p => p, async sendMessage(message) { backups.push({ ...message, onboarded: data.onboarded }); if (auth.backupPending) await auth.backupPending; if (auth.backupError) throw new Error('offline'); if (message.type === 'accountFetch') return auth.existingCopy ? { ok: true, values: {} } : { ok: false, reason: 'no-backup' }; return { ok: auth.backup !== false }; } }, i18n: { getMessage: () => '' }, tabs: { create(options) { (auth.openedTabs ||= []).push(options); }, getCurrent(cb) { cb({ id: 7 }); }, remove(id) { auth.closedTab = id; } },
      permissions: { request(_p, cb) { requests++; cb(auth.permission === undefined ? permission : auth.permission); }, remove(_p, cb) { cb(); } },
      storage: { local: { get(_keys, cb) { if (auth.initialReadError) context.chrome.runtime.lastError = { message: 'unavailable' }; cb(data); delete context.chrome.runtime.lastError; }, set(values, cb) { if (!auth.saveError) Object.assign(data, values); if (auth.saveError) context.chrome.runtime.lastError = { message: 'storage quota' }; cb(); delete context.chrome.runtime.lastError; } } } },
  });
  vm.runInContext(fs.readFileSync('src/options/welcome.js', 'utf8'), context);
  // A key press: returns whether the page took it (preventDefault) so a test can tell "handled" from "left alone".
  const key = (k, over = {}) => {
    let taken = false;
    keydown({ key: k, target: { tagName: 'BODY' }, preventDefault() { taken = true; }, ...over });
    return taken;
  };
  return { get, data, context, backups, saves: () => backups.filter(b => b.type === 'accountSave'), requests: () => requests, finish: () => vm.runInContext('finish()', context), key,
    at: () => vm.runInContext('plan()[step]', context), level: () => vm.runInContext('picked.level', context),
    steps: () => vm.runInContext('plan()', context) };
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
  assert.deepEqual(s.backups.map(b => b.type), ['accountFetch', 'accountSave'], 'it checks for a saved copy first');
  assert.equal(s.saves()[0].onboarded, true);
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
  assert.equal(s.saves().length, 1);
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

// ---------------------------------------------------------------- the keyboard
// Setup can be done without the mouse; the shortcuts are listed on the page.
const pageEl = s => s.get('keys');

test('keyboard: Enter moves through every step to Finish, saving the same choices a click would', async () => {
  const s = setup({}, true, {});
  assert.equal(s.at(), 'level');
  const seen = [s.at()];
  for (let i = 0; i < 10 && s.at() !== 'done'; i++) {
    const took = s.key('Enter');
    assert.equal(took, true, `Enter is handled on ${s.at()}`);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    seen.push(s.at());
  }
  assert.deepEqual(seen.slice(0, 5), ['level', 'goals', 'warn', 'avoid', 'options']);
  assert.equal(s.data.onboarded, true);
  assert.equal(s.data.settingsLevel, 'standard');
});

test('keyboard: B goes back, and does nothing on the first step', () => {
  const s = setup();
  assert.equal(s.key('b'), false, 'nothing to go back to');
  s.key('Enter'); s.key('Enter');
  assert.equal(s.at(), 'warn');
  assert.equal(s.key('b'), true);
  assert.equal(s.at(), 'goals');
  assert.equal(s.key('B', { shiftKey: true }), false, 'Shift+B is not a shortcut');
});

test('keyboard: Shift+S skips setup; a plain S never does', async () => {
  const s = setup();
  assert.equal(s.key('s'), false);
  assert.equal(s.data.onboarded, undefined, 'a stray S did not skip');
  assert.equal(s.key('S', { shiftKey: true }), true);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(s.data.onboarded, true);
  assert.equal(s.data.settingsLevel, 'standard', 'skipping still records the level');
});

test('keyboard: 1 to 5 pick the level, and the steps that follow change with it', () => {
  const s = setup();
  const expected = { 1: ['level', 'goals', 'warn'], 2: ['level', 'goals', 'warn', 'avoid'], 3: ['level', 'goals', 'warn', 'avoid', 'options', 'google'] };
  for (const [n, steps] of Object.entries(expected)) {
    assert.equal(s.key(n), true);
    assert.deepEqual([...s.steps()], steps, `key ${n}`);
  }
  s.key('4'); s.key('5');
  assert.equal(s.level(), 'expert');
  s.key('1');
  assert.equal(s.level(), 'minimal');
  assert.equal(s.key('6'), false);
  assert.equal(s.key('0'), false);
  s.key('Enter');
  assert.equal(s.key('3'), false, 'the number keys only mean something on the level step');
  assert.equal(s.level(), 'minimal');
});

test('keyboard: Enter is left alone where it already means something, and Ctrl/Cmd+Enter always moves on', () => {
  const s = setup();
  for (const tagName of ['BUTTON', 'A', 'SUMMARY', 'TEXTAREA', 'SELECT']) {
    assert.equal(s.key('Enter', { target: { tagName } }), false, `${tagName} keeps its own Enter`);
  }
  assert.equal(s.key('Enter', { target: { tagName: 'INPUT', type: 'text' } }), false);
  assert.equal(s.at(), 'level', 'none of those moved on');
  assert.equal(s.key('Enter', { target: { tagName: 'INPUT', type: 'radio' } }), true, 'a radio button has no Enter of its own');
  assert.equal(s.at(), 'goals');
  assert.equal(s.key('Enter', { target: { tagName: 'INPUT', type: 'checkbox' } }), true);
  assert.equal(s.at(), 'warn');
  assert.equal(s.key('Enter', { ctrlKey: true, target: { tagName: 'TEXTAREA' } }), true);
  assert.equal(s.at(), 'avoid');
  assert.equal(s.key('Enter', { metaKey: true, target: { tagName: 'TEXTAREA' } }), true);
  assert.equal(s.at(), 'options');
});

test('keyboard: on a choice chip Space toggles (the browser does that) and Enter moves on instead of toggling again', () => {
  const s = setup();
  s.key('Enter');
  const chipTarget = { tagName: 'BUTTON', classList: { contains: c => c === 'chip' } };
  assert.equal(s.key('Enter', { target: chipTarget }), true, 'taken, so the chip does not also toggle');
  assert.equal(s.at(), 'warn');
  const footerButton = { tagName: 'BUTTON', classList: { contains: () => false } };
  assert.equal(s.key('Enter', { target: footerButton }), false, 'the footer buttons keep their own Enter');
  assert.equal(s.at(), 'warn');
});

test('keyboard: single-letter and number keys are ignored while typing, and with Ctrl, Cmd or Alt held', () => {
  const s = setup();
  s.key('Enter'); s.key('Enter'); s.key('Enter');
  const at = s.at();
  assert.equal(at, 'avoid');
  for (const k of ['b', 'S', '1']) assert.equal(s.key(k, { target: { tagName: 'TEXTAREA' }, shiftKey: k === 'S' }), false, `${k} in the avoid box`);
  for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(s.key('b', over), false, JSON.stringify(over));
  assert.equal(s.key('Enter', { altKey: true }), false, 'Alt+Enter is the browser\'s, not ours');
  assert.equal(s.at(), at, 'nothing moved');
});

test('keyboard: a key another handler already took is left alone', () => {
  const s = setup();
  assert.equal(s.key('Enter', { defaultPrevented: true }), false);
  assert.equal(s.at(), 'level');
});

test('keyboard: the buttons announce their shortcuts and the page lists them', () => {
  const s = setup();
  assert.equal(s.get('next').attributes['aria-keyshortcuts'], 'Enter');
  assert.equal(s.get('back').attributes['aria-keyshortcuts'], 'B');
  assert.equal(s.get('skip').attributes['aria-keyshortcuts'], 'Shift+S');
  const html = fs.readFileSync('src/options/welcome.html', 'utf8');
  for (const shown of ['<kbd>Enter</kbd>', '<kbd>B</kbd>', '<kbd>Shift</kbd>+<kbd>S</kbd>', '<kbd>1</kbd>–<kbd>5</kbd>', '<kbd>Tab</kbd>', '<kbd>Space</kbd>']) {
    assert.ok(html.includes(shown), `${shown} is shown on the page`);
  }
  assert.ok(pageEl(s));
});

test('setup never replaces a Google copy that already exists; it says so and leaves the choice to Settings', async () => {
  const s = setup({ useOpenFoodFacts: false }, true, { existingCopy: true });
  await s.get('googleSignIn').click();
  await s.finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(s.backups.map(b => b.type), ['accountFetch'], 'it looked, and wrote nothing');
  assert.equal(s.saves().length, 0);
  assert.equal(s.data.onboarded, true, 'the choices are still saved on this computer');
  assert.match(s.get('backupStatus').textContent, /already has a saved copy.*left as it is.*Restore.*Save to replace/);
  assert.equal(vm.runInContext('setupToken', s.context), null, 'the token is dropped');
});

test('setup that cannot tell whether a Google copy exists writes nothing', async () => {
  const s = setup({ useOpenFoodFacts: false }, true, { backupError: true });
  await s.get('googleSignIn').click();
  await s.finish();
  assert.equal(s.saves().length, 0);
  assert.match(s.get('backupStatus').textContent, /saved locally/);
});


test('setup purchase-history opt-in enables automatic sync and opens only the normal Orders page', async () => {
  const auth = {}, s = setup({}, true, auth);
  assert.equal(s.get('setupPurchaseHistory').checked, false);
  s.get('setupPurchaseHistory').checked = true;
  await s.finish();
  const configured = s.backups.find(b => b.type === 'purchaseConfigure');
  assert.equal(configured.enabled, true); assert.equal(configured.autoSync, true);
  assert.equal(configured.onboarded, true);
  assert.equal(auth.openedTabs[0].url, 'https://www.amazon.com/your-orders/orders');
});
test('rerunning setup preserves an existing manual-only history-sync choice', async () => {
  const s = setup({ historyEnabled: true, historyAutoSync: false });
  await s.finish();
  assert.equal(s.backups.some(b => b.type === 'purchaseConfigure'), false);
});
