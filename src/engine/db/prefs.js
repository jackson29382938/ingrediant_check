// Settings sanitizer.
//
// chrome.storage.local is untyped: a hand-edited import, a partial write, or a leftover key from
// an older build can put anything in. Scoring and the options page both read those keys, so one
// function heals them before anything else trusts them. Unknown ids are dropped, weights are
// clamped to the slider range, and URLs that are not Google Sheets / Apps Script are rejected.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

const SETTINGS_FORMAT = 'ingredient-check-settings';
const SETTINGS_VERSION = 1;
const AVOID_MAX_LINES = 80;
const AVOID_MAX_LEN = 80;

// Shared sheet owned by the extension author. New installs and a missing sheetUrl use this.
// contributeUrl stays empty until someone deploys docs/apps-script.gs and pastes the /exec URL.
const DEFAULT_SHEET_ID = '1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y';
const DEFAULT_SHEET_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/edit`;
const SETTINGS_TAB = 'settings';
const SETTINGS_SAVE_KIND = 'settings';

const TOGGLE_DEFAULTS = {
  enabled: true,
  badges: true,
  foodOnly: true,
  autoScoreSearch: false,
  hoverScore: false,
  ocrLabels: false,
  useOpenFoodFacts: false,
  shareContributions: false,
  sendDiagnostics: false,
};

function db(name) {
  return (typeof AIR !== 'undefined' && AIR.db && AIR.db[name]) || null;
}

function asBool(value, fallback) {
  if (value === true || value === false) return value;
  return fallback;
}

function sanitizeToggles(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, fallback] of Object.entries(TOGGLE_DEFAULTS)) {
    out[key] = asBool(src[key], fallback);
  }
  return out;
}

function uniqueKnown(list, allowed) {
  if (!Array.isArray(list) || !allowed || !allowed.size) return [];
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || !allowed.has(raw) || out.includes(raw)) continue;
    out.push(raw);
  }
  return out;
}

function sanitizeAvoidList(list) {
  if (typeof list === 'string') list = list.split(/\r?\n/);
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const term = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, AVOID_MAX_LEN);
    if (term.length < 2) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= AVOID_MAX_LINES) break;
  }
  return out;
}

function sanitizeScoring(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cats = db('categories');
  const allergens = db('allergens');
  const weights = cats && typeof cats.resolveWeights === 'function'
    ? cats.resolveWeights(src.weights)
    : {};
  const allergenIds = new Set((allergens && allergens.ALLERGENS || []).map(a => a.id));
  const dietIds = new Set((allergens && allergens.DIETS || []).map(d => d.id));
  return {
    weights,
    allergens: uniqueKnown(src.allergens, allergenIds),
    diets: uniqueKnown(src.diets, dietIds),
    avoidList: sanitizeAvoidList(src.avoidList),
    foodOnly: asBool(src.foodOnly, true),
  };
}

// Published-sheet URLs come in several shapes. Normalise whatever the user pasted into a CSV export.
function toSheetUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password) return null;
  const match = url.pathname.match(/^\/spreadsheets\/d\/(e\/)?([A-Za-z0-9_-]{20,})(?:\/|$)/);
  if (!match) return null;
  const [, published, id] = match;
  const gid = url.searchParams.get('gid') || new URLSearchParams(url.hash.slice(1)).get('gid');
  const tab = gid && /^\d+$/.test(gid) ? `&gid=${gid}` : '';
  return published
    ? `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=csv${tab}`
    : `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${tab}`;
}

// Apps Script web apps are the only write endpoint the extension will call.
function toScriptUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.hostname !== 'script.google.com' && url.hostname !== 'script.googleusercontent.com') return null;
  const match = url.pathname.match(/^\/macros\/s\/([A-Za-z0-9_-]{20,})\/exec\/?$/);
  if (!match) return null;
  return `https://script.google.com/macros/s/${match[1]}/exec`;
}

function sanitizeUrl(raw, kind) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.length > 500) return '';
  if (kind === 'script') return toScriptUrl(text) || '';
  return toSheetUrl(text) ? text : '';
}

// A missing sheetUrl is the shared default. An explicit empty string is the offline opt-out.
function resolveSheetUrl(storedOrUrl) {
  if (typeof storedOrUrl === 'string') return sanitizeUrl(storedOrUrl, 'sheet');
  const src = storedOrUrl && typeof storedOrUrl === 'object' ? storedOrUrl : {};
  if (!Object.prototype.hasOwnProperty.call(src, 'sheetUrl') || src.sheetUrl == null) return DEFAULT_SHEET_URL;
  return sanitizeUrl(src.sheetUrl, 'sheet');
}

