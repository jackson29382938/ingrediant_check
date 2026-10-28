/**
 * Ingredient Check — the web app behind the shared (private) spreadsheet.
 *
 * Setup: docs/SETTINGS-SYNC.md. In short: open the spreadsheet, Extensions > Apps Script, paste this
 * file over Code.gs, Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone),
 * then put the /exec URL into ENDPOINT in src/engine/db/prefs.js. Keep the spreadsheet itself
 * shared with nobody: every read and write goes through this script, which runs as you.
 *
 * POST kinds (body is JSON sent as text/plain):
 *   lookup      — { keys: ["amazon.com:B00…"] } -> fresh rows of the products tab (read only)
 *   products    — product-cache upserts and pull counts (tab: products; docs/CACHE.md)
 *   diagnostics — one row per scored product, plus scans that produced no score and "Looks wrong?"
 *                 clicks (outcome column), for accuracy analysis (tab: diagnostics)
 *   report      — a "Looks wrong?" click (tab: reports)
 *   account     — { token, payload } a signed-in user's settings (tab: accounts, one row each)
 *   accountGet  — { token } -> that user's settings
 *   (anything else) — a certification contribution (tab: contributions)
 * GET ?kind=provenance returns the first tab and the producers tab. Any other GET is a liveness check.
 *
 * The URL ships inside the extension, so it is public. Every row is checked here and again by the
 * extension when read back, products only move forward in time, and account rows need a Google
 * token issued to OAUTH_CLIENT_ID. Nobody can open or edit the sheet itself.
 *
 * Product rows (lookup / products) are CLOSED until you open them. Anyone with the URL could write
 * one, and a row's shape can be checked but not whether its ingredient text is true, so a closed
 * receiver neither stores nor serves them. To open them, knowing that: Project Settings > Script
 * Properties > add PRODUCTS_OPEN = true. The extension also keeps them off until each reader turns
 * on "Share product readings with other computers" (docs/CACHE.md, "Trust").
 */

// OAuth client id for the optional Google sign-in; the same value as OAUTH_CLIENT_ID in prefs.js.
// Empty turns account storage off.
var OAUTH_CLIENT_ID = '483888107675-hofgo4a3uh1g2khv4hja9ci8nhama6tk.apps.googleusercontent.com';

var DIAGNOSTIC_COLUMNS = ["ts","version","store","asin","upc","brand","product_name","source","via","confidence","gate","coverage","parsed","score","verdict","nova","base","cap","penalties","bonuses","flags","provenance","weights","ingredients","outcome","feedback"];

var CONTRIBUTION_COLUMNS = [
  'ts', 'asin', 'upc', 'brand', 'product_name', 'kind',
  'certifications', 'feed', 'origin', 'verified_by', 'notes'
];

// Mirrors src/engine/db/product-cache.js. Keep COLUMNS and the age / pull limits in step.
var PRODUCT_COLUMNS = ['key', 'store', 'asin', 'status', 'data', 'scanned_at', 'pulls'];
var PRODUCTS_MAX = 300;
var LOOKUP_MAX = 100;
var DATA_MAX_CHARS = 12000;
var ACCOUNT_COLUMNS = ['id', 'payload', 'ts'];
var ACCOUNT_MAX_CHARS = 20000;

// Script Properties, not code, so opening product rows needs no redeploy and no code edit.
function productsOpen() {
  return PropertiesService.getScriptProperties().getProperty('PRODUCTS_OPEN') === 'true';
}

// Owner-only maintenance: run these from the Apps Script editor, never via doPost.
function closeSharedProducts() {
  PropertiesService.getScriptProperties().deleteProperty('PRODUCTS_OPEN');
}
function purgeSharedProduct(store, asin) {
  if (!/^amazon\.[a-z.]+$/.test(String(store)) || !/^[A-Z0-9]{10}$/.test(String(asin))) {
    throw new Error('invalid product key');
  }
  closeSharedProducts();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('busy; retry later');
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('products');
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    var removed = 0;
    for (var i = keys.length - 1; i >= 0; i--) {
      if (String(keys[i][0]) === store + ':' + asin) { sheet.deleteRow(i + 2); removed++; }
    }
    SpreadsheetApp.flush();
    return removed;
  } finally { lock.releaseLock(); }
}
function purgeHistoricalPolishReading() {
  return purgeSharedProduct('amazon.pl', 'B00MCJ3180');
}

