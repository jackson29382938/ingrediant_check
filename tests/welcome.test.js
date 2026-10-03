'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');
function setup(initial = {}, permission = true) {
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
  const context = vm.createContext({ AIR: globalThis.AIR, console,
    document: { getElementById: get, querySelectorAll: () => [], querySelector: () => element(), createElement: element },
    chrome: { runtime: { getURL: p => p }, i18n: { getMessage: () => '' }, tabs: { create() {} },
      permissions: { request(_p, cb) { requests++; cb(permission); }, remove(_p, cb) { cb(); } },
      storage: { local: { get(_keys, cb) { cb(data); }, set(values, cb) { Object.assign(data, values); cb(); } } } },
  });
  vm.runInContext(fs.readFileSync('src/options/welcome.js', 'utf8'), context);
  return { get, data, context, requests: () => requests, finish: () => vm.runInContext('finish()', context) };
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
