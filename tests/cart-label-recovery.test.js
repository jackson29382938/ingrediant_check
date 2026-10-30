'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine/db/_module.js');
require('../src/engine/db/ingestible.js');
const engine = require('../src/engine/score.js');
global.AIR.engine = engine;
const extract = require('../src/content/extract.js');
const { createDocument } = require('./pages/load.js');
const evidence = require('./amazon-cart-label-evidence.json');
const ocr = require('../src/engine/db/ocr-text.js');
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
for (const record of evidence.records) test(`published cart label is readable: ${record.title}`, () => {
  const doc = createDocument(`<h1 id="productTitle">${escapeHtml(record.title)}</h1><input id="ASIN" value="${record.asin}"><div id="nic-ingredients-content">${escapeHtml(record.ingredients)}</div>`);
  const read = extract.extract(doc, { asin: record.asin, foodOnly: false });
  assert.equal(read.ok, true);
  const result = engine.score({ name: read.title, ingredients_text: read.text, advisory_text: read.advisoryText });
  assert.equal(result.readable, true);
  if (record.asin !== 'B07X2643L7') assert.equal(result.coverage, 1);
  assert.ok(result.parsed >= 1);
});
test('literal, encoded and numeric label breaks keep cookie ingredients separate from cross-contact warnings', () => {
  for (const br of ['<br/>', '<BR>', '&lt;br/&gt;', '&#60;br/&#62;', '&#x3c;br/&#x3e;']) {
    const split = extract.splitAdvisory(`wheat flour, sugar, cocoa.${br}${br}CONTAINS: WHEAT, SOY${br}MAY CONTAIN: PEANUTS`);
    assert.match(split.ingredients, /wheat flour, sugar, cocoa/);
    assert.doesNotMatch(split.ingredients, /may contain/i);
    assert.match(split.advisory, /MAY CONTAIN: PEANUTS/);
    const result = engine.score({ ingredients_text: split.ingredients, advisory_text: split.advisory }, { allergens: ['wheat', 'soy', 'peanut'] });
    assert.deepEqual(result.flags.map(f => f.id).sort(), ['peanut', 'soy', 'wheat']);
  }
});
test('certified ingredient qualifiers retain real ingredients and do not make unknown foods readable', () => {
  for (const text of ['Certified organic pomegranate powder', 'Certified USDA Organic Pomegranate Powder']) {
    const result = engine.score({ ingredients_text: text });
    assert.equal(result.readable, true);
    assert.equal(result.parsed, 1);
  }
  for (const text of ['certified organic', 'certified organic mysteryroot', 'organic mysteryroot', 'certified gluten-free']) assert.equal(engine.score({ ingredients_text: text }).readable, false, text);
  assert.equal(engine.score({ ingredients_text: 'oats, certified organic partially hydrogenated soybean oil' }).score, engine.score({ ingredients_text: 'oats, partially hydrogenated soybean oil' }).score);
});
test('recognized fruit names and botanical aliases retain one identity without hiding other bracket ingredients', () => {
  for (const [plain, twin] of [['watermelon', 'watermelon (Citrullus lanatus)'], ['jujube', 'jujube (Ziziphus jujuba)'], ['pomegranate powder', 'pomegranate powder (Punica granatum)']]) {
    const a = engine.score({ ingredients_text: plain }), b = engine.score({ ingredients_text: twin });
    assert.equal(a.readable, true); assert.equal(b.readable, true); assert.equal(a.score, b.score); assert.equal(b.parsed, 1);
  }
  for (const ingredients_text of ['Jujube Dates', 'Sun-Dried Red Dates', 'Dried Chinese Dates', 'Cut Watermelon']) assert.equal(engine.score({ ingredients_text }).readable, true, ingredients_text);
  assert.equal(engine.score({ ingredients_text: 'pomegranate powder (unidentified additive)' }).coverage, 0.5);
  assert.ok(engine.score({ ingredients_text: 'watermelon (sugar)' }).score < engine.score({ ingredients_text: 'watermelon' }).score);
  for (const ingredients_text of ['watermelon flavor', 'jujube extract', 'mysteryroot (Punica granatum)']) assert.ok(engine.score({ ingredients_text }).nova > 1, ingredients_text);
});
test('short ingredient photos recover jujubes and common single foods without accepting OCR noise', () => {
  for (const text of ['Jujubes', 'Milk', 'Oats', 'Salt']) {
    assert.equal(ocr.ingredientsFromOcr('INGREDIENTS: ' + text), text);
    assert.equal(engine.score({ ingredients_text: text }).readable, true);
  }
  for (const text of ['NOTE', 'ABCD', '???', '']) assert.equal(ocr.ingredientsFromOcr('INGREDIENTS: ' + text), null);
});
