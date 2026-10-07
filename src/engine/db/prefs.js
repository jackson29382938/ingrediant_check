// Settings sanitizer.
//
// chrome.storage.local is untyped: a hand-edited import, a partial write, or a leftover key from
// an older build can put anything in. Scoring and the options page both read those keys, so one
// function heals them before anything else trusts them. Unknown ids are dropped, weights are
// clamped to the slider range. The online endpoint is a constant of the build, not a setting.

if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js');
  require('./sorted-results.js');
  require('./unit-price.js');
  require('./speed.js');
}

(function () {

const SETTINGS_FORMAT = 'ingredient-check-settings';
const SETTINGS_VERSION = 1;
const AVOID_MAX_LINES = 80;
const AVOID_MAX_LEN = 80;
// Shared suggestions only: never added to the reader's avoid list automatically.
const AVOID_HINTS = Object.freeze(['palm oil', 'natural flavors', 'carrageenan', 'red 40',
  'yellow 5', 'yellow 6', 'blue 1', 'sucralose', 'aspartame', 'canola oil',
  'high fructose corn syrup', 'titanium dioxide', 'msg', 'BHT', 'BHA', 'TBHQ', 'artificial flavors']);

// The Apps Script web app deployed from the shared (private) spreadsheet — docs/SETTINGS-SYNC.md.
// Every online feature goes through it; nothing reads the sheet directly, so the sheet itself stays
// private. Empty until the script is deployed: the extension then runs entirely on this computer.
// Never invent one. Mutable only so the tests can point it somewhere.
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbw4rTzddQVMtsqolUDse8Rfcv3eqXyL0qiS6ct6hHaQrMzTcff0p6JByc6Brvk-Lugd/exec';
// Public OAuth Web application client for optional Google sign-in. A local settings override
// can select another client. The backend owner must configure the same public ID in Apps Script.
// Client secrets must never be included in extension code.
const OAUTH_CLIENT_ID = '483888107675-hofgo4a3uh1g2khv4hja9ci8nhama6tk.apps.googleusercontent.com';
// Keep anonymous product exchange closed until deployment trust controls are verified.
const SHARED_PRODUCTS_ALLOWED = false;

const TOGGLE_DEFAULTS = {
  enabled: true,
  badges: true,
  foodOnly: true,
  // When enabled, product pages are fetched from Amazon a few at a
  // time (at most 60 per page); scores saved on this computer, and shared readings when the reader
  // turned them on, answer the rest without a fetch.
  autoScoreSearch: true,
  hoverScore: false,
  // Hover or focus a score badge on a results page to see why it scored that way.
  hoverBreakdown: true,
  ocrLabels: true,
  useOpenFoodFacts: true,
  shareContributions: false,
  sendDiagnostics: false,
  // Owner-kept certification tables are enabled by default. Switching this off
  // keeps certification lookups on this computer.
  sharedCache: true,
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
  // Product pages: open the score panel expanded instead of showing only its header.
  panelOpen: false,
  // The sorted list reopens with the priorities the reader last set for that menu option.
  sortRemember: true,
  // While signed in with Google, keep the Google copy up to date on every change. Only acts once
  // this computer has saved to or restored from that account, so a new computer cannot overwrite
  // the saved copy with its defaults.
  googleAutoSave: true,
  // Cart points: XP for good-scoring items in a cart (AIR.db.points). Off until the reader turns it on. The
  // points themselves are kept on this computer only (storage key `xp`) and are not part of a backup.
  pointsEnabled: false,
};

function db(name) {
  return (typeof AIR !== 'undefined' && AIR.db && AIR.db[name]) || null;
}

// How many settings the options page shows, from the fewest to all of them. Each control in
// options.html carries data-level="N", the first level (index into LEVELS) that shows it. Hiding is
// display only: a hidden setting keeps its value and keeps working.
const LEVELS = ['minimal', 'simple', 'standard', 'advanced', 'expert'];
const DEFAULT_LEVEL = 'standard';

// Non-boolean display settings: the results-page breakdown, the delay before Score on hover starts,
// and how much of the options page to show.
// Appearance (engine/db/theme.js): light/dark, the score palette, and one accent colour.
const THEMES = ['system', 'light', 'dark'];
const PALETTE_NAMES = ['standard', 'cvd'];
const DEFAULT_ACCENT = '#0f7b3f';
const DISPLAY_DEFAULTS = { breakdownDetail: 'full', breakdownDelayMs: 200, scoreHoverDelayMs: 600, settingsLevel: DEFAULT_LEVEL,
  theme: 'system', palette: 'standard', accent: DEFAULT_ACCENT };
const BREAKDOWN_DELAY_MAX = 1500;
const SCORE_HOVER_DELAY_MIN = 200;
const SCORE_HOVER_DELAY_MAX = 2000;
function stepped(value, min, max, step, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) / step) * step : fallback;
}
function sanitizeDisplay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    breakdownDetail: src.breakdownDetail === 'compact' ? 'compact' : 'full',
    breakdownDelayMs: stepped(src.breakdownDelayMs, 0, BREAKDOWN_DELAY_MAX, 50, DISPLAY_DEFAULTS.breakdownDelayMs),
    scoreHoverDelayMs: stepped(src.scoreHoverDelayMs, SCORE_HOVER_DELAY_MIN, SCORE_HOVER_DELAY_MAX, 100, DISPLAY_DEFAULTS.scoreHoverDelayMs),
    settingsLevel: LEVELS.includes(src.settingsLevel) ? src.settingsLevel : DEFAULT_LEVEL,
    theme: THEMES.includes(src.theme) ? src.theme : 'system',
    palette: PALETTE_NAMES.includes(src.palette) ? src.palette : 'standard',
    accent: typeof src.accent === 'string' && /^#[0-9a-f]{6}$/i.test(src.accent) ? src.accent.toLowerCase() : DEFAULT_ACCENT,
  };
}

