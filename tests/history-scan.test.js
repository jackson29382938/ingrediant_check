const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const S = require('../src/engine/db/history-scan.js');
const { createDocument } = require('./pages/load.js');
const base = 'https://www.amazon.com/your-orders/orders';
function world() {
  const data = { historyEnabled: true }, tabs = new Map(), navigations = [], alarms = []; let id = 10;
  const ctx = vm.createContext({ URL, Date, crypto: { randomUUID: () => String(++id) }, setTimeout: () => 1,
    AIR: { db: { historyScan: S } }, chrome: {
      storage: { local: { async get(keys) { return Object.fromEntries([].concat(keys).map(k => [k, data[k]])); }, async set(values) { Object.assign(data, values); } } },
      runtime: {}, alarms: { create(name) { alarms.push(name); }, async clear() {}, onAlarm: { addListener() {} } },
      tabs: { async create(opts) { const tab = { id: ++id, status: 'complete', ...opts }; tabs.set(tab.id, tab); return tab; },
        async get(id) { if (!tabs.has(id)) throw Error('closed'); return tabs.get(id); }, async remove(id) { tabs.delete(id); },
        async update(id, opts) { Object.assign(tabs.get(id), opts); navigations.push(opts.url); }, async sendMessage() {} },
    } });
  vm.runInContext(fs.readFileSync('src/worker/history-scan.js', 'utf8'), ctx);
  return { api: ctx.AIR.scanWorker, data, tabs, navigations };
}
test('scan URLs only retain safe Amazon order filters and numeric pagination', () => {
  assert.equal(S.url(base + '?timeFilter=year-2026&startIndex=10&orderNumber=PRIVATE&ref_=x'), base + '?startIndex=10&timeFilter=year-2026');
  for (const value of ['https://evil.example/your-orders/orders', base.replace('https:', 'http:'), 'https://www.amazon.com/gp/your-account/order-details', base + '?startIndex=evil', base + '?timeFilter=PRIVATE']) assert.equal(S.url(value), '');
});
test('scan discovers year filters, actual Next links and empty-page evidence', () => {
  const doc = createDocument('<body><select name="timeFilter"><option value="year-2026">2026</option><option value="year-2025">2025</option></select><span class="num-orders">55 orders placed</span><ul class="a-pagination"><li class="a-last"><a href="?startIndex=10">Next</a></li></ul></body>');
  const plan = S.plan(doc, new URL(base)); assert.equal(plan.years.length, 2); assert.equal(plan.next, base + '?startIndex=10'); assert.equal(plan.orders, 55);
  assert.equal(S.plan(createDocument('<body><a rel="next" href="?unknownPage=2">Next</a></body>'), new URL(base)).unsupportedNext, true);
  assert.equal(S.plan(createDocument('<body>20 orders placed</body>'), new URL(base)).empty, false);
  assert.equal(S.plan(createDocument('<body><a rel="next" href="https://evil.example/">Next</a></body>'), new URL(base)).unsupportedNext, true);
  assert.equal(S.plan(createDocument('<body>No orders placed</body>'), new URL(base)).empty, true);
});
test('scan starts only with opt-in and creates an inactive ordinary tab', async () => {
  const w = world(); w.data.historyEnabled = false; assert.equal((await w.api.start({})).ok, false);
  w.data.historyEnabled = true; assert.equal((await w.api.start({})).ok, true); assert.equal(w.tabs.get(w.data.historyScan.tabId).active, false);
});
test('scan rejects forged page reports and advances once after importing the current page', async () => {
  const w = world(); await w.api.start({}); await w.api.tick(); const state = w.data.historyScan;
  const msg = { nonce: state.nonce, pageURL: base, items: 1, plan: { years: [], next: base + '?startIndex=10', orders: 20 } };
  const sender = { url: base, tab: { id: state.tabId } };
  assert.equal((await w.api.progress({ ...msg, nonce: 'wrong' }, sender)).ok, false);
  assert.equal((await w.api.progress(msg, { ...sender, tab: { id: 999 } })).ok, false);
  assert.equal((await w.api.progress(msg, sender)).ok, true); assert.equal(state.pages, 1);
  assert.equal((await w.api.progress(msg, sender)).ok, false);
  await w.api.tick(); assert.deepEqual(w.navigations, [base, base + '?startIndex=10']);
});
test('scan pauses on account changes, login redirects and unreadable layouts', async () => {
  const w = world(); await w.api.start({}); await w.api.tick(); const state = w.data.historyScan;
  w.tabs.get(state.tabId).url = 'https://www.amazon.com/ap/signin'; await w.api.tick(); assert.equal(state.status, 'paused');
  await w.api.start({}, true); w.data.historyOwner = 'old@example.com'; w.data.googleProfile = { email: 'new@example.com' }; await w.api.tick(); assert.equal(w.data.historyScan.status, 'paused');
  delete w.data.historyOwner; await w.api.start({}, true); await w.api.tick(); const current = w.data.historyScan;
  await w.api.progress({ nonce: current.nonce, pageURL: base, items: 0, plan: { empty: false } }, { url: base, tab: { id: current.tabId } }); assert.equal(current.status, 'paused');
});
test('scan resumes the saved URL and completes empty history without deleting imported purchases', async () => {
  const w = world(); w.data.purchaseHistory = ['kept']; await w.api.start({}); await w.api.pause();
  await w.api.start({}, true); await w.api.tick(); const state = w.data.historyScan;
  await w.api.progress({ nonce: state.nonce, pageURL: base, items: 0, plan: { empty: true, years: [], next: '' } }, { url: base, tab: { id: state.tabId } });
  assert.equal(state.status, 'complete'); assert.deepEqual(w.data.purchaseHistory, ['kept']);
});
test('scan estimate changes with page count and measured duration', () => {
  const a = S.estimate({ orders: 100, pages: 1, queue: ['next'], averageMs: 60000 });
  const b = S.estimate({ orders: 100, pages: 5, queue: ['next'], averageMs: 10000 });
  assert.ok(a.highSeconds > b.highSeconds); assert.equal(a.pages, 9); assert.equal(b.pages, 5);
});
