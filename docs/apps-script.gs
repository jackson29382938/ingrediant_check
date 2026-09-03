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
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.kind === 'diagnostics') return writeRows('diagnostics', DIAGNOSTIC_COLUMNS, body.rows || []);
    if (body.kind === 'report')      return writeRows('reports', CONTRIBUTION_COLUMNS, [stamp(body)]);
    return writeRows('contributions', CONTRIBUTION_COLUMNS, [stamp(body)]);
  } catch (err) {
    return json({ ok: false, error: String(err) });
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

function writeRows(tabName, columns, rows) {
  if (!rows.length) return json({ ok: true, wrote: 0 });
  var sheet = sheetFor(tabName, columns);
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
