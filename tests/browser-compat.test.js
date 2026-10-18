const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('src/browser-compat.js', 'utf8');
test('Chrome API object is preserved exactly', () => {
  const chrome = { runtime: { id: 'chrome' } }, context = { chrome }; vm.runInNewContext(source, context); assert.equal(context.chrome, chrome);
});
test('Firefox preserves callback APIs and Promise APIs and maps sidebar without losing arguments', async () => {
  const calls = [], event = { addListener(fn) { calls.push(fn); } };
  const modern = { runtime: { getURL: () => 'moz-extension://own/', onMessage: event }, storage: { local: { get: async key => ({ key }) } }, permissions: { request: async opts => { calls.push(opts); return true; } }, sidebarAction: { open: async () => 'sidebar' } };
  const native = { storage: { local: { get: (key, callback) => callback({ callback: key }) } }, runtime: { onMessage: event } };
  const context = { browser: modern, chrome: native }; vm.runInNewContext(source, context);
  assert.deepEqual(await context.chrome.storage.local.get('key'), { key: 'key' });
  context.chrome.storage.local.get('key', row => assert.deepEqual(row, { callback: 'key' }));
  assert.equal(await context.chrome.sidePanel.open({ tabId: 4 }), 'sidebar');
  const listener = () => true; context.chrome.runtime.onMessage.addListener(listener); assert.equal(calls[0], listener);
  assert.equal(await context.chrome.permissions.request({ permissions: ['identity'] }), true); assert.deepEqual([...calls[1].permissions], []); assert.ok(calls[1].data_collection.includes('healthInfo'));
});
test('browser manifests retain all store matches and use explicit Firefox background/sidebar fields', async () => {
  const { browserManifest } = await import('../scripts/browser-manifest.mjs');
  const manifest = JSON.parse(fs.readFileSync('manifest.json')), background = fs.readFileSync('src/background.js', 'utf8');
  assert.deepEqual(browserManifest(manifest, 'chrome', background), manifest);
  const firefox = browserManifest(manifest, 'firefox', background);
  assert.deepEqual(firefox.content_scripts, manifest.content_scripts); assert.equal(firefox.version, manifest.version);
  assert.equal(firefox.background.scripts[0], 'src/browser-compat.js'); assert.equal(firefox.background.scripts.at(-1), 'src/background.js');
  assert.equal(firefox.side_panel, undefined); assert.equal(firefox.minimum_chrome_version, undefined);
  assert.ok(!firefox.permissions.includes('offscreen')); assert.ok(!firefox.permissions.includes('sidePanel')); assert.ok(firefox.permissions.includes('identity'));
  assert.equal(firefox.sidebar_action.default_panel, manifest.side_panel.default_path);
  assert.throws(() => browserManifest(manifest, 'other', background));
});
test('Mozilla URLs are accepted only for the actual extension origin, with account handlers restricted', () => {
  const c = { chrome: { runtime: { id: 'own@example.com', getURL: () => 'moz-extension://own-uuid/' } }, URL }; vm.createContext(c); vm.runInContext(fs.readFileSync('src/worker/messages.js', 'utf8'), c);
  assert.equal(c.allowMessage({ type: 'accountLoad' }, { id: 'own@example.com', url: 'moz-extension://own-uuid/src/options/options.html' }), true);
  for (const url of ['moz-extension://other/src/options/options.html','chrome-extension://own-uuid/src/options/options.html','moz-extension://own-uuid/src/options/popup.html']) assert.equal(c.allowMessage({ type: 'accountLoad' }, { id: 'own@example.com', url }), false);
  assert.equal(c.allowMessage({ type: 'ocrIdle' }, { id: 'own@example.com', url: 'moz-extension://own-uuid/src/offscreen/ocr.html' }), true);
});
test('Firefox content scripts boot with their restricted API surface', async () => {
  const context = { browser: { runtime: { getURL: () => 'moz-extension://own/' }, storage: { local: { get: async () => ({ enabled: true }) } } }, chrome: {} };
  vm.runInNewContext(source, context); assert.equal((await context.chrome.storage.local.get('enabled')).enabled, true); assert.equal(context.chrome.permissions, undefined);
});
test('Firefox avoids missing-message console errors while preserving translated substitutions', () => {
  const calls = [], context = { browser: { runtime: { getURL: () => 'moz-extension://own/' }, storage: {}, i18n: { getMessage(name, arg) { calls.push(name); return arg; } } }, chrome: {}, AIR_BROWSER_MESSAGE_KEYS: new Set(['known']) };
  vm.runInNewContext(source, context); assert.equal(context.chrome.i18n.getMessage('unknown'), ''); assert.equal(context.chrome.i18n.getMessage('known', 'translated'), 'translated'); assert.deepEqual(calls, ['known']);
});
test('Firefox profile backup cannot upload without native data-sharing consent', async () => {
  let writes = 0; const context = { browser: { runtime: { getURL: () => 'moz-extension://own/' }, storage: { sync: { set: async () => { writes++; } } }, permissions: { contains: async () => false } }, chrome: {} };
  vm.runInNewContext(source, context); await assert.rejects(context.chrome.storage.sync.set({ allergens: ['milk'] }), /data-sharing permission/); assert.equal(writes, 0);
});
test('Firefox console checks separate only the exact native inactive-page diagnostic', async () => {
  const { firefoxConsole } = await import('../scripts/firefox-console.mjs'), base = 'moz-extension://own/';
  const entries = [{ source: base + 'content.js', message: 'Promise resolved while context is inactive\n' }, { source: base + 'app.js', message: 'TypeError: broken score' }, { source: base + 'app.js', message: 'Error: Promise resolved while context is inactive' }, { source: base + 'app.js', message: 'Promise rejected while context is inactive' }, { source: 'moz-extension://other/app.js', message: 'Other extension error' }];
  const result = firefoxConsole(entries, base); assert.equal(result.inactive.length, 1); assert.equal(result.errors.length, 3);
});
test('Firefox native RuntimeMessage actor teardown is separated without hiding application failures', async () => {
  const { firefoxConsole } = await import('../scripts/firefox-console.mjs'), base = 'moz-extension://own/';
  const native = "Promise rejected after context unloaded: Actor 'Conduits' destroyed before query 'RuntimeMessage' was resolved";
  const result = firefoxConsole([
    { source: base + 'browser-compat.js', message: native + '\n' },
    { source: base + 'app.js', message: 'Promise rejected after context unloaded: database write failed' },
    { source: base + 'app.js', message: 'Error: ' + native },
    { source: base + 'app.js', message: "Promise rejected after context unloaded: Actor 'Conduits' destroyed before query 'OtherQuery' was resolved" },
  ], base);
  assert.equal(result.inactive.length, 1); assert.equal(result.errors.length, 3);
});
test('Firefox concurrent OCR requests wait for a loaded host and can retry a failed load', async () => {
  let frame, attempts = 0, opens = 0;
  const context = { browser: { runtime: { getURL: p => 'moz-extension://own/' + p }, sidebarAction: { open() { opens++; return Promise.resolve(); } } },
    document: { getElementById: () => frame, body: { append(value) { frame = value; attempts++; } },
      createElement: () => ({ remove() { frame = null; } }) }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync('src/browser-platform-firefox.js', 'utf8'), context);
  const platform = context.AIR.platform;
  let firstDone = false, secondDone = false;
  const first = platform.ensureOcrHost('ocr.html').then(() => { firstDone = true; });
  const second = platform.ensureOcrHost('ocr.html').then(() => { secondDone = true; });
  await Promise.resolve(); assert.equal(attempts, 1); assert.equal(firstDone, false); assert.equal(secondDone, false);
  frame.onload(); await Promise.all([first, second]); assert.equal(firstDone, true); assert.equal(secondDone, true);
  await platform.closeOcrHost(); assert.equal(frame, null);
  const failed = platform.ensureOcrHost('ocr.html'); frame.onerror(); await assert.rejects(failed, /OCR host failed/);
  const retry = platform.ensureOcrHost('ocr.html'); frame.onload(); await retry; assert.equal(attempts, 3);
  const opening = platform.openPanel({ tabId: 1 }); assert.equal(opens, 1, 'sidebar starts synchronously within the user gesture'); await opening;
});
