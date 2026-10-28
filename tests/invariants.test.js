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
