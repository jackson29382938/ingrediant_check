'use strict';
// Labels as they are printed. The first version of the personal-care rubric was tested on one-line
// fixtures ("Water, sodium fluoride, sorbitol"); the labels people shop for read differently. Three
// of those conventions hid ingredients from the shared food parser, so the product looked cleaner
// than it was, or was declined as unreadable:
//   - a US Drug Facts block: "Active ingredient: X 0.24% Purpose: Y. Inactive ingredients: A, B"
//   - INCI joins and translations: "(and)", "Water (Aqua)", "Aqua/Water/Eau"
//   - the length of a real list (20+ names, mostly chemistry no word list will ever cover)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../src/engine/score.js');
const ingestible = require('../src/engine/db/ingestible.js');
const ratings = require('../src/engine/db/product-ratings.js');
const productCache = require('../src/engine/db/product-cache.js');
const sortedResults = require('../src/engine/db/sorted-results.js');
globalThis.AIR.db.allergens = require('../src/engine/db/allergens.js');

const rate = (name, ingredients_text, options = {}, supplement_facts) =>
  engine.score({ name, ingredients_text, ...(supplement_facts ? { supplement_facts } : {}) }, options);
const entriesOf = text => engine.parseEntries(ingestible.prepareLabel(text).text).filter(e => !e.parent).map(e => e.ing);

test('a Drug Facts block is read as the active ingredient followed by the inactive list', () => {
  const tooth = ingestible.prepareLabel('Active ingredient: Sodium fluoride 0.24% (0.14% w/v fluoride ion) Purpose: Anticavity. '
    + 'Inactive ingredients: dicalcium phosphate dihydrate, water, glycerin, sodium lauryl sulfate');
  assert.deepEqual(tooth.actives, ['Sodium fluoride']);
  assert.equal(tooth.partial, false);
  assert.deepEqual(entriesOf('Active ingredient: Sodium fluoride 0.24% Purpose: Anticavity. Inactive ingredients: water, glycerin'),
    ['sodium fluoride', 'water', 'glycerin']);
  // The antiperspirant sampled lost its active ingredient altogether when read as food.
  assert.ok(entriesOf('Active Ingredient: Aluminum Zirconium Tetrachlorohydrex GLY (20%) Purpose: Antiperspirant. '
    + 'Inactive Ingredients: Cyclopentasiloxane, Stearyl Alcohol, Talc').includes('aluminum zirconium tetrachlorohydrex gly'));
  assert.deepEqual(entriesOf('Active Ingredients: Eucalyptol 0.092%, Menthol 0.042%, Thymol 0.064%. Inactive Ingredients: Water, Alcohol (21.6%)')
    .slice(0, 4), ['eucalyptol', 'menthol', 'thymol', 'water']);
  assert.deepEqual(entriesOf('Inactive ingredients: water, glycerin'), ['water', 'glycerin']);
});

test('a Drug Facts table flattened to text keeps its active ingredient', () => {
  // The printed table puts "Active ingredient" and "Purpose" in one header row and the values below it, so
  // the text begins with the word "Purpose" and the name follows it.
  const table = 'Drug Facts Active ingredient Purpose Sodium fluoride 0.24% (0.14% w/v fluoride ion) Anticavity Uses aids in the prevention of dental cavities '
    + 'Warnings Keep out of reach of children Directions adults brush teeth Inactive ingredients water, sorbitol, hydrated silica, sodium lauryl sulfate, flavor';
  const entries = entriesOf(table);
  assert.ok(entries.includes('sodium fluoride'), JSON.stringify(entries));
  assert.ok(entries.includes('water') && entries.includes('sodium lauryl sulfate'), JSON.stringify(entries));
  assert.ok(!entries.some(e => /warnings|directions|keep out/.test(e)), 'the use, warning and direction text is not ingredients');
  assert.equal(rate('Fluoride toothpaste', table).score, 80);
  const antiperspirant = 'Drug Facts Active ingredient Purpose Aluminum zirconium tetrachlorohydrex GLY (20%) Antiperspirant Uses reduces underarm perspiration Inactive ingredients cyclopentasiloxane, stearyl alcohol, talc';
  assert.equal(rate('Antiperspirant deodorant', antiperspirant).score, 80);
});