// The level to show for stored settings. An install from before the setting existed saw everything,
// so with none stored (and setup already done) it keeps seeing everything.
function levelOf(stored) {
  const src = stored && typeof stored === 'object' ? stored : {};
  return LEVELS.includes(src.settingsLevel) ? src.settingsLevel : (src.onboarded === true ? 'expert' : DEFAULT_LEVEL);
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
  if (typeof list === 'string') list = list.split(/[,\r\n]+/);
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list.flatMap(item => typeof item === 'string' ? item.split(/[,\r\n]+/) : [item])) {
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
    goalImportance: cats && typeof cats.sanitizeGoalImportance === 'function' ? cats.sanitizeGoalImportance(src.goalImportance) : {},
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
  // `prefs` is the scoring part; `values` is everything the file holds, ready for chrome.storage.
  return { ok: true, prefs: sanitizeScoring(parsed), values: parseBackup(parsed).values };
}

function exportPayload(prefs) {
  const clean = sanitizeScoring(prefs);
  return {
    _format: SETTINGS_FORMAT,
    _version: SETTINGS_VERSION,
    weights: clean.weights,
    goals: clean.goals,
    goalImportance: clean.goalImportance,
    allergens: clean.allergens,
    diets: clean.diets,
    avoidList: clean.avoidList,
    foodOnly: clean.foodOnly,
  };
}

const WORKFLOW_KEYS = ['speedMode', 'ratePace', 'sortMissing', 'sortLoadMore', 'sortCount', 'sortTimeLimit', 'sortPriorities', 'unitMissing'];
function sanitizeWorkflow(raw) {
  return { ...db('speed').sanitizeSpeed(raw), ...db('speed').sanitizePace(raw), ...db('sortedResults').sanitizeSort(raw),
    ...db('sortedResults').sanitizePriorities(raw), ...db('unitPrice').sanitizeUnit(raw) };
}

function oauthClientId(raw) {
  const id = String(raw || '').trim();
  return /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id) ? id : '';
}

