// DE/FR/ES/IT/PT/NL synonyms must map onto existing English penalty keys, not a parallel system.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/engine/score.js');

const score = (text, options) => engine.score({ ingredients_text: text }, options);
const reasons = r => r.bad.map(h => h.why);

function assertSameWhy(en, other, label) {
  const a = score(en), b = score(other);
  assert.ok(a.coverage >= 0.6, `en coverage ${a.coverage}`);
  assert.ok(b.coverage >= 0.6, `${label} coverage ${b.coverage}`);
  const enWhy = reasons(a).sort();
  const otherWhy = reasons(b).sort();
  assert.deepEqual(otherWhy, enWhy, `${label}: ${JSON.stringify(otherWhy)} vs en ${JSON.stringify(enWhy)}`);
  assert.equal(b.score, a.score, `${label}: ${b.score} vs en ${a.score}`);
  assert.equal(b.nova, a.nova, `${label} nova`);
}

test('chocolate twins match English flavour, lecithin and sugar keys', () => {
  const en = 'Sugar, cocoa butter, whole milk powder, emulsifier (soy lecithin), flavor';
  assertSameWhy(en, 'Azúcar, manteca de cacao, leche entera en polvo, emulsionante (lecitina de soja), aroma', 'es');
  assertSameWhy(en, 'Sucre, beurre de cacao, lait entier en poudre, émulsifiant (lécithine de soja), arôme', 'fr');
  assertSameWhy(en, 'Zucker, Kakaobutter, Vollmilchpulver, Emulgator (Sojalecithin), Aroma', 'de');
  assertSameWhy(en, 'Zucchero, burro di cacao, latte intero in polvere, emulsionante (lecitina di soia), aromi', 'it');
  assertSameWhy(en, 'Açúcar, manteiga de cacau, leite em pó integral, emulsionante (lecitina de soja), aroma', 'pt');
  assertSameWhy(en, 'Suiker, cacaoboter, volle melkpoeder, emulgator (sojalecithine), aroma', 'nl');
});

test('high-frequency additive synonyms hit the same English reasons', () => {
  const pairs = [
    ['citric acid', 'ácido cítrico', 'acide citrique', 'Citronensäure', 'acido citrico', 'ácido cítrico', 'citroenzuur'],
    ['yeast extract', 'extracto de levadura', 'extrait de levure', 'Hefeextrakt', 'estratto di lievito', 'extrato de levedura', 'gistextract'],
    ['vanillin', 'vainillina', 'vanilline', 'Vanillin', 'vanillina', 'vanilina', 'vanilline'],
    ['lactic acid', 'ácido láctico', 'acide lactique', 'Milchsäure', 'acido lattico', 'ácido láctico', 'melkzuur'],
    ['ascorbic acid', 'ácido ascórbico', 'acide ascorbique', 'Ascorbinsäure', 'acido ascorbico', 'ácido ascórbico', 'ascorbinezuur'],
    ['polysorbate 80', 'polisorbato 80', 'polysorbate 80', 'Polysorbat 80', 'polisorbato 80', 'polissorbato 80', 'polysorbaat 80'],
    ['soy protein isolate', 'aislado de proteína de soja', 'isolat de protéine de soja', 'Sojaproteinisolat', 'isolato di proteine di soia', 'proteína isolada de soja', 'soja-eiwitisolaat'],
    ['glycerin', 'glicerina', 'glycérine', 'Glycerin', 'glicerolo', 'glicerina', 'glycerine'],
    ['silicon dioxide', 'dióxido de silicio', 'dioxyde de silicium', 'Siliziumdioxid', 'diossido di silicio', 'dióxido de silício', 'siliciumdioxide'],
    ['sorbic acid', 'ácido sórbico', 'acide sorbique', 'Sorbinsäure', 'acido sorbico', 'ácido sórbico', 'sorbinezuur'],
    ['fructose', 'fructosa', 'fructose', 'Fruktose', 'fruttosio', 'frutose', 'fructose'],
    ['honey', 'miel', 'miel', 'Honig', 'miele', 'mel', 'honing'],
    ['invert sugar', 'azúcar invertido', 'sucre inverti', 'Invertzucker', 'zucchero invertito', 'açúcar invertido', 'invertsuiker'],
    ['corn starch', 'almidón de maíz', 'amidon de maïs', 'Maisstärke', 'amido di mais', 'amido de milho', 'maïszetmeel'],
    ['gellan gum', 'goma gellan', 'gomme gellane', 'Gellangummi', 'gomma gellan', 'goma gelana', 'gellangom'],
    ['gum arabic', 'goma arábiga', 'gomme arabique', 'Gummi arabicum', 'gomma arabica', 'goma arábica', 'arabische gom'],
  ];
  for (const [en, es, fr, de, it, pt, nl] of pairs) {
    for (const [lang, text] of [['es', es], ['fr', fr], ['de', de], ['it', it], ['pt', pt], ['nl', nl]]) {
      if (text.toLowerCase() === en.toLowerCase()) continue;
      assertSameWhy(en, text, `${en} ${lang}`);
    }
  }
});

