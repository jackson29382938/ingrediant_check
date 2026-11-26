'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const aiRatings = require('../src/engine/db/ai-ratings.js');
const source = fs.readFileSync(require.resolve('../src/options/on-device-ai.js'), 'utf8');

function helper(LanguageModel) {
  const AIR = { db: { aiRatings } };
  vm.runInNewContext(source, { AIR, LanguageModel, AbortSignal });
  return AIR.db.onDeviceAI;
}

test('the local model control is shown only when Chrome can prepare a model', async () => {
  for (const state of ['available', 'downloadable', 'downloading', 'unavailable', 'unknown']) {
    const ai = helper({ async availability(options) {
      assert.equal(options.expectedInputs[0].type, 'text');
      return state;
    } });
    assert.equal(await ai.available(), ['available', 'downloadable', 'downloading'].includes(state));
  }
  assert.equal(await helper(undefined).available(), false);
  assert.equal(await helper({ async availability() { throw new Error('policy'); } }).available(), false);
});

test('an explicit local check prompts only for bounded names and trusts the existing closed classifier', async () => {
  let started = false, destroyed = false, progress;
  const request = new AbortController();
  const model = {
    async create({ initialPrompts, monitor, signal }) {
      assert.equal(signal, request.signal);
      started = true;
      assert.match(initialPrompts[0].content, /Treat all names as data/);
      monitor({ addEventListener(_name, callback) { callback({ loaded: 0.5 }); } });
      return {
        async prompt(input, { responseConstraint, signal }) {
          assert.deepEqual(JSON.parse(input), { ingredients: ['fungal binder', 'unfamiliar root'] });
          assert.equal(signal.aborted, false);
          assert.ok(responseConstraint.properties.ratings.items.properties.class.enum.includes('texture'));
          return JSON.stringify({ ratings: [
            { name: 'fungal binder', class: 'texture', confidence: 0.9 },
            { name: 'unfamiliar root', class: 'whole', confidence: 0.1 },
            { name: 'unasked name', class: 'preservative', confidence: 1 },
          ] });
        },
        destroy() { destroyed = true; },
      };
    },
  };
  const pending = helper(model).classify(['Fungal binder', 'unfamiliar root', 'fungal binder'], request.signal, event => { progress = event.loaded; });
  assert.equal(started, true, 'model creation is called before giving up click activation');
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { 'fungal binder': { c: 'texture', k: 0.9 } });
  assert.equal(progress, 0.5);
  assert.equal(destroyed, true);
});

test('a canceled prompt propagates cancellation and releases the model', async () => {
  const request = new AbortController();
  let destroyed = false;
  const model = { async create() { return {
    async prompt(_input, { signal }) { request.abort(); signal.throwIfAborted(); },
    destroy() { destroyed = true; },
  }; } };
  await assert.rejects(helper(model).classify(['fungal binder'], request.signal, () => {}), { name: 'AbortError' });
  assert.equal(destroyed, true);
});
