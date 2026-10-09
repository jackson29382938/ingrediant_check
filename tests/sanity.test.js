// Project wiring. Run: node tests/sanity.test.js
//
// This extension has no build step and no dependencies, so nothing else would notice a rule file
// that is never loaded, a category id with a typo, or a script tag pointing at a moved file.
// These are the failure modes that are silent rather than loud: a mistyped `cat` does not throw,
// it just makes that rule's weight permanently unadjustable.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const rel = p => path.relative(root, p);
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.name.startsWith('._')) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const manifest = JSON.parse(read('manifest.json'));
const srcFiles = walk(path.join(root, 'src'));

console.log('every source file parses');
for (const f of srcFiles) {
  check(rel(f), () => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }));
}

console.log('\nmanifest matches what is on disk');
const declared = manifest.content_scripts[0].js;

check('every declared content script exists', () => {
  for (const p of declared) {
    assert.ok(fs.existsSync(path.join(root, p)), `${p} is declared in the manifest but not on disk`);
  }
});

check('every engine file is loaded somewhere', () => {
  // A new rule file that nothing loads is invisible: the engine keeps running with the old rules
  // and no error is raised anywhere.
  const worker = read(manifest.background.service_worker);
  const optionsHtml = fs.readdirSync(path.join(root, 'src/options')).filter(name => name.endsWith('.html')).map(name => read('src/options/' + name)).join('\n');
  const engine = srcFiles.filter(f => rel(f).startsWith('src/engine'));
  for (const f of engine) {
    const p = rel(f).split(path.sep).join('/');
    const base = path.basename(p);
    const loaded = declared.includes(p) || worker.includes(base) || optionsHtml.includes(base);
    assert.ok(loaded, `${p} is loaded by nothing — not the manifest, the worker, or an extension page`);
  }
});

