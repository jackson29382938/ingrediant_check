/**
 * Ingredient Check — receiving endpoint.
 *
 * Deploy this as a Google Apps Script Web App bound to a spreadsheet, then paste the /exec URL
 * into the extension's settings under "Shared provenance database".
 *
 * Setup (the shared sheet already exists; see docs/SETTINGS-SYNC.md):
 *   1. Open that spreadsheet, or create your own. Extensions > Apps Script.
 *   2. Paste this file over Code.gs and Save.
 *   3. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the /exec URL.
 *   4. Extension settings > Shared provenance database > "Where to send contributions".
 *   5. Tick "Send scoring diagnostics to my endpoint".
 *
 * Four kinds of payload arrive here:
 *   diagnostics — one row per scored product, for accuracy analysis (tab: diagnostics)
 *   report      — a "Looks wrong?" click (tab: reports)
 *   settings    — upsert of the extension's scoring export (tab: settings, one payload row)
 *   (anything else) — a contribution to the shared provenance database (tab: contributions)
 *
 * GET ?kind=settings returns that payload so another browser can restore it. Every other GET is a
 * liveness check. Provenance rows are still read from the sheet's CSV/gviz URL, not from here.
 *
 * The web app is public by URL. Diagnostics, reports, and contributions only append. Settings
 * replaces the current payload row. Treat the URL as a secret: anyone holding it can write rows.
 */

var DIAGNOSTIC_COLUMNS = ["ts","version","store","asin","upc","brand","product_name","source","via","confidence","gate","coverage","parsed","score","verdict","nova","base","cap","penalties","bonuses","flags","provenance","weights","ingredients"];

var CONTRIBUTION_COLUMNS = [
  'ts', 'asin', 'upc', 'brand', 'product_name', 'kind',
  'certifications', 'feed', 'origin', 'verified_by', 'notes'
];

var SETTINGS_COLUMNS = ['key', 'value', 'ts'];
var SETTINGS_MAX_CHARS = 100000;

function doPost(e) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(15000);
    if (!acquired) return json({ ok: false, error: 'busy; retry later' });
    var body = JSON.parse(e.postData.contents);
    if (body.kind === 'diagnostics') return writeDiagnostics(body.rows || [], body.batchId);
    if (body.kind === 'report') return writeRows('reports', CONTRIBUTION_COLUMNS, [stamp(body)]);
    if (body.kind === 'settings') return upsertSettings(body);
    return writeRows('contributions', CONTRIBUTION_COLUMNS, [stamp(body)]);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    if (acquired) lock.releaseLock();
  }
}

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

// A browser visit with no query is a liveness check. ?kind=settings returns the latest export so
// the extension can restore it without OAuth. Everything else is still write-only.
function doGet(e) {
  var kind = e && e.parameter && e.parameter.kind;
  if (kind === 'settings') {
    try {
      var stored = readSettings();
      if (!stored) return json({ ok: true, kind: 'settings', payload: null });
      return json({ ok: true, kind: 'settings', payload: stored.payload, ts: stored.ts });
    } catch (err) {
      return json({ ok: false, error: String(err) });
    }
  }
  return json({
    ok: true,
    service: 'ingredient-check',
    accepts: ['diagnostics', 'report', 'contribution', 'settings']
  });
}

// One current scoring export. Later saves replace the payload row instead of appending history.
function upsertSettings(body) {
  var payload = body && body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid settings payload');
  if (payload._format && payload._format !== 'ingredient-check-settings') throw new Error('unknown settings format');
  var text = JSON.stringify(payload);
  if (text.length > SETTINGS_MAX_CHARS) throw new Error('settings payload too large');
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  var ts = (typeof body.ts === 'string' && body.ts.length > 0 && body.ts.length <= 40)
    ? body.ts : new Date().toISOString();
  var sheet = sheetFor('settings', SETTINGS_COLUMNS);
  var count = Math.max(0, sheet.getLastRow() - 1);
  var keys = count ? sheet.getRange(2, 1, count, 1).getValues() : [];
  var rowIndex = -1;
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === 'payload') rowIndex = i + 2;
  }
  var row = ['payload', text, ts];
  if (rowIndex === -1) sheet.appendRow(row);
  else sheet.getRange(rowIndex, 1, 1, SETTINGS_COLUMNS.length).setValues([row]);
  SpreadsheetApp.flush();
  return json({ ok: true, wrote: 1, tab: 'settings', updated: rowIndex !== -1 });
}

function readSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('settings');
  if (!sheet || sheet.getLastRow() < 2) return null;
  var count = sheet.getLastRow() - 1;
  var values = sheet.getRange(2, 1, count, SETTINGS_COLUMNS.length).getValues();
  var payloadText = '';
  var ts = '';
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) !== 'payload') continue;
    payloadText = String(values[i][1] == null ? '' : values[i][1]);
    ts = values[i][2] ? String(values[i][2]) : '';
  }
  if (payloadText.charAt(0) === "'") payloadText = payloadText.slice(1);
  if (!payloadText) return null;
  return { payload: JSON.parse(payloadText), ts: ts };
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
