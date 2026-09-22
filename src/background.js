// Service worker.
//
// One optional job, off unless the user turns it on: Open Food Facts barcode lookup when the page
// has a UPC but no readable ingredient text. Search-result badges use scores already cached by the
// content script; this worker never fetches Amazon pages.
//
// Everything else in this extension is local. These are the only paths that touch the network.
// Open Food Facts, contributions, and diagnostics stay off until toggled. The shared sheet URL
// defaults to the Ingredient Check spreadsheet; Chrome still blocks that read until the host is
// allowed, and clearing the URL keeps lookups on the device.

if (typeof importScripts === 'function') {
  importScripts('engine/db/_module.js', 'engine/db/allergens.js', 'engine/categories.js',
    'engine/db/ingestible.js', 'engine/db/prefs.js',
    'engine/db/ocr-text.js', 'engine/db/ratings-cache.js', 'worker/messages.js', 'worker/sheet-store.js');
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
  noteSettingsStorageChange(changes);
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
  flushRatings().catch(() => {});
});
function ensureDefaultSheetUrl() {
  chrome.storage.local.get('sheetUrl', stored => {
    if (!stored || stored.sheetUrl == null) {
      chrome.storage.local.set({ sheetUrl: self.AIR.db.prefs.DEFAULT_SHEET_URL });
    }
  });
}
chrome.runtime.onStartup.addListener(() => sweepCache());
chrome.runtime.onInstalled.addListener(() => {
  sweepCache();
  ensureDefaultSheetUrl();
});

async function sweepCache() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([k]) => /^(s|off):/.test(k));
  const stale = entries
    .filter(([, v]) => v && v.t && Date.now() - v.t > TTL_MS)
    .map(([k]) => k);
  const staleSet = new Set(stale);   // `stale.includes` inside the filter below was O(n²) at 5k+ keys
  // Hard cap as well as a TTL: a heavy auto-scoring session can add thousands of fresh entries
  // that a time-based sweep will not touch for a month. Oldest go first.
  const MAX_ENTRIES = 5000;
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
// publishes almost none of it. A shared sheet lets that knowledge accumulate once per product
// instead of being re-derived by every person who looks at it.
//
// Read path is a published Google Sheet exported as CSV — no API key, no OAuth, no account. Write
// path is an Apps Script web app deployed from that sheet. The database URL defaults to the shared
// Ingredient Check spreadsheet; an empty string is the offline opt-out. The contribution URL stays
// empty until that web app exists — this file never invents an /exec address.

const SHEET_TTL_MS = 1000 * 60 * 60 * 6;
const SHEET_CACHE_KEY = 'sheetIndex';
// Bound sheet/producer caches so a huge published CSV cannot eat chrome.storage quota.
const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const MAX_SHEET_ROWS = 8000;

// Published-sheet URLs and CSV parsing: one implementation, in prefs. Tests load prefs.js first.
function toCsvUrl(raw) {
  return self.AIR.db.prefs.toSheetUrl(raw);
}
function parseCsv(text) {
  return self.AIR.db.prefs.parseCsv(text);
}
function activeSheetUrl(conf) {
  return self.AIR.db.prefs.resolveSheetUrl(conf || {});
}

