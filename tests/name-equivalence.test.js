// The same ingredient under another name is charged the same. tests/invariants.test.js pins the ways a list is WRITTEN;
// this pins the names an ingredient is SOLD under: a second name, a British, Indian or EU spelling, a legal name, an
// E- or INS number, and the "syrup", "solids" and "monohydrate" forms. Each row below was charged nothing, or less,
// under its alternate names until docs/AUDIT-2026-11-19.md (findings 1 to 4). A rule that reads only one spelling now
// fails here instead of scoring a product as clean. Add a row whenever a rule gains a name.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = p => path.join(__dirname, '..', 'src', p);
require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));
const panel = require(src('content/panel.js'));

const read = (text, options) => engine.score({ name: '', ingredients_text: text }, options);
const inList = name => read(`Oats, ${name}, salt`);

// canonical name -> names a label also prints for it. Every name must score exactly as the canonical one does.
const SAME = {
  'sugar': ['muscovado', 'turbinado', 'demerara', 'barbados sugar', 'castor sugar', 'golden sugar', 'florida crystals'],
  'cane sugar': ['dehydrated cane juice', 'cane juice crystals', 'evaporated cane juice'],
  // Cane juice boiled down unrefined is charged as the traditional sweeteners are, not as refined sugar.
  'coconut sugar': ['jaggery', 'panela', 'rapadura', 'sucanat', 'piloncillo', 'palm sugar', 'coconut palm sugar', 'coconut syrup'],
  'glucose syrup': ['glucose syrup solids', 'liquid glucose', 'dried glucose syrup', 'glucose solids'],
  'glucose-fructose syrup': ['isoglucose', 'fructose-glucose syrup'],
  'corn syrup': ['corn sweetener', 'corn syrup solids'],
  'dextrose': ['dextrose monohydrate', 'anhydrous dextrose', 'dextrose syrup', 'grape sugar'],
  'fructose': ['fructose syrup', 'fruit sugar', 'crystalline fructose'],
  'invert sugar': ['invert syrup', 'cane invert syrup', 'invert sugar syrup'],
  'rice syrup': ['rice malt syrup', 'brown rice malt syrup'],
  'barley malt syrup': ['malt syrup', 'malt extract', 'barley malt extract', 'malted barley extract'],
  'apple juice concentrate': ['white grape juice concentrate', 'pear juice concentrate', 'concentrated apple juice', 'fruit concentrate'],
  'acesulfame K': ['acesulphame K', 'acesulphame potassium', 'acesulfame-K'],
  'sucralose': ['artificial sweetener', 'artificial sweeteners', 'neohesperidin DC'],
  'reb A': ['rebaudioside A', 'rebaudioside M', 'stevia leaf extract'],
  'monk fruit extract': ['luo han guo', 'mogrosides', 'monk fruit'],
  'modified food starch': ['food starch-modified', 'acetylated distarch adipate', 'hydroxypropyl distarch phosphate', 'acetylated distarch phosphate',
    'starch sodium octenyl succinate', 'oxidized starch', 'E1422', 'dextrin'],
  'soybean oil': ['soya oil', 'soy oil', 'soya bean oil'],
  'corn oil': ['maize oil', 'corn germ oil'],
  'sunflower oil': ['sunflower seed oil'],
  'peanut oil': ['groundnut oil', 'arachis oil'],
  'red 40': ['red dye 40', 'red dye #40', 'FD&C red no. 40', 'allura red'],
  'yellow 5': ['yellow dye 5', 'tartrazine', 'E102', 'INS 102'],
  'artificial colour': ['permitted synthetic food colours', 'synthetic colour'],
  'sodium tripolyphosphate': ['sodium acid pyrophosphate', 'tetrasodium pyrophosphate', 'sodium hexametaphosphate', 'E450'],
  'powdered cellulose': ['cellulose powder', 'cellulose'],
  'textured soy protein': ['textured wheat protein', 'textured vegetable protein'],
  // Flour by its kitchen name is wheat flour: processed, not refined white flour (tests/audit-2026-09-14.test.js).
  'wheat flour': ['all-purpose flour', 'plain flour', 'bread flour', 'self-raising flour', 'unbleached wheat flour'],
  'mono- and diglycerides': ['sucrose esters of fatty acids', 'E473', 'polyglycerol esters of fatty acids', 'sorbitan tristearate'],
};

test('an ingredient is charged the same under every name a label prints it by', () => {
  const clean = inList('water').score;
  for (const [canonical, names] of Object.entries(SAME)) {
    const want = inList(canonical);
    assert.ok(want.score < clean, `${canonical} must be charged for the row to mean anything`);
    for (const name of names) assert.equal(inList(name).score, want.score, `"${name}" should score as "${canonical}" does`);
  }
});

test('a food made into something else is not read as the whole food it is named after', () => {
  // Each read as NOVA 1 with nothing charged: sugar, carcass paste and emulsifying salts went unseen.
  for (const entry of ['Sweetened condensed milk', 'Chocolate milk', 'Ice cream', 'Frozen yogurt', 'Vanilla yogurt', 'Sweetened whipped cream',
    'Mechanically separated chicken', 'Chicken nuggets', 'Beef hot dogs', 'Processed cheese', 'Pasteurized process cheese food', 'Cheese product',
    'Imitation cheese', 'American cheese', 'Imitation shrimp', 'Yogurt coating']) {
    assert.notEqual(read(`${entry}, water`).nova, 1, entry);
  }
  for (const entry of ['Sweetened condensed milk', 'Ice cream', 'Mechanically separated chicken', 'Processed cheese']) {
    assert.ok(read(`${entry}, water`).bad.some(b => b.c < 0), `${entry} should be charged`);
  }
  assert.ok(read('Sweetened condensed milk, coffee').score <= read('Milk, sugar, coffee').score);
  // The plain foods, and minimal treatment of them, stay whole.
  for (const entry of ['Milk', 'Whole milk', 'Heavy whipping cream', 'Sour cream', 'Cream cheese', 'Greek yogurt', 'Cheddar cheese',
    'Chicken', 'Frozen chicken', 'Boneless skinless chicken breast', 'Ground beef', 'Shrimp', 'Wild salmon']) {
    assert.equal(read(entry).nova, 1, entry);
  }
});

test('a syrup no rule charges counts as unread, so coverage and AI help can see it', () => {
  // A bare "syrup" in the panel vocabulary made every unknown syrup read and free.
  const r = read('Oats, quince syrup, salt');
  assert.ok(r.unrecognised.includes('quince syrup'));
  assert.ok(r.coverage < 1);
  // Syrups a rule charges, or a food word reads, are still read.
  for (const name of ['maple syrup', 'corn syrup', 'chocolate syrup', 'fructose syrup']) assert.ok(!inList(name).unrecognised.includes(name), name);
});

test('the panel names the entries it could not read', () => {
  const r = read('Oats, quince syrup, kokum, salt');
  const html = panel.render(r, { title: 't', confidence: 1 });
  assert.match(html, /Not recognised, so not scored: quince syrup, kokum/);
  // A list read in full says nothing.
  assert.doesNotMatch(panel.render(read('Oats, sugar, salt'), { title: 't', confidence: 1 }), /Not recognised/);
  // At most eight names.
  const many = read(Array.from({ length: 12 }, (_, i) => `zzq${i}`).concat('<b>x</b>q', 'oats').join(', '));
  const line = panel.render(many, { title: 't', confidence: 1 }).match(/Not recognised[^<]*/)[0];
  assert.equal(line.split(': ')[1].split(', ').length, 9, line);   // eight names and the ellipsis
  assert.match(line, /…$/);
});