test('gluten-grain synonyms keep the same default penalty as English', () => {
  assertSameWhy('wheat', 'trigo', 'wheat es');
  assertSameWhy('wheat', 'blé', 'wheat fr');
  assertSameWhy('wheat', 'weizen', 'wheat de');
  assertSameWhy('wheat', 'tarwe', 'wheat nl');
  assertSameWhy('barley', 'cebada', 'barley es');
  assertSameWhy('barley', 'orge', 'barley fr');
  assertSameWhy('barley', 'gerste', 'barley de');
  assertSameWhy('barley', 'cevada', 'barley pt');
  assertSameWhy('barley', 'gerst', 'barley nl');
  assertSameWhy('rye', 'centeno', 'rye es');
  assertSameWhy('rye', 'seigle', 'rye fr');
  assertSameWhy('rye', 'roggen', 'rye de');
  assertSameWhy('rye', 'centeio', 'rye pt');
  assertSameWhy('rye', 'rogge', 'rye nl');
  const flour = score('wheat flour');
  for (const text of ['harina de trigo', 'farine de blé', 'Weizenmehl', 'farina di frumento',
    'harina integral de trigo', 'farine complète de blé', 'Vollkornweizenmehl',
    'farinha de trigo', 'tarwemeel', 'volkorentarwemeel']) {
    const r = score(text);
    assert.ok(reasons(r).some(w => /Wheat flour|Wheat/i.test(w)), `${text} missed grain: ${reasons(r)}`);
    assert.ok(Math.abs(r.score - flour.score) <= 8, `${text}: ${r.score} vs wheat flour ${flour.score}`);
  }
});

test('seed-oil synonyms still cap like the English name', () => {
  const oils = [
    ['peanut oil', 'aceite de cacahuete', 'huile d\'arachide', 'Erdnussöl', 'olio di arachidi', 'óleo de amendoim', 'pindaolie'],
    ['grapeseed oil', 'aceite de semillas de uva', 'huile de pépins de raisin', 'Traubenkernöl', 'olio di vinaccioli', 'óleo de semente de uva', 'druivenpitolie'],
    ['cottonseed oil', 'aceite de algodón', 'huile de coton', 'Baumwollsaatöl', 'olio di semi di cotone', 'óleo de algodão', 'katoenzaadolie'],
    ['safflower oil', 'aceite de cártamo', 'huile de carthame', 'Distelöl', 'olio di cartamo', 'óleo de cártamo', 'saffloerolie'],
  ];
  for (const [en, es, fr, de, it, pt, nl] of oils) {
    const cap = score(en).score;
    for (const [lang, text] of [['es', es], ['fr', fr], ['de', de], ['it', it], ['pt', pt], ['nl', nl]]) {
      const r = score(text);
      assert.equal(r.score, cap, `${text} (${lang}): ${r.score} vs ${en} ${cap}`);
    }
  }
});

test('a Spanish bread list is not flattered relative to its English twin', () => {
  const en = score('Wheat flour, water, yeast, salt, sugar, soybean oil, calcium propionate');
  const es = score('Harina de trigo, agua, levadura, sal, azúcar, aceite de soja, propionato de calcio');
  assert.ok(es.coverage >= 0.6, `es coverage ${es.coverage}`);
  assert.ok(Math.abs(es.score - en.score) <= 6, `es ${es.score} vs en ${en.score}`);
  assert.ok(reasons(es).some(w => /Wheat flour/i.test(w)), reasons(es));
  assert.ok(reasons(es).some(w => /Soybean oil|refined seed oil/i.test(w)), reasons(es));
});

