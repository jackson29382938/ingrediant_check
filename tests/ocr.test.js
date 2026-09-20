// Reading an ingredient list out of a label photo. Run: node tests/ocr.test.js
//
// The OCR text in these fixtures is REAL: it is what tesseract.js 5.1.1 actually returned for
// Amazon image 514iQ-HJVEL, the label shot on Lifeway Low Fat Kefir (B00LOAW7U6), at 70%
// confidence in 3.0 seconds. Keeping the genuine output — mangled nutrition table, "IUICE" for
// "JUICE" and all — is the point: it is what this code has to cope with.
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const ocr = require(src('engine/db/ocr-text.js'));
const extract = require(src('content/extract.js'));
const engine = require(src('engine/score.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

const REAL_OCR = 'B&H 8 NUTRITIONAL INFORMATION SERVING SIZE CUP (240m) Calories 140 Total Fat '
  + 'rnin 29 Sat Fat vss 159 Trans Fat crn. 09 Cholesterol ......... 10mg SOAIUM rnc 125MQ Total '
  + 'Carb 189 [LT 1 SUGAIS. vrs: 189 Added SUGArS co... 8G PIOLEIN wvovrcrisinns 10g Vitamin D '
  + '..... 38mcg 20% Calcium 390mg 30% Percent Daily Values are based on a 2,000 calorie diet. '
  + 'INGREDIENTS "PASTEURIZED LOWFAT MILK, CANE SUGAR, NONFAT MILK, NATURAL STRAWBERRY FLAVOR, '
  + 'NATURAL FLAVORS, PECTIN, VEGETABLE IUICE (FOR COLOR), VITAMIN A PALMITATE, VITAMIN D3, '
  + 'CULTURES. ALLERGENS: CONTAINS: MILK';

console.log('Amazon image URLs');
check('thumbnail becomes a high-resolution original', () => {
  assert.strictEqual(
    ocr.hiResUrl('https://m.media-amazon.com/images/I/514iQ-HJVEL._SX38_SY50_CR,0,0,38,50_.jpg'),
    'https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg');
});
check('a video poster is never a label', () => {
  assert.strictEqual(ocr.hiResUrl(
    'https://m.media-amazon.com/images/I/61fVzK1T8OL.SX38_SY50_CR,0,0,38,50_BG85,85,85_BR-120_PKdp-play-icon-overlay__.jpg'),
    null);
});
check('a non-Amazon url yields nothing', () => {
  assert.strictEqual(ocr.hiResUrl('https://example.com/photo.jpg'), null);
  assert.strictEqual(ocr.hiResUrl(''), null);
  assert.strictEqual(ocr.hiResUrl(null), null);
});
check('only m.media-amazon.com /images/I/ URLs are fetchable', () => {
  const ok = 'https://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg';
  assert.strictEqual(ocr.isAllowedOcrUrl(ok), true);
  assert.strictEqual(ocr.isAllowedOcrUrl('http://m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg'), false);
  assert.strictEqual(ocr.isAllowedOcrUrl('https://www.amazon.com/dp/B00LOAW7U6'), false);
  assert.strictEqual(ocr.isAllowedOcrUrl('https://m.media-amazon.com.evil.test/images/I/514iQ-HJVEL._SL1600_.jpg'), false);
  assert.strictEqual(ocr.isAllowedOcrUrl('https://evil.test/images/I/514iQ-HJVEL._SL1600_.jpg'), false);
  assert.strictEqual(ocr.isAllowedOcrUrl('https://user:pass@m.media-amazon.com/images/I/514iQ-HJVEL._SL1600_.jpg'), false);
  assert.deepStrictEqual(ocr.allowedOcrUrls([ok, 'https://example.test/x.jpg', ok, 'not-a-url']), [ok]);
  assert.deepStrictEqual(ocr.allowedOcrUrls(['image']), []);
});
check('candidates are de-duplicated by image id', () => {
  // Amazon repeats one id at several sizes across the strip, the viewer and the zoom layer.
  const img = src => ({ getAttribute: a => (a === 'src' ? src : null) });
  const doc = { querySelectorAll: () => [
    img('https://m.media-amazon.com/images/I/AAAAAAAA._SX38_.jpg'),
    img('https://m.media-amazon.com/images/I/AAAAAAAA._SL1500_.jpg'),
    img('https://m.media-amazon.com/images/I/BBBBBBBB._SX38_.jpg'),
  ] };
  assert.deepStrictEqual(ocr.imageCandidates(doc), [
    'https://m.media-amazon.com/images/I/AAAAAAAA._SL1600_.jpg',
    'https://m.media-amazon.com/images/I/BBBBBBBB._SL1600_.jpg',
  ]);
});
check('a document with no images is handled', () => {
  assert.deepStrictEqual(ocr.imageCandidates({ querySelectorAll: () => [] }), []);
  assert.deepStrictEqual(ocr.imageCandidates({}), []);
});

console.log('\npulling the list out of real OCR output');
check('the ingredient block is recovered', () => {
  const got = ocr.ingredientsFromOcr(REAL_OCR);
  assert.ok(got, 'nothing extracted');
  assert.ok(/^PASTEURIZED LOWFAT MILK/.test(got), `starts wrong: ${got.slice(0, 40)}`);
  assert.ok(/CULTURES$/.test(got), `ends wrong: ${got.slice(-40)}`);
});
check('the allergen line is left out of the list', () => {
  const got = ocr.ingredientsFromOcr(REAL_OCR);
  assert.ok(!/ALLERGEN|CONTAINS:/i.test(got), `allergen text leaked in: ${got}`);
});
check('the nutrition table is left out of the list', () => {
  const got = ocr.ingredientsFromOcr(REAL_OCR);
  assert.ok(!/Calories|SOAIUM|Daily Values/i.test(got), `nutrition text leaked in: ${got}`);
});
check('text with no INGREDIENTS heading yields nothing', () => {
  assert.strictEqual(ocr.ingredientsFromOcr('NUTRITION FACTS Calories 140 Total Fat 2g'), null);
  assert.strictEqual(ocr.ingredientsFromOcr(''), null);
  assert.strictEqual(ocr.ingredientsFromOcr(null), null);
});
check('a heading with nothing usable after it yields nothing', () => {
  assert.strictEqual(ocr.ingredientsFromOcr('INGREDIENTS: MILK'), null);   // under the 8-char floor
});
check('a long additive list keeps its tail', () => {
  const items = Array.from({ length: 90 }, (_, i) => `ingredient number ${i} concentrate`);
  const text = 'INGREDIENTS: ' + items.join(', ') + '. ALLERGENS: CONTAINS: MILK';
  const got = ocr.ingredientsFromOcr(text);
  assert.ok(got && got.length > 2000, `truncated to ${got && got.length}`);
  assert.ok(/ingredient number 89/.test(got), 'tail of the list was dropped');
});
check('Spanish INGREDIENTES headings are recognised', () => {
  const got = ocr.ingredientsFromOcr('INGREDIENTES: agua, azucar, sal, aceite vegetal. ALLERGENS: CONTAINS: none');
  assert.ok(got && /agua/.test(got), `missing Spanish list: ${got}`);
});
check('German Zutaten and French Ingrédients headings are recognised', () => {
  const de = ocr.ingredientsFromOcr('Zutaten: Wasser, Zucker, Salz, Sonnenblumenöl. ALLERGENS: CONTAINS: none');
  assert.ok(de && /Wasser/.test(de), `missing German list: ${de}`);
  const fr = ocr.ingredientsFromOcr('Ingrédients: eau, sucre, sel, huile de tournesol. ALLERGENS: CONTAINS: none');
  assert.ok(fr && /eau/.test(fr), `missing French list: ${fr}`);
});

console.log('\nchoosing between images');
check('the image carrying a real list wins', () => {
  const best = ocr.bestBlock([
    { url: 'front.jpg', text: 'LIFEWAY KEFIR STRAWBERRY 32 FL OZ' },
    { url: 'label.jpg', text: REAL_OCR },
    { url: 'lifestyle.jpg', text: 'ENJOY CHILLED' },
  ], t => extract.looksLikeIngredients(t, 'Lifeway Low Fat Kefir Strawberry'));
  assert.ok(best, 'nothing chosen');
  assert.strictEqual(best.url, 'label.jpg');
});
check('nothing is chosen when no image has a list', () => {
  assert.strictEqual(ocr.bestBlock([{ url: 'a.jpg', text: 'ENJOY CHILLED' }], () => true), null);
  assert.strictEqual(ocr.bestBlock([], () => true), null);
  assert.strictEqual(ocr.bestBlock(null, () => true), null);
});
check('the acceptance test can veto a block', () => {
  // main.js passes looksLikeIngredients here, so a block that is really a product name is refused.
  assert.strictEqual(ocr.bestBlock([{ url: 'a.jpg', text: REAL_OCR }], () => false), null);
});

// Sanitized Tesseract-style transcripts. Not live captures: they reproduce the three shapes
// IMPROVEMENTS still called out as unpinned — an EU nutrition-first pack, a dark/glare photo,
// and a listing whose only readable list is on the back-of-pack image.
const EU_LABEL = 'NUTRITION INFORMATION Typical values per 100g Energy 2138 kJ / 511 kcal '
  + 'Fat 26g of which saturates 15g Carbohydrate 61g of which sugars 38g Fibre 3,5g Protein 6,2g '
  + 'Salt 0,48g Percent Daily Values are based on a 2,000 calorie diet. '
  + 'INGREDIENTES: harina de TRIGO, azucar, masa de cacao, manteca de cacao, aceites vegetales '
  + '(palma, karite), emulgente (lecitina de SOJA, E322), aroma, gasificantes (E500, E503), sal. '
  + 'ALLERGENS: CONTAINS: WHEAT, SOYA. MAY CONTAIN: MILK, NUTS. '
  + 'DISTRIBUTED BY Example Foods Ltd WWW.EXAMPLE.EU';

const DARK_PHOTO = 'NUTR|T|ON FACTS Servlng Size 2 Tbsp (30g) Calorles 190 Totai Fat 16q '
  + 'Sat Fat 1.5q Cholest 0mg Sodlum 140mg Totai Carb 8q Sugars 6q Prote1n 6q '
  + 'INGREDIENTS ROASTED PEANUTS, SUGAR, HYDROGENATED VEGETABLE O|L (COTTONSEED, RAPESEED AND '
  + 'SOYBEAN), SALT. '
  + 'NUTRITION FACTS Calories 190 Total Fat 16g. ALLERGENS: CONTAINS: PEANUTS, SOY. '
  + 'KEEP REFRIGERATED AFTER OPENING BEST BY 12/2027';

const BACK_PACK = 'HONEY ALMOND GRANOLA CLUSTERS NET WT 12 OZ (340g) '
  + 'INGREDIENTS: WHOLE GRAIN OATS, CANE SUGAR, ALMONDS, HONEY, EXPELLER PRESSED CANOLA OIL, '
  + 'BROWN RICE SYRUP, SEA SALT, NATURAL FLAVOR, MIXED TOCOPHEROLS (FOR FRESHNESS). '
  + 'CONTAINS: ALMONDS. DISTRIBUTED BY Example Cereal Co QUESTIONS? 1-800-555-0100';

const FRONT_PACK = 'HONEY ALMOND GRANOLA CLUSTERS NET WT 12 OZ (340g) '
  + 'NUTRITION FACTS Serving Size 2/3 cup (55g) Calories 250 Total Fat 10g Saturated Fat 1g '
  + 'Sodium 80mg Total Carbohydrate 36g Dietary Fiber 4g Total Sugars 12g Protein 5g';

function assertBlock(name, text, { start, end, acceptAs }) {
  check(`${name}: the ingredient block is recovered`, () => {
    const got = ocr.ingredientsFromOcr(text);
    assert.ok(got, `${name}: nothing extracted`);
    assert.ok(start.test(got), `${name}: starts wrong: ${got.slice(0, 50)}`);
    assert.ok(end.test(got), `${name}: ends wrong: ${got.slice(-50)}`);
    assert.ok(extract.looksLikeIngredients(got, acceptAs),
      `${name}: extracted block was not accepted as an ingredient list`);
  });
  check(`${name}: ALLERGEN / CONTAINS stay out of the list`, () => {
    const got = ocr.ingredientsFromOcr(text);
    assert.ok(got && !/ALLERGEN|CONTAINS\s*:|MAY\s+CONTAIN/i.test(got),
      `${name}: allergen text leaked in: ${got}`);
  });
  check(`${name}: nutrition is left out of the list`, () => {
    const got = ocr.ingredientsFromOcr(text);
    assert.ok(got && !/Calories|Calorles|Daily Values|kJ|Serving Size|Sodlum|Sodium/i.test(got),
      `${name}: nutrition text leaked in: ${got}`);
  });
}

console.log('\npinned OCR transcripts (EU, dark photo, ingredients-on-back)');
assertBlock('EU label', EU_LABEL, {
  start: /^harina de TRIGO/i, end: /sal$/i, acceptAs: 'Chocolate biscuits',
});
assertBlock('dark / hard photo', DARK_PHOTO, {
  start: /^ROASTED PEANUTS/i, end: /SALT$/i, acceptAs: 'Peanut butter',
});
check('dark / hard photo: tidyOcr turns vertical bars into I', () => {
  const got = ocr.ingredientsFromOcr(DARK_PHOTO);
  assert.ok(got && /VEGETABLE OIL/i.test(got), `bar-to-I missed: ${got}`);
  assert.ok(got && !/O\|L/.test(got), `raw bar leaked through: ${got}`);
});
assertBlock('ingredients on the back', BACK_PACK, {
  start: /^WHOLE GRAIN OATS/i, end: /FRESHNESS\)$/i, acceptAs: 'Honey almond granola',
});
check('ingredients-on-back: the back image wins over the nutrition-only front', () => {
  const best = ocr.bestBlock([
    { url: 'front.jpg', text: FRONT_PACK },
    { url: 'back.jpg', text: BACK_PACK },
    { url: 'lifestyle.jpg', text: 'HONEY ALMOND GRANOLA CLUSTERS ENJOY ANYTIME' },
  ], t => extract.looksLikeIngredients(t, 'Honey almond granola'));
  assert.ok(best, 'nothing chosen');
  assert.strictEqual(best.url, 'back.jpg');
  assert.ok(/^WHOLE GRAIN OATS/i.test(best.text), `wrong block: ${best.text.slice(0, 40)}`);
});
check('a nutrition-only front yields no list', () => {
  assert.strictEqual(ocr.ingredientsFromOcr(FRONT_PACK), null);
});

console.log('\nend to end: the OCR text scores like the real label');
check('the Lifeway label scores the same from OCR as from Open Food Facts', () => {
  const got = ocr.ingredientsFromOcr(REAL_OCR);
  assert.ok(extract.looksLikeIngredients(got, 'Lifeway Low Fat Kefir – Strawberry, 32 oz.'),
    'the extracted block was not accepted as an ingredient list');
  const fromOcr = engine.score({ name: 'Lifeway Low Fat Kefir Strawberry', ingredients_text: got }, {});
  const fromOff = engine.score({ name: 'Lifeway Low Fat Kefir Strawberry',
    ingredients_text: 'Pasteurized lowfat milk, nonfat milk, cane sugar, pectin, natural strawberry '
      + 'flavor, natural flavors, red beet juice (for color), vitamin a palmitate, vitamin d3, '
      + 'live and active cultures.' }, {});
  assert.ok(Math.abs(fromOcr.score - fromOff.score) <= 5,
    `OCR ${fromOcr.score} vs Open Food Facts ${fromOff.score} — two readings of one label disagree`);
  // The bug this whole path exists to fix: Amazon's own text scored 86.
  assert.ok(fromOcr.score < 40, `OCR route scored ${fromOcr.score}; the blurb scored 86`);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
