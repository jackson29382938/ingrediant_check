'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine/score.js');
const C = require('../src/engine/categories.js');
const L = require('../src/engine/db/labels.js');
const fixtures = require('./scoring-factor-fixtures.json');
const zero = Object.fromEntries(C.CATEGORIES.map(c => [c.id, 0]));
const sum = rows => rows.reduce((n, r) => n + (typeof r.c === 'number' ? r.c : 0), 0);
function balanced(r, label) {
  assert.ok(Number.isInteger(r.score) && r.score >= 3 && r.score <= 100, label);
  assert.equal(r.base + sum(r.good) + sum(r.bad), r.score, label);
}
for (const [kind, rules] of [['penalties', E.PENALTIES], ['caps', E.CAPS], ['bonuses', L.BONUSES]]) {
  test(`every ${kind} rule has an explicitly reviewed witness`, () => {
    assert.equal(fixtures[kind].length, rules.length, 'new or removed rules require a witness review');
    for (const [i, rule] of rules.entries()) {
      assert.equal(fixtures[kind][i].why, rule.why, `${kind} ${i}: changed rule requires review`);
      assert.ok(rule.m.test(fixtures[kind][i].input), `${kind} ${i}: witness does not match`);
      assert.ok(Object.hasOwn(C.DEFAULT_WEIGHTS, rule.cat), `${kind} ${i}: missing category`);
    }
  });
  for (const [i, rule] of rules.entries()) {
    test(`${kind} ${i}: ${rule.why}`, () => {
      const input = fixtures[kind][i].input;
      const base = rule.applies?.includes('seafood') ? 'salmon' : rule.applies?.includes('dairy') || !rule.applies ? 'milk' : 'beef';
      const product = kind === 'bonuses'
        ? {name:base, labels:input, certifications:input, ingredients_text:rule.requiresCookingFat || rule.requiresUnrefinedFat ? 'olive oil, water, salt, garlic, onion' : `${base}, water, salt, garlic, onion`}
        : {ingredients_text:input};
      const off = E.score(product, {weights:zero});
      const on = E.score(product, {weights:{...zero, [rule.cat]:1}});
      balanced(off, `${kind} ${i} off`); balanced(on, `${kind} ${i} on`);
      if (kind === 'penalties') {
        assert.ok(on.bad.some(r => r.why === rule.why && r.c < 0), `no deduction for ${input}`);
        assert.ok(on.score < off.score, `no score effect for ${input}`);
        assert.ok(!off.bad.some(r => r.why === rule.why));
      } else if (kind === 'caps') {
        assert.ok(on.cap, `no ceiling for ${input}`);
        assert.ok(on.score <= rule.cap, `${input}: ${on.score} exceeds ${rule.cap}`);
        const stronger = E.score(product, {weights:{...zero, [rule.cat]:2}});
        assert.ok(stronger.score <= on.score, `stronger avoidance raised ${input}`);
      } else if (rule.pts === 0) {
        assert.equal(on.score, off.score, `${input} should earn no automatic credit`);
      } else {
        assert.ok(on.good.some(r => r.c > 0 && (rule.cat === 'organic' ? r.organic === true : r.why.startsWith(rule.why))), `no bonus for ${input}`);
        assert.ok(on.score > off.score, `no score effect for ${input}`);
      }
    });
  }
}

test('every nutrition contributor has a measurable, correctly directed effect', () => {
  const product = {ingredients_text:'oats', nutrition:{servingGrams:100, sodium:1200, saturatedFat:15, sugar:40, addedSugar:25, carbs:70, fibre:10, protein:15}};
  const off = E.score(product, {weights:zero});
  for (const rule of E.NUTRITION) {
    const on = E.score(product, {weights:{...zero, [rule.cat]:1}});
    assert.ok([...on.good,...on.bad].some(r => r.cat === rule.cat));
    assert.ok(rule.sign < 0 ? on.score < off.score : on.score > off.score, rule.cat);
    balanced(on, rule.cat);
  }
});

test('every preset and every two-goal combination preserve bounds, arithmetic and caps', () => {
  const corpus = require('./corpus.json');
  const foods = [...corpus.products,...corpus.defects];
  const ids = Object.keys(C.PRESETS);
  const combinations = ids.map(id => [id]);
  for (let a=0; a<ids.length; a++) for (let b=a+1; b<ids.length; b++) combinations.push([ids[a],ids[b]]);
  for (const goals of combinations) {
    const weights = C.goalWeights(goals);
    for (const entry of foods) balanced(E.score(entry.product,{weights}), `${entry.id}: ${goals}`);
    for (const fixture of fixtures.caps) {
      const r = E.score({ingredients_text:fixture.input, certifications:'USDA Organic'}, {weights});
      const caps = E.CAPS.filter(c => c.m.test(fixture.input));
      const ceiling = Math.min(100,...caps.map(c => Math.max(3,Math.round(100 - (100-c.cap)*weights[c.cat]))));
      assert.ok(r.score <= ceiling, `${goals}: organic credit bypassed ${fixture.input} (${r.score}/${ceiling})`);
    }
  }
});

