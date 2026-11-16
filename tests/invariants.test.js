// Properties the scoring engine must keep for ANY input, as opposed to the pinned fixtures elsewhere.
//
// The corpus and the factor fixtures prove particular lists land where they were calibrated. These
// tests prove the shape: scores are bounded integers, scoring is deterministic and pure, adding a
// penalised ingredient never helps, a declared quantity outranks list position, and no input is able
// to crash scoring or be mistaken for a readable list.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const categories = require('../src/engine/categories.js');

const score = (text, options) => engine.score({ name: '', ingredients_text: text }, options);
const reasons = r => r.bad.map(b => b.why);
const costOf = (r, re) => -r.bad.filter(b => re.test(b.why)).reduce((sum, b) => sum + b.c, 0);

// A small deterministic generator, so a failure names its seed and reproduces exactly.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const FOODS = ['oats', 'rice', 'water', 'milk', 'wheat flour', 'olive oil', 'honey', 'salt', 'tomato', 'beans', 'almonds', 'eggs'];
// Foods no rule charges, so reordering them cannot change what anything else costs.
const UNCHARGED = ['oats', 'rice', 'water', 'milk', 'olive oil', 'salt', 'tomato', 'beans', 'almonds', 'eggs'];
const PENALISED = ['red 40', 'aspartame', 'soybean oil', 'high fructose corn syrup', 'sodium benzoate', 'natural flavors',
  'maltodextrin', 'carrageenan', 'bht', 'sugar', 'monosodium glutamate', 'sodium nitrite', 'modified corn starch'];

test('scores are integers on the published scale, for every goal preset', () => {
  const lists = ['Water, Sugar, Salt, Natural Flavors', 'Oats', 'Soybean Oil, Red 40, Aspartame', 'Wheat flour, milk, eggs, honey'];
  for (const id of Object.keys(categories.PRESETS)) {
    const weights = categories.PRESETS[id].weights;
    for (const text of lists) {
      const r = score(text, { weights });
      assert.ok(Number.isInteger(r.score), `${id}: ${text} -> ${r.score}`);
      assert.ok(r.score >= engine.SCORING_POLICY.floor && r.score <= 100, `${id}: ${text} -> ${r.score}`);
      assert.ok(engine.BANDS.some(b => r.score >= b[0]), `${id}: no verdict band for ${r.score}`);
    }
  }
});

test('scoring is deterministic and never mutates its input', () => {
  const product = Object.freeze({ name: 'Granola', ingredients_text: 'Oats, sugar (cane), soybean oil, natural flavors, salt',
    nutrition: Object.freeze({ sugar: 12, servingGrams: 40 }) });
  const first = JSON.stringify(engine.score(product, {}));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(engine.score(product, {})), first);
});

test('adding a penalised ingredient to the end of a list never raises the score', () => {
  const random = rng(7);
  for (let i = 0; i < 150; i++) {
    const base = Array.from({ length: 2 + Math.floor(random() * 6) }, () => FOODS[Math.floor(random() * FOODS.length)]);
    const extra = PENALISED[Math.floor(random() * PENALISED.length)];
    const before = score(base.join(', ')).score, after = score([...base, extra].join(', ')).score;
    assert.ok(after <= before, `seed 7 #${i}: "${base.join(', ')}" ${before} -> +${extra} -> ${after}`);
  }
});

test('moving a penalised ingredient earlier in the list never raises the score', () => {
  const random = rng(11);
  for (let i = 0; i < 150; i++) {
    // Position changes what a *charged* neighbour costs too (pushing wheat flour down a place lowers its
    // own charge), so the property is only a statement about a base that nothing charges.
    const base = Array.from({ length: 4 + Math.floor(random() * 6) }, () => UNCHARGED[Math.floor(random() * UNCHARGED.length)]);
    const bad = PENALISED[Math.floor(random() * PENALISED.length)];
    const early = score([bad, ...base].join(', ')).score, late = score([...base, bad].join(', ')).score;
    assert.ok(early <= late, `seed 11 #${i}: "${bad}" first ${early} vs last ${late} in "${base.join(', ')}"`);
  }
});