// Backup of everything the user chose: the scoring export plus the toggles, minus the master
// switch (restoring a paused state from another computer would look like a broken install).
function backupPayload(raw, now) {
  const toggles = sanitizeToggles(raw);
  delete toggles.enabled;
  return { ...exportPayload(raw), ts: (now instanceof Date ? now : new Date()).toISOString(), toggles,
    display: sanitizeDisplay(raw), workflow: sanitizeWorkflow(raw) };
}

// Anything that claims to be a backup -> the storage values to write. Always re-sanitized.
function parseBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !looksLikeSettings(obj)) {
    return { ok: false, reason: 'no-backup' };
  }
  const toggles = sanitizeToggles(obj.toggles);
  delete toggles.enabled;
  const ts = Date.parse(obj.ts);
  // A group the file does not have (an older backup, or a scoring-only export) leaves the stored
  // values alone instead of resetting them to defaults.
  const group = (raw, clean) => (raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(clean).filter(([key]) => key in raw)) : {});
  return { ok: true, values: { ...sanitizeScoring(obj), ...group(obj.toggles, toggles), ...group(obj.display, sanitizeDisplay(obj.display)),
    ...group(obj.workflow, sanitizeWorkflow(obj.workflow)) },
    ts: Number.isFinite(ts) ? ts : null };
}

// Switches that send data off this computer. A settings file never turns these on: a file is
// something a reader may have been handed, and each of these is a decision the reader makes on this
// computer (a Chrome or Google restore of the reader's own copy still carries them, after a confirm).
const SHARING_KEYS = ['sharedProducts', 'shareContributions', 'sendDiagnostics', 'googleAutoSave', 'settingsBackup'];

// The settings as a backup would carry them: one sanitized value per key, defaults filled in.
function settingsSnapshot(stored) { return parseBackup(backupPayload(stored)).values; }

// Which settings differ between this browser's stored settings and a saved copy's values (from
// parseBackup). A key the copy lacks counts as different. -> { total, differing: [key] }.
function diffSettings(stored, copyValues) {
  const stable = v => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const mine = settingsSnapshot(stored);
  const copy = copyValues && typeof copyValues === 'object' ? copyValues : {};
  const keys = Object.keys(mine);
  return { total: keys.length, differing: keys.filter(k => !(k in copy) || stable(copy[k]) !== stable(mine[k])) };
}

// Every key a settings file or backup can carry; the worker watches these to refresh its backup.
const SETTING_KEYS = [...new Set(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly',
  ...WORKFLOW_KEYS, ...Object.keys(TOGGLE_DEFAULTS), ...Object.keys(DISPLAY_DEFAULTS)])];

// Two banks keep the previous backup readable if staging a new one fails. Only the final
// icBackup pointer is committed after all its parts have been stored successfully.
const SYNC_PARTS = 4;
const SYNC_ITEM_BYTES = 7000;
const partKey = (bank, i, device = '') => `icBackupAvoid_${device ? device + '_' : ''}${bank}_${i}`;
const SYNC_KEYS = ['icBackup', 'icBackupAvoid',
  ...['a', 'b'].flatMap(bank => Array.from({ length: SYNC_PARTS }, (_, i) => partKey(bank, i)))];