// One structured line per request, for measuring load during a pilot (docs/SETTINGS-SYNC.md,
// "Measuring load"): Apps Script > Executions shows them, and Cloud Logging can chart them. No
// product, token or payload is logged: only the kind, how many items, how long, and the outcome.
var lastReply = null;   // what json() last answered, for logRequest; reset per request
var lockTiming = { waitMs: 0, heldMs: 0 };
function logRequest(kind, items, started) {
  if (typeof console === 'undefined' || !console.log) return;
  var out = lastReply || {};
  console.log(JSON.stringify({ ic: 'request', kind: kind, items: items, ms: Date.now() - started,
    lockWaitMs: lockTiming.waitMs, lockHeldMs: lockTiming.heldMs,
    ok: out.ok === true, busy: /busy/.test(String(out.error || '')), closed: out.closed === true || /closed/.test(String(out.error || '')) }));
}
function itemsOf(body) {
  if (!body) return 0;
  if (Array.isArray(body.keys)) return body.keys.length;
  if (Array.isArray(body.rows)) return body.rows.length;
  return (Array.isArray(body.upserts) ? body.upserts.length : 0) + (Array.isArray(body.pulls) ? body.pulls.length : 0) || 1;
}

function doPost(e) {
  var started = Date.now();
  var body = null;
  lastReply = null;
  lockTiming = { waitMs: 0, heldMs: 0 };
  var result = handlePost(e, function (b) { body = b; });
  logRequest(body && body.kind ? String(body.kind).slice(0, 20) : 'invalid', itemsOf(body), started);
  return result;
}

function handlePost(e, seen) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, error: 'invalid json' }); }
  seen(body);
  // Verify Google remotely before taking the global sheet lock. Identity is computed here,
  // never accepted from the request body; sheet reads/merges/deletions remain atomic below.
  var identity;
  try {
    if (['account', 'accountGet', 'historyGet', 'historyPut', 'historyClear'].indexOf(body.kind) !== -1) identity = accountId(body.token);
  } catch (err) { return json({ ok: false, error: String(err) }); }
  // Public lookup and settings reads bypass batch-write locks. Private history reads lock below,
  // alongside history deletion, to avoid exposing a partly cleared account.
  try {
    if (body.kind === 'lookup') return lookupProducts(body.keys);
    if (body.kind === 'accountGet') return readAccount(body.token, identity);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
  var lock = LockService.getScriptLock();
  var acquired = false;
  var waitingAt = Date.now(), acquiredAt = 0;
  try {
    acquired = lock.tryLock(15000);
    lockTiming.waitMs = Date.now() - waitingAt;
    acquiredAt = Date.now();
    if (!acquired) return json({ ok: false, error: 'busy; retry later' });
    if (body.kind === 'diagnostics') {
      if (body.diagnosticsSchema && body.diagnosticsSchema > 2) return json({ ok: false, error: 'unsupported-diagnostics-schema', diagnosticsSchema: 2 });
      return writeDiagnostics(body.rows || [], body.batchId);
    }
    if (body.kind === 'report') return writeRows('reports', CONTRIBUTION_COLUMNS, [stamp(body)]);
    if (body.kind === 'products') return writeProducts(body);
    if (body.kind === 'account') return writeAccount(body.token, body.payload, identity);
    if (body.kind === 'historyGet') return readHistory(body.token, identity);
    if (body.kind === 'historyPut') return writeHistory(body.token, body.payload, identity);
    if (body.kind === 'historyClear') return clearHistory(body.token, identity);
    return writeRows('contributions', CONTRIBUTION_COLUMNS, [stamp(body)]);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    if (acquired) { lockTiming.heldMs = Date.now() - acquiredAt; lock.releaseLock(); }
  }
}

