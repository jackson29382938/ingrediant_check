// Real extension pages, local OCR and controlled product/barcode fixtures; no live shopping data.
export async function shoppingEndToEnd(context, worker, errors) {
  const keys = ['weights', 'allergens', 'diets', 'avoidList', 'enabled', 'autoScoreSearch', 'sharedCache', 'useOpenFoodFacts', 'theme', 'historyEnabled', 'historyOwner', 'googleProfile', 'purchaseHistory'];
  const before = await worker.evaluate(keys => chrome.storage.local.get(keys), keys);
  const session = await worker.evaluate(() => chrome.storage.session.get(['sortedResults', 'sortWeights']));
  const url = await worker.evaluate(() => chrome.runtime.getURL('src/options/library.html'));
  const page = await context.newPage(); page.on('pageerror', error => errors.push('shopping: ' + error.message));
  const savedIds = [];
  try {
    await worker.evaluate(() => chrome.storage.local.set({ enabled: true, historyEnabled: false, autoScoreSearch: false, sharedCache: false, allergens: ['milk', 'soy'], weights: {}, useOpenFoodFacts: false, theme: 'light' }));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById('savedStatus').textContent);
    for (const [name, ingredients, protein] of [['Feature test oats', 'whole grain oats', '12'], ['Feature test cereal', 'corn, sugar, milk, salt', '4']]) {
      await page.fill('#labelName', name); await page.fill('#labelText', ingredients);
      await page.locator('#labelForm details').evaluate(el => { el.open = true; }); await page.fill('#protein', protein);
      await page.getByRole('button', { name: 'Check a label', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#saveLabelControls')?.hidden === false);
      await page.fill('#shortlistName', 'Feature test breakfast'); await page.click('#saveLabel');
      await page.waitForFunction(() => document.querySelector('#checkStatus').textContent === 'Saved');
      const rows = await page.evaluate(() => AIR.db.shopping.list(chrome.storage.local));
      const saved = rows.find(p => p.name === name); if (!saved) throw new Error('Checked label was not saved'); savedIds.push(saved.id);
    }
    await page.selectOption('#productA', savedIds[0]); await page.selectOption('#productB', savedIds[1]);
    await page.waitForFunction(() => document.querySelector('#comparison table') && document.querySelector('#comparison').textContent.includes('Ingredient detected'));
    const table = await page.locator('#comparison').textContent();
    if (!table.includes('12 g per 100g') || !table.includes('4 g per 100g') || !table.includes('Main score contributions') || !table.includes('Unavailable')) throw new Error('Comparison lost nutrients, reasons or missing-value states');
    const original = await page.evaluate(async () => JSON.stringify(await AIR.db.shopping.list(chrome.storage.local)));
    await page.selectOption('#previewGoal', 'wholeFood');
    if (await page.evaluate(async () => JSON.stringify(await AIR.db.shopping.list(chrome.storage.local))) !== original) throw new Error('Goal preview rewrote saved product evidence');
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.saved-row').length >= 2);
    await page.selectOption('#listFilter', 'Feature test breakfast');
    if (await page.locator('.saved-row').count() !== 2) throw new Error('Named shortlist did not survive reload');
    await page.fill('#labelText', 'ingredients that cannot be read xyzq xyzq'); await page.getByRole('button', { name: 'Check a label', exact: true }).click();
    if (!await page.locator('#saveLabelControls').evaluate(el => el.hidden)) throw new Error('Unreadable manual label received a score');
    const photo = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 200; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 200); ctx.fillStyle = '#000'; ctx.font = '36px Arial'; ctx.fillText('INGREDIENTS: WHOLE GRAIN OATS, MILK, SALT.', 20, 80); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('#labelPhoto', { name: 'test-label.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
    await page.waitForFunction(() => document.getElementById('checkStatus').textContent.includes('Review the extracted text'), null, { timeout: 50000 });
    if (!/oats/i.test(await page.inputValue('#labelText')) || await page.locator('#checkResult .score').count()) throw new Error('OCR failed or bypassed text review');
    await worker.evaluate(() => {
      self.__shoppingFetch = self.fetch; self.__shoppingPermission = chrome.permissions.contains;
      chrome.permissions.contains = async () => true;
      self.fetch = (url, options) => String(url).startsWith('https://world.openfoodfacts.org/api/v2/product/9999999900012')
        ? Promise.resolve(new Response(JSON.stringify({ status: 1, product: { product_name: 'Feature test barcode', ingredients_text: 'oats, milk', categories_tags: ['en:breakfast-cereals'], product_type: 'food', nutriments: { proteins_100g: 8 }, nutrition_data_per: '100g' } }), { headers: { 'content-type': 'application/json' } })) : self.__shoppingFetch(url, options);
    });
    await page.evaluate(() => { chrome.permissions.request = async () => true; });
    await page.locator('details').filter({ has: page.locator('#barcode') }).evaluate(el => { el.open = true; });
    await page.fill('#barcode', '9999999900012'); await page.click('#lookupBarcode');
    await page.waitForFunction(() => document.getElementById('checkStatus').textContent.startsWith('Database match loaded'));
    if ((await worker.evaluate(() => chrome.storage.local.get('useOpenFoodFacts'))).useOpenFoodFacts !== false) throw new Error('Explicit barcode lookup changed the automatic lookup preference');
    const evidence = await page.evaluate(async () => { const prefs = await chrome.storage.local.get(['allergens', 'diets', 'avoidList', 'weights']); return AIR.db.shopping.evidence(AIR.engine.score({ ingredients_text: 'oats' }, prefs), { prefs }); });
    await worker.evaluate(evidence => chrome.storage.session.set({ sortedResults: { sourceUrl: 'https://www.amazon.com/s?k=oats&i=grocery', mode: 'health', unit: '100g', t: Date.now(), loading: false, items: [
      { asin: 'B999990001', title: 'Feature test budget oats', score: 90, listingPrice: 3, evidence },
      { asin: 'B999990002', title: 'Feature test expensive oats', score: 98, listingPrice: 10, evidence },
      { asin: 'B999990003', title: 'Feature test unknown label', score: null, listingPrice: 2 },
    ] }, sortWeights: { health: 10 } }), evidence);
    const sorted = await context.newPage(); sorted.on('pageerror', error => errors.push('shopping filters: ' + error.message));
    await sorted.goto(url.replace('library.html', 'sorted.html'));
    await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 3);
    await sorted.locator('.comparison-filters').evaluate(el => { el.open = true; });
    await sorted.fill('[data-filter=maxPrice]', '4'); await sorted.fill('[data-filter=minScore]', '80');
    await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 1);
    if (!(await sorted.locator('.result-list').textContent()).includes('budget oats')) throw new Error('Budget did not constrain the top-ranked result');
    await sorted.fill('[data-filter=minScore]', '99'); await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 0);
    if (!(await sorted.locator('.comparison-filters').textContent()).includes('0 of 3')) throw new Error('Empty filter result was not explained');
    await sorted.getByRole('button', { name: 'Clear filters', exact: true }).click(); await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 3);
    await sorted.check('[data-filter=complete]'); await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 2);
    await sorted.uncheck('[data-filter=complete]'); await sorted.check('[data-filter=noMatches]'); await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 2);
    await worker.evaluate(() => chrome.storage.local.set({ allergens: ['peanut'] }));
    await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 0);
    await sorted.check('[data-filter=includeUnknown]'); await sorted.waitForFunction(() => document.querySelectorAll('.result-list article').length === 3);
    await sorted.close();
    await page.selectOption('#listFilter', 'Feature test breakfast');
    await page.screenshot({ path: '/tmp/ingredient-labels-and-comparison.png', fullPage: true });
    for (const width of [390, 1280]) { await page.setViewportSize({ width, height: 900 }); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Label checker overflows viewport'); }
    console.log('  ok shopping → standalone text/photo/barcode checking, named local shortlists, evidence/nutrient comparison, read-only goal preview, budget/score/evidence filters and narrow barcode permission');
  } catch (error) {
    console.error('Shopping state:', JSON.stringify(await page.evaluate(() => ({ summary: document.getElementById('comparisonSummary')?.textContent, comparison: document.getElementById('comparison')?.textContent, selected: ['productA', 'productB'].map(id => document.getElementById(id)?.value), status: document.getElementById('savedStatus')?.textContent }))), errors);
    throw error;
  } finally {
    await page.close();
    await worker.evaluate(async ({ keys, before, savedIds, session }) => {
      if (self.__shoppingFetch) { self.fetch = self.__shoppingFetch; chrome.permissions.contains = self.__shoppingPermission; delete self.__shoppingFetch; delete self.__shoppingPermission; }
      await chrome.storage.local.remove([...savedIds.map(id => 'savedProduct:' + id), 'off:9999999900012', ...keys.filter(key => !(key in before))]); await chrome.storage.local.set(before);
      await chrome.storage.session.remove(['sortedResults', 'sortWeights']); await chrome.storage.session.set(session);
    }, { keys, before, savedIds, session });
  }
}
