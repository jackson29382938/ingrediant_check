'use strict';
// How an index is shown. A personal-care or supplement index is a label index, not a quality band, so it
// is drawn in gray, named for its category and style, and worded in the reader's language. The first
// version drew the panel in the amber "Mediocre" band for every index and the badges in the band of
// the number (a green 80 on a shampoo), printed the raw id ("body-wash") on cart lines, and left its
// own sentences in English in a German browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../src/engine/score.js');
const theme = require('../src/engine/db/theme.js');
const ratings = require('../src/engine/db/product-ratings.js');
const cart = require('../src/stores/cart.js');
const panel = require('../src/content/panel.js');
globalThis.AIR.db.allergens = require('../src/engine/db/allergens.js');
globalThis.AIR.engine = engine;   // cart.summarize names a food average's band from the engine's table

const root = path.join(__dirname, '..');
const messages = locale => JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('every name and sentence an index shows is in the English and German catalogs', () => {
  const keys = [...Object.values(ratings.CATEGORY_KEYS), ...Object.values(ratings.STYLE_KEYS), 'catFood', 'verdictLabelIndex',
    'indexNote', 'indexNoteShort', 'careUnsupportedTitle', 'careUnsupportedBody', 'careReviewButton', 'reviewTitle',
    'reviewDefaultReason', 'reviewNoClaim', 'reviewSupplementNote', 'reviewFacts', 'reviewIngredients', 'reviewDisclaimer',
    'cartAverageCare', 'compareMixed', 'sortMixed', 'notFoodWhy', 'optStyleHelp'];
  for (const locale of ['en', 'de']) {
    const catalog = messages(locale);
    for (const key of keys) assert.ok(catalog[key] && catalog[key].message, `${locale} lacks ${key}`);
  }
  const en = messages('en'), de = messages('de');
  for (const key of ['catToothpaste', 'catBodyWash', 'indexNote', 'reviewTitle', 'sortMixed']) {
    assert.notEqual(de[key].message, en[key].message, `${key} is still English in German`);
  }
  assert.equal(ratings.categoryLabel('body-wash', (key, fallback) => messages('de')[key]?.message ?? fallback), 'Duschgel und Seife');
});

test('the setting a not-food panel points to is named as the settings page names it', () => {
  for (const locale of ['en', 'de']) {
    const catalog = messages(locale);
    const named = catalog.optFoodOnly.message;
    assert.ok(catalog.notFoodWhy.message.includes(named), `${locale}: "${catalog.notFoodWhy.message}" does not name "${named}"`);
  }
  for (const file of ['src/options/options.html', 'src/content/panel.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /Only rate food (?:&|and) supplements/, file);
  }
});

test('a script that names an index loads the module that names it, before it runs', () => {
  const naming = ['src/content/search.js', 'src/content/cart.js', 'src/content/retailer.js'];
  for (const group of manifest.content_scripts) {
    const scripts = group.js || [];
    const used = naming.filter(file => scripts.includes(file));
    if (!used.length) continue;
    const at = scripts.indexOf('src/engine/db/product-ratings.js');
    assert.ok(at >= 0 && at < scripts.indexOf(used[0]), `${used[0]} runs without product-ratings.js`);
    assert.ok(scripts.includes('src/engine/db/theme.js') && scripts.indexOf('src/engine/db/theme.js') < scripts.indexOf(used[0]), `${used[0]} runs without theme.js`);
  }
  for (const page of ['src/options/popup.html', 'src/options/sorted.html']) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /engine\/db\/product-ratings\.js/, page);
  }
  // Every group that scores must be able to rate: score.js reads the module through the same list.
  for (const group of manifest.content_scripts) {
    const scripts = group.js || [];
    if (scripts.includes('src/engine/score.js')) assert.ok(scripts.includes('src/engine/db/product-ratings.js') && scripts.includes('src/engine/db/ingestible.js'), String(scripts.slice(0, 3)));
  }
});

