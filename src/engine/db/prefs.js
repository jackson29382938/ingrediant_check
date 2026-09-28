// Settings sanitizer.
//
// chrome.storage.local is untyped: a hand-edited import, a partial write, or a leftover key from
// an older build can put anything in. Scoring and the options page both read those keys, so one
// function heals them before anything else trusts them. Unknown ids are dropped, weights are
// clamped to the slider range. The online endpoint is a constant of the build, not a setting.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

const SETTINGS_FORMAT = 'ingredient-check-settings';
const SETTINGS_VERSION = 1;
const AVOID_MAX_LINES = 80;
const AVOID_MAX_LEN = 80;

// The Apps Script web app deployed from the shared (private) spreadsheet — docs/SETTINGS-SYNC.md.
// Every online feature goes through it; nothing reads the sheet directly, so the sheet itself stays
// private. Empty until the script is deployed: the extension then runs entirely on this computer.
// Never invent one. Mutable only so the tests can point it somewhere.
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbw4rTzddQVMtsqolUDse8Rfcv3eqXyL0qiS6ct6hHaQrMzTcff0p6JByc6Brvk-Lugd/exec';
// OAuth "Web application" client for the optional Google sign-in (docs/SETTINGS-SYNC.md). Empty
// hides the sign-in buttons. The same id goes into OAUTH_CLIENT_ID in apps-script.gs.
const OAUTH_CLIENT_ID = '';

const TOGGLE_DEFAULTS = {
  enabled: true,
  badges: true,
  foodOnly: true,
  // Numbers on every results tile out of the box: product pages are fetched from Amazon a few at a
  // time (at most 60 per page); scores saved on this computer, and shared readings when the reader
  // turned them on, answer the rest without a fetch.
  autoScoreSearch: false,
  hoverScore: false,
  // Hover or focus a score badge on a results page to see why it scored that way.
  hoverBreakdown: true,
  ocrLabels: false,
  useOpenFoodFacts: false,
  shareContributions: false,
  sendDiagnostics: false,
  // The shared online database: the owner-kept certification tables (provenance, producers). Off
  // keeps every lookup on this computer.
  sharedCache: false,
  // Product readings other people's computers uploaded to the shared database, and uploading this
  // computer's. Off until the reader turns it on: anyone who has the endpoint can write a product
  // row, and nothing yet shows that a row's ingredient text is true (docs/CACHE.md, "Trust"). A new
  // key rather than a change to sharedCache, so installs that saved sharedCache: true are off too.
  sharedProducts: false,
  // Price per ounce in the sorted list and "Price per ounce: Low to High" in Amazon's sort menu,
  // worked out on this computer from the results page (AIR.db.unitPrice). No extra requests.
  unitPrice: true,
  // Copy of the settings in the Chrome account (chrome.storage.sync). Never restored on its own.
  settingsBackup: true,
};

function db(name) {
  return (typeof AIR !== 'undefined' && AIR.db && AIR.db[name]) || null;
}

// Non-boolean display settings for the results-page breakdown.
const DISPLAY_DEFAULTS = { breakdownDetail: 'full', breakdownDelayMs: 200 };
const BREAKDOWN_DELAY_MAX = 1500;
function sanitizeDisplay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const delay = Number(src.breakdownDelayMs);
  return {
    breakdownDetail: src.breakdownDetail === 'compact' ? 'compact' : 'full',
    breakdownDelayMs: Number.isFinite(delay)
      ? Math.round(Math.min(BREAKDOWN_DELAY_MAX, Math.max(0, delay)) / 50) * 50
      : DISPLAY_DEFAULTS.breakdownDelayMs,
  };
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
    goals: cats && typeof cats.sanitizeGoals === 'function' ? cats.sanitizeGoals(src.goals) : [],
    allergens: uniqueKnown(src.allergens, allergenIds),
    diets: uniqueKnown(src.diets, dietIds),
    avoidList: sanitizeAvoidList(src.avoidList),
    foodOnly: asBool(src.foodOnly, true),
  };
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

// The endpoint the worker may call: the build constant, re-validated so a typo cannot send data
// anywhere but an Apps Script /exec URL.
function endpoint() {
  return toScriptUrl(_exports.ENDPOINT) || '';
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
    goals: clean.goals,
    allergens: clean.allergens,
    diets: clean.diets,
    avoidList: clean.avoidList,
    foodOnly: clean.foodOnly,
  };
}

// Backup of everything the user chose: the scoring export plus the toggles, minus the master
// switch (restoring a paused state from another computer would look like a broken install).
function backupPayload(raw, now) {
  const toggles = sanitizeToggles(raw);
  delete toggles.enabled;
  return { ...exportPayload(raw), ts: (now instanceof Date ? now : new Date()).toISOString(), toggles,
    display: sanitizeDisplay(raw) };
}

// Anything that claims to be a backup -> the storage values to write. Always re-sanitized.
function parseBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !looksLikeSettings(obj)) {
    return { ok: false, reason: 'no-backup' };
  }
  const toggles = sanitizeToggles(obj.toggles);
  delete toggles.enabled;
  const ts = Date.parse(obj.ts);
  return { ok: true, values: { ...sanitizeScoring(obj), ...toggles, ...sanitizeDisplay(obj.display) },
    ts: Number.isFinite(ts) ? ts : null };
}

// chrome.storage.sync caps an item at 8 KB, and a full avoid list is ~6.5 KB on its own.
const SYNC_KEYS = ['icBackup', 'icBackupAvoid'];
function toSyncItems(payload) {
  const { avoidList, ...rest } = payload;
  return { icBackup: rest, icBackupAvoid: avoidList || [] };
}
function fromSyncItems(items) {
  const main = items && items.icBackup;
  if (!main) return { ok: false, reason: 'no-backup' };
  return parseBackup({ ...main, avoidList: items.icBackupAvoid || [] });
}

function scoringEqual(a, b) {
  const left = sanitizeScoring(a);
  const right = sanitizeScoring(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

const _exports = AIRmodule('prefs', {
  SETTINGS_FORMAT, SETTINGS_VERSION, TOGGLE_DEFAULTS, DISPLAY_DEFAULTS, BREAKDOWN_DELAY_MAX, sanitizeDisplay,
  AVOID_MAX_LINES, AVOID_MAX_LEN, ENDPOINT, OAUTH_CLIENT_ID, SYNC_KEYS,
  sanitizeToggles, sanitizeScoring, sanitizeAvoidList, toScriptUrl, endpoint,
  parseImport, exportPayload, looksLikeSettings, scoringEqual,
  backupPayload, parseBackup, toSyncItems, fromSyncItems,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
