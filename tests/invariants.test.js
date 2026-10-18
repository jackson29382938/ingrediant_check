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
