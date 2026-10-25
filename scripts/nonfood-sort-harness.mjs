// Price comparison must remain independent of the ingredient reader.
export async function nonfoodSortEndToEnd(context, worker, errors) {
  const before = await worker.evaluate(() => chrome.storage.local.get(null));
  const page = await context.newPage(); page.on('pageerror', e => errors.push(`nonfood sort: ${e.message}`));
  let productRequests = 0;
  const card = (id, title, price) => `<div class="s-result-item" data-component-type="s-search-result" data-asin="${id}"><h2><a href="/dp/${id}">${title}</a></h2><span class="a-price"><span class="a-offscreen">$${price}</span></span></div>`;
  await page.route('**/*', route => {
    if (new URL(route.request().url()).pathname !== '/s') { productRequests++; return route.abort(); }
    return route.fulfill({contentType:'text/html',body:`<title>Shampoo and batteries</title><select id="s-result-sort-select"><option value="relevanceblender">Featured</option><option value="price-asc-rank">Price: Low to High</option></select><div id="search"><div class="s-main-slot">${card('B000000001','Shampoo 32 fl oz','8.00')}${card('B000000002','Shampoo 16 fl oz','6.00')}${card('B000000003','AA batteries 8 count','8.00')}${card('B000000004','AA batteries 4 count','6.00')}</div></div>`});
  });
  let panel;
  try {
    await worker.evaluate(() => chrome.storage.local.set({enabled:true,foodOnly:true,unitPrice:true,autoScoreSearch:true,sortMissing:'rate-first',sortLoadMore:false,sharedCache:true}));
    await page.goto('https://www.amazon.com/s?k=shampoo');
    await page.waitForSelector('option[value="ingredient-check-price-per-ounce"]', {state:'attached'});
    if (await page.locator('option[value="ingredient-check-score"]').count()) throw new Error('Non-food search offers health sorting');
    await page.selectOption('#s-result-sort-select','ingredient-check-price-per-ounce');
    await worker.evaluate(async () => {
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){const {sortedResults:s}=await chrome.storage.session.get('sortedResults');if(s?.priceOnly && !s.loading && s.items.length===4)return;await new Promise(r=>setTimeout(r,50));}
      throw new Error('Non-food listings did not finish: '+JSON.stringify((await chrome.storage.session.get('sortedResults')).sortedResults));
    });
    const result=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults);
    if(result.items.some(p=>p.score!==null || p.why))throw new Error('Health data leaked into price-only list');
    const items=new Map(result.items.map(p=>[p.asin,p]));
    if(items.get('B000000001').unitPrices.fluid!==0.25 || items.get('B000000003').unitPrices.count!==1)throw new Error('Volume/count unit prices were not extracted');
    panel=await context.newPage(); await panel.goto(await worker.evaluate(()=>chrome.runtime.getURL('src/options/sorted.html')));
    await panel.waitForSelector('article.product');
    if(await panel.locator('[data-factor="health"]').isVisible() || await panel.locator('[data-preset="health"]').isVisible())throw new Error('Price-only UI exposes health controls');
    await panel.locator('#unit-select').selectOption('floz');
    await panel.waitForFunction(() => document.querySelector('article.product h2')?.textContent.includes('Shampoo 32'));
    await panel.locator('#unit-select').selectOption('ct');
    await panel.waitForFunction(() => document.querySelector('article.product h2')?.textContent.includes('AA batteries 8'));
    if(productRequests || await page.locator('.air-badge,#air-score-panel').count())throw new Error('Price comparison performed ingredient work');
    console.log('  ok non-food sorting → volume/count prices, no health menu/controls/scores, no product requests');
  } finally {await panel?.close();await page.close();await worker.evaluate(async old=>{await chrome.storage.local.clear();await chrome.storage.local.set(old);},before);}
}
