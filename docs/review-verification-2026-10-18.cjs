// Regression verification for the October review. Uses fixtures; no network or application writes.
// Run from any directory: node docs/review-verification-2026-10-18.cjs
'use strict';
/* global __dirname, console, URL, window, document, AIR, process */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const engine = require('../src/engine/score.js');
const extract = require('../src/content/extract.js');
const PC = require('../src/engine/db/product-cache.js');
const SC = require('../src/engine/db/score-cache.js');
const prefs = require('../src/engine/db/prefs.js');
const history = require('../src/engine/db/purchase-history.js');
const analytics = require('../src/engine/db/purchase-analytics.js');
const speed = require('../src/engine/db/speed.js');
const { createDocument } = require('../tests/pages/load.js');
const results = [];
const score = text => engine.score({ ingredients_text: text });
function record(issue, evidence) { results.push({ issue, evidence }); }
function fromLabel(text) {
  const doc = createDocument(`<h1 id="productTitle">Test food</h1><div id="nic-ingredients-content">Ingredients: ${text}</div>`);
  const data = extract.extract(doc, { asin: 'B000000001', foodOnly: false });
  assert.equal(data.ok, true);
  return score(data.text);
}

const longEntry = fromLabel('oats, sunflower oil ' + 'processed '.repeat(8));
assert.equal(longEntry.parsed, 2);
assert.equal(longEntry.readable, false);
assert.ok(longEntry.parseWarnings.length);
record('long entries retain incomplete-assessment status after extraction', { score: longEntry.score, parsed: longEntry.parsed, coverage: longEntry.coverage });

const unknown = score('qzx, zqx'), organic = fromLabel('organic qzx, organic zqx');
assert.equal(unknown.coverage, 0);
assert.equal(organic.coverage, 0);
assert.equal(organic.readable, false);
record('organic claims do not establish ingredient recognition', { withoutClaim: unknown.coverage, withClaim: organic.coverage, score: organic.score });

const four = fromLabel('beef, salt, pepper, garlic'), five = fromLabel('beef, salt, pepper, garlic, onion');
assert.equal(four.score, 82);
assert.equal(five.score, four.score);
record('seasoning additions retain sourcing assessment', { fourIngredients: four.score, fiveIngredients: five.score });

const numericCodes = score('chocolate (sugar, cocoa butter, emulsifiers (322, 471))');
const explicitCodes = score('chocolate (sugar, cocoa butter, emulsifiers (E322, E471))');
assert.equal(numericCodes.score, explicitCodes.score);
assert.equal(numericCodes.nova, explicitCodes.nova);
assert.equal(explicitCodes.score, 31);
record('equivalent nested additive notation agrees in score and processing class', {
  numeric: { score: numericCodes.score, nova: numericCodes.nova },
  explicit: { score: explicitCodes.score, nova: explicitCodes.nova },
  numericParse: engine.parseEntries('chocolate (sugar, cocoa butter, emulsifiers (322, 471))'),
});

const oilLabels = ['cold-pressed sunflower oil', 'huile de tournesol pressée à froid', 'kaltgepresstes Sonnenblumenöl', 'olej słonecznikowy tłoczony na zimno'];
const oilScores = oilLabels.map(text => ({ text, score: score(text).score }));
assert.deepEqual(oilScores.map(r => r.score), [78, 78, 78, 78]);
record('cold-press qualifiers soften oil caps consistently across languages', oilScores);

const nutrition = text => extract.nutritionFacts(createDocument(`<div id="nic-nutrition-facts-content">${text}</div>`));
const atBasis = serving => engine.score({ ingredients_text: 'oats', nutrition: nutrition(`Nutrition Facts ${serving} Sodium 400mg Protein 4g`) }, { weights: { sodium: 1 } });
assert.equal(atBasis('').nutritionAssessment[0].status, 'unavailable');
assert.equal(atBasis('').score, score('oats').score);
assert.equal(atBasis('Serving size 30g').score, 80);
record('unknown serving basis is explicitly unassessed', { unknownServingSize: atBasis('').score, thirtyGrams: atBasis('Serving size 30g').score });

const incompletePanel = nutrition('Nutrition Facts Serving size 30g Calories 120 Includes 0g Added Sugars Protein 4g');
assert.equal(incompletePanel.sugar, undefined);
record('absent sugar amounts do not borrow a later nutrient', incompletePanel);
const precisePanel = nutrition('Nutrition Facts Sodium 0mg Protein 0.125g Total Sugars 0g');
assert.equal(precisePanel.protein, 0.125);
record('small three-place nutrient decimals retain their magnitude', precisePanel);

// Real page/product modules and engine; DOM, storage and the certification reply are fixtures.
const writes = [], rendered = [];
const host = { dataset: {}, isConnected: true };
const ctx = vm.createContext({
  console, URL,
  location: { hostname: 'www.amazon.com', pathname: '/dp/B000000001', search: '' },
  document: {
    getElementById: () => host,
    querySelector: () => ({ parentNode: { insertBefore() {} } }),
    querySelectorAll: () => [],
  },
  chrome: {
    runtime: {
      getManifest: () => ({ version: 'review' }),
      sendMessage: (msg, cb) => { if (msg.type === 'provenanceLookup') cb({ certifications: 'American Grassfed Association certified', source: 'review-fixture' }); },
    },
    storage: { local: { set: value => { writes.push(value); return Promise.resolve(); }, remove: () => Promise.resolve() } },
  },
  AIR: {
    db: { scoreCache: SC, productCache: PC, prefs, speed }, engine,
    extract: { extract: () => ({ ok: true, title: 'Ground beef', asin: 'B000000001', text: 'beef', via: 'nic-ingredients-content', confidence: 1 }) },
    panel: { render: result => { rendered.push(result); return ''; }, mount() {} },
  },
});
for (const file of ['page.js', 'product.js']) vm.runInContext(fs.readFileSync(path.join(root, 'src/content', file), 'utf8'), ctx);
ctx.AIR.page.state.foodOnly = false;
ctx.AIR.product.scoreCurrentPage();
const stored = Object.assign({}, ...writes);
const row = stored['p:amazon.com:B000000001'];
const hit = stored['s:amazon.com:B000000001'];
assert.deepEqual(rendered.map(r => r.score), [86, 99]);
assert.equal(hit.score, 99);
assert.equal(engine.score(PC.toInput(row)).score, hit.score);
record('product enrichment saves matching score and input evidence', { rendered: rendered.map(r => r.score), scoreCache: hit.score, inputCacheReplay: engine.score(PC.toInput(row)).score });