function doGet(e) {
  var started = Date.now();
  lastReply = null;
  lockTiming = { waitMs: 0, heldMs: 0 };
  var result = handleGet(e);
  logRequest('get:' + String((e && e.parameter && e.parameter.kind) || 'status').slice(0, 20), 1, started);
  return result;
}

function handleGet(e) {
  var kind = e && e.parameter && e.parameter.kind;
  if (kind === 'provenance') {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var producers = ss.getSheetByName('producers');
      return json({ ok: true, kind: 'provenance',
        provenance: tableValues(ss.getSheets()[0]), producers: tableValues(producers) });
    } catch (err) {
      return json({ ok: false, error: String(err) });
    }
  }
  // `accounts` says whether Google account storage has a client id, so a deployment can be checked
  // by opening the /exec URL: `"accounts":true` means this version is live and configured.
  var clientId = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID') || OAUTH_CLIENT_ID;
  return json({ ok: true, service: 'ingredient-check', diagnosticsSchema: 2, accounts: !!clientId, history: !!clientId, historySchema: 1, historyCapacity: AIR.db.purchaseHistory.MAX,
    accepts: ['lookup', 'products', 'diagnostics', 'report', 'account', 'accountGet', 'historyGet', 'historyPut', 'historyClear', 'contribution'] });
}

// Strings only, so a date or an all-digit UPC reaches the extension exactly as typed.
function tableValues(sheet) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
}

// ---------------------------------------------------------------- products

function cleanProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var store = unquote(raw.store).toLowerCase().replace(/^www\./, '');
  var asin = unquote(raw.asin).toUpperCase();
  var status = unquote(raw.status);
  var t = Date.parse(unquote(raw.scanned_at));
  var data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? JSON.stringify(raw.data) : '';
  if (store.length > 60 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(store)) return null;
  if (!/^[A-Z0-9]{10}$/.test(asin) || ['ok', 'unreadable', 'not-food'].indexOf(status) === -1) return null;
  if (!data || data.length > DATA_MAX_CHARS) return null;
  var now = Date.now();
  if (!isFinite(t) || t > now + 5 * 60 * 1000) return null;
  // Never later than this receiver's own clock: a newer scan replaces a row, and a writer who could
  // stamp a few minutes ahead would win every race for that product.
  return { key: store + ':' + asin, store: store, asin: asin, status: status, data: data,
    scanned_at: new Date(Math.min(t, now)).toISOString(), pulls: 0 };
}

// row index (0-based among data rows) by key, from the key column only.
function productIndex(sheet) {
  var count = Math.max(0, sheet.getLastRow() - 1);
  var keys = count ? sheet.getRange(2, 1, count, 1).getValues() : [];
  var at = {};
  keys.forEach(function (r, i) { at['k' + unquote(r[0])] = i; });
  return { at: at, count: count };
}

// ponytail: reads the key column on every lookup — O(rows) per request, fine into the tens of
// thousands of products. Past that, keep a key->row map in CacheService or move off Sheets.
function lookupProducts(keys) {
  if (!Array.isArray(keys) || keys.length > LOOKUP_MAX) throw new Error('invalid lookup');
  if (!productsOpen()) return json({ ok: true, rows: [], closed: true });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('products');
  if (!sheet || sheet.getLastRow() < 2) return json({ ok: true, rows: [] });
  var index = productIndex(sheet);
  var hits = [];
  keys.forEach(function (k) {
    var i = index.at['k' + String(k)];
    if (i !== undefined && hits.indexOf(i) === -1) hits.push(i);
  });
  if (!hits.length) return json({ ok: true, rows: [] });
  var ranges = sheet.getRangeList(hits.map(function (i) { return 'A' + (i + 2) + ':G' + (i + 2); })).getRanges();
  var rows = ranges.map(function (range) {
    var r = range.getValues()[0];
    var data = null;
    try { data = JSON.parse(unquote(r[4])); } catch (err) { data = null; }
    return { store: unquote(r[1]), asin: unquote(r[2]), status: unquote(r[3]), data: data,
      scanned_at: unquote(r[5]), pulls: Number(r[6]) || 0 };
  });
  return json({ ok: true, rows: rows });
}

