// Evidence for docs/AUDIT-2026-11-19.md. Reads the engine only; no network, no writes.
// Run from any directory: node docs/audit-verification-2026-11-19.cjs   (about 20 seconds: finding 7 is timed)
// Each line compares a label as a shopper would meet it with the same food written the way the rulebase
// already reads it. "REPRODUCED" means the two differ as the audit describes; once a finding is fixed its line
// reads "fixed". Pass --quick to skip the timed checks.
'use strict';
/* global console, process */
require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');

const read = (text, options) => engine.score({ name: '', ingredients_text: text }, options);
const quick = process.argv.includes('--quick');
let reproduced = 0, total = 0;
const report = (still, line) => { total++; if (still) reproduced++; console.log(`${still ? 'REPRODUCED' : 'fixed     '}  ${line}`); };

// The written form scores well above the plain form and still reads as readable.
function hidden(finding, plain, written) {
  const a = read(plain), b = read(written);
  report(b.readable !== false && b.score >= a.score + 5,
    `${finding}: ${JSON.stringify(written)} scores ${b.score}; ${JSON.stringify(plain)} scores ${a.score}`);
}

// An entry is read as a whole, unprocessed food: the list is NOVA 1 and nothing is charged for it.
function whole(finding, entry) {
  const r = read(`${entry}, water`);
  const charged = r.bad.some(b => (b.ing || '').includes(entry.toLowerCase().split(' ').pop()));
  report(r.nova === 1 && !charged, `${finding}: "${entry}, water" is NOVA ${r.nova}, score ${r.score}${charged ? '' : ', nothing charged'}`);
}

function flag(finding, kind, id, entry, expected) {
  const r = read(`Water, ${entry}, salt`, kind === 'diet' ? { diets: [id] } : { allergens: [id] });
  const got = r.flags.length > 0;
  report(got !== expected, `${finding}: "${entry}" ${got ? 'raises' : 'raises no'} ${id} warning`);
}

function timed(finding, piece) {
  const text = piece.repeat(Math.ceil(6000 / piece.length)).slice(0, 6000) + '!';
  const start = process.hrtime.bigint();
  engine.score({ ingredients_text: text, name: text.slice(0, 300) });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  report(ms >= 400, `${finding}: 6,000 characters of ${JSON.stringify(piece)} scored in ${ms.toFixed(0)} ms (tests/hostile-input.test.js allows 400)`);
}

console.log('--- 1. a processed animal or dairy food read as the whole food');
for (const entry of ['Sweetened condensed milk', 'Chocolate milk', 'Ice cream', 'Sweetened whipped cream', 'Mechanically separated chicken',
  'Chicken nuggets', 'Processed cheese', 'Pasteurized process cheese food', 'Imitation cheese', 'Yogurt coating', 'Frozen yogurt']) whole('1', entry);
hidden('1', 'Milk, sugar, coffee', 'Sweetened condensed milk, coffee');

console.log('--- 2a. a sugar or sweetener no rule reads');
for (const [plain, written] of [['sugar', 'muscovado'], ['sugar', 'jaggery'], ['sugar', 'panela'], ['sugar', 'rapadura'], ['sugar', 'sucanat'],
  ['sugar', 'turbinado'], ['glucose-fructose syrup', 'isoglucose'], ['dextrose', 'dextrose monohydrate'], ['fructose', 'fruit sugar'],
  ['sugar', 'trehalose'], ['sugar', 'isomaltulose'], ['acesulfame K', 'acesulphame K'], ['reb A', 'rebaudioside A'],
  ['monk fruit extract', 'luo han guo'], ['sucralose', 'thaumatin'], ['sucralose', 'neohesperidin DC'], ['maltodextrin', 'dextrin']])
  hidden('2a', `Oats, ${plain}, salt`, `Oats, ${written}, salt`);