test('a label that names only its active ingredient is flagged partial', () => {
  assert.equal(ingestible.prepareLabel('Active ingredient: Sodium fluoride 0.24% Purpose: Anticavity').partial, true);
  const evidence = rate('Fluoride toothpaste', 'Active ingredient: Sodium fluoride 0.24% (0.14% w/v fluoride ion) Purpose: Anticavity');
  assert.equal(evidence.readable, true, 'the active ingredient is enough for the evidence index');
  assert.ok(evidence.good.some(row => /inactive ingredient/.test(row.why)), 'and says what it could not check');
  // A one-ingredient list would read as "100: nothing else in it", which the label does not say.
  for (const ratingStyle of ['minimal', 'preferences']) {
    const result = rate('Fluoride toothpaste', 'Active ingredient: Sodium fluoride 0.24% Purpose: Anticavity', { ratingStyle, avoidList: ['sulfate'] });
    assert.equal(result.readable, false, ratingStyle);
    assert.match(result.reason, /inactive ingredients/);
  }
});

test('INCI joins and translations do not hide or merge ingredients', () => {
  assert.deepEqual(entriesOf('Water (Aqua), Glycerin, Sodium Lauryl Sulfate (and) Cocamidopropyl Betaine'),
    ['water', 'glycerin', 'sodium lauryl sulfate', 'cocamidopropyl betaine']);
  assert.deepEqual(entriesOf('Aqua/Water/Eau, Glycerin'), ['water', 'glycerin']);
  assert.equal(rate('Shampoo', 'Water (Aqua), Methylisothiazolinone', { avoidList: ['isothiazolinone'], ratingStyle: 'preferences' }).score, 80);
});

// Real label formats, each with the answer a reader would expect. The coverage figure is the share of
// entries recognized as ingredient names; tests/languages.test.js pins the gate that reads it.
const LABELS = [
  ['Colgate Cavity Protection Fluoride Toothpaste', 'Active ingredient: Sodium fluoride 0.24% (0.14% w/v fluoride ion) Purpose: Anticavity. Inactive ingredients: dicalcium phosphate dihydrate, water, glycerin, sodium lauryl sulfate, flavor, tetrasodium pyrophosphate, cellulose gum, sodium saccharin, titanium dioxide', 80],
  ['Crest Pro-Health Toothpaste', 'Active Ingredient: Stannous Fluoride 0.454% (0.15% w/v Fluoride Ion). Inactive Ingredients: Glycerin, Hydrated Silica, Propylene Glycol, PEG-6, Water, Zinc Lactate, Trisodium Phosphate, Flavor, Sodium Lauryl Sulfate, Sodium Gluconate, Xanthan Gum, Sucralose, Carrageenan, Zinc Oxide, Blue 1', 80],
  ['Listerine Cool Mint Antiseptic Mouthwash', 'Active Ingredients: Eucalyptol 0.092%, Menthol 0.042%, Methyl Salicylate 0.060%, Thymol 0.064%. Inactive Ingredients: Water, Alcohol (21.6%), Sorbitol Solution, Flavor, Poloxamer 407, Benzoic Acid, Zinc Chloride, Sodium Benzoate, Sodium Saccharin, Green 3', 80],
  ['Secret Clinical Strength Antiperspirant Deodorant', 'Active Ingredient: Aluminum Zirconium Tetrachlorohydrex GLY (20%) Purpose: Antiperspirant. Inactive Ingredients: Cyclopentasiloxane, Stearyl Alcohol, PPG-14 Butyl Ether, Hydrogenated Castor Oil, Talc, Fragrance, Behenyl Alcohol', 70],
  ['Head & Shoulders Classic Clean Dandruff Shampoo', 'Active Ingredient: Pyrithione Zinc 1% Purpose: Anti-dandruff. Inactive Ingredients: Water, Sodium Laureth Sulfate, Sodium Lauryl Sulfate, Zinc Carbonate, Glycol Distearate, Cocamide MEA, Dimethicone, Sodium Chloride, Fragrance, Sodium Xylenesulfonate', 70],
  ['Sulfate-Free Shampoo', 'Aqua, Sodium Cocoyl Isethionate, Cocamidopropyl Betaine, Coco-Glucoside, Glycerin, Panthenol, Citric Acid, Sodium Benzoate', 80],
  ['Sulfate Free Clarifying Shampoo', 'Water, Sodium C14-16 Olefin Sulfonate, Disodium Cocoamphodiacetate, Sodium Cocoyl Glutamate, Glycerin, Aloe Barbadensis Leaf Juice', 80],
  ['Ammonium Shampoo', 'Water, Ammonium Laureth Sulfate, Ammonium Lauryl Sulfate, Cocamide DEA, Glycol Distearate, Fragrance', 70],
  ['Silicone Free Conditioner', 'Aqua, Cetearyl Alcohol, Glycerin, Cetrimonium Chloride, Guar Hydroxypropyltrimonium Chloride, Panthenol, Hydrolyzed Keratin', 80],
  ['Irish Spring Original Bar Soap', 'Sodium Tallowate, Sodium Cocoate, Water, Fragrance, Sodium Chloride, Glycerin, Titanium Dioxide, Pentasodium Pentetate', 70],
  ['Pure-Castile Liquid Soap', 'Water, Potassium Cocoate, Potassium Olivate, Glycerin, Citric Acid, Mentha Piperita Oil', 80],
  // 20 names, most of them chemistry. Unreadable at 30% coverage before names were recognized by shape.
  ['CeraVe Moisturizing Cream', 'Aqua/Water, Glycerin, Cetearyl Alcohol, Caprylic/Capric Triglyceride, Cetyl Alcohol, Ceteareth-20, Petrolatum, Potassium Phosphate, Ceramide NP, Ceramide AP, Ceramide EOP, Carbomer, Dimethicone, Sodium Hyaluronate, Cholesterol, Phenoxyethanol, Disodium EDTA, Tocopherol, Xanthan Gum, Ethylhexylglycerin', 80],
];

