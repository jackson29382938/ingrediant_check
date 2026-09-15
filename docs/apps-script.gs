/**
 * Ingredient Check — receiving endpoint.
 *
 * Deploy this as a Google Apps Script Web App bound to a spreadsheet, then paste the /exec URL
 * into the extension's settings under "Shared provenance database".
 *
 * Setup:
 *   1. Create a Google Sheet. Extensions > Apps Script.
 *   2. Paste this file over Code.gs and Save.
 *   3. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the /exec URL.
 *   4. Extension settings > Shared provenance database > "Where to send contributions".
 *   5. Tick "Send scoring diagnostics to my endpoint".
 *
 * Three kinds of payload arrive here, each on its own tab:
 *   diagnostics — one row per scored product, for accuracy analysis
 *   report      — a "Looks wrong?" click
 *   (anything else) — a contribution to the shared provenance database
 *
 * The web app is public by URL. It only ever appends; it never reads anything back out. Treat the
 * URL as a secret anyway, because anyone holding it can write rows to your sheet.
 */

var DIAGNOSTIC_COLUMNS = ["ts","version","store","asin","upc","brand","product_name","source","via","confidence","gate","coverage","parsed","score","verdict","nova","base","cap","penalties","bonuses","flags","provenance","weights","ingredients"];

var CONTRIBUTION_COLUMNS = [
  'ts', 'asin', 'upc', 'brand', 'product_name', 'kind',
  'certifications', 'feed', 'origin', 'verified_by', 'notes'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(15000);
    if (!acquired) return json({ ok: false, error: 'busy; retry later' });
    var body = JSON.parse(e.postData.contents);
    if (body.kind === 'diagnostics') return writeDiagnostics(body.rows || [], body.batchId);
    if (body.kind === 'report') return writeRows('reports', CONTRIBUTION_COLUMNS, [stamp(body)]);
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

// The extension never reads from this endpoint. Answering GET keeps a browser visit from looking
// like an outage while you are setting it up.
function doGet() {
  return json({ ok: true, service: 'ingredient-check', accepts: ['diagnostics', 'report', 'contribution'] });
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