test('the neutral color is gray, readable, and the same in every palette', () => {
  const gray = theme.neutral();
  assert.deepEqual(Object.keys(gray).sort(), ['bg', 'dfg', 'dring', 'fg', 'ring']);
  assert.ok(theme.contrast(gray.fg, gray.bg) >= 4.5, 'light text');
  assert.ok(theme.contrast(gray.dfg, '#1b1c1c') >= 4.5, 'dark text on the card surface');
  const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (const hex of [gray.fg, gray.bg, gray.ring]) assert.ok(Math.max(...channels(hex)) - Math.min(...channels(hex)) <= 12, `${hex} is not gray`);
  // None of the quality bands may be mistaken for it.
  for (const palette of Object.keys(theme.PALETTES)) for (const score of [95, 80, 60, 30, 5]) {
    assert.notEqual(theme.band(score, palette).ring, gray.ring);
  }
});

const shampoo = { name: 'Gentle shampoo', ingredients_text: 'Water, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Fragrance' };

test('the panel draws an index in gray and captions it with its category and style', () => {
  for (const ratingStyle of ratings.STYLES) {
    const result = engine.score(shampoo, { ratingStyle, avoidList: ['fragrance'] });
    const html = panel.render(result, { title: shampoo.name });
    assert.ok(html.includes(`--fg:${theme.neutral().fg}`), ratingStyle);
    assert.ok(!html.includes(`--fg:${theme.band(result.score).fg}`) || theme.band(result.score).fg === theme.neutral().fg, ratingStyle);
    assert.ok(html.includes(`Shampoo · ${ratings.styleLabel(ratingStyle)}`), `${ratingStyle}: ${html.match(/class="sub">[^<]*/)}`);
    assert.doesNotMatch(html, /shampoo · evidence\b/, 'the raw id is not shown');
    assert.match(html, /Limited label index/);
  }
  const food = panel.render(engine.score({ name: 'Oats', ingredients_text: 'Rolled oats' }), { title: 'Oats' });
  assert.ok(food.includes(`--fg:${theme.band(100).fg}`), 'food keeps its band');
});

test('the breakdown card for a saved index keeps the category when no reading is kept', () => {
  const html = panel.renderBreakdown(null, { asin: 'B000000001', score: 80, verdict: 'Label index', category: 'toothpaste' });
  assert.ok(html.includes('Toothpaste'));
  assert.ok(html.includes(`--fg:${theme.neutral().fg}`));
  assert.doesNotMatch(html, /undefined/);
  const food = panel.renderBreakdown(null, { asin: 'B000000001', score: 80, verdict: 'Good', category: 'food' });
  assert.ok(food.includes(`--fg:${theme.band(80).fg}`));
});

test('Supplement Facts are collapsed with the details, not printed above the score', () => {
  const facts = 'Supplement Facts Serving Size: 1 Capsule Vitamin C 90 mg';
  const result = engine.score({ name: 'Vitamin C capsules', ingredients_text: 'Vitamin C, cellulose', supplement_facts: facts }, {});
  const html = panel.render(result, { title: 'Vitamin C capsules' });
  assert.ok(html.indexOf(facts) > html.indexOf('id="air-panel-details"'), 'inside the collapsible body');
});

test('a cart of one personal-care category is averaged and named for it, not banded', () => {
  const care = cart.summarize([{ score: 80, category: 'shampoo' }, { score: 70, category: 'shampoo' }]);
  assert.equal(care.average, 75);
  assert.equal(care.category, 'shampoo');
  assert.equal(care.verdict, '', 'a band word describes a food score');
  const food = cart.summarize([{ score: 80 }, { score: 90, category: 'food' }]);
  assert.equal(food.average, 85);
  assert.equal(food.category, undefined);
  assert.notEqual(food.verdict, '');
  const mixed = cart.summarize([{ score: 80, category: 'shampoo' }, { score: 90 }, { score: 60, category: 'toothpaste' }]);
  assert.equal(mixed.average, null);
  assert.deepEqual(mixed.groups.map(g => [g.category, g.average]), [['shampoo', 80], ['food', 90], ['toothpaste', 60]]);
});
