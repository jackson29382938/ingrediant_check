// Evidence for docs/AUDIT-2026-11-15.md. Reads the engine only; no network, no writes.
// Run from any directory: node docs/audit-verification-2026-11-15.cjs
// Each line shows a label as a shopper would meet it beside the same list written plainly. "REPRODUCED"
// means the two differ as the audit describes; once a finding is fixed its line reads "fixed".
'use strict';
/* global console, process */
require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');

const read = (text, options) => engine.score({ name: '', ingredients_text: text }, options);
let reproduced = 0, total = 0;

// A format hides an ingredient when the list scores well above the plain one and still reads as readable.
function hidden(finding, plain, written) {
  const a = read(plain), b = read(written);
  const still = b.readable !== false && b.score >= a.score + 5;
  total++; if (still) reproduced++;
  console.log(`${still ? 'REPRODUCED' : 'fixed     '}  ${finding}: ${JSON.stringify(written)} scores ${b.score}; ${JSON.stringify(plain)} scores ${a.score}`);
}

function flag(finding, id, ingredient, expected) {
  const got = read(`Water, ${ingredient}, salt`, { allergens: [id] }).flags.length > 0;
  const still = got !== expected;
  total++; if (still) reproduced++;
  console.log(`${still ? 'REPRODUCED' : 'fixed     '}  ${finding}: "${ingredient}" ${got ? 'raises' : 'raises no'} ${id} warning`);
}

console.log('--- 1. two ingredients joined by "and" where a rule reads one of them');
hidden('1', 'Roasted peanuts, sugar, salt', 'Roasted peanuts and sugar, salt');
hidden('1', 'Wheat flour, sugar', 'Wheat flour and sugar');
hidden('1', 'Water, citric acid, sugar', 'Water, citric acid and sugar');
hidden('1', 'Nonfat milk, dextrose', 'Nonfat milk and dextrose');

console.log('--- 2. "and" before the last ingredient');
hidden('2', 'Milk, cream, cane sugar', 'Milk, cream, and cane sugar');
hidden('2', 'Water, salt, citric acid, sugar', 'Water, salt, citric acid, and sugar');

console.log('--- 3. typographic hyphens');
hidden('3', 'Water, high-fructose corn syrup, salt', 'Water, high‑fructose corn syrup, salt');
hidden('3', 'Water, glucose-fructose syrup, salt', 'Water, glucose–fructose syrup, salt');

console.log('--- 4. footnote marks the parser does not strip');
hidden('4', 'Oats, cane sugar, salt', 'Oats, cane sugar1, salt');
hidden('4', 'Oats, cane sugar, salt', 'Oats, cane sugar<sup>1</sup>, salt');
hidden('4', 'Oats, cane sugar, salt', 'Oats, cane sugar+, salt');
hidden('4', 'Oats, cane sugar, salt', 'Oats, cane sugar^, salt');
hidden('4', 'Oats, cane sugar, salt', 'Oats, cane sugar◊, salt');

console.log('--- 5. text in angle brackets is removed as an HTML tag');
hidden('5', 'Oats, red 40, salt', 'Oats, <red 40>, salt');

console.log('--- 6. "less than" written with a sign or without "of"');
hidden('6', 'Oats, sugar (<2%), salt', 'Oats, <2% sugar, salt');
hidden('6', 'Oats, less than 2% of sugar, salt', 'Oats, less than 2%: sugar, salt');

console.log('--- 7. allergen warnings');
for (const [id, word] of [['wheat', 'enriched flour'], ['wheat', 'all-purpose flour'], ['wheat', 'udon'], ['treeNut', 'filberts'],
  ['treeNut', 'chestnuts'], ['fish', 'flounder'], ['fish', 'sole'], ['milk', 'caseinates'], ['shellfish', 'langostino'], ['sesame', 'tehina']]) {
  flag('7 missed', id, word, true);
}
for (const [id, word] of [['milk', 'butter beans'], ['milk', 'cream of coconut'], ['shellfish', 'oyster mushrooms'], ['wheat', 'gluten-free oats']]) {
  flag('7 false alarm', id, word, false);
}

console.log('--- 12. time on a long hyphenated run (no label is this long; a hostile page can be)');
const started = process.hrtime.bigint();
read('a-'.repeat(20000));
console.log(`            40,000 characters scored in ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(0)} ms`);

console.log(`\n${reproduced} of ${total} checks reproduce.`);