// ponytail: reads and rewrites the whole tab under the script lock on every batch — O(rows) per
// POST. Fine into the low tens of thousands of rows; past that, prune stale rows or switch to
// per-row writes (TextFinder on the key column + setValues on the one row).
function writeProducts(body) {
  if (!productsOpen()) return json({ ok: false, error: 'products closed', tab: 'products' });
  var upserts = Array.isArray(body.upserts) ? body.upserts : [];
  var pulls = Array.isArray(body.pulls) ? body.pulls : [];
  if (upserts.length + pulls.length > PRODUCTS_MAX) throw new Error('invalid products batch');
  var sheet = sheetFor('products', PRODUCT_COLUMNS);
  var count = Math.max(0, sheet.getLastRow() - 1);
  var values = count ? sheet.getRange(2, 1, count, PRODUCT_COLUMNS.length).getValues() : [];
  var at = {};
  values.forEach(function (r, i) { at['k' + unquote(r[0])] = i; });
  var upserted = 0, pulled = 0;
  upserts.forEach(function (raw) {
    var row = cleanProduct(raw);
    if (!row) return;
    var cells = PRODUCT_COLUMNS.map(function (c) { return row[c]; });
    var i = at['k' + row.key];
    if (i === undefined) {
      at['k' + row.key] = values.length;
      values.push(cells);
    } else if (!(Date.parse(unquote(values[i][5])) >= Date.parse(row.scanned_at))) {
      values[i] = cells;            // a newer scan replaces the row and resets its pulls
    } else {
      return;                       // an older scan never overwrites a newer one
    }
    upserted++;
  });
  pulls.forEach(function (p) {
    var i = p && at['k' + String(p.key)];
    var t = p && Date.parse(p.scanned_at);
    // A pull counts only against the scan the reader actually saw.
    if (i === undefined || !isFinite(t) || unquote(values[i][5]) !== new Date(t).toISOString()) return;
    values[i][6] = (Number(values[i][6]) || 0) + Math.min(100, Math.max(1, Math.floor(Number(p.n) || 1)));
    pulled++;
  });
  if (upserted || pulled) {
    // A leading ' keeps text as text: ISO dates and all-digit ASINs would otherwise be converted,
    // and =+-@ would be evaluated as formulas.
    sheet.getRange(2, 1, values.length, PRODUCT_COLUMNS.length).setValues(values.map(function (r) {
      return r.map(function (v) { return typeof v === 'string' && v !== '' ? "'" + unquote(v) : v; });
    }));
  }
  SpreadsheetApp.flush();
  return json({ ok: true, wrote: 1, tab: 'products', upserted: upserted, pulled: pulled });
}

// ---------------------------------------------------------------- accounts

