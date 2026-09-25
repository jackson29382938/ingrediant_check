// Service worker.
//
// Scoring is local. This worker holds the only network paths, and never fetches Amazon pages:
//   - the shared online database (product cache, provenance) — one Apps Script endpoint, a build
//     constant in prefs.js; on by default, off with `sharedCache`, inert while the constant is empty
//   - Open Food Facts, contributions, diagnostics — each off until toggled
//   - the settings backup (chrome.storage.sync) and the optional Google-account copy

if (typeof importScripts === 'function') {
  importScripts('engine/db/_module.js', 'engine/db/allergens.js', 'engine/categories.js',
    'engine/db/ingestible.js', 'engine/db/prefs.js',
    'engine/db/ocr-text.js', 'engine/db/product-cache.js', 'worker/messages.js', 'worker/sheet-store.js');
}

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_FIELDS = 'product_name,brands,ingredients_text,ingredients_text_en,labels_tags,nova_group,additives_tags,product_type,categories_tags,pnns_groups_1,categories';
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

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area && area !== 'local') return;
  if (changes.enabled?.newValue === false) {
    for (const controller of networkControllers) controller.abort();
  }
  if (changes.enabled?.newValue === false || changes.ocrLabels?.newValue === false) {
    // A paused content script can ignore a reply, but only the offscreen host can stop its CPU work.
    chrome.runtime.sendMessage({ target: 'ocr-offscreen', type: 'cancelOcr' }).catch(() => {});
  }
  noteBackupChange(changes);
});

// The test VM preloads ingestible.js; Chrome loads it via importScripts above. One implementation.
const isOpenFoodFactsFood = self.AIR.db.ingestible.isOpenFoodFactsFood;

