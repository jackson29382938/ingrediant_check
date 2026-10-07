// Controlled order-page and product fixtures only. No real orders or authenticated retailer requests.
import { createRequire } from 'node:module';
const scores = createRequire(import.meta.url)('../src/engine/db/score-cache.js');
export async function ordersEndToEnd(context, worker, errors) {
  const origin = 'https://www.amazon.com', orders = `${origin}/your-orders/orders`, requests = [];
  const ids = ['B000000001', 'B000000002', 'B000000003', 'B000000004', 'B000000005'];
  const item = (id, title, status = 'Delivered') => `<div class="item-box"><span class="delivery-status">${status}</span><a href="/Organic-Food/dp/${id}/ref=order">${title}</a><button>Return items</button></div>`;
  const html = (older = false) => `<main id="yourOrders"><h1>Your Orders</h1><div class="order-card" data-order-id="${older ? '222-1234567-1234567' : '111-1234567-1234567'}"><div class="order-header">Order placed ${older ? 'August' : 'September'} 1, 2026 <span>Ship to PRIVATE ADDRESS</span><span>Payment PRIVATE</span></div>${item(ids[0], 'Whole grain oats')}${older ? '' : item(ids[1], 'Corn chips', 'Cancelled') + item(ids[2], 'Hair shampoo') + item(ids[3], 'Corn chips') + item(ids[4], 'Popcorn')}</div></main><aside class="recommendations">${item('B000000009', 'Suggested oats')}</aside>`;
  const page = await context.newPage(); page.on('pageerror', e => errors.push('orders: ' + e.message));
  await page.route('**/*', r => {
    const u = new URL(r.request().url()), asin = u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
    if (asin) { requests.push(r.request()); return r.fulfill({ contentType: 'text/html', body: `<h1 id="productTitle">Whole grain oats</h1><input id="ASIN" value="${asin}">${asin === ids[3] ? '' : '<div id="nic-ingredients-content">whole grain rolled oats</div>'}` }); }
    return r.fulfill({ contentType: 'text/html', body: html(u.searchParams.get('page') === '2') });
  });
  await worker.evaluate(() => chrome.storage.local.set({ historyEnabled: false, historyAutoSync: false, purchaseHistory: [], historyOwner: '', enabled: true }));
  const raw = await worker.evaluate(() => chrome.storage.local.get(null)), version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  await worker.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), { key: scores.key('amazon.com', ids[4]), value: { schema: scores.SCHEMA, store: 'amazon.com', asin: ids[4], v: version, t: Date.now(), source: 'page', score: 88, verdict: 'Good', prefs: scores.fingerprint(raw, 'page'), name: 'Popcorn' } });
  await context.addCookies([{ name: 'private_order_test', value: 'do-not-send', domain: 'www.amazon.com', path: '/', secure: true }]);
  await page.goto(orders); await page.waitForTimeout(600);
  if (await page.locator('.air-order-badge').count() || requests.length) throw new Error('orders imported before opt-in');
  await worker.evaluate(() => chrome.storage.local.set({ historyEnabled: true }));
  await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'), null, { timeout: 20000 });
  const records = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
  if (records.length !== 4 || records.filter(r => r.state === 'purchased' && r.score !== null).length !== 2 || records.some(r => r.asin === 'B000000003')) throw new Error('order eligibility or scoring failed: ' + JSON.stringify(records));
  if (JSON.stringify(records).includes('PRIVATE') || JSON.stringify(records).includes('111-1234567-1234567')) throw new Error('order personal fields saved');
  if (requests.some(r => r.url().includes(ids[4]))) throw new Error('orders did not reuse a valid saved score');
  if (requests.some(r => r.headers().cookie || r.headers().referer || r.url().includes('your-orders'))) throw new Error('order product request leaked cookies/referrer');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  if ((await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory)).length !== 4) throw new Error('revisited order duplicated');
  await page.evaluate(() => { document.querySelector('.delivery-status').textContent = 'Returned'; });
  await page.waitForFunction(() => document.querySelector('.air-order-badge')?.textContent.includes('returned'));
  await page.goto(orders + '?page=2'); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  const final = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
  if (final.length !== 5 || !final.some(r => r.date === '2026-08-01' && r.score !== null)) throw new Error('older order import failed');
  const opened = context.waitForEvent('page'); await page.getByRole('button', { name: 'History & sync settings' }).click();
  const dashboard = await opened; await dashboard.waitForLoadState(); dashboard.on('pageerror', e => errors.push('history dashboard: ' + e.message));
  await dashboard.waitForFunction(() => document.querySelector('#coverage')?.textContent.includes('2 of 3 imported purchases rated'));
  if (!await dashboard.locator('#months').innerText().then(t => t.includes('2026-08'))) throw new Error('monthly purchase trends missing');
  await dashboard.locator('#historyAutoSync').check(); await dashboard.locator('#historyAutoSync').uncheck();
  // Real extension UI and worker; OAuth and remote network use controlled fixtures only.
  await worker.evaluate(() => {
    self.__purchaseFetch = self.fetch; self.__purchaseRequests = []; self.__purchaseRemote = []; self.__purchaseOffline = false;
    self.__purchaseToken = AIR.googleAuth.token; AIR.googleAuth.token = async () => 'a'.repeat(30);
    self.__purchasePermissions = chrome.permissions.contains; chrome.permissions.contains = async permissions => permissions.permissions?.includes('identity') ? true : self.__purchasePermissions(permissions);
    self.fetch = async (url, options = {}) => {
      if (String(url).includes('googleapis.com') && String(url).includes('userinfo')) return new Response(JSON.stringify({ email: 'orders@example.com', name: 'Orders test' }), { headers: { 'content-type': 'application/json' } });
      if (!String(url).includes('script.google.com/macros/')) return self.__purchaseFetch(url, options);
      if (self.__purchaseOffline) throw new Error('fixture offline');
      if (!options.body) return new Response(JSON.stringify({ history: true, historySchema: 1 }));
      const body = JSON.parse(options.body); self.__purchaseRequests.push({ kind: body.kind, payload: body.payload });
      if (body.kind === 'historyGet') return new Response(JSON.stringify({ ok: true, kind: body.kind, account: 'c'.repeat(64), clearedAt: 0, records: self.__purchaseRemote }));
      if (body.kind === 'historyPut') { self.__purchaseRemote = AIR.db.purchaseHistory.merge(self.__purchaseRemote, body.payload.records); return new Response(JSON.stringify({ ok: true, kind: body.kind })); }
      if (body.kind === 'historyClear') { self.__purchaseRemote = []; return new Response(JSON.stringify({ ok: true, kind: body.kind, clearedAt: Date.now() })); }
      throw new Error('unexpected history fixture request');
    };
  });
  await dashboard.evaluate(() => { chrome.permissions.request = async () => true; AIR.googleAuth.token = async () => 'a'.repeat(30); AIR.googleAuth.profile = async () => ({ email: 'orders@example.com', name: 'Orders test' }); });
  await dashboard.locator('#sync').click(); await dashboard.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('Synced'), null, { timeout: 10000 });
  const sent = await worker.evaluate(() => self.__purchaseRequests);
  if (!sent.some(r => r.kind === 'historyPut') || JSON.stringify(sent).includes('PRIVATE') || JSON.stringify(sent).includes('111-1234567-1234567')) throw new Error('manual sync or private field exclusion failed');
  await dashboard.locator('#historyAutoSync').check();
  await dashboard.waitForFunction(() => !document.querySelector('#sync').disabled && document.querySelector('#historyAutoSync').checked);
  const before = sent.length;
  await worker.evaluate(() => chrome.alarms.create('ic-purchase-sync', { when: Date.now() + 1000 }));
  let automaticSynced = false;
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await worker.evaluate(n => self.__purchaseRequests.length > n, before)) { automaticSynced = true; break; }
    await page.waitForTimeout(200);
  }
  if (!automaticSynced) throw new Error('automatic history sync did not run');
  await dashboard.locator('#historyAutoSync').uncheck();
  await worker.evaluate(() => { self.__purchaseOffline = true; });
  await dashboard.locator('#sync').click(); await dashboard.waitForFunction(() => document.querySelector('#status')?.textContent.includes('working connection'));
  if ((await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory)).length !== 5) throw new Error('offline sync lost local purchases');
  await worker.evaluate(() => { self.__purchaseOffline = false; });
  dashboard.on('dialog', dialog => dialog.accept());
  await dashboard.locator('#delete').click(); await dashboard.waitForFunction(() => document.querySelector('#status')?.textContent.includes('History deleted'));
  if (await worker.evaluate(async () => self.__purchaseRemote.length || (await chrome.storage.local.get('purchaseHistory')).purchaseHistory.length)) throw new Error('history deletion not confirmed');
  await worker.evaluate(() => { self.fetch = self.__purchaseFetch; AIR.googleAuth.token = self.__purchaseToken; chrome.permissions.contains = self.__purchasePermissions; delete self.__purchaseToken; delete self.__purchasePermissions; delete self.__purchaseFetch; delete self.__purchaseRequests; delete self.__purchaseRemote; delete self.__purchaseOffline; });
  await page.evaluate(() => history.pushState({}, '', '/checkout')); await page.waitForFunction(() => !document.querySelector('.air-order-badge'), null, { timeout: 5000 });
  await dashboard.close(); await page.close(); await context.clearCookies({ name: 'private_order_test' });
  await worker.evaluate(async () => { await chrome.storage.local.set({ historyEnabled: false, historyAutoSync: false, purchaseHistory: [] }); await chrome.storage.local.remove('s:amazon.com:B000000005'); });
  console.log('  ok orders → opt-in first page, real scoring, no personal fields, deduplication, returns, older pages, purchase-only trends, automatic/manual account sync, offline retention and confirmed deletion (OAuth/backend fixtures)');
}
