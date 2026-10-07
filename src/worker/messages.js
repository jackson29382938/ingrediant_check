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
  'openSortedPanel', 'updateSortedResults', 'openSortedTab',
  // A line for "Report a problem"'s recent actions (engine/db/activity.js).
  'logAction',
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
var HISTORY_MESSAGE_TYPES = new Set(['purchaseImport', 'purchaseOpenHistory', 'purchaseSync', 'purchaseConfigure', 'purchaseDelete']);
var OFFSCREEN_MESSAGE_TYPES = new Set(['ocrIdle']);
var AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|ca|com\.au|ie|in|sg|ae|sa|de|fr|es|it|nl|se|pl|com\.be|com\.tr|com\.mx|com\.br|co\.jp)$/i;
// Retailer previews perform their public same-origin reads in the content script.
// Their tabs may ask the worker only for toolbar badges; worker network paths stay Amazon-only.
var RETAILER_MESSAGE_TYPES = new Set(['pageScore']);
var RETAILER_HOST = /^(?:www\.)?(?:target\.com|walmart\.com|costco\.com|instacart\.com|kroger\.com|frysfood\.com|ralphs\.com|kingsoopers\.com|smithsfoodanddrug\.com|fredmeyer\.com|qfc\.com|harristeeter\.com|dillons\.com|safeway\.com|albertsons\.com)$/i;

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
  if (msg.type === 'purchaseImport' || msg.type === 'purchaseOpenHistory') {
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