// Google says who the token belongs to; the row is keyed by a hash of that id, never the email.
function accountId(token) {
  var clientId = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID') || OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('accounts are not configured');
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new Error('no token');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('token rejected');
  var info = JSON.parse(res.getContentText());
  // A token issued to some other app must not open this user's row.
  var audience = info.aud || info.azp;
  if (audience !== clientId || (info.azp && info.azp !== clientId)
      || typeof info.sub !== 'string' || !info.sub) throw new Error('token rejected');
  if (info.expires_in != null && (!isFinite(Number(info.expires_in)) || Number(info.expires_in) <= 0)) {
    throw new Error('token rejected');
  }
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ingredient-check:' + info.sub);
  return digest.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function findAccountRow(sheet, id) {
  var count = Math.max(0, sheet.getLastRow() - 1);
  var ids = count ? sheet.getRange(2, 1, count, 1).getValues() : [];
  for (var i = 0; i < ids.length; i++) if (unquote(ids[i][0]) === id) return i + 2;
  return -1;
}

function writeAccount(token, payload, identity) {
  var id = identity || accountId(token);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid payload');
  if (payload._format !== 'ingredient-check-settings') throw new Error('unknown settings format');
  var text = JSON.stringify(payload);
  if (text.length > ACCOUNT_MAX_CHARS) throw new Error('payload too large');
  var sheet = sheetFor('accounts', ACCOUNT_COLUMNS);
  var row = ["'" + id, "'" + text, "'" + new Date().toISOString()];
  var at = findAccountRow(sheet, id);
  if (at === -1) sheet.appendRow(row);
  else sheet.getRange(at, 1, 1, ACCOUNT_COLUMNS.length).setValues([row]);
  SpreadsheetApp.flush();
  return json({ ok: true, wrote: 1, tab: 'accounts' });
}

function readAccount(token, identity) {
  var id = identity || accountId(token);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('accounts');
  var at = sheet ? findAccountRow(sheet, id) : -1;
  if (at === -1) return json({ ok: true, payload: null });
  var r = sheet.getRange(at, 1, 1, ACCOUNT_COLUMNS.length).getValues()[0];
  return json({ ok: true, payload: JSON.parse(unquote(r[1])), ts: unquote(r[2]) });
}

// Separate private rows, verified Google account only. No order IDs, emails or tokens are stored.
var HISTORY_COLUMNS = ['account', 'key', 'payload'];
function historyClearTime(id) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('history-resets');
  var at = sheet ? findAccountRow(sheet, id) : -1;
  return at === -1 ? 0 : Number(unquote(sheet.getRange(at, 2, 1, 1).getValues()[0][0])) || 0;
}
function historyRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('purchase-history');
  return sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HISTORY_COLUMNS.length).getValues() : [];
}
function readHistory(token, identity) {
  var id = identity || accountId(token), cleared = historyClearTime(id);
  var records = historyRows().filter(function(r) { return unquote(r[0]) === id; }).map(function(r) { return JSON.parse(unquote(r[2])); }).filter(function(r) { return r.observedAt > cleared; });
  return json({ ok: true, kind: 'historyGet', account: id, clearedAt: cleared, records: AIR.db.purchaseHistory.merge([], records) });
}
function writeHistory(token, payload, identity) {
  var id = identity || accountId(token), H = AIR.db.purchaseHistory;
  if (!payload || !Array.isArray(payload.records) || payload.records.length > 100) throw new Error('invalid history batch');
  if (payload.records.some(function(r) { return !H.clean(r); })) throw new Error('invalid history record');
  var cleared = historyClearTime(id), all = historyRows(), old = [], at = {}, previous = {};
  var wanted = {}; payload.records.forEach(function(r) { wanted[r.key] = true; });
  if (payload.epoch !== cleared) throw new Error('history was reset; sync again');
  all.forEach(function(r, i) { if (unquote(r[0]) === id) { var parsed = JSON.parse(unquote(r[2])); old.push(parsed); previous[parsed.key] = JSON.stringify(AIR.db.purchaseHistory.clean(parsed)); at[unquote(r[1])] = i + 2; } });
  var records = H.merge(old.filter(function(r) { return r.observedAt > cleared; }), payload.records.filter(function(r) { return r.observedAt > cleared; }));
  var sheet = sheetFor('purchase-history', HISTORY_COLUMNS);
  records.forEach(function(r) {
    if (!wanted[r.key] || previous[r.key] === JSON.stringify(r)) return;
    var row = ["'" + id, "'" + r.key, "'" + JSON.stringify(r)];
    if (at[r.key]) sheet.getRange(at[r.key], 1, 1, 3).setValues([row]); else sheet.appendRow(row);
  });
  SpreadsheetApp.flush();
  return json({ ok: true, kind: 'historyPut', count: records.length });
}
function clearHistory(token, identity) {
  var id = identity || accountId(token), cleared = Date.now(), resets = sheetFor('history-resets', ACCOUNT_COLUMNS), at = findAccountRow(resets, id);
  var marker = ["'" + id, "'" + String(cleared), "'" + new Date(cleared).toISOString()];
  if (at === -1) resets.appendRow(marker); else resets.getRange(at, 1, 1, 3).setValues([marker]);
  var all = historyRows(), sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('purchase-history');
  for (var i = all.length - 1; i >= 0; i--) {
    if (unquote(all[i][0]) !== id) continue;
    var end = i; while (i > 0 && unquote(all[i - 1][0]) === id) i--;
    sheet.deleteRows(i + 2, end - i + 1);
  }
  SpreadsheetApp.flush();
  return json({ ok: true, kind: 'historyClear', clearedAt: cleared });
}