test('no generated text can crash scoring or run away', () => {
  const random = rng(23);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ,;:()[]%*.-/&0123456789éüßńİ_#';
  const start = Date.now();
  for (let i = 0; i < 400; i++) {
    const text = Array.from({ length: Math.floor(random() * 300) }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    const r = score(text);
    assert.ok(Number.isFinite(r.score) && r.score >= 3 && r.score <= 100, `seed 23 #${i}: ${JSON.stringify(text)} -> ${r.score}`);
    assert.ok(r.coverage >= 0 && r.coverage <= 1, `coverage ${r.coverage}`);
  }
  assert.ok(Date.now() - start < 20000, 'fuzzed scoring took longer than 20 seconds');
});

test('an empty or unreadable list is never readable, whatever number it scores', () => {
  for (const text of ['', '   ', undefined, null, 12345, 'N/A', 'See package for ingredients', 'Ingredients not available', ',,,;;; ']) {
    const r = engine.score({ name: 'x', ingredients_text: text }, {});
    assert.equal(r.readable, false, `${JSON.stringify(text)} must not be readable (parsed ${r.parsed}, coverage ${r.coverage})`);
    assert.equal(engine.isReadable(r), false);
  }
  const real = score('Water, Sugar, Salt, Natural Flavors');
  assert.equal(real.readable, true);
  assert.equal(engine.isReadable(real), true);
});

test('isReadable agrees with the published gate and rejects malformed results', () => {
  assert.equal(engine.MIN_COVERAGE, 0.34);
  assert.equal(engine.isReadable({ parsed: 3, coverage: 0.34, score: 70 }), true);
  assert.equal(engine.isReadable({ parsed: 3, coverage: 0.339, score: 70 }), false);
  assert.equal(engine.isReadable({ parsed: 0, coverage: 1, score: 90 }), false);
  assert.equal(engine.isReadable({ parsed: 3, coverage: 1, score: NaN }), false);
  assert.equal(engine.isReadable({ parsed: 3, coverage: '1', score: 70 }), false);
  assert.equal(engine.isReadable(null), false);
  assert.equal(engine.isReadable(undefined), false);
});

test('a declared share outranks list position', () => {
  const trace = score('Oats 98%, Sugar 2%');
  const half = score('Oats 60%, Sugar 40%');
  assert.ok(costOf(trace, /sugar/i) < costOf(half, /sugar/i), 'two percent sugar must cost less than forty percent');
  // The same sugar costs the same wherever it sits once its quantity is declared.
  assert.equal(score('Sugar 2%, Oats 98%').score, trace.score);
  // Undeclared lists still rank by position, exactly as before.
  assert.ok(costOf(score('Sugar, Oats'), /sugar/i) > costOf(score('Oats, Water, Salt, Rice, Beans, Eggs, Honey, Sugar'), /sugar/i));
});

test('share tiers mirror the four position weights', () => {
  const cost = pct => costOf(score(`Oats, Sugar ${pct}%`), /sugar/i);
  assert.ok(cost(40) > cost(15), 'a quarter or more weighs like the first ingredient');
  assert.ok(cost(15) > cost(5), 'a tenth weighs more than a few percent');
  assert.ok(cost(5) > cost(1), 'under two percent weighs like the tail');
  assert.equal(cost(25), cost(90));
  assert.equal(cost(10), cost(24.9));
  assert.equal(cost(2), cost(9.9));
  assert.equal(cost(0.5), cost(1.9));
});

test('shares written in front, after, with decimal commas and with bounds are all read', () => {
  const reference = costOf(score('Oats, Sugar 40%'), /sugar/i);
  for (const text of ['Oats, 40% sugar', 'Oats, Zucker 40 %', 'Oats, sugar 40,0%', 'Oats, sugar max. 40%']) {
    assert.equal(costOf(score(text), /sugar|zucker/i), reference, text);
  }
  // A fat level is not a share: "2% milk" must keep reading as reduced-fat milk, not as a minor ingredient.
  assert.equal(score('2% milk, sugar').parsed, 2);
});

test('the separator in front of a declared share does not hide the ingredient', () => {
  // Forty percent weighs 1.5; an undeclared second place weighs 1.25, so a lost share would show.
  const reference = score('Oats, Sugar 40%');
  assert.ok(costOf(reference, /sugar/i) > costOf(score('Oats, Sugar'), /sugar/i));
  for (const text of ['Oats, Sugar - 40%', 'Oats, Sugar – 40 %', 'Oats, Sugar: 40%', 'Oats, Sugar = 40%', 'Oats, sugar ~40%',
    'Oats, Sugar -40%', 'Oats, Sugar 40 per cent', 'Oats, Sugar 40percent']) {
    assert.equal(score(text).score, reference.score, text);
    assert.deepEqual(engine.parse(text), ['oats', 'sugar'], text);
  }
});

test('a share alone in its bracket is the entry\'s declared quantity', () => {
  const reference = score('Oats, Sugar 40%');
  for (const text of ['Oats, Sugar (40%)', 'Oats, Sugar (40 %)', 'Oats, Sugar (min. 40%)', 'Oats, Sugar (max 40,0%)', 'Oats, Sugar (40 per cent)']) {
    assert.equal(score(text).score, reference.score, text);
    assert.deepEqual(engine.parse(text), ['oats', 'sugar'], text);
  }
  assert.ok(costOf(score('Oats, Sugar (2%)'), /sugar/i) < costOf(score('Oats, Sugar (40%)'), /sugar/i));
  // A bracket that lists sub-ingredients is not a quantity.
  assert.equal(score('Oats, Sugar (cane, beet)').score, score('Oats, Sugar').score);
});

test('a European label reads by its declared quantities', () => {
  const nutellaLike = 'Sugar, Palm Oil, Hazelnuts (13%), Skimmed Milk Powder (8.7%), Fat-Reduced Cocoa (7.4%), Emulsifier: Lecithins (Soy), Vanillin';
  const r = score(nutellaLike);
  assert.equal(r.parsed, engine.parse(nutellaLike).length);
  assert.ok(r.readable);
  assert.ok(costOf(r, /sugar/i) > 0 && costOf(r, /vanill/i) > 0);
});

test('the characters a list is written with do not decide whether an ingredient is charged', () => {
  const plain = score('Oats, Sugar');
  assert.ok(costOf(plain, /sugar/i) > 0);
  const variants = {
    'zero-width space': 'Oats,\u200bSugar', 'soft hyphen inside a word': 'Oats, Su\u00adgar', 'byte order mark': '\ufeffOats, Sugar',
    bullets: '• Oats • Sugar', 'middle dot': 'Oats · Sugar', pipes: 'Oats | Sugar', 'full-width comma': 'Oats， Sugar',
    'ideographic comma': 'Oats、Sugar', 'arabic comma': 'Oats، Sugar', 'full-width semicolon': 'Oats； Sugar',
    'html tags': '<b>Oats</b>, <b>Sugar</b>', 'named entity': 'Oats,&nbsp;Sugar', 'numeric entity': 'Oats,&#44; Sugar',
    'hex entity': 'Oats,&#x2c; Sugar', 'tab and no space': 'Oats,\tSugar',
  };
  for (const [name, text] of Object.entries(variants)) {
    assert.equal(score(text).score, plain.score, `${name}: ${JSON.stringify(text)}`);
    assert.deepEqual(engine.parse(text), ['oats', 'sugar'], name);
  }
  assert.deepEqual(engine.parse('Oats, Sugar &amp; Salt'), ['oats', 'sugar', 'salt']);
});

test('a line wrapped inside one ingredient is not split into two', () => {
  assert.deepEqual(engine.parse('Oats, High Fructose\nCorn Syrup'), ['oats', 'high fructose corn syrup']);
  assert.equal(score('Oats, High Fructose\nCorn Syrup').score, score('Oats, High Fructose Corn Syrup').score);
});

// OCR prints a label's own line breaks, and a narrow panel breaks long words with a hyphen:
// "Partially Hydro-\ngenated Soybean Oil" reached the rules as "hydro- genated" and cost nothing, where the
// whole word caps the score at 5. Measured on a four-ingredient list: 63 against 5, 67 against 40 for
// carrageenan, 67 against 36 for sodium benzoate. `readable` stayed true, so nothing declined it.
test('a word broken across two lines by a hyphen is charged as the word', () => {
  const words = ['Partially Hydrogenated Soybean Oil', 'Carrageenan', 'Sodium Benzoate', 'Polysorbate 80',
    'Monosodium Glutamate', 'Artificial Flavors', 'Aspartame', 'Potassium Sorbate', 'Titanium Dioxide'];
  for (const word of words) {
    // Every place a word can break, not only the one a person would pick.
    for (let at = 3; at < word.length - 3; at++) {
      if (/[\s\d-]/.test(word[at - 1] + word[at])) continue;
      const wrapped = `${word.slice(0, at)}-\n${word.slice(at)}`;
      // Typesetters never leave a single letter on either side of a break.
      if (!/[a-z]{2,}-\n[a-z]{2,}/i.test(wrapped)) continue;
      const whole = score(`Water, Wheat Flour, ${word}, Salt`);
      const broken = score(`Water, Wheat Flour, ${wrapped}, Salt`);
      assert.equal(broken.score, whole.score, `${JSON.stringify(wrapped)} scores ${broken.score}, the whole word ${whole.score}`);
      assert.deepEqual(reasons(broken), reasons(whole), JSON.stringify(wrapped));
    }
  }
  assert.deepEqual(engine.parse('Water, Partially Hydro-\ngenated Soybean Oil'), ['water', 'partially hydrogenated soybean oil']);
  // As a label prints it, and as a photo of it comes back from the OCR pass.
  assert.equal(score('WATER, FLOUR, PARTIALLY HYDRO-\nGENATED SOYBEAN OIL, SALT').score, score('Water, Flour, Partially Hydrogenated Soybean Oil, Salt').score);
  const ocr = require('../src/engine/db/ocr-text.js');
  const read = ocr.ingredientsFromOcr('INGREDIENTS: Enriched Wheat Flour, Water, Sugar,\nPartially Hydro-\ngenated Soybean Oil, Salt, Natural\nFlavors, Soy Lecithin.');
  assert.match(read, /hydro- genated/i, 'the OCR pass only tidies whitespace; the engine has to rejoin the word');
  assert.equal(score(read).score, score('Enriched Wheat Flour, Water, Sugar, Partially Hydrogenated Soybean Oil, Salt, Natural Flavors, Soy Lecithin').score);
});

test('a hyphen that belongs to the text is left where it is', () => {
  // Hanging prefixes and ordinary compounds read exactly as they did before wraps were rejoined:
  // pinned to the scores they had, so a rejoin that only ever ADDS a charge cannot move them.
  const pinned = {
    'Water, Mono- and Diglycerides, Salt': 47, 'Water, Mono-and Diglycerides, Salt': 47, 'Oats, Non- GMO Soybeans': 90,
    'Water, Cold- pressed Olive Oil, Salt': 94, 'Oats, Whole- grain Wheat Flour': 67, 'Water, Di- and Triglycerides, Salt': 90,
    'Oats, Sugar- free Syrup': 90,
  };
  for (const [text, expected] of Object.entries(pinned)) assert.equal(score(text).score, expected, text);
  assert.deepEqual(engine.parse('Water, Mono- and Diglycerides, Salt'), ['water', 'mono- and diglycerides', 'salt']);
  assert.deepEqual(engine.parse('Oats, Non- GMO Soybeans'), ['oats', 'non- gmo soybeans']);
});

test('a compound broken at a hyphen reads as the compound', () => {
  // "High-\nfructose" is two words, not one: the hyphen reads as the space it replaced.
  const whole = score('Water, Sodium Benzoate, High Fructose Corn Syrup');
  assert.equal(score('Water, Corn-\nstarch').score, score('Water, Corn Starch').score, 'a compound written with a hyphen at the break');
  assert.equal(score('Water, Soya- lecithin, Salt').score, score('Water, Soya Lecithin, Salt').score);
  for (const wrapped of ['High-\nFructose Corn Syrup', 'High Fructose-\nCorn Syrup', 'High Fructose Corn-\nSyrup', 'HIGH FRUCTOSE CORN-\nSYRUP']) {
    const read = score(`Water, Sodium Benzoate, ${wrapped}`);
    assert.equal(read.score, whole.score, JSON.stringify(wrapped));
    // "High Fructose-\nCorn Syrup" already tripped the plain corn-syrup cap, which is the same ceiling.
    if (!/Fructose-/.test(wrapped)) assert.deepEqual(reasons(read), reasons(whole), JSON.stringify(wrapped));
  }
});

// A list with one ingredient per line and no commas (pasted from a notes app or a bulleted web page, or
// markup that separates items with <br>) was one long entry: the anchored rules never saw the sugar in
// "water oats rice flour salt yeast vinegar sugar" (82 against 62), and a longer list was over the length
// limit and read as nothing at all.
test('a list with one ingredient per line is read as a list', () => {
  const items = ['Water', 'Enriched Wheat Flour', 'Sugar', 'Soybean Oil', 'Natural Flavors', 'Soy Lecithin', 'Salt'];
  const plain = score(items.join(', '));
  assert.ok(plain.score < 70, 'the fixture has to cost something for the comparison to mean anything');
  for (const sep of ['\n', '\r\n', '\n\n', ' \n ', '<br>', '<br/>', '<br />\n', '</li><li>']) {
    const text = sep.includes('li') ? `<ul><li>${items.join(sep)}</li></ul>` : items.join(sep);
    const read = score(text);
    assert.equal(read.score, plain.score, `${JSON.stringify(sep)} scores ${read.score}, the comma list ${plain.score}`);
    assert.equal(read.parsed, plain.parsed, JSON.stringify(sep));
    assert.deepEqual(engine.parse(text), items.map(item => item.toLowerCase()), JSON.stringify(sep));
  }
  // Which is more than the old reading did, with sugar last in a short list.
  const late = ['Water', 'Oats', 'Rice Flour', 'Salt', 'Yeast', 'Vinegar', 'Sugar'];
  assert.equal(score(late.join('\n')).score, score(late.join(', ')).score);
  assert.equal(score(late.join('\n')).parsed, late.length);
});

test('the paste box accepts a vertical list as it accepts a comma list', () => {
  // Before the list was read as a list, fourteen short lines were "a single phrase of more than twelve
  // words" and the Score button stayed disabled.
  require('../src/engine/db/ingestible.js');
  const extract = require('../src/content/extract.js');
  const vertical = 'Water\nOats\nRice\nSalt\nYeast\nVinegar\nSugar\nMilk\nEggs\nButter\nHoney\nGarlic\nOnion\nPepper';
  const saved = AIR.engine;
  try {
    delete AIR.engine;
    assert.equal(extract.looksLikeIngredients(vertical), false, 'without the engine the old reading stands');
    AIR.engine = engine;
    assert.equal(extract.looksLikeIngredients(vertical), true);
    assert.equal(extract.looksLikeIngredients(vertical.replace(/\n/g, ', ')), true);
    assert.equal(extract.looksLikeIngredients('Shipping is free\nReturns within 30 days\nCustomer reviews\nClick here'), false, 'boilerplate lines are not ingredients');
  } finally { if (saved) AIR.engine = saved; else delete AIR.engine; }
});

test('line breaks stay line wraps when the text is not a vertical list', () => {
  // Commas anywhere mean the lines are wrapping a comma list.
  assert.deepEqual(engine.parse('Oats, Organic\nExtra Virgin\nOlive Oil'), engine.parse('Oats, Organic Extra Virgin Olive Oil'));
  // Two lines are a wrapped phrase, not two ingredients.
  assert.deepEqual(engine.parse('High Fructose\nCorn Syrup'), ['high fructose corn syrup']);
  // Long lines are prose.
  const prose = 'Made from the finest whole grains we could find on the farm and rolled flat\nthen toasted slowly in small batches until they turn golden brown and crisp\nready for your morning bowl with milk or fruit or anything else you like';
  assert.equal(engine.parse(prose).length, engine.parse(prose.replace(/\n/g, ' ')).length);
});

test('entities and tags cannot smuggle in an ingredient or a marker', () => {
  assert.ok(engine.parse('Oats, <script>alert(1)</script>Sugar').every(e => !/[<>]/.test(e)), 'markup must not survive into an entry');
  assert.equal(score('Oats, &#0; Sugar').score, score('Oats, Sugar').score);
  assert.equal(score('Oats, &#1114112; Sugar').score, score('Oats, Sugar').score);
  assert.ok(!engine.parse('Oats, &unknown; Sugar').some(e => e.includes('\u0001')));
});

// The same word in another encoding. Each of these left "sugar" (or the flavour, or the oil) as a word no
// rule could read, so it was charged nothing while `readable` stayed true: "Water, artiﬁcial ﬂavor, Salt"
// scored 90 where the plain spelling scores 41.
test('the encoding a word arrives in does not decide whether it is charged', () => {
  const plain = score('Oats, Sugar');
  const variants = {
    'left-to-right mark after the word': 'Oats, Sugar‎', 'right-to-left mark before it': 'Oats, ‏Sugar',
    'directional embedding round it': 'Oats, ‪Sugar‬', 'directional isolate round it': 'Oats, ⁦Sugar⁩',
    'full-width letters': 'Oats, ｓｕｇａｒ', 'full-width capitals': 'ＯＡＴＳ, ＳＵＧＡＲ',
  };
  for (const [name, text] of Object.entries(variants)) {
    assert.equal(score(text).score, plain.score, `${name}: ${JSON.stringify(text)}`);
    assert.deepEqual(engine.parse(text), ['oats', 'sugar'], name);
  }
  // Ligatures, as OCR and PDF text print "fi" and "fl".
  assert.equal(score('Water, artiﬁcial ﬂavor, Salt').score, score('Water, artificial flavor, Salt').score);
  assert.deepEqual(engine.parse('Water, saﬄower oil, wheat ﬂour, caﬀeine'), ['water', 'safflower oil', 'wheat flour', 'caffeine']);
  assert.equal(score('Oats, saﬄower oil').cap, score('Oats, safflower oil').cap);
  // An accent written as a letter and a combining mark is the accented letter.
  for (const [composed, name] of [['Avena, azúcar', 'Spanish'], ['Avoine, sirop de glucose-fructose, arôme', 'French'], ['Hafer, Sonnenblumenöl', 'German']]) {
    const decomposed = composed.normalize('NFD');
    assert.notEqual(decomposed, composed, `${name}: the fixture has to contain an accent`);
    assert.equal(score(decomposed).score, score(composed).score, name);
    assert.deepEqual(engine.parse(decomposed), engine.parse(composed), name);
  }
  // A footnote mark is still a mark, not a digit joined to the word (which full compatibility folding would make it).
  assert.deepEqual(engine.parse('Oats, Sugar¹, Salt²'), ['oats', 'sugar', 'salt']);
  // Full-width brackets and percent signs keep the meaning they already had.
  assert.deepEqual(engine.parse('Oats（60％）, Sugar'), engine.parse('Oats (60%), Sugar'));
});

// Punctuation at the ends of an entry, and a trade mark sign, hid the word from rules anchored there:
// '"Sugar"', "Sugar!", "Sugar:" and "Sugar™" each scored 90 in a three-ingredient list that scores 65.
test('stray punctuation round an entry does not hide the ingredient', () => {
  const plain = score('Oats, Sugar, Salt');
  for (const entry of ['"Sugar"', '“Sugar”', '‘Sugar’', "'Sugar'", '«Sugar»', 'Sugar!', 'Sugar?', 'Sugar:', 'Sugar: ', 'Sugar;', '=Sugar', '~Sugar',
    'Sugar™', 'Sugar®', 'Sugar ®', 'Sugar©', '"Sugar" 20%']) {
    const read = score(`Oats, ${entry}, Salt`);
    assert.deepEqual(engine.parse(`Oats, ${entry}, Salt`), ['oats', 'sugar', 'salt'], entry);
    if (!/%/.test(entry)) assert.equal(read.score, plain.score, entry);
  }
  assert.equal(score('Water, Sucralose®, Salt').score, score('Water, Sucralose, Salt').score);
  assert.equal(score('Water, Splenda® Sucralose, Salt').cap, score('Water, Sucralose, Salt').cap);
  // Inside an entry the same characters are text.
  assert.deepEqual(engine.parse("Flocons d'avoine, sucre"), ["flocons d'avoine", 'sucre']);
  assert.deepEqual(engine.parse('Oats, emulsifier: soy lecithin'), engine.parse('Oats, emulsifier (soy lecithin)'));
});

// A page prints the heading on its own line and OCR loses the colon, so the first entry, the heaviest one,
// arrived as "ingredients sugar" and was charged nothing: 80 where "Sugar, Water, Salt" scores 63.
test('a heading without its colon does not hide the first ingredient', () => {
  const plain = score('Sugar, Water, Salt');
  assert.ok(costOf(plain, /sugar/i) > 0);
  for (const heading of ['Ingredients\n', 'INGREDIENTS ', 'Ingredients - ', 'Ingredients – ', 'Ingredients:\n', 'Ingredients : ', 'Ingredient List: ',
    'Ingredients list: ', 'Ingredient statement: ', 'Other Ingredients: ', 'Full ingredients: ', 'List of ingredients: ', 'Ingredients; ', 'Ingredients. ']) {
    const text = heading + 'Sugar, Water, Salt';
    assert.deepEqual(engine.parse(text), ['sugar', 'water', 'salt'], JSON.stringify(heading));
    assert.equal(score(text).score, plain.score, JSON.stringify(heading));
  }
  const local = { Zutaten: 'Zucker, Wasser, Salz', 'Ingrédients': 'Sucre, eau, sel', Ingredientes: 'Azúcar, agua, sal', Ingredienti: 'Zucchero, acqua, sale',
    'Ingrediënten': 'Suiker, water, zout', Ingredienser: 'Socker, vatten, salt', 'Składniki': 'Cukier, woda, sól', 'İçindekiler': 'Şeker, su, tuz' };
  for (const [heading, list] of Object.entries(local)) {
    for (const join of ['\n', ' ', ': ']) {
      assert.deepEqual(engine.parse(heading + join + list), engine.parse(list), `${heading}${JSON.stringify(join)}`);
      assert.equal(score(heading + join + list).score, score(list).score, `${heading}${JSON.stringify(join)}`);
    }
  }
  // A heading with a line to itself above a vertical list is not an ingredient of its own.
  assert.deepEqual(engine.parse('Ingredients\nSugar\nWater\nSalt'), ['sugar', 'water', 'salt']);
  assert.equal(score('Ingredients\nSugar\nWater\nSalt').score, plain.score);
  // A footnote that starts with the word is still read whole, and still earns what it earned.
  for (const note of ["*Ingrédients issus de l'agriculture biologique", 'Ingredienti biologici', 'Ingrédients biologiques']) {
    const withNote = score(`Avoine, sucre, ${note}`);
    assert.equal(withNote.parsed, 2, note);
    assert.ok(withNote.good.some(g => g.organic), `${note}: the organic note still counts`);
  }
});

// Two ingredients joined by "or" or a slash read as one unknown word: "Oats, sugar or honey, Salt" scored 90
// (64 as a comma list) and "Water, sugar/dextrose, Salt" 90 (61). A Canadian label writes every entry twice.
test('"or" and a slash between two ingredients do not hide either of them', () => {
  assert.equal(score('Oats, sugar or honey, Salt').score, score('Oats, sugar, honey, Salt').score);
  assert.equal(score('Water, sugar/dextrose, Salt').score, score('Water, sugar, dextrose, Salt').score);
  assert.equal(score('Water, sugar / dextrose, Salt').score, score('Water, sugar, dextrose, Salt').score);
  for (const [text, same] of [['Avoine, sucre ou miel', 'Avoine, sucre, miel'], ['Hafer, Zucker oder Honig', 'Hafer, Zucker, Honig'], ['Avena, azúcar o miel', 'Avena, azúcar, miel']]) {
    assert.equal(score(text).score, score(same).score, text);
  }
  // Bilingual: the sugar is charged once, as it is on the English label.
  const bilingual = score('Water/Eau, Sugar/Sucre, Salt/Sel');
  assert.equal(costOf(bilingual, /sugar/i), costOf(score('Water, Sugar, Salt'), /sugar/i));
  assert.equal(bilingual.bad.length, 1);
  // What a rule already reads whole stays whole, and a pair that charges nothing is not split.
  assert.deepEqual(engine.parse('Oats, canola/soybean oil'), ['oats', 'canola/soybean oil']);
  assert.deepEqual(engine.parse('Oats, salt/pepper'), ['oats', 'salt/pepper']);
  assert.deepEqual(engine.parse('Oats, orange juice or pulp'), ['oats', 'orange juice or pulp']);
});

// Some Italian labels set a list out with spaced dashes and no comma at all, and a list copied from a table
// arrives with tabs. Read as one entry, the sugar in the middle was never seen.
test('a list set out with spaced dashes, slashes or tabs is read as a list', () => {
  const items = ['Oats', 'Sugar', 'Rice Flour', 'Salt', 'Natural Flavors'];
  const plain = score(items.join(', '));
  assert.ok(plain.score < 70, 'the fixture has to cost something for the comparison to mean anything');
  for (const sep of [' - ', ' – ', ' — ', ' / ', '\t', '  -  ']) {
    const text = items.join(sep);
    assert.deepEqual(engine.parse(text), items.map(item => item.toLowerCase()), JSON.stringify(sep));
    assert.equal(score(text).score, plain.score, JSON.stringify(sep));
  }
  const italian = 'farina di grano tenero - zucchero - olio di semi di girasole - sale';
  assert.equal(score(italian).score, score(italian.replace(/ - /g, ', ')).score);
  assert.deepEqual(reasons(score(italian)), reasons(score(italian.replace(/ - /g, ', '))));
  // A comma anywhere means the dashes belong to the entries: a word broken at a line end stays one word.
  assert.equal(engine.parse('Woda, mono - i diglicerydy - kwasów tłuszczowych, sól, cukier').length, 4);
  assert.equal(engine.parse('Woda, mono - i diglicerydy, sól').length, 3);
  // Two or three items are a list only when the rulebase reads every one and charges one of them.
  assert.equal(score('Oats - Sugar - Salt').score, score('Oats, Sugar, Salt').score);
  assert.deepEqual(engine.parse('Oats - Sugar - Salt'), ['oats', 'sugar', 'salt']);
  assert.deepEqual(engine.parse('Oats / Sugar'), ['oats', 'sugar']);
  assert.equal(score('Avena – Azúcar – Sal').score, score('Avena, Azúcar, Sal').score);
  // A product name set out with dashes is not a list, and a hyphenated word has no spaces round it.
  for (const name of ['Organic Raw Almonds - Unpasteurized - 16 oz', 'Extra Virgin Olive Oil - Cold Pressed', 'Almond Milk - Unsweetened - Vanilla', 'Oats – Rice – Salt']) {
    assert.equal(engine.parse(name).length, 1, name);
  }
  assert.deepEqual(engine.parse('High-oleic sunflower oil'), ['high-oleic sunflower oil']);
  // The paste box sees the same list the engine does.
  require('../src/engine/db/ingestible.js');
  const extract = require('../src/content/extract.js');
  const saved = AIR.engine;
  try {
    AIR.engine = engine;
    const long = ['Water', 'Oats', 'Rice', 'Salt', 'Yeast', 'Vinegar', 'Sugar', 'Milk', 'Eggs', 'Butter', 'Honey', 'Garlic', 'Onion', 'Pepper'].join(' - ');
    assert.equal(extract.looksLikeIngredients(long), true);
  } finally { if (saved) AIR.engine = saved; else delete AIR.engine; }
});

// A weight after the ingredient hid it from the anchored rules as a percentage once did: "Oats, Sugar 5g,
// Salt" scored 90 where the list scores 65.
test('a weight written after an ingredient does not hide it', () => {
  const plain = score('Oats, Sugar, Salt');
  for (const entry of ['Sugar 5g', 'Sugar 5 g', 'Sugar 12mg', 'Sugar 5,5 g', 'Sugar 0.5 oz', 'Sugar - 5g', 'Sugar: 5 g', 'Sugar (5g)', 'Sugar (5 g)', 'SUGAR 5G']) {
    assert.deepEqual(engine.parse(`Oats, ${entry}, Salt`), ['oats', 'sugar', 'salt'], entry);
    assert.equal(score(`Oats, ${entry}, Salt`).score, plain.score, entry);
  }
  assert.equal(score('Water, Sucralose 20 mg, Caffeine 80 mg').cap, score('Water, Sucralose, Caffeine').cap);
  // A weight says nothing about the share of the product: the entry keeps the weight of its position.
  assert.equal(costOf(score('Oats, Rice, Milk, Sugar 400 g'), /sugar/i), costOf(score('Oats, Rice, Milk, Sugar'), /sugar/i));
  // A number with no unit is part of the name.
  for (const name of ['red 40', 'polysorbate 80', 'vitamin b12', 'blue 1 lake', 'yellow 5']) assert.deepEqual(engine.parse(`Water, ${name}`), ['water', name]);
  assert.deepEqual(engine.parse('Oats, 2% milk'), ['oats', '2% milk']);
  // A pack size with an entry to itself marks a product name published in place of the list: it stays,
  // unread, so the name is still declined. A claim from the front of the pack is not an ingredient either.
  const name = score('Amazon Grocery, Cut Watermelon, 32 Oz');
  assert.deepEqual(engine.parse('Amazon Grocery, Cut Watermelon, 32 Oz'), ['amazon grocery', 'cut watermelon', '32 oz']);
  assert.equal(name.readable, false);
  assert.deepEqual(engine.parse('Kefir, 11g Protein'), ['kefir', '11g protein']);
  // An entry too long to assess stays too long: shortening it must not let a nutrition panel through.
  const panel = 'Nährwerte je 100 g Energie 1.580 kJ / 377 kcal Zucker 12 g Eiweiß 4 g Salz 0,02 g';
  assert.equal(score(panel).readable, false);
  assert.ok(score(panel).parseWarnings.includes('long-ingredient-entry'));
});

// Two words of one ingredient with no space between them, the capital the only trace of it.
test('two words run together are read as the ingredient they name', () => {
  for (const [joined, apart] of [['SoybeanOil', 'soybean oil'], ['CornSyrup', 'corn syrup'], ['NaturalFlavors', 'natural flavors'],
    ['HighFructoseCornSyrup', 'high fructose corn syrup'], ['PeanutButter', 'peanut butter']]) {
    assert.deepEqual(engine.parse(`Oats, ${joined}, Salt`), ['oats', apart, 'salt'], joined);
    assert.equal(score(`Oats, ${joined}, Salt`).score, score(`Oats, ${apart}, Salt`).score, joined);
  }
  assert.equal(score('Water, SoybeanOil, Salt').cap, score('Water, Soybean Oil, Salt').cap);
  // A capital inside a brand, or inside a word the rules already read, is left alone.
  for (const word of ['NutraSweet', 'SunButter', 'McCormick', 'DiGiorno', 'CocoaVia', 'MaltoDextrin', 'modifiedDate', 'pH']) {
    assert.deepEqual(engine.parse(`Oats, ${word}`), ['oats', word.toLowerCase()], word);
  }
  assert.equal(score('Oats, NutraSweet').score, score('Oats, Nutrasweet').score);
  // Capitals alone, and a label in capitals, say nothing.
  assert.deepEqual(engine.parse('WATER, SOYBEAN OIL, SALT'), ['water', 'soybean oil', 'salt']);
});

// German without its umlauts, as a label set in capitals or an ASCII-only system writes it. No rule is
// written that way: "Hafer, Sonnenblumenoel" scored 90 where "Sonnenblumenöl" scores 63.
test('an umlaut written as two letters is the umlaut', () => {
  const pairs = [['Hafer, Sonnenblumenoel', 'Hafer, Sonnenblumenöl'], ['Hafer, Rapsoel', 'Hafer, Rapsöl'], ['HAFER, SONNENBLUMENOEL', 'Hafer, Sonnenblumenöl'],
    ['Hafer, gehaertetes Pflanzenfett', 'Hafer, gehärtetes Pflanzenfett'], ['Milch, Kaese', 'Milch, Käse'],
    ['Wasser, Aepfel, Moehren', 'Wasser, Äpfel, Möhren'], ['Hafer, Gewuerze', 'Hafer, Gewürze'],
    // Both kinds in one word: the "ae" is an umlaut, the "ue" beside it is not.
    ['Hafer, Saeuerungsmittel Citronensaeure', 'Hafer, Säuerungsmittel Citronensäure']];
  for (const [written, real] of pairs) {
    assert.deepEqual(engine.parse(written), engine.parse(real), written);
    assert.equal(score(written).score, score(real).score, written);
    assert.deepEqual(reasons(score(written)), reasons(score(real)), written);
  }
  assert.ok(score('Hafer, Sonnenblumenoel').cap, 'the oil caps the score');
  // Words that only happen to hold the letters are left exactly as written.
  for (const text of ['Oats, blueberries, aloe vera juice', 'Roggenmehl, Sauerteig, Salz', 'Water, tomato puree, glucose', 'Oats, true cinnamon, queso fresco']) {
    assert.deepEqual(engine.parse(text), text.toLowerCase().split(', '), text);
  }
});

// The words of an ingredient panel that no rule charges are a rule table of their own (db/vocabulary.js).
test('the panel vocabulary is its own rule file, and still only decides what counts as read', () => {
  const vocabulary = require('../src/engine/db/vocabulary.js');
  assert.ok(vocabulary.COMMON_PANEL instanceof RegExp && vocabulary.COMMON_PANEL.flags === 'i', 'one case-insensitive pattern, never global');
  for (const word of ['water', 'turmeric root powder', 'Vollmilchpulver', 'śmietanka', 'yoğurt', 'b breve', 'e330'.replace('330', '440')]) {
    assert.ok(vocabulary.COMMON_PANEL.test(word.toLowerCase()), word);
  }
  // Read, and charged nothing.
  const r = score('Water, turmeric, cumin, garlic');
  assert.equal(r.coverage, 1);
  assert.equal(r.bad.length, 0);
  // Hashed with the other rule sources: a word added here can change what counts as read.
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, 'rules-revision.test.js'), 'utf8'), /engine\/db\/vocabulary\.js/);
});