test('real label formats are readable and rated', () => {
  for (const [name, text, expected] of LABELS) {
    const result = rate(name, text);
    assert.equal(engine.isReadable(result), true, `${name}: ${result.reason || result.coverage}`);
    assert.equal(result.score, expected, name);
  }
});

test('a label without the category function is declined, and says what it needed', () => {
  const natural = rate('Tom\'s Fluoride-Free Toothpaste', 'Calcium Carbonate, Glycerin, Water, Xylitol, Sodium Lauryl Sulfate, Zinc Citrate');
  assert.equal(natural.readable, false);
  assert.match(natural.reason, /fluoride ingredient/);
  assert.match(natural.reason, /open the full ingredient list/);
  assert.match(rate('Natural deodorant', 'Shea butter, coconut oil, arrowroot powder, candelilla wax').reason, /antiperspirant salt or a recognized deodorizing/);
  // ...but the preference and length styles do not need a function, only a readable list.
  assert.equal(rate('Tom\'s Fluoride-Free Toothpaste', 'Calcium Carbonate, Glycerin, Water, Xylitol', { ratingStyle: 'minimal' }).readable, true);
});

test('prose and gibberish in the ingredient box are not recognized as ingredients', () => {
  for (const text of ['unknown gibberish', 'Gentle cleansing formula enriched with natural botanicals for soft hair', 'Made with love, for soft skin']) {
    assert.equal(rate('Shampoo', text).readable, false, text);
  }
  for (const name of ['sodium laureth sulfate', 'ceteareth-20', 'ppg-14 butyl ether', 'ci 77891', 'caprylic/capric triglyceride', 'aloe barbadensis leaf juice']) {
    assert.equal(ratings.recognized(name), true, name);
  }
  for (const name of ['gentle cleansing formula enriched with natural botanicals for soft hair', 'for soft hair', 'unknown gibberish']) {
    assert.equal(ratings.recognized(name), false, name);
  }
});

test('documented cautions are charged once each, and only where they apply', () => {
  const caution = (name, text) => rate(name, text).bad.map(row => row.ing).filter(Boolean);
  assert.deepEqual(caution('Conditioner', 'Water, Behentrimonium Chloride, Methylchloroisothiazolinone, Methylisothiazolinone'),
    ['methylchloroisothiazolinone'], 'one charge for the whole family');
  assert.equal(rate('Conditioner', 'Water, Behentrimonium Chloride, Methylisothiazolinone').score, 70);
  assert.equal(rate('Conditioner', 'Water, Behentrimonium Chloride, DMDM Hydantoin, Quaternium-15').score, 70, 'two formaldehyde releasers are one charge');
  assert.equal(rate('Conditioner', 'Water, Behentrimonium Chloride, Polyquaternium-10').score, 80, 'polyquaternium-10 is not quaternium-15');
  // Triclosan is charged on a wash or soap, where the FDA acted, and not on a toothpaste.
  assert.equal(rate('Hand soap', 'Water, Sodium Laureth Sulfate, Triclosan').score, 70);
  assert.equal(rate('Toothpaste', 'Water, Sodium Fluoride, Triclosan').score, 80);
  // Cautions are an evidence-style rule; the other styles never read them.
  assert.equal(rate('Conditioner', 'Water, Behentrimonium Chloride, Methylisothiazolinone', { ratingStyle: 'minimal' }).bad.every(row => !/isothiazolinone/i.test(row.why)), true);
  // Marketing copy in the title is not label content.
  assert.equal(rate('Shampoo, dermatologist tested, ADA Accepted', 'Water, Sodium Laureth Sulfate').score, 80);
});

