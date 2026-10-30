/* global extensionPagePath */
// Service worker.
//
// Scoring is local. This worker holds the only network paths, and never fetches Amazon pages:
//   - the shared online database — one Apps Script endpoint, a build constant in prefs.js, inert while
//     the constant is empty. Certification tables: on by default unless `sharedCache` is disabled. Product
//     readings from other computers (and uploading this one's): off until `sharedProducts` is on
//   - Open Food Facts — recommended, gated by optional host permission
//   - contributions and diagnostics — off until toggled
//   - the settings backup (chrome.storage.sync) and the optional Google-account copy

if (typeof importScripts === 'function') {
  importScripts('browser-compat.js', 'browser-platform.js', 'engine/db/_module.js', 'engine/db/allergens.js', 'engine/categories.js',
    'engine/db/ingestible.js', 'engine/db/prefs.js', 'engine/db/theme.js',
    'engine/db/ocr-text.js', 'engine/db/product-cache.js', 'engine/db/shopping.js', 'engine/db/storefronts.js', 'engine/db/sorted-results.js',
    'engine/db/speed.js', 'engine/db/unit-price.js',
    'engine/db/activity.js', 'options/google-auth.js', 'worker/messages.js', 'worker/sheet-store.js', 'engine/db/purchase-history.js', 'worker/purchase-history.js', 'engine/db/history-scan.js', 'worker/history-scan.js');
}

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_FIELDS = 'product_name,brands,ingredients_text,ingredients_text_en,labels_tags,nova_group,additives_tags,product_type,categories_tags,pnns_groups_1,categories,nutriments,nutrition_data_per';
const VERSION = chrome.runtime.getManifest().version;

// Open Food Facts asks read clients to identify themselves via User-Agent. Chrome will NOT let an
// extension set that header from fetch() — it is on the forbidden-header list and is stripped
// silently, so a `headers: {'User-Agent': ...}` here looks correct and does nothing. Verified
// empirically; see tests/background.test.js. We identify with a custom header (which does survive)
// plus OFF's own app_name/app_version query parameters instead.
const CLIENT_ID = `IngredientCheck/${VERSION}`;
const TTL_MS = 1000 * 60 * 60 * 24 * 30;   // a month; ingredient lists rarely change

const networkControllers = new Set();
async function networkRequest(url, options, read) {
  const conf = await chrome.storage.local.get('enabled');
  if (conf.enabled === false) throw new Error('paused');
  const controller = new AbortController();
  networkControllers.add(controller);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
  try {
    const res = await fetch(url, { ...options, signal });
    return await read(res);
  } finally { networkControllers.delete(controller); }
}

// Where a worker path fails, the trace used to be nothing: a status key for a few features and 21 empty
// catches. A failure is now one line in the console and one in "Report a problem"'s recent actions
// (engine/db/activity.js: in memory, this browser session only, never sent anywhere).
function noteWorkerError(where, error) {
  const text = String((error && error.message) || error).slice(0, 160);
  try { console.warn(`[Ingredient Check] ${where}: ${text}`); } catch (e) { /* no console */ }
  try { self.AIR.db.activity.log('worker', `${where} failed: ${text}`); } catch (e) { /* no activity log */ }
}
const quietly = where => error => noteWorkerError(where, error);

// A message handler that returns true owes its sender a reply. The handlers wrote `work().then(reply)`,
// so a rejection (a storage or IndexedDB error outside a try block) answered nobody, and the sender
// waited until Chrome tore the worker down. Every asynchronous reply goes through here: a failure is
// noted and the sender gets `fallback`, the same shape the handler gives for "nothing to report".
function answer(where, work, reply, fallback) {
  Promise.resolve().then(work).then(reply, error => { noteWorkerError(where, error); reply(fallback); });
}

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area && area !== 'local') return;
  if (changes.enabled?.newValue === false) {
    for (const controller of networkControllers) controller.abort();
  }
  if (changes.enabled?.newValue === false || changes.ocrLabels?.newValue === false) {
    // A paused content script can ignore a reply, but only the offscreen host can stop its CPU work.
    chrome.runtime.sendMessage({ target: 'ocr-offscreen', type: 'cancelOcr' }).catch(() => {});
  }
  // Turning shared product readings off drops anything still waiting to upload.
  if (changes.sharedProducts && changes.sharedProducts.newValue !== true) dropProductsQueue();
  noteBackupChange(changes);
  if (changes.palette) {
    badgePaletteRevision++;
    badgePalette = self.AIR.db.prefs.sanitizeDisplay({ palette: changes.palette.newValue }).palette;
    refreshActionBadges();
  }
});

// The test VM preloads ingestible.js; Chrome loads it via importScripts above. One implementation.
const isOpenFoodFactsFood = self.AIR.db.ingestible.isOpenFoodFactsFood;

const NOT_FOOD_REASON = 'Open Food Facts lists this as a non-food product';

// One request per barcode at a time: a second caller while the first is in flight waits for the same
// answer instead of sending another GET. The live record of 2026-09-25 saw two GETs for one barcode.
const offInFlight = new Map();