// score() asks the same question of the same entry several times, and keeps the answer (penaltiesFor,
// recognised). A kept answer must be the one a fresh engine gives, in whatever order lists arrive.
test('a remembered answer is the answer a fresh engine gives', () => {
  const lists = ['Water, Sugar, Salt, Natural Flavors', 'Organic agave nectar, oats', 'Enriched Wheat Flour (Wheat Flour, Niacin), Soybean Oil, Red 40',
    'Emulsifier (soy lecithin), preservative, colour', 'Sodium Benzoate (Preservative), Annatto (Color)', 'Oats, natural-flavors, soya-lecithin',
    'Milk, cream, sugar, carrageenan', 'Beef, salt, sodium nitrite', 'Water, Sugar, Salt, Natural Flavors'];
  const fresh = () => {
    const file = require.resolve('../src/engine/score.js');
    const kept = require.cache[file];
    delete require.cache[file];
    try { return require('../src/engine/score.js'); } finally { require.cache[file] = kept; }
  };
  const once = lists.map(text => JSON.stringify(fresh().score({ name: '', ingredients_text: text })));
  const warm = fresh();
  for (const order of [lists, [...lists].reverse(), lists]) {
    for (const text of order) {
      assert.equal(JSON.stringify(warm.score({ name: '', ingredients_text: text })), once[lists.indexOf(text)], text);
    }
  }
  // A user's weights change what a rule costs, never which rules read an entry.
  const strict = { weights: { sugar: 2, flavour: 0 } };
  assert.equal(JSON.stringify(warm.score({ name: '', ingredients_text: lists[0] }, strict)), JSON.stringify(fresh().score({ name: '', ingredients_text: lists[0] }, strict)));
  // Far more distinct entries than are kept: the store empties itself and the answers do not change.
  const many = Array.from({ length: 9000 }, (_, i) => `made-up ingredient ${i}`);
  for (let i = 0; i < many.length; i += 60) warm.score({ name: '', ingredients_text: many.slice(i, i + 60).join(', ') });
  assert.equal(JSON.stringify(warm.score({ name: '', ingredients_text: lists[0] })), once[0]);
});

