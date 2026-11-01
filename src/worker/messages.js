// Message allowlist for the service worker.
// Loaded via importScripts from background.js (and by Node tests before that file).
// Unknown types are denied — register new sendMessage types here before shipping them.
// Function declarations (not const) so they land on the worker global for background.js + tests.
/* exported allowMessage */

var PAGE_MESSAGE_TYPES = new Set([
  'pageScore', 'ocrLabels', 'lookupBarcode', 'provenanceLookup',
  'contribute', 'report', 'diagnostic', 'productsLookup', 'productsQueue',
  // Amazon's sort menu (src/content/sort.js): open the side panel, send the list as it fills in, and
  // open it in a tab when Chrome would not open the panel. The list pages themselves send nothing:
  // they call chrome.tabs / chrome.sidePanel directly.
  'openSortedPanel', 'updateSortedResults', 'openSortedTab', 'followSortedSearch',
  // A line for "Report a problem"'s recent actions (engine/db/activity.js).
  'logAction',
  // The install-wide request budget for automatic rating and the cool-down after a robot check (background.js).
  'fetchBudget', 'fetchBlocked',
]);
// Sent only by the settings page (settings-database.js, loaded by options.html alone), so only the
// settings page may send them, with accountSave also allowed from onboarding:
// flushing POSTs queued diagnostic rows (a trace of scored products), refreshSheet fetches the
// shared database, and the account pair carries a Google token and overwrites local settings.
// The housekeeping alarm and a full diagnostics batch flush from inside the worker; neither is a
// message, so neither is affected. tests/sanity.test.js fails if another page starts sending one.
var SETTINGS_MESSAGE_TYPES = new Set([
  'flushDiagnostics', 'diagnosticsStatus', 'refreshSheet',
  'accountSave', 'accountLoad', 'accountFetch',
]);
var HISTORY_MESSAGE_TYPES = new Set(['purchaseScanStart', 'purchaseScanResume', 'purchaseScanPause', 'purchaseScanCancel', 'purchaseScanState', 'purchaseScanProgress', 'purchaseImport', 'purchaseOpenHistory', 'purchaseSync', 'purchaseConfigure', 'purchaseDelete']);
var OFFSCREEN_MESSAGE_TYPES = new Set(['ocrIdle']);
var AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|ca|com\.au|ie|in|sg|ae|sa|de|fr|es|it|nl|se|pl|com\.be|com\.tr|com\.mx|com\.br|co\.jp)$/i;
// Retailer previews perform their public same-origin reads in the content script.
// Their tabs may ask the worker only for toolbar badges; worker network paths stay Amazon-only.
var RETAILER_MESSAGE_TYPES = new Set(['pageScore']);
var RETAILER_HOST = /^(?:www\.)?(?:target\.com|walmart\.com|costco\.com|instacart\.com|kroger\.com|frysfood\.com|ralphs\.com|kingsoopers\.com|smithsfoodanddrug\.com|fredmeyer\.com|qfc\.com|harristeeter\.com|dillons\.com|safeway\.com|albertsons\.com)$/i;

// What a page's content script may hand the worker to forward to the shared endpoint. The sorted list and the
// product queue were already re-checked here (sanitizeResults, productCache.sanitize); the three free-form
// payloads were relayed as they came. A content script is our code, but what it puts in a payload is page text
// (a product title, an ingredient list), so the worker bounds it before it is stored or posted.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(CONTROL_CHARS, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) : '';
}

// A report or a contribution about one product: the fields apps-script.gs reads, each bounded, nothing else.
// null when it names no product, which the receiver would refuse anyway.
function cleanProductPost(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {
    asin: cleanText(raw.asin, 10).toUpperCase(),
    upc: cleanText(raw.upc, 14),
    brand: cleanText(raw.brand, 120),
    product_name: cleanText(raw.product_name, 300),
    kind: cleanText(raw.kind, 40),
    certifications: cleanText(raw.certifications, 600),
    verified_by: cleanText(raw.verified_by, 80),
    notes: cleanText(raw.notes, 1200),
  };
  if (out.asin && !/^[A-Z0-9]{10}$/.test(out.asin)) out.asin = '';
  if (out.upc && !/^\d{8,14}$/.test(out.upc)) out.upc = '';
  return out.asin || out.upc || out.product_name || out.brand ? out : null;
}

