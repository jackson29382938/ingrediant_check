// Controlled order-page and product fixtures only. No real orders or authenticated retailer requests.
import { createRequire } from 'node:module';
const scores = createRequire(import.meta.url)('../src/engine/db/score-cache.js');
export async function ordersEndToEnd(context, worker, errors) {
  const origin = 'https://www.amazon.com', orders = `${origin}/your-orders/orders`, requests = [];
  let releaseSlow, holdSlow = true; const slowProduct = new Promise(resolve => { releaseSlow = resolve; });
  const ids = ['B000000001', 'B000000002', 'B000000003', 'B000000004', 'B000000005'];
  const item = (id, title, status = 'Delivered') => `<div class="a-carousel-card"><span class="delivery-status">${status}</span><a href="/Organic-Food/dp/${id}/ref=order">${title}</a><button>Return items</button></div>`;
  const html = (older = false) => `<nav id="amazon-navigation">Amazon navigation</nav><main id="yourOrders"><h1>Your Orders</h1><div class="order-card" data-order-id="${older ? '222-1234567-1234567' : '111-1234567-1234567'}"><div class="order-header">Order placed ${older ? 'August' : 'September'} 1, 2026 <span>Ship to PRIVATE ADDRESS</span><span>Payment PRIVATE</span></div>${older ? item(ids[0], 'Whole grain oats') : `<div class="compact-grid"><div><span class="delivery-status">Delivered</span><a href="/dp/${ids[0]}"><img alt="Whole grain oats" width="90" height="90"><span class="aok-hidden">Opens in a new tab</span></a></div></div>`}<div class="item-box"><div class="a-carousel">${older ? '' : item(ids[1], 'Corn chips', 'Cancelled') + item(ids[2], 'Hair shampoo') + item(ids[3], 'Corn chips') + item(ids[4], 'Popcorn') + item('B000000006', 'Folding Camping Table') + item('B000000007', 'Compression Knee Braces')}</div></div></div></main><aside class="recommendations">${item('B000000009', 'Suggested oats')}</aside>`;
  const page = await context.newPage(); page.on('pageerror', e => errors.push('orders: ' + e.message));
  await page.route('**/*', async r => {
    const u = new URL(r.request().url()), asin = u.pathname.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
    if (asin === 'B000000008' || asin === 'B000000010') return r.fulfill({ contentType: 'text/html', body: `<h1 id="productTitle">${asin === 'B000000008' ? '2 percent milk' : 'Protein bars'}</h1><input id="ASIN" value="${asin}">${asin === 'B000000008' ? '<div id="detailBullets_feature_div">UPC: 123456789012</div>' : '<div id="altImages"><img src="https://m.media-amazon.com/images/I/51abcdefg._SX38_.jpg"></div>'}` });
    if (asin) { requests.push(r.request()); if (asin === ids[0] && holdSlow) await slowProduct; return r.fulfill({ contentType: 'text/html', body: `<h1 id="productTitle">Whole grain oats</h1><input id="ASIN" value="${asin}">${asin === ids[3] ? '' : '<div id="nic-ingredients-content">whole grain rolled oats</div>'}` }); }
    if (u.searchParams.get('page') === '3') return r.fulfill({ contentType: 'text/html', body: `<main id="yourOrders"><h1>Your Orders</h1><div class="order-card" data-order-id="333-1234567-1234567"><div class="order-header">Order placed October 1, 2026</div>${item('B000000008', '2 percent milk')}${item('B000000010', 'Protein bars')}${u.searchParams.has('freshText') ? item('B000000011', 'Whole grain oats') : ''}</div></main>` });
    return r.fulfill({ contentType: 'text/html', body: html(u.searchParams.get('page') === '2') });
  });
  await worker.evaluate(() => chrome.storage.local.set({ historyEnabled: false, historyAutoSync: false, purchaseHistory: [], historyOwner: '', enabled: true, ocrLabels: false, useOpenFoodFacts: false }));
  const raw = await worker.evaluate(() => chrome.storage.local.get(null)), version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  await worker.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), { key: scores.key('amazon.com', ids[4]), value: { schema: scores.SCHEMA, store: 'amazon.com', asin: ids[4], v: version, t: Date.now(), source: 'page', score: 88, verdict: 'Good', prefs: scores.fingerprint(raw, 'page'), name: 'Popcorn' } });
  await context.addCookies([{ name: 'private_order_test', value: 'do-not-send', domain: 'www.amazon.com', path: '/', secure: true }]);
  await page.goto(orders); await page.waitForTimeout(600);
  if (await page.locator('.air-order-badge').count() || requests.length) throw new Error('orders imported before opt-in');
  if (!await page.locator('#air-order-history').innerText().then(t => t.includes('Purchase history is off'))) throw new Error('disabled import explanation missing');
  await worker.evaluate(() => chrome.storage.local.set({ historyEnabled: true }));
  await page.waitForFunction(() => [...document.querySelectorAll('.air-order-badge')].some(b => b.textContent.includes('88/100')));
  if (await page.locator('#air-order-history').innerText().then(t => t.includes('This page imported'))) throw new Error('slow cold fixture unexpectedly completed before saved score');
  holdSlow = false; releaseSlow();
  await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'), null, { timeout: 20000 });
  const records = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
  const rated = records.filter(r => r.state === 'purchased' && r.score !== null);
  const average = Math.round(rated.reduce((sum, r) => sum + r.score, 0) / rated.length);
  if (!await page.locator('#air-order-history').innerText().then(t => t.includes(`Page average: ${average}/100`))) throw new Error('order page average missing or includes unavailable/cancelled products');
  for (const r of rated) if (!await page.locator('.air-order-badge').allTextContents().then(values => values.some(t => t.includes(`${r.score}/100`)))) throw new Error('individual order points missing');
  if (!await page.locator('#air-order-history').innerText().then(t => t.includes('3 non-food items excluded'))) throw new Error('non-food coverage count wrong');
  if (!await page.evaluate(() => document.querySelector('#air-order-history').parentElement.id === 'yourOrders' && document.querySelector('.order-card').previousElementSibling.id === 'air-order-history')) throw new Error('summary displaced Amazon navigation');
  for (const id of ['B000000006', 'B000000007']) if (requests.some(r => r.url().includes(id))) throw new Error('known non-food fetched a food label');
  if (!await page.locator('.air-order-badge').first().getAttribute('href').then(h => h === `${origin}/dp/${ids[0]}`)) throw new Error('order score link missing or leaks order context');
  if (!await page.evaluate(() => { const badge = document.querySelector('.air-order-image .air-order-badge').getBoundingClientRect(), image = document.querySelector('.air-order-image img').getBoundingClientRect(); return badge.top >= image.top && badge.bottom <= image.bottom && badge.left >= image.left && badge.right <= image.right; })) throw new Error('image-only rating overlaps another grid row');
  if (records.length !== 4 || records.filter(r => r.state === 'purchased' && r.score !== null).length !== 2 || records.some(r => r.asin === 'B000000003')) throw new Error('order eligibility or scoring failed: ' + JSON.stringify(records));
  if (JSON.stringify(records).includes('PRIVATE') || JSON.stringify(records).includes('111-1234567-1234567')) throw new Error('order personal fields saved');
  if (requests.some(r => r.url().includes(ids[4]))) throw new Error('orders did not reuse a valid saved score');
  if (requests.some(r => r.headers().cookie || r.headers().referer || r.url().includes('your-orders'))) throw new Error('order product request leaked cookies/referrer');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  if ((await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory)).length !== 4) throw new Error('revisited order duplicated');
  // A record misclassified by an older build must stop driving trends when revisited.
  await worker.evaluate(async () => {
    const old = (await chrome.storage.local.get('purchaseHistory')).purchaseHistory;
    const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('amazon.com:111-1234567-1234567:B000000006')))].map(n => n.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ purchaseHistory: [...old, { ...old[0], key, asin: 'B000000006', name: 'Folding Camping Table', state: 'purchased', score: 44, scoredAt: Date.now(), observedAt: Date.now() }] });
  });
  const refreshed = await worker.evaluate(() => chrome.storage.local.get(null));
  await worker.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), { key: scores.key('amazon.com', ids[3]), value: { schema: scores.SCHEMA, store: 'amazon.com', asin: ids[3], v: version, t: Date.now(), source: 'page', score: 66, verdict: 'Fair', prefs: scores.fingerprint(refreshed, 'page'), name: 'Corn chips' } });
  await page.waitForFunction(() => [...document.querySelectorAll('.air-order-badge')].some(b => b.textContent.includes('66/100')));
  await page.getByRole('button', { name: 'Refresh ratings' }).click();
  await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  const upgraded = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
  if (!upgraded.some(r => r.asin === 'B000000006' && r.state === 'unknown') || !upgraded.some(r => r.asin === 'B000000004' && r.score === 66)) throw new Error('refresh did not exclude legacy non-food or reuse a newly saved label');
  if (!await page.locator('.air-order-badge').allTextContents().then(t => t.some(x => x.includes('66/100')) && t.filter(x => x.includes('Not a food')).length === 3)) throw new Error('refresh badges missing or duplicated');
  await page.evaluate(() => { document.querySelector('.delivery-status').textContent = 'Returned'; });
  await page.waitForFunction(() => document.querySelector('.air-order-badge')?.textContent.includes('returned'));
  await page.goto(origin + '/gp/your-account/order-history/ref=ppx_yo_pagination_2?page=2'); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  const final = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
  if (final.length !== 6 || !final.some(r => r.date === '2026-08-01' && r.score !== null)) throw new Error('older order import failed');
  // Exercise the real vendored OCR worker on a generated, legible ingredient label.
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 260;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 260); ctx.fillStyle = '#000'; ctx.font = '36px Arial';
    ctx.fillText('INGREDIENTS:', 30, 65); ctx.fillText('WHOLE GRAIN OATS, HONEY, ALMONDS.', 30, 125); ctx.fillText('CONTAINS: ALMONDS.', 30, 190);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const ocrPage = await context.newPage();
  await ocrPage.goto(await worker.evaluate(() => chrome.runtime.getURL('src/offscreen/ocr.html')));
  const realOcr = await ocrPage.evaluate(async photo => {
    const bytes = Uint8Array.from(atob(photo), c => c.charCodeAt(0));
    const engine = await self.getWorker();
    try { const { data } = await engine.recognize(new Blob([bytes], { type: 'image/png' })); return AIR.db.ocrText.ingredientsFromOcr(data.text); }
    finally { await engine.terminate(); }
  }, photo);
  await ocrPage.close();
  if (!/oats/i.test(realOcr) || !/almonds/i.test(realOcr)) throw new Error('real OCR could not read the controlled label: ' + realOcr);
  // End-to-end fallback routing; actual OCR recognition has its own smoke test in harness-ci.
  await worker.evaluate(() => {
    self.__orderBarcode = self.lookupBarcode; self.__orderOcr = self.ocrLabels; self.__orderFallbacks = []; self.__orderSlowStarted = 0;
    self.lookupBarcode = async code => { self.__orderFallbacks.push({ type: 'barcode', code }); self.__orderSlowStarted++; await new Promise(resolve => { self.__orderBarcodeRelease = resolve; }); return { name: 'Milk', ingredients_text: 'milk, vitamin a palmitate, vitamin d3', labels: '' }; };
    self.ocrLabels = async urls => { self.__orderFallbacks.push({ type: 'ocr', urls }); self.__orderSlowStarted++; await new Promise(resolve => { self.__orderOcrRelease = resolve; }); return { ok: true, results: [{ text: 'INGREDIENTS: whole grain oats, honey, almonds. CONTAINS: almonds.', confidence: 90 }] }; };
  });
  await page.goto(orders + '?page=3'); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  if (await worker.evaluate(() => self.__orderFallbacks.length)) throw new Error('barcode/OCR ran with their controls off');
  await page.goto(orders + '?page=2'); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  await worker.evaluate(() => chrome.storage.local.set({ ocrLabels: true, useOpenFoodFacts: true, ratePace: 'gentle' }));
  await page.goto(orders + '?page=3&freshText=1');
  await page.waitForFunction(() => { const badge = document.querySelector('a.air-order-badge[href$="/B000000011"]'); return badge && /\d+\/100/.test(badge.textContent); });
  if (await page.locator('#air-order-history').innerText().then(t => t.includes('This page imported'))) throw new Error('held fallbacks completed before independent text fetch');
  // Wait for both fallback jobs, then release them after the independent text product has scored.
  for (let tries = 0; tries < 50 && !await worker.evaluate(() => self.__orderSlowStarted === 2); tries++) await page.waitForTimeout(100);
  if (!await worker.evaluate(() => self.__orderSlowStarted === 2)) throw new Error('fallback queue did not start both bounded jobs');
  await worker.evaluate(() => { self.__orderBarcodeRelease(); self.__orderOcrRelease(); });
  await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  const fallbacks = await worker.evaluate(async () => ({ requests: self.__orderFallbacks, records: (await chrome.storage.local.get('purchaseHistory')).purchaseHistory, rows: await chrome.storage.local.get(['p:amazon.com:B000000008', 'p:amazon.com:B000000010']) }));
  if (!fallbacks.requests.some(r => r.type === 'barcode' && r.code === '123456789012') || !fallbacks.requests.some(r => r.type === 'ocr' && r.urls.every(u => u.startsWith('https://m.media-amazon.com/images/I/')))) throw new Error('barcode/OCR order fallback missing');
  if (!['B000000008', 'B000000010'].every(id => fallbacks.records.some(r => r.asin === id && r.score !== null && r.ingredients))) throw new Error('fallback labels not scored/saved');
  if (fallbacks.rows['p:amazon.com:B000000008']?.data.via !== 'open-food-facts' || fallbacks.rows['p:amazon.com:B000000010']?.data.via !== 'label-ocr') throw new Error('fallback source not cached truthfully');
  const fallbackCount = fallbacks.requests.length;
  await page.reload(); await page.waitForFunction(() => document.querySelector('#air-order-history')?.textContent.includes('This page imported'));
  if (await worker.evaluate(n => self.__orderFallbacks.length !== n, fallbackCount)) throw new Error('saved fallback repeated on revisit');
  await worker.evaluate(() => { self.lookupBarcode = self.__orderBarcode; self.ocrLabels = self.__orderOcr; delete self.__orderBarcode; delete self.__orderOcr; delete self.__orderFallbacks; delete self.__orderSlowStarted; delete self.__orderBarcodeRelease; delete self.__orderOcrRelease; });
  const opened = context.waitForEvent('page'); await page.getByRole('button', { name: 'History & sync settings' }).click();
  const dashboard = await opened; await dashboard.waitForLoadState(); dashboard.on('pageerror', e => errors.push('history dashboard: ' + e.message));
  await dashboard.waitForFunction(() => document.querySelector('#metricItems')?.textContent === '6' && document.querySelector('#metricCoverage')?.textContent === '100%');
  await dashboard.locator('#months').evaluate(node => { node.closest('details').open = true; });
  if (!await dashboard.locator('#months').innerText().then(t => t.includes('2026-08'))) throw new Error('monthly purchase trends missing');
  if (!await dashboard.locator('#ocrLabels').isChecked() || !await dashboard.locator('#useOpenFoodFacts').isChecked()) throw new Error('label controls not visible or reflect wrong settings');
  await dashboard.locator('#ratePace').selectOption('fast');
  await dashboard.waitForFunction(() => !document.querySelector('#ratePace').disabled);
  if (await worker.evaluate(async () => (await chrome.storage.local.get('ratePace')).ratePace) !== 'fast') throw new Error('fetch pace setting not saved');
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
  if ((await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory)).length !== 9) throw new Error('offline sync lost local purchases');
  await worker.evaluate(() => { self.__purchaseOffline = false; });
  dashboard.on('dialog', dialog => dialog.accept());
  await dashboard.locator('#delete').click(); await dashboard.waitForFunction(() => document.querySelector('#status')?.textContent.includes('History deleted'));
  if (await worker.evaluate(async () => self.__purchaseRemote.length || (await chrome.storage.local.get('purchaseHistory')).purchaseHistory.length)) throw new Error('history deletion not confirmed');
  await worker.evaluate(() => { self.fetch = self.__purchaseFetch; AIR.googleAuth.token = self.__purchaseToken; chrome.permissions.contains = self.__purchasePermissions; delete self.__purchaseToken; delete self.__purchasePermissions; delete self.__purchaseFetch; delete self.__purchaseRequests; delete self.__purchaseRemote; delete self.__purchaseOffline; });
  await page.evaluate(() => history.pushState({}, '', '/checkout')); await page.waitForFunction(() => !document.querySelector('.air-order-badge'), null, { timeout: 5000 });
  await dashboard.close(); await page.close(); await context.clearCookies({ name: 'private_order_test' });
  await worker.evaluate(async () => { await chrome.storage.local.set({ historyEnabled: false, historyAutoSync: false, purchaseHistory: [] }); await chrome.storage.local.set({ ocrLabels: false, useOpenFoodFacts: false, ratePace: 'normal' }); await chrome.storage.local.remove(['s:amazon.com:B000000005', 's:amazon.com:B000000004', 'p:amazon.com:B000000001', 'p:amazon.com:B000000008', 'p:amazon.com:B000000010', 'p:amazon.com:B000000011']); });
  console.log('  ok orders → cached scores before held requests, automatic cache updates, bounded image badges, barcode/OCR routing and controls; opt-in first page, real scoring, no personal fields, deduplication, returns, older pages, purchase-only trends, automatic/manual account sync, offline retention and confirmed deletion (OAuth/backend fixtures)');
}