test('a share is ignored when it is not a quantity', () => {
  for (const text of ['Oats, Sugar 0%', 'Oats, Sugar 140%']) {
    assert.equal(score(text).score, score('Oats, Sugar').score, text);
  }
});

test('sub-ingredients take the share of the entry that declares them', () => {
  const big = score('Chocolate 60% (sugar, cocoa butter), oats');
  const small = score('Chocolate 1% (sugar, cocoa butter), oats');
  assert.ok(costOf(big, /sugar/i) > costOf(small, /sugar/i));
});

test('entries after "contains 2% or less of" weigh as minor ingredients', () => {
  const marked = score('Water, Rice, Oats, Contains 2% or less of: Natural Flavors, Salt');
  const plain = score('Water, Rice, Oats, Natural Flavors, Salt');
  assert.ok(costOf(marked, /natural flavo/i) < costOf(plain, /natural flavo/i));
  assert.ok(marked.score > plain.score);
  assert.equal(marked.parsed, plain.parsed, 'the marker must not become an ingredient');
  for (const r of [marked, score('Water, Rice, Oats, Contains less than 2% of Natural Flavors, Salt')]) {
    assert.ok(r.bad.every(b => !/minor/i.test(b.ing || '') && !String(b.ing || '').includes('\u0001')), 'marker leaked into the panel');
  }
});

