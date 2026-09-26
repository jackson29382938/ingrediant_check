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
 *   diagnostics — one row per scored product, for accuracy analysis (tab: diagnostics)
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
var OAUTH_CLIENT_ID = '';

var DIAGNOSTIC_COLUMNS = ["ts","version","store","asin","upc","brand","product_name","source","via","confidence","gate","coverage","parsed","score","verdict","nova","base","cap","penalties","bonuses","flags","provenance","weights","ingredients"];

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

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, error: 'invalid json' }); }
  // Reads take no lock: they must not queue behind a batch write.
  try {
    if (body.kind === 'lookup') return lookupProducts(body.keys);
    if (body.kind === 'accountGet') return readAccount(body.token);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(15000);
    if (!acquired) return json({ ok: false, error: 'busy; retry later' });
    if (body.kind === 'diagnostics') return writeDiagnostics(body.rows || [], body.batchId);
    if (body.kind === 'report') return writeRows('reports', CONTRIBUTION_COLUMNS, [stamp(body)]);
    if (body.kind === 'products') return writeProducts(body);
    if (body.kind === 'account') return writeAccount(body.token, body.payload);
    return writeRows('contributions', CONTRIBUTION_COLUMNS, [stamp(body)]);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function doGet(e) {
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
  return json({ ok: true, service: 'ingredient-check',
    accepts: ['lookup', 'products', 'diagnostics', 'report', 'account', 'accountGet', 'contribution'] });
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
  if (!OAUTH_CLIENT_ID) throw new Error('accounts are not configured');
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new Error('no token');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('token rejected');
  var info = JSON.parse(res.getContentText());
  // A token issued to some other app must not open this user's row.
  if ((info.aud !== OAUTH_CLIENT_ID && info.azp !== OAUTH_CLIENT_ID) || !info.sub) throw new Error('token rejected');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'ingredient-check:' + info.sub);
  return digest.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function findAccountRow(sheet, id) {
  var count = Math.max(0, sheet.getLastRow() - 1);
  var ids = count ? sheet.getRange(2, 1, count, 1).getValues() : [];
  for (var i = 0; i < ids.length; i++) if (unquote(ids[i][0]) === id) return i + 2;
  return -1;
}

function writeAccount(token, payload) {
  var id = accountId(token);
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

function readAccount(token) {
  var id = accountId(token);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('accounts');
  var at = sheet ? findAccountRow(sheet, id) : -1;
  if (at === -1) return json({ ok: true, payload: null });
  var r = sheet.getRange(at, 1, 1, ACCOUNT_COLUMNS.length).getValues()[0];
  return json({ ok: true, payload: JSON.parse(unquote(r[1])), ts: unquote(r[2]) });
}

// ---------------------------------------------------------------- diagnostics, reports, contributions

// Store each ID in the SAME range write as its data. A lost response can then be retried without
// a separate PropertiesService commit, a rolling history window, or its per-value size limit.
// doPost holds the script lock across both the duplicate check and the append.
function writeDiagnostics(rows, batchId) {
  if (!Array.isArray(rows) || rows.length > 300) throw new Error('invalid diagnostic batch');
  if (!rows.length) return json({ ok: true, wrote: 0, inserted: 0 });
  var legacy = loadSeen();
  if (batchId && legacy.batches.indexOf(String(batchId)) !== -1) {
    return json({ ok: true, wrote: rows.length, inserted: 0, duplicate: true });
  }
  var columns = DIAGNOSTIC_COLUMNS.concat(['rowId']);
  var sheet = sheetFor('diagnostics', columns);
  // Upgrade existing 24-column sheets without touching their original data.
  sheet.getRange(1, columns.length).setValue('rowId');
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
  return json({ ok: true, wrote: rows.length, inserted: fresh.length, duplicate: fresh.length === 0 });
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
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