function indexRows(rows) {
  // Null-prototype maps: every key here comes from an untrusted CSV, and on a plain object a row
  // with brand "__proto__" made lookupRecord() return Object.prototype as a truthy "record".
  const empty = () => ({ byAsin: Object.create(null), byUpc: Object.create(null),
                         byBrand: Object.create(null), count: 0 });
  if (!rows.length) return empty();
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = empty();
  for (const r of rows.slice(1)) {
    const rec = Object.create(null);
    head.forEach((h, i) => { rec[h] = (r[i] || '').trim(); });
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

async function loadSheetIndex(force = false) {
  const conf = await chrome.storage.local.get(['enabled', 'sheetUrl']);
  if (conf.enabled === false) return null;
  const csvUrl = toCsvUrl(activeSheetUrl(conf));
  if (!csvUrl) return null;
  const cached = await getSheetIndex(SHEET_CACHE_KEY);
  if (!force && cached && cached.url === csvUrl && Date.now() - cached.t < SHEET_TTL_MS) return cached.index;
  try {
    const csv = await networkRequest(csvUrl, { credentials: 'omit' }, res => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    });
    if (typeof csv !== 'string' || csv.length > MAX_SHEET_BYTES) {
      return cached && cached.url === csvUrl && cached.index ? cached.index : null;
    }
    const rows = parseCsv(csv);
    if (rows.length > MAX_SHEET_ROWS) {
      return cached && cached.url === csvUrl && cached.index ? cached.index : null;
    }
    const index = indexRows(rows);
    // The revision is a hash of the CSV, not a timestamp: the score cache fingerprints on it, and a
    // refresh that changed nothing must not retire every cached score. Content scripts read only the
    // small revision key, never the index itself.
    await putSheetIndex(SHEET_CACHE_KEY, { t: Date.now(), url: csvUrl, index });
    await chrome.storage.local.set({ sheetIndexRev: revisionOf(csv) });
    return index;
  } catch (e) {
    return cached && cached.url === csvUrl && cached.index ? cached.index : null;   // stale beats nothing
  }
}

function lookupRecord(index, { asin, upc, brand }) {
  if (!index) return null;
  if (asin && Object.hasOwn(index.byAsin, asin.toUpperCase())) return index.byAsin[asin.toUpperCase()];
  if (upc && Object.hasOwn(index.byUpc, String(upc).replace(/\D/g, ''))) return index.byUpc[String(upc).replace(/\D/g, '')];
  if (brand && Object.hasOwn(index.byBrand, brand.toLowerCase())) return index.byBrand[brand.toLowerCase()];
  return null;
}

// Producer registry: brand -> certifications someone has confirmed against a certifier's own
// directory. Live-scraping AGA/GAP/Certified Humane on every page view would be fragile, slow, and
// would need a host permission per certifier — and those directories change slowly. Checking them
// periodically by hand and recording the answer here is both more reliable and more honest about
// where the fact came from.
const PRODUCERS_CACHE_KEY = 'producerIndex';

async function loadProducerIndex(force = false) {
  const conf = await chrome.storage.local.get(['enabled', 'producersUrl']);
  if (conf.enabled === false) return null;
  const csvUrl = toCsvUrl(conf.producersUrl);
  if (!csvUrl) return null;
  const cached = await getSheetIndex(PRODUCERS_CACHE_KEY);
  if (!force && cached && cached.url === csvUrl && Date.now() - cached.t < SHEET_TTL_MS) return cached.index;
  try {
    const csv = await networkRequest(csvUrl, { credentials: 'omit' }, res => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    });
    if (typeof csv !== 'string' || csv.length > MAX_SHEET_BYTES) {
      return cached && cached.url === csvUrl && cached.index ? cached.index : null;
    }
    const rows = parseCsv(csv);
    if (rows.length > MAX_SHEET_ROWS) {
      return cached && cached.url === csvUrl && cached.index ? cached.index : null;
    }
    const head = (rows[0] || []).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const index = Object.create(null);
    for (const r of rows.slice(1)) {
      const rec = Object.create(null);
      head.forEach((h, i) => { rec[h] = (r[i] || '').trim(); });
      if (!rec.brand || !rec.certifications) continue;
      index[rec.brand.toLowerCase()] = rec;
    }
    await putSheetIndex(PRODUCERS_CACHE_KEY, { t: Date.now(), url: csvUrl, index });
    await chrome.storage.local.set({ producerIndexRev: revisionOf(csv) });
    return index;
  } catch (e) {
    return cached && cached.url === csvUrl && cached.index ? cached.index : null;
  }
}