check('every chrome.runtime.sendMessage type in src is registered in the worker allowlist', () => {
  // Inverted allowlist: unknown types are denied. A new sendMessage({type}) without a registry
  // entry would silently fail in production; catch that in CI.
  const worker = read('src/worker/messages.js') + '\n' + read('src/background.js');
  const known = new Set();
  for (const block of worker.matchAll(/[A-Z_]*MESSAGE_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/g)) {
    for (const m of block[1].matchAll(/'([A-Za-z0-9_]+)'/g)) known.add(m[1]);
  }
  known.add('ping'); // explicit default-allow for health checks
  assert.ok(known.has('ocrLabels') && known.has('flushDiagnostics') && known.has('ocrIdle'),
    `allowlist parse failed: ${[...known].join(',')}`);
  const used = new Set();
  for (const f of srcFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    for (const m of raw.matchAll(/sendMessage\(\s*\{[^}]*\btype:\s*'([A-Za-z0-9_]+)'/g)) {
      // Offscreen target messages are not worker allowlist types.
      if (m[0].includes("target: 'ocr-offscreen'") || m[0].includes('target:"ocr-offscreen"')) continue;
      used.add(m[1]);
    }
  }
  const missing = [...used].filter(t => !known.has(t));
  assert.strictEqual(missing.length, 0, `unregistered message types: ${missing.join(', ')}`);
});

check('settings messages are sent only from the settings page', () => {
  // The worker accepts SETTINGS_MESSAGE_TYPES from options.html alone (src/worker/messages.js).
  // A caller anywhere else would be refused in production without an error, so fail here instead.
  const types = [...read('src/worker/messages.js').match(/SETTINGS_MESSAGE_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/)[1]
    .matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(types.includes('flushDiagnostics') && types.includes('accountSave'), `parse: ${types}`);
  const allowed = new Set(['src/worker/messages.js', 'src/background.js', 'src/options/settings-database.js']);
  for (const f of srcFiles) {
    const p = rel(f).split(path.sep).join('/');
    if (allowed.has(p)) continue;
    const raw = fs.readFileSync(f, 'utf8');
    for (const t of types) {
      if (p === 'src/options/welcome.js' && (t === 'accountSave' || t === 'accountFetch')) continue;
      assert.ok(!raw.includes(`'${t}'`), `${p} mentions settings message '${t}'`);
    }
  }
  for (const page of ['src/options/popup.html', 'src/options/welcome.html']) {
    assert.ok(!read(page).includes('settings-database.js'), `${page} loads settings-database.js`);
  }
  assert.ok(read('src/options/options.html').includes('settings-database.js'));
});

check('content scripts split page / product / search before main', () => {
  const iPage = declared.indexOf('src/content/page.js');
  const iProduct = declared.indexOf('src/content/product.js');
  const iSearch = declared.indexOf('src/content/search.js');
  const iMain = declared.indexOf('src/content/main.js');
  assert.ok(iPage >= 0 && iProduct > iPage && iSearch > iProduct && iMain > iSearch,
    `expected page → product → search → main, got ${[iPage, iProduct, iSearch, iMain]}`);
});

check('db files load before the engine that consumes them', () => {
  const iEngine = declared.indexOf('src/engine/score.js');
  const iModule = declared.indexOf('src/engine/db/_module.js');
  assert.equal(declared[0], 'src/browser-compat.js', 'Browser compatibility loads before API consumers');
  assert.ok(iModule === 1, '_module.js must precede engine modules; it defines AIRmodule');
  for (const p of declared.filter(p => p.startsWith('src/engine/db/'))) {
    assert.ok(declared.indexOf(p) < iEngine, `${p} loads after score.js`);
  }
});

check('store description is within the 132-character limit', () => {
  // Now a __MSG_ reference; the real string is checked in the localisation section below.
  const d = manifest.description.startsWith('__MSG_')
    ? JSON.parse(read('_locales/en/messages.json')).appDescription.message
    : manifest.description;
  assert.ok(d.length <= 132, `description is ${d.length} characters; the store cuts off at 132`);
});

console.log('\nHTML pages point at files that exist, and carry no inline handlers');
for (const page of ['src/options/options.html', 'src/options/popup.html', 'src/options/welcome.html', 'src/offscreen/ocr.html']) {
  check(page, () => {
    const html = read(page);
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      const target = path.resolve(path.dirname(path.join(root, page)), m[1]);
      assert.ok(fs.existsSync(target), `${page} loads ${m[1]}, which does not exist`);
    }
    // MV3's CSP refuses inline script; an onclick= here fails silently in the page.
    const inline = html.match(/\son[a-z]+\s*=\s*"/i);
    assert.ok(!inline, `${page} has an inline event handler (${inline && inline[0].trim()}) — MV3 blocks it`);
  });
}

console.log('\nthe vendored OCR engine is complete');
check('every file tesseract needs is present', () => {
  // Vendored rather than fetched: MV3 forbids remote code and OCR must stay on this machine.
  // A missing piece here fails only at runtime, on a user's machine, seconds into a scan.
  // tesseract-core-simd-lstm.wasm.js, not the .js + .wasm pair: the worker importScripts()s the
  // combined file by name, and vendoring the split version failed at runtime with a NetworkError
  // that no unit test would have caught. Verified in a browser via tests/harness-ocr.html.
  for (const f of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js',
                   'eng.traineddata.gz', 'VERSION.txt']) {
    const full = path.join(root, 'vendor/tesseract', f);
    assert.ok(fs.existsSync(full), `vendor/tesseract/${f} is missing`);
    assert.ok(fs.statSync(full).size > 0, `vendor/tesseract/${f} is empty`);
  }
});

check('OCR internals are not web-accessible', () => {
  const war = (manifest.web_accessible_resources || []).flatMap(r => r.resources || []);
  assert.ok(!war.some(r => /tesseract|offscreen/.test(r)),
    'vendor/tesseract and src/offscreen must not be web-accessible');
  assert.ok(manifest.permissions.includes('offscreen'), 'the offscreen permission is missing');
  const csp = (manifest.content_security_policy || {}).extension_pages || '';
  assert.ok(/wasm-unsafe-eval/.test(csp), 'wasm-unsafe-eval is required to compile the OCR engine');
});

check('a harness page that runs main.js loads every Amazon content script, in manifest order', () => {
  // harness-lifecycle.html once loaded 21 of the 28 and threw "[AIR] … reading 'fromScan'" on every
  // run while reporting success. harness.html and harness-ocr.html load only the engine / OCR parts
  // and never main.js, so they are not held to this.
  const pages = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.html'));
  let checked = 0;
  for (const file of pages) {
    const srcs = [...read(`tests/${file}`).matchAll(/<script src="\/?(src\/[^"]+)"/g)].map(m => m[1]);
    if (!srcs.includes('src/content/main.js')) continue;
    checked++;
    assert.deepEqual(srcs.filter(f => declared.includes(f)), declared, `${file} loads a different set or order`);
  }
  assert.ok(checked >= 2, `only ${checked} harness pages run main.js; the scan is broken`);
});

check('identity is available for explicit Google sign-in without a mandatory permission', () => {
  assert.ok((manifest.optional_permissions || []).includes('identity'));
  assert.ok(!manifest.permissions.includes('identity'));
});

check('content scripts are limited to product and search paths', () => {
  const cs = manifest.content_scripts[0];
  assert.ok(cs.matches.every(m => !m.endsWith('.com/*') && !m.endsWith('.uk/*') && !/\.amazon\.[^/]+\/\*$/.test(m)),
    'a host-wide /* match would inject on cart and account pages');
  assert.ok(cs.matches.some(m => m.includes('/dp/')), 'product /dp/ matches missing');
  assert.ok(cs.matches.some(m => m.includes('/*/dp/')), 'slug /*/dp/ matches missing — cold loads of /Title/dp/ASIN would not inject');
  assert.ok(cs.matches.some(m => m.startsWith('*://amazon.')), 'apex amazon.* matches missing');
  assert.ok(cs.matches.some(m => m.includes('/gp/aw/d/')), 'mobile /gp/aw/d/ matches missing');
  assert.ok((cs.exclude_globs || []).some(g => g.includes('/ap/')), 'login /ap/ is not excluded');
  assert.ok((cs.exclude_globs || []).some(g => g.includes('/gp/cart')), 'cart is not excluded');
});

console.log('\nevery rule points at a category that exists');
require(path.join(root, 'src/engine/db/_module.js'));
const engine = require(path.join(root, 'src/engine/score.js'));
const categories = require(path.join(root, 'src/engine/categories.js'));
const labels = require(path.join(root, 'src/engine/db/labels.js'));
const ids = new Set(categories.CATEGORIES.map(c => c.id));

check('penalty and cap rules', () => {
  // A typo here does not throw. resolveWeights returns 1 for an unknown id, so the rule silently
  // becomes permanently unadjustable and never appears on the settings page.
  const bad = [];
  for (const r of engine.PENALTIES) if (r.cat && !ids.has(r.cat)) bad.push(`penalty "${r.why}" -> ${r.cat}`);
  for (const c of engine.CAPS) if (c.cat && !ids.has(c.cat)) bad.push(`cap "${c.why}" -> ${c.cat}`);
  assert.strictEqual(bad.length, 0, 'unknown category ids:\n       ' + bad.join('\n       '));
});

check('bonus rules', () => {
  const bad = labels.BONUSES.filter(b => b.cat && !ids.has(b.cat)).map(b => `${b.why} -> ${b.cat}`);
  assert.strictEqual(bad.length, 0, 'unknown category ids:\n       ' + bad.join('\n       '));
});

check('every category is reachable by at least one rule or the engine itself', () => {
  const used = new Set([
    ...engine.PENALTIES.map(r => r.cat), ...engine.CAPS.map(c => c.cat),
    ...labels.BONUSES.map(b => b.cat),
    // consumed directly by score.js rather than carried on a rule
    'processing', 'simplicity', 'naturalSugar', 'allergens', 'avoidList', 'hollowClaims',
    'provenanceVerified', 'provenanceClaimed', 'provenanceUnknown',
    ...engine.NUTRITION.map(r => r.cat),
  ]);
  const orphans = [...ids].filter(id => !used.has(id));
  assert.strictEqual(orphans.length, 0,
    `these categories have a slider but nothing reads them: ${orphans.join(', ')}`);
});

console.log('\nlocalisation keys resolve');
const messages = JSON.parse(read('_locales/en/messages.json'));
const keys = new Set(Object.keys(messages));

check('manifest __MSG_ references exist', () => {
  const raw = read('manifest.json');
  const missing = [...raw.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]).filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
  assert.strictEqual(manifest.default_locale, 'en', 'default_locale is required once __MSG_ is used');
});

