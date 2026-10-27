'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine/score.js');
const prefs = require('../src/engine/db/prefs.js');
const cache = require('../src/engine/db/score-cache.js');
const products = require('../src/engine/db/product-cache.js');
const fixtures = [
 ['Toothpaste', 'Water, sodium fluoride, sorbitol, silica', 'toothpaste'],
 ['Mouthwash', 'Water, cetylpyridinium chloride, glycerin', 'mouthwash'],
 ['Deodorant', 'Water, aluminum chlorohydrate, glycerin', 'deodorant'],
 ['Shampoo', 'Water, sodium laureth sulfate, cocamidopropyl betaine', 'shampoo'],
 ['Hair conditioner', 'Water, cetearyl alcohol, behentrimonium chloride', 'conditioner'],
 ['Body wash', 'Water, decyl glucoside, glycerin', 'body-wash'],
 ['Body moisturizer', 'Water, glycerin, petrolatum', 'moisturizer'],
 ['Multivitamin', 'Vitamin C, cellulose, gelatin', 'supplement'],
];
const input = ([name, ingredients_text]) => ({ name, ingredients_text,
 ...(name === 'Multivitamin' ? { supplement_facts: 'Supplement Facts Serving Size 1 tablet Vitamin C 90 mg 100% DV' } : {}) });
test('all supported categories rate under all three styles with transparent arithmetic', () => {
 for (const fixture of fixtures) for (const ratingStyle of ['evidence','minimal','preferences']) {
  const result = engine.score(input(fixture), { ratingStyle, avoidList: ['glycerin'] });
  assert.equal(result.category, fixture[2]); assert.equal(engine.isReadable(result), true, `${fixture[0]} ${ratingStyle}`);
  assert.equal(result.ratingStyle, ratingStyle); assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.base + [...result.good,...result.bad].reduce((n,r) => n+r.c,0), result.score);
  assert.equal(result.nova, undefined);
 }
});
test('evidence and missing-data states do not reward unknown labels or guess supplement doses', () => {
 for (const p of [{ name:'Shampoo',ingredients_text:'unknown gibberish'}, { name:'Shampoo',ingredients_text:'' },
 { name:'Multivitamin',ingredients_text:'cellulose, vitamin C' }, {name:'Sunscreen moisturizer',ingredients_text:'water, glycerin'},
 { name:'Shampoo and conditioner',ingredients_text:'water, glycerin' }]) assert.equal(engine.isReadable(engine.score(p)),false);
 assert.equal(engine.isReadable(engine.score(input(fixtures[0]),{ratingStyle:'preferences'})),false);
 // A higher dose earns nothing, but a serving above the adult upper limit (2,000 mg for vitamin C) is charged.
 const p=input(fixtures[7]); const low=engine.score(p); const more=engine.score({...p,supplement_facts:p.supplement_facts.replace('90 mg','900 mg')});
 const over=engine.score({...p,supplement_facts:p.supplement_facts.replace('90 mg','9000 mg')});
 assert.equal(low.score,more.score,'a higher dose within the limit is not rewarded');
 assert.ok(over.score<low.score,'a serving above the upper limit is charged');
 assert.equal(engine.isReadable(engine.score({...p,supplement_facts:p.supplement_facts+' Proprietary Blend'})),false);
});
test('minimal index changes with disclosed list length, preferences with explicit avoid terms only', () => {
 const p=input(fixtures[6]); const minimal=engine.score(p,{ratingStyle:'minimal'});
 assert.ok(engine.score({...p,ingredients_text:p.ingredients_text+', dimethicone, sodium chloride'},{ratingStyle:'minimal'}).score < minimal.score);
 const before=engine.score(p,{ratingStyle:'preferences',avoidList:['fragrance']});
 const after=engine.score(p,{ratingStyle:'preferences',avoidList:['glycerin'],allergens:['milk'],diets:['vegan']});
 assert.ok(after.score < before.score);
 assert.equal(engine.score(p,{ratingStyle:'evidence',avoidList:['glycerin']}).score,engine.score(p,{ratingStyle:'evidence'}).score);
});
test('rating changes retire cached scores and survive settings and product-reading round trips', () => {
 // A new style retires personal-care indices; the food scores it does not touch are kept (tests/score-cache.test.js).
 assert.notEqual(cache.fingerprint({},'page','shampoo'),cache.fingerprint({ratingStyle:'minimal'},'page','shampoo'));
 assert.notEqual(cache.fingerprint({ratingStyle:'preferences',avoidList:['glycerin']},'page','shampoo'),cache.fingerprint({ratingStyle:'preferences',avoidList:['fragrance']},'page','shampoo'));
 const settings=prefs.parseImport(JSON.stringify(prefs.exportPayload({ratingStyle:'minimal',personalCareEnabled:false})));
 assert.equal(settings.prefs.ratingStyle,'minimal'); assert.equal(settings.prefs.personalCareEnabled,false);
 const p=input(fixtures[7]); const row=products.fromScan({store:'amazon.com',asin:'B000000001',input:p});
 assert.equal(products.toInput(row).supplement_facts,p.supplement_facts);
 assert.equal(engine.score(products.toInput(row)).score,engine.score(p).score);
 assert.equal(engine.isReadable(engine.score(p,{personalCareEnabled:false})),false);
});
test('food stays invariant under the new styles and opt-out', () => {
 const p={name:'Whole milk',ingredients_text:'Milk, vitamin D3'}; const original=engine.score(p);
 for(const ratingStyle of ['evidence','minimal','preferences']) assert.deepEqual(engine.score(p,{ratingStyle,personalCareEnabled:false}),original);
});
test('mixed categories cannot contribute to one cart average or score ranking', () => {
 const cart=require('../src/stores/cart.js'); const sorted=require('../src/engine/db/sorted-results.js');
 const mixed=[{category:'food',score:96},{category:'toothpaste',score:80}];
 const summary=cart.summarize(mixed); assert.equal(summary.average,null); assert.equal(summary.groups.length,2);
 assert.deepEqual(sorted.sortByScore(mixed),mixed);
 assert.ok(sorted.factorValues(mixed).every(row=>row.health===null));
 assert.equal(cart.summarize([{score:80},{score:90}]).average,85);
 assert.deepEqual(sorted.sortByScore([{category:'shampoo',score:60},{category:'shampoo',score:80}]).map(p=>p.score),[80,60]);
});
