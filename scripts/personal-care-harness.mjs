// Real manifest content scripts in Chromium against controlled public pages. Chrome APIs are
// simulated here so this also runs on managed browsers that prohibit unpacked extensions.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function personalCareEndToEnd(browser, root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const product = (id, name, ingredients, facts = '') => `<html><body><input id="ASIN" value="${id}"><h1 id="productTitle">${name}</h1><div id="important-information"><div id="nic-ingredients-content">${ingredients}</div></div><div id="nic-nutrition-facts-content">${facts}</div><div id="feature-bullets"></div></body></html>`;
  const tooth = product('B000CARE01', 'Fluoride toothpaste', 'Water, sodium fluoride, sorbitol, silica');
  const oats = product('B000CARE02', 'Rolled oats', 'Organic rolled oats');
  // An Amazon beauty page as it is laid out: price block and overview near the top, the long product description
  // and A+ content in the middle, and "Important information" (where the ingredients are) last.
  const beauty = (id, name, ingredients) => `<html><body><input id="ASIN" value="${id}"><div id="centerCol"><h1 id="productTitle">${name}</h1>
    <div id="wayfinding-breadcrumbs_feature_div">Beauty &amp; Personal Care › Deodorants</div>
    <div id="productOverview_feature_div"><table><tr><td>Brand</td><td>Test</td></tr></table></div>
    <div id="featurebullets_feature_div"><div id="feature-bullets"><ul><li>Aluminum free</li></ul></div></div></div>
    <div id="productDescription"><p>${'A long description. '.repeat(40)}</p></div><div id="aplus"><p>A+ content</p></div>
    <div id="important-information"><div class="a-section"><h4>Ingredients</h4><p>${ingredients}</p></div></div></body></html>`;
  const SCHMIDTS = "Caprylic/Capric Triglyceride, Stearyl Alcohol, Magnesium Hydroxide, Sodium Bicarbonate, Arrowroot Powder, Shea Butter, Fragrance, Candelilla Wax, Tocopherol";
  const NATURAL = 'Propylene Glycol, Water, Sodium Stearate, Caprylyl Glycol, Cocos Nucifera (Coconut) Oil, Parfum, Geraniol, Limonene, Linalool, Pelargonium Graveolens Flower Oil';
  const DOVE = 'Aluminum Zirconium Tetrachlorohydrex GLY (20%) (Active Ingredient), Cyclopentasiloxane, Stearyl Alcohol, PPG-14 Butyl Ether, Hydrogenated Castor Oil, Fragrance, Dimethicone';
  const fixtures = { B000CARE01: tooth, B000CARE02: oats,
    B000CARE05: beauty('B000CARE05', "Schmidt's Aluminum-Free Deodorant Fresh Cucumber 2.65 oz", SCHMIDTS),
    B000CARE06: beauty('B000CARE06', 'ARM & HAMMER Essentials Deodorant - Made with Natural Deodorizers - Coconut Geranium', NATURAL),
    B000CARE07: beauty('B000CARE07', 'DOVE MEN + CARE Antiperspirant Deodorant Stick Extra Fresh, 4 Count, 2.7 oz', DOVE) };
  const errors = [];
  async function open(url, html, type = 'src/content/main.js') {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.fulfill({status:200, contentType:'text/html',body: Object.entries(fixtures).find(([id]) => route.request().url().endsWith('/dp/'+id))?.[1] || html}));
    await page.goto(url);
    await page.evaluate(manifest => {
      const listeners = [];
      window.__stored = { enabled:true,badges:true,foodOnly:true,personalCareEnabled:true,ratingStyle:'evidence', autoScoreSearch:true,
        ocrLabels:false,useOpenFoodFacts:false,sharedCache:false,sharedProducts:false,sendDiagnostics:false,weights:{},allergens:[],diets:[],avoidList:[],panelOpen:true };
      window.__messages=[];
      const get=(keys,cb)=>{ const source=window.__stored; const names=keys==null?Object.keys(source):typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys); const result=Object.fromEntries(names.filter(k=>k in source).map(k=>[k,source[k]])); if(cb)cb(result); return Promise.resolve(result); };
      const set=(values,cb)=>{const changes={}; for(const [k,v]of Object.entries(values)){changes[k]={oldValue:window.__stored[k],newValue:v};window.__stored[k]=v;} if(cb)cb(); setTimeout(()=>listeners.forEach(fn=>fn(changes,'local')),0); return Promise.resolve();};
      window.chrome={runtime:{id:'care-test',getManifest:()=>manifest,getURL:s=>'https://www.amazon.com/'+s,onMessage:{addListener(){}},sendMessage:(message,cb)=>{window.__messages.push(message);if(cb)cb({});return Promise.resolve({});}},
        i18n:{getMessage:()=>''},storage:{local:{get,set,remove:(keys,cb)=>{for(const k of [].concat(keys))delete window.__stored[k];if(cb)cb();return Promise.resolve();},getKeys:()=>Promise.resolve(Object.keys(window.__stored))},onChanged:{addListener:fn=>listeners.push(fn)}},
        permissions:{contains:(_p,cb)=>{if(cb)cb(false);return Promise.resolve(false);}},tabs:{},extension:{}};
    }, manifest);
    const group=manifest.content_scripts.find(g=>g.js.includes(type));
    // One batch, as the browser runs a content-script list: injected a file at a time, the page's event loop turns between
    // files, and a search tile's fetch can finish before a later file (src/stores/cart.js, which search.js reads pages with) exists.
    await page.addScriptTag({content: group.js.map(file => fs.readFileSync(path.join(root,file),'utf8')).join('\n;\n')});
    return page;
  }
  const p=await open('https://www.amazon.com/dp/B000CARE01',tooth);
  try {
    await p.waitForFunction(()=>document.querySelector('#air-score-panel')?.dataset.airState==='scored');
    let result=await p.evaluate(()=>({entry:window.__stored['s:amazon.com:B000CARE01'],text:AIR.panel.shadowOf(document.querySelector('#air-score-panel')).textContent}));
    assert.equal(result.entry.category,'toothpaste'); assert.equal(result.entry.score,100); assert.match(result.text,/Toothpaste · Evidence-based/); assert.doesNotMatch(result.text,/Ultra-processed/);
    await p.evaluate(()=>chrome.storage.local.set({ratingStyle:'minimal'}));
    await p.waitForFunction(()=>window.__stored['s:amazon.com:B000CARE01']?.ratingStyle==='minimal');
    assert.equal(await p.evaluate(()=>window.__stored['s:amazon.com:B000CARE01'].score),91);
    await p.evaluate(()=>chrome.storage.local.set({ratingStyle:'preferences',avoidList:['sorbitol']}));
    await p.waitForFunction(()=>window.__stored['s:amazon.com:B000CARE01']?.ratingStyle==='preferences');
    assert.equal(await p.evaluate(()=>window.__stored['s:amazon.com:B000CARE01'].score),80);
    await p.evaluate(()=>chrome.storage.local.set({enabled:false}));
    await p.waitForFunction(()=>!document.querySelector('#air-score-panel'));
  } finally {await p.close();}
  const s=await open('https://www.amazon.com/s?k=toothpaste',`<html><body><div id="search"><div class="s-main-slot">${['B000CARE01','B000CARE02'].map((id,i)=>`<div data-asin="${id}"><h2><a href="/dp/${id}">${i?'Rolled oats':'Fluoride toothpaste'}</a></h2></div>`).join('')}</div></div></body></html>`);
  try {await s.waitForFunction(()=>document.querySelectorAll('.air-badge').length===2 && [...document.querySelectorAll('.air-badge')].every(b=>/\d/.test(b.textContent))); assert.match((await s.locator('.air-badge').allTextContents()).join(' '),/100 · Toothpaste/);} finally {await s.close();}
  const cart=await open('https://www.amazon.com/gp/cart/view.html',`<html><body><div id="sc-active-items"><h1 id="sc-active-items-header">Shopping Cart</h1></div><div id="sc-active-cart">${['B000CARE01','B000CARE02'].map((id,i)=>`<div class="sc-list-item" data-asin="${id}"><a href="/dp/${id}"><h2>${i?'Rolled oats':'Fluoride toothpaste'}</h2></a></div>`).join('')}</div></body></html>`,'src/content/cart.js');
  try {await cart.waitForFunction(()=>document.querySelectorAll('.air-cart-badge[data-air-status="scored"]').length===2);await cart.waitForFunction(()=>document.querySelector('.air-cart-summary'));const summary=await cart.evaluate(()=>document.querySelector('.air-cart-summary').shadowRoot.querySelector('.box').textContent);assert.match(summary,/Toothpaste: 100/);assert.match(summary,/Food: /); assert.equal(await cart.evaluate(()=>document.querySelector('.air-cart-summary').shadowRoot.querySelector('.num').textContent),'—');} finally {await cart.close();}
  const targetHtml = '<html><body><h1 data-test="product-title">Gentle shampoo</h1><div data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><button aria-expanded="true">Label info</button><h4>Ingredients</h4><div>Water, sodium laureth sulfate, cocamidopropyl betaine</div></div></body></html>';
  const target = await open('https://www.target.com/p/gentle-shampoo/-/A-12345678',targetHtml,'src/content/retailer.js');
  try {await target.waitForFunction(()=>document.querySelector('#air-score-panel')?.dataset.airState==='scored');assert.equal(await target.evaluate(()=>window.__stored['s:target.com:12345678']?.category),'shampoo');} finally {await target.close();}
  const complete=await open('https://www.amazon.com/dp/B000CARE04',product('B000CARE04','Multivitamin','Vitamin C, cellulose, gelatin','Supplement Facts Serving Size 1 tablet Vitamin C 90 mg'));
  try {await complete.waitForFunction(()=>document.querySelector('#air-score-panel')?.dataset.airState==='scored');assert.equal(await complete.evaluate(()=>window.__stored['s:amazon.com:B000CARE04']?.score),100);}finally{await complete.close();}
  const missing=await open('https://www.amazon.com/dp/B000CARE03',product('B000CARE03','Multivitamin','Vitamin C, cellulose'));
  try {await missing.waitForFunction(()=>document.querySelector('#air-score-panel')?.dataset.airState==='personal-care');assert.equal(await missing.evaluate(()=>window.__messages.some(m=>m.type==='pageScore' && Number.isFinite(m.score))),false);}finally{await missing.close();}
  // A deodorant page is laid out like a food page: the panel is under the price block, not below the A+ content.
  const deo=await open('https://www.amazon.com/dp/B000CARE05',fixtures.B000CARE05);
  try {
    await deo.waitForFunction(()=>document.querySelector('#air-score-panel')?.dataset.airState==='scored');
    const where=await deo.evaluate(()=>{const host=document.querySelector('#air-score-panel');const next=host.nextElementSibling;
      return {before:next&&next.id, aboveDescription:!!(host.compareDocumentPosition(document.querySelector('#productDescription'))&Node.DOCUMENT_POSITION_FOLLOWING),
        text:AIR.panel.shadowOf(host).textContent, style:AIR.panel.shadowOf(host).querySelector('.card').getAttribute('style'), entry:window.__stored['s:amazon.com:B000CARE05']};});
    assert.equal(where.before,'productOverview_feature_div'); assert.ok(where.aboveDescription);
    assert.equal(where.entry.score,85); assert.equal(where.entry.verdict,'Good');
    assert.match(where.text,/GOOD/); assert.match(where.text,/Deodorant · Evidence-based/); assert.doesNotMatch(where.text,/LABEL INDEX/);
    assert.match(where.text,/What hurt/); assert.match(where.text,/Fragrance is disclosed/); assert.match(where.text,/Not counted against it/);
    assert.ok(!where.style.includes('#444a4a'),'the band color, not the neutral gray');
  } finally {await deo.close();}
  // The three deodorants that used to read as 80, 70 or "?": each is rated, and they differ.
  const results=await open('https://www.amazon.com/s?k=deodorant',`<html><body><div id="search"><div class="s-main-slot">${[['B000CARE05',"Schmidt's Aluminum-Free Deodorant Fresh Cucumber 2.65 oz"],['B000CARE06','ARM & HAMMER Essentials Deodorant - Made with Natural Deodorizers - Coconut Geranium'],['B000CARE07','DOVE MEN + CARE Antiperspirant Deodorant Stick Extra Fresh, 4 Count, 2.7 oz']].map(([id,name])=>`<div data-asin="${id}"><h2><a href="/dp/${id}">${name}</a></h2></div>`).join('')}</div></div></body></html>`);
  try {
    await results.waitForFunction(()=>document.querySelectorAll('.air-badge').length===3 && [...document.querySelectorAll('.air-badge')].every(b=>/^\d/.test(b.textContent)));
    const badges=await results.evaluate(()=>[...document.querySelectorAll('.air-badge')].map(b=>({text:b.textContent,style:b.style.cssText,role:b.getAttribute('role'),tab:b.getAttribute('tabindex')})));
    const scores=badges.map(b=>Number(b.text.split(' · ')[0]));
    assert.deepEqual(scores,[85,51,85],'Schmidt\'s, the natural deodorant that names no deodorizing agent (it used to be skipped), and the antiperspirant whose active ingredient is marked in the list (it used to be declined)');
    assert.ok(badges.every(b=>/ · Deodorant$/.test(b.text)&&!b.style.includes('#444a4a')),JSON.stringify(badges));
    assert.ok(badges.every(b=>b.role==='link'&&b.tab==='0'),'a score badge is a link to the breakdown card');
    // Hovering one opens the info box, as it does on a food badge.
    await results.hover('.air-badge');
    await results.waitForFunction(()=>document.getElementById('air-breakdown'));
    const card=await results.evaluate(()=>AIR.panel.shadowOf(document.getElementById('air-breakdown')).textContent);
    assert.match(card,/Deodorant · Evidence-based/); assert.match(card,/What hurt/); assert.match(card,/Fragrance is disclosed/); assert.match(card,/Open product for full detail/);
  } finally {await results.close();}
  assert.deepEqual(errors,[]);
  console.log('  ok  personal care → real product/search/cart scripts, three styles, cache refresh, mixed-category summary, missing supplement facts and pause');
}
