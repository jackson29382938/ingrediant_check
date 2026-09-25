// Message allowlist for the service worker.
// Loaded via importScripts from background.js (and by Node tests before that file).
// Unknown types are denied — register new sendMessage types here before shipping them.
// Function declarations (not const) so they land on the worker global for background.js + tests.

var PAGE_MESSAGE_TYPES = new Set([
  'pageScore', 'ocrLabels', 'lookupBarcode', 'provenanceLookup',
  'contribute', 'report', 'diagnostic', 'productsLookup', 'productsQueue',
  // Amazon's sort menu (src/content/sort.js): open the side panel, send the list as it fills in, and
  // open it in a tab when Chrome would not open the panel. The list pages themselves send nothing:
  // they call chrome.tabs / chrome.sidePanel directly.
  'openSortedPanel', 'updateSortedResults', 'openSortedTab',
  // A line for "Report a problem"'s recent actions (engine/db/activity.js).
  'logAction',
]);
// Sent only by the settings page (settings-database.js, loaded by options.html alone), so only the
// settings page may send them. The popup and the setup page have no control for any of them:
// flushing POSTs queued diagnostic rows (a trace of scored products), refreshSheet fetches the
// shared database, and the account pair carries a Google token and overwrites local settings.
// The housekeeping alarm and a full diagnostics batch flush from inside the worker; neither is a
// message, so neither is affected. tests/sanity.test.js fails if another page starts sending one.
var SETTINGS_MESSAGE_TYPES = new Set([
  'flushDiagnostics', 'diagnosticsStatus', 'refreshSheet',
  'accountSave', 'accountLoad',
]);
var OFFSCREEN_MESSAGE_TYPES = new Set(['ocrIdle']);
var AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|ca|com\.au|ie|in|sg|ae|sa|de|fr|es|it|nl|se|pl|com\.be|com\.tr|com\.mx|com\.br|co\.jp)$/i;
// Other stores (src/content/retailer.js) work on the page alone. The only thing their tabs may ask
// the worker for is the toolbar badge; every network path above stays Amazon-only.
var RETAILER_MESSAGE_TYPES = new Set(['pageScore']);
var RETAILER_HOST = /^www\.target\.com$/i;

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
    if (!id || u.protocol !== 'chrome-extension:' || u.hostname !== id) return '';
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
  if (PAGE_MESSAGE_TYPES.has(msg.type)) {
    return isAmazonTabSender(sender) || (RETAILER_MESSAGE_TYPES.has(msg.type) && isRetailerTabSender(sender));
  }
  if (SETTINGS_MESSAGE_TYPES.has(msg.type)) return isOptionsPageSender(sender);
  if (OFFSCREEN_MESSAGE_TYPES.has(msg.type)) return isOffscreenSender(sender);
  if (msg.type === 'ping') return true;
  return false;
}
