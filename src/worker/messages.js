// Message allowlist for the service worker.
// Loaded via importScripts from background.js (and by Node tests before that file).
// Unknown types are denied — register new sendMessage types here before shipping them.
// Function declarations (not const) so they land on the worker global for background.js + tests.

var PAGE_MESSAGE_TYPES = new Set([
  'pageScore', 'ocrLabels', 'lookupBarcode', 'provenanceLookup',
  'contribute', 'report', 'diagnostic', 'productsLookup', 'productsQueue',
]);
var SETTINGS_MESSAGE_TYPES = new Set([
  'flushDiagnostics', 'diagnosticsStatus', 'refreshSheet',
  'accountSave', 'accountLoad',
]);
// Settings types that only the full settings page sends. The popup has no control for them, so it
// has no reason to send them either. Flushing POSTs the queued diagnostic rows (a trace of scored
// products) to the endpoint. The housekeeping alarm and a full batch still flush from inside the
// worker; neither is a message, so neither is affected by this list.
var OPTIONS_ONLY_MESSAGE_TYPES = new Set(['flushDiagnostics']);
var OFFSCREEN_MESSAGE_TYPES = new Set(['ocrIdle']);
var AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|ca|com\.au|ie|in|sg|ae|sa|de|fr|es|it|nl|se|pl|com\.be|com\.tr|com\.mx|com\.br|co\.jp)$/i;

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

function isSettingsSender(sender) {
  const path = extensionPagePath(sender);
  return /\/(options|popup)\.html$/i.test(path);
}

function isOptionsPageSender(sender) {
  return /\/options\.html$/i.test(extensionPagePath(sender));
}

function isOffscreenSender(sender) {
  return /\/offscreen\/ocr\.html$/i.test(extensionPagePath(sender));
}

function allowMessage(msg, sender) {
  if (!msg || !isOwnExtension(sender)) return false;
  if (PAGE_MESSAGE_TYPES.has(msg.type)) return isAmazonTabSender(sender);
  if (OPTIONS_ONLY_MESSAGE_TYPES.has(msg.type)) return isOptionsPageSender(sender);
  if (SETTINGS_MESSAGE_TYPES.has(msg.type)) return isSettingsSender(sender);
  if (OFFSCREEN_MESSAGE_TYPES.has(msg.type)) return isOffscreenSender(sender);
  if (msg.type === 'ping') return true;
  return false;
}
