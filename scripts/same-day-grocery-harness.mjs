import fs from 'node:fs';
export async function sameDayGroceryEndToEnd(context, worker, errors) {
  const before=await worker.evaluate(()=>chrome.storage.local.get(null));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(`same-day grocery: ${e.message}`));
  const html=fs.readFileSync(new URL('../tests/pages/amazon-same-day-grocery.html',import.meta.url),'utf8');let reads=0,panel;
  await page.route('**/*',r=>{
    const u=new URL(r.request().url());
    // "k=late": the page loads with no results and Amazon's script fills the grid two seconds later.
    if(u.pathname==='/s'&&u.searchParams.get('k')==='late')return r.fulfill({contentType:'text/html',body:html.replace(/<div class="s-main-slot">([\s\S]*?)<\/div><\/main>/,(_,cards)=>`<div class="s-main-slot"></div></main><script>setTimeout(()=>{document.querySelector('.s-main-slot').innerHTML=${JSON.stringify(cards)}},2000)</script>`)});
    if(u.pathname==='/s')return r.fulfill({contentType:'text/html',body:html});
    if(/^\/dp\/B0000000(?:0[123]|1[123])$/.test(u.pathname)){reads++;return r.fulfill({contentType:'text/html',body:`<h1 id="productTitle">Cottage cheese</h1><div id="wayfinding-breadcrumbs_feature_div">Grocery &amp; Gourmet Food</div><div id="nic-ingredients-content">Cultured pasteurized milk, cream, salt</div>`});}
    return r.abort();
  });
  try{
    await worker.evaluate(async()=>{
      await chrome.storage.local.set({enabled:true,foodOnly:true,badges:true,unitPrice:true,autoScoreSearch:true,sharedCache:false,sharedProducts:false,ocrLabels:false,useOpenFoodFacts:false,sortLoadMore:false});
      await chrome.storage.local.remove(['B000000001','B000000002','B000000003'].flatMap(id=>[`s:amazon.com:${id}`,`p:amazon.com:${id}`]));
    });
    await page.goto('https://www.amazon.com/s?k=cottage+cheese&i=same-day-grocery&srs=219444219011&crid=1H2Z2V3KUY2X7');
    await page.waitForFunction(()=>document.querySelectorAll('.air-badge[data-air]').length===3 && [...document.querySelectorAll('.air-badge')].every(b=>/^\d+$/.test(b.textContent.trim())),null,{timeout:20000});
    if(!reads)throw new Error('Same-day grocery labels were never requested');
    // Cards 1 and 3 hold a hidden "Quantity not updated" heading before their titles: every badge must be on screen.
    const hiddenBadges=await page.evaluate(()=>[...document.querySelectorAll('.air-badge')].filter(b=>!b.getClientRects().length).map(b=>b.closest('[data-asin]').dataset.asin));
    if(hiddenBadges.length)throw new Error(`Badges painted where nobody can see them: ${hiddenBadges}`);
    await page.selectOption('#s-result-sort-select','ingredient-check-score');
    await worker.evaluate(async()=>{const until=Date.now()+10000;while(Date.now()<until){const s=(await chrome.storage.session.get('sortedResults')).sortedResults;if(s&&!s.loading&&s.items.length===3){if(s.priceOnly||s.items.some(i=>i.score===null||!i.title.includes('cottage cheese')&&!i.title.includes('Cottage cheese')||/quantity/i.test(i.title)))throw new Error(`Grocery list lost food scores or names: ${s.items.map(i=>i.title)}`);return;}await new Promise(r=>setTimeout(r,50));}throw new Error('Same-day sorted list did not finish');});
    panel=await context.newPage();await panel.goto(await worker.evaluate(()=>chrome.runtime.getURL('src/options/sorted.html')));await panel.waitForSelector('article.product');
    if(await panel.locator('article.product').count()!==3)throw new Error('Grocery panel omitted products');
    const original=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId);
    await page.goto('https://www.amazon.com/s?k=milk&i=same-day-grocery');
    await worker.evaluate(async old=>{const until=Date.now()+10000;while(Date.now()<until){const s=(await chrome.storage.session.get('sortedResults')).sortedResults;if(s?.runId!==old&&!s.loading&&s.items.length===3&&new URL(s.sourceUrl).searchParams.get('k')==='milk')return;await new Promise(r=>setTimeout(r,50));}throw new Error('Open comparison did not follow the new query');},original);
    let followed=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId);
    // A search that changes the address with history.pushState and shows its results a moment later (no page load, so the
    // worker's sender.url still names "milk"): the panel must follow, and must not list the previous search's cards.
    const swapped=[['B000000011','Greek yogurt, 16 oz'],['B000000012','Greek yogurt, 32 oz'],['B000000013','Vanilla yogurt, 16 oz']];
    await page.evaluate(cards=>{history.pushState(null,'','/s?k=yogurt&i=same-day-grocery');setTimeout(()=>{document.querySelector('.s-main-slot').innerHTML=cards.map(([asin,name])=>`<article data-asin="${asin}"><a href="/dp/${asin}"><span class="a-text-normal">${name}</span></a><span class="a-price"><span class="a-offscreen">$3.00</span></span></article>`).join('');},1500);},swapped);
    await worker.evaluate(async old=>{const until=Date.now()+15000;while(Date.now()<until){const s=(await chrome.storage.session.get('sortedResults')).sortedResults;if(s&&s.runId!==old&&new URL(s.sourceUrl).searchParams.get('k')==='yogurt'&&!s.loading){if(s.items.map(i=>i.asin).join()!=='B000000011,B000000012,B000000013')throw new Error(`Soft navigation listed ${s.items.map(i=>i.asin)} (${s.status})`);return;}await new Promise(r=>setTimeout(r,50));}throw new Error('Open comparison did not follow a search that changed only the address');},followed);
    followed=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId);
    // A page that loads with no results and fills the grid later: the list waits for the cards instead of reporting none.
    await page.goto('https://www.amazon.com/s?k=late&i=same-day-grocery');
    await worker.evaluate(async old=>{const until=Date.now()+15000;while(Date.now()<until){const s=(await chrome.storage.session.get('sortedResults')).sortedResults;if(s&&s.runId!==old&&new URL(s.sourceUrl).searchParams.get('k')==='late'&&!s.loading){if(s.items.length!==3)throw new Error(`Late results listed ${s.items.length} (${s.status})`);return;}await new Promise(r=>setTimeout(r,50));}throw new Error('Open comparison did not follow a page whose results arrive after load');},followed);
    followed=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId);
    await page.goto('https://www.amazon.com/s?k=sunscreen&i=beauty');
    await worker.evaluate(async()=>{const until=Date.now()+10000;while(Date.now()<until){const s=(await chrome.storage.session.get('sortedResults')).sortedResults;if(s?.priceOnly&&!s.loading&&s.items.length===3&&s.items.every(p=>p.score===null))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Following a non-food query did not switch to price-only');});
    followed=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId);
    await worker.evaluate(()=>chrome.storage.local.set({sortFollowSearch:false}));
    await page.goto('https://www.amazon.com/s?k=eggs&i=same-day-grocery');
    await page.waitForSelector('option[value="ingredient-check-score"]',{state:'attached'});await page.waitForTimeout(500);
    if(await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId)!==followed)throw new Error('Follow opt-out did not retain the previous query');
    await worker.evaluate(()=>chrome.storage.local.set({sortFollowSearch:true}));
    for (const view of context.pages()) if (/\/src\/options\/(?:sorted|sidepanel)\.html/.test(view.url())) await view.close();
    await worker.evaluate(async()=>{const s=(await chrome.storage.session.get('sortedResults')).sortedResults; if(chrome.sidePanel?.close) { await chrome.sidePanel.close({tabId:s.sourceTabId}).catch(()=>{}); const tab=await chrome.tabs.get(s.sourceTabId); await chrome.sidePanel.close({windowId:tab.windowId}).catch(()=>{}); }});
    await page.waitForTimeout(300);
    const closedSnapshot=await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId);
    await page.goto('https://www.amazon.com/s?k=yogurt&i=same-day-grocery');
    await page.waitForSelector('option[value="ingredient-check-score"]',{state:'attached'});await page.waitForTimeout(500);
    if(await worker.evaluate(async()=> (await chrome.storage.session.get('sortedResults')).sortedResults.runId)!==closedSnapshot)throw new Error('Closed comparison continued following searches');
    console.log('  ok panel follow → new source-tab query updates automatically, also when only the address changes or results arrive late; opt-out preserves the old list');
    console.log('  ok same-day grocery → linked/h3 titles past a hidden add-to-cart heading, visible cold score badges and three scored sort results');
  }finally{await panel?.close();await page.close();await worker.evaluate(async old=>{await chrome.storage.local.clear();await chrome.storage.local.set(old);},before);}
}