test('neutral defaults and stricter preferences remain distinct', () => {
  assert.equal(C.DEFAULT_WEIGHTS.fortification, 0);
  assert.equal(C.DEFAULT_WEIGHTS.reducedFatDairy, 0);
  assert.equal(C.DEFAULT_WEIGHTS.gluten, 0);
  assert.equal(C.DEFAULT_WEIGHTS.refinedOil, 0.5);
  assert.equal(C.DEFAULT_WEIGHTS.artificialSweetener, 0.5);
  assert.ok(E.score({ingredients_text:'sunflower oil'}).score > E.score({ingredients_text:'sunflower oil'}, {weights:C.presetWeightMap('wholeFood')}).score);
  assert.ok(!E.score({ingredients_text:'raw milk'}).good.some(r => /Raw \/ unpasteurised/.test(r.why)));
  assert.ok(!E.score({ingredients_text:'sea salt'}).good.some(r => /Unrefined salt/.test(r.why)));
  assert.ok(!E.score({ingredients_text:'whole wheat flour, water, yeast'}).bad.some(r => r.cat === 'grain' || r.cat === 'gluten'));
});

test('fortification and dried egg whites alone do not establish ultra-processing', () => {
  for (const text of ['milk, vitamin D3', 'oats, folic acid, niacin, reduced iron', 'egg white powder']) {
    assert.notEqual(E.score({ingredients_text:text}).nova, 4, text);
  }
});

test('nutrition inputs are immutable and presets cannot retain another score’s basis', () => {
  const nutrition = Object.freeze({servingGrams:40,sugar:12,protein:8});
  const product = Object.freeze({ingredients_text:'oats',nutrition});
  const a = E.score(product,{weights:{totalSugar:1,protein:1}});
  const b = E.score(product,{weights:{totalSugar:1,protein:1}});
  assert.deepEqual(a,b);
  assert.deepEqual(nutrition,{servingGrams:40,sugar:12,protein:8});
  const perServing = E.score({ingredients_text:'oats',nutrition:{sugar:12,_normalised:true}}, {weights:{totalSugar:1}});
  assert.equal(perServing.nutritionBasis,'per-serving');
  assert.ok(!perServing.bad.some(r => r.cat === 'totalSugar'));
  assert.equal(perServing.nutritionAssessment.find(r => r.category === 'totalSugar').status, 'unavailable');
});

test('invalid nutrition cannot create rewards or exaggerated deductions', () => {
  for (const nutrition of [{servingGrams:0,protein:10}, {servingGrams:Infinity,protein:10}, {servingGrams:1,protein:4}, {protein:9999}, {protein:-20,sugar:-10}]) {
    const r = E.score({ingredients_text:'oats',nutrition},{weights:{protein:2,totalSugar:2}});
    assert.ok(![...r.good,...r.bad].some(row => ['protein','totalSugar'].includes(row.cat)), JSON.stringify(nutrition));
  }
});

test('measured added sugar replaces ingredient deductions and is not counted twice', () => {
  const options = {weights:{addedSugar:1,totalSugar:1}};
  const quantified = E.score({ingredients_text:'oats, sugar',nutrition:{servingGrams:100,sugar:20,addedSugar:20}},options);
  assert.ok(quantified.bad.some(r => r.cat === 'addedSugar'));
  assert.ok(!quantified.bad.some(r => r.cat === 'sugar' || r.cat === 'totalSugar'));
  const missing = E.score({ingredients_text:'oats, sugar'},options);
  assert.ok(missing.bad.some(r => r.cat === 'sugar'));
  const milk = E.score({ingredients_text:'milk',nutrition:{servingGrams:100,sugar:20}}, {weights:{naturalSugar:1,totalSugar:1}});
  assert.ok(!milk.bad.some(r => r.cat === 'naturalSugar'));
});

test('allergen and avoid preferences control warnings without moving the score', () => {
  const product = {ingredients_text:'milk, peanuts'};
  const options = {allergens:['milk','peanut'],avoidList:['milk']};
  const on = E.score(product,options);
  const off = E.score(product,{...options,weights:{allergens:0,avoidList:0}});
  assert.ok(on.flags.length); assert.equal(off.flags.length,0); assert.equal(on.score,off.score);
});

test('duplicate goals and inherited names cannot add votes or weights', () => {
  assert.deepEqual(C.goalWeights(['weightLoss','weightLoss','generalWellbeing']), C.goalWeights(['weightLoss','generalWellbeing']));
  assert.deepEqual(C.resolveWeights({toString:2,constructor:1}),C.DEFAULT_WEIGHTS);
  assert.deepEqual(C.goalWeights(['constructor','toString']),C.DEFAULT_WEIGHTS);
});