async function lookupBarcode(code, { foodOnly = true, manual = false } = {}) {
  const conf = await chrome.storage.local.get(['enabled', 'useOpenFoodFacts']);
  const toggles = AIR.db.prefs.sanitizeToggles(conf);
  if (!toggles.enabled || (!manual && !toggles.useOpenFoodFacts)) return null;
  if (!await chrome.permissions.contains({ origins: ['https://world.openfoodfacts.org/*'] })) return null;
  if (!/^\d{8,14}$/.test(String(code))) return null;
  const key = `off:${code}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.t < TTL_MS) {
    if (cached.rejected === 'not-food') {
      return foodOnly
        ? { rejected: 'not-food', reason: cached.reason || NOT_FOOD_REASON }
        : (cached.data || null);
    }
    if (foodOnly && cached.data && !isOpenFoodFactsFood(cached.data)) {
      return { rejected: 'not-food', reason: NOT_FOOD_REASON };
    }
    return cached.data;
  }

  let pending = offInFlight.get(key);
  if (!pending) {
    pending = fetchOpenFoodFacts(code, key).finally(() => offInFlight.delete(key));
    offInFlight.set(key, pending);
  }
  // The food check is per caller: the record is the same, but one caller may have the food gate off.
  const record = await pending;
  if (!record) return null;
  if (foodOnly && !record.food) return { rejected: 'not-food', reason: NOT_FOOD_REASON };
  return record.data;
}

// -> { data, food } and the off: cache entry written, or null (no product, no ingredients, offline).
async function fetchOpenFoodFacts(code, key) {
  try {
    const url = `${OFF_ENDPOINT}${encodeURIComponent(code)}.json`
      + `?fields=${OFF_FIELDS}`
      + `&app_name=${encodeURIComponent('IngredientCheck')}`
      + `&app_version=${encodeURIComponent(VERSION)}`;
    const json = await networkRequest(url, { headers: { 'X-Client-Id': CLIENT_ID } },
      res => res.ok ? res.json() : null);
    const p = json && json.product;
    if (!p || !(p.ingredients_text_en || p.ingredients_text)) return null;
    const data = {
      // Open Food Facts marks allergens as _WHEAT_; the panel and the saved reading show plain text.
      ingredients_text: String(p.ingredients_text_en || p.ingredients_text).replace(/_+/g, ''),
      labels: (p.labels_tags || []).join(' ').replace(/en:/g, ' '),
      nova_group: p.nova_group || null,
      name: p.product_name || null,
      // Keep the real type and categories so a later food-only check can still reject
      // beauty/household records. Defaulting a missing type to "food" used to launder them.
      product_type: p.product_type || '',
      categories_tags: p.categories_tags || [],
      categories: p.categories || '',
      pnns_groups_1: p.pnns_groups_1 || '',
      ...(AIR.db.productCache.nutritionFromOff(p) ? { nutrition: AIR.db.productCache.nutritionFromOff(p) } : {}),
    };
    const food = isOpenFoodFactsFood(p);
    await chrome.storage.local.set({
      [key]: food ? { t: Date.now(), data } : { t: Date.now(), rejected: 'not-food', reason: NOT_FOOD_REASON, data },
    });
    return { data, food };
  } catch (e) {
    return null;   // offline, blocked, or rate-limited — the panel falls back to honest failure
  }
}

// ---------------------------------------------------------------- label OCR
//
// Amazon often publishes no ingredient text, or publishes the product name in its place. The label
// photo is then the only place the real list exists. OCR runs in an offscreen document: the engine
// allocates tens of megabytes and spawns a worker, neither of which belongs on the host page's
// thread, and a worker created from an extension URL inside a content script is subject to
// Amazon's CSP rather than ours.
//
// Entirely local. The engine and language data are vendored, and product images come from
// m.media-amazon.com, which serves Access-Control-Allow-Origin: * — so no host permission and no
// third-party request.

const OCR_PATH = 'src/offscreen/ocr.html';
function ensureOffscreen() { return AIR.platform.ensureOcrHost(OCR_PATH); }

// The offscreen page closes itself after sitting idle (see src/offscreen/ocr.js), which frees the
// engine's memory. A request can land in the moment between its last job and its exit, in which
// case the message has no receiver; one retry recreates the page and tries again.
function allowedOcrUrls(urls) {
  const filter = self.AIR && self.AIR.db && self.AIR.db.ocrText && self.AIR.db.ocrText.allowedOcrUrls;
  return filter ? filter(urls) : [];
}

async function ocrLabels(urls) {
  const conf = await chrome.storage.local.get(['enabled', 'ocrLabels']);
  if (conf.enabled === false || !AIR.db.prefs.sanitizeToggles(conf).ocrLabels) return { ok: false, reason: 'not-enabled' };
  const allowed = allowedOcrUrls(urls);
  if (!allowed.length) return { ok: false, reason: 'no-images' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureOffscreen();
      const current = await chrome.storage.local.get(['enabled', 'ocrLabels']);
      if (current.enabled === false || !AIR.db.prefs.sanitizeToggles(current).ocrLabels) return { ok: false, reason: 'not-enabled' };
      return await chrome.runtime.sendMessage({ target: 'ocr-offscreen', type: 'ocrImages', urls: allowed });
    } catch (e) {
      const message = String(e && e.message || e);
      if (attempt === 0 && /receiving end|could not establish|message port closed/i.test(message)) continue;
      return { ok: false, reason: message };
    }
  }
  return { ok: false, reason: 'offscreen unavailable' };
}

function closeOffscreenIfIdle() { return AIR.platform.closeOcrHost(); }

// The action badge follows the selected score palette, independently of the page's scheme/accent.
// Keep exact scores while awake; Chrome retains badge text across worker suspension, so startup
// can recover existing tab badges without persisting browsing records or requesting a rescan.
let badgePalette = 'standard';
let badgePaletteRevision = 0;
const actionStates = new Map();
const actionRevisions = new Map();

function badgeAction(method, options) {
  try { chrome.action?.[method]?.(options)?.catch?.(() => {}); }
  catch (e) { /* A tab may close while its badge is being updated. */ }
}
function badgeText(tabId, color = '#ffffff') {
  badgeAction('setBadgeTextColor', { tabId, color });
}
function paintActionBadge(tabId, score, status, index = false) {
  if (!chrome.action || typeof tabId !== 'number') return;
  actionRevisions.set(tabId, (actionRevisions.get(tabId) || 0) + 1);
  actionStates.set(tabId, { score, status, index });
  if (status === 'fail' || status === 'not-food') {
    badgeAction('setBadgeText', { tabId, text: status === 'fail' ? '?' : '–' });
    badgeAction('setBadgeBackgroundColor', { tabId, color: status === 'fail' ? '#767676' : '#565959' });
    badgeText(tabId);
    return;
  }
  if (typeof score !== 'number' || !isFinite(score)) {
    badgeAction('setBadgeText', { tabId, text: '' });
    return;
  }
  // A personal-care or supplement index is not a quality band: gray, as the not-food badge is.
  const colors = index ? { bg: '#565959', fg: '#ffffff' } : self.AIR.db.theme.toolbar(score, badgePalette);
  badgeAction('setBadgeText', { tabId, text: String(Math.round(score)) });
  badgeAction('setBadgeBackgroundColor', { tabId, color: colors.bg });
  badgeText(tabId, colors.fg);
}

async function refreshActionBadges() {
  for (const [tabId, value] of actionStates) paintActionBadge(tabId, value.score, value.status, value.index);
  if (!chrome.tabs?.query || !chrome.action?.getBadgeText) return;
  const paletteRevision = badgePaletteRevision;
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(async tab => {
      if (actionStates.has(tab.id)) return;
      const revision = actionRevisions.get(tab.id) || 0;
      try {
        const text = await chrome.action.getBadgeText({ tabId: tab.id });
        if (paletteRevision !== badgePaletteRevision || revision !== (actionRevisions.get(tab.id) || 0) || actionStates.has(tab.id)) return;
        if (/^\d{1,3}$/.test(text) && Number(text) <= 100) paintActionBadge(tab.id, Number(text));
      } catch (e) { /* Closed tab. */ }
    }));
  } catch (e) { /* Chrome may be shutting down. */ }
}
chrome.tabs?.onRemoved?.addListener(tabId => {
  actionStates.delete(tabId);
  actionRevisions.set(tabId, (actionRevisions.get(tabId) || 0) + 1);
});
async function loadActionPalette() {
  const revision = badgePaletteRevision;
  try {
    const stored = await chrome.storage.local.get('palette');
    if (revision !== badgePaletteRevision) return;
    badgePalette = self.AIR.db.prefs.sanitizeDisplay(stored).palette;
    await refreshActionBadges();
  } catch (e) { /* Keep readable defaults if storage is unavailable. */ }
}
loadActionPalette();

// Message allowlist lives in worker/messages.js (importScripts above / test harness preload).

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Replies from the offscreen document travel on this same channel; ignore them here.
  if (msg && msg.target === 'ocr-offscreen') return false;
  if (!allowMessage(msg, sender)) return false;
  if (self.AIR.scanWorker?.handle(msg, sender, reply)) return true;
  if (self.AIR.historyWorker?.handle(msg, sender, reply)) return true;
  if (msg && msg.type === 'pageScore') {
    paintActionBadge(sender && sender.tab && sender.tab.id, msg.score, msg.status, msg.index === true);
    return false;
  }
  if (msg && msg.type === 'ocrLabels') {
    answer('ocrLabels', () => ocrLabels(msg.urls), reply, { ok: false, reason: 'worker-error' });
    return true;
  }
  if (msg && msg.type === 'ocrIdle') {
    closeOffscreenIfIdle().then(() => reply({ ok: true }));
    return true;
  }
  if (msg && msg.type === 'lookupBarcode' && msg.code) {
    // lookupBarcode re-reads useOpenFoodFacts (and the pause switch) itself.
    answer('lookupBarcode', () => lookupBarcode(msg.code, { foodOnly: msg.foodOnly !== false, manual: sender.url?.split('?')[0] === chrome.runtime.getURL('src/options/library.html') }), reply, null);
    return true;   // async reply
  }
  if (msg && msg.type === 'ping') { reply({ ok: true }); return false; }
  // Amazon's sort menu (src/content/sort.js). openSortedPanel must reach sidePanel.open before any
  // await, so it is not wrapped in a promise chain here.
  if (msg && msg.type === 'followSortedSearch') { followSortedSearch(msg, sender).then(reply, () => reply({ok:false})); return true; }
  if (msg && msg.type === 'openSortedPanel') { openSortedPanel(msg, sender, reply); return true; }
  if (msg && msg.type === 'updateSortedResults') {
    updateSortedResults(msg, sender).then(reply, e => reply({ ok: false, reason: String((e && e.message) || e) }));
    return true;
  }
  // A line for "Report a problem" (engine/db/activity.js), from a content script, which cannot reach
  // session storage itself. Short text only; nothing leaves the browser.
  if (msg && msg.type === 'logAction') {
    answer('logAction', () => self.AIR.db.activity.log(String(msg.where || ''), String(msg.what || '')).then(() => ({ ok: true })), reply, { ok: false });
    return true;
  }
  if (msg && msg.type === 'openSortedTab') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/sorted.html') })
      .then(() => reply({ ok: true }), e => reply({ ok: false, reason: String((e && e.message) || e) }));
    return true;
  }
  // Shared-database messages are handled here too. Registering a second onMessage listener works in
  // Chrome but shadowed the first one in the test harness, and one entry point is simpler anyway.
  if (msg && typeof handleSharedDbMessage === 'function') return handleSharedDbMessage(msg, reply);
  return false;
});

// ---------------------------------------------------------------- sorted results
//
// Choosing an Ingredient Check option in Amazon's sort menu (src/content/sort.js) opens Chrome's side
// panel at once, empty and "loading"; the content script then sends the listings as it gathers them.
// Everything it sends is re-checked here (a web page's content script sent it) and kept in
// chrome.storage.session, which lives in memory and is cleared when the browser closes.
// src/options/sidepanel.html and sorted.html read it; the list page keeps the reader's priorities
// under `sortWeights` in the same place.
//
// Chrome opens the side panel only in response to a user action. The click in Amazon's menu counts
// only while this listener runs, so sidePanel.open is the first thing called, before any await.
// View ports are live only while a panel/comparison tab exists. Never open a panel or
// collect new searches just because an old comparison remains in session storage.
const sortedViews = new Set();
chrome.runtime.onConnect?.addListener(port => {
  if (port.name !== 'sorted-view' || !['/src/options/sidepanel.html','/src/options/sorted.html'].includes(extensionPagePath(port.sender))) return;
  sortedViews.add(port); port.onDisconnect.addListener(() => sortedViews.delete(port));
  chrome.storage.session.get('sortedResults').then(({sortedResults:list}) => {
    if (list?.sourceTabId !== undefined) chrome.tabs.sendMessage(list.sourceTabId,{type:'sortFollow'}).catch(()=>{});
  }).catch(()=>{});
});
function sameOrigin(a, b) {
  try { return new URL(String(a || '')).origin === new URL(String(b || '')).origin; } catch (e) { return false; }
}
let sortedFollowChain = Promise.resolve();
function followSortedSearch(msg, sender) {
  const task = sortedFollowChain.catch(() => {}).then(() => followSortedSearchOnce(msg, sender));
  sortedFollowChain = task; return task;
}
async function followSortedSearchOnce(msg, sender) {
  const conf = await chrome.storage.local.get(['enabled','sortFollowSearch']);
  if (!sortedViews.size || conf.enabled === false || conf.sortFollowSearch === false) return {ok:false};
  const url = self.AIR.db.sortedResults.sanitizeSourceUrl(msg.sourceUrl);
  const tab = chrome.tabs?.get ? await chrome.tabs.get(sender.tab?.id) : sender.tab;
  // `sender.url` is the address the frame loaded with. Amazon starts some searches without a page load
  // (history.pushState), and then it still names the previous search while the tab and the page itself
  // name the new one, so every follow was refused. The tab's address is the one to match; the sender
  // only has to be the top frame of that tab on the same Amazon origin.
  if (!url || !isAmazonSearchUrl(url) || tab?.id !== sender.tab?.id || tab.url !== url || !sameOrigin(sender.url, url) || sender.frameId !== 0) return {ok:false};
  const {sortedResults:list} = await chrome.storage.session.get('sortedResults');
  if (!sortedViews.size || !list || list.sourceTabId !== tab.id || (list.sourceUrl === url && !!list.priceOnly === (msg.priceOnly === true))) return {ok:false};
  const runId = crypto.randomUUID();
  const mode = msg.priceOnly === true ? 'unitPrice' : list.mode;
  await chrome.storage.session.set({sortedResults:{...list,runId,mode,sourceUrl:url,priceOnly:msg.priceOnly===true,unitEnabled:msg.unitEnabled!==false,unit:'',items:[],loading:true,status:'',t:Date.now()},sortUnit:'auto'});
  return {ok:true,runId,mode};
}

function openSortedPanel(msg, sender, reply) {
  const R = self.AIR.db.sortedResults;
  const tab = (sender && sender.tab) || {};
  let opening;
  try {
    opening = AIR.platform.openPanel({ tabId: tab.id });
  } catch (e) { opening = Promise.reject(e); }
  const mode = msg.mode === 'unitPrice' ? 'unitPrice' : 'health';
  const unitEnabled = msg.unitEnabled !== false;
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const list = {
    runId, mode, unitEnabled, priceOnly: msg.priceOnly === true, unit: '', loading: true, status: '', items: [],
    sourceUrl: R.sanitizeSourceUrl(msg.sourceUrl), sourceTabId: tab.id, sourceWindowId: tab.windowId, t: Date.now(),
  };
  // The priorities the reader last set for this menu option, when they asked to keep them.
  const saving = chrome.storage.local.get(['sortRemember', 'sortPriorities']).catch(() => ({})).then(conf => {
    const kept = self.AIR.db.prefs.sanitizeToggles(conf).sortRemember && R.sanitizePriorities(conf).sortPriorities[mode];
    // `sortUnit` is the unit the reader picked in the panel for this list; every list starts on 'auto',
    // the unit most of its listings are priced in (content/sort.js sends it with each update).
    return chrome.storage.session.set({ sortedResults: list, sortUnit: 'auto', sortWeights: R.sanitizeWeights(kept || R.presetFor(mode), { unitEnabled }) });
  });
  Promise.allSettled([opening, saving]).then(([opened, saved]) => {
    if (saved.status !== 'fulfilled') { reply({ ok: false, reason: 'no-session-storage' }); return; }
    reply(opened.status === 'fulfilled' ? { ok: true, runId }
      : { ok: false, runId, reason: String((opened.reason && opened.reason.message) || opened.reason) });
  });
}

// ---- keyboard shortcuts
//
// Declared in the manifest ("commands"); the reader changes the keys at chrome://extensions/shortcuts.
// A key press is a user action, so sidePanel.open runs first, before any await, exactly as for a click
// in Amazon's menu. The tab's content script is then told to start gathering. When there is nobody to
// answer (the page is not a food search on a supported store, or Ingredient Check is switched off)
// the panel says so instead of staying on "loading".
function isAmazonSearchUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return AMAZON_HOST.test(u.hostname) && (/^\/s(?:\/|$)/.test(u.pathname) || u.searchParams.has('k'));
  } catch (e) { return false; }
}

async function endSortedList(runId, key, fallback) {
  const { sortedResults: list } = await chrome.storage.session.get('sortedResults');
  if (!list || list.runId !== runId) return;
  let text = fallback;
  try { text = chrome.i18n.getMessage(key) || fallback; } catch (e) { /* no locale */ }
  await chrome.storage.session.set({ sortedResults: { ...list, loading: false, status: self.AIR.db.sortedResults.sanitizeStatus(text), t: Date.now() } });
}

function sortFromCommand(command, tab) {
  const mode = command === 'sort-health' ? 'health' : command === 'sort-price' ? 'unitPrice' : null;
  if (!mode || !tab || typeof tab.id !== 'number' || !isAmazonSearchUrl(tab.url)) return;
  openSortedPanel({ mode, sourceUrl: tab.url, unitEnabled: true }, { tab }, async reply => {
    if (!reply || !reply.runId) return;
    const conf = await chrome.storage.local.get('unitPrice');
    if (mode === 'unitPrice' && conf.unitPrice === false) {
      await endSortedList(reply.runId, 'sortUnitOff', 'Unit price is switched off in Ingredient Check settings.');
      return;
    }
    // No side panel (an older Chrome): the same list in a tab, as Amazon's menu does.
    if (!reply.ok) await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/sorted.html') }).catch(() => {});
    let answer = null;
    try { answer = await chrome.tabs.sendMessage(tab.id, { type: 'sortStart', mode, runId: reply.runId }); } catch (e) { /* no listener */ }
    if (!answer || answer.ok !== true) {
      await endSortedList(reply.runId, 'sortNotHere', 'Ingredient Check is not sorting this page: it is switched off, or this is not a food search on a supported Amazon store.');
    }
  });
}
chrome.commands?.onCommand?.addListener((command, tab) => sortFromCommand(command, tab));

// A newer list (another choice, in this tab or another) wins: updates for an older run are refused
// and the content script stops working on it.
async function updateSortedResults(msg, sender) {
  const R = self.AIR.db.sortedResults;
  const { sortedResults: list } = await chrome.storage.session.get('sortedResults');
  const tabId = sender && sender.tab && sender.tab.id;
  if (!list || !msg.runId || list.runId !== msg.runId || list.sourceTabId !== tabId) return { ok: false, stale: true };
  const items = R.sanitizeResults(msg.items);
  await chrome.storage.session.set({ sortedResults: {
    ...list, items: msg.priceOnly === true ? items.map(p => ({...p, score:null, verdict:'', source:'unrated', why:null})) : items, priceOnly: msg.priceOnly === true, unit: R.sanitizeUnitId(msg.unit), loading: msg.loading === true, status: R.sanitizeStatus(msg.status), t: Date.now(),
  } });
  return { ok: true, count: items.length };
}

// Housekeeping. This used to run only on chrome.runtime.onStartup, and browsers routinely go weeks
// without restarting — with auto-scoring on that is one cache entry per product scrolled past,
// accumulating indefinitely. An alarm actually fires.
// chrome.alarms.create() replaces an alarm of the same name and restarts its clock. This file runs
// on every worker start, and an MV3 worker restarts constantly, so an unconditional create() pushed
// the first fire twelve hours into the future every time: for anyone who opened Amazon twice a day
// the sweep and the diagnostics flush never ran. Create it once, and only if it is not already set.
const HOUSEKEEPING = 'air-housekeeping';
function ensureHousekeepingAlarm() {
  const spec = { delayInMinutes: 30, periodInMinutes: 720 };
  if (typeof chrome.alarms.get !== 'function') { chrome.alarms.create(HOUSEKEEPING, spec); return; }
  chrome.alarms.get(HOUSEKEEPING, existing => {
    void chrome.runtime.lastError;
    if (!existing) chrome.alarms.create(HOUSEKEEPING, spec);
  });
}
ensureHousekeepingAlarm();
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === BACKUP_ALARM) { backupToChrome().catch(quietly('backupToChrome')); return; }
  if (a.name === GOOGLE_ALARM) { googleAutoSave().catch(quietly('googleAutoSave')); return; }
  if (a.name !== HOUSEKEEPING) return;
  sweepCache().catch(quietly('sweepCache'));
  // A partial batch would otherwise sit until enough new products were scored to fill it.
  flushDiagnostics().catch(quietly('flushDiagnostics'));
  flushProducts().catch(quietly('flushProducts'));
});
// Keys and indexes from the pasted-URL era (sheet, producers, contribution URL, the one-row
// settings tab, the per-settings ratings cache). The endpoint is now a build constant.
const LEGACY_KEYS = ['sheetUrl', 'producersUrl', 'contributeUrl', 'syncSettings', 'ratingsQueue',
  'sheetIndex', 'producerIndex', 'ratingsIndex'];
function dropLegacy() {
  chrome.storage.local.remove(LEGACY_KEYS);
  for (const k of ['sheetIndex', 'producerIndex', 'ratingsIndex']) clearSheetIndex(k).catch(quietly('clearSheetIndex'));
}
chrome.runtime.onStartup.addListener(() => { sweepCache().catch(quietly('sweepCache')); });
chrome.runtime.onInstalled.addListener(details => {
  sweepCache().catch(quietly('sweepCache'));
  dropLegacy();
  // An update from a build that uploaded product readings by default: nothing queued then leaves
  // unless the reader has turned shared product readings on since.
  chrome.storage.local.get('sharedProducts').then(o => { if (o.sharedProducts !== true || !self.AIR.db.prefs.SHARED_PRODUCTS_ALLOWED) dropProductsQueue(); }, () => {});
  // A new install asks its setup questions (src/options/welcome.html); an update never does.
  if (details && details.reason === 'install' && chrome.tabs) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/welcome.html') });
  }
});

// How long this computer keeps its own readings. Scores (s:) and product readings (p:) follow the
// speed setting (AIR.db.speed maxAgeDays, 1 to 90 days): a fixed 30 days here used to delete what
// "Fastest" and "Faster" promised to keep. Open Food Facts records (off:) keep their own month.
function sweepAges(speedMode) {
  const speed = self.AIR && self.AIR.db && self.AIR.db.speed;
  const readings = speed ? speed.profile(speedMode).maxAgeMs : TTL_MS;
  return { s: readings, p: readings, off: TTL_MS };
}

// The cached readings and the one setting that decides their age. `get(null)` also reads everything else
// in storage, which includes the purchase history: up to 10,000 records, about 12 MB, copied into the
// worker at every start and every twelve hours to throw almost all of it away. Where the browser can
// list keys (Chrome 130+) only the cache's own keys are read.
async function cacheSnapshot() {
  const local = chrome.storage.local;
  if (typeof local.getKeys !== 'function') return local.get(null);
  const keys = (await local.getKeys()).filter(k => /^(s|p|off):/.test(k));
  const [readings, setting] = await Promise.all([keys.length ? local.get(keys) : {}, local.get('speedMode')]);
  return { ...readings, speedMode: setting.speedMode };
}

async function sweepCache(now = Date.now()) {
  const all = await cacheSnapshot();
  const ages = sweepAges(all.speedMode);
  const grace = self.AIR.db.speed.sanitizeRecall(all).cacheGraceDays * self.AIR.db.speed.DAY;
  ages.s += grace; ages.p += grace;
  // s: weighted scores, p: product data (docs/CACHE.md), off: Open Food Facts records.
  const entries = Object.entries(all).filter(([k]) => /^(s|p|off):/.test(k));
  const stale = entries
    .filter(([k, v]) => v && v.t && now - v.t > ages[k.slice(0, k.indexOf(':'))])
    .map(([k]) => k);
  const staleSet = new Set(stale);   // `stale.includes` inside the filter below was O(n²) at 5k+ keys
  // Hard cap as well as a TTL: a heavy auto-scoring session can add thousands of fresh entries
  // that a time-based sweep will not touch for a month. Oldest go first.
  const MAX_ENTRIES = 10000;   // a product usually holds one s: and one p: entry
  const fresh = entries.filter(([k]) => !staleSet.has(k));
  const overflow = fresh.length > MAX_ENTRIES
    ? fresh.sort((a, b) => (a[1]?.t || 0) - (b[1]?.t || 0)).slice(0, fresh.length - MAX_ENTRIES).map(([k]) => k)
    : [];
  const drop = [...stale, ...overflow];
  if (drop.length) await chrome.storage.local.remove(drop);
  return { removed: drop.length, kept: entries.length - drop.length };
}

// ---------------------------------------------------------------- shared provenance database
//
// Single-ingredient foods carry their quality in certifications, not ingredients, and Amazon
// publishes almost none of it. The first tab of the shared spreadsheet records them once per
// product, and a `producers` tab maps brands to certifications confirmed in a certifier's own
// directory. The sheet is private; `GET ?kind=provenance` on the endpoint returns both tables,
// fetched whole (never one product at a time) and kept for six hours.

const SHEET_TTL_MS = 1000 * 60 * 60 * 6;
const PROVENANCE_CACHE_KEY = 'provenanceIndex';
// Bound the tables so a huge sheet cannot eat storage.
const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const MAX_SHEET_ROWS = 8000;

// The endpoint, when this build has one and the user has not switched the shared database off.
async function sharedEndpoint(conf) {
  const c = conf || await chrome.storage.local.get(['enabled', 'sharedCache']);
  if (c.enabled === false || c.sharedCache === false) return '';
  return self.AIR.db.prefs.endpoint();
}

function indexRows(rows) {
  // Null-prototype maps: every key here comes from an untrusted sheet, and on a plain object a row
  // with brand "__proto__" made lookupRecord() return Object.prototype as a truthy "record".
  const empty = () => ({ byAsin: Object.create(null), byUpc: Object.create(null),
                         byBrand: Object.create(null), count: 0 });
  if (!rows.length) return empty();
  const head = rows[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = empty();
  for (const r of rows.slice(1)) {
    const rec = Object.create(null);
    head.forEach((h, i) => { rec[h] = String(r[i] == null ? '' : r[i]).trim(); });
    if (!rec.certifications && !rec.feed && !rec.origin) continue;
    rec.source = rec.verified_by ? `shared database (${rec.verified_by})` : 'shared database';
    idx.count++;
    if (rec.asin) idx.byAsin[rec.asin.toUpperCase()] = rec;
    if (rec.upc) idx.byUpc[rec.upc.replace(/\D/g, '')] = rec;
    // Brand rows are a fallback: a producer whose whole line shares a certification.
    if (rec.brand && !rec.asin && !rec.upc) idx.byBrand[rec.brand.toLowerCase()] = rec;
  }
  return idx;
}

function indexProducers(rows) {
  const head = (rows[0] || []).map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  const index = Object.create(null);
  for (const r of rows.slice(1)) {
    const rec = Object.create(null);
    head.forEach((h, i) => { rec[h] = String(r[i] == null ? '' : r[i]).trim(); });
    if (!rec.brand || !rec.certifications) continue;
    index[rec.brand.toLowerCase()] = rec;
  }
  return index;
}

const tableOk = rows => Array.isArray(rows) && rows.length <= MAX_SHEET_ROWS && rows.every(Array.isArray);

// -> { index, producers }, or null when offline / unconfigured. A failed refresh keeps the last copy.
async function loadProvenance(force = false) {
  const url = await sharedEndpoint();
  if (!url) return null;
  const cached = await getSheetIndex(PROVENANCE_CACHE_KEY);
  const fallback = cached && cached.url === url ? cached.value : null;
  if (!force && fallback && Date.now() - cached.t < SHEET_TTL_MS) return fallback;
  try {
    const text = await networkRequest(`${url}?kind=provenance`, { credentials: 'omit' }, res => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    });
    if (typeof text !== 'string' || text.length > MAX_SHEET_BYTES) return fallback;
    const body = JSON.parse(text);
    const rows = body && body.ok ? body.provenance || [] : null;
    const producerRows = body && body.ok ? body.producers || [] : null;
    if (!tableOk(rows) || !tableOk(producerRows)) return fallback;
    const value = { index: indexRows(rows), producers: indexProducers(producerRows) };
    await putSheetIndex(PROVENANCE_CACHE_KEY, { t: Date.now(), url, value });
    // Revisions are content hashes: the score cache fingerprints on them, and a refresh that changed
    // nothing must not retire every cached score.
    await chrome.storage.local.set({
      sheetIndexRev: revisionOf(JSON.stringify(rows)),
      producerIndexRev: revisionOf(JSON.stringify(producerRows)),
    });
    return value;
  } catch (e) {
    return fallback;   // stale beats nothing
  }
}

function lookupRecord(index, { asin, upc, brand }) {
  if (!index) return null;
  if (asin && Object.hasOwn(index.byAsin, asin.toUpperCase())) return index.byAsin[asin.toUpperCase()];
  if (upc && Object.hasOwn(index.byUpc, String(upc).replace(/\D/g, ''))) return index.byUpc[String(upc).replace(/\D/g, '')];
  if (brand && Object.hasOwn(index.byBrand, brand.toLowerCase())) return index.byBrand[brand.toLowerCase()];
  return null;
}

async function contribute(payload) {
  const conf = await chrome.storage.local.get(['enabled', 'shareContributions']);
  const url = self.AIR.db.prefs.endpoint();
  if (conf.enabled === false || conf.shareContributions !== true || !url) return { ok: false, reason: 'not-enabled' };
  return postRecord(url, payload);
}

async function postRecord(url, payload) {
  // Re-validate at fetch time — storage can hold a hand-edited value that bypassed settings.
  const safe = self.AIR && self.AIR.db && self.AIR.db.prefs
    ? self.AIR.db.prefs.toScriptUrl(url)
    : null;
  if (!safe) return { ok: false, reason: 'bad-url' };
  try {
    // Apps Script web apps answer simple POSTs without a preflight when the body is text/plain.
    const receipt = await networkRequest(safe, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    }, res => res.ok ? res.json() : null);
    const ok = receipt?.ok === true && receipt.wrote === 1;
    return ok ? { ok: true, tab: receipt.tab, receipt } : { ok: false, reason: 'write-not-confirmed', receipt };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

// ---------------------------------------------------------------- diagnostics
//
// One row per scored product, posted to the same Apps Script endpoint the contribution path uses,
// tagged kind:"diagnostics" so the script can put it on its own sheet. The point is measuring how
// often the scores are right: a row carries the ingredient text that was read, where it came from,
// which rules fired and what came out, so a wrong score can be diagnosed rather than just noticed.
//
// Batched. With auto-scoring on, a results page produces ~60 scores, and one POST each would be
// both slow and rude to the endpoint. Rows accumulate in storage and go out in batches, with a
// flush on the housekeeping alarm so a partial batch is not stranded. The queue is capped: losing
// old diagnostic rows is a non-event, filling the user's storage quota is not.

const DIAG_KEY = 'diagQueue';
const DIAG_BATCH = 12;
const DIAG_MAX = 300;
const DIAG_SCHEMA = 2;
let diagnosticCapability = null;

// Storage read/modify/write and network flushes must share one queue. Otherwise simultaneous
// tabs overwrite rows, or a completed POST clears rows appended while it was in flight.
let diagnosticWork = Promise.resolve();
function serializeDiagnostics(work) {
  const result = diagnosticWork.then(work);
  diagnosticWork = result.catch(() => {});
  return result;
}
function queueDiagnostic(record) {
  return serializeDiagnostics(() => appendDiagnostic(record));
}
function flushDiagnostics() {
  return serializeDiagnostics(() => sendDiagnostics());
}
function ensureRowId(record) {
  if (record && typeof record.rowId === 'string' && record.rowId) return record;
  const rowId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  return { ...record, rowId };
}

// FNV-1a. Not cryptographic; it only has to change when the text changes.
function fnv(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function revisionOf(csv) { return fnv(String(csv || '')) + '-' + String(csv || '').length; }

function batchIdFor(queue) {
  const ids = (queue || []).map(r => (r && r.rowId) || '').join('|');
  return 'b' + fnv(ids) + '-' + (queue || []).length;
}

async function appendDiagnostic(record) {
  const conf = await chrome.storage.local.get(['enabled', 'sendDiagnostics', DIAG_KEY]);
  if (conf.enabled === false || !conf.sendDiagnostics || !self.AIR.db.prefs.endpoint()) return { ok: false, reason: 'not-enabled' };
  if (!record || typeof record !== 'object') return { ok: false, reason: 'no-record' };
  const queue = [...(conf[DIAG_KEY] || []), ensureRowId(record)].slice(-DIAG_MAX);
  await chrome.storage.local.set({ [DIAG_KEY]: queue });
  if (queue.length < DIAG_BATCH) return { ok: true, queued: queue.length };
  return sendDiagnostics();
}

async function sendDiagnostics() {
  const conf = await chrome.storage.local.get(['enabled', 'sendDiagnostics', DIAG_KEY]);
  if (conf.enabled === false || !conf.sendDiagnostics) return { ok: false, reason: 'not-enabled' };
  const queue = (conf[DIAG_KEY] || []).map(ensureRowId);
  const safe = self.AIR.db.prefs.endpoint();
  if (!safe || !queue.length) return { ok: false, reason: 'nothing-to-send' };
  // Upgrade old queued rows before sending, so their retry IDs survive a worker restart.
  await chrome.storage.local.set({ [DIAG_KEY]: queue });
  try {
    const needsSchema = queue.some(row => row.outcome || row.feedback);
    if (needsSchema) {
      if (!diagnosticCapability || diagnosticCapability.url !== safe || diagnosticCapability.until < Date.now()) {
        const status = await networkRequest(safe, { credentials: 'omit', cache: 'no-store' }, res => res.ok ? res.json() : null);
        const schema = status?.service === 'ingredient-check' && Number.isSafeInteger(status.diagnosticsSchema) ? status.diagnosticsSchema : 0;
        diagnosticCapability = { url: safe, until: schema >= DIAG_SCHEMA ? Date.now() + 60000 : 0, schema };
      }
      if (diagnosticCapability.schema < DIAG_SCHEMA) {
        await chrome.storage.local.set({ diagLastError: 'backend-update-required' });
        return { ok: false, reason: 'backend-update-required', queued: queue.length };
      }
    }
    const current = await chrome.storage.local.get(['enabled', 'sendDiagnostics']);
    if (current.enabled === false || !current.sendDiagnostics) return { ok: false, reason: 'not-enabled', queued: queue.length };
    const receipt = await networkRequest(safe, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind: 'diagnostics', diagnosticsSchema: needsSchema ? DIAG_SCHEMA : 1, batchId: batchIdFor(queue), rows: queue }),
    }, res => res.ok ? res.json() : null);
    // Only clear on a confirmed write. A failed flush keeps the rows for the next attempt rather
    // than silently dropping the data the user turned this on to collect. The receiver may answer
    // wrote=N for a replay it already stored (duplicate:true); that still counts as confirmed.
    const confirmed = !!(receipt && receipt.ok === true && Number(receipt.wrote) === queue.length
      && (!needsSchema || Number(receipt.diagnosticsSchema) >= DIAG_SCHEMA));
    if (confirmed) await chrome.storage.local.set({ [DIAG_KEY]: [], diagLastError: '' });
    return { ok: confirmed, reason: confirmed ? undefined : 'write-not-confirmed', sent: confirmed ? queue.length : 0, queued: confirmed ? 0 : queue.length };
  } catch (e) {
    return { ok: false, reason: 'network', queued: queue.length };
  }
}

// ---------------------------------------------------------------- shared product cache
//
// docs/CACHE.md. Reads are one POST per search page (the tiles the device could not answer), with a
// short in-memory memo so infinite scroll does not re-ask. Writes are a queue of upserts and pull
// counts, flushed together after a quiet spell, when the batch fills, or on the housekeeping alarm,
// so a results page does not POST once per tile.

const PRODUCTS_KEY = 'productsQueue';
const PRODUCTS_BATCH = 25;
const PRODUCTS_QUIET_MS = 15000;
const LOOKUP_MAX = 100;
const MEMO_MS = 10 * 60 * 1000;
const MEMO_MAX = 5000;
const lookupMemo = new Map();   // key -> { t, row | null }
let productsWork = Promise.resolve();
let productsTimer = null;
// After a failed send, only the quiet timer and the alarm retry; otherwise every tile would POST.
let productsBackoff = false;
function serializeProducts(work) {
  const result = productsWork.then(work);
  productsWork = result.catch(() => {});
  return result;
}

// Product readings from other computers: only when the reader turned them on (prefs.js
// sharedProducts), as well as the shared database itself.
async function sharedProductsEndpoint() {
  if (!AIR.db.prefs.SHARED_PRODUCTS_ALLOWED) return '';
  const c = await chrome.storage.local.get(['enabled', 'sharedCache', 'sharedProducts']);
  return c.sharedProducts === true ? sharedEndpoint(c) : '';
}

function dropProductsQueue() {
  clearTimeout(productsTimer);
  return serializeProducts(() => chrome.storage.local.remove([PRODUCTS_KEY]));
}

// -> { rows: { ASIN: row } } of fresh shared rows for this store.
async function productsLookup(store, asins) {
  const C = self.AIR.db.productCache;
  const rows = {};
  const url = await sharedProductsEndpoint();
  if (!url || !Array.isArray(asins)) return { rows };
  const now = Date.now();
  const ask = [];
  for (const asin of asins.slice(0, LOOKUP_MAX)) {
    const k = C.key(store, asin);
    const memo = lookupMemo.get(k);
    if (memo && now - memo.t < MEMO_MS) { if (memo.row && !C.stale(memo.row)) rows[memo.row.asin] = memo.row; }
    else ask.push(k);
  }
  if (!ask.length) return { rows };
  try {
    const body = await networkRequest(url, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind: 'lookup', keys: ask }),
    }, res => res.ok ? res.json() : null);
    if (!body || body.ok !== true || !Array.isArray(body.rows)) return { rows };
    if (lookupMemo.size > MEMO_MAX) lookupMemo.clear();
    const found = new Map();
    for (const raw of body.rows) {
      const row = C.sanitize(raw);
      if (row && ask.includes(row.key)) found.set(row.key, row);
    }
    for (const k of ask) {
      const row = found.get(k) || null;
      lookupMemo.set(k, { t: now, row });
      if (row && !C.stale(row)) rows[row.asin] = row;
    }
  } catch (e) { /* offline: the device cache and live scoring carry on */ }
  return { rows };
}

function queueProducts(msg) {
  return serializeProducts(async () => {
    if (!await sharedProductsEndpoint()) return { ok: false, reason: 'not-enabled' };
    const C = self.AIR.db.productCache;
    const conf = await chrome.storage.local.get(PRODUCTS_KEY);
    const queue = C.mergeQueue(conf[PRODUCTS_KEY], msg);
    await chrome.storage.local.set({ [PRODUCTS_KEY]: queue });
    // A row this device just uploaded is the freshest answer for it; no need to ask again.
    for (const row of Object.values(queue.upserts)) lookupMemo.set(row.key, { t: Date.now(), row });
    const queued = C.queueSize(queue);
    clearTimeout(productsTimer);
    if (queued >= PRODUCTS_BATCH && !productsBackoff) return sendProducts();
    productsTimer = setTimeout(() => { flushProducts().catch(quietly('flushProducts')); }, PRODUCTS_QUIET_MS);
    return { ok: true, queued };
  });
}

function flushProducts() {
  return serializeProducts(() => sendProducts());
}

async function sendProducts() {
  const url = await sharedProductsEndpoint();
  if (!url) return { ok: false, reason: 'not-enabled' };
  const C = self.AIR.db.productCache;
  const conf = await chrome.storage.local.get(PRODUCTS_KEY);
  const queue = { upserts: {}, pulls: {}, ...conf[PRODUCTS_KEY] };
  // The receiver takes at most 300 items per POST; the queue can hold 300 of each.
  const upserts = Object.keys(queue.upserts).slice(0, 150);
  const pulls = Object.keys(queue.pulls).slice(0, 150);
  if (!upserts.length && !pulls.length) return { ok: false, reason: 'nothing-to-send' };
  const result = await postRecord(url, {
    kind: 'products',
    upserts: upserts.map(k => queue.upserts[k]),
    pulls: pulls.map(key => ({ key, scanned_at: queue.pulls[key].scanned_at, n: queue.pulls[key].n })),
  });
  // An older web app appends unknown kinds onto contributions and still says wrote: 1.
  const confirmed = result.ok && result.tab === C.TAB;
  productsBackoff = !confirmed;
  if (!confirmed) return { ok: false, reason: result.reason || 'write-not-confirmed', queued: C.queueSize(queue) };
  upserts.forEach(k => delete queue.upserts[k]);
  pulls.forEach(k => delete queue.pulls[k]);
  const left = C.queueSize(queue);
  if (left) await chrome.storage.local.set({ [PRODUCTS_KEY]: queue });
  else await chrome.storage.local.remove([PRODUCTS_KEY]);
  return { ok: true, sent: upserts.length + pulls.length, queued: left };
}

// ---------------------------------------------------------------- settings online
//
// docs/SETTINGS-SYNC.md. Local settings are always the ones in force. Two copies can live online,
// and neither is ever applied without the user clicking Restore:
//   - the Chrome account (chrome.storage.sync), refreshed after every change while `settingsBackup`
//     is on — no setup, private to that account, works offline until Chrome syncs
//   - the user's own row on the shared sheet, keyed by a hash of their Google account id, written
//     and read only through the optional Google sign-in (the options page supplies the token)

const BACKUP_SOURCE_KEYS = self.AIR.db.prefs.SETTING_KEYS;
let backupTimer = null;
let backupChain = Promise.resolve();
const BACKUP_ALARM = 'ic-backup-retry';

function noteBackupChange(changes) {
  if (!changes || !BACKUP_SOURCE_KEYS.some(key => changes[key])) return;
  clearTimeout(backupTimer);
  // An alarm survives worker suspension; timers alone can lose the last edit.
  chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: 1 });
  // Debounced: a slider drag is dozens of writes, and chrome.storage.sync allows 120 a minute.
  backupTimer = setTimeout(() => { backupTimer = null; backupToChrome().catch(quietly('backupToChrome')); }, 2000);
  noteGoogleChange();
}

// ---- the Google copy, kept up to date on every change
//
// Only while the reader is signed in (googleProfile), has not turned googleAutoSave off, and this
// computer has already saved to or restored from the account once (googleLinked): a new computer
// must not overwrite the saved copy with its defaults before the reader has chosen. The token is
// asked for without a window (prompt=none); when Google needs the reader, the status says so and
// nothing is opened. Local settings always win, as with the Chrome backup.
const GOOGLE_ALARM = 'ic-google-save';
let googleTimer = null;
let googleChain = Promise.resolve();

function noteGoogleChange() {
  clearTimeout(googleTimer);
  chrome.alarms.create(GOOGLE_ALARM, { delayInMinutes: 1 });
  googleTimer = setTimeout(() => { googleTimer = null; googleAutoSave().catch(quietly('googleAutoSave')); }, 8000);
}

// The alarm is the fallback for a suspended worker. Once the save is done, or there is nothing to save,
// clear it; a failure that may pass (the network) leaves it for one more try a minute later.
const GOOGLE_DONE = new Set(['off', 'no-client']);   // a silent-token failure may be the network: one more try
function googleAutoSave() {
  const attempt = googleSaveOnce().then(res => {
    if (res.ok || GOOGLE_DONE.has(res.reason)) chrome.alarms.clear(GOOGLE_ALARM);
    return res;
  });
  googleChain = attempt;
  return attempt;
}

function googleSaveOnce() {
  return googleChain.catch(() => {}).then(async () => {
    const P = self.AIR.db.prefs;
    const conf = await chrome.storage.local.get([...BACKUP_SOURCE_KEYS, 'googleProfile', 'googleLinked', 'oauthClientId']);
    if (!P.sanitizeToggles(conf).googleAutoSave || !conf.googleProfile || conf.googleLinked !== true || !P.endpoint()) {
      return { ok: false, reason: 'off' };
    }
    const clientId = P.oauthClientId(conf.oauthClientId) || P.oauthClientId(P.OAUTH_CLIENT_ID);
    const auth = self.AIR.googleAuth;
    if (!clientId || !auth) return { ok: false, reason: 'no-client' };
    let token;
    try {
      if (!await chrome.permissions.contains({ permissions: ['identity'] })) throw new Error('permission');
      token = await auth.token(chrome, clientId, { silent: true });
    } catch (e) {
      await chrome.storage.local.set({ googleBackupStatus: { ok: false, t: Date.now(), reason: 'needs-sign-in' } });
      return { ok: false, reason: 'needs-sign-in' };
    }
    let who;
    try { who = await auth.profile(token); } catch {
      await chrome.storage.local.set({ googleBackupStatus: { ok: false, t: Date.now(), reason: 'needs-sign-in' } });
      return { ok: false, reason: 'needs-sign-in' };
    }
    const current = await chrome.storage.local.get(['googleAutoSave', 'googleLinked', 'googleProfile', 'enabled']);
    if (current.enabled === false || !P.sanitizeToggles(current).googleAutoSave || current.googleLinked !== true) return { ok: false, reason: 'off' };
    const email = p => String(p?.email || '').toLowerCase();
    if (!email(who) || email(who) !== email(conf.googleProfile) || email(current.googleProfile) !== email(who)) {
      await chrome.storage.local.set({ googleBackupStatus: { ok: false, t: Date.now(), reason: 'account-changed' } });
      return { ok: false, reason: 'account-changed' };
    }
    return accountSave(token, email(who));
  });
}

function backupToChrome() {
  const attempt = backupChain.catch(() => {}).then(async () => {
    if (!chrome.storage.sync) return { ok: false, reason: 'no-sync' };
    const conf = await chrome.storage.local.get(BACKUP_SOURCE_KEYS);
    if (conf.settingsBackup === false) { chrome.alarms.clear(BACKUP_ALARM); return { ok: false, reason: 'not-enabled' }; }
    const P = self.AIR.db.prefs;
    try {
      const local = await chrome.storage.local.get('backupDeviceId');
      const device = /^[a-f0-9]{32}$/.test(local.backupDeviceId || '') ? local.backupDeviceId : crypto.randomUUID().replace(/-/g, '');
      if (device !== local.backupDeviceId) await chrome.storage.local.set({ backupDeviceId: device });
      const old = await chrome.storage.sync.get('icBackup');
      const bank = old.icBackup?._syncBank === 'a' ? 'b' : 'a';
      const { icBackup, ...parts } = P.toSyncItems(P.backupPayload(conf), bank, device);
      await chrome.storage.sync.set(parts);
      // A user can turn backup off while the staged parts are being written.
      // Keep the prior committed backup instead of publishing the in-flight snapshot.
      if ((await chrome.storage.local.get('settingsBackup')).settingsBackup === false) return { ok: false, reason: 'not-enabled' };
      await chrome.storage.sync.set({ icBackup });
      await chrome.storage.local.set({ backupStatus: { ok: true, t: Date.now() } });
      chrome.alarms.clear(BACKUP_ALARM);   // the fallback alarm is only for a suspended worker; done, so no second save
      return { ok: true };
    } catch (e) {
      noteWorkerError('backupToChrome', e);
      chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: 5 });
      await chrome.storage.local.set({ backupStatus: { ok: false, t: Date.now(), reason: 'sync-write-failed' } });
      return { ok: false, reason: 'sync-write-failed' };
    }
  });
  backupChain = attempt;
  return attempt;
}

// The options page hands over an OAuth access token; the web app verifies it with Google and
// keys the row by a hash of the account id. The token is never stored.
async function accountRequest(kind, token, payload) {
  const url = self.AIR.db.prefs.endpoint();
  if (!url) return { ok: false, reason: 'no-endpoint' };
  if (typeof token !== 'string' || !/^[\w.~+/-]{20,4096}={0,2}$/.test(token)) return { ok: false, reason: 'no-token' };
  try {
    const body = await networkRequest(url, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind, token, ...(payload ? { payload } : {}) }),
    }, res => res.ok ? res.json() : null);
    return body || { ok: false, reason: 'network' };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

// Saving or restoring marks this computer as linked to the account (so later changes are saved
// automatically) and records when, for the status line on the settings page.
async function noteGoogleResult(res) {
  await chrome.storage.local.set(res.ok
    ? { googleLinked: true, googleBackupStatus: { ok: true, t: Date.now() } }
    : { googleBackupStatus: { ok: false, t: Date.now(), reason: String(res.reason || 'failed').slice(0, 80) } });
}

async function accountSave(token, automaticOwner) {
  const P = self.AIR.db.prefs;
  const conf = await chrome.storage.local.get(BACKUP_SOURCE_KEYS);
  if (automaticOwner) {
    const current = await chrome.storage.local.get(['googleProfile', 'googleLinked', 'googleAutoSave', 'enabled']);
    if (current.enabled === false || current.googleLinked !== true || !P.sanitizeToggles(current).googleAutoSave
      || String(current.googleProfile?.email || '').toLowerCase() !== automaticOwner) return { ok: false, reason: 'off' };
  }
  const res = await accountRequest('account', token, P.backupPayload(conf));
  const out = res.ok === true && res.tab === 'accounts' ? { ok: true } : { ok: false, reason: res.reason || res.error || 'write-not-confirmed' };
  await noteGoogleResult(out);
  return out;
}

// The saved copy, parsed and sanitized, not applied.
async function accountFetch(token) {
  const res = await accountRequest('accountGet', token);
  if (res.ok !== true) return { ok: false, reason: res.reason || res.error || 'network' };
  if (!res.payload) return { ok: false, reason: 'no-backup' };
  return self.AIR.db.prefs.parseBackup(res.payload);
}

async function accountLoad(token) {
  const parsed = await accountFetch(token);
  if (!parsed.ok) return parsed;
  await chrome.storage.local.set(parsed.values);
  await noteGoogleResult({ ok: true });
  return { ok: true, ts: parsed.ts };
}

function handleSharedDbMessage(msg, reply) {
  if (msg.type === 'diagnostic') {
    answer('diagnostic', () => queueDiagnostic(msg.record), reply, { ok: false, reason: 'worker-error' });
    return true;
  }
  if (msg.type === 'flushDiagnostics') {
    answer('flushDiagnostics', () => flushDiagnostics(), reply, { ok: false, reason: 'worker-error' });
    return true;
  }
  if (msg.type === 'diagnosticsStatus') {
    chrome.storage.local.get([DIAG_KEY, 'sendDiagnostics', 'diagLastError'], o => reply({
      reason: o.diagLastError || '',
      queued: (o[DIAG_KEY] || []).length,
      enabled: o.sendDiagnostics === true,
      configured: !!self.AIR.db.prefs.endpoint(),
    }));
    return true;
  }
  if (msg.type === 'provenanceLookup') {
    answer('provenanceLookup', async () => {
      const value = await loadProvenance();
      const index = value && value.index;
      const producers = value && value.producers;
      const record = lookupRecord(index, msg.key || {});
      const brand = (msg.key && msg.key.brand || '').toLowerCase();
      const producer = producers && brand && Object.hasOwn(producers, brand) ? producers[brand] : null;
      return record || producer ? { ...(producer || {}), ...(record || {}), producerRegistry: producer || null } : null;
    }, reply, null);
    return true;
  }
  // A report is a deliberate click, so it is sent whenever an endpoint is configured — unlike
  // passive contribution, which additionally requires the sharing box to be ticked.
  if (msg.type === 'report') {
    const url = self.AIR.db.prefs.endpoint();
    if (!url) { reply({ ok: false, reason: 'no-endpoint' }); return false; }
    answer('report', () => postRecord(url, { ...msg.payload, kind: 'report' }), reply, { ok: false, reason: 'worker-error' });
    return true;
  }
  if (msg.type === 'refreshSheet') {
    answer('refreshSheet', async () => {
      const value = await loadProvenance(true);
      return { ok: !!value, count: value ? value.index.count : 0, producers: value ? Object.keys(value.producers).length : 0 };
    }, reply, { ok: false, count: 0, producers: 0 });
    return true;
  }
  if (msg.type === 'contribute') {
    answer('contribute', () => contribute(msg.payload), reply, { ok: false, reason: 'worker-error' });
    return true;
  }
  if (msg.type === 'productsLookup') {
    answer('productsLookup', () => productsLookup(String(msg.store || ''), msg.asins), reply, { rows: {} });
    return true;
  }
  if (msg.type === 'productsQueue') {
    answer('productsQueue', () => queueProducts(msg), reply, { ok: false });
    return true;
  }
  if (msg.type === 'accountSave') {
    answer('accountSave', () => accountSave(msg.token), reply, { ok: false });
    return true;
  }
  if (msg.type === 'accountLoad') {
    answer('accountLoad', () => accountLoad(msg.token), reply, { ok: false });
    return true;
  }
  if (msg.type === 'accountFetch') {
    answer('accountFetch', () => accountFetch(msg.token), reply, { ok: false });
    return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sortFromCommand, googleAutoSave, accountFetch, indexRows, lookupRecord, sweepCache, sweepAges, isOpenFoodFactsFood, batchIdFor, revisionOf, ensureHousekeepingAlarm, allowMessage, isOwnExtension, isAmazonTabSender, isRetailerTabSender, isOptionsPageSender, isOffscreenSender, allowedOcrUrls, openSortedPanel, updateSortedResults, MAX_SHEET_BYTES, MAX_SHEET_ROWS };
}
