// The seven harness fixtures, asserted headlessly. Run: node tests/harness.test.js
//
// tests/harness.html renders these in a browser so the panel can be looked at. This file asserts
// the same fixtures reach the same VERDICT through the real extract() and score(), so the states
// stay correct without anyone opening a browser. Both read tests/harness-fixtures.json, so the
// page and the assertions cannot drift apart.
//
// The DOM shim reproduces the structure captured from live amazon.com on 2026-09-02.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
// extract.js degrades to "gate unavailable" when ingestible is absent, so it must be loaded here
// exactly as the manifest loads it — otherwise the food gate silently passes everything.
require(src('engine/db/ingestible.js'));
const engine = require(src('engine/score.js'));
const extract = require(src('content/extract.js'));
const FIXTURES = require('./harness-fixtures.json');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

const el = (text, kids) => ({
  innerText: text, textContent: text,
  querySelector: () => null, querySelectorAll: sel => (kids && kids[sel]) || [],
  children: [], closest: () => null,
});

// Builds the document the real extractor walks, from fixture data.
function docFor(f) {
  const cells = row => row.map(v => el(v));
  const table = {
    querySelectorAll: sel => (sel.includes('tr')
      ? (f.nutrition || []).map(row => ({ querySelectorAll: () => cells(row) }))
      : []),
  };
  const map = {
    '#productTitle': el(f.title),
    '#wayfinding-breadcrumbs_feature_div': el(f.crumbs),
    '#nic-ingredients-content': el(f.ingredients),
    '#nic-nutrition-summary-serving': f.serving ? el(f.serving) : null,
    '#nutritionalInfoAndIngredients_feature_div': el(''),
    '.nicDesktop': el(''),
    '#feature-bullets': el(f.bullets.join(' ')),
    '#detailBullets_feature_div': el('UPC : 039978049520 ASIN : B07C9KT113'),
    '#detailBullets_feature_div, #productDetails_detailBullets_sections1': el('UPC : 039978049520 ASIN : B07C9KT113'),
    '#important-information': null,
    '#bylineInfo': el('Visit the Store'),
  };
  return {
    title: f.title,
    querySelector(sel) {
      for (const part of String(sel).split(',').map(s => s.trim())) {
        if (part in map) return map[part];
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('table')) return f.nutrition ? [table] : [];
      if (sel.includes('nic-diet-type-logos-wrapper')) return f.pills.map(p => el(' ' + p + ' '));
      if (sel.includes('#feature-bullets li')) return f.bullets.map(b => el(b));
      return [];
    },
    createTreeWalker: () => ({ nextNode: () => null }),
  };
}

// Mirrors harness-fixtures.js run(), which mirrors content/main.js.
function verdictFor(f) {
  const doc = docFor(f);
  const data = extract.extract(doc, { asin: 'B07C9KT113', foodOnly: true });
  if (data.ingestible && !data.ingestible.ok) return { card: 'not-food', reason: data.ingestible.reason };
  if (!data.ok) return { card: 'failure', reason: data.reason };
  const result = engine.score({
    name: data.title, labels: data.labels, certifications: data.certifications,
    nutrition: data.nutrition, ingredients_text: data.text,
  }, {});
  if (result.parsed > 0 && result.coverage < 0.34) return { card: 'declined', coverage: result.coverage };
  return { card: 'scored', score: result.score, verdict: result.verdict, data, result };
}

const EXPECTED = {
  oats:    { card: 'scored', min: 85, certs: /USDA Organic/, nutrition: true },
  flakes:  { card: 'scored', max: 55, certs: /Kosher/, nutrition: true },
  chips:   { card: 'scored', max: 40, capped: true },
  beef:    { card: 'scored', min: 80, certs: /Grassfed/, provenance: true },
  shampoo: { card: 'not-food' },
  spanish: { card: 'declined' },
  none:    { card: 'failure' },
};

console.log('every harness fixture reaches the state the page shows');
for (const [key, want] of Object.entries(EXPECTED)) {
  check(key, () => {
    const f = FIXTURES[key];
    assert.ok(f, `fixture "${key}" is missing from harness-fixtures.json`);
    const got = verdictFor(f);
    assert.strictEqual(got.card, want.card,
      `expected the ${want.card} card, got ${got.card}${got.reason ? ' (' + got.reason + ')' : ''}`);
    if (want.min) assert.ok(got.score >= want.min, `scored ${got.score}, expected at least ${want.min}`);
    if (want.max) assert.ok(got.score <= want.max, `scored ${got.score}, expected at most ${want.max}`);
    if (want.capped) assert.ok(got.result.cap, 'expected a cap to bind');
    if (want.certs) assert.ok(want.certs.test(got.data.certifications || ''),
      `certifications were "${got.data.certifications}"`);
    if (want.nutrition) assert.ok(got.data.nutrition && Object.keys(got.data.nutrition).length >= 2,
      `nutrition did not parse: ${JSON.stringify(got.data.nutrition)}`);
    if (want.provenance) assert.ok(got.result.provenance, 'expected a provenance block');
  });
}

console.log('\nthe page and these assertions read the same fixtures');
check('every fixture in the JSON is covered here', () => {
  const uncovered = Object.keys(FIXTURES).filter(k => !(k in EXPECTED));
  assert.strictEqual(uncovered.length, 0, `not asserted: ${uncovered.join(', ')}`);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