test('"of the following:" lead-ins do not hide the first ingredient behind them', () => {
  const reference = score('Water, Rice, Sugar, Natural Flavor');
  for (const text of ['Water, Rice, Contains 2% or less of the following: Sugar, Natural Flavor',
    'Water, Rice, Contains one or more of the following: Sugar, Natural Flavor',
    'Water, Rice, Less than 2% of the following: Sugar, Natural Flavor']) {
    const r = score(text);
    assert.deepEqual(engine.parse(text).slice(0, 2), ['water', 'rice'], text);
    assert.ok(engine.parse(text).every(e => !/following/.test(e)), text);
    assert.ok(costOf(r, /sugar/i) > 0, `${text}: sugar went uncharged`);
    assert.ok(r.score >= reference.score, text);
  }
});

test('only a limit of two percent or less opens the minor block', () => {
  const five = score('Water, Rice, Oats, Contains less than 5% of Natural Flavors, Salt');
  const plain = score('Water, Rice, Oats, Natural Flavors, Salt');
  assert.equal(five.score, plain.score);
});

test('a marker inside brackets cannot demote the rest of the list', () => {
  const nested = score('Water, Seasoning (contains 2% or less of salt, sugar), Soybean Oil, Red 40');
  const flat = score('Water, Seasoning (salt, sugar), Soybean Oil, Red 40');
  assert.equal(nested.parsed, flat.parsed);
  assert.equal(costOf(nested, /red 40|soybean/i), costOf(flat, /red 40|soybean/i));
});

