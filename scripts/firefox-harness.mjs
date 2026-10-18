#!/usr/bin/env node
// Real Firefox extension checks via WebDriver. No live Google account or retailer requests.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FIREFOX_ID } from './browser-manifest.mjs';
import { fixtures } from './firefox-fixtures.mjs';
import { firefoxConsole } from './firefox-console.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const driverPath = process.env.GECKODRIVER || 'geckodriver', binary = process.env.FIREFOX_BINARY || 'firefox';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-firefox-')), port = 4448;
const fixture = await fixtures(root, profile);
const log = fs.openSync('/tmp/ingredient-check-firefox-driver.log', 'w');
const driver = spawn(driverPath, ['--port', String(port), '--allow-system-access', '--profile-root', profile], { stdio: ['ignore', log, log] });
let session;
async function call(route, body, method = 'POST') {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const { value } = await res.json(); if (!res.ok || value?.error) throw new Error(JSON.stringify(value)); return value;
}
const execute = (script, args = []) => call(`/session/${session}/execute/sync`, { script, args });
const run = script => call(`/session/${session}/execute/async`, { script: `const done=arguments[arguments.length-1]; (async()=>{${script}})().then(v=>done({ok:true,value:v}),e=>done({ok:false,error:String(e)}));`, args: [] }).then(r => { if (!r.ok) throw new Error(r.error); return r.value; });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function wait(script) { for (let i = 0; i < 100; i++) { if (await execute(script)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Firefox timed out: ' + script); }
try {
  for (let i = 0; i < 50; i++) { try { await call('/status', undefined, 'GET'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  const created = await call('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: true, proxy: { proxyType: 'manual', httpProxy: fixture.address, sslProxy: fixture.address }, 'moz:firefoxOptions': { binary, args: ['-headless'], prefs: { 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore' } } } } });
  session = created.sessionId; console.log('Firefox ' + created.capabilities.browserVersion);
  await call(`/session/${session}/moz/addon/install`, { path: path.join(root, 'dist', `ingredient-check-${JSON.parse(fs.readFileSync(root + '/manifest.json')).version}-firefox.zip`), temporary: true });
  await call(`/session/${session}/moz/context`, { context: 'chrome' });
  const manifest = JSON.parse(fs.readFileSync(root + '/dist/firefox/manifest.json', 'utf8'));
  const origins = [...new Set([...manifest.host_permissions, ...manifest.content_scripts.flatMap(c => c.matches)])];
  await call(`/session/${session}/execute/async`, { script: 'const done=arguments[arguments.length-1]; ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs").ExtensionPermissions.add(arguments[0], {origins:arguments[1],permissions:[]}).then(()=>done(true),e=>done(String(e)));', args: [FIREFOX_ID, origins] });
  const base = await execute('return WebExtensionPolicy.getByID(arguments[0]).getURL("");', [FIREFOX_ID]);
  await call(`/session/${session}/moz/context`, { context: 'content' });
  async function open(file) { await call(`/session/${session}/url`, { url: base + 'src/options/' + file }); await wait('return !!window.AIR?.db?.prefs;'); }
  await open('history.html');
  const state = await run(`const w=window, c=w.chrome;
    await c.storage.local.set({onboarded:true,settingsBackup:false,historyEnabled:false,historyAutoSync:false});
    await new Promise(resolve=>c.storage.local.get('onboarded',v=>{if(!v.onboarded)throw Error('callback storage failed');resolve();}));
    await c.storage.session.set({firefoxTest:'memory'}); if((await c.storage.session.get('firefoxTest')).firefoxTest!=='memory')throw Error('session storage');
    const bg=await w.browser.runtime.getBackgroundPage(); if(!bg?.AIR?.db?.purchaseHistory)throw Error('background modules missing');
    if(!bg.AIR.browser.firefox)throw Error('compat not active');
    const redirect=c.identity.getRedirectURL(); if(!redirect.startsWith('https://')||redirect.includes('chromiumapp.org'))throw Error('wrong OAuth redirect');
    const reply=await c.runtime.sendMessage({type:'purchaseConfigure',enabled:false,autoSync:false}); if(!reply?.ok)throw Error('history sender authorization');
    await bg.ensureOffscreen(); const frame=bg.document.getElementById('air-ocr-host'); if(!frame)throw Error('OCR frame missing');
    if(!frame.contentWindow.Tesseract)throw Error('local Tesseract not loaded');
    const canvas=frame.contentDocument.createElement('canvas'); canvas.width=1200; canvas.height=180;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,180);ctx.fillStyle='black';ctx.font='40px sans-serif';
    ctx.fillText('INGREDIENTS: whole grain oats, milk, sugar.',30,80);
    const {data}=await (await frame.contentWindow.getWorker()).recognize(canvas);
    if(!/whole grain oats/i.test(data.text))throw Error('Local OCR recognition failed: '+data.text);
    await frame.contentWindow.resetWorker(); await bg.closeOffscreenIfIdle();
    if(bg.document.getElementById('air-ocr-host'))throw Error('OCR did not release memory');
    return {redirect,sidebar:typeof c.sidePanel.open};`);
  console.log('  Firefox OAuth redirect: ' + state.redirect);
  assert(state.sidebar === 'function', 'Firefox sidebar adapter missing'); console.log('  ok Promise/callback APIs, session cache, background modules, own-page messaging, OAuth redirect, local OCR worker startup/cleanup');
  await open('options.html#sec-labels'); await wait('return !document.getElementById("sec-labels").classList.contains("lvl-hidden");');
  await execute('document.getElementById("ocrLabels").click();');
  await wait('return document.getElementById("ocrLabels").checked===false;');
  await open('sorted.html');
  await execute('const b=document.createElement("button");b.id="ff-sidebar-test";b.textContent="Open Firefox sidebar";b.onclick=()=>window.AIR.platform.openPanel().then(()=>b.dataset.open="yes",e=>b.dataset.error=String(e));document.body.append(b);');
  const button = await call(`/session/${session}/element`, { using: 'css selector', value: '#ff-sidebar-test' });
  await call(`/session/${session}/element/${button['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
  await wait('return document.getElementById("ff-sidebar-test").dataset.open==="yes";');
  assert(await run('return window.browser.sidebarAction.isOpen({});'), 'Firefox sidebar did not open');
  await execute('document.getElementById("ff-sidebar-test").onclick=()=>window.browser.sidebarAction.close().then(()=>document.getElementById("ff-sidebar-test").dataset.open="no");');
  await call(`/session/${session}/element/${button['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
  await wait('return document.getElementById("ff-sidebar-test").dataset.open==="no";');
  await execute('document.getElementById("ff-sidebar-test").remove();');
  const saved = await run('const c=window.chrome; return (await c.storage.local.get("ocrLabels")).ocrLabels;'); assert(saved === false, 'Firefox Settings did not persist OCR switch');
  await open('history.html#historySettings'); assert(await execute('return document.getElementById("purchasePreferences").open;'), 'Context link did not expand History settings');
  await run(`const w=window; await w.chrome.storage.local.set({purchaseHistory:[{key:'a'.repeat(64),orderKey:'b'.repeat(64),store:'amazon.com',asin:'B000000001',name:'Whole grain oats',date:'2026-10-01',state:'purchased',score:98,ingredients:'whole grain oats',profile:'c'.repeat(64),version:'1.15.0',scoredAt:1000,observedAt:1000,breakdown:{base:90,rows:[{why:'Whole grains',c:8,kind:'factor'}]}}]});`);
  await wait('return document.getElementById("metricAverage").textContent==="98";');
  await execute('const s=document.getElementById("driverBasis");s.value="recorded";s.dispatchEvent(new Event("change"));');
  await wait('return document.getElementById("bonusDrivers").textContent.includes("+8 points");');
  await run('await window.chrome.storage.local.set({theme:"dark"});');
  await wait('return getComputedStyle(document.documentElement).colorScheme.includes("dark");');
  await execute('const frame=document.createElement("iframe");frame.id="ff-narrow-history";frame.style.cssText="width:390px;height:844px;border:0";frame.src=arguments[0];document.body.append(frame);', [base + 'src/options/history.html']);
  await wait('return document.getElementById("ff-narrow-history").contentDocument?.getElementById("metricAverage")?.textContent==="98";');
  assert(await execute('const f=document.getElementById("ff-narrow-history");return f.contentWindow.innerWidth===390 && f.contentDocument.documentElement.scrollWidth<=392;'), 'Firefox history overflows a real 390px frame viewport');
  const narrow = await call(`/session/${session}/element`, { using: 'css selector', value: '#ff-narrow-history' });
  fs.writeFileSync('/tmp/ingredient-check-firefox-history.png', Buffer.from(await call(`/session/${session}/element/${narrow['element-6066-11e4-a52e-4f735466cecf']}/screenshot`, undefined, 'GET'), 'base64'));
  await execute('document.getElementById("ff-narrow-history").remove();');
  console.log('  ok real Firefox Settings persistence, contextual links, purchase averages/contributors, dark theme and narrow layout');
  for (const file of ['popup.html','welcome.html','sorted.html','sidepanel.html','report.html']) { await open(file); assert(await execute('return !!document.querySelector("body") && !document.querySelector("script[src^=http]");'), file + ' did not boot'); }
  await open('popup.html');
  await run(`const c=window.AIR.db.scoreCache; const values={};
    for(const [store,asin,score] of [['instacart.com','2695935',62],['kroger.com','0001111008490',83]])
      values[c.key(store,asin)]={schema:c.SCHEMA,cacheRevision:c.CACHE_REVISION,v:'1.15.1',store,asin,score,source:'page',t:Date.now(),name:store+' oats',prefs:c.fingerprint({})};
    await window.chrome.storage.local.set(values);`);
  await wait('return [...document.getElementById("compareA").options].some(o=>o.value==="s:instacart.com:2695935") && [...document.getElementById("compareB").options].some(o=>o.value==="s:kroger.com:0001111008490");');
  const compareLinks = await execute('return [...document.querySelectorAll(".compare-card a")].map(a=>a.href);');
  assert(compareLinks.some(url => url.startsWith('https://www.instacart.com/')) && compareLinks.some(url => url.startsWith('https://www.kroger.com/')), 'Firefox cross-store Compare links missing');
  console.log('  ok Firefox Compare: Instacart/Kroger picker, safe product links, compatible cached scores across app versions');
  await open('history.html');
  await run(`await window.chrome.storage.local.set({enabled:true,badges:true,autoScoreSearch:true,foodOnly:true,sharedCache:false,useOpenFoodFacts:false,ocrLabels:false,settingsBackup:false});`);
  for (const item of fixture.cases) {
    console.log('  checking Firefox store ' + item.host);
    await call(`/session/${session}/url`, { url: 'https://' + item.host + item.search });
    await wait('return [...document.querySelectorAll(".air-badge")].some(b=>b.dataset.airStatus==="scored" || /^[0-9]+$/.test(b.textContent.trim()));');
    await call(`/session/${session}/url`, { url: 'https://' + item.host + item.product });
    await wait('return document.getElementById("air-score-panel")?.dataset.airState==="scored";');
    await call(`/session/${session}/url`, { url: 'https://' + item.host + (item.host.includes('amazon') ? '/gp/cart/view.html' : '/cart') });
    await wait('return document.querySelector(".air-cart-badge")?.dataset.airStatus==="scored";');
    assert(await execute('return document.querySelector("input[aria-label=Quantity]").value==="2";'), 'Cart quantity changed');
  }
  await call(`/session/${session}/moz/context`, { context: 'chrome' });
  const errors = await execute('return Services.console.getMessageArray().filter(m=>m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag) && m.sourceName?.startsWith(arguments[0])).map(m=>({source:m.sourceName,message:m.errorMessage}));', [base]);
  const consoleState = firefoxConsole(errors, base);
  console.log(`  Firefox native inactive-page diagnostics: ${consoleState.inactive.length}`);
  assert(!consoleState.errors.length, 'Firefox extension errors: ' + JSON.stringify(consoleState.errors));
  console.log('  ok real Firefox: Amazon + 15 retailers, search/product/cart ratings through isolated content scripts; no retailer network');
  console.log('Firefox harness passed (temporary unsigned extension; no live accounts).');
 } catch (error) {
  console.error('Fixture request count:', fixture.requests.length);
  if (session) {
    await call(`/session/${session}/moz/context`, { context: 'chrome' }).catch(() => {});
    console.error(await execute('return Services.console.getMessageArray().filter(m=>m.sourceName?.startsWith("moz-extension:")).map(m=>({source:m.sourceName,message:m.errorMessage}));').catch(() => []));
  }
  throw error;
} finally {
  if (session) await call(`/session/${session}`, undefined, 'DELETE').catch(() => {});
  driver.kill(); fixture.close(); fs.closeSync(log); fs.rmSync(profile, { recursive: true, force: true });
}
