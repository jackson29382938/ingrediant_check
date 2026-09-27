// No rule may put \b against an accented letter.
// Run: node --test tests/accent-boundaries.test.js
//
// \b only sees ASCII word characters, so it never falls between a space and "é", or after "é" at
// the end of a word. "amidon modifi[ée]\b" therefore matched "amidon modifie" but never the real
// spelling "amidon modifié", and French modified starch went uncharged; "\b[äa]ppelsyra" and
// "\b(?:[óo]leo" had the same fault at the start of the word. The explicit boundaries used
// elsewhere, (?<![a-zà-ÿ…]) and (?![a-zà-ÿ…]), see these letters.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

global.self = global;
require(path.join(__dirname, '..', 'src', 'engine', 'db', '_module.js'));
const engine = require('../src/engine/score.js');
const DB = ['additives', 'oils', 'sugars', 'labels', 'allergens', 'provenance', 'ingestible', 'ocr-text'];

const ACCENTED = 'ßà-ÿœ\\u0100-\\u017f';   // ß sits just below à
// An accented letter (alone, or in a class with one) then \b, allowing ?, *, +, a closing group, and
// optional letters in between: "hydrog[ée]n[ée]e?\b" matched "hydrogénée" but never "hydrogéné".
const AFTER = new RegExp(`(\\[[^\\]]*[${ACCENTED}][^\\]]*\\]|[${ACCENTED}])[?*+]?(?:[a-z][?*])*(?:\\)[?*+]?)?\\\\b`, 'g');
// \b then an accented letter, or a class that starts with one, allowing an opening (?: group.
const BEFORE = new RegExp(`\\\\b(?:\\(\\?:)?(\\[[${ACCENTED}][^\\]]*\\]|[${ACCENTED}])`, 'g');

function patterns() {
  const seen = new Set(), found = [];
  const walk = (o, where, depth) => {
    if (!o || depth > 5) return;
    if (o instanceof RegExp) {
      if (!seen.has(o)) { seen.add(o); found.push([where, o]); }
      return;
    }
    if (typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], `${where}.${k}`, depth + 1);
  };
  for (const name of DB) walk(require(`../src/engine/db/${name}.js`), name, 0);
  walk(engine, 'score', 0);
  return found;
}

test('the rule modules expose their patterns to this check', () => {
  assert.ok(patterns().length > 300, 'fewer patterns than expected: the walk no longer reaches the rules');
});

test('no pattern puts \\b against an accented letter', () => {
  const bad = [];
  for (const [where, re] of patterns()) {
    for (const probe of [AFTER, BEFORE]) {
      probe.lastIndex = 0;
      let m;
      while ((m = probe.exec(re.source))) bad.push(`${where}: …${re.source.slice(Math.max(0, m.index - 30), m.index + m[0].length)}`);
    }
  }
  assert.deepEqual(bad, []);
});
