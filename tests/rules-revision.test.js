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
const blob = RULE_SOURCES.map(f => `// ${f}\n` + fs.readFileSync(src(f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
const actual = fnv(blob) + '-' + blob.length;

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
