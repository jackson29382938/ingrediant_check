import {chromium} from 'playwright';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');fs.mkdirSync('/tmp/ic-history-review',{recursive:true});const b=await chromium.launch({headless:true,executablePath:process.env.HARNESS_CHROME||undefined});
try{const p=await b.newPage({viewport:{width:1440,height:1100}});
const pageErrors=[];p.on('pageerror',e=>pageErrors.push(e.message));
await p.route('http://history.test/**',r=>{const file=path.join(root,new URL(r.request().url()).pathname);if(!file.startsWith(root+'/')||!fs.existsSync(file))return r.fulfill({status:404,body:''});return r.fulfill({path:file});});
await p.addInitScript(()=>{
const listeners=[];const data={historyEnabled:false,historyAutoSync:false,theme:'light',purchaseHistory:Array.from({length:14},(_,i)=>({key:(i+1).toString(16).padStart(64,'0'),orderKey:(Math.floor(i/2)+1).toString(16).padStart(64,'0'),store:'amazon.com',asin:'B0HIST00'+String(i).padStart(2,'0'),date:['2026-08-04','2026-09-12','2026-10-17'][i%3],state:i===13?'returned':'purchased',name:['Whole grain oats','Plain yogurt','Snack bars','Missing ingredient label'][i%4],score:i%4===3?null:[92,78,32][i%3],ingredients:i%4===3?'':'oats, sugar, salt',profile:(i<8?'a':'b').repeat(64),version:'1.13.0',rulesRevision:i<10?'rules-1':'rules-2',observedAt:10000,scoredAt:10000,flags:[]}))};
window.__historyData=data;window.__changeHistory=async v=>chrome.storage.local.set(v);
window.chrome={i18n:{getMessage:()=>''},runtime:{getManifest:()=>({version:'1.22.0'}),getURL:p=>'http://history.test/'+p,sendMessage:async()=>({ok:false,reason:'test-only'})},storage:{local:{get:async keys=>keys==null?{...data}:Object.fromEntries([].concat(keys).map(k=>[k,data[k]])),set:async v=>{Object.assign(data,v);for(const cb of listeners)cb(Object.fromEntries(Object.entries(v).map(([k,newValue])=>[k,{newValue}])),'local');},remove:async keys=>{for(const k of [].concat(keys))delete data[k];}},onChanged:{addListener:cb=>listeners.push(cb)}},permissions:{request:async()=>false},tabs:{create:async()=>({})}};
});
await p.goto('http://history.test/src/options/history.html');await p.waitForSelector('#metricAverage');await p.screenshot({path:'/tmp/ic-history-review/'+(process.env.REVIEW_STAGE||'after')+'-desktop.png',fullPage:false});
{
await p.evaluate(()=>scrollTo(0,document.querySelector('.quality-summary').offsetTop-80));await p.screenshot({path:'/tmp/ic-history-review/after-insights.png'});
const original=await p.evaluate(()=>JSON.stringify(window.__historyData.purchaseHistory));
assert((await p.locator('#qualitySummary').textContent()).includes('recorded scoring setups'));
assert.equal(await p.locator('#scanControls').getAttribute('open'),null);
await p.evaluate(()=>{window.__scoreCalls=0;const score=AIR.engine.score;AIR.engine.score=(...args)=>{window.__scoreCalls++;return score(...args);};});
await p.selectOption('#scoreView','current');await p.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));await p.screenshot({path:'/tmp/ic-history-review/after-current-goals.png'});
assert.equal(await p.evaluate(()=>JSON.stringify(window.__historyData.purchaseHistory)),original,'comparisons must never rewrite saved snapshots');
await p.evaluate(()=>window.__changeHistory({purchaseHistory:[]}));await p.waitForFunction(()=>document.querySelector('#metricItems').textContent==='0');await p.screenshot({path:'/tmp/ic-history-review/after-empty.png'});
assert.equal(await p.locator('#historyEmpty').isVisible(),true);
const clearedCalls=await p.evaluate(()=>window.__scoreCalls);await p.evaluate(records=>window.__changeHistory({purchaseHistory:records}),JSON.parse(original));
await p.waitForFunction(()=>document.querySelector('#metricItems').textContent==='13');
assert(await p.evaluate(()=>window.__scoreCalls)>clearedCalls,'deleted inputs must be evicted and rescored when reimported');
await p.evaluate(()=>window.__changeHistory({theme:'dark'}));
await p.waitForFunction(()=>document.documentElement.style.colorScheme === 'dark' && getComputedStyle(document.documentElement).getPropertyValue('--page').trim() === '#1b1c1c');
await p.setViewportSize({width:390,height:844});await p.screenshot({path:'/tmp/ic-history-review/after-mobile.png'});if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error('mobile overflow');
}
await p.locator('a[href=\"#scanHeading\"]').first().click();assert.equal(await p.locator('#scanControls').evaluate(el=>el.open),true,'scan navigation must reveal its controls');
assert.deepEqual(pageErrors,[],'dashboard must not raise browser errors');
console.log('History checks passed: quality coverage, immutable snapshots, cache eviction, current goals, empty state, and mobile dark layout.');}finally{await b.close();}