// A diagnostics row: plain data, bounded in size and depth. The receiver picks its own columns, so unknown
// keys are harmless there; this keeps a runaway object out of storage and out of the POST.
function boundedRecord(raw, { maxKeys = 48, maxString = 6500, maxItems = 60, depth = 3 } = {}) {
  const walk = (value, level) => {
    if (typeof value === 'string') return value.replace(CONTROL_CHARS, ' ').slice(0, maxString);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean' || value === null) return value;
    if (level >= depth) return null;
    if (Array.isArray(value)) return value.slice(0, maxItems).map(item => walk(item, level + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).slice(0, maxKeys)) out[String(key).slice(0, 60)] = walk(value[key], level + 1);
      return out;
    }
    return null;
  };
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? walk(raw, 0) : null;
}

function isOwnExtension(sender) {
  const id = chrome.runtime && chrome.runtime.id;
  if (!id || !sender) return false;
  return !sender.id || sender.id === id;
}

function isAmazonTabSender(sender) {
  const raw = sender && sender.tab && sender.tab.url;
  if (!raw) return false;
  try { return AMAZON_HOST.test(new URL(raw).hostname); }
  catch { return false; }
}

function isRetailerTabSender(sender) {
  const raw = sender && sender.tab && sender.tab.url;
  if (!raw) return false;
  try { return RETAILER_HOST.test(new URL(raw).hostname); }
  catch { return false; }
}

function extensionPagePath(sender) {
  const raw = sender && sender.url;
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const id = chrome.runtime && chrome.runtime.id;
    const own = new URL(chrome.runtime.getURL ? chrome.runtime.getURL('') : `chrome-extension://${id}/`);
    if (!id || !['chrome-extension:', 'moz-extension:'].includes(u.protocol) || u.protocol !== own.protocol || u.hostname !== own.hostname) return '';
    return u.pathname || '';
  } catch { return ''; }
}

function isOptionsPageSender(sender) {
  return /\/options\.html$/i.test(extensionPagePath(sender));
}

function isOffscreenSender(sender) {
  return /\/offscreen\/ocr\.html$/i.test(extensionPagePath(sender));
}

function allowMessage(msg, sender) {
  if (!msg || !isOwnExtension(sender)) return false;
  if (msg.type === 'lookupBarcode' && extensionPagePath(sender) === '/src/options/library.html') return true;
  if (msg.type === 'purchaseImport' || msg.type === 'purchaseOpenHistory' || msg.type === 'purchaseScanState' || msg.type === 'purchaseScanProgress') {
    try {
      const u = new URL(sender.url || '');
      return sender.frameId === 0 && sender.tab && new URL(sender.tab.url).origin === u.origin && new URL(sender.tab.url).pathname === u.pathname && u.protocol === 'https:'
        && /^(?:www\.)?amazon\.com$/.test(u.hostname)
        && /^\/(?:your-orders\/orders|gp\/(?:your-account\/order-history|css\/order-history))(?:\.html)?(?:\/ref=[A-Za-z0-9_-]+)?\/?$/.test(u.pathname);
    } catch { return false; }
  }
  if (HISTORY_MESSAGE_TYPES.has(msg.type)) return ['/src/options/history.html', '/src/options/welcome.html'].includes(extensionPagePath(sender));
  if (PAGE_MESSAGE_TYPES.has(msg.type)) {
    return isAmazonTabSender(sender) || (RETAILER_MESSAGE_TYPES.has(msg.type) && isRetailerTabSender(sender));
  }
  // Setup may check for a saved copy and, only when there is none, write one (welcome.js).
  if ((msg.type === 'accountSave' || msg.type === 'accountFetch') && extensionPagePath(sender) === '/src/options/welcome.html') return true;
  if (SETTINGS_MESSAGE_TYPES.has(msg.type)) return isOptionsPageSender(sender);
  if (OFFSCREEN_MESSAGE_TYPES.has(msg.type)) return isOffscreenSender(sender);
  if (msg.type === 'ping') return true;
  return false;
}
