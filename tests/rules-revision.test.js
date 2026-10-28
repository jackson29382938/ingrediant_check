// The rulebase revision must move when the rules move. Run: node tests/rules-revision.test.js
//
// The score cache fingerprints on RULES_REVISION (src/engine/db/revision.js), so a stale revision
// means badges and the popup keep showing scores computed under rules that no longer exist — which
// is exactly what happened when the September 14 rulebase rewrite shipped under an unchanged
// manifest version. This test hashes the rule sources and refuses to pass until the constant and
// the hash beside it have both been updated.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const revision = require(src('engine/db/revision.js'));

// Every file whose contents can change a score. Not the extractor, not the panel, not the gate:
// those change what is read or shown, not what a given list is worth.
const RULE_SOURCES = [
  'engine/score.js', 'engine/categories.js',
  'engine/db/oils.js', 'engine/db/sugars.js', 'engine/db/additives.js', 'engine/db/labels.js',
  'engine/db/allergens.js', 'engine/db/provenance.js', 'engine/db/ingestible.js', 'engine/db/product-ratings.js',
];

// FNV-1a over the concatenated sources, line endings normalised so a checkout on Windows agrees.
function fnv(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// What the hash sees: the code, not the prose around it. Editing a comment, adding a blank line or
// trimming trailing spaces cannot move a score, and a hash over the raw text made every such edit
// (and every pure refactor's comments) retire every cached score. Only WHOLE-LINE comments and blank
// lines are dropped. A comment trailing code stays in the hash, so the error that remains is an
// unneeded bump and never a missed one, and a `//` inside a regex or a string is never mistaken for
// a comment because the line starts with code. The rule sources have no multi-line template literals,
// which is what would make a line that starts with `//` part of the code.
function withoutProse(source) {
  const kept = [];
  let inBlock = false;
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      inBlock = false;
      line = line.slice(end + 2).trim();            // code after the close stays
      if (!line) continue;
      kept.push(line);
      continue;
    }
    if (line.startsWith('/*')) {
      const end = line.indexOf('*/');
      if (end < 0) { inBlock = true; continue; }
      line = line.slice(end + 2).trim();
      if (!line) continue;
      kept.push(line);
      continue;
    }
    if (!line || line.startsWith('//')) continue;
    kept.push(raw.replace(/\s+$/, ''));
  }
  return kept.join('\n');
}
const hashOf = sources => {
  const blob = sources.map(([name, text]) => `// ${name}\n` + withoutProse(text)).join('\n');
  return fnv(blob) + '-' + blob.length;
};
const actual = hashOf(RULE_SOURCES.map(f => [f, fs.readFileSync(src(f), 'utf8')]));

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log('  ok  ' + label); }
  catch (e) { failed++; console.error('  FAIL ' + label + '\n       ' + e.message); }
};

console.log('rules revision');
check('RULES_REVISION is a dated string', () => {
  assert.match(revision.RULES_REVISION, /^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/, `got ${JSON.stringify(revision.RULES_REVISION)}`);
});
check('RULES_HASH matches the rule sources on disk', () => {
  assert.strictEqual(revision.RULES_HASH, actual,
    `the rule sources changed. In src/engine/db/revision.js bump RULES_REVISION (today's date, `
    + `or today's date with a suffix if it already is today) and set RULES_HASH = '${actual}'. `
    + `Every cached score will then be retired, which is the point.`);
});
check('prose does not move the hash and code does', () => {
  const base = 'const A = /x\\/\\//;\nfunction f(a) {\n  return a + 1;\n}\n';
  const h = text => hashOf([['x.js', text]]);
  assert.equal(h('// a note\n\n' + base + '/* more\n   prose */\n\n'), h(base), 'whole-line comments and blank lines are not code');
  assert.equal(h(base.replace(/\n/g, '\r\n')), h(base), 'line endings');
  assert.equal(h(base.replace('return a + 1;', 'return a + 1;   ')), h(base), 'trailing spaces');
  assert.equal(h('/* one line */\n' + base), h(base));
  assert.notEqual(h(base.replace('a + 1', 'a + 2')), h(base), 'a changed constant');
  assert.notEqual(h(base.replace('/x\\/\\//', '/y\\/\\//')), h(base), 'a changed regex containing //');
  assert.notEqual(h(base.replace('a + 1;', 'a + 1; // note')), h(base), 'a comment trailing code stays hashed: an unneeded bump, never a missed one');
  assert.notEqual(h(base.replace('  return a + 1;', '  /* x */ return a + 1;')), h(base), 'code after a one-line block comment is code');
  assert.notEqual(h('/* open\n close */ const B = 2;\n' + base), h(base), 'code after a block comment closes is code');
  assert.notEqual(h(base.replace('  return', '    return')), h(base), 'indentation is not stripped');
});
check('the score cache fingerprints on the revision', () => {
  require(src('engine/categories.js'));
  const cache = require(src('engine/db/score-cache.js'));
  const before = cache.fingerprint({});
  const saved = AIR.db.revision.RULES_REVISION;
  AIR.db.revision.RULES_REVISION = saved + '.test';
  try { assert.notStrictEqual(cache.fingerprint({}), before, 'fingerprint ignored the revision'); }
  finally { AIR.db.revision.RULES_REVISION = saved; }
  assert.strictEqual(cache.fingerprint({}), before);
});

if (failed) { console.error(`\n${failed} failing`); process.exit(1); }
console.log('\nall passed');
