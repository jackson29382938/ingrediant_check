// Real dashboard behavior with private synthetic records, never a live account.
export async function historyDashboardEndToEnd(history, worker) {
  const keys = ['purchaseHistory', 'weights', 'goals', 'goalImportance', 'theme'];
  const before = await worker.evaluate(async keys => chrome.storage.local.get(keys), keys);
  const records = Array.from({ length: 6 }, (_, i) => ({ key: (i + 10).toString(16).padStart(64, '0'), orderKey: ['a', 'a', 'b', 'c', 'c', 'd'][i].repeat(64), store: 'amazon.com', asin: 'B0DASH000' + i, date: ['2026-09-01', '2026-09-01', '2026-08-01', '2026-05-01', '2026-05-01', '2026-10-01'][i], state: i === 5 ? 'returned' : 'purchased', name: ['Rolled oats', 'Wholegrain cereal', 'Snack bar', 'Plain yogurt', 'Missing label', 'Returned snack'][i], score: [10, 80, 40, 90, null, 0][i], ingredients: i === 4 ? '' : 'sugar, wheat flour, palm oil, salt', input: i === 4 ? undefined : { name: 'Snack', ingredients_text: 'sugar, wheat flour, palm oil, salt' }, flags: i === 2 ? ['Palm oil'] : [], profile: 'f'.repeat(64), version: '1.13.0', observedAt: 10000, scoredAt: i === 4 ? 0 : 10000 }));
  try {
    await worker.evaluate(records => chrome.storage.local.set({ purchaseHistory: records, weights: {}, goals: [], goalImportance: {} }), records);
    const initialStored = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
    await history.waitForFunction(() => document.querySelector('#metricItems').textContent === '5');
    if (await history.locator('#orderTotals tr').count() !== 4) throw new Error('Order summary totals missing');
    if (await history.locator('#metricOrders').textContent() !== '3') throw new Error('Product entries were incorrectly counted as orders');
    if (await history.locator('#metricAverage').textContent() !== '55') throw new Error('Recorded score average changed');
    if (!(await history.locator('#scanProgress').getAttribute('value'))) throw new Error('Completed scan progress missing');
    if (await history.locator('#trendChart svg circle').count() !== 3) throw new Error('Timeline points missing');
    await history.selectOption('#averageWeight', 'order');
    await history.waitForFunction(() => document.querySelector('#metricAverage').textContent.startsWith('58'));
    await history.selectOption('#averageWeight', 'item');
    await history.fill('#itemSearch', 'Snack bar'); await history.waitForFunction(() => document.querySelectorAll('#items tr').length === 1);
    await history.click('#resetFilters'); await history.waitForFunction(() => document.querySelectorAll('#items tr').length === 6);
    await history.selectOption('#ratingFilter', 'missing'); await history.waitForFunction(() => document.querySelector('#metricAverage').textContent === '—');
    await history.click('#resetFilters');
    await history.selectOption('#itemSort', 'highest'); await history.waitForFunction(() => document.querySelector('#items tr td:nth-child(5)').textContent === '90');
    await history.selectOption('#scoreView', 'current');
    await history.waitForFunction(() => document.querySelector('#viewNote').textContent.startsWith('Showing current-goal'));
    const average = await history.locator('#metricAverage').textContent();
    await worker.evaluate(() => chrome.storage.local.set({ weights: { processing: 0 } }));
    await history.waitForFunction(old => document.querySelector('#viewNote').textContent.startsWith('Showing current-goal') && document.querySelector('#metricAverage').textContent !== old, average);
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('purchaseHistory')).purchaseHistory);
    if (JSON.stringify(stored) !== JSON.stringify(initialStored)) throw new Error('Comparison rewrote recorded history');
    await history.locator('.statistics').evaluate(d => { d.open = true; });
    await history.selectOption('#errorBars', 'range'); await history.waitForFunction(() => document.querySelector('#trendChart .error'));
    await history.selectOption('#errorBars', 'ci'); await history.waitForFunction(() => !document.querySelector('#trendChart .error'));
    if ((await history.locator('#statistics').textContent()).includes('95% intervalUnavailable')) throw new Error('Overall order-cluster interval unavailable despite three clusters');
    await history.selectOption('#errorBars', 'iqr');
    await history.selectOption('#scoreView', 'recorded'); await history.waitForFunction(() => document.querySelector('#metricAverage').textContent === '55');
    await history.locator('.statistics').evaluate(d => { d.open = true; });
    await history.locator('.dashboard').screenshot({ path: '/tmp/ic-purchase-trends-dashboard.png' });
    await worker.evaluate(() => chrome.storage.local.set({ theme: 'dark' }));
    await history.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme.includes('dark'));
    await history.setViewportSize({ width: 390, height: 844 });
    if (await history.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('Dashboard overflows a mobile viewport');
    await history.evaluate(() => { document.body.style.fontSize = '20px'; document.body.style.fontFamily = 'Arial, sans-serif'; });
    await history.setViewportSize({ width: 340, height: 844 });
    if (await history.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('Dashboard overflows a narrow viewport with larger fonts');
    await history.evaluate(() => { document.body.style.removeProperty('font-size'); document.body.style.removeProperty('font-family'); });
    const large = Array.from({ length: 502 }, (_, i) => ({ ...records[0], key: (i + 100).toString(16).padStart(64, '0'), orderKey: (i + 1000).toString(16).padStart(64, '0') }));
    await worker.evaluate(records => chrome.storage.local.set({ purchaseHistory: records }), large);
    await history.waitForFunction(() => document.querySelector('#metricItems').textContent === '502');
    const totals = await history.locator('#orderTotals').evaluate(body => { const rows = [...body.rows]; return { rows: rows.length, sum: rows.slice(0, -1).reduce((sum, row) => sum + Number(row.cells[2].textContent), 0), total: Number(rows.at(-1).cells[2].textContent) }; });
    if (totals.rows !== 502 || totals.sum !== 502 || totals.total !== 502) throw new Error('Large order table exceeded bounds or its aggregate no longer summed');
  } finally {
    await worker.evaluate(async ({ before, keys }) => { await chrome.storage.local.remove(keys.filter(k => !(k in before))); await chrome.storage.local.set(before); }, { before, keys });
    await history.setViewportSize({ width: 1280, height: 720 });
  }
  console.log('  ok purchase dashboard → order/item totals, charts, progress, equal-order weighting, filters/sorts, current goals without snapshot writes, error bars and mobile dark layout');
}
