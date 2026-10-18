// Every function that runs regular expressions over page or label text must stay fast on hostile
// input: a pattern that backtracks badly freezes the Amazon tab it runs in. The size pattern once
// took 226 seconds on a run of 6,000 digits (tests/storefronts.test.js). Each call here must take
// well under a second on every input, with room for a CI runner about twice as slow as a laptop: the
// limit is 400 ms here because a path that took 600 ms locally failed CI at 1,100 ms.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.self = global;
require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const extract = require('../src/content/extract.js');
const ingestible = require('../src/engine/db/ingestible.js');
const allergens = require('../src/engine/db/allergens.js');
const ocr = require('../src/engine/db/ocr-text.js');
const U = require('../src/engine/db/unit-price.js');
const R = require('../src/engine/db/sorted-results.js');

const LENGTH = 6000;   // extract.js MAX_LEN, the longest list anything is handed
const PIECES = ['1', '1,', '1.', ' ', ',', 'a', 'oil ', '(', 'ingredients\n', 'Ingredients: ', 'contains ',
  '-', '%', '\n', 'natural ', 'x ', '1 ', '€', 'fl oz ', 'kcal ', 'salt ',
  '(a, ', 'may contain (', 'b (c), ', ')', 'arom'];
const INPUTS = PIECES.map(p => p.repeat(Math.ceil(LENGTH / p.length)).slice(0, LENGTH) + '!');
// A quantity is read from the end of an entry, so a long run that ends the way a quantity does (a digit,
// a percent sign, a separator and a number) must not be rescanned from every start position.
for (const tail of ['', ' %', '%', ' - 1', ' per cent']) INPUTS.push('1'.repeat(LENGTH) + tail);
// A few fixed shuffles of the same pieces (deterministic, so a failure reproduces).
let seed = 7;
const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
for (let i = 0; i < 4; i++) INPUTS.push(Array.from({ length: LENGTH }, () => PIECES[rand(PIECES.length)][0]).join(''));

const doc = text => ({
  title: text.slice(0, 100), querySelectorAll: () => [],
  querySelector: sel => (/important-information|feature-bullets/.test(sel)
    ? { innerText: text, textContent: text, querySelector: () => null, querySelectorAll: () => [] } : null),
});
const PATHS = {
  'engine.score': t => engine.score({ ingredients_text: t, name: t.slice(0, 300), labels: t.slice(0, 1000) },
    { allergens: ['milk', 'soy'], diets: ['vegan'], avoidList: ['red 40'] }),
  'extract.looksLikeIngredients': t => extract.looksLikeIngredients(t, t.slice(0, 200)),
  // The panel parser only reads text under a nutrition heading, so give it one.
  'extract.nutritionFacts': t => extract.nutritionFacts({ querySelector: sel => (/nic-nutrition/.test(sel)
    ? { innerText: 'Nutrition Facts kcal ' + t } : null) }),
  'extract.extract (text sweeps)': t => extract.extract(doc(t), { foodOnly: false }),
  'allergens.detect': t => allergens.detect([t, ...t.split(',')], allergens.ALLERGENS.map(a => a.id), allergens.DIETS.map(d => d.id)),
  'ingestible.looksNonFoodFromTitle': t => ingestible.looksNonFoodFromTitle(t.slice(0, 400)),
  'ingestible.assessSearch': t => ingestible.assessSearch({ query: t.slice(0, 200), alias: '', label: '' }),
  'ocrText.tidyOcr': t => ocr.tidyOcr(t),
  'ocrText.ingredientsFromOcr': t => ocr.ingredientsFromOcr(t),
  'unitPrice.unitPriceFor': t => U.unitPriceFor({ title: t.slice(0, 400), text: t, listingPrice: 5 }, { unitMissing: 'infer-more' }, 'www.amazon.de'),
  'sortedResults.parseMoney': t => R.parseMoney(t, 'www.amazon.com.br'),
};

for (const [name, run] of Object.entries(PATHS)) {
  test(`${name} stays fast on hostile input`, () => {
    for (const text of INPUTS) {
      const start = process.hrtime.bigint();
      run(text);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(ms < 400, `${ms.toFixed(0)} ms on ${JSON.stringify(text.slice(0, 16))}…`);
    }
  });
}