// ---------------------------------------------------------------- diagnostics, reports, contributions

// Store each ID in the SAME range write as its data. A lost response can then be retried without
// a separate PropertiesService commit, a rolling history window, or its per-value size limit.
// doPost holds the script lock across both the duplicate check and the append.
function writeDiagnostics(rows, batchId) {
  if (!Array.isArray(rows) || rows.length > 300) throw new Error('invalid diagnostic batch');
  if (!rows.length) return json({ diagnosticsSchema: 2, ok: true, wrote: 0, inserted: 0 });
  var legacy = loadSeen();
  if (batchId && legacy.batches.indexOf(String(batchId)) !== -1) {
    return json({ diagnosticsSchema: 2, ok: true, wrote: rows.length, inserted: 0, duplicate: true });
  }
  var columns = DIAGNOSTIC_COLUMNS.concat(['rowId']);
  var sheet = sheetFor('diagnostics', columns);
  // Upgrade older sheets without touching their data. Before outcome/feedback existed, rowId sat in
  // column 25; move it to the end, then (re)write the header so every column is named.
  var base = DIAGNOSTIC_COLUMNS.length - 2;
  var used = sheet.getLastRow();
  if (used && String(sheet.getRange(1, base + 1, 1, 1).getValues()[0][0]) === 'rowId') {
    var ids = sheet.getRange(1, base + 1, used, 1).getValues();
    sheet.getRange(1, columns.length, used, 1).setValues(ids);
    sheet.getRange(1, base + 1, used, 2).setValues(ids.map(function () { return ['', '']; }));
  }
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
  var count = Math.max(0, sheet.getLastRow() - 1);
  var stored = count ? sheet.getRange(2, columns.length, count, 1).getValues() : [];
  var seen = new Set(legacy.rows.concat(stored.map(function (r) { return String(r[0]); })));
  var fresh = [];
  rows.forEach(function (row, i) {
    if (!row || typeof row !== 'object') throw new Error('invalid diagnostic row');
    var id = row.rowId || (batchId ? 'legacy-' + batchId + '-' + i : '');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('missing or invalid rowId');
    if (seen.has(id)) return;
    seen.add(id);
    fresh.push(Object.assign({}, row, { rowId: id }));
  });
  if (fresh.length) writeRows('diagnostics', columns, fresh, sheet);
  return json({ diagnosticsSchema: 2, ok: true, wrote: rows.length, inserted: fresh.length, duplicate: fresh.length === 0 });
}

// Read the old history for migration only. New writes never grow this property.
function loadSeen() {
  try {
    var parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty('diagSeen') || '{}');
    return { batches: parsed.batches || [], rows: parsed.rows || [] };
  } catch (err) {
    return { batches: [], rows: [] };
  }
}

function stamp(row) {
  if (!row.ts) row.ts = new Date().toISOString();
  return row;
}