test('a minor entry never weighs more than the same entry would by position', () => {
  const first = score('Contains 2% or less of Natural Flavors');
  const plain = score('Natural Flavors');
  assert.ok(costOf(first, /natural flavo/i) <= costOf(plain, /natural flavo/i));
});

test('the label\'s allergen line is not an ingredient list', () => {
  const plain = score('Oats, Honey');
  for (const statement of ['CONTAINS: MILK, SOY.', 'Contains: wheat, milk and soy.', 'Contains milk and soy ingredients.',
    'Allergens: milk, soy, wheat', 'Allergen information: Contains milk.', 'Contains: Tree Nuts (Almonds), Peanuts', 'Contains: none',
    'Contiene: leche y soja.', 'Enthält: Milch, Soja.']) {
    const text = `Oats, Honey. ${statement}`;
    const r = score(text);
    assert.equal(r.score, plain.score, text);
    assert.equal(r.nova, plain.nova, text);
    assert.equal(r.parsed, plain.parsed, text);
    assert.equal(r.coverage, plain.coverage, text);
  }
});

test('an allergen line still raises the allergen flag and the avoid list', () => {
  const r = score('Oats, Honey. CONTAINS: MILK, SOY.', { allergens: ['milk', 'soy', 'peanut'], avoidList: ['soy'] });
  assert.deepEqual(r.flags.filter(f => f.kind === 'allergen').map(f => f.id).sort(), ['milk', 'soy']);
  assert.ok(r.flags.some(f => f.kind === 'avoid' && f.id === 'soy'));
});

test('"contains" followed by something that is not an allergen is still a list', () => {
  const asList = score('Oats, Honey. Contains: Sugar, Salt');
  assert.ok(asList.parsed >= 4 && asList.score < score('Oats, Honey').score);
  assert.ok(score('Water, Seasoning (contains: salt, sugar)').parsed >= 3, 'a bracketed "contains:" is a sub-list');
  assert.ok(costOf(score('Water, Sugar. Contains milk and natural flavor'), /flavo/i) > 0, 'a mixed line is not an allergen line');
});

// ---- docs/AUDIT-2026-11-15.md: six formats that still hid a charged ingredient

test('two ingredients joined by a word are both charged when a rule reads only one of them', () => {
  // The opening of a peanut butter label, and the pairs the audit measured.
  for (const [joined, plain] of [['Roasted peanuts and sugar, salt', 'Roasted peanuts, sugar, salt'],
    ['Wheat flour and sugar', 'Wheat flour, sugar'], ['Water, citric acid and sugar', 'Water, citric acid, sugar'],
    ['Nonfat milk and dextrose', 'Nonfat milk, dextrose'], ['Water, cane sugar or soybeans', 'Water, cane sugar, soybeans']]) {
    // The same entries, and the half the pair hid is charged. (The two halves share one place in the list,
    // so the score need not be the comma list's to the point.)
    assert.deepEqual(engine.parse(joined), engine.parse(plain), joined);
    assert.ok(costOf(score(joined), /sugar|dextrose/i) > 0, `${joined}: the sweetener went uncharged`);
    assert.ok(Math.abs(score(joined).score - score(plain).score) <= 3, joined);
  }
  // A rule that reads the pair, or a split that would expose nothing new, leaves the entry as written.
  for (const whole of ['mono- and diglycerides', 'mono and diglycerides', 'natural and artificial flavors', 'salt and pepper',
    'sodium benzoate and potassium sorbate', 'red 40 and blue 1', 'half and half', 'herbs and spices', 'canola or sunflower oil']) {
    assert.deepEqual(engine.parse(whole), [whole], whole);
  }
  // A denial stays one claim however many things it denies.
  assert.deepEqual(reasons(score('Oats, no artificial colors or preservatives')), []);
});