// Evaluate the unchanged savedRating function and its dependencies before Orders boot code.
const orderSource = fs.readFileSync(path.join(root, 'src/content/orders.js'), 'utf8');
const prefixEnd = orderSource.indexOf('  let lastURL =');
assert.ok(prefixEnd > 0);
ctx.AIR.db.purchaseHistory = history;
vm.runInContext(orderSource.slice(0, prefixEnd) + '\nroot.reviewSavedRating = savedRating;\n})(globalThis);', ctx);
const orderRating = ctx.reviewSavedRating({ asin: 'B000000001' }, {}, 'review', stored);
assert.equal(orderRating.score, hit.score);
record('Orders imports the same score from complete saved evidence', { productScore: hit.score, importedScore: orderRating.score });

const fullInput = { ingredients_text: 'beef', provenanceRecord: { certifications: 'American Grassfed Association certified' } };
const savedInput = history.cleanInput(fullInput);
const projected = analytics.project({ input: savedInput, score: engine.score(fullInput).score }, 'current', engine.score);
assert.equal(projected.current, projected.recorded);
assert.equal(projected.partial, true);
record('history retains provenance and identifies legacy partial snapshots', { recorded: projected.recorded, replayed: projected.current, partial: projected.partial });

console.log(JSON.stringify({ purpose: 'Regression verification: parser, nutrition basis, multilingual qualifiers and scoring evidence round trips.', probes: results.length, results }, null, 2));

// Optional real Chromium DOM + closed-shadow panel reproduction. Browser APIs and certification
// replies remain fixtures. Every navigation is intercepted; no retailer or backend is contacted.
// PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node docs/review-verification-2026-10-18.cjs --browser
async function browserProbes() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<main id="centerCol"><h1 id="productTitle">Test food</h1><div id="nic-ingredients-content">oats</div></main>' })
      : route.abort());
    await page.goto('https://www.amazon.com/dp/B000000001');
    await page.evaluate(() => {
      window.reviewStorage = {};
      window.reviewEnrich = false;
      window.chrome = {
        runtime: {
          getManifest: () => ({ version: 'review' }),
          sendMessage(msg, cb) {
            cb?.(msg.type === 'provenanceLookup' && window.reviewEnrich
              ? { certifications: 'American Grassfed Association certified', source: 'review-fixture' } : null);
          },
        },
        storage: {
          local: {
            set(values) { Object.assign(window.reviewStorage, values); return Promise.resolve(); },
            remove(key) { delete window.reviewStorage[key]; return Promise.resolve(); },
          },
        },
      };
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const scripts = manifest.content_scripts.find(group => group.js.includes('src/content/product.js')).js;
    for (const file of scripts.slice(0, scripts.indexOf('src/content/product.js') + 1)) {
      await page.addScriptTag({ path: path.join(root, file) });
    }
    const observed = await page.evaluate(() => {
      AIR.page.state.foodOnly = false;
      const rows = [];
      const cases = [
        ['long ingredient', 'oats, sunflower oil ' + 'processed '.repeat(8)],
        ['organic unknowns', 'organic qzx, organic zqx'],
        ['numeric nested codes', 'chocolate (sugar, cocoa butter, emulsifiers (322, 471))'],
        ['explicit nested codes', 'chocolate (sugar, cocoa butter, emulsifiers (E322, E471))'],
        ['certification enrichment', 'beef'],
      ];
      for (const [name, ingredients] of cases) {
        document.getElementById('air-score-panel')?.remove();
        AIR.page.state.lastKey = null;
        window.reviewStorage = {};
        document.getElementById('nic-ingredients-content').textContent = 'Ingredients: ' + ingredients;
        window.reviewEnrich = name === 'certification enrichment';
        AIR.product.scoreCurrentPage();
        const panel = document.getElementById('air-score-panel');
        const input = window.reviewStorage['p:amazon.com:B000000001'];
        rows.push({ name, panelState: panel?.dataset.airState,
          displayedScore: Number(AIR.panel.shadowOf(panel)?.querySelector('.score')?.textContent),
          inputReplay: input ? AIR.engine.score(AIR.db.productCache.toInput(input)).score : null });
      }
      return rows;
    });
    assert.deepEqual(observed.map(row => row.displayedScore), [NaN, NaN, 31, 31, 99]);
    assert.equal(observed.at(-1).inputReplay, 99);
    assert.deepEqual(observed.slice(0, 2).map(row => row.panelState), ['fail', 'fail']);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: await browser.version(), interceptedFixtures: true, observed, pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
}
if (process.argv.includes('--browser')) browserProbes().catch(error => { console.error(error); process.exitCode = 1; });
