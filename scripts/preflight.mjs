#!/usr/bin/env node
// Everything that must be true before loading the extension in Chrome.
// Run: npm run preflight
//
// The test suite proves the logic. This proves the PACKAGE: that every file the manifest names
// exists, every path a runtime component resolves is real, and nothing references something that
// was renamed. These are the failures that show up as a blank panel or a silent no-op rather than
// a stack trace, which is the worst way to find them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentMatches, AMAZON_HOSTS } from './content-matches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));

let bad = 0;
const ok = m => console.log('  \x1b[32mok\x1b[0m   ' + m);
const fail = m => { bad++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };
const check = (label, fn) => { try { const m = fn(); ok(m || label); } catch (e) { fail(label + ' — ' + e.message); } };

const manifest = JSON.parse(read('manifest.json'));

console.log('\nmanifest');
check('parses and declares MV3', () => {
  if (manifest.manifest_version !== 3) throw new Error('not manifest_version 3');
  // The worker uses AbortSignal.any and runtime.getContexts, both Chrome 116+. Without the floor an
  // older Chrome installs the extension and every network path fails with no visible reason.
  if (parseInt(manifest.minimum_chrome_version, 10) < 116 || !manifest.minimum_chrome_version) {
    throw new Error('minimum_chrome_version must be at least 116');
  }
  return `manifest v3, version ${manifest.version}, Chrome ${manifest.minimum_chrome_version}+`;
});
check('every declared file exists', () => {
  const files = [
    ...manifest.content_scripts[0].js,
    manifest.background.service_worker,
    manifest.options_page,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
  ];
  const missing = files.filter(f => !exists(f));
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
  return `${files.length} declared files present`;
});
check('permissions and CSP match the features', () => {
  if (!manifest.permissions.includes('offscreen')) throw new Error('offscreen permission missing (OCR)');
  if (manifest.permissions.includes('activeTab')) {
    throw new Error('activeTab is unused — host permissions already cover Amazon tabs for the popup card');
  }
  const csp = (manifest.content_security_policy || {}).extension_pages || '';
  if (!/wasm-unsafe-eval/.test(csp)) throw new Error('wasm-unsafe-eval missing (OCR will not compile)');
  if (!manifest.default_locale) throw new Error('default_locale missing but __MSG_ is used');
  return `offscreen + wasm-unsafe-eval + locale "${manifest.default_locale}"`;
});
check('stores covered', () => {
  const matches = manifest.content_scripts[0].matches || [];
  const expected = buildContentMatches();
  if (matches.length !== expected.length || matches.some((m, i) => m !== expected[i])) {
    throw new Error('content_scripts.matches drifted from scripts/content-matches.mjs — regenerate or edit the source list');
  }
  const hosts = new Set(AMAZON_HOSTS);
  if (hosts.size < 21) throw new Error(`only ${hosts.size} Amazon hosts`);
  if (matches.some(m => /\/\*$/.test(m) && !/\/(dp|s|b|stores|gp\/product|gp\/browse|gp\/aw\/d)/.test(m))) {
    throw new Error('a catch-all /* match is back — content scripts must stay on product/search paths');
  }
  if (!matches.some(m => m.includes('/*/dp/')) || !matches.some(m => m.includes('/*/gp/product/'))) {
    throw new Error('slug product matches (/*/dp/*, /*/gp/product/*) missing');
  }
  if (!matches.some(m => m.startsWith('*://amazon.'))) {
    throw new Error('apex amazon.* matches missing');
  }
  if (!matches.some(m => m.includes('/gp/aw/d/'))) {
    throw new Error('mobile /gp/aw/d/ matches missing');
  }
  if (!matches.some(m => m.includes('/dp/')) || !matches.some(m => m.endsWith('/s') || m.includes('/s/'))) {
    throw new Error('product /dp/ or search /s matches missing');
  }
  // Chrome matches the query string too: '/s' alone never injects on '/s?k=…' search pages.
  if (!matches.some(m => m.endsWith('/s?*'))) {
    throw new Error('search /s?* matches missing — /s alone does not match /s?k=… URLs');
  }
  return `${hosts.size} Amazon stores, ${matches.length} path patterns (incl. slug + apex + mobile)`;
});
check('content scripts split PDP vs search', () => {
  const js = manifest.content_scripts[0].js || [];
  for (const need of ['src/content/page.js', 'src/content/product.js', 'src/content/search.js', 'src/content/main.js']) {
    if (!js.includes(need)) throw new Error(`missing ${need}`);
  }
  const order = ['src/content/page.js', 'src/content/product.js', 'src/content/search.js', 'src/content/main.js']
    .map(f => js.indexOf(f));
  if (order.some((n, i) => i && n <= order[i - 1])) throw new Error('page → product → search → main order broken');
  return 'page / product / search / main in order';
});
check('content scripts skip account and checkout', () => {
  const globs = manifest.content_scripts[0].exclude_globs || [];
  for (const need of ['/ap/', '/gp/cart', '/checkout', '/gp/css/']) {
    if (!globs.some(g => g.includes(need))) throw new Error(`exclude_globs missing ${need}`);
  }
  return `${globs.length} exclude_globs`;
});