test('Portuguese and Dutch bread twins stay near the English score', () => {
  const en = score('Wheat flour, water, yeast, salt, sugar, soybean oil, calcium propionate');
  const pt = score('Farinha de trigo, água, fermento, sal, açúcar, óleo de soja, propionato de cálcio');
  const nl = score('Tarwemeel, water, gist, zout, suiker, sojaolie, calciumpropionaat');
  assert.ok(pt.coverage >= 0.5, `pt coverage ${pt.coverage}`);
  assert.ok(nl.coverage >= 0.5, `nl coverage ${nl.coverage}`);
  assert.ok(Math.abs(pt.score - en.score) <= 10, `pt ${pt.score} vs en ${en.score}`);
  assert.ok(Math.abs(nl.score - en.score) <= 10, `nl ${nl.score} vs en ${en.score}`);
});

// Swedish and Polish (amazon.se, amazon.pl). Synthetic translations of English lists; each must give
// the English reasons, score and NOVA class, word for word.
const SV_PL = {
  chocolate: ['Sugar, cocoa butter, whole milk powder, emulsifier (soy lecithin), flavor',
    'Socker, kakaosmör, helmjölkspulver, emulgeringsmedel (sojalecitin), arom',
    'Cukier, masło kakaowe, mleko pełne w proszku, emulgator (lecytyna sojowa), aromat'],
  chips: ['Potatoes, sunflower oil, salt, flavour enhancer (E621), dextrose',
    'Potatis, solrosolja, salt, smakförstärkare (E621), dextros',
    'Ziemniaki, olej słonecznikowy, sól, wzmacniacz smaku (E621), dekstroza'],
  bread: ['Wheat flour, water, yeast, salt, sugar, soybean oil, calcium propionate',
    'Vetemjöl, vatten, jäst, salt, socker, sojaolja, kalciumpropionat',
    'Mąka pszenna, woda, drożdże, sól, cukier, olej sojowy, propionian wapnia'],
  candy: ['Sugar, glucose syrup, water, modified starch (E1422), acid (E330), colour (E129), flavouring',
    'Socker, glukossirap, vatten, modifierad stärkelse (E1422), surhetsreglerande medel (E330), färgämne (E129), arom',
    'Cukier, syrop glukozowy, woda, skrobia modyfikowana (E1422), regulator kwasowości (E330), barwnik (E129), aromat'],
  muesli: ['Rolled oats, raisins, hazelnuts, sunflower seeds, apple',
    'Havregryn, russin, hasselnötter, solrosfrön, äpple',
    'Płatki owsiane, rodzynki, orzechy laskowe, nasiona słonecznika, jabłko'],
  biscuit: ['Wheat flour, sugar, sunflower oil, glucose syrup, raising agent (sodium bicarbonate), salt, flavouring',
    'Vetemjöl, socker, solrosolja, glukossirap, bakpulver (natriumbikarbonat), salt, arom',
    'Mąka pszenna, cukier, olej słonecznikowy, syrop glukozowy, substancja spulchniająca (wodorowęglan sodu), sól, aromat'],
  spread: ['Sugar, palm oil, hazelnuts, skimmed milk powder, cocoa, emulsifier (lecithin), vanillin',
    'Socker, palmolja, hasselnötter, skummjölkspulver, kakao, emulgeringsmedel (lecitin), vanillin',
    'Cukier, olej palmowy, orzechy laskowe, mleko odtłuszczone w proszku, kakao, emulgator (lecytyna), wanilina'],
  soda: ['Carbonated water, sugar, colour (caramel E150d), acid (phosphoric acid), natural flavourings, caffeine',
    'Kolsyrat vatten, socker, färgämne (sockerkulör E150d), syra (fosforsyra), naturliga aromer, koffein',
    'Woda gazowana, cukier, barwnik (karmel E150d), kwas (kwas fosforowy), naturalne aromaty, kofeina'],
  sauce: ['Tomatoes, water, rapeseed oil, sugar, modified corn starch, salt, garlic, onion, basil, citric acid, xanthan gum',
    'Tomater, vatten, rapsolja, socker, modifierad majsstärkelse, salt, vitlök, lök, basilika, citronsyra, xantangummi',
    'Pomidory, woda, olej rzepakowy, cukier, skrobia kukurydziana modyfikowana, sól, czosnek, cebula, bazylia, kwas cytrynowy, guma ksantanowa'],
  yogurt: ['Milk, cream, sugar, strawberries, modified starch, stabiliser (pectin), natural flavouring, cultures',
    'Mjölk, grädde, socker, jordgubbar, modifierad stärkelse, stabiliseringsmedel (pektin), naturlig arom, kulturer',
    'Mleko, śmietanka, cukier, truskawki, skrobia modyfikowana, stabilizator (pektyna), naturalny aromat, kultury bakterii'],
};

