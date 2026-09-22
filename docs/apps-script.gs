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
 * Five kinds of payload arrive here:
 *   diagnostics — one row per scored product, for accuracy analysis (tab: diagnostics)
 *   report      — a "Looks wrong?" click (tab: reports)
 *   settings    — upsert of the extension's scoring export (tab: settings, one payload row)
 *   ratings     — shared score cache upserts and pull counts (tab: ratings_cache; docs/CACHE.md)
 *   (anything else) — a contribution to the shared provenance database (tab: contributions)
 *
 * GET ?kind=settings returns that payload so another browser can restore it. Every other GET is a
 * liveness check. Provenance rows are still read from the sheet's CSV/gviz URL, not from here.
 *
 * The web app is public by URL. Diagnostics, reports, and contributions only append. Settings
 * replaces the current payload row. Ratings replace a row only with a newer scan. Treat the URL as a secret: anyone holding it can write rows.
 */

var DIAGNOSTIC_COLUMNS = ["ts","version","store","asin","upc","brand","product_name","source","via","confidence","gate","coverage","parsed","score","verdict","nova","base","cap","penalties","bonuses","flags","provenance","weights","ingredients"];

var CONTRIBUTION_COLUMNS = [
  'ts', 'asin', 'upc', 'brand', 'product_name', 'kind',
  'certifications', 'feed', 'origin', 'verified_by', 'notes'
];

var SETTINGS_COLUMNS = ['key', 'value', 'ts'];
var SETTINGS_MAX_CHARS = 100000;

// Mirrors src/engine/db/ratings-cache.js. Keep COLUMNS and the cleanRating rules in step.
var RATINGS_COLUMNS = ['key', 'store', 'asin', 'score', 'verdict', 'prefs', 'source', 'nova', 'name', 'scanned_at', 'pulls'];
var RATINGS_MAX = 300;

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
    if (body.kind === 'ratings') return writeRatings(body);
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
    accepts: ['diagnostics', 'report', 'contribution', 'settings', 'ratings']
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

// One row per store:asin:prefs. An upsert replaces a row only when its scan is newer, and resets
// pulls. A pull counts only against the scan the reader actually saw (scanned_at must match).
// ponytail: rewrites the whole tab per batch; fine to the extension's 8000-row read cap.
function writeRatings(body) {
  var upserts = Array.isArray(body.upserts) ? body.upserts : [];
  var pulls = Array.isArray(body.pulls) ? body.pulls : [];
  if (upserts.length + pulls.length > RATINGS_MAX) throw new Error('invalid ratings batch');
  var sheet = sheetFor('ratings_cache', RATINGS_COLUMNS);
  var count = Math.max(0, sheet.getLastRow() - 1);
  var values = count ? sheet.getRange(2, 1, count, RATINGS_COLUMNS.length).getValues() : [];
  var at = {};
  values.forEach(function (r, i) { at['k' + unquote(r[0])] = i; });
  var upserted = 0, pulled = 0;
  upserts.forEach(function (raw) {
    var row = cleanRating(raw);
    if (!row) return;
    var cells = RATINGS_COLUMNS.map(function (c) { return row[c]; });
    var i = at['k' + row.key];
    if (i === undefined) {
      at['k' + row.key] = values.length;
      values.push(cells);
    } else if (!(Date.parse(unquote(values[i][9])) >= Date.parse(row.scanned_at))) {
      values[i] = cells;
    } else {
      return;
    }
    upserted++;
  });
  pulls.forEach(function (p) {
    var i = p && at['k' + String(p.key)];
    var t = p && Date.parse(p.scanned_at);
    if (i === undefined || !isFinite(t) || unquote(values[i][9]) !== new Date(t).toISOString()) return;
    values[i][10] = (Number(values[i][10]) || 0) + Math.min(100, Math.max(1, Math.floor(Number(p.n) || 1)));
    pulled++;
  });
  if (upserted || pulled) {
    // A leading ' keeps text as text: ISO dates and all-digit ASINs would otherwise be converted,
    // and =+-@ would be evaluated as formulas.
    sheet.getRange(2, 1, values.length, RATINGS_COLUMNS.length).setValues(values.map(function (r) {
      return r.map(function (v) { return typeof v === 'string' && v !== '' ? "'" + unquote(v) : v; });
    }));
  }
  SpreadsheetApp.flush();
  return json({ ok: true, wrote: 1, tab: 'ratings_cache', upserted: upserted, pulled: pulled });
}

function cleanRating(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var store = unquote(raw.store).toLowerCase().replace(/^www\./, '');
  var asin = unquote(raw.asin).toUpperCase();
  var prefs = unquote(raw.prefs);
  var source = unquote(raw.source);
  var verdict = unquote(raw.verdict);
  var score = Math.round(Number(raw.score));
  var nova = raw.nova === '' || raw.nova == null ? '' : Number(raw.nova);
  var t = Date.parse(unquote(raw.scanned_at));
  if (store.length > 40 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(store)) return null;
  if (!/^[A-Z0-9]{10}$/.test(asin) || !/^p[0-9a-f]{1,8}$/.test(prefs)) return null;
  if (!/^[a-z0-9_:-]{1,40}$/i.test(source) || source === 'manual-paste' || source === 'food-override') return null;
  if (!(score >= 0 && score <= 100)) return null;
  if (nova !== '' && !(nova === 1 || nova === 2 || nova === 3 || nova === 4)) return null;
  if (!isFinite(t) || t > Date.now() + 5 * 60 * 1000) return null;
  return {
    key: store + ':' + asin + ':' + prefs, store: store, asin: asin, score: score,
    verdict: /^[A-Za-z ]{1,20}$/.test(verdict) ? verdict : '',
    prefs: prefs, source: source, nova: nova,
    name: unquote(raw.name).replace(/\s+/g, ' ').trim().slice(0, 80),
    scanned_at: new Date(t).toISOString(), pulls: 0
  };
}

function unquote(v) {
  return String(v == null ? '' : v).replace(/^'/, '');
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