test('every certification is reviewed for applicability, evidence strength and bounded credit', () => {
  const P = require('../src/engine/db/provenance.js');
  assert.equal(fixtures.certifications.length,P.CERTIFICATIONS.length);
  const food = {beef:'beef',poultry:'chicken',seafood:'salmon'};
  for (const [i, c] of P.CERTIFICATIONS.entries()) {
    const fixture = fixtures.certifications[i];
    assert.equal(fixture.id,c.id);
    assert.ok(P.detectCertifications(fixture.input,fixture.kind).some(r => r.id === c.id),c.id);
    const product = {ingredients_text:food[fixture.kind] || fixture.kind,certifications:fixture.input};
    const r = E.score(product);
    assert.ok(r.provenance,c.id);
    assert.ok(r.provenance.gained >= 0 && r.provenance.gained <= 22,c.id);
    if (c.tier === 1 || c.id === 'organicClaim') {
      assert.ok(!r.provenance.verified.some(v => v.id === c.id),`${c.id} was presented as audited`);
      assert.ok(r.provenance.claims.some(v => v.id === c.id),c.id);
    }
    balanced(r,c.id);
  }
  const plain = E.score({ingredients_text:'beef'});
  const domestic = E.score({ingredients_text:'beef',certifications:'Product of USA'});
  assert.equal(plain.score,domestic.score,'country of origin alone is not quality credit');
});

test('the same beverage is compared per 100ml across serving sizes and cached legacy data', () => {
  const at = serving => E.score({ingredients_text:'water, sugar',nutrition:{servingMl:serving,sugar:10*serving/100}}, {weights:{totalSugar:1}});
  assert.equal(at(240).score,at(500).score);
  assert.equal(at(240).nutritionBasis,'per 100ml');
  const cached = E.score({ingredients_text:'water, sugar',nutrition:{servingGrams:240,servingSize:'1 cup (240ml)',sugar:24}}, {weights:{totalSugar:1}});
  assert.equal(cached.score,at(240).score);
  assert.equal(cached.nutritionBasis,'per 100ml');
});

test('many recognized whole foods do not create a list-length defect', () => {
  const short = E.score({ingredients_text:'almonds, walnuts, cashews'});
  const long = E.score({ingredients_text:Array(8).fill('almonds, walnuts, cashews').join(', ')});
  assert.equal(long.nova,short.nova);
  assert.equal(long.score,short.score);
  assert.ok(!long.bad.some(r => /long ingredient list/.test(r.why)));
});

test('dairy preferences agree with preset purposes and do not reward raw-milk claims', () => {
  const plain = {ingredients_text:'whole milk'};
  const skim = {ingredients_text:'skim milk'};
  const raw = {ingredients_text:'raw milk'};
  const pasteurized = {ingredients_text:'pasteurized whole milk'};
  assert.equal(E.score(raw).score,E.score(pasteurized).score);
  assert.equal(E.score(skim).score,E.score(plain).score);
  for (const id of ['conventional','weightLoss','highProtein']) {
    const options = {weights:C.presetWeightMap(id)};
    assert.ok(E.score(skim,options).score >= E.score(plain,options).score,id);
  }
});

test('preset direction is reflected in actual foods with measured nutrition', () => {
  const protein = {ingredients_text:'milk, whey protein isolate',nutrition:{servingGrams:100,protein:25}};
  for (const id of ['highProtein','muscleGain','strength']) assert.ok(E.score(protein,{weights:C.presetWeightMap(id)}).score > E.score(protein).score,id);
  const carbs = {ingredients_text:'water, honey',nutrition:{servingMl:100,carbs:60,sugar:50,addedSugar:50}};
  assert.ok(E.score(carbs,{weights:C.presetWeightMap('endurance')}).score > E.score(carbs,{weights:C.presetWeightMap('lowCarb')}).score);
  const sweet = {ingredients_text:'oats, sugar',nutrition:{servingGrams:100,sugar:40,addedSugar:35}};
  assert.ok(E.score(sweet,{weights:C.presetWeightMap('strictSugar')}).score < E.score(sweet).score);
});

test('every hollow marketing signal remains non-scoring', () => {
  const P = require('../src/engine/db/provenance.js');
  const witnesses = ['USDA inspected','no hormones added','all natural','farm fresh','no MSG'];
  assert.equal(witnesses.length,P.HOLLOW_CLAIMS.length);
  for (const [i,h] of P.HOLLOW_CLAIMS.entries()) {
    assert.ok(h.m.test(witnesses[i]),h.id);
    const food = {ingredients_text:'chicken',name:witnesses[i]};
    const r = E.score(food);
    assert.ok(r.provenance.hollow.some(v => v.id === h.id),h.id);
    assert.equal(r.score,E.score({ingredients_text:'chicken'}).score,h.id);
  }
});