test('a joining word left in front of an entry does not hide the ingredient', () => {
  const reference = score('Milk, cream, cane sugar');
  for (const text of ['Milk, cream, and cane sugar', 'Milk, cream, & cane sugar', 'Milk, cream, with cane sugar',
    'Milk, cream, including cane sugar', 'Milk, cream, added cane sugar', 'Milk, cream, also cane sugar']) {
    assert.equal(score(text).score, reference.score, text);
    assert.equal(engine.parse(text)[2], 'cane sugar', text);
  }
  assert.equal(score('Leche, nata y azúcar de caña').score, score('Leche, nata, azúcar de caña').score);
  assert.equal(score('Milch, Sahne, und Zucker').score, score('Milch, Sahne, Zucker').score);
  assert.equal(engine.parse('Milk, and organic cane sugar')[1], 'cane sugar', 'the organic word is still taken off');
  assert.ok(score('Milk, and organic cane sugar').good.length >= score('Milk, cane sugar').good.length);
  // The word stays when taking it off reads nothing more: an E-number, and the statement "contains sweeteners".
  assert.deepEqual(engine.parse('water, e 330'), ['water', 'e 330']);
  assert.deepEqual(reasons(score('water, contains sweeteners')), []);
  assert.deepEqual(reasons(score('water, contains: sweeteners')), []);
  // An additive the label did not name is still an ingredient after a joining word (90 against 78).
  for (const word of ['preservative', 'stabilizer', 'emulsifier', 'color', 'Konservierungsstoff']) {
    assert.equal(score(`Oats, salt, and ${word}`).score, score(`Oats, salt, ${word}`).score, word);
  }
  assert.deepEqual(engine.parse('water, and emulsifier'), ['water', 'emulsifier']);
  // "Contains:" in front of a list is a heading.
  assert.equal(score('Contains: sugar, salt').score, score('Sugar, salt').score);
});

test('a hyphen typed as another character is the hyphen', () => {
  for (const hyphen of ['\u2010', '\u2011', '\u2012', '\u2013']) {
    assert.equal(score(`Water, high${hyphen}fructose corn syrup, salt`).score, score('Water, high-fructose corn syrup, salt').score, `U+${hyphen.charCodeAt(0).toString(16)}`);
    assert.equal(score(`Water, glucose${hyphen}fructose syrup, salt`).score, score('Water, glucose-fructose syrup, salt').score);
  }
  assert.deepEqual(engine.parse('mono\u2011 and diglycerides'), ['mono- and diglycerides']);
  // A spaced en dash still sets the items of a dashed list apart.
  assert.equal(score('Oats \u2013 Sugar \u2013 Salt \u2013 Water').score, score('Oats, Sugar, Salt, Water').score);
});

test('a footnote mark after an ingredient does not hide it', () => {
  const reference = score('Oats, cane sugar, salt');
  for (const mark of ['1', ' 1', '<sup>1</sup>', '<sup>2</sup>', '+', '^', '\u00a7', '\u25ca', '\u2206', '\u00aa', '*+']) {
    assert.equal(score(`Oats, cane sugar${mark}, salt`).score, reference.score, JSON.stringify(mark));
  }
  assert.equal(score('Oats, +cane sugar, salt').score, reference.score);
  assert.equal(score('Cocoa mass1, cane sugar1, cocoa butter1').score, score('Cocoa mass, cane sugar, cocoa butter').score);
  // A digit that is part of the name stays: dyes, vitamins, polysorbates, and a count inside an entry.
  for (const name of ['red 3', 'blue 1', 'blue 2', 'yellow 5', 'yellow 6', 'green 3', 'vitamin b1', 'vitamin b6', 'vitamin d3',
    'vitamin k2', 'omega 3', 'polysorbate 80', 'polysorbate 60', 'fd&c blue no 1', 'laureth 7', '10^9 cfu lactobacillus']) {
    assert.deepEqual(engine.parse(name), [name], name);
  }
  assert.ok(costOf(score('Water, blue 1, salt'), /blue 1/i) > 0);
});

test('text in angle brackets is read, and only real markup is removed', () => {
  assert.equal(score('Oats, <red 40>, salt').score, score('Oats, (red 40), salt').score);
  assert.ok(costOf(score('Oats, <red 40>, salt'), /red 40/i) > 0);
  assert.equal(score('Water <eau>, sugar <sucre>, red 40 <rouge 40>').score, score('Water (eau), sugar (sucre), red 40 (rouge 40)').score);
  // Elements, closing tags and anything carrying an attribute are still markup.
  assert.deepEqual(engine.parse('<span class="a">Oats</span>, <b>sugar</b>, <i>salt</i>'), ['oats', 'sugar', 'salt']);
  assert.deepEqual(engine.parse('<p>Oats, sugar, </p><custom-row data-x="1">salt</custom-row>'), ['oats', 'sugar', 'salt']);
  assert.deepEqual(engine.parse('Oats<br>Sugar<br/>Salt'), ['oats', 'sugar', 'salt']);
});

test('"less than" written with a sign, in words or with a colon is read as a quantity', () => {
  const bracketed = score('Oats, sugar (<2%), salt');
  for (const text of ['Oats, <2% sugar, salt', 'Oats, < 2% sugar, salt', 'Oats, less than 2% sugar, salt', 'Oats, \u22642% sugar, salt']) {
    assert.equal(score(text).score, bracketed.score, text);
    assert.equal(engine.parse(text)[1], 'sugar', text);
  }
  const block = score('Oats, less than 2% of: sugar, salt');
  for (const text of ['Oats, less than 2%: sugar, salt', 'Oats, <2% of: sugar, salt', 'Oats, <2% of sugar, salt', 'Oats, contains <2% of sugar, salt', 'Oats, 2% or less: sugar, salt']) {
    assert.equal(score(text).score, block.score, text);
    assert.deepEqual(engine.parse(text), ['oats', 'sugar', 'salt'], text);
  }
  // A fat level is still not a share, and a sign after the ingredient was always read.
  assert.deepEqual(engine.parse('2% milk, salt'), ['2% milk', 'salt']);
  assert.equal(score('Oats, sugar <2%, salt').score, bracketed.score);
});

test('a list headed "Contains:" is a list when it holds a capped ingredient, and an allergen line otherwise', () => {
  const headed = score('Contains: Milk, Wheat Flour, Soybean Oil, Eggs', { allergens: ['milk', 'egg', 'soy', 'wheat'] });
  const plain = score('Milk, Wheat Flour, Soybean Oil, Eggs', { allergens: ['milk', 'egg', 'soy', 'wheat'] });
  assert.equal(headed.readable, true);
  assert.equal(headed.score, plain.score);
  assert.deepEqual(headed.flags.map(f => f.id).sort(), plain.flags.map(f => f.id).sort());
  // An allergen line published in place of the list names sources, never a capped ingredient: it is not a
  // two-ingredient food and must not be shown a score.
  for (const line of ['Contains: Milk, Soy.', 'Contains wheat, milk, egg and soy.', 'CONTAINS: PEANUTS, TREE NUTS (ALMONDS), SOY LECITHIN', 'Allergens: milk, wheat gluten']) {
    assert.equal(score(line).readable, false, line);
  }
  // After a list an allergen line is set aside as it always was.
  assert.equal(score('Oats, honey. Contains: wheat, soy.').score, score('Oats, honey').score);
});

