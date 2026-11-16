// Evidence for docs/AUDIT-2026-11-16.md. Reads the engine and the unit-price module only; no network, no writes.
// Run from any directory: node docs/audit-verification-2026-11-16.cjs
// "REPRODUCED" means the code still behaves as the audit describes; once a finding is fixed its line reads "fixed".
'use strict';
/* global console */
require('../src/engine/db/_module.js');
require('../src/engine/db/storefronts.js');
const engine = require('../src/engine/score.js');
const unit = require('../src/engine/db/unit-price.js');

const read = (text, options) => engine.score({ name: '', ingredients_text: text }, options);
let reproduced = 0, total = 0;
const line = (still, text) => { total++; if (still) reproduced++; console.log(`${still ? 'REPRODUCED' : 'fixed     '}  ${text}`); };

// The package size a title states, in ounces or fluid ounces, against what the parser reads.
function size(title, ounces, store = 'www.amazon.com') {
  const got = unit.parseQuantity(title, store);
  const read = got ? got.ounces : null;
  const right = read != null && Math.abs(read - ounces) / ounces < 0.01;
  // Declining (null) is safe: no unit price is shown. Only a wrong size counts.
  line(read != null && !right, `1: ${JSON.stringify(title)} holds ${ounces} oz; read as ${read == null ? 'nothing (declined)' : read.toFixed(2) + ' oz'}`);
}

// A format hides an ingredient when the list scores well above the plain one and still reads as readable.
function hidden(finding, plain, written) {
  const a = read(plain), b = read(written);
  line(b.readable !== false && b.score >= a.score + 5, `${finding}: ${JSON.stringify(written)} scores ${b.score}; ${JSON.stringify(plain)} scores ${a.score}`);
}

console.log('--- 1. a pack multiplier the unit price does not read');
size('Black Beans 15.5 oz (Case of 12)', 186);
size('Protein Bars 2.12 oz bars, box of 12', 25.44);
size('Mac & Cheese 7.25 oz Box, 5 Boxes', 36.25);
size('Sparkling Water 8 x 12 fl oz', 96);
size('Peanut Butter Twin Pack 2 x 40 oz', 80);
size('Milk, 1/2 gallon', 64);
size('Nudeln 500 g (5er Pack)', 88.18, 'www.amazon.de');
size('Mineralwasser 6 x 1,5 l', 304.33, 'www.amazon.de');
size('Reis 1.000 g', 35.27, 'www.amazon.de');
size('P\u00e2tes 500 g (Lot de 6)', 105.82, 'www.amazon.fr');
size('Pasta 500 g (Confezione da 6)', 105.82, 'www.amazon.it');
size('Arroz 1 kg (Paquete de 5)', 176.37, 'www.amazon.es');

console.log('--- 2. an unnamed additive after a joining word');
hidden('2', 'Oats, salt, preservative', 'Oats, salt, and preservative');
hidden('2', 'Oats, salt, stabilizer', 'Oats, salt, and stabilizer');

console.log('--- 3. a purpose written after the ingredient');
hidden('3', 'Milk, salt, sugar', 'Milk, salt, sugar added');
hidden('3', 'Peaches, water, sugar', 'Peaches, water, sugar added to promote color retention');
hidden('3', 'Oats, dextrose, salt', 'Oats, dextrose for browning, salt');

console.log('--- 4. a footnote digit after a dye');
hidden('4', 'Oats, red 40, salt', 'Oats, red 401, salt');
hidden('4', 'Oats, yellow 5, salt', 'Oats, yellow 51, salt');

console.log('--- 5. "Contains <a capped ingredient>" read as an allergen line');
hidden('5', 'Oats, salt, soybean oil', 'Oats, salt. Contains soybean oil.');
hidden('5', 'Oats, high fructose corn syrup, salt', 'Oats, contains high fructose corn syrup, salt');

console.log('--- 6. a denial written as a sentence');
{
  const denied = read('Oats, does not contain aspartame'), plain = read('Oats');
  line(denied.score <= plain.score - 20, `6: "Oats, does not contain aspartame" scores ${denied.score}; "Oats" scores ${plain.score}`);
  for (const [text, id] of [['Oats, salt. Contains no nuts.', 'treeNut'], ['Oats, salt. Does not contain peanuts.', 'peanut']]) {
    line(read(text, { allergens: [id] }).flags.length > 0, `6: ${JSON.stringify(text)} raises a ${id} warning`);
  }
}

console.log('--- 7. two formats the last release left');
hidden('7', 'Oats, glucose-fructose syrup, salt', 'Oats, glucose \u2013 fructose syrup, salt');
hidden('7', 'Eau, \u00e9mulsifiant, sel', 'Eau, <\u00e9mulsifiant>, sel');

console.log(`\n${reproduced} of ${total} checks reproduce.`);
