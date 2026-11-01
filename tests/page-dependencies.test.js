'use strict';
// Every surface that runs our scripts (an extension page, a content-script group, the service worker) lists
// the files it loads by hand, and the lists drift. src/options/sidepanel.html shipped without
// engine/db/product-ratings.js while sorted.js called AIR.db.productRatings.caption(...) for any personal-care
// row, so the side panel (Chrome's main surface for the sorted list) threw as soon as a supplement search
// produced one. tests/personal-care-ui.test.js checked popup.html and sorted.html only.
//
// This reads each surface's script list, collects the modules those scripts provide (AIRmodule('x', ...) and
// AIR.x = ...), and fails when a loaded script reaches for a module the surface does not load. A bare
// reference or `?.` anywhere in the file counts as a guard: that file already copes with the module being
// absent, and its callers are not our concern here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(rel) : rel.endsWith('.js') ? [rel] : [];
  });
}
const sources = walk('src');

// "db.name" for AIRmodule modules, "name" for AIR.name assignments.
const providedBy = new Map();
for (const file of sources) {
  const text = read(file);
  const names = [
    ...[...text.matchAll(/AIRmodule\(\s*'([A-Za-z]+)'/g)].map(m => `db.${m[1]}`),
    ...[...text.matchAll(/\bAIR\.(?!db\b)([A-Za-z]+)\s*=(?!=)/g)].map(m => m[1]),
  ];
  for (const name of names) {
    if (!providedBy.has(name)) providedBy.set(name, new Set());
    providedBy.get(name).add(file);
  }
}

// What a file needs: names reached with a plain `.prop`, minus names it also guards.
function needs(file) {
  const text = read(file);
  const plain = new Set(), guarded = new Set();
  for (const m of text.matchAll(/\bAIR\.(db\.)?([A-Za-z]+)(\?\.|\.)?/g)) {
    const name = m[1] ? `db.${m[2]}` : m[2];
    if (!providedBy.has(name)) continue;
    (m[3] === '.' ? plain : guarded).add(name);
  }
  // A file reaches for the modules it defines itself.
  return [...plain].filter(name => !guarded.has(name) && !providedBy.get(name).has(file));
}

function check(surface, files) {
  const loaded = new Set(files);
  const provided = new Set();
  for (const file of files) for (const [name, owners] of providedBy) if (owners.has(file)) provided.add(name);
  const problems = [];
  for (const file of files) {
    if (!sources.includes(file)) continue;
    for (const name of needs(file)) if (!provided.has(name)) problems.push(`${file} uses AIR.${name}, which ${surface} does not load (${[...providedBy.get(name)].join(' or ')})`);
  }
  assert.deepEqual(problems, [], `${surface}:\n  ${problems.join('\n  ')}`);
  return loaded;
}

test('every extension page loads the modules its scripts use', () => {
  const pages = fs.readdirSync(path.join(root, 'src/options')).filter(f => f.endsWith('.html'));
  assert.ok(pages.length >= 8);
  for (const page of pages) {
    const files = [...read(`src/options/${page}`).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
      .map(m => path.posix.normalize(`src/options/${m[1]}`));
    check(`src/options/${page}`, files);
  }
});

test('every content-script group loads the modules its scripts use', () => {
  manifest.content_scripts.forEach((group, i) => check(`content_scripts[${i}] (${group.matches[0]})`, group.js));
});

test('the service worker loads the modules its scripts use', () => {
  const call = read('src/background.js').match(/importScripts\(([^)]*)\)/);
  const files = [...call[1].matchAll(/'([^']+)'/g)].map(m => `src/${m[1]}`).concat('src/background.js');
  check('the service worker', files);
});

test('the side panel loads what the sorted tab loads for rendering rows', () => {
  // The two pages render the same list with the same script, so they must agree on the engine modules.
  const modules = page => new Set([...read(`src/options/${page}`).matchAll(/engine\/db\/([a-z-]+)\.js/g)].map(m => m[1]));
  const panel = modules('sidepanel.html'), tab = modules('sorted.html');
  assert.deepEqual([...tab].filter(name => !panel.has(name)), [], 'sorted.html loads modules the side panel does not');
});
