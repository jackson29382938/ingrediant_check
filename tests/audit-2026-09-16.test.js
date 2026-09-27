// Regression pins for the September 16, 2026 audit (docs/history/AUDIT-2026-09-16.md).
// Run: node --test tests/audit-2026-09-16.test.js
//
// Two of these are regressions the September 14 fix introduced and the corpus could not see,
// because it held no label with a parenthetical function word and none with "natural flavors".
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmazonContentScripts } = require('./content-scripts.js');
const fs = require('node:fs');
const path = require('node:path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const engine = require(src('engine/score.js'));
const allergens = require(src('engine/db/allergens.js'));
const gate = require(src('engine/db/ingestible.js'));
const panel = require(src('content/panel.js'));

const score = (text, extra = {}) => engine.score({ ingredients_text: text, ...extra });
const rows = (r, re) => r.bad.filter(h => re.test(h.why));
const flags = (list, a = [], d = []) => allergens.detect(list, a, d).map(f => f.label);

// ---------------------------------------------------------------- regressions from 7632930
test('a function word in parentheses beside a named additive is a disclosure, not a second additive', () => {
  for (const [plain, disclosed] of [
    ['Water, Sugar, Sodium Benzoate', 'Water, Sugar, Sodium Benzoate (Preservative)'],
    ['Milk, Xanthan Gum', 'Milk, Xanthan Gum (Stabilizer)'],
    ['Cocoa, Soy Lecithin', 'Cocoa, Soy Lecithin (Emulsifier)'],
    ['Cheese, Annatto', 'Cheese, Annatto (Color)'],
    ['Cheese, Paprika Extract', 'Cheese, Paprika Extract (Color)'],
    ['Juice, Citric Acid', 'Juice, Citric Acid (Acidulant)'],
    ['Oil, Mixed Tocopherols', 'Oil, Mixed Tocopherols (Antioxidant)'],
    ['Cocoa, Emulsifier: Soy Lecithin', 'Cocoa, Emulsifier (Soy Lecithin)'],
    ['Water, Potassium Sorbate', 'Water, Preservative (Potassium Sorbate)'],
  ]) {
    const a = score(plain), b = score(disclosed);
    assert.equal(b.score, a.score, `${disclosed} scored ${b.score}, ${plain} scored ${a.score}`);
    assert.equal(rows(b, /^Unnamed/).length, 0, `${disclosed} still carries an "Unnamed" row`);
  }
});

test('a function word with nothing readable beside it is still an undisclosed additive', () => {
  for (const [word, expected] of [
    ['Preservative', /^Unnamed preservative/],
    ['conservante', /^Unnamed preservative/],
    ['conservateur', /^Unnamed preservative/],
    ['Konservierungsstoff', /^Unnamed preservative/],
    ['conservanti', /^Unnamed preservative/],
    ['Color Added', /^Unnamed colour/],
    ['colorante', /^Unnamed colour/],
    ['Emulgator', /^Unnamed emulsifier/],
    ['acidulant', /^Unnamed acidity regulator/],
  ]) {
    assert.equal(rows(score(`Water, ${word}`), expected).length, 1, word);
  }
  assert.equal(rows(score('Water, Preservative (Zorblaxium)'), /^Unnamed preservative/).length, 1);
});

test('the qualifier strip never charges the same flavour twice', () => {
  for (const [text, want] of [
    ['Oats, natural flavors', /^"Natural flavors"/],
    ['Oats, natural smoke flavor', /^"Natural flavor"/],
    ['Oats, natural vanilla flavor', /^"Natural flavor"/],
    ['Oats, artificial flavor', /^Artificial flavour$/],
  ]) {
    const r = score(text);
    const flavour = r.bad.filter(h => /flavou?r/i.test(h.why));
    assert.equal(flavour.length, 1, `${text}: ${flavour.map(h => h.why).join(' | ')}`);
    assert.match(flavour[0].why, want);
  }
  // ...while still catching what it was written for: the agave row is the same with or without
  // "organic" (the organic bonus itself is legitimate and is not part of this).
  assert.equal(rows(score('Oats, organic agave nectar'), /Agave/)[0].c, rows(score('Oats, agave nectar'), /Agave/)[0].c);
});

test('cane sugar costs what sugar costs, once', () => {
  const sugar = score('Oats, sugar'), cane = score('Oats, cane sugar');
  assert.equal(rows(cane, /sugar/i).length, 1, cane.bad.map(h => h.why).join(' | '));
  assert.ok(Math.abs(sugar.score - cane.score) <= 1, `sugar ${sugar.score} vs cane sugar ${cane.score}`);
  const organic = score('Oats, organic cane sugar');
  assert.equal(rows(organic, /sugar/i).length, 1);
  assert.equal(rows(organic, /sugar/i)[0].c, rows(cane, /sugar/i)[0].c);
});

// ---------------------------------------------------------------- EU labels by E-number
test('an additive named by E-number scores like its English name', () => {
  for (const [words, codes] of [
    ['Water, sugar, aspartame, acesulfame K', 'Water, sugar, sweeteners (E951, E950)'],
    ['Water, sugar, quinoline yellow, ponceau 4R', 'Water, sugar, colours (E104, E124)'],
    ['Water, sugar, sodium benzoate, citric acid', 'Water, sugar, E211, E330'],
    ['Pork, salt, sodium nitrite, sodium ascorbate', 'Pork, salt, E250, E301'],
    ['Wheat flour, water, modified starch, potassium sorbate', 'Wheat flour, water, E1422, E202'],
    ['Cocoa, sugar, mono- and diglycerides, xanthan gum', 'Cocoa, sugar, E471, E415'],
    ['Water, sucralose', 'Water, E 955'],
    ['Water, erythritol', 'Water, e-968'],
  ]) {
    const a = score(words), b = score(codes);
    assert.equal(b.score, a.score, `${codes} scored ${b.score}, ${words} scored ${a.score}`);
    assert.ok(b.coverage >= 0.75, `${codes}: coverage ${b.coverage}`);
  }
});

test('the EU azo colours that carry a warning label set a ceiling', () => {
  for (const c of ['quinoline yellow', 'carmoisine', 'ponceau 4R', 'patent blue V', 'green S', 'brilliant black BN', 'brown HT', 'E122', 'E 124']) {
    const r = score(`Water, sugar, ${c}`);
    assert.ok(r.cap, `${c} set no cap`);
    assert.ok(r.score <= 25, `${c} scored ${r.score}`);
  }
});

test('E322 is charged as lecithin of unstated source, between soy and sunflower', () => {
  const soy = score('Cocoa, soy lecithin'), e322 = score('Cocoa, E322'), sun = score('Cocoa, sunflower lecithin');
  assert.ok(soy.score < e322.score && e322.score < sun.score, `${soy.score} / ${e322.score} / ${sun.score}`);
  assert.equal(rows(score('Cocoa, sunflower lecithin'), /^Lecithin —/).length, 0);
});

// ---------------------------------------------------------------- flags
test('maltodextrin, maltitol and maltose are not wheat', () => {
  for (const ing of ['maltodextrin', 'maltitol', 'maltose', 'maltol']) {
    assert.deepEqual(flags([ing], ['wheat'], ['glutenFree']), [], ing);
  }
  for (const ing of ['malt extract', 'malted barley', 'barley malt', 'malt vinegar', 'malt']) {
    assert.ok(flags([ing], ['wheat']).includes('Wheat / gluten'), ing);
  }
});

test('sweet potato is not a nightshade, a Cornish hen is not corn, rice bran oil is keto', () => {
  assert.deepEqual(flags(['sweet potato'], ['nightshade']), []);
  assert.deepEqual(flags(['sweet potato starch'], ['nightshade']), []);
  assert.ok(flags(['potato starch'], ['nightshade']).length);
  assert.deepEqual(flags(['cornish game hen'], ['corn']), []);
  assert.ok(flags(['cornstarch'], ['corn']).length);
  assert.deepEqual(flags(['rice bran oil'], [], ['keto']), []);
  assert.ok(flags(['brown rice'], [], ['keto']).length);
});

test('vegan and vegetarian flags see the animals labels actually name', () => {
  for (const ing of ['shrimp', 'prawns', 'crab', 'duck fat', 'bacon', 'ham', 'sausage', 'veal', 'venison', 'goose fat', 'gelatine', 'lard', 'chicken broth', 'isinglass', 'carmine', 'E120', 'rennet']) {
    assert.ok(flags([ing], [], ['vegan']).includes('Not vegan'), `${ing} passed as vegan`);
    assert.ok(flags([ing], [], ['vegetarian']).includes('Not vegetarian'), `${ing} passed as vegetarian`);
  }
  for (const ing of ['albumen', 'honey', 'beeswax', 'shellac', 'whey', 'lanolin']) {
    assert.ok(flags([ing], [], ['vegan']).includes('Not vegan'), `${ing} passed as vegan`);
  }
  for (const ing of ['coconut meat', 'vegetable broth', 'mushroom stock', 'hamburger buns', 'gooseberry', 'crabapple', 'porcini', 'oat milk', 'seitan', 'microbial rennet', 'vegetable rennet']) {
    assert.deepEqual(flags([ing], [], ['vegan', 'vegetarian']), [], ing);
  }
});

test('the three EU-only allergens exist and read four languages', () => {
  assert.deepEqual(flags(['apio', 'moutarde', 'lupin flour'], ['celery', 'mustard', 'lupin']), ['Celery', 'Mustard', 'Lupin']);
  assert.deepEqual(flags(['Sellerie'], ['celery']), ['Celery']);
  assert.deepEqual(flags(['senape'], ['mustard']), ['Mustard']);
  assert.deepEqual(flags(['altramuz'], ['lupin']), ['Lupin']);
});

test('dairy is detected in Spanish, French, German and Italian, and plant milks are not', () => {
  for (const ing of ['leche entera', 'lait écrémé', 'vollmilchpulver', 'latte intero', 'süßmolkenpulver', 'crème fraîche', 'burro', 'mantequilla', 'queso', 'fromage', 'formaggio', 'sauerrahm', 'yaourt', 'lactosérum', 'siero di latte']) {
    assert.deepEqual(flags([ing], ['milk'], ['vegan', 'dairyFree']), ['Milk', 'Not vegan', 'Not dairy-free'], ing);
  }
  for (const ing of ['leche de coco', "lait d'amande", 'lait de coco', 'kokosmilch', 'hafermilch', 'kokosnussmilch', 'mandelmilch', 'latte di mandorla', 'latte di cocco', 'burro di cacao', 'burro di arachidi', 'beurre de cacao', 'mantequilla de cacahuete', 'crema di nocciole', 'crema de cacahuete', 'nata de coco', 'laitue']) {
    assert.deepEqual(flags([ing], ['milk'], ['dairyFree']), [], ing);
  }
});

test('accented words have boundaries: blé, œuf, maní, épeautre', () => {
  assert.deepEqual(flags(['farine de blé'], ['wheat']), ['Wheat / gluten']);
  assert.deepEqual(flags(['épeautre'], ['wheat']), ['Wheat / gluten']);
  assert.deepEqual(flags(['œufs'], ['egg']), ['Egg']);
  assert.deepEqual(flags(['maní'], ['peanut']), ['Peanut']);
  // ...and nutmeg is not a tree nut in any of them.
  for (const ing of ['nuez moscada', 'noix de muscade', 'noce moscata', 'noix de coco', 'muskatnuss', 'nutmeg']) {
    assert.deepEqual(flags([ing], ['treeNut']), [], ing);
  }
});

// ---------------------------------------------------------------- the food gate
test('real groceries no longer read as equipment, apparel or skincare from the title alone', () => {
  for (const title of [
    'Funnel Cake Mix, 16 oz',
    'Halo Top Protein Ice Cream, Vanilla Bean, Pint',
    'Heinz Tomato Ketchup, Squeeze Bottle with Flip Cap, 32 oz',
    'Organic Coconut Oil Cream Cheese Spread',
    'Sparkling Water 12 Fl Oz Cans, 24 Count Case',
    'Vital Proteins Collagen Creamer',
  ]) {
    const v = gate.assessTitle(title);
    assert.deepEqual(v.negatives, [], `${title}: ${v.negatives.join(',')}`);
    assert.equal(gate.looksNonFoodFromTitle(title), false, title);
  }
});

test('the non-food titles those guards protected still read as non-food', () => {
  for (const title of ['Nike Baseball Cap', "Men's Cap Black", 'Apple Watch Series 9', 'Collagen Face Cream', 'Vitamin C Serum', 'Protein Shaker Bottle', 'iPhone 15 Case', 'Dr. Squatch Bar Soap', 'Vitamin E Cream for Face', 'Kitchen Funnel Set']) {
    assert.equal(gate.looksNonFoodFromTitle(title), true, title);
  }
});

// ---------------------------------------------------------------- panel and cache plumbing
test('penalty rows carry their category and the refined-sugar mark', () => {
  const r = score('Oats, cane sugar, raisins');
  const sugar = rows(r, /Cane sugar/)[0];
  assert.equal(sugar.cat, 'sugar');
  assert.equal(sugar.refined, true);
  const honey = rows(score('Oats, honey, raisins'), /Honey/)[0];
  assert.equal(honey.refined, undefined);
  // The panel hides the "natural sugar not counted" note only when refined sugar is present.
  const html = panel.render(r, { title: 't', confidence: 1 });
  assert.ok(!/Natural sugar \(fruit or dairy\)/.test(html), 'natural-sugar note shown beside cane sugar');
  const htmlHoney = panel.render(score('Oats, honey, raisins'), { title: 't', confidence: 1 });
  assert.ok(/Natural sugar \(fruit or dairy\)/.test(htmlHoney), 'natural-sugar note hidden beside honey');
});

test('the paste box does not take focus when the failure card mounts', () => {
  const wiring = fs.readFileSync(src('content/panel.js'), 'utf8').match(/function wirePasteField[\s\S]*?\n {2}}\n/)[0];
  assert.ok(!/\.focus\(/.test(wiring), 'wirePasteField focuses the textarea');
  assert.ok(!/\.select\(\)/.test(wiring), 'wirePasteField selects the textarea');
});

test('hover and auto-score arm only on results pages', () => {
  const arm = (pathname, search) => {
    const tiles = [0, 1, 2].map(i => ({
      _attrs: { 'data-asin': 'B0' + String(i).padStart(8, '0') }, isConnected: true,
      getAttribute(k) { return this._attrs[k] ?? null; }, setAttribute(k, v) { this._attrs[k] = String(v); },
      hasAttribute(k) { return k in this._attrs; }, removeAttribute(k) { delete this._attrs[k]; },
      addEventListener() {}, querySelector: () => ({ innerText: 'Organic Rolled Oats' }), querySelectorAll: () => [],
    }));
    const noop = () => {};
    const el = () => ({ appendChild: noop, insertBefore: noop, remove: noop, dataset: {}, isConnected: true, setAttribute: noop, style: {}, querySelector: () => null });
    global.document = {
      documentElement: el(), title: 'Amazon.com', getElementById: () => null, createElement: el, addEventListener: noop,
      querySelector: () => null,
      querySelectorAll: sel => (sel.startsWith('[data-asin]') ? tiles.filter(t => !/data-air-(hover|auto)/.test(sel) || !t.hasAttribute(sel.match(/data-air-\w+/)[0])) : []),
    };
    global.self = global;
    global.window = global;
    global.location = { href: 'https://www.amazon.com' + pathname + search, pathname, search, hostname: 'www.amazon.com' };
    global.MutationObserver = class { observe() {} disconnect() {} };
    global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    global.setInterval = () => 0;
    global.addEventListener = () => {};
    global.chrome = {
      runtime: { getManifest: () => ({ version: '1.0.2' }), sendMessage: () => {}, lastError: null, onMessage: { addListener() {} } },
      storage: { local: { get: (k, cb) => cb && cb({ enabled: true, badges: true, hoverScore: true, autoScoreSearch: true, foodOnly: false }), set: noop, remove: noop }, onChanged: { addListener: noop } },
    };
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    delete global.AIR; delete global.AIRmodule;
    // The production module set, in manifest order; an [AIR] error while they run fails the test.
    loadAmazonContentScripts();
    return {
      hover: tiles.filter(t => t.hasAttribute('data-air-hover')).length,
      auto: tiles.filter(t => t.hasAttribute('data-air-auto')).length,
    };
  };
  assert.deepEqual(arm('/dp/B000000001', ''), { hover: 0, auto: 0 }, 'a product page armed its carousels');
  assert.deepEqual(arm('/s', '?k=oats'), { hover: 3, auto: 3 }, 'a results page did not arm');
});

test('milk thistle and crab apple are plants, not milk or shellfish; real milk and crab still flag', () => {
  const all = allergens.ALLERGENS.map(a => a.id);
  const diets = allergens.DIETS.map(d => d.id);
  const labels = text => engine.score({ ingredients_text: text }, { allergens: all, diets }).flags.map(f => f.label);
  for (const text of ['milk thistle extract', 'crab apple', 'crab-apple jelly', 'crabapples']) {
    assert.deepEqual(labels(text), [], text);
  }
  assert.ok(labels('whole milk').includes('Milk'));
  assert.ok(labels('crab meat').includes('Shellfish'));
  assert.ok(labels('king crab legs').includes('Not vegetarian'));
});

test('allergens hidden in ingredient names are flagged (a missed flag looks like "clear")', () => {
  const flagged = (id, text) => engine.score({ ingredients_text: text }, { allergens: [id] }).flags.some(f => f.id === id);
  const expect = {
    milk: ['curds', 'butterfat', 'mozzarella', 'parmesan', 'half and half', 'skyr', 'brie', 'feta'],
    egg: ['aioli', 'eggnog'],
    wheat: ['graham flour', 'panko', 'breadcrumbs', 'shortbread'],
    soy: ['natto', 'textured vegetable protein'],
    fish: ['surimi', 'bonito flakes', 'caviar', 'cod roe', 'dashi'],
    treeNut: ['pesto', 'nougat', 'frangipane'],
    peanut: ['monkey nuts'],
    sesame: ['halva', 'gomasio', "za'atar"],
    sulfite: ['sodium metabisulfite', 'potassium bisulfite'],
    mustard: ['dijon'],
  };
  for (const [id, list] of Object.entries(expect)) for (const text of list) assert.ok(flagged(id, text), `${id}: ${text}`);
  // …without flagging what only looks similar.
  assert.equal(flagged('milk', 'bean curd'), false);
  assert.equal(flagged('wheat', 'breadfruit'), false);
  assert.equal(flagged('fish', 'Monroe county honey'), false);
  const vegetarian = text => engine.score({ ingredients_text: text }, { diets: ['vegetarian'] }).flags.length > 0;
  assert.ok(vegetarian('dashi'), 'fish stock is not vegetarian');
});

test('the allergen declaration words themselves are flagged, in every label language', () => {
  const flagged = (id, text) => engine.score({ ingredients_text: text }, { allergens: [id] }).flags.some(f => f.id === id);
  // "Contains: tree nuts" / "shellfish" is how US labels declare; "nuts" is how UK labels do.
  for (const text of ['Contains: Milk, Tree Nuts (Almonds)', 'tree nuts', 'mixed nuts', 'nuts', 'frutos secos',
    'frutta a guscio', 'fruits à coque', 'Schalenfrüchte', 'Nüsse']) assert.ok(flagged('treeNut', text), text);
  assert.ok(flagged('shellfish', 'shellfish'));
  for (const text of ['Hühnerei', 'Hühnereiweiß', 'Trockenvollei']) assert.ok(flagged('egg', text), text);
  assert.ok(flagged('peanut', 'cacahuètes'));
  // Not nuts: peanuts are legumes (their own flag), coconut and nutmeg are not tree nuts here, tiger
  // nuts are tubers, and "Brei" / "Reis" are not eggs.
  for (const text of ['peanuts', 'coconut', 'nutmeg', 'doughnut', 'nutritional yeast', 'tiger nuts', 'Kokosnüsse']) {
    assert.equal(flagged('treeNut', text), false, text);
  }
  for (const text of ['Brei', 'Reis']) assert.equal(flagged('egg', text), false, text);
});

test('animal ingredients in every label language conflict with vegetarian and vegan', () => {
  const labels = (text, diet) => engine.score({ ingredients_text: text }, { diets: [diet] }).flags.map(f => f.label);
  for (const text of ['collagen', 'pepsin', 'Schweinefleisch', 'Rindfleisch', 'Putenbrust', 'Hühnerbrühe', 'manteca de cerdo',
    'jamón serrano', 'saindoux', 'viande de bœuf', 'manzo', 'strutto']) assert.ok(labels(text, 'vegetarian').length, text);
  for (const text of ["confectioner's glaze", 'l-cysteine']) assert.ok(labels(text, 'vegan').length, text);
  // Not animal: peel, mushrooms, coconut flesh, vegetable stock, an egg (vegetarian), lichen vitamin D3.
  for (const text of ['lemon rind', 'porcini mushrooms', 'coconut meat', 'Gemüsebrühe', 'Hühnerei']) {
    assert.deepEqual(labels(text, 'vegetarian'), [], text);
  }
  assert.deepEqual(labels('vitamin d3 (from lichen)', 'vegan'), []);
});

test('additives in the spellings US labels print: "FD&C Red No. 40", "#40", spelled-out TBHQ, bromated flour, propylparaben', () => {
  const capped = text => engine.score({ ingredients_text: `whole grain oats, water, salt, ${text}` }, {}).score;
  for (const text of ['FD&C Red No. 40', 'FD&C Red #40', 'Red No.40', 'FD&C Yellow No. 5']) assert.equal(capped(text), 18, text);
  assert.equal(capped('tertiary butylhydroquinone'), 45);
  assert.equal(capped('propylparaben'), 45);
  assert.equal(capped('bromated flour'), 15);
  // A full stop still ends an entry elsewhere, and decimals still do not split.
  // Each is compared with the same entry written without the full stop.
  const same = { 'vitamin B12.': 'vitamin B12', '2.5% salt': '2,5% salt', 'no. 2 grade corn': 'no 2 grade corn' };
  for (const [text, plain] of Object.entries(same)) {
    const withIt = engine.score({ ingredients_text: `whole grain oats, water, salt, ${text}` }, {});
    assert.equal(engine.parse(`whole grain oats, water, salt, ${text}`).length, 4, text);
    assert.equal(withIt.score, engine.score({ ingredients_text: `whole grain oats, water, salt, ${plain}` }, {}).score, text);
  }
});

test('indigo carmine, Citrus Red 2 and an unnamed sugar alcohol are read', () => {
  const oats = engine.score({ ingredients_text: 'whole grain oats, water, salt' }, {}).score;
  const with_ = text => engine.score({ ingredients_text: `whole grain oats, water, salt, ${text}` }, {}).score;
  assert.equal(with_('indigo carmine'), 18);
  assert.equal(with_('Citrus Red 2'), 18);
  assert.ok(with_('sugar alcohol') < oats);
});