check('every t() key in panel.js exists', () => {
  // A missing key silently falls back to English, so nothing breaks — it just never translates.
  // That is exactly the kind of rot no other check would catch.
  const raw = read('src/content/panel.js');
  const used = [...raw.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(used.length > 10, `only found ${used.length} t() calls; the scan is broken`);
  const missing = [...new Set(used)].filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
});

check('every data-i18n key in the popup exists', () => {
  const raw = read('src/options/popup.html');
  const used = [...raw.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)].map(m => m[1]);
  assert.ok(used.length > 5, `only found ${used.length} data-i18n attributes`);
  const missing = [...new Set(used)].filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
});

check('every data-i18n key in the settings page exists', () => {
  const raw = read('src/options/options.html');
  const used = [...raw.matchAll(/data-i18n(?:-placeholder|-aria)?="([A-Za-z0-9_]+)"/g)].map(m => m[1]);
  assert.ok(used.length > 10, `only found ${used.length} settings i18n attributes`);
  const missing = [...new Set(used)].filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
});

check('every extension page translates its aria labels and placeholders, and every locale has the keys', () => {
  // The popup's preset tabs and compare pickers kept a hardcoded English aria-label with no
  // data-i18n-aria, so a German screen reader heard English there; nothing checked for it.
  const fs = require('fs');
  const locales = fs.readdirSync(path.join(__dirname, '..', '_locales'))
    .map(l => [l, new Set(Object.keys(JSON.parse(read(`_locales/${l}/messages.json`))))]);
  for (const page of ['popup', 'options', 'welcome', 'report', 'sidepanel', 'sorted']) {
    const raw = read(`src/options/${page}.html`);
    for (const tag of raw.match(/<[^>]*\s(?:aria-label|placeholder)="[^"]*"[^>]*>/g) || []) {
      if (/\saria-label="/.test(tag)) assert.ok(/data-i18n-aria="/.test(tag), `${page}.html: untranslated aria-label in ${tag.slice(0, 80)}`);
      // A URL placeholder (https://www.example.com) reads the same in every language.
      if (/\splaceholder="(?!https?:)/.test(tag)) assert.ok(/data-i18n-placeholder="/.test(tag), `${page}.html: untranslated placeholder in ${tag.slice(0, 80)}`);
    }
    const used = [...raw.matchAll(/data-i18n(?:-placeholder|-aria)?="([A-Za-z0-9_]+)"/g)].map(m => m[1]);
    for (const [lang, set] of locales) {
      const missing = [...new Set(used)].filter(k => !set.has(k));
      assert.strictEqual(missing.length, 0, `${page}.html keys missing from _locales/${lang}: ${missing.join(', ')}`);
    }
  }
});

