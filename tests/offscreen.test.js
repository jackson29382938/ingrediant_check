const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const turn = () => new Promise(resolve => setImmediate(resolve));

const WORKER = { id: 'ext', url: 'chrome-extension://ext/src/background.js' };
function setup(createWorker) {
  const timers = new Map();
  const sent = [];
  let id = 0, listener;
  const context = vm.createContext({ AbortController,
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    URL,
    chrome: { runtime: { id: 'ext', getURL: p => p, onMessage: { addListener(fn) { listener = fn; } },
      sendMessage: msg => { sent.push(msg); return Promise.resolve(); } } },
    Tesseract: { createWorker }, AIR: { db: { ocrText: {
      ingredientsFromOcr: () => true,
      isAllowedOcrUrl: () => true,
      allowedOcrUrls: urls => (Array.isArray(urls) ? urls : []).slice(0, 5),
    } } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/offscreen/ocr.js'), 'utf8'), context);
  return { run: () => vm.runInContext('ocrImages(["https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg"])', context),
    expire: () => timers.values().next().value(),
    pending: () => timers.size, sent,
    cancel: (sender = WORKER) => listener({ target: 'ocr-offscreen', type: 'cancelOcr' }, sender, () => {}),
    message: (msg, sender) => { let answer; const async = listener({ target: 'ocr-offscreen', ...msg }, sender, r => { answer = r; }); return { async, answer: () => answer }; } };
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
test('an idle page tears the engine down and asks to be closed', async () => {
  let terminated = 0;
  const w = setup(async () => ({ terminate: async () => { terminated++; },
    recognize: async () => ({ data: { text: 'Ingredients: oats', confidence: 90 } }) }));
  assert.equal((await w.run())[0].text, 'Ingredients: oats');
  assert.equal(w.pending(), 1);                       // only the idle timer remains
  w.expire();
  await turn();
  assert.equal(terminated, 1);
  assert.deepEqual(w.sent.map(m => m.type), ['ocrIdle']);   // vm objects are not reference-equal to ours
  // A new job after idle gets a fresh worker and re-arms the timer.
  assert.equal((await w.run()).length, 1);
  assert.equal(w.pending(), 1);
});

test('only the service worker may ask the OCR host for anything', async () => {
  let recognised = 0;
  const w = setup(async () => ({ terminate: async () => {}, recognize: async () => { recognised++; return { data: { text: 'oats', confidence: 90 } }; } }));
  const urls = ['https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg'];
  for (const sender of [
    { id: 'ext', url: 'https://www.amazon.com/dp/B00LOAW7U6', tab: { id: 3 } },        // a content script
    { id: 'ext', url: 'chrome-extension://ext/src/options/popup.html' },               // another extension page
    { id: 'other', url: 'chrome-extension://other/src/background.js' },                // another extension
    {},
  ]) {
    const r = w.message({ type: 'ocrImages', urls }, sender);
    assert.equal(r.async, false, JSON.stringify(sender));
  }
  await turn();
  assert.equal(recognised, 0, 'nothing was read for them');
  const ok = w.message({ type: 'ocrImages', urls }, WORKER);
  assert.equal(ok.async, true);
  for (let i = 0; i < 5 && !ok.answer(); i++) await turn();
  assert.equal(ok.answer().results[0].text, 'oats');
});