async function lookupBarcode(code, { foodOnly = true } = {}) {
  const conf = await chrome.storage.local.get(['enabled', 'useOpenFoodFacts']);
  if (conf.enabled === false || conf.useOpenFoodFacts !== true) return null;
  if (!/^\d{8,14}$/.test(String(code))) return null;
  const key = `off:${code}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.t < TTL_MS) {
    if (cached.rejected === 'not-food') {
      return foodOnly
        ? { rejected: 'not-food', reason: cached.reason || 'Open Food Facts lists this as a non-food product' }
        : (cached.data || null);
    }
    if (foodOnly && cached.data && !isOpenFoodFactsFood(cached.data)) {
      return { rejected: 'not-food', reason: 'Open Food Facts lists this as a non-food product' };
    }
    return cached.data;
  }

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
      ingredients_text: p.ingredients_text_en || p.ingredients_text,
      labels: (p.labels_tags || []).join(' ').replace(/en:/g, ' '),
      nova_group: p.nova_group || null,
      name: p.product_name || null,
      // Keep the real type and categories so a later food-only check can still reject
      // beauty/household records. Defaulting a missing type to "food" used to launder them.
      product_type: p.product_type || '',
      categories_tags: p.categories_tags || [],
      categories: p.categories || '',
      pnns_groups_1: p.pnns_groups_1 || '',
    };
    if (foodOnly && !isOpenFoodFactsFood(p)) {
      await chrome.storage.local.set({
        [key]: {
          t: Date.now(),
          rejected: 'not-food',
          reason: 'Open Food Facts lists this as a non-food product',
          data,
        },
      });
      return { rejected: 'not-food', reason: 'Open Food Facts lists this as a non-food product' };
    }
    await chrome.storage.local.set({ [key]: { t: Date.now(), data } });
    return data;
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
let offscreenReady = null;

async function ensureOffscreen() {
  if (!chrome.offscreen) throw new Error('offscreen API unavailable');
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OCR_PATH)],
  }).catch(() => []);
  if (existing && existing.length) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: OCR_PATH,
      reasons: ['WORKERS'],
      justification: 'Reads the ingredient list from a product label photo, on this device.',
    }).catch(err => {
      offscreenReady = null;
      // Two callers can race here; the loser gets "only a single offscreen document" and is fine.
      if (!/single offscreen/i.test(String(err && err.message))) throw err;
    });
  }
  try { await offscreenReady; }
  finally { offscreenReady = null; }
}

// The offscreen page closes itself after sitting idle (see src/offscreen/ocr.js), which frees the
// engine's memory. A request can land in the moment between its last job and its exit, in which
// case the message has no receiver; one retry recreates the page and tries again.
function allowedOcrUrls(urls) {
  const filter = self.AIR && self.AIR.db && self.AIR.db.ocrText && self.AIR.db.ocrText.allowedOcrUrls;
  return filter ? filter(urls) : [];
}

async function ocrLabels(urls) {
  const conf = await chrome.storage.local.get(['enabled', 'ocrLabels']);
  if (conf.enabled === false || conf.ocrLabels !== true) return { ok: false, reason: 'not-enabled' };
  const allowed = allowedOcrUrls(urls);
  if (!allowed.length) return { ok: false, reason: 'no-images' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureOffscreen();
      const current = await chrome.storage.local.get(['enabled', 'ocrLabels']);
      if (current.enabled === false || current.ocrLabels !== true) return { ok: false, reason: 'not-enabled' };
      return await chrome.runtime.sendMessage({ target: 'ocr-offscreen', type: 'ocrImages', urls: allowed });
    } catch (e) {
      const message = String(e && e.message || e);
      if (attempt === 0 && /receiving end|could not establish|message port closed/i.test(message)) continue;
      return { ok: false, reason: message };
    }
  }
  return { ok: false, reason: 'offscreen unavailable' };
}

async function closeOffscreenIfIdle() {
  if (!chrome.offscreen || typeof chrome.offscreen.closeDocument !== 'function') return;
  try { await chrome.offscreen.closeDocument(); } catch (e) { /* already gone */ }
}

function badgeColor(score) {
  return score >= 75 ? '#1a9850' : score >= 50 ? '#f0a02a' : '#d73027';
}

function paintActionBadge(tabId, score, status) {
  if (!chrome.action || typeof tabId !== 'number') return;
  if (status === 'fail') {
    chrome.action.setBadgeText({ tabId, text: '?' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#767676' });
    return;
  }
  if (status === 'not-food') {
    chrome.action.setBadgeText({ tabId, text: '–' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#565959' });
    return;
  }
  if (typeof score !== 'number' || !isFinite(score)) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  chrome.action.setBadgeText({ tabId, text: String(Math.round(score)) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor(score) });
}

// Message allowlist lives in worker/messages.js (importScripts above / test harness preload).

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Replies from the offscreen document travel on this same channel; ignore them here.
  if (msg && msg.target === 'ocr-offscreen') return false;
  if (!allowMessage(msg, sender)) return false;
  if (msg && msg.type === 'pageScore') {
    paintActionBadge(sender && sender.tab && sender.tab.id, msg.score, msg.status);
    return false;
  }
  if (msg && msg.type === 'ocrLabels') {
    ocrLabels(msg.urls).then(reply);
    return true;
  }
  if (msg && msg.type === 'ocrIdle') {
    closeOffscreenIfIdle().then(() => reply({ ok: true }));
    return true;
  }
  if (msg && msg.type === 'lookupBarcode' && msg.code) {
    // lookupBarcode re-reads useOpenFoodFacts (and the pause switch) itself.
    lookupBarcode(msg.code, { foodOnly: msg.foodOnly !== false }).then(reply);
    return true;   // async reply
  }
  if (msg && msg.type === 'ping') { reply({ ok: true }); return false; }
  // Shared-database messages are handled here too. Registering a second onMessage listener works in
  // Chrome but shadowed the first one in the test harness, and one entry point is simpler anyway.
  if (msg && typeof handleSharedDbMessage === 'function') return handleSharedDbMessage(msg, reply);
  return false;
});

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
  if (a.name !== HOUSEKEEPING) return;
  sweepCache();
  // A partial batch would otherwise sit until enough new products were scored to fill it.
  flushDiagnostics().catch(() => {});
  flushProducts().catch(() => {});
});
// Keys and indexes from the pasted-URL era (sheet, producers, contribution URL, the one-row
// settings tab, the per-settings ratings cache). The endpoint is now a build constant.
const LEGACY_KEYS = ['sheetUrl', 'producersUrl', 'contributeUrl', 'syncSettings', 'ratingsQueue',
  'sheetIndex', 'producerIndex', 'ratingsIndex'];
function dropLegacy() {
  chrome.storage.local.remove(LEGACY_KEYS);
  for (const k of ['sheetIndex', 'producerIndex', 'ratingsIndex']) clearSheetIndex(k).catch(() => {});
}
chrome.runtime.onStartup.addListener(() => sweepCache());
chrome.runtime.onInstalled.addListener(details => {
  sweepCache();
  dropLegacy();
  // A new install asks its setup questions (src/options/welcome.html); an update never does.
  if (details && details.reason === 'install' && chrome.tabs) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/welcome.html') });
  }
});

async function sweepCache() {
  const all = await chrome.storage.local.get(null);
  // s: weighted scores, p: product data (docs/CACHE.md), off: Open Food Facts records.
  const entries = Object.entries(all).filter(([k]) => /^(s|p|off):/.test(k));
  const stale = entries
    .filter(([, v]) => v && v.t && Date.now() - v.t > TTL_MS)
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
    const receipt = await networkRequest(safe, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ kind: 'diagnostics', batchId: batchIdFor(queue), rows: queue }),
    }, res => res.ok ? res.json() : null);
    // Only clear on a confirmed write. A failed flush keeps the rows for the next attempt rather
    // than silently dropping the data the user turned this on to collect. The receiver may answer
    // wrote=N for a replay it already stored (duplicate:true); that still counts as confirmed.
    const confirmed = !!(receipt && receipt.ok === true && Number(receipt.wrote) === queue.length);
    if (confirmed) await chrome.storage.local.set({ [DIAG_KEY]: [] });
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

// -> { rows: { ASIN: row } } of fresh shared rows for this store.
async function productsLookup(store, asins) {
  const C = self.AIR.db.productCache;
  const rows = {};
  const url = await sharedEndpoint();
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
    if (!await sharedEndpoint()) return { ok: false, reason: 'not-enabled' };
    const C = self.AIR.db.productCache;
    const conf = await chrome.storage.local.get(PRODUCTS_KEY);
    const queue = C.mergeQueue(conf[PRODUCTS_KEY], msg);
    await chrome.storage.local.set({ [PRODUCTS_KEY]: queue });
    // A row this device just uploaded is the freshest answer for it; no need to ask again.
    for (const row of Object.values(queue.upserts)) lookupMemo.set(row.key, { t: Date.now(), row });
    const queued = C.queueSize(queue);
    clearTimeout(productsTimer);
    if (queued >= PRODUCTS_BATCH && !productsBackoff) return sendProducts();
    productsTimer = setTimeout(() => { flushProducts().catch(() => {}); }, PRODUCTS_QUIET_MS);
    return { ok: true, queued };
  });
}

function flushProducts() {
  return serializeProducts(() => sendProducts());
}

async function sendProducts() {
  const url = await sharedEndpoint();
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

const BACKUP_SOURCE_KEYS = ['weights', 'allergens', 'diets', 'avoidList', 'foodOnly',
  ...Object.keys(self.AIR.db.prefs.TOGGLE_DEFAULTS), ...Object.keys(self.AIR.db.prefs.DISPLAY_DEFAULTS)];
let backupTimer = null;

function noteBackupChange(changes) {
  if (!changes || !BACKUP_SOURCE_KEYS.some(key => changes[key])) return;
  clearTimeout(backupTimer);
  // Debounced: a slider drag is dozens of writes, and chrome.storage.sync allows 120 a minute.
  backupTimer = setTimeout(() => { backupTimer = null; backupToChrome().catch(() => {}); }, 2000);
}

async function backupToChrome() {
  if (!chrome.storage.sync) return { ok: false, reason: 'no-sync' };
  const conf = await chrome.storage.local.get(BACKUP_SOURCE_KEYS);
  if (conf.settingsBackup === false) return { ok: false, reason: 'not-enabled' };
  const P = self.AIR.db.prefs;
  await chrome.storage.sync.set(P.toSyncItems(P.backupPayload(conf)));
  return { ok: true };
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

async function accountSave(token) {
  const P = self.AIR.db.prefs;
  const conf = await chrome.storage.local.get(BACKUP_SOURCE_KEYS);
  const res = await accountRequest('account', token, P.backupPayload(conf));
  return res.ok === true && res.tab === 'accounts' ? { ok: true } : { ok: false, reason: res.reason || res.error || 'write-not-confirmed' };
}

async function accountLoad(token) {
  const res = await accountRequest('accountGet', token);
  if (res.ok !== true) return { ok: false, reason: res.reason || res.error || 'network' };
  if (!res.payload) return { ok: false, reason: 'no-backup' };
  const parsed = self.AIR.db.prefs.parseBackup(res.payload);
  if (!parsed.ok) return parsed;
  await chrome.storage.local.set(parsed.values);
  return { ok: true, ts: parsed.ts };
}

function handleSharedDbMessage(msg, reply) {
  if (msg.type === 'diagnostic') {
    queueDiagnostic(msg.record).then(reply);
    return true;
  }
  if (msg.type === 'flushDiagnostics') {
    flushDiagnostics().then(reply);
    return true;
  }
  if (msg.type === 'diagnosticsStatus') {
    chrome.storage.local.get([DIAG_KEY, 'sendDiagnostics'], o => reply({
      queued: (o[DIAG_KEY] || []).length,
      enabled: o.sendDiagnostics === true,
      configured: !!self.AIR.db.prefs.endpoint(),
    }));
    return true;
  }
  if (msg.type === 'provenanceLookup') {
    loadProvenance().then(value => {
      const index = value && value.index;
      const producers = value && value.producers;
      const record = lookupRecord(index, msg.key || {});
      const brand = (msg.key && msg.key.brand || '').toLowerCase();
      const producer = producers && brand && Object.hasOwn(producers, brand) ? producers[brand] : null;
      reply(record || producer ? { ...(producer || {}), ...(record || {}),
        producerRegistry: producer || null } : null);
    });
    return true;
  }
  // A report is a deliberate click, so it is sent whenever an endpoint is configured — unlike
  // passive contribution, which additionally requires the sharing box to be ticked.
  if (msg.type === 'report') {
    const url = self.AIR.db.prefs.endpoint();
    if (!url) { reply({ ok: false, reason: 'no-endpoint' }); return false; }
    postRecord(url, { ...msg.payload, kind: 'report' }).then(reply);
    return true;
  }
  if (msg.type === 'refreshSheet') {
    loadProvenance(true).then(value => reply({
      ok: !!value,
      count: value ? value.index.count : 0,
      producers: value ? Object.keys(value.producers).length : 0,
    }));
    return true;
  }
  if (msg.type === 'contribute') {
    contribute(msg.payload).then(reply);
    return true;
  }
  if (msg.type === 'productsLookup') {
    productsLookup(String(msg.store || ''), msg.asins).then(reply, () => reply({ rows: {} }));
    return true;
  }
  if (msg.type === 'productsQueue') {
    queueProducts(msg).then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg.type === 'accountSave') {
    accountSave(msg.token).then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg.type === 'accountLoad') {
    accountLoad(msg.token).then(reply, () => reply({ ok: false }));
    return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { indexRows, lookupRecord, sweepCache, isOpenFoodFactsFood, batchIdFor, revisionOf, ensureHousekeepingAlarm, allowMessage, isOwnExtension, isAmazonTabSender, isRetailerTabSender, isOptionsPageSender, isOffscreenSender, allowedOcrUrls, MAX_SHEET_BYTES, MAX_SHEET_ROWS };
}