console.log('\nOCR');
check('vendored engine complete', () => {
  const need = ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js', 'eng.traineddata.gz'];
  const missing = need.filter(f => !exists('vendor/tesseract/' + f));
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
  const mb = need.reduce((a, f) => a + fs.statSync(path.join(root, 'vendor/tesseract', f)).size, 0) / 1048576;
  return `engine present (${mb.toFixed(1)} MB)`;
});
check('the core build the worker asks for, not the split pair', () => {
  if (exists('vendor/tesseract/tesseract-core-simd-lstm.wasm')
      && !exists('vendor/tesseract/tesseract-core-simd-lstm.wasm.js')) {
    throw new Error('split .js/.wasm vendored; the worker importScripts()s the combined .wasm.js');
  }
  return 'combined .wasm.js vendored';
});
check('offscreen page resolves its scripts', () => {
  const html = read('src/offscreen/ocr.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const missing = srcs.filter(s => !fs.existsSync(path.resolve(root, 'src/offscreen', s)));
  if (missing.length) throw new Error('unresolvable: ' + missing.join(', '));
  return `${srcs.length} scripts resolve`;
});
check('OCR assets are not web-accessible', () => {
  const war = (manifest.web_accessible_resources || []).flatMap(r => r.resources || []);
  if (war.some(r => /tesseract|offscreen/.test(r))) {
    throw new Error('web_accessible_resources still exposes OCR internals to Amazon pages');
  }
  return 'vendor + offscreen stay extension-origin';
});

console.log('\ndiagnostics');
check('extension and Apps Script agree on columns', () => {
  const cols = JSON.parse(read('docs/apps-script.gs').match(/var DIAGNOSTIC_COLUMNS = (\[[\s\S]*?\]);/)[1]);
  const src = read('src/engine/db/diagnostics.js');
  const mine = JSON.parse('[' + src.match(/const COLUMNS = \[([\s\S]*?)\];/)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  if (JSON.stringify(cols) !== JSON.stringify(mine)) throw new Error('column drift — values would land under wrong headers');
  return `${cols.length} columns aligned`;
});

console.log('\nlocalisation');
check('every key resolves', () => {
  const msgs = JSON.parse(read('_locales/en/messages.json'));
  const used = new Set([
    ...[...read('manifest.json').matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]),
    ...[...read('src/content/panel.js').matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]),
    ...[...read('src/options/popup.html').matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)].map(m => m[1]),
    ...[...read('src/options/options.html').matchAll(/data-i18n(?:-placeholder|-aria)?="([A-Za-z0-9_]+)"/g)].map(m => m[1]),
    ...[...read('src/options/popup.js').matchAll(/\bmsg\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]),
    ...[...read('src/options/settings.js').matchAll(/\bmsg\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]),
    ...[...read('src/content/search.js').matchAll(/throttleCopy\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]),
    ...[...read('src/content/search.js').matchAll(/'((?:verdict|throttle|badge)[A-Za-z]+)'/g)].map(m => m[1]),
  ]);
  const missing = [...used].filter(k => !(k in msgs));
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
  return `${used.size} keys resolve against ${Object.keys(msgs).length} messages`;
});

console.log(bad ? `\n\x1b[31m${bad} problem(s) — do not load yet\x1b[0m\n`
                : '\n\x1b[32mReady to load unpacked.\x1b[0m\n');
process.exit(bad ? 1 : 0);