function sanitizeUrls(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    sheetUrl: resolveSheetUrl(src),
    producersUrl: sanitizeUrl(src.producersUrl, 'sheet'),
    contributeUrl: sanitizeUrl(src.contributeUrl, 'script'),
  };
}

// gviz/pub CSV for a named tab. Provenance reads stay on toSheetUrl (first tab or gid).
function toSettingsSheetUrl(raw) {
  return toTabSheetUrl(raw, SETTINGS_TAB);
}

function toTabSheetUrl(raw, tab) {
  const sheetUrl = raw == null ? DEFAULT_SHEET_URL
    : (typeof raw === 'object' ? resolveSheetUrl(raw) : raw);
  const base = toSheetUrl(sheetUrl);
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.delete('gid');
  url.searchParams.set('sheet', tab);
  return url.toString();
}

// Minimal RFC-4180 parser. Sheet cells routinely contain commas, so a split would shred them.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function settingsPayloadCell(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return '';
  const head = rows[0].map(h => String(h || '').trim().toLowerCase());
  const keyCol = head.indexOf('key');
  const valueCol = head.indexOf('value');
  if (keyCol < 0 || valueCol < 0) return '';
  let found = '';
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][keyCol] || '').trim() !== 'payload') continue;
    let cell = String(rows[i][valueCol] || '').trim();
    if (cell.startsWith("'")) cell = cell.slice(1);
    if (cell) found = cell;
  }
  return found;
}

function parseSettingsRows(rows) {
  const raw = settingsPayloadCell(rows);
  if (!raw) return { ok: false, reason: 'no-settings' };
  return parseImport(raw);
}

// Accept a settings-tab CSV, an Apps Script GET body, or an export object. Always sanitize.
function parseSettingsExport(input) {
  if (typeof input === 'string') {
    const trimmed = input.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return { ok: false, reason: 'no-settings' };
    if (trimmed[0] === '<' || /accounts\.google\.com|ServiceLogin/i.test(trimmed.slice(0, 800))) {
      return { ok: false, reason: 'sheet-private' };
    }
    if (trimmed[0] === '{' || trimmed[0] === '[') return parseImport(trimmed);
    return parseSettingsRows(parseCsv(trimmed));
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)) {
      return parseImport(JSON.stringify(input.payload));
    }
    if (looksLikeSettings(input)) return parseImport(JSON.stringify(input));
  }
  return { ok: false, reason: 'no-settings' };
}

// The only settings body the extension posts. Built from exportPayload, never raw storage.
function settingsSaveBody(prefs, now) {
  const payload = exportPayload(prefs);
  const clock = now instanceof Date ? now : new Date();
  return { kind: SETTINGS_SAVE_KIND, ts: clock.toISOString(), payload };
}

function looksLikeSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj._format === SETTINGS_FORMAT) return true;
  return !!(obj.weights && typeof obj.weights === 'object' && !Array.isArray(obj.weights))
    || Array.isArray(obj.allergens) || Array.isArray(obj.diets) || Array.isArray(obj.avoidList);
}

function parseImport(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, reason: 'not-json' }; }
  if (!looksLikeSettings(parsed)) return { ok: false, reason: 'not-settings' };
  return { ok: true, prefs: sanitizeScoring(parsed) };
}

function exportPayload(prefs) {
  const clean = sanitizeScoring(prefs);
  return {
    _format: SETTINGS_FORMAT,
    _version: SETTINGS_VERSION,
    weights: clean.weights,
    allergens: clean.allergens,
    diets: clean.diets,
    avoidList: clean.avoidList,
    foodOnly: clean.foodOnly,
  };
}

function scoringEqual(a, b) {
  const left = sanitizeScoring(a);
  const right = sanitizeScoring(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

const _exports = AIRmodule('prefs', {
  SETTINGS_FORMAT, SETTINGS_VERSION, TOGGLE_DEFAULTS,
  AVOID_MAX_LINES, AVOID_MAX_LEN,
  DEFAULT_SHEET_ID, DEFAULT_SHEET_URL, SETTINGS_TAB, SETTINGS_SAVE_KIND,
  sanitizeToggles, sanitizeScoring, sanitizeAvoidList, sanitizeUrls, resolveSheetUrl,
  toSheetUrl, toScriptUrl, toSettingsSheetUrl, toTabSheetUrl, parseCsv,
  parseSettingsRows, parseSettingsExport, settingsSaveBody,
  parseImport, exportPayload, looksLikeSettings, scoringEqual,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
