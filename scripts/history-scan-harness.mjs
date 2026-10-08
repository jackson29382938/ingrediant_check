// Controlled authenticated-page-shaped fixtures; never contacts a real Amazon account.
export async function historyScanEndToEnd(context, worker, errors, extensionId) {
  const ids = ['B0SCAN0001', 'B0SCAN0002'];
  const requests = [];
  const card = (year, second) => `<div class="order-card" data-order-id="${year === '2025' ? '222' : second ? '333' : '111'}-1234567-1234567"><div class="order-header">Order placed January 3, ${year}</div><div class="product-box"><a href="/dp/${ids[second ? 1 : 0]}"><img alt="Whole grain oats" width="100" height="100"></a><a href="/dp/${ids[second ? 1 : 0]}">Whole grain oats</a></div></div>`;
  const route = async r => {
    const u = new URL(r.request().url()), id = ids.find(id => u.pathname.includes(id));
    if (id) return r.fulfill({ contentType: 'text/html', body: `<h1 id="productTitle">Whole grain oats</h1><input id="ASIN" value="${id}"><div id="nic-ingredients-content">whole grain rolled oats</div>` });
    requests.push(u.href);
    const year = u.searchParams.get('timeFilter') === 'year-2025' ? '2025' : '2026', second = u.searchParams.get('startIndex') === '10';
    await r.fulfill({ contentType: 'text/html', body: `<html><head><title>Your Orders</title></head><body><h1>Your Orders</h1><select name="timeFilter"><option value="year-2026">2026</option><option value="year-2025">2025</option></select><p>${year === '2026' ? '20' : '10'} orders placed</p>${card(year, second)}${u.searchParams.get('timeFilter') === 'year-2026' && !second ? '<ul class="a-pagination"><li class="a-last"><a href="?timeFilter=year-2026&startIndex=10">Next</a></li></ul>' : ''}</body></html>` });
  };
  await context.route('https://www.amazon.com/**', route);
  await worker.evaluate(async ids => {
    await chrome.storage.local.remove(ids.flatMap(id => [`s:amazon.com:${id}`, `p:amazon.com:${id}`]));
    await chrome.storage.local.set({ enabled: true, historyEnabled: true, historyAutoSync: false, historyOwner: '', historyDeletePending: false, purchaseHistory: [], googleProfile: null,
      weights: {}, goals: [], allergens: [], diets: [], avoidList: [], orderBadgePlacement: 'image', hoverBreakdown: true, breakdownDelayMs: 20, ocrLabels: false, useOpenFoodFacts: false });
  }, ids);
  const history = await context.newPage(); history.on('pageerror', e => errors.push(`history scan: ${e.message}`));
  let scanPage;
  try {
    await history.goto(`chrome-extension://${extensionId}/src/options/history.html`);
    await history.waitForFunction(() => !document.querySelector('#scanStart').disabled);
    await history.click('#scanStart');
    await history.waitForFunction(() => document.querySelector('#scanStatus').textContent.includes('Scan complete'), null, { timeout: 30000 });
    const state = await worker.evaluate(async () => (await chrome.storage.local.get('historyScan')).historyScan);
    if (state.pages !== 4 || state.status !== 'complete' || !state.background) throw new Error(`Unexpected scan coverage: ${JSON.stringify(state)}`);
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
    if (stored.length !== 3 || stored.some(r => r.score === null)) throw new Error('All available fixture years/pages were not imported and scored');
    if (!requests.some(u => u.includes('year-2025')) || !requests.some(u => u.includes('startIndex=10'))) throw new Error('Older year or Next page missed');
    const tab = await worker.evaluate(async id => chrome.tabs.get(id), state.tabId);
    if (tab.active) throw new Error('Background scan stole foreground focus');
    scanPage = context.pages().find(p => p.url() === state.currentURL);
    if (!scanPage) throw new Error('Final scan tab missing');
    await scanPage.waitForSelector('.air-order-badge');
    const bounds = await scanPage.locator('.air-order-badge').evaluate(b => {
      const r = b.getBoundingClientRect(), img = b.parentElement.querySelector('img').getBoundingClientRect();
      return { inside: r.left >= img.left && r.top >= img.top && r.right <= img.right + 1 && r.bottom <= img.bottom + 1, overlay: b.dataset.imageOnly };
    });
    if (!bounds.inside || bounds.overlay !== 'true') throw new Error('Title-bearing item did not use bounded image overlay by default');
    await scanPage.locator('.air-order-badge').hover();
    await scanPage.waitForSelector('#air-order-details');
    if (!(await scanPage.locator('#air-order-details').getAttribute('aria-label')).includes('purchase score')) throw new Error('Hover snapshot details missing');
    await scanPage.keyboard.press('Escape'); await scanPage.waitForSelector('#air-order-details', { state: 'detached' });
    await scanPage.locator('.air-order-badge').evaluate(b => b.blur());
    await scanPage.waitForTimeout(50);
    await scanPage.locator('.air-order-badge').focus(); await scanPage.waitForSelector('#air-order-details');
    await scanPage.keyboard.press('Escape');
    await history.selectOption('#orderBadgePlacement', 'title');
    await scanPage.waitForFunction(() => !document.querySelector('.air-order-badge')?.dataset.imageOnly);
    await history.selectOption('#orderBadgePlacement', 'image');
    await scanPage.waitForFunction(() => document.querySelector('.air-order-badge')?.dataset.imageOnly === 'true');
    // Manual pause/resume keeps imported snapshots and resumes via a new ordinary tab.
    await history.click('#scanStart'); await history.waitForFunction(() => document.querySelector('#scanStatus').textContent.includes('Scanning'));
    await history.click('#scanPause'); await history.waitForFunction(() => document.querySelector('#scanStatus').textContent.includes('Scan paused'));
    await history.click('#scanResume'); await history.waitForFunction(() => document.querySelector('#scanStatus').textContent.includes('Scan complete'), null, { timeout: 30000 });
    const repeated = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
    if (repeated.length !== 3) throw new Error('Full scan duplicated existing purchases');
  } catch (error) {
    console.log('  full-history debug', JSON.stringify({ state: await worker.evaluate(async () => (await chrome.storage.local.get('historyScan')).historyScan), status: await history.locator('#scanStatus').textContent(), requests, pages: context.pages().map(p => p.url()), errors }));
    throw error;
  } finally {
    const state = await worker.evaluate(async () => (await chrome.storage.local.get('historyScan')).historyScan);
    if (state?.tabId !== undefined) await worker.evaluate(id => chrome.tabs.remove(id).catch(() => {}), state.tabId);
    if (scanPage && !scanPage.isClosed()) await scanPage.close();
    await history.close(); await context.unroute('https://www.amazon.com/**', route);
    await worker.evaluate(async ids => { await chrome.storage.local.remove(['historyScan', ...ids.flatMap(id => [`s:amazon.com:${id}`, `p:amazon.com:${id}`])]); await chrome.storage.local.set({ historyEnabled: false, purchaseHistory: [], orderBadgePlacement: 'image', breakdownDelayMs: 200 }); }, ids);
  }
  console.log('  ok full history → background year/pagination scan, progressive ratings, bounded image overlays, hover/focus snapshot details, placement setting, pause/resume and deduplication');
}