function writeRows(tabName, columns, rows, existingSheet) {
  if (!rows.length) return json({ ok: true, wrote: 0 });
  var sheet = existingSheet || sheetFor(tabName, columns);
  var values = rows.map(function (row) {
    return columns.map(function (c) {
      var v = row[c];
      // Leading = + - @ make Sheets evaluate a cell as a formula. Ingredient text is untrusted
      // input from a web page, so it is quoted rather than parsed.
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
      return v === undefined || v === null ? '' : v;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, columns.length).setValues(values);
  SpreadsheetApp.flush();
  return json({ ok: true, wrote: values.length, tab: tabName });
}

function unquote(v) {
  return String(v == null ? '' : v).replace(/^'/, '');
}

function sheetFor(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  // A default/new or older diagnostics sheet may have only 26 columns. The outcome/feedback
  // migration writes rowId in column 27; expand before either header or migration range writes.
  var maxColumns = sheet.getMaxColumns();
  if (maxColumns < columns.length) sheet.insertColumnsAfter(maxColumns, columns.length - maxColumns);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  lastReply = obj;
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Purchase history schema: generated from src/engine/db/purchase-history.js.
// Private purchase snapshots; intentionally outside settings backup and shared product caches.
(function(root) {
  const MAX = 10000;
  function cleanInput(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.ingredients_text !== 'string' || !raw.ingredients_text.trim()) return null;
    const out = {};
    if (raw.inputSchema === 1) out.inputSchema = 1;
    // A bounded snapshot of every field the scorer reads, not a live registry reference.
    const evidence = raw.provenanceRecord;
    const plain = v => typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, 500) : '';
    if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
      out.provenanceRecord = { certifications: plain(evidence.certifications), source: plain(evidence.source).slice(0, 120) };
      if (evidence.producerRegistry && typeof evidence.producerRegistry === 'object') {
        out.provenanceRecord.producerRegistry = { certifications: plain(evidence.producerRegistry.certifications) };
      }
    }
    for (const [key, limit] of Object.entries({ name: 250, ingredients_text: 6000, advisory_text: 6000, labels: 3000, certifications: 500 })) {
      if (typeof raw[key] === 'string') out[key] = raw[key].replace(/[<>]/g, '').slice(0, limit);
    }
    if (raw.nutrition && typeof raw.nutrition === 'object' && !Array.isArray(raw.nutrition)) {
      out.nutrition = {};
      for (const key of ['sodium', 'saturatedFat', 'transFat', 'sugar', 'addedSugar', 'fibre', 'protein', 'calories', 'fat', 'carbs', 'servingGrams', 'servingMl']) if (Number.isFinite(raw.nutrition[key]) && raw.nutrition[key] >= 0 && raw.nutrition[key] <= 1e9) out.nutrition[key] = raw.nutrition[key];
      if (typeof raw.nutrition.servingSize === 'string') out.nutrition.servingSize = raw.nutrition.servingSize.slice(0, 80);
    }
    return out;
  }
  function cleanBreakdown(raw, score) {
    if (!Number.isFinite(score) || !raw || !Number.isFinite(raw.base) || raw.base < 0 || raw.base > 200 || !Array.isArray(raw.rows) || raw.rows.length > 80) return null;
    const rows = [];
    for (const row of raw.rows) {
      if (!row || typeof row.why !== 'string' || !row.why.trim() || !Number.isFinite(row.c) || Math.abs(row.c) > 200) return null;
      rows.push({ why: row.why.replace(/[<>]/g, '').slice(0, 160), c: row.c, kind: ['limit', 'adjustment'].includes(row.kind) ? row.kind : 'factor' });
    }
    const out = { base: raw.base, rows };
    return Math.abs(raw.base + rows.reduce((sum, r) => sum + r.c, 0) - score) < 0.001 && JSON.stringify(out).length <= 12000 ? out : null;
  }
  function fromResult(result) {
    if (!result) return null;
    return cleanBreakdown({ base: result.base, rows: [...(result.good || []), ...(result.bad || [])].filter(r => Number.isFinite(r.c) && r.c !== 0).map(r => ({ why: r.why, c: r.c, kind: r.cap ? 'limit' : /^Score floor/.test(r.why) ? 'adjustment' : 'factor' })) }, result.score);
  }
  function clean(raw) {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw.key || '') || raw.store !== 'amazon.com' || !/^[A-Z0-9]{10}$/.test(raw.asin || '') || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') || !Number.isFinite(Date.parse(raw.date)) || new Date(raw.date).toISOString().slice(0, 10) !== raw.date || !['purchased', 'cancelled', 'returned', 'unknown'].includes(raw.state)) return null;
    const score = Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 100 ? Math.round(raw.score) : null;
    const breakdown = cleanBreakdown(raw.breakdown, score);
    const plain = (v, n) => typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, n) : '';
    return { key: raw.key, store: 'amazon.com', asin: raw.asin, date: raw.date, state: raw.state,
      name: plain(raw.name, 250), ...(typeof raw.source === 'string' ? { source: plain(raw.source, 60) } : {}), ...(typeof raw.rulesRevision === 'string' ? { rulesRevision: plain(raw.rulesRevision, 60) } : {}), ...(breakdown ? { breakdown } : {}), ...( /^[a-f0-9]{64}$/.test(raw.orderKey || '') ? { orderKey: raw.orderKey } : {}), ...(cleanInput(raw.input) ? { input: cleanInput(raw.input) } : {}), score, profile: /^[a-f0-9]{64}$/.test(raw.profile || '') ? raw.profile : '',
      version: plain(raw.version, 30), ingredients: plain(raw.ingredients, 2000),
      flags: Array.isArray(raw.flags) ? raw.flags.filter(x => typeof x === 'string').slice(0, 20).map(x => plain(x, 200)) : [],
      observedAt: Number.isFinite(raw.observedAt) ? Math.max(0, Math.min(Date.now() + 300000, raw.observedAt)) : 0,
      scoredAt: score !== null && Number.isFinite(raw.scoredAt) ? Math.max(0, Math.min(Date.now() + 300000, raw.scoredAt)) : 0 };
  }
  function merge(old, incoming) {
    const map = new Map();
    for (const raw of [...(Array.isArray(old) ? old : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      const r = clean(raw); if (!r) continue;
      const was = map.get(r.key);
      if (!was) { if (map.size >= MAX) throw new Error('history-full'); map.set(r.key, r); continue; }
      if (was.asin !== r.asin || was.date !== r.date || (was.orderKey && r.orderKey && was.orderKey !== r.orderKey)) throw new Error('invalid-history-identity');
      const latest = r.observedAt > was.observedAt ? r : was;
      const terminal = [was, r].filter(x => ['cancelled', 'returned'].includes(x.state)).sort((a, b) => b.observedAt - a.observedAt)[0];
      // Preserve the first usable score, even after preferences or rules change.
      const snapshot = was.score !== null && (r.score === null || was.scoredAt <= r.scoredAt) ? was : r;
      map.set(r.key, { ...latest, state: terminal?.state || latest.state, score: snapshot.score, profile: snapshot.profile, version: snapshot.version,
        source: snapshot.source, rulesRevision: snapshot.rulesRevision, ingredients: snapshot.ingredients, flags: snapshot.flags, scoredAt: snapshot.scoredAt,
        ...((was.orderKey || r.orderKey) ? { orderKey: was.orderKey || r.orderKey } : {}),
        breakdown: snapshot.breakdown || ((was.scoredAt === r.scoredAt && was.score === r.score && was.profile === r.profile && was.version === r.version && was.ingredients === r.ingredients) ? was.breakdown || r.breakdown : undefined),
        input: snapshot.input || ((was.scoredAt === r.scoredAt && was.score === r.score && was.profile === r.profile && was.version === r.version && was.ingredients === r.ingredients) ? was.input || r.input : undefined) });
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  }
  function trends(records) {
    const groups = new Map();
    for (const r of merge([], records).filter(r => r.state === 'purchased')) {
      const key = [r.date.slice(0, 7), r.version, r.profile].join(':');
      const g = groups.get(key) || { month: r.date.slice(0, 7), version: r.version, profile: r.profile, total: 0, rated: 0, sum: 0, flagged: 0 };
      g.total++; if (r.score !== null) { g.rated++; g.sum += r.score; } if (r.flags.length) g.flagged++;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month)).map(g => ({ ...g, average: g.rated ? Math.round(g.sum / g.rated) : null }));
  }
  const value = { MAX, clean, cleanInput, cleanBreakdown, fromResult, merge, trends };
  root.AIR = root.AIR || {}; root.AIR.db = root.AIR.db || {}; root.AIR.db.purchaseHistory = value;
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
})(typeof globalThis !== 'undefined' ? globalThis : self);
