const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const turn = () => new Promise(resolve => setImmediate(resolve));

function setup(createWorker) {
  const timers = new Map();
  let id = 0, listener;
  const context = vm.createContext({ AbortController,
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    chrome: { runtime: { getURL: p => p, onMessage: { addListener(fn) { listener = fn; } } } },
    Tesseract: { createWorker }, AIR: { db: { ocrText: { ingredientsFromOcr: () => true } } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/offscreen/ocr.js'), 'utf8'), context);
  return { run: () => vm.runInContext('ocrImages(["image"])', context),
    expire: () => timers.values().next().value(),
    cancel: () => listener({ target: 'ocr-offscreen', type: 'cancelOcr' }, {}, () => {}) };
}
test('deadline terminates stalled recognition and the next job gets a fresh worker', async () => {
  let created = 0, terminated = 0;
  const w = setup(async () => {
    const n = ++created;
    return { terminate: async () => { terminated++; },
      recognize: () => n === 1 ? new Promise(() => {}) : Promise.resolve({ data: { text: 'Ingredients: oats', confidence: 90 } }) };
  });
  const first = w.run();
  await turn();
  w.expire();
  assert.equal((await first).length, 0);
  assert.equal(terminated, 1);
  assert.equal((await w.run())[0].text, 'Ingredients: oats');
  assert.equal(created, 2);
});
test('late worker startup is disposed without replacing the next job worker', async () => {
  let resolveOld, created = 0, disposed = 0;
  const w = setup(() => ++created === 1 ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ terminate() {}, recognize: async () => ({ data: { text: 'oats' } }) }));
  const first = w.run();
  await turn();
  w.expire();
  await first;
  assert.equal((await w.run()).length, 1);
  resolveOld({ terminate() { disposed++; }, recognize() { throw new Error('must not recognize after cancellation'); } });
  await turn();
  assert.equal(disposed, 1);
  assert.equal((await w.run()).length, 1);
  assert.equal(created, 2);
});
test('master cancellation stops active and queued OCR jobs', async () => {
  let created = 0, terminated = 0;
  const w = setup(async () => { created++; return {
    recognize: () => new Promise(() => {}), terminate: async () => { terminated++; },
  }; });
  const first = w.run(), second = w.run();
  await turn();
  assert.equal(created, 1);
  w.cancel();
  assert.equal((await first).length, 0);
  assert.equal((await second).length, 0);
  assert.equal(terminated, 1);
  assert.equal(created, 1);
});