test('Swedish and Polish twins match English reasons, score and NOVA', () => {
  for (const [name, [en, sv, pl]] of Object.entries(SV_PL)) {
    assertSameWhy(en, sv, `${name} sv`);
    assertSameWhy(en, pl, `${name} pl`);
  }
});

test('Swedish and Polish oils, sugars and preservatives hit the English rules', () => {
  const pairs = [
    ['rapeseed oil', 'rapsolja', 'olej rzepakowy'], ['corn oil', 'majsolja', 'olej kukurydziany'],
    ['cottonseed oil', 'bomullsfröolja', 'olej bawełniany'], ['vegetable oil', 'vegetabilisk olja', 'olej roślinny'],
    ['partially hydrogenated soybean oil', 'delvis härdad sojaolja', 'częściowo uwodorniony olej sojowy'],
    ['fructose', 'fruktos', 'fruktoza'], ['invert sugar', 'invertsocker', 'cukier inwertowany'],
    ['brown sugar', 'farinsocker', 'cukier brązowy'], ['glucose-fructose syrup', 'glukos-fruktossirap', 'syrop glukozowo-fruktozowy'],
    ['potassium sorbate', 'kaliumsorbat', 'sorbinian potasu'], ['sodium benzoate', 'natriumbensoat', 'benzoesan sodu'],
    ['sorbic acid', 'sorbinsyra', 'kwas sorbowy'], ['maltodextrin', 'maltodextrin', 'maltodekstryna'],
    ['yeast extract', 'jästextrakt', 'ekstrakt drożdżowy'], ['monosodium glutamate', 'mononatriumglutamat', 'glutaminian sodu'],
  ];
  for (const [en, sv, pl] of pairs) {
    const want = reasons(score(`water, ${en}`)).sort();
    assert.ok(want.length, en);
    for (const [lang, text] of [['sv', sv], ['pl', pl]]) {
      assert.deepEqual(reasons(score(`water, ${text}`)).sort(), want, `${text} (${lang}) vs ${en}`);
    }
  }
});

test('flavourings are charged once, in every spelling', () => {
  // UK "flavourings" and "natural flavourings" matched no rule; Italian "aroma naturale" neither; and a
  // qualifier in front ("natürliches Aroma") was charged twice, as natural and as unspecified.
  const flavour = text => reasons(score(`oats, ${text}`)).filter(w => /flavou?r/i.test(w));
  for (const text of ['flavourings', 'flavouring', 'flavor', 'Aroma', 'arom', 'aromat']) {
    assert.deepEqual(flavour(text), ['Unspecified flavouring'], text);
  }
  for (const text of ['natural flavour', 'natural flavourings', 'natural flavoring', 'natürliches Aroma', 'natuurlijk aroma',
    'aroma naturale', 'naturliga aromer', 'naturalny aromat', 'aromaty naturalne']) {
    assert.equal(flavour(text).length, 1, `${text}: ${flavour(text)}`);
    assert.match(flavour(text)[0], /^"Natural flavors"/, text);
  }
  assert.deepEqual(flavour('artificial flavourings'), ['Artificial flavour']);
  assert.deepEqual(flavour('smoke flavouring'), ['Liquid smoke flavouring'], 'charged once, as smoke');
});