const FACTS = body => `Supplement Facts Serving Size: 1 Capsule Servings Per Container: 60 Amount Per Serving % Daily Value ${body}`;
const over = facts => ratings.declaredAmounts(facts).nutrients.filter(n => n.over).map(n => n.id);

test('Supplement Facts amounts above an adult upper limit are found', () => {
  assert.deepEqual(over(FACTS('Vitamin C (as ascorbic acid) 9000 mg 10000%')), ['vitamin-c']);
  assert.deepEqual(over(FACTS('Vitamin D3 (as cholecalciferol) 125 mcg (5000 IU) 625%')), ['vitamin-d']);
  assert.deepEqual(over(FACTS('Vitamin D3 5000 IU (125 mcg)')), ['vitamin-d'], 'IU first');
  assert.deepEqual(over(FACTS('Zinc (as zinc oxide) 50 mg 455% Iron (as ferrous fumarate) 18 mg 100%')), ['zinc']);
  assert.deepEqual(over(FACTS('Niacin (as niacinamide) 50 mg NE 313%')), ['niacin']);
  assert.deepEqual(over(FACTS('Vitamin B6 (as pyridoxine HCl) 150 mg')), ['vitamin-b6']);
  assert.deepEqual(over(FACTS('Vitamin A (as retinyl palmitate) 15,000 IU 500%')), ['vitamin-a']);
  assert.deepEqual(over(FACTS('Vitamin E (as d-alpha tocopheryl acetate) 1,500 mg')), ['vitamin-e']);
  assert.deepEqual(over(FACTS('Calcium (as calcium carbonate, calcium citrate) 3,000 mg')), ['calcium']);
  assert.deepEqual(over(FACTS('Folic Acid 1,200 mcg')), ['folic-acid']);
});

test('amounts that cannot be compared to a limit without guessing are left alone', () => {
  const none = body => assert.deepEqual(over(FACTS(body)), [], body);
  none('Vitamin C 2000 mg');                                         // at the limit is not over it
  none('Vitamin D3 4000 IU');                                        // 100 mcg
  none('Vitamin E 400 IU');                                          // 268 mg at the generous ratio
  none('Magnesium Citrate 1000 mg');                                 // a compound weight, not elemental magnesium
  none('Magnesium (as magnesium oxide) 300 mg');
  none('Vitamin A (as beta carotene) 9000 mcg');                     // beta-carotene has no limit
  none('Vitamin A (as retinyl palmitate and beta carotene) 4,000 mcg RAE'); // a mixed source is not judged
  none('Vitamin A 15,000 IU');                                       // no stated source
  none('Folate 2,000 mcg DFE');                                      // no stated folic acid
  none('Vitamin K 1000 mcg Biotin 10000 mcg Vitamin B12 5000 mcg');  // no limit set
  none('Iron Bisglycinate Chelate 100 mg');                          // a compound, not elemental iron
  // Text after "Other ingredients" is not the panel.
  assert.deepEqual(over('Supplement Facts Serving Size: 1 Vitamin C 90 mg Other ingredients: zinc 50 mg'), []);
});

test('the upper-limit rows charge each nutrient once, to a floor, and explain themselves', () => {
  const one = rate('Vitamin C Capsules', 'Vitamin C, cellulose, gelatin', {}, FACTS('Vitamin C 9000 mg'));
  assert.equal(one.score, 80);
  const row = one.bad.find(r => /Vitamin C/.test(r.why));
  assert.match(row.why, /9,000 mg in one serving is above the adult upper limit of 2,000 mg/);
  assert.match(row.why, /National Academies/);
  const many = rate('Mega Multi Tablets', 'Vitamin A, cellulose', {},
    FACTS('Vitamin A (as retinyl palmitate) 15,000 IU Zinc 50 mg Iron 60 mg Calcium 3000 mg Vitamin C 3000 mg'));
  assert.equal(many.score, 40, 'three charges at most');
  assert.equal(many.bad.length, 3);
  // The same panel under the other styles is not read for limits.
  assert.equal(rate('Vitamin C Capsules', 'Vitamin C, cellulose, gelatin', { ratingStyle: 'minimal' }, FACTS('Vitamin C 9000 mg')).score, 94, 'three entries; no limit rows');
  const caffeine = rate('Energy Gummies', 'pectin, sugar, citric acid', {}, FACTS('Caffeine 250 mg'));
  assert.equal(caffeine.score, 100, 'a caffeine note is not a charge');
  assert.ok(caffeine.good.some(r => r.c === 0 && /Caffeine: 250 mg/.test(r.why)));
});