// ---- docs/AUDIT-2026-11-16.md: what 1.26.4 left

test('a purpose written after an ingredient does not hide it', () => {
  for (const [written, plain] of [['Milk, salt, sugar added', 'Milk, salt, sugar'],
    ['Peaches, water, sugar added to promote color retention', 'Peaches, water, sugar'],
    ['Oats, dextrose for browning, salt', 'Oats, dextrose, salt'], ['Oats, cane sugar as a sweetener, salt', 'Oats, cane sugar, salt']]) {
    assert.equal(score(written).score, score(plain).score, written);
    assert.deepEqual(engine.parse(written), engine.parse(plain), written);
  }
  // Left as written when taking the clause off reads nothing more, or a rule reads the phrase whole.
  // (A rule that is not anchored reads the entry with its clause: corn syrup is capped either way.)
  assert.equal(score('Oats, corn syrup to retain moisture, salt').score, score('Oats, corn syrup, salt').score);
  for (const whole of ['color added', 'vegetable oil for frying', 'ready to eat', 'vitamin d3 added', 'salt added to enhance flavor', 'corn syrup to retain moisture']) {
    assert.deepEqual(engine.parse(whole), [whole], whole);
  }
  assert.ok(costOf(score('Rice, salt, bht added to preserve freshness'), /bht/i) > 0);
});

test('a footnote digit after a name that ends in a number is dropped, and an E-number is never shortened', () => {
  assert.equal(score('Oats, red 401, salt').score, score('Oats, red 40, salt').score);
  assert.equal(score('Oats, yellow 51, salt').score, score('Oats, yellow 5, salt').score);
  assert.equal(score('Oats, polysorbate 801, salt').score, score('Oats, polysorbate 80, salt').score);
  for (const name of ['e 1422', 'e1422', 'e 142', 'e 1001', 'red 40', 'yellow 6', 'vitamin b12', 'polysorbate 60']) assert.deepEqual(engine.parse(name), [name], name);
  // A personal-care label keeps its dyes as written: Red 33 is a dye of its own there.
  const shampoo = engine.score({ name: 'Moisturizing Shampoo', ingredients_text: 'Water, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Fragrance, Red 33, Yellow 10' });
  assert.ok(!JSON.stringify(shampoo).toLowerCase().includes('red 3"'), 'Red 33 was read as Red 3');
});

test('"contains" before a capped ingredient is a statement about the food, not an allergen line', () => {
  assert.equal(score('Oats, salt. Contains soybean oil.').score, score('Oats, salt, soybean oil').score);
  assert.equal(score('Oats, contains high fructose corn syrup, salt').score, score('Oats, high fructose corn syrup, salt').score);
  const flagged = score('Oats, salt. Contains soybean oil.', { allergens: ['soy'] });
  assert.deepEqual(flagged.flags.map(f => f.id), ['soy'], 'the soy warning is kept');
  // A source with no capped ingredient is still an allergen line.
  for (const line of ['Contains: soy, wheat.', 'Contains milk and soy ingredients.', 'Contains: Tree Nuts (Almonds), Peanuts', 'Contains: sulphites']) {
    assert.equal(score(`Oats, honey. ${line}`).score, score('Oats, honey').score, line);
  }
});

test('a denial written as a sentence is a denial', () => {
  for (const text of ['Oats, does not contain aspartame', 'Oats, this product does not contain red 40', 'Oats. Does not contain any high fructose corn syrup.', 'Oats, contains no artificial colors']) {
    assert.equal(score(text).score, score('Oats').score, text);
  }
});

test('a spaced en dash inside a comma list, and angle brackets round an accented word, are read', () => {
  assert.equal(score('Oats, glucose \u2013 fructose syrup, salt').score, score('Oats, glucose-fructose syrup, salt').score);
  assert.equal(score('Eau, <\u00e9mulsifiant>, sel').score, score('Eau, \u00e9mulsifiant, sel').score);
});

test('a claim typed as an entry of its own counts as a title claim does', () => {
  const junk = 'Sugar, palm oil, corn starch, salt';
  const typed = engine.score({ name: 'Candy', ingredients_text: `${junk}, organic, non-gmo, fermented, sprouted, grass-fed, pasture-raised, wild-caught` });
  const titled = engine.score({ name: 'Organic Non-GMO Fermented Sprouted Grass-Fed Pasture-Raised Wild-Caught Candy', ingredients_text: junk });
  assert.equal(typed.score, titled.score);
  assert.ok(typed.good.filter(g => !g.organic).every(g => /unverified/.test(g.why)), JSON.stringify(typed.good));
  // The label's own claims count in full: one that qualifies an ingredient, a footnote, a bracket, a note.
  const full = score('Organic cane sugar, palm oil, salt').score;
  for (const text of ['Cane sugar*, palm oil, salt. *Organic', 'Cane sugar (organic), palm oil, salt', 'Cane sugar*, palm oil, salt. *Certified organic ingredients']) {
    assert.equal(score(text).score, full, text);
  }
  assert.ok(score('Cane sugar, palm oil, salt, organic').score < full);
  // An oil's pressing is how the oil is named, and stays evidence from the list.
  assert.equal(score('Olive oil, extra virgin').score, score('Extra virgin olive oil').score);
});

test('two lines with no comma stay one wrapped ingredient', () => {
  // The audit proposed reading two lines as two ingredients when that charges more. It would: "Almond\nFlour"
  // becomes almonds and (wheat) flour, "Rice\nSyrup" rice and syrup. A wrapped name is far the commoner case.
  for (const [wrapped, name] of [['Almond\nFlour', 'almond flour'], ['Coconut\nSugar', 'coconut sugar'], ['High Fructose\nCorn Syrup', 'high fructose corn syrup'],
    ['Rice\nSyrup', 'rice syrup'], ['Peanut\nButter', 'peanut butter']]) {
    assert.deepEqual(engine.parse(wrapped), [name], name);
    assert.equal(score(wrapped).score, score(name).score, name);
  }
});

test('the scoring policy publishes the share rules it applies', () => {
  assert.equal(engine.SCORING_POLICY.minorBlockLimit, 2);
  assert.equal(engine.SCORING_POLICY.minCoverage, engine.MIN_COVERAGE);
  assert.deepEqual(engine.SCORING_POLICY.shareTiers, ['25%+ → 1.5', '10%+ → 1.25', '2%+ → 1', 'under 2% → 0.5']);
  assert.ok(Object.isFrozen(engine.SCORING_POLICY));
});

test('reasons never carry an internal marker', () => {
  const r = score('Water, Sugar, Contains 2% or less of: Natural Flavors, Red 40');
  for (const row of [...r.good, ...r.bad]) assert.ok(!JSON.stringify(row).includes('\u0001'), JSON.stringify(row));
  assert.ok(reasons(r).length > 0);
});

// The first score() compiles the engine's patterns (about 200 ms). warmUp() does that in idle time, once, and
// must change nothing a caller can see.
test('warming the engine up is idle, once, and invisible', async () => {
  const before = score('Oats, Sugar, Natural Flavors');
  const scheduled = [];
  const saved = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn, options) => { scheduled.push({ fn, options }); return scheduled.length; };
  try {
    engine.warmUp(); engine.warmUp(); engine.warmUp();
    assert.equal(scheduled.length, 1, 'once however often it is called');
    assert.equal(scheduled[0].options.timeout, 3000, 'it runs even on a page that never goes idle');
    scheduled[0].fn();
  } finally { if (saved) globalThis.requestIdleCallback = saved; else delete globalThis.requestIdleCallback; }
  assert.deepEqual(score('Oats, Sugar, Natural Flavors'), before, 'scoring after the warm-up is unchanged');
  assert.deepEqual(engine.parse('Oats, Sugar'), ['oats', 'sugar']);
});