async function contribute(payload) {
  const conf = await chrome.storage.local.get(['enabled', 'contributeUrl', 'shareContributions']);
  if (conf.enabled === false || conf.shareContributions !== true || !conf.contributeUrl) return { ok: false, reason: 'not-enabled' };
  return postRecord(conf.contributeUrl, payload);
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
    return ok ? { ok: true, tab: receipt.tab } : { ok: false, reason: 'write-not-confirmed' };
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
  const conf = await chrome.storage.local.get(['enabled', 'sendDiagnostics', 'contributeUrl', DIAG_KEY]);
  if (conf.enabled === false || !conf.sendDiagnostics || !conf.contributeUrl) return { ok: false, reason: 'not-enabled' };
  if (!record || typeof record !== 'object') return { ok: false, reason: 'no-record' };
  const queue = [...(conf[DIAG_KEY] || []), ensureRowId(record)].slice(-DIAG_MAX);
  await chrome.storage.local.set({ [DIAG_KEY]: queue });
  if (queue.length < DIAG_BATCH) return { ok: true, queued: queue.length };
  return sendDiagnostics();
}

async function sendDiagnostics() {
  const conf = await chrome.storage.local.get(['enabled', 'sendDiagnostics', 'contributeUrl', DIAG_KEY]);
  if (conf.enabled === false || !conf.sendDiagnostics) return { ok: false, reason: 'not-enabled' };
  const queue = (conf[DIAG_KEY] || []).map(ensureRowId);
  if (!conf.contributeUrl || !queue.length) return { ok: false, reason: 'nothing-to-send' };
  const safe = self.AIR && self.AIR.db && self.AIR.db.prefs
    ? self.AIR.db.prefs.toScriptUrl(conf.contributeUrl)
    : null;
  if (!safe) return { ok: false, reason: 'bad-url' };
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

// ---------------------------------------------------------------- shared ratings cache
//
// docs/CACHE.md. Reads fetch the whole ratings_cache tab (never one ASIN at a time, so the sheet
// host does not see what is browsed) and share the provenance TTL and size bounds. Writes are a
// queue of upserts and pull counts, flushed together after a quiet spell, when the batch fills, or
// on the housekeeping alarm, so a results page does not POST once per tile.

const RATINGS_INDEX_KEY = 'ratingsIndex';
const RATINGS_KEY = 'ratingsQueue';
const RATINGS_BATCH = 25;
const RATINGS_QUIET_MS = 15000;
let ratingsWork = Promise.resolve();
let ratingsTimer = null;
// After a failed send, only the quiet timer and the alarm retry; otherwise every tile would POST.
let ratingsBackoff = false;
function serializeRatings(work) {
  const result = ratingsWork.then(work);
  ratingsWork = result.catch(() => {});
  return result;
}

async function loadRatingsIndex() {
  const conf = await chrome.storage.local.get(['enabled', 'sheetUrl']);
  if (conf.enabled === false) return null;
  const csvUrl = self.AIR.db.prefs.toTabSheetUrl(activeSheetUrl(conf), self.AIR.db.ratingsCache.TAB);
  if (!csvUrl) return null;
  const cached = await getSheetIndex(RATINGS_INDEX_KEY);
  const fallback = cached && cached.url === csvUrl ? cached.index : null;
  if (fallback && Date.now() - cached.t < SHEET_TTL_MS) return fallback;
  try {
    const csv = await networkRequest(csvUrl, { credentials: 'omit' }, res => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    });
    if (typeof csv !== 'string' || csv.length > MAX_SHEET_BYTES) return fallback;
    const rows = parseCsv(csv);
    if (rows.length > MAX_SHEET_ROWS) return fallback;
    // gviz answers a missing tab with the first tab; its header has no scanned_at, so it indexes empty.
    const index = self.AIR.db.ratingsCache.indexRows(rows);
    await putSheetIndex(RATINGS_INDEX_KEY, { t: Date.now(), url: csvUrl, index });
    return index;
  } catch (e) {
    return fallback;
  }
}

async function ratingsLookup(store, asins) {
  const R = self.AIR.db.ratingsCache;
  const index = await loadRatingsIndex();
  const rows = {};
  if (!index || !Array.isArray(asins)) return { rows };
  for (const asin of asins.slice(0, 100)) {
    const k = `${store}:${asin}`;
    const fresh = (Object.hasOwn(index, k) ? index[k] : []).filter(row => !R.stale(row));
    if (fresh.length) rows[asin] = fresh;
  }
  return { rows };
}

function ratingsWritable(conf) {
  return conf.enabled !== false && conf.shareContributions === true && !!conf.contributeUrl;
}