test('a Supplement Facts panel is usable only with a serving and an active amount', () => {
  const declined = facts => rate('Vitamin C Capsules', 'Vitamin C, cellulose', {}, facts).readable;
  assert.equal(declined(FACTS('Vitamin C 90 mg')), true);
  assert.equal(declined('Supplement Facts Serving Size: One (1) Capsule Vitamin C 90 mg'), true, 'a spelled-out serving');
  assert.equal(declined('Supplement Facts Serving Size: ½ tsp Vitamin C 90 mg'), true);
  assert.equal(declined('Supplement Facts Calories 5 Total Carbohydrate 1 g'), false, 'no serving size');
  assert.equal(declined('Supplement Facts Serving Size: 1 Capsule Calories 5 Total Carbohydrate 1 g Total Sugars 1 g'), false, 'macros are not active amounts');
  assert.equal(declined('Supplement Facts Serving Size 5 g'), false, 'a serving weight is not an active amount');
  assert.equal(declined(FACTS('Vitamin C 90 mg Proprietary Blend 500 mg')), false);
  assert.equal(declined('Vitamin C 90 mg'), false, 'not a Supplement Facts panel');
});

test('minimal counts what a supplement adds to its actives, not the actives', () => {
  const facts = FACTS('Vitamin C 90 mg');
  const text = 'Vitamin C (ascorbic acid), vitamin E, zinc oxide, vitamin D3, biotin. Other ingredients: cellulose, gelatin';
  const result = rate('Multivitamin', text, { ratingStyle: 'minimal' }, facts);
  assert.equal(result.score, 97, 'two added ingredients');
  assert.match(result.bad[0].why, /2 declared other ingredients/);
  assert.equal(rate('Multivitamin', 'Vitamin C, gelatin', { ratingStyle: 'minimal' }, facts).score, 97, 'without the marker, every entry counts');
});

test('every style and every label stays inside 0..100 and adds up', () => {
  const panels = [FACTS('Vitamin C 90 mg'), FACTS('Vitamin C 9000 mg Zinc 90 mg Iron 90 mg Calcium 9000 mg Vitamin D 9000 mcg')];
  const products = [...LABELS.map(([name, text]) => [name, text]), ['Multivitamin', 'Vitamin C, gelatin, cellulose, zinc oxide, vitamin E']];
  for (const [name, text] of products) for (const ratingStyle of ratings.STYLES) for (const facts of panels) {
    const result = rate(name, text, { ratingStyle, avoidList: ['fragrance', 'sulfate', 'glycerin', 'water'] }, /itamin/.test(name) ? facts : undefined);
    if (!result.readable) continue;
    assert.ok(result.score >= 0 && result.score <= 100, `${name} ${ratingStyle} ${result.score}`);
    assert.equal(result.base + [...result.good, ...result.bad].reduce((sum, row) => sum + row.c, 0), result.score, `${name} ${ratingStyle}`);
  }
});

test('the category lists in the caches agree with the rating module', () => {
  // Three modules each carry the list of categories they accept. A category added to one and not the
  // others is dropped silently when a reading is cached or a result list is sanitized.
  for (const category of ratings.CATEGORIES) {
    assert.equal(productCache.sanitizeData({ category, text: 'water' }).category, category, `product cache drops ${category}`);
    assert.equal(sortedResults.sanitizeProduct({ asin: 'B000000001', category, ratingStyle: 'evidence', score: 70 }).category, category, `sorted results drop ${category}`);
  }
  assert.equal(productCache.sanitizeData({ category: 'food', text: 'water' }).category, undefined);
  assert.equal(sortedResults.sanitizeProduct({ asin: 'B000000001', category: 'pet-food', score: 70 }).category, 'food');
});

test('a long multivitamin panel survives the reading cache', () => {
  const panel = FACTS(Array.from({ length: 40 }, (_, i) => `Nutrient ${i} (as a long chemical form name) ${i + 1} mg`).join(' '));
  assert.ok(panel.length > 2000 && panel.length < 4000, String(panel.length));
  assert.equal(productCache.sanitizeData({ text: 'water', supplement_facts: panel }).supplement_facts, panel);
  assert.equal(productCache.sanitizeData({ text: 'water', supplement_facts: 'x'.repeat(4001) }).supplement_facts, undefined);
});

test('the documented upper limits are the limits the rubric applies', () => {
  const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'PERSONAL-CARE.md'), 'utf8');
  for (const def of ratings.LIMITS) {
    const shown = `${def.label} | ${def.limit.toLocaleString('en-US')} ${def.unit}`;
    assert.ok(docs.includes(shown), `docs/PERSONAL-CARE.md does not state "${shown}"`);
  }
});