check('every msg() key in settings.js exists', () => {
  const raw = read('src/options/settings.js');
  const used = [...raw.matchAll(/\bmsg\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(used.length > 3, `only found ${used.length} settings msg() calls; the scan is broken`);
  const missing = [...new Set(used)].filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
});

check('the panel uses a closed shadow root', () => {
  const raw = read('src/content/panel.js');
  assert.ok(/attachShadow\(\{\s*mode:\s*'closed'\s*\}\)/.test(raw), 'panel.js must attach a closed shadow');
  assert.ok(/function shadowOf/.test(raw), 'closed shadow needs shadowOf — host.shadowRoot is null');
  assert.ok(!/mode:\s*'open'/.test(raw), 'open shadow must not remain');
});

check('the popup surfaces existing weight presets', () => {
  const html = read('src/options/popup.html');
  const js = read('src/options/popup.js');
  assert.ok(/id="presets"/.test(html), 'popup.html is missing the presets host');
  assert.ok(/CATS\.PRESETS/.test(js), 'popup.js must apply categories.PRESETS, not a new scoring system');
  for (const id of Object.keys(categories.PRESETS)) {
    assert.ok(js.includes('PRESETS'), `popup.js does not read PRESETS (needed for ${id})`);
  }
});

check('every msg() key in popup.js exists', () => {
  const raw = read('src/options/popup.js');
  const used = [...raw.matchAll(/\bmsg\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(used.length > 3, `only found ${used.length} msg() calls; the scan is broken`);
  const missing = [...new Set(used)].filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
});

check('search.js throttle and verdict keys exist', () => {
  const raw = read('src/content/search.js');
  const used = [
    ...[...raw.matchAll(/throttleCopy\(\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1]),
    ...[...raw.matchAll(/'((?:verdict|throttle|badge)[A-Za-z]+)'/g)].map(m => m[1]),
  ];
  assert.ok(used.includes('throttleTitle'), 'search.js lost throttleTitle');
  const missing = [...new Set(used)].filter(k => !keys.has(k));
  assert.strictEqual(missing.length, 0, `missing from messages.json: ${missing.join(', ')}`);
});

check('catHelp_* keys match a scoring category', () => {
  const ids = new Set(categories.CATEGORIES.map(c => c.id));
  const extra = Object.keys(messages).filter(k => k.startsWith('catHelp_') && !ids.has(k.slice(8)));
  assert.deepEqual(extra, []);
  assert.ok(keys.has('catHelp_grain'), 'grain help must be in messages.json');
});

check('the localised description still fits the store limit', () => {
  const d = messages.appDescription && messages.appDescription.message;
  assert.ok(d, 'appDescription is missing');
  assert.ok(d.length <= 132, `appDescription is ${d.length} characters; the store cuts off at 132`);
});

check('every message has a non-empty string', () => {
  const bad = Object.entries(messages)
    .filter(([, v]) => !v || typeof v.message !== 'string' || !v.message.trim())
    .map(([k]) => k);
  assert.strictEqual(bad.length, 0, `empty messages: ${bad.join(', ')}`);
});

check('Amazon access and the actual auto-rating default are disclosed where users look', () => {
  // The manifest grants every store below at install. Privacy copy that names fewer stores, or a
  // settings page without the switch beside its explanation, under-states what the extension can do.
  const hosts = JSON.parse(read('manifest.json')).host_permissions;
  const privacy = read('docs/PRIVACY.md');
  const stores = hosts.map(h => (h.match(/^\*:\/\/\*\.amazon(\.[a-z.]+)\/\*$/) || [])[1]);
  assert.ok(stores.every(Boolean), `unexpected host permission: ${hosts.join(', ')}`);
  // Named as "amazon.com" or, further along the list, as ".co.uk," / ".com.br and" / ".co.jp)".
  const named = tld => {
    const t = tld.replace(/\./g, '\\.');
    return new RegExp(`(?:amazon|\\s)${t}(?:,|\\)|\\s+and\\b)`).test(privacy);
  };
  const missing = stores.filter(tld => !named(tld));
  assert.deepEqual(missing, [], `docs/PRIVACY.md does not name ${missing.join(', ')}`);
  assert.match(privacy, new RegExp(`the ${hosts.length} Amazon stores`), 'PRIVACY.md store count');
  const autoRate = require('../src/engine/db/prefs.js').TOGGLE_DEFAULTS.autoScoreSearch;
  assert.match(privacy, new RegExp(`Rate every search result is ${autoRate ? 'on' : 'off'} by default`));
  const options = read('src/options/options.html');
  for (const id of ['autoScoreSearch', 'hoverScore', 'amazonStores']) {
    assert.match(options, new RegExp(`id="${id}"`), `settings page lost #${id}`);
  }
  const popup = read('src/options/popup.html');
  for (const key of ['popupAutoScoreNet', 'popupHoverNet', 'popupNetworkLink']) {
    assert.match(popup, new RegExp(`data-i18n="${key}"`), `popup lost ${key}`);
  }
  assert.match(popup, /\.net\{display:block/, 'the popup network line must not hide behind "Why these matter"');
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