// Detect parts arriving out of order from Chrome sync or another device. This checksum is
// an integrity marker, not authentication; all values still pass through the sanitizers.
const partHash = part => {
  let h = 2166136261;
  for (const char of JSON.stringify(part)) h = Math.imul(h ^ char.codePointAt(0), 16777619);
  return (h >>> 0).toString(16);
};
const utf8Bytes = value => {
  let n = 0;
  for (const char of value) {
    const cp = char.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
};
function toSyncItems(payload, bank = 'a', device = '') {
  if (device && !/^[a-f0-9]{32}$/.test(device)) throw new Error('invalid-backup-device');
  if (!['a', 'b'].includes(bank)) throw new Error('invalid-backup-bank');
  const { avoidList, ...rest } = payload;
  const parts = [[]];
  for (const term of sanitizeAvoidList(avoidList)) {
    let part = parts[parts.length - 1];
    const key = partKey(bank, parts.length - 1, device);
    if (utf8Bytes(key) + utf8Bytes(JSON.stringify([...part, term])) > SYNC_ITEM_BYTES) {
      parts.push([]);
      part = parts[parts.length - 1];
    }
    part.push(term);
  }
  if (parts.length > SYNC_PARTS) throw new Error('backup-too-large');
  const main = { ...rest, _syncVersion: device ? 3 : 2, _syncDevice: device, _syncBank: bank, _syncParts: parts.length, _syncHashes: parts.map(partHash) };
  if (utf8Bytes('icBackup') + utf8Bytes(JSON.stringify(main)) > SYNC_ITEM_BYTES) throw new Error('backup-too-large');
  return { ...Object.fromEntries(parts.map((part, i) => [partKey(bank, i, device), part])), icBackup: main };
}
function fromSyncItems(items) {
  const main = items && items.icBackup;
  if (!main) return { ok: false, reason: 'no-backup' };
  if (main._syncVersion == null) return parseBackup({ ...main, avoidList: items.icBackupAvoid || [] });
  if (![2, 3].includes(main._syncVersion) || (main._syncVersion === 3 && !/^[a-f0-9]{32}$/.test(main._syncDevice)) || !['a', 'b'].includes(main._syncBank)
    || !Number.isInteger(main._syncParts) || main._syncParts < 1 || main._syncParts > SYNC_PARTS) {
    return { ok: false, reason: 'invalid-backup' };
  }
  const parts = Array.from({ length: main._syncParts }, (_, i) => items[partKey(main._syncBank, i, main._syncVersion === 3 ? main._syncDevice : '')]);
  if (!Array.isArray(main._syncHashes) || main._syncHashes.length !== parts.length
    || parts.some((part, i) => !Array.isArray(part) || partHash(part) !== main._syncHashes[i])) return { ok: false, reason: 'incomplete-backup' };
  return parseBackup({ ...main, avoidList: parts.flat() });
}

// Read the pointer first, then its profile-specific parts. Retry a pointer change rather than
// combining old chunks with a new header. Sync storage is small; local product storage is not read.
async function readSync(area) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await area.get('icBackup');
    const main = head.icBackup;
    let keys = SYNC_KEYS.filter(k => k !== 'icBackup');
    if (main && main._syncVersion === 3 && /^[a-f0-9]{32}$/.test(main._syncDevice)
      && ['a', 'b'].includes(main._syncBank) && Number.isInteger(main._syncParts) && main._syncParts > 0 && main._syncParts <= SYNC_PARTS) {
      keys = Array.from({length:main._syncParts}, (_, i) => partKey(main._syncBank, i, main._syncDevice));
    }
    const parsed = fromSyncItems({ ...(await area.get(keys)), ...head });
    if (parsed.reason !== 'incomplete-backup') return parsed;
  }
  return {ok:false,reason:'incomplete-backup'};
}

function scoringEqual(a, b) {
  const left = sanitizeScoring(a);
  const right = sanitizeScoring(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

const _exports = AIRmodule('prefs', {
  SETTINGS_FORMAT, SETTINGS_VERSION, TOGGLE_DEFAULTS, DISPLAY_DEFAULTS, BREAKDOWN_DELAY_MAX, LEVELS, DEFAULT_LEVEL, levelOf,
  SCORE_HOVER_DELAY_MIN, SCORE_HOVER_DELAY_MAX, THEMES, PALETTE_NAMES, DEFAULT_ACCENT, sanitizeDisplay,
  AVOID_MAX_LINES, AVOID_MAX_LEN, AVOID_HINTS, ENDPOINT, OAUTH_CLIENT_ID, SHARED_PRODUCTS_ALLOWED, SYNC_KEYS,
  sanitizeToggles, sanitizeScoring, sanitizeAvoidList, toScriptUrl, endpoint,
  parseImport, exportPayload, looksLikeSettings, scoringEqual,
  backupPayload, parseBackup, SETTING_KEYS, SHARING_KEYS, settingsSnapshot, diffSettings, toSyncItems, fromSyncItems, readSync, WORKFLOW_KEYS, sanitizeWorkflow, oauthClientId,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