console.log('--- 2b. a sugar the vocabulary counts as read ("syrup", "juice", "malt") and no rule charges');
for (const [plain, written] of [['glucose syrup', 'glucose syrup solids'], ['fructose', 'fructose syrup'], ['dextrose', 'dextrose syrup'],
  ['invert sugar', 'invert syrup'], ['sugar', 'sugar syrup'], ['barley malt syrup', 'malt syrup'], ['rice syrup', 'rice malt syrup'],
  ['coconut sugar', 'coconut syrup'], ['coconut sugar', 'palm sugar'], ['cane sugar', 'dehydrated cane juice'],
  ['grape juice concentrate', 'white grape juice concentrate'], ['apple juice concentrate', 'concentrated apple juice']])
  hidden('2b', `Oats, ${plain}, salt`, `Oats, ${written}, salt`);
// Sugar split across four names: penalised when the names are known, rewarded when they are not (one plain "Sugar"
// first scores 63).
hidden('2', 'Whole grain oats, cocoa, cane sugar, brown sugar, dextrose, fructose, salt',
  'Whole grain oats, cocoa, cane sugar, muscovado, dextrose monohydrate, fructose syrup, salt');

console.log('--- 3. the same additive under a second name');
for (const [plain, written] of [['modified food starch', 'food starch-modified'], ['E1422', 'acetylated distarch adipate'],
  ['E1442', 'hydroxypropyl distarch phosphate'], ['soybean oil', 'soya oil'], ['corn oil', 'maize oil'], ['sunflower oil', 'sunflower seed oil'],
  ['sweetener', 'artificial sweetener'], ['red 40', 'red dye 40'], ['red 40', 'red dye #40'], ['disodium phosphate', 'sodium acid pyrophosphate'],
  ['sodium tripolyphosphate', 'sodium hexametaphosphate'], ['powdered cellulose', 'cellulose powder'], ['textured soy protein', 'textured wheat protein'],
  ['wheat flour', 'all-purpose flour'], ['wheat flour', 'plain flour'], ['mono- and diglycerides', 'sucrose esters of fatty acids']])
  hidden('3', `Oats, ${plain}, salt`, `Oats, ${written}, salt`);

console.log('--- 4. Indian labels (amazon.in): INS numbers and FSSAI wording');
hidden('4', 'Sugar, wheat flour, tartrazine', 'Sugar, wheat flour, colour (INS 102)');
hidden('4', 'Water, sugar, caramel color', 'Water, sugar, colour (INS 150d)');
hidden('4', 'Sugar, wheat flour, artificial colour', 'Sugar, wheat flour, permitted synthetic food colours');
hidden('4', 'Wheat flour, glucose syrup, salt', 'Wheat flour, liquid glucose, salt');

console.log('--- 5. "percent" written as a word');
hidden('5', 'Oats, sugar, salt', 'Oats, contains 2 percent or less of sugar, salt');
hidden('5', 'Oats, sugar, salt', 'Oats, contains less than 2 percent of sugar, salt');

console.log('--- 6. allergen and diet warnings');
for (const [id, entry] of [['wheat', 'soy sauce'], ['wheat', 'teriyaki sauce'], ['sesame', 'hummus'], ['milk', 'white chocolate'],
  ['egg', 'mayo'], ['egg', 'hollandaise'], ['fish', 'imitation crab'], ['fish', 'caesar dressing'], ['peanut', 'satay sauce'],
  ['soy', 'gochujang'], ['soy', 'hoisin sauce'], ['sulfite', 'wine']]) flag('6 missed', 'allergen', id, entry, true);
for (const [kind, id, entry] of [['allergen', 'milk', 'vegan cheese'], ['allergen', 'milk', 'dairy-free cheese'], ['diet', 'vegan', 'vegan cheese'],
  ['diet', 'vegan', 'plant-based milk'], ['allergen', 'egg', 'egg-free mayonnaise']]) flag('6 false alarm', kind, id, entry, false);

console.log('--- 7. time to score a long run of words broken at a hyphen (inside the 6,000-character extractor limit)');
if (quick) console.log('            skipped (--quick)');
else for (const piece of ['ab- ', 'partially hydro- genated ', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa-\n']) timed('7', piece);

console.log('--- 8. characters that hide an ingredient');
hidden('8', 'Water, high-fructose corn syrup, salt', 'Water, high−fructose corn syrup, salt');
hidden('8', 'Oats, sugar, salt', 'Oats—sugar—salt');
hidden('8', 'Oats, cane sugar, salt', 'Oats, сane sugar, salt');

console.log(`\n${reproduced} of ${total} checks reproduce.`);