function queueRatings(msg) {
  return serializeRatings(async () => {
    const conf = await chrome.storage.local.get(['enabled', 'shareContributions', 'contributeUrl', RATINGS_KEY]);
    if (!ratingsWritable(conf)) return { ok: false, reason: 'not-enabled' };
    const queue = self.AIR.db.ratingsCache.mergeQueue(conf[RATINGS_KEY], msg);
    await chrome.storage.local.set({ [RATINGS_KEY]: queue });
    const queued = self.AIR.db.ratingsCache.queueSize(queue);
    clearTimeout(ratingsTimer);
    if (queued >= RATINGS_BATCH && !ratingsBackoff) return sendRatings();
    ratingsTimer = setTimeout(() => { flushRatings().catch(() => {}); }, RATINGS_QUIET_MS);
    return { ok: true, queued };
  });
}

function flushRatings() {
  return serializeRatings(() => sendRatings());
}

async function sendRatings() {
  const conf = await chrome.storage.local.get(['enabled', 'shareContributions', 'contributeUrl', RATINGS_KEY]);
  if (!ratingsWritable(conf)) return { ok: false, reason: 'not-enabled' };
  const queue = { upserts: {}, pulls: {}, ...conf[RATINGS_KEY] };
  // The receiver takes at most 300 items per POST; the queue can hold 300 of each.
  const upserts = Object.keys(queue.upserts).slice(0, 150);
  const pulls = Object.keys(queue.pulls).slice(0, 150);
  if (!upserts.length && !pulls.length) return { ok: false, reason: 'nothing-to-send' };
  const result = await postRecord(conf.contributeUrl, {
    kind: 'ratings',
    upserts: upserts.map(k => queue.upserts[k]),
    pulls: pulls.map(key => ({ key, scanned_at: queue.pulls[key].scanned_at, n: queue.pulls[key].n })),
  });
  // An older web app appends unknown kinds onto contributions and still says wrote: 1.
  const confirmed = result.ok && result.tab === self.AIR.db.ratingsCache.TAB;
  ratingsBackoff = !confirmed;
  if (!confirmed) return { ok: false, reason: result.reason || 'write-not-confirmed', queued: self.AIR.db.ratingsCache.queueSize(queue) };
  upserts.forEach(k => delete queue.upserts[k]);
  pulls.forEach(k => delete queue.pulls[k]);
  const left = self.AIR.db.ratingsCache.queueSize(queue);
  if (left) await chrome.storage.local.set({ [RATINGS_KEY]: queue });
  else await chrome.storage.local.remove([RATINGS_KEY]);
  return { ok: true, sent: upserts.length + pulls.length, queued: left };
}

// Scoring settings sync. The body is exportPayload only. Auto-save follows the syncSettings toggle;
// Save / Load in options call these directly. A load writes the sanitized scoring keys back.
const SETTINGS_SYNC_KEYS = ['weights', 'allergens', 'diets', 'avoidList', 'foodOnly'];
let settingsSyncTimer = null;
let suppressSettingsSync = 0;

function noteSettingsStorageChange(changes) {
  if (suppressSettingsSync || !changes) return;
  if (!SETTINGS_SYNC_KEYS.some(key => changes[key])) return;
  clearTimeout(settingsSyncTimer);
  settingsSyncTimer = setTimeout(() => {
    settingsSyncTimer = null;
    if (suppressSettingsSync) return;
    saveSettingsToEndpoint({ onlyIfEnabled: true }).catch(() => {});
  }, 1200);
}

async function saveSettingsToEndpoint({ onlyIfEnabled = false } = {}) {
  const conf = await chrome.storage.local.get([
    'enabled', 'contributeUrl', 'syncSettings',
    'weights', 'allergens', 'diets', 'avoidList', 'foodOnly',
  ]);
  if (conf.enabled === false) return { ok: false, reason: 'not-enabled' };
  if (onlyIfEnabled && conf.syncSettings !== true) return { ok: false, reason: 'not-enabled' };
  if (!conf.contributeUrl) return { ok: false, reason: 'no-endpoint' };
  const result = await postRecord(conf.contributeUrl, self.AIR.db.prefs.settingsSaveBody(conf));
  // An older web app appends unknown kinds onto contributions and still says wrote: 1.
  if (result.ok && result.tab !== 'settings') return { ok: false, reason: 'write-not-confirmed' };
  return result;
}

