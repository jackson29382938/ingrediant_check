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
  const optionsHtml = read('src/options/options.html');
  const engine = srcFiles.filter(f => rel(f).startsWith('src/engine'));
  for (const f of engine) {
    const p = rel(f).split(path.sep).join('/');
    const base = path.basename(p);
    const loaded = declared.includes(p) || worker.includes(base) || optionsHtml.includes(base);
    assert.ok(loaded, `${p} is loaded by nothing — not the manifest, the worker, or the options page`);
  }
});

check('db files load before the engine that consumes them', () => {
  const iEngine = declared.indexOf('src/engine/score.js');
  const iModule = declared.indexOf('src/engine/db/_module.js');
  assert.ok(iModule === 0, '_module.js must be first; it defines AIRmodule');
  for (const p of declared.filter(p => p.startsWith('src/engine/db/'))) {
    assert.ok(declared.indexOf(p) < iEngine, `${p} loads after score.js`);
  }
});

check('store description is within the 132-character limit', () => {
  assert.ok(manifest.description.length <= 132,
    `description is ${manifest.description.length} characters; the Chrome Web Store cuts off at 132`);
});

console.log('\nHTML pages point at files that exist, and carry no inline handlers');
for (const page of ['src/options/options.html', 'src/options/popup.html']) {
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
    'sodium', 'saturatedFat', 'totalSugar', 'fibre', 'protein',
  ]);
  const orphans = [...ids].filter(id => !used.has(id));
  assert.strictEqual(orphans.length, 0,
    `these categories have a slider but nothing reads them: ${orphans.join(', ')}`);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