async function commitLoadedSettings(prefs) {
  suppressSettingsSync++;
  try {
    await chrome.storage.local.set(prefs);
  } finally {
    setTimeout(() => { suppressSettingsSync = Math.max(0, suppressSettingsSync - 1); }, 1600);
  }
  return { ok: true, prefs };
}

async function loadSettingsFromSheet() {
  const conf = await chrome.storage.local.get(['enabled', 'sheetUrl', 'contributeUrl']);
  if (conf.enabled === false) return { ok: false, reason: 'not-enabled' };
  const prefsApi = self.AIR.db.prefs;
  let lastReason = 'no-settings';
  const csvUrl = prefsApi.toSettingsSheetUrl(conf);
  if (csvUrl) {
    try {
      const csv = await networkRequest(csvUrl, { credentials: 'omit' }, res => {
        if (res.status === 401 || res.status === 403) throw new Error('sheet-private');
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      });
      if (typeof csv !== 'string' || csv.length > 500000) throw new Error('too-large');
      const parsed = prefsApi.parseSettingsExport(csv);
      if (parsed.ok) return commitLoadedSettings(parsed.prefs);
      lastReason = parsed.reason || 'no-settings';
    } catch (e) {
      lastReason = e && e.message === 'sheet-private' ? 'sheet-private' : 'network';
    }
  }
  const script = prefsApi.toScriptUrl(conf.contributeUrl || '');
  if (!script) return { ok: false, reason: lastReason };
  try {
    const body = await networkRequest(`${script}?kind=settings`, { credentials: 'omit' }, res => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
    const parsed = prefsApi.parseSettingsExport(body);
    if (!parsed.ok) return { ok: false, reason: parsed.reason || 'no-settings' };
    return commitLoadedSettings(parsed.prefs);
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
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
    chrome.storage.local.get([DIAG_KEY, 'sendDiagnostics', 'contributeUrl'], o => reply({
      queued: (o[DIAG_KEY] || []).length,
      enabled: o.sendDiagnostics === true,
      configured: !!o.contributeUrl,
    }));
    return true;
  }
  if (msg.type === 'provenanceLookup') {
    Promise.all([loadSheetIndex(), loadProducerIndex()]).then(([index, producers]) => {
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
    chrome.storage.local.get('contributeUrl', async conf => {
      if (!conf.contributeUrl) { reply({ ok: false, reason: 'no-endpoint' }); return; }
      reply(await postRecord(conf.contributeUrl, { ...msg.payload, kind: 'report' }));
    });
    return true;
  }
  if (msg.type === 'refreshSheet') {
    Promise.all([loadSheetIndex(true), loadProducerIndex(true)]).then(([index, producers]) => reply({
      ok: !!(index || producers),
      count: index ? index.count : 0,
      producers: producers ? Object.keys(producers).length : 0,
    }));
    return true;
  }
  if (msg.type === 'contribute') {
    contribute(msg.payload).then(reply);
    return true;
  }
  if (msg.type === 'ratingsLookup') {
    ratingsLookup(String(msg.store || ''), msg.asins).then(reply, () => reply({ rows: {} }));
    return true;
  }
  if (msg.type === 'ratingsQueue') {
    queueRatings(msg).then(reply, () => reply({ ok: false }));
    return true;
  }
  if (msg.type === 'saveSettings') {
    saveSettingsToEndpoint().then(reply);
    return true;
  }
  if (msg.type === 'loadSettings') {
    loadSettingsFromSheet().then(reply);
    return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toCsvUrl, parseCsv, indexRows, lookupRecord, sweepCache, isOpenFoodFactsFood, batchIdFor, revisionOf, ensureHousekeepingAlarm, allowMessage, isOwnExtension, isAmazonTabSender, isSettingsSender, isOffscreenSender, allowedOcrUrls, MAX_SHEET_BYTES, MAX_SHEET_ROWS };
}
