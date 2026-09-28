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

// Turkish (amazon.com.tr). Words end and begin in ı, ş, ğ, ç and ü, which `\b` cannot see, and "İ"
// lower-cases to "i" plus a combining dot; both are covered here.
const TR = {
  chocolate: [SV_PL.chocolate[0], 'Şeker, kakao yağı, tam yağlı süt tozu, emülgatör (soya lesitini), aroma'],
  chips: [SV_PL.chips[0], 'Patates, ayçiçek yağı, tuz, lezzet arttırıcı (E621), dekstroz'],
  bread: [SV_PL.bread[0], 'Buğday unu, su, maya, tuz, şeker, soya yağı, kalsiyum propiyonat'],
  candy: [SV_PL.candy[0], 'Şeker, glikoz şurubu, su, modifiye nişasta (E1422), asitlik düzenleyici (E330), renklendirici (E129), aroma'],
  muesli: [SV_PL.muesli[0], 'Yulaf ezmesi, kuru üzüm, fındık, ayçiçeği çekirdeği, elma'],
  biscuit: [SV_PL.biscuit[0], 'Buğday unu, şeker, ayçiçek yağı, glikoz şurubu, kabartıcı (sodyum bikarbonat), tuz, aroma verici'],
  spread: [SV_PL.spread[0], 'Şeker, palm yağı, fındık, yağsız süt tozu, kakao, emülgatör (lesitin), vanilin'],
  soda: [SV_PL.soda[0], 'Karbonatlı su, şeker, renklendirici (karamel E150d), asit (fosforik asit), doğal aroma vericiler, kafein'],
  sauce: [SV_PL.sauce[0], 'Domates, su, kanola yağı, şeker, modifiye mısır nişastası, tuz, sarımsak, soğan, fesleğen, sitrik asit, ksantan gam'],
  yogurt: [SV_PL.yogurt[0], 'Süt, krema, şeker, çilek, modifiye nişasta, stabilizör (pektin), doğal aroma, yoğurt kültürü'],
};

test('Turkish twins match English reasons, score and NOVA', () => {
  for (const [name, [en, tr]] of Object.entries(TR)) assertSameWhy(en, tr, `${name} tr`);
});

test('Turkish oils, sugars, preservatives and function words hit the English rules', () => {
  const pairs = [
    ['rapeseed oil', 'kolza yağı'], ['corn oil', 'mısır yağı'], ['cottonseed oil', 'pamuk yağı'], ['vegetable oil', 'bitkisel yağ'],
    ['partially hydrogenated soybean oil', 'kısmen hidrojenize soya yağı'], ['hydrogenated vegetable oil', 'hidrojenize bitkisel yağ'],
    ['margarine', 'margarin'], ['fructose', 'fruktoz'], ['invert sugar', 'İnvert şeker'], ['brown sugar', 'esmer şeker'],
    ['glucose-fructose syrup', 'glikoz-fruktoz şurubu'], ['corn syrup', 'mısır şurubu'], ['potassium sorbate', 'potasyum sorbat'],
    ['sodium benzoate', 'sodyum benzoat'], ['sorbic acid', 'sorbik asit'], ['maltodextrin', 'maltodekstrin'],
    ['yeast extract', 'maya özü'], ['monosodium glutamate', 'monosodyum glutamat'], ['preservative', 'koruyucu'],
    ['colour', 'renklendirici'], ['emulsifier', 'emülgatör'], ['thickener', 'kıvam arttırıcı'], ['thickener', 'kıvam artırıcı'],
    ['artificial flavour', 'yapay aroma'], ['barley', 'arpa'], ['rye', 'çavdar'], ['corn starch', 'mısır nişastası'],
  ];
  for (const [en, tr] of pairs) {
    assert.deepEqual(reasons(score(`water, ${tr}`)).sort(), reasons(score(`water, ${en}`)).sort(), `${tr} vs ${en}`);
  }
  // NBŞ (nişasta bazlı şeker) is the Turkish label name for glucose-fructose and high-fructose syrups.
  assert.equal(score('water, nişasta bazlı şeker').score, score('water, high fructose corn syrup').score);
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

test('UK wordings are charged like their US twins', () => {
  // amazon.co.uk labels say maize, skimmed, treacle, golden syrup and fortified; each read as nothing,
  // so a UK list scored better than the same US list (modified maize starch 90, modified corn starch 39).
  const pairs = [
    ['modified corn starch', 'modified maize starch'], ['corn starch', 'maize starch'], ['corn flour', 'maize flour'],
    ['molasses', 'treacle'], ['molasses', 'black treacle'], ['skim milk powder', 'skimmed milk powder'],
    ['nonfat milk', 'semi-skimmed milk'], ['caramel', 'caramelised sugar'], ['invert sugar syrup', 'golden syrup'],
    ['invert sugar syrup', 'partially inverted sugar syrup'], ['enriched wheat flour', 'fortified wheat flour'],
  ];
  for (const [us, uk] of pairs) {
    const a = score(`oats, ${us}`), b = score(`oats, ${uk}`);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${uk} vs ${us}`);
    assert.equal(b.score, a.score, `${uk} vs ${us}`);
  }
});

test('Open Food Facts allergen markup does not hide rules or allergens', () => {
  // "_" is a word character, so "_wheat_ flour" escaped the flour charge and "_soja_" the soy flag.
  const plain = score('wheat flour, palm oil'), marked = score('_wheat_ flour, palm oil');
  assert.deepEqual(reasons(marked), reasons(plain));
  assert.equal(marked.score, plain.score);
  const soy = engine.score({ ingredients_text: 'sucre, lécithines de _soja_' }, { allergens: ['soy'] });
  assert.ok(JSON.stringify(soy).includes('"soy"'), 'the soy flag is raised');
});

test('an ingredient declared with its share is charged like the bare ingredient', () => {
  // "sugar 20%" escaped every rule anchored at the end of the entry, and "azúcar 8,5%" was split at
  // its decimal comma into "azúcar 8" and "5%".
  for (const [bare, declared] of [['sugar', 'sugar 20%'], ['Zucker', 'Zucker 45 %'], ['azúcar', 'azúcar 8,5%'],
    ['azúcar de caña', 'azúcar de caña 8,5%'], ['glucose syrup', 'glucose syrup 5%'], ['dextrose', 'dextrose 2.5%']]) {
    assert.deepEqual(reasons(score(`oats, ${declared}`)), reasons(score(`oats, ${bare}`)), declared);
  }
});

test('a "may contain" statement warns but is not scored, in every store language', () => {
  const oats = score('oats');
  for (const text of ['may contain traces of wheat', 'May contain milk', 'traces of nuts', 'peut contenir des traces de blé',
    'kann Spuren von Weizen enthalten', 'kann Schalenfrüchte enthalten', 'puede contener trazas de trigo',
    'può contenere tracce di frumento', 'pode conter vestígios de trigo', 'kan sporen van tarwe bevatten',
    'kan innehålla spår av vete', 'może zawierać pszenicę', 'buğday içerebilir']) {
    const r = engine.score({ ingredients_text: `oats, ${text}` }, { allergens: ['wheat', 'milk', 'treeNut'] });
    assert.equal(r.score, oats.score, text);
    assert.deepEqual(reasons(r), [], text);
    assert.ok(JSON.stringify(r).includes('"kind":"allergen"'), `${text}: the warning stays`);
  }
});

test('"function: additive" reads like "function (additive)"', () => {
  // "emulsifier: lecithins" left the lecithin unread, because the rule is anchored to the whole entry.
  for (const [paren, colon] of [['emulsifier (lecithins)', 'emulsifier: lecithins'], ['sweeteners (sucralose)', 'sweeteners: sucralose'],
    ['Säureregulator (Natriumcitrate)', 'Säureregulator: Natriumcitrate'], ['emulsionantes (lecitinas de soja)', 'emulsionantes: lecitinas de soja']]) {
    assert.deepEqual(reasons(score(`water, ${colon}`)).sort(), reasons(score(`water, ${paren}`)).sort(), colon);
    assert.equal(score(`water, ${colon}`).score, score(`water, ${paren}`).score, colon);
  }
  assert.deepEqual(engine.parse('Céréale 50 %: blé, sucre'), ['céréale 50 %: blé', 'sucre'], 'only function words are rewritten');
});

test('plural oils, flavour plurals, fortification and accented spellings read like English', () => {
  // Each pair was found unread on real Open Food Facts labels.
  const pairs = [
    ['vegetable oil', 'vegetable oils'], ['vegetable oil', 'huiles végétales'], ['vegetable oil', 'óleos vegetais'],
    ['vegetable oil', 'aceites vegetales'], ['vegetable oil', 'pflanzliche Öle'], ['vegetable oil', 'oli vegetali'],
    ['natural flavors', 'natürliche Aromen'], ['natural flavors', 'aromas naturais'],
    ['folic acid', 'ácido fólico'], ['folic acid', 'acide folique'], ['folic acid', 'Folsäure'],
    ['niacin', 'niacina'], ['riboflavin', 'riboflavina'], ['cyanocobalamin', 'cianocobalamina'],
    ['acesulfame k', 'acésulfame-K'], ['gellan gum', 'gomma di gellano'], ['cane sugar', 'zucchero grezzo di canna'],
    ['high oleic sunflower oil', 'huile de tournesol oléique'], ['high oleic sunflower oil', 'óleo de girassol alto oleico'],
    ['colour', 'colouring'], ['stabiliser', 'stabilizzante'], ['stabiliser', 'estabilizadores'],
    ['acidity regulator', 'acidifier'], ['acidity regulator', 'correctores de acidez'], ['acidity regulator', 'reguladores de acidez'],
  ];
  for (const [en, other] of pairs) {
    const a = score(`water, ${en}`), b = score(`water, ${other}`);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

// Found unread on real Open Food Facts labels (about 650 labels in ten languages, 2026-09-26), each
// against its English twin. Includes the organic and footnote markers ("sucre*", "cane sugar #") and
// the Turkish "%13" share, which hid an ingredient from rules anchored to the end of the entry.
const REAL_LABEL_PAIRS = [
  ['glucose-fructose syrup', 'glucose-fructosestroop'], ['rapeseed oil', 'koolzaadolie'], ['xanthan gum', 'xanthaangom'],
  ['locust bean gum', 'johannesbroodpitmeel'], ['brown sugar', 'bruine suiker'], ['acidity regulator', 'zuurteregelaar'],
  ['acidity regulator', 'zuurteregelaars'], ['barley malt extract', 'gerstemoutextract'], ['wheat starch', 'tarwezetmeel'],
  ['rice flour', 'rijstbloem'], ['malic acid', 'appelzuur'], ['disodium diphosphate', 'difosfaten'], ['tricalcium phosphate', 'tricalciumfosfaat'],
  ['citric acid', 'Zitronensäure'], ['barley malt extract', 'Gerstenmalzextrakt'], ['wheat bran', 'Weizenkleie'], ['rapeseed', 'Raps'],
  ['tricalcium phosphate', 'Tricalciumphosphat'], ['disodium diphosphate', 'Dinatriumdiphosphat'], ['malic acid', 'Äpfelsäure'],
  ['phosphoric acid', 'ácido fosfórico'], ['tricalcium phosphate', 'fosfato tricálcico'], ['disodium diphosphate', 'difosfato disódico'],
  ['inulin', 'inulina'], ['malic acid', 'ácido málico'],
  ['phosphoric acid', 'acide phosphorique'], ['tricalcium phosphate', 'phosphate tricalcique'], ['malic acid', 'acide malique'],
  ['phosphoric acid', 'acido fosforico'], ['monosodium glutamate', 'glutammato monosodico'], ['disodium guanylate', 'guanilato disodico'],
  ['disodium inosinate', 'inosinato disodico'], ['malic acid', 'acido malico'], ['tricalcium phosphate', 'fosfato tricalcico'],
  ['isomalt', 'isomalte'], ['skim milk powder', 'leite magro em pó'],
  ['sunflower oil', 'solrosfröolja'], ['carrageenan', 'karragenan'], ['lactic acid', 'mjölksyra'], ['tricalcium phosphate', 'trikalciumfosfat'],
  ['sucralose', 'substancja słodząca: sukraloza'], ['cyclamate', 'cyklaminiany'], ['acidity regulator', 'środek zakwaszający'],
  ['brown sugar', 'brązowy cukier trzcinowy'], ['ascorbic acid', 'kwas askorbinowy'], ['locust bean gum', 'mączka chleba świętojańskiego'],
  ['acesulfame k', 'asesülfam k'], ['mono- and diglycerides of fatty acids', 'yağ asitlerinin mono ve digliseritleri'],
  ['gellan gum', 'jellan gam'], ['guar gum', 'guar gam'], ['ascorbic acid', 'askorbik asit'], ['lactic acid', 'laktik asit'],
  ['glycerol esters of wood rosin', 'ağaç reçinesinin gliserol esterleri'], ['tricalcium phosphate', 'trikalsiyum fosfat'],
  ['disodium diphosphate', 'disodyum difosfat'], ['inulin', 'inülin'], ['rapeseed', 'kanola'], ['caramel', 'karamel'], ['gum arabic', 'akasya gamı'],
  ['sugar', 'sugar*'], ['cane sugar', 'cane sugar #'], ['sugar', 'sucre*'], ['cane sugar', 'cukier trzcinowy*'], ['hazelnuts 13%', 'hazelnuts %13'],
];

test('words from real labels in every store language score like their English twins', () => {
  for (const [en, other] of REAL_LABEL_PAIRS) {
    const a = score(`water, ${en}`), b = score(`water, ${other}`);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('bracketed sources, square brackets and marked-up compounds from real labels read like English', () => {
  // Found by comparing products whose Open Food Facts record carries the list in English and another
  // language: the other language scored well above English on each of these.
  const pairs = [
    ['sunflower oil', 'olio di semi di girasole'], ['soybean oil', 'olio di semi di soia'], ['vegetable oil', 'olio di semi vari'],
    ['wheat flour', 'farine de froment'], ['wheat flour', 'tarwebloem'], ['wheat flour', '_tarwe_bloem'],
    ['emulsifier (soy lecithin)', 'émulsifiants : lécithines [SOJA]'], ['emulsifier (sunflower lecithin)', 'emulgator: lecithinen (zonnebloem)'],
    ['emulsifier (sunflower lecithin)', 'emulgator: lecytyny (ze słonecznika)'], ['soy lecithin', 'lecithin (soy)'],
    ['potassium sorbate', 'sorbato potásico'], ['rapeseed oil', 'aceite de nabina'], ['sunflower oil', 'aceite refinado de girasol'],
    ['durum semolina', 'Hartweizengrieß'],
  ];
  for (const [en, other] of pairs) {
    const a = score(`water, ${en}`), b = score(`water, ${other}`);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('cane sugar, leading shares, headings left in the list and fat levels, from real labels', () => {
  const pairs = [
    ['cane sugar', 'sucre de canne'], ['cane sugar', 'sucre de canne roux'], ['cane sugar', 'azúcar moreno de caña'],
    ['cane sugar', 'zucchero di canna'], ['cane sugar', 'ruwe rietsuiker'], ['cane sugar', 'Rohrzucker'], ['cane sugar', 'açúcar de cana'],
    ['sugar', '19,5% sucre'], ['sugar', 'Zutaten: Zucker'], ['wheat starch', 'amidon de blé'], ['calcium carbonate', 'carbonate de calcium'],
    ['molasses', 'mélasse'], ['carrageenan', 'carraghénanes'], ['glucose-fructose syrup', 'Glukose-Fructose-Sirup'],
    ['invert sugar syrup', 'Invertzuckersirup'], ['potassium phosphates', 'Kaliumphosphate'], ['potassium phosphates', 'fosfati di potassio'],
    ['caramel', 'caramello'], ['skim milk', '1% milk'], ['skim milk', '2% milk'],
  ];
  for (const [en, other] of pairs) {
    const a = score(`oats, ${en}`), b = score(`oats, ${other}`);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('single foods, fibre isolates and processing markers read the same in every language (NOVA parity)', () => {
  // From comparing NOVA classes on bilingual Open Food Facts records: "amandes" and "flocons d'avoine"
  // were NOVA 2 at 90 where "almonds" and "oats" are NOVA 1 at 96; chicory and corn fibre isolates
  // were not the NOVA 4 marker they are in English; Swedish "arom" matched inside Spanish
  // "aromáticas"; and English "skimmed-milk powder" (with a hyphen) was not fat-reduced dairy.
  const pairs = [
    ['100 % oats', "100% Flocons d'avoine"], ['almonds', 'amandes'], ['water', 'eau'], ['rice', 'riz'], ['lentils', 'lentilles'],
    ['water, chicory root fiber', 'water, chicoreivezel'], ['water, soluble corn fiber', 'water, fibra solubile di mais'],
    ['water, chicory root fiber', 'water, Zichorienwurzelfasern'], ['water, skim milk powder', 'water, skimmed-milk powder'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
  }
  assert.deepEqual(reasons(score('sal, extractos de hierba aromáticas')), [], '"aromáticas" is not a flavouring');
});

test('meat, fish, eggs and milk in every label language are whole foods with a sourcing question', () => {
  // Provenance and the whole-food list read English only, so "bœuf haché" scored 90 as NOVA 2 with
  // no sourcing row where "ground beef" scores 86 as NOVA 1 and asks where it came from.
  const pairs = [
    ['ground beef', 'bœuf haché'], ['beef', 'Rindfleisch'], ['chicken breast', 'blanc de poulet'], ['chicken breast', 'Hähnchenbrust'],
    ['chicken breast', 'pechuga de pollo'], ['salmon', 'saumon'], ['salmon', 'Lachs'], ['salmon', 'salmone'], ['salmon', 'łosoś'],
    ['eggs', 'œufs'], ['eggs', 'Eier'], ['eggs', 'huevos'], ['milk', 'lait'], ['milk', 'Milch'], ['whole milk', 'lait entier'],
    ['milk chocolate', 'chocolat au lait'], ['chicken broth', 'bouillon de poulet'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
  }
  for (const text of ['lemon rind', 'Rundkornreis']) assert.deepEqual(reasons(score(text)), [], text);
});

test('processing words in every label language are the NOVA 3 signals they are in English', () => {
  // PROCESSED_SIGNAL read English only, so "lait pasteurisé, ferments lactiques" and "Wasser,
  // Sauerteig" were NOVA 2 at 90 where "pasteurized milk, cultures" and "water, sourdough" are
  // NOVA 3, and an Italian cheese of milk, salt and rennet ("caglio") was NOVA 2.
  const pairs = [
    ['pasteurized milk, cultures', 'lait pasteurisé, ferments lactiques'], ['pasteurized milk, salt', 'latte pastorizzato, sale'],
    ['milk, yeast', 'Milch, Hefe'], ['milk, salt, rennet', 'latte, sale, caglio'], ['milk, salt, rennet', 'leite, sal, coalho'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.equal(a.nova, 3, en);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
  assert.equal(score('Wasser, Sauerteig').nova, 3);
  // "zakwaszający" is an acidulant, not sourdough ("zakwas").
  const { PROCESSED_SIGNAL } = require('../src/engine/db/labels.js');
  assert.ok(!PROCESSED_SIGNAL.test('środek zakwaszający'));
  assert.ok(PROCESSED_SIGNAL.test('zakwas żytni'));
});

test('sourcing claims in every label language earn the bonus their English twins earn', () => {
  // The bonus rules read English only: "sel marin" and "Meersalz" earned nothing where "sea salt"
  // earns 5, "maïs bio" nothing where "organic maize" earns 8, and an organic footnote was set aside
  // with the other label notes, so "*Organic ingredients" lost the bonus "*organic" kept.
  const good = r => r.good.map(g => g.why).filter(w => !w.startsWith('Natural sugar')).sort();
  const pairs = [
    ['chickpeas, water, sea salt', 'Kichererbsen, Wasser, Meersalz'], ['chickpeas, water, sea salt', 'garbanzos, agua, sal marina'],
    ['Organic maize (94%), sea salt', 'Maïs bio (95%), sel marin'], ['Organic maize (94%), sea salt', 'Kukurydza ekologiczna (95%), sól morska'],
    ['raw milk, salt, rennet', 'Lait cru, sel, présure'], ['raw milk, salt, rennet', 'Rohmilch, Salz, Lab'],
    ['rye flour, water, sourdough', 'farine de seigle, eau, levain'], ['wheat flour, sugar, butter', 'farine de blé, sucre, beurre'],
    ['wheat flour, sugar, butter', 'tarwebloem, suiker, roomboter'], ['non-GMO soybeans, water', 'fèves de soja sans OGM, eau'],
    ['Wheat flour*, sugar*, salt. *organic', "farine de blé*, sucre*, sel. *Ingrédients issus de l'agriculture biologique"],
    ['Wheat flour*, sugar*, salt. *organic', 'Wheat flour*, sugar*, salt. *Organic ingredients'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.ok(good(a).length > 0, en);
    assert.deepEqual(good(b), good(a), `${other} vs ${en}`);
  }
  // Nut butters, wheat germ and a whole-grain word are not the claims they resemble.
  for (const text of ['beurre de cacahuète', 'farine de blé, germes de blé', 'harina integral, agua', 'manteiga de amendoim']) {
    assert.deepEqual(good(score(text)).filter(w => !/whole food/.test(w)), [], text);
  }
});

test('sourdough and sprouting in every label language halve the grain charge as in English', () => {
  const a = score('rye flour, water, sourdough'), b = score('farine de seigle, eau, levain');
  assert.equal(b.score, a.score);
  assert.deepEqual(reasons(b), reasons(a));
});

test('local flour and starch names are charged like their English twins', () => {
  // German, Dutch and Swedish write these as one word, which the \b-anchored words missed:
  // "Roggenmehl, Wasser" scored 80 with no rye row where "rye flour, water" scores 69.
  const pairs = [
    ['rye flour, water', 'Roggenmehl, Wasser'], ['rye flour, water', 'roggebloem, water'], ['rye flour, water', 'fullkornsrågmjöl, vatten'],
    ['spelt flour, water', 'Dinkelmehl, Wasser'], ["spelt flour, water", "farine d'épeautre, eau"], ['water, potato starch', 'Wasser, Kartoffelstärke'],
    ['water, potato starch', 'eau, fécule de pomme de terre'], ['water, tapioca starch', 'woda, skrobia z manioku'], ['water, soy flour', 'Wasser, Sojamehl'],
    ["water, oat flour", "eau, farine d'avoine"], ['water, chickpea flour', 'agua, harina de garbanzo'], ['water, lentil flour', 'acqua, farina di lenticchie'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b), reasons(a), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('the grains in brackets after "may contain" warn but are not charged', () => {
  // "May contain cereals containing gluten (spelt, barley, oats)" split its bracket into entries,
  // which were charged as ingredients: a Polish chocolate scored 36 for the wheat, rye and barley
  // in its trace statement. And a statement of 80 characters or more fell to the length filter,
  // so its allergen warning went too.
  const base = score('water, almonds');
  for (const text of [
    'water, almonds. May contain traces of soy and cereals containing gluten (spelt, barley, oats) and other nuts.',
    "eau, amandes. Traces éventuelles de soja et de céréales contenant du gluten (épeautre, orge, avoine) et d'autres fruits à coque.",
    'Wasser, Mandeln. Kann Spuren von Soja und glutenhaltigem Getreide (Dinkel, Gerste, Hafer) enthalten.',
    'woda, migdały. Może zawierać gluten (pszenica, żyto, jęczmień, owies), soję.',
    // The statement runs to the end of its sentence: split at its commas, "soy" and "wheat" were
    // ingredients of their own and wheat was charged.
    'water, almonds. May contain milk, soy, wheat.', 'woda, migdały. Może zawierać mleko, soję, pszenicę.',
  ]) {
    const r = score(text, { allergens: ['soy', 'wheat'] });
    assert.deepEqual(reasons(r), [], text);
    assert.equal(r.score, base.score, text);
    for (const id of ['soy', 'wheat']) assert.ok(r.flags.some(f => f.id === id), `${id}: ${text}`);
  }
});

test('flavour compounds ("Vanillearoma", "vaniljarom", "vanilya aroması") are charged like English', () => {
  // German, Dutch and Swedish write the flavour into the word and Turkish puts it before "aroması":
  // "natürliches Vanillearoma" was free where "natural vanilla flavour" costs 15.
  const pairs = [
    ['sugar, natural vanilla flavour', 'suiker, natuurlijk vanillearoma'], ['sugar, natural vanilla flavour', 'Zucker, natürliches Vanillearoma'],
    ['sugar, natural vanilla flavour', 'socker, naturlig vaniljarom'], ['sugar, natural coconut flavouring', 'şeker, doğal hindistancevizi aroması'],
    ['sugar, natural flavourings', "suiker, natuurlijke aroma's"], ['sugar, vanilla flavouring', 'Zucker, Vanillearoma'],
    ['sugar, vanilla flavouring', 'socker, vaniljarom'], ['sugar, vanilla flavouring', 'şeker, vanilya aroması'],
    ['sugar, smoke flavouring', 'Zucker, Raucharoma'], ['sugar, artificial vanilla flavor', 'Zucker, künstliches Vanillearoma'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('whole milk ahead of skimmed milk waives the fat-reduced charge in every label language', () => {
  // The full-fat dairy test read English only, so "lait entier, lait écrémé" was charged as
  // fat-reduced dairy that "whole milk, skimmed milk" is not; "Vollmilch" and "helmjölk" were not
  // whole foods either; and the nouns "ferments" / "Kulturen" were NOVA 3 signals where English
  // "cultures" is not.
  const en = 'whole milk, skimmed milk, cultures';
  for (const other of [
    'lait entier, lait écrémé, ferments', 'Vollmilch, Magermilch, Kulturen', 'leche entera, leche desnatada, fermentos',
    'helmjölk, skummjölk, kultur', 'mleko pełne, mleko odtłuszczone, kultury', 'volle melk, magere melk, culturen',
  ]) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b), reasons(a), other);
    assert.equal(b.score, a.score, other);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
  }
  const a = score('sugar, whole milk powder, skimmed milk powder'), b = score('Zucker, Vollmilchpulver, Magermilchpulver');
  assert.equal(b.score, a.score);
  // Milk powder and whey are not full-fat dairy, in any language.
  assert.deepEqual(reasons(score('lait en poudre, lait écrémé')), reasons(score('milk powder, skimmed milk')));
  assert.deepEqual(reasons(score('Zucker, Molkenpulver, Magermilchpulver')), reasons(score('sugar, whey powder, skimmed milk powder')));
});

test('brackets inside brackets are read by depth', () => {
  // The flat bracket pattern closed at the first ")": in "chocolate (sugar, emulsifier: lecithins
  // (soy), vanillin)" the tail ", vanillin)" stayed in the parent entry, and "sugar (cane
  // (organic))" left "sugar )", which no rule reads.
  assert.deepEqual(engine.parse('milk chocolate (sugar, emulsifier: lecithins (soy), vanillin), salt'),
    ['milk chocolate', 'sugar', 'soy lecithin', 'vanillin', 'salt']);
  assert.deepEqual(engine.parse('sugar (cane (organic)), salt'), ['sugar', 'cane', 'organic', 'salt']);
  assert.equal(score('sugar (cane (organic)), salt').score, score('sugar, cane, organic, salt').score);
  // An unclosed bracket is read as closed at the end, so what follows it is still split.
  assert.deepEqual(engine.parse('water, stabiliser (pectin, sugar, salt'), ['water', 'stabiliser', 'pectin', 'sugar', 'salt']);
});

test('a function word in a sub-list is named by its own bracket, not by its siblings', () => {
  // The stand-down went by position, which a whole sub-list shares: "chocolate (sugar, cocoa
  // butter, emulsifier)" left the emulsifier uncharged because the sugar beside it was recognised.
  assert.ok(reasons(score('chocolate (sugar, cocoa butter, emulsifier), salt')).includes('Unnamed emulsifier'));
  // Still named: its own bracket, the colon form, and an entry whose bracket only says what it is for.
  for (const text of ['chocolate (sugar, emulsifier (soy lecithin)), salt', 'emulsifier: soy lecithin, water',
    'sodium benzoate (preservative), water', 'annatto (color), cheese', 'citric acid (acidity regulator, preservative), water']) {
    assert.ok(!reasons(score(text)).some(w => /^Unnamed/.test(w)), text);
  }
});

test('a claim in brackets still earns its bonus', () => {
  // Claim entries are dropped from scoring, and with them the evidence: "soybeans (non-GMO)" lost
  // the bonus that "non-GMO soybeans" earns.
  assert.equal(score('soybeans (non-GMO), water').score, score('non-GMO soybeans, water').score);
  assert.equal(score('oats (certified organic), salt').score, score('organic oats, salt').score);
});

test('caramel colour in every label language caps like "caramel colour"', () => {
  const en = score('sparkling water, caramel colour, citric acid');
  for (const other of ['Kolsyrat vatten, sockerkulör, citronsyra', 'Wasser, Farbstoff: Zuckerkulör, Citronensäure',
    'acqua, colorante: caramello semplice, acido citrico', 'su, amonyum sülfit karamel, sitrik asit',
    'woda, barwnik: karmel amoniakalno-siarczynowy, kwas cytrynowy', 'eau, colorant: caramel ordinaire, acide citrique']) {
    const b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(en).sort(), other);
    assert.equal(b.score, en.score, other);
  }
});

test('sulphites, PGPR and gum acacia are charged in English and every label language', () => {
  // "sodium metabisulfite" carries both prefixes and the rule allowed one, so the commonest sulphite
  // was free in English too; "potassium metabisulphite" (UK spelling) likewise; PGPR had no rule.
  assert.ok(reasons(score('water, sodium metabisulfite')).includes('Sulfites'));
  assert.ok(reasons(score('lemon juice, preservative (potassium metabisulphite)')).includes('Potassium metabisulfite'));
  const pairs = [
    ['water, sodium metabisulfite', 'Wasser, Natriummetabisulfit'], ['water, sodium metabisulfite', 'água, metabissulfito de sódio'],
    ['water, sodium metabisulfite', 'eau, métabisulfite de sodium'], ['water, sodium metabisulfite', 'woda, pirosiarczyn sodu'],
    ['water, sodium metabisulfite', 'su, sodyum metabisülfit'], ['water, potassium metabisulphite', 'acqua, metabisolfito di potassio'],
    ['water, sulphur dioxide', 'vin, anhydride sulfureux'], ['sugar, polyglycerol polyricinoleate', 'şeker, poligliserol polirisinolat'],
    ['sugar, polyglycerol polyricinoleate', 'Zucker, Polyglycerin-Polyricinoleat'], ['sugar, polyglycerol polyricinoleate', 'sugar, E476'],
    ['sugar, gum arabic', "sucre, gomme d'acacia"], ['water, acidity regulator', 'acqua, correttori di acidità'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.ok(a.bad.length > 0, en);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('sulphite caramels are caramel colour, not a sulphite preservative', () => {
  for (const text of ['water, sulphite ammonia caramel', 'water, caustic sulfite caramel', 'su, amonyum sülfit karamel',
    'woda, karmel amoniakalno-siarczynowy', "eau, caramel au sulfite d'ammonium"]) {
    assert.deepEqual(reasons(score(text)), ['Caramel colour — caps score at 30'], text);
  }
});

test('words from bilingual real labels score like their English twins (round 3)', () => {
  // Compounds and spellings the rules missed, and three patterns whose \b sat against an accented
  // letter so the accented spelling could never match ("amidon modifié", "äppelsyra", "óleo …").
  const pairs = [
    ['water, corn maltodextrin', 'water, maïsmaltodextrine'], ['water, guar gum', 'water, guargom'],
    ['peanuts, sugar, partially hydrogenated palm oil, salt', 'Erdnüsse, Zucker, teilweise gehärtetes Palmöl, Salz'],
    ['peanuts, sugar, partially hydrogenated palm oil, salt', "pinda's, suiker, gedeeltelijk gehydrogeneerde palmolie, zout"],
    ['peanuts, sugar, hydrogenated palm oil, salt', "pinda's, suiker, gehydrogeneerde palmolie, zout"],
    ['peanuts, sugar, hydrogenated palm oil, salt', 'Erdnüsse, Zucker, gehärtetes Palmfett, Salz'],
    ['peanuts, peanut oil, salt', "cacahuètes, huile d'arachides, sel"], ['peanuts, peanut oil, salt', 'orzeszki ziemne, olej z orzeszków ziemnych, sól'],
    ['tomato, modified starch', 'tomate, amidon modifié'], ['tomato, modified corn starch', 'tomate, amidon modifié maïs'],
    ['tomato, modified corn starch', 'tomate, amidon de maïs modifié'], ['maize, barley malt extract, salt', 'kukurydza, ekstrakt słodu jęczmiennego, sól'],
    ['wine (sulphur dioxide), salt', 'vin (dioxyde de soufre), sel'], ['water, malic acid', 'vatten, äppelsyra'],
    ['potatoes, high oleic sunflower oil', 'batatas, óleo de girassol alto oleico'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('salt, sugar, vinegar, cream, butter and honey are culinary ingredients in every label language', () => {
  // Only the English words were NOVA 2 culinary ingredients: "sucre, sel" scored 63 as NOVA 3 where
  // "sugar, salt" scores 73 as NOVA 2.
  const pairs = [
    ['sugar, salt', 'sucre, sel'], ['sugar, salt', 'Zucker, Salz'], ['sugar, salt', 'cukier, sól'], ['sugar, salt', 'şeker, tuz'],
    ['oats, salt', 'Hafer, Salz'], ['olive oil, vinegar, salt', "huile d'olive vierge extra, vinaigre, sel"],
    ['cream, salt', 'crème, sel'], ['butter, salt', 'beurre, sel'], ['honey', 'miel'], ['maple syrup', 'syrop klonowy'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('an organic word before or after the ingredient does not hide it', () => {
  // EU labels write the organic word after the ingredient ("sucre bio"), and every rule anchored at
  // the end of the entry missed it: organic sugar scored 88, uncharged, where "sugar" costs 14.
  const pairs = [
    ['organic sugar, salt', 'sucre bio, sel'], ['organic sugar, salt', 'Zucker bio, Salz'], ['organic cane sugar, salt', 'zucchero di canna biologico, sale'],
    ['organic maize, salt', 'Kukurydza ekologiczna, sól'], ['organic maize, salt', 'ekologiczna kukurydza, sól'], ['organic oats, salt', 'Bio-Hafer, Salz'],
    ['organic oats, salt', 'Biohafer, Salz'], ['organic sunflower oil, salt', 'aceite de girasol ecológico, sal'], ['organic wheat flour, water', 'farine de blé bio, eau'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
    assert.ok(b.good.some(g => g.why === 'Certified organic'), `${other}: the organic claim still counts`);
  }
  // Words that only start with "bio" are left alone.
  for (const text of ['biotine', 'bioflavonoide']) assert.deepEqual(engine.parse(text), [text]);
});

test('"non-hydrogenated" is not hydrogenated, in any language', () => {
  // The negation was ignored: "non-hydrogenated palm oil" scored 25 as hydrogenated fat where plain
  // palm oil scores 90, and "(non hydrogenated)" was an unreadable entry of its own.
  const plain = score('peanuts, palm oil, salt');
  for (const text of ['peanuts, non-hydrogenated palm oil, salt', 'peanuts, palm oil (non hydrogenated), salt', 'peanuts, unhydrogenated palm oil, salt']) {
    assert.equal(score(text).score, plain.score, text);
  }
  for (const text of ['cacahuètes, huile de palme non hydrogénée, sel', 'Erdnüsse, Palmöl (nicht gehärtet), Salz', 'cacahuetes, aceite de palma no hidrogenado, sal',
    'amendoins, óleo de palma não hidrogenado, sal', 'woda, olej palmowy nieuwodorniony', 'su, palm yağı (hidrojenize olmayan)']) {
    assert.ok(!reasons(score(text)).some(w => /ydrogenated/.test(w)), text);
  }
  // Still charged when it is.
  for (const text of ['cacahuètes, huile hydrogéné', 'cacahuètes, huiles hydrogénées', 'cacahuètes, huile de palme partiellement hydrogéné']) {
    assert.ok(reasons(score(text)).some(w => /ydrogenated/.test(w)), text);
  }
});

test('hydrolysed protein is charged whatever sits between the words', () => {
  const en = score('water, hydrolyzed soy protein');
  for (const other of ['eau, protéine de soja hydrolysée', 'eau, protéines végétales hydrolysées', 'agua, proteína de soja hidrolizada',
    'Wasser, hydrolysiertes Pflanzeneiweiß', 'acqua, proteine di soia idrolizzate', 'water, gehydrolyseerde plantaardige eiwitten',
    'vatten, hydrolyserat sojaprotein', 'woda, hydrolizowane białko sojowe', 'su, hidrolize soya proteini', 'água, proteína de soja hidrolisada']) {
    assert.deepEqual(reasons(score(other)), reasons(en), other);
  }
});

test('a denial in any label language is dropped like "no preservatives"', () => {
  const en = score('oats, salt, no preservatives');
  for (const other of ["flocons d'avoine, sel, sans conservateurs", 'Haferflocken, Salz, ohne Zuckerzusatz', 'Haferflocken, Salz, konservierungsstofffrei',
    'copos de avena, sal, sin conservantes', "fiocchi d'avena, sale, senza conservanti", 'havervlokken, zout, zonder conserveermiddelen',
    'havregryn, salt, utan konserveringsmedel', 'płatki owsiane, sól, bez konserwantów', 'yulaf ezmesi, tuz, koruyucu içermez',
    'flocos de aveia, sal, sem conservantes', "flocons d'avoine, sel, ne contient pas de conservateurs"]) {
    assert.equal(score(other).score, en.score, other);
  }
});

test('peanuts, the other nuts and seeds are whole foods in every label language', () => {
  const pairs = [
    ['peanuts, palm oil, salt', 'Erdnüsse, Palmöl, Salz'], ['peanuts, palm oil, salt', 'cacahuètes, huile de palme, sel'],
    ['roasted peanuts, salt', 'cacahuetes tostados, sal'], ['roasted peanuts, salt', 'geröstete Erdnüsse, Salz'],
    ['roasted salted pistachios, salt', 'pistaches grillées salées, sel'], ['pumpkin seeds, sunflower seeds, salt', 'Kürbiskerne, Sonnenblumenkerne, Salz'],
    ['peanuts', "pinda's"], ['pine nuts', 'pinoli'], ['brazil nuts', 'noix du Brésil'], ['pecans', 'Pecan nuts'], ['pistachios, salt', '98,5% pistachio nuts, salt'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
  // "possible traces of" is a may-contain statement, and an origin note is not an ingredient.
  assert.equal(score('100% roasted peanuts, possible traces of soya').score, score('roasted peanuts').score);
  assert.deepEqual(engine.parse('orange juice (origin: Spain)'), ['orange juice', 'origin: spain']);
  assert.equal(score('orange juice (origin: Spain)').score, score('orange juice').score);
});

test('an allergen bracket that repeats its parent is not a second ingredient', () => {
  // "Cacahuètes (arachides)", "Arachidi (arachidi)", "yogurt (milk)": counting the bracket made the
  // list one longer, and a three-ingredient peanut butter NOVA 3 where its English twin is NOVA 2.
  const pairs = [
    ['peanuts, sunflower oil, salt', 'Arachidi (arachidi), olio di semi di girasole, sale'], ['peanuts, sunflower oil, salt', 'Cacahuètes (arachides), huile de tournesol, sel'],
    ['fat free yogurt', 'Fat free yogurt (_Milk_).'], ['cheese, salt', 'cheese (milk), salt'],
  ];
  for (const [bare, declared] of pairs) {
    const a = score(bare), b = score(declared);
    assert.equal(b.score, a.score, declared);
    assert.equal(b.nova, a.nova, `${declared} NOVA`);
  }
  // The declared word still raises the flag and matches the avoid list.
  const r = score('Cacahuètes (arachides), sel', { allergens: ['peanut'], avoidList: ['arachide'] });
  assert.ok(r.flags.some(f => f.id === 'peanut'));
  assert.equal(r.flags.length, 2);
  // A bracket that says more than its parent is kept: "Kekse (Weizen)" declares the wheat.
  assert.ok(reasons(score('Kekse (Weizen), Salz')).includes('Wheat'));
});

test('a flavouring named in its bracket or after its colon is not unspecified', () => {
  // "flavouring: vanillin" was charged as an unspecified flavouring and as vanillin.
  const named = score('sugar, vanillin');
  for (const text of ['sugar, flavouring: vanillin', 'sugar, flavouring (vanillin)', 'Zucker, Aroma: Vanillin', 'sucre, arôme : vanilline']) {
    assert.deepEqual(reasons(score(text)), reasons(named), text);
    assert.equal(score(text).score, named.score, text);
  }
  // A bracket that names no flavouring leaves it unspecified.
  assert.ok(reasons(score('sugar, flavouring (milk)')).includes('Unspecified flavouring'));
});

test('fruit and dairy sugar reads every label language, with the weight on and off', () => {
  // The natural-sugar list and the whole-fruit list were English: with the naturally occurring sugar
  // weight on (the blood-sugar goals set it), "dates" was charged and "dattes" not; with it off,
  // "dattes, amandes" scored 80 as NOVA 3 where "dates, almonds" scores 94 as NOVA 1.
  const on = { weights: { naturalSugar: 1 } };
  const pairs = [
    ['dates, almonds', 'dattes, amandes'], ['milk, cultures', 'lait, ferments'], ['banana, oats', 'Banane, Haferflocken'],
    ['apple puree, water', 'purée de pommes, eau'], ['raisins, peanuts', "rozijnen, pinda's"], ['yogurt, strawberries', 'jogurt, truskawki'],
    ['figs', 'incir'], ['apples', 'Äpfel'],
  ];
  for (const [en, other] of pairs) {
    assert.equal(score(other, on).score, score(en, on).score, `${other} (weight on)`);
    assert.equal(score(other).score, score(en).score, other);
    assert.equal(score(other).nova, score(en).nova, `${other} NOVA`);
  }
});

test('vegetables and prepared nuts are whole foods in every label language', () => {
  const pairs = [
    ['potatoes, sunflower oil, salt', 'Kartoffeln, Sonnenblumenöl, Salz'], ['tomatoes, salt', 'pomodori, sale'], ['Tomato 99.5%, salt', 'Pomodoro 99,5%, sale'],
    ['onions', 'cebollas'], ['spinach', 'Spinat'], ['garlic, salt', 'ail, sel'], ['diced tomatoes', 'tomaat'],
    ['walnuts, hazelnuts, blanched almonds', 'noix, noisettes, amandes décortiquées'], ['walnuts, hazelnuts, blanched almonds', 'Walnusskerne, Haselnusskerne, blanchierte Mandeln'],
    ['walnuts, cashews, blanched almonds', 'orzechy włoskie, orzechy nerkowca, blanszowane migdały'], ['almonds', 'sliced almonds'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.equal(b.nova, a.nova, `${other} NOVA`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('concentrated and clarified butter earn the cooking-fat bonus in every label language', () => {
  const en = score('sugar, concentrated butter');
  for (const other of ['Zucker, Butterreinfett', 'suiker, boterconcentraat', 'socker, smörolja', 'cukier, koncentrat masła',
    'zucchero, burro anidro', 'azúcar, mantequilla concentrada', 'Zucker, Butterschmalz']) {
    assert.equal(score(other).score, en.score, other);
  }
  assert.notEqual(score('zucchero, burro di cacao').score, en.score, 'cocoa butter is not butter');
});

test('fat-reduced dairy in any word order, and whole-milk powders that waive it', () => {
  const RF = 'Fat-reduced dairy';
  for (const text of ['sucre, lait concentré écrémé', 'azúcar, leche en polvo desnatada', 'açúcar, leite em pó desnatado',
    'cukier, odtłuszczone mleko w proszku', 'suiker, magere_melk_poeder']) {
    assert.ok(reasons(score(text)).includes(RF), text);
  }
  const en = score('sugar, whole milk powder, skimmed milk powder');
  for (const other of ['suiker, volle_melk_poeder, magere_melk_poeder', 'cukier, mleko pełne w proszku, odtłuszczone mleko w proszku',
    'sucre, lait entier en poudre, lait écrémé en poudre']) {
    assert.deepEqual(reasons(score(other)), reasons(en), other);
    assert.equal(score(other).score, en.score, other);
  }
});

test('"soaked" earns the traditional-preparation bonus in every label language', () => {
  const en = score('water, soaked kidney beans, salt');
  for (const other of ['eau, haricots rouges secs trempés, sel', 'Wasser, eingeweichte Kidneybohnen, Salz',
    'agua, alubias rojas remojadas, sal', 'woda, namoczona fasola, sól']) {
    assert.equal(score(other).score, en.score, other);
  }
});

test('words from a second sample of real labels score like their English twins', () => {
  // Page 2 of the most-scanned Open Food Facts products in each label language (661 lists).
  const pairs = [
    ['water, maltitol', 'eau, maltitols'], ['water, sucralose', 'acqua, sucralosio'], ['water, guar gum', 'acqua, gomma di guar'],
    ['water, glucose syrup', 'água, xarope de glicose'], ['water, acesulfame k', 'água, acessulfame k'], ['water, invert sugar syrup', 'água, xarope de açúcar invertido'],
    ['water, glucose-fructose syrup', 'água, xarope de glicose-frutose'], ['water, caramelised sugar', 'água, açúcar caramelizado'],
    ['water, sunflower lecithin', 'água, lecithina de girassol'], ['water, sunflower lecithin', 'água, lecitina de girassol'], ['water, glycerol', 'água, glicerol'],
    ['water, mono- and diglycerides of fatty acids', 'woda, mono - i diglicerydy kwasów tłuszczowych'], ['water, sorbitol', 'woda, sorbitole'],
    ['water, whey protein concentrate', 'woda, koncentrat białek serwatkowych wpc'], ['water, caramelised sugar', 'woda, karmelizowany cukier w proszku'],
    ['water, wheat malt flour', 'woda, mąka ze słodu pszennego'], ['water, mono- and diglycerides of fatty acids', 'su, yağ asitlerinin mono - ve digliseritleri'],
    ['water, sodium phosphates', 'vatten, natriumfosfater'], ['water, potassium phosphates', 'water, kaliumfosfaten'], ['water, soybean oil', 'water, sojaboonolie'],
    ['water, glucose-fructose syrup', 'water, glucose - fructosestroop'], ['water, colour', 'water, kleurstof'], ['water, calcium sulphate', 'water, calciumsulfaat'],
    ['water, ascorbyl palmitate', 'Wasser, Ascorbylpalmitat'], ['water, sucrose', 'agua, sacarosa'], ['water, pea protein', 'agua, proteína de guisante'],
    ['water, acidity regulator', 'water, zuurte - regelaar'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('oligofructose and fructo-oligosaccharides are the inulin isolate they are made from', () => {
  const inulin = score('water, inulin');
  for (const t of ['oligofructose', 'fructooligosaccharides', 'fructo-oligosaccharides', 'oligofrutose', 'oligofructosa', 'oligofruttosio',
    'Oligofruktose', 'fruktooligosacharydy', 'fructooligosacáridos', 'fruttoligosaccaridi', 'frukto-oligosackarider', 'FOS']) {
    assert.deepEqual(reasons(score(`water, ${t}`)), reasons(inulin), t);
  }
  assert.deepEqual(reasons(score('water, fosfato')), [], '"fosfato" is not FOS');
});

test('everyday words from the second sample are read, and semi-skimmed milk is charged', () => {
  // "semi-skimmed cow's milk": the apostrophe broke the words allowed between "semi-skimmed" and "milk".
  assert.ok(reasons(score("semi-skimmed cow's milk, lactase enzyme")).includes('Fat-reduced dairy'));
  assert.ok(reasons(score('Yarım yağlı inek sütü, laktaz enzimi')).includes('Fat-reduced dairy'));
  const pairs = [
    ['ground coffee', 'Öğütülmüş kahve'], ['cashews', 'Caju'], ['roasted pistachios', 'PISTACIOS torrados'], ['roasted peanut', 'amendoim torrado'],
    ['orange juice and pulp', 'Sumo de laranja e polpa'], ['soluble chicory', 'chicorée soluble'], ['sesame oil', 'Sesamolja'],
    ['water, humectant', 'su, nem vericiler'], ['water, emulsifying salts', 'vatten, smältsalter'], ['water, sodium alginate', 'su, sodyum aljinat'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.equal(b.coverage, a.coverage, `${other} coverage`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
});

test('a hyphen or an apostrophe inside a phrase does not hide it', () => {
  // "partially-hydrogenated" was charged as hydrogenated oil (capped 25) instead of trans fat
  // (capped 5); "modified corn-starch", "natural-flavors" and "soya-lecithin" escaped their rules;
  // "confectioner's sugar" was charged nothing.
  const pairs = [
    ['water, partially hydrogenated soybean oil', 'water, partially-hydrogenated soybean oil'], ['water, modified corn starch', 'water, modified corn-starch'],
    ['water, natural flavors', 'water, natural-flavors'], ['water, soy lecithin', 'water, soya-lecithin'],
    ['water, confectioners sugar', "water, confectioner's sugar"], ['water, confectioners sugar', 'water, confectioners’ sugar'],
  ];
  for (const [plain, other] of pairs) {
    const a = score(plain), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), other);
    assert.equal(b.score, a.score, other);
  }
});

test('words from a third sample of real labels score like their English twins', () => {
  const pairs = [
    ['water, erythritol', 'eau, érythritol'], ['water, erythritol', 'água, eritritol'], ['water, erythritol', 'Wasser, Erythrit'], ['water, erythritol', 'woda, erytrytol'],
    ['water, steviol glycosides', 'eau, glycosides de stéviol'], ['water, steviol glycosides', 'Wasser, Steviolglycoside'], ['water, steviol glycosides', 'vatten, steviolglykosider'],
    ['water, steviol glycosides', 'woda, glikozydy stewiolowe'], ['water, steviol glycosides', 'agua, glucósidos de esteviol'],
    ['water, bulking agent (erythritol)', 'water, bulking agent: erythritol'], ['water, erythritol', 'eau, agent de charge: érythritol'],
    ['low fat yogurt', 'Yaourt maigre'], ['brazil nuts', 'Paranusskerne'], ['cashew', 'anacardo'], ['roasted peanut', 'geroosterde pinda'],
    ['whole durum wheat', 'fullkornsdurumvete'], ['buckwheat', 'Karabuğday'], ['whole milk', 'Yağlı inek sütü'], ['salt, potassium iodide', 'Sel, iodure de potassium'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
  for (const text of ['Siyah çay', 'Kabuklu susamdan tahin', 'torkad mynta']) assert.equal(score(text).coverage, 1, text);
});

test('more words from the third sample, and two English gaps', () => {
  // English: "plant oils" is an unspecified vegetable oil and "soya protein isolate" is soy protein isolate.
  const pairs = [
    ['water, vegetable oils', 'water, plant oils'], ['water, soy protein isolate', 'water, soya protein isolate'],
    ['water, saccharin', 'su, sakkarin'], ['water, locust bean gum', 'su, keçi boynuzu gamı'], ['water, sucralose', 'vatten, sukralos'],
    ['water, soybean oil', 'vatten, sojaböns olja'], ['water, mono- and diglycerides', 'vatten, mono- och diglycerider'],
    ['water, mono- and diglycerides of fatty acids', 'water, mono- en diglyceriden van vetzuren'], ['water, mono- and diglycerides of fatty acids', 'água, mono e diglicéridos de ácidos gordos'],
    ['water, caramelised sugar', 'woda, cukier karmelizowany w proszku'], ['water, diphosphates', 'woda, difosforany'], ['water, polydextrose', 'água, polidextrose'],
    ['water, guar gum', 'água, goma de guar'], ['water, glucose-fructose syrup', 'água, xarope de glucose-frutose'], ['water, glucose-fructose syrup', 'água, xarope de glicose-frutose'],
    ['water, sodium carboxymethyl cellulose', 'Wasser, Natriumcarboxymethylcellulose'], ['water, glucose syrup', 'water, glucosesiroop'],
    ['water, rapeseed oil', 'water, raapzaadolie'], ['water, carrageenan', 'agua, carragenanos'],
  ];
  for (const [en, other] of pairs) {
    const a = score(en), b = score(other);
    assert.ok(a.bad.length, en);
    assert.deepEqual(reasons(b).sort(), reasons(a).sort(), `${other} vs ${en}`);
    assert.equal(b.score, a.score, `${other} vs ${en}`);
  }
  assert.deepEqual(reasons(score('woda, kwas fosforowy')), reasons(score('water, phosphoric acid')), 'phosphoric acid is not a polyphosphate');
});

test('a bare code in a function word’s bracket is the E-number it names', () => {
  // UK and Indian labels drop the E: "emulsifier (472e)" was an unnamed emulsifier, "preservative
  // (223)" no sulphite, "colour (150d)" no caramel-colour cap.
  const pairs = [
    ['flour, emulsifier (E472e), salt', 'flour, emulsifier (472e), salt'], ['wine, preservative (E223)', 'wine, preservative (223)'],
    ['sugar, colour (E150d)', 'sugar, colour (150d)'], ['flour, raising agents (E503, E500), salt', 'flour, raising agents (503 & 500), salt'],
    ['salt, emulsifiers (E322, E471, E472e)', 'salt, iodised salt and emulsifier (322, 471, 472E)'], ['flour, dough conditioner (E223)', 'flour, dough conditioner (223)'],
  ];
  for (const [coded, bare] of pairs) assert.deepEqual(reasons(score(bare)).sort(), reasons(score(coded)).sort(), bare);
  // Anywhere else a number stays a number.
  assert.deepEqual(engine.parse('flour, chocolate (200 g)'), ['flour', 'chocolate', '200 g']);
  assert.deepEqual(engine.parse('flour, 2 eggs'), ['flour', '2 eggs']);
});

test('English everyday words from the samples are read; a pressing claim is not an ingredient', () => {
  for (const t of ['water, pectins', 'water, pantothenic acid', 'water, mixed seeds', 'parsnip', 'water, nigari', 'water, caffeine', 'water, psyllium husk']) {
    assert.equal(score(t).coverage, 1, t);
  }
  assert.ok(reasons(score('water, colouring agent')).includes('Unnamed colour'));
  assert.equal(score('freeze-dried blueberries').nova, 1);
  assert.equal(score('chopped dates').nova, 1);
  // "(First Cold Press)" was a second, unreadable ingredient that made a bottle of olive oil NOVA 3.
  const oil = score('( First Cold Press ) Organic Extra Virgin Olive Oil');
  assert.equal(oil.nova, 2);
  assert.ok(oil.good.some(g => g.why.startsWith('Cold-pressed')));
});

test('"-ing agent" wordings of the function words are the unnamed additive', () => {
  const pairs = [
    ['water, stabiliser', 'water, stabilising agent'], ['water, stabiliser', 'water, thickening agent'], ['water, stabiliser', 'water, gelling agent'],
    ['water, emulsifier', 'water, emulsifying agent'], ['water, preservative', 'water, preserving agent'], ['water, antioxidant', 'water, anti-oxidant'],
    ['water, acidity regulator', 'water, acidity correctors'], ['water, vegetable oil', 'water, oil of vegetable origin'],
  ];
  for (const [a, b] of pairs) assert.deepEqual(reasons(score(b)), reasons(score(a)), b);
  assert.deepEqual(reasons(score('water, emulsifying agent (soy lecithin)')), reasons(score('water, soy lecithin')));
});

test('local gelling agents and "agent" wordings read as their English function words', () => {
  const pairs = [
    ['water, gelling agent', 'eau, gélifiant'], ['water, gelling agent', 'agua, gelificante'], ['water, gelling agent', 'Wasser, Geliermittel'],
    ['water, gelling agent', 'water, geleermiddel'], ['water, gelling agent', 'vatten, geleringsmedel'], ['water, gelling agent', 'acqua, gelificante'],
    ['water, gelling agent', 'woda, substancja żelująca'], ['water, gelling agent', 'su, jelleştirici'], ['water, gelling agent', 'água, espessante'],
    ['water, emulsifier', 'eau, agent émulsifiant'], ['water, emulsifier', 'agua, agente emulsionante'],
    ['water, preservative', 'eau, agent de conservation'], ['water, preservative', 'agua, agente de conservación'],
  ];
  for (const [a, b] of pairs) assert.deepEqual(reasons(score(b)), reasons(score(a)), b);
  assert.deepEqual(reasons(score('eau, gélifiant (pectine)')), reasons(score('eau, pectine')));
});

test('everyday spices, vegetables, raising agents and food colours from the third sample read as their English twins', () => {
  const twins = {
    cinnamon: ['cannelle', 'canela', 'zimt', 'kaneel', 'tarçın'], cumin: ['comino', 'kreuzkümmel', 'spiskummin', 'kimyon'],
    'black pepper': ['zwarte peper', 'pepe nero', 'schwarzer pfeffer', 'poivre noir', 'svartpeppar'], carrot: ['carota', 'möhre', 'wortel', 'morot'],
    onion: ['ui'], 'onion powder': ['cebolla en polvo', 'zwiebelpulver', 'soğan tozu'], oranges: ['naranja', 'sinaasappel', 'apelsin'],
    celery: ['selderij', 'selleri', 'apio', 'céleri'], leek: ['prei', 'purjolök', 'poireau'], lemon: ['citroen', 'limón', 'zitrone'],
    vanilla: ['vainilla', 'baunilha', 'vanilj'], 'dark chocolate': ['chocolat noir', 'cioccolato fondente', 'mörk choklad', 'bitter çikolata'],
    spices: ['especias', 'specerijen', 'épices', 'spezie'], cloves: ['kryddnejlika', 'clous de girofle', 'kruidnagel', 'karanfil'],
    carotenes: ['carotenos', 'karotener', 'karotenler'], anthocyanins: ['antocyjany', 'antocianinas', 'anthocyanes'],
    'ammonium bicarbonate': ["carbonato acido d'ammonio", 'ammoniumvätekarbonat', 'węglany amonu', 'carbonatos de amonio'],
    'sodium carbonates': ['węglany sodu', 'natriumbicarbonaat', 'bicarbonato de sódio'], 'raising agent': ['agente lievitante', 'triebmittel'],
    'trisodium citrate': ['trisodyum sitrat', 'citrato trisódico'], 'potassium chloride': ['cloruro potásico', 'kaliumchlorid', 'chlorek potasu'],
    thiamin: ['tiamina', 'tiamin'], flour: ['farinha'], yeast: ['levedura', 'hefe'],
  };
  for (const [en, locals] of Object.entries(twins)) {
    const a = score(`water, ${en}`);
    for (const l of locals) {
      const b = score(`water, ${l}`);
      assert.deepEqual([b.score, b.coverage, reasons(b)], [a.score, a.coverage, reasons(a)], l);
    }
  }
  // A food colour in its function word's bracket names it, as "colour (anthocyanins)" does.
  assert.deepEqual(reasons(score('woda, barwnik (antocyjany)')), reasons(score('water, colour (anthocyanins)')));
  // Plural lecithin and accented glycerol are the additive.
  for (const [a, b] of [['lecithin', 'lecithinen'], ['lecithin', 'lesitinler'], ['glycerol', 'glycérol']]) {
    assert.deepEqual(reasons(score(`water, ${b}`)), reasons(score(`water, ${a}`)), b);
  }
});

test('buckwheat is not charged as wheat; local dried egg white and niacin are', () => {
  for (const t of ['farine de blé noir', 'harina de trigo sarraceno', 'farinha de trigo sarraceno', 'farina di grano saraceno']) {
    assert.deepEqual(reasons(score(`water, ${t}`)), reasons(score('water, buckwheat flour')), t);
  }
  assert.ok(reasons(score('water, farina di grano tenero')).includes('Wheat flour'));
  for (const t of ["blanc d'œuf en poudre", 'clara de huevo en polvo', "albume d'uovo in polvere", 'eiklarpulver', 'äggvitepulver', 'białka jaj w proszku', 'yumurta akı tozu', 'kippeneiwitpoeder']) {
    assert.deepEqual(reasons(score(`water, ${t}`)), reasons(score('water, egg white powder')), t);
  }
  // Dutch "eiwit" is also protein in general.
  assert.ok(!reasons(score('water, eiwitpoeder')).includes('Dried egg white'));
  assert.deepEqual(reasons(score('water, niacyna')), reasons(score('water, niacin')));
});

test('Swiss "ss" spelling of semolina is charged like "Grieß"', () => {
  assert.deepEqual(reasons(score('Wasser, Hartweizengriess')), reasons(score('Wasser, Hartweizengrieß')));
  assert.ok(reasons(score('Wasser, Hartweizengriess')).includes('Durum semolina'));
});

test('an unnamed flavour enhancer is charged and ultra-processed; a named one is charged once, as itself', () => {
  for (const t of ['flavour enhancer', 'flavor enhancers', 'exhausteur de goût', 'potenciador del sabor', 'esaltatori di sapidità',
    'Geschmacksverstärker', 'smaakversterkers', 'smakförstärkare', 'wzmacniacze smaku', 'intensificadores de sabor', 'lezzet arttırıcı']) {
    const r = score(`water, ${t}`);
    assert.deepEqual(reasons(r), ['Unnamed flavour enhancer'], t);
    assert.equal(r.nova, 4, t);
  }
  // Every flavour enhancer the rules name makes the list NOVA 4, so hiding the name must not score better.
  assert.ok(score('water, flavour enhancer').score <= score('water, disodium inosinate').score);
  for (const t of ['flavour enhancer (E621)', 'flavour enhancer: monosodium glutamate', 'monosodium glutamate (flavour enhancer)']) {
    assert.deepEqual(reasons(score(`water, ${t}`)), ['MSG'], t);
  }
  assert.deepEqual(reasons(score('water, smaakversterkers: mononatriumglutamaat, dinatriuminosinaat')).sort(),
    reasons(score('water, flavour enhancers: monosodium glutamate, disodium inosinate')).sort());
});

test('bare "organic" is an organic claim, never "USDA Organic"; a verified certification replaces it', () => {
  const claim = engine.score({ name: 'Organic Valley Whole Milk', ingredients_text: 'Organic Grade A Milk, Vitamin D3' });
  assert.ok(claim.good.some(g => g.why === 'Organic, unverified'));
  assert.ok(!claim.good.some(g => /USDA Organic/.test(g.why)));
  const verified = engine.score({ name: 'Organic Whole Milk', ingredients_text: 'Organic milk', certifications: 'USDA Organic' });
  assert.ok(verified.good.some(g => g.why === 'USDA Organic — verified'));
  assert.ok(!verified.good.some(g => /^Organic\b/.test(g.why)));
});

test('an unnamed sweetener is charged like the mildest named one, unless the list names a sweetener anywhere', () => {
  for (const t of ['sweetener', 'sweeteners', 'édulcorant', 'Süßungsmittel', 'edulcorantes', 'dolcificanti', 'zoetstoffen', 'sötningsmedel',
    'substancja słodząca', 'tatlandırıcılar', 'adoçante']) {
    const r = score(`water, ${t}`);
    assert.deepEqual(reasons(r), ['Unnamed sweetener'], t);
    assert.equal(r.nova, 4, t);
  }
  assert.ok(score('water, sweetener').score <= score('water, steviol glycosides').score);
  // Named in its bracket, after a colon, or (the colon lost to a comma) anywhere in the list: charged once, as itself.
  for (const [t, why] of [['water, sweetener (sucralose)', 'Sucralose'], ['water, sweeteners: maltitol', 'Maltitol'],
    ['eau, édulcorants, aspartame', 'Aspartame'], ['water, sweetener, steviol glycosides', 'Stevia']]) {
    const r = reasons(score(t));
    assert.ok(!r.includes('Unnamed sweetener') && r.some(x => x.startsWith(why)), t);
  }
  // "Contains sweeteners", the EU statement beside named ones, costs nothing.
  assert.deepEqual(reasons(score('water, contains sweeteners')), []);
  // The same stand-down for flavour enhancers.
  assert.deepEqual(reasons(score('water, flavour enhancer, monosodium glutamate')), ['MSG']);
});

test('the cosmetic additives that cap the score also mark it ultra-processed; seed oils and preservatives do not', () => {
  for (const t of ['water, sucralose', 'water, aspartame', 'flour, red 40', 'flour, titanium dioxide', 'water, high fructose corn syrup',
    'water, glucose-fructose syrup', 'water, caramel colour', 'milk, carrageenan', 'flour, partially hydrogenated soybean oil']) {
    assert.equal(score(t).nova, 4, t);
  }
  assert.ok(score('water, sunflower oil').nova < 4);
  assert.ok(score('flour, BHT').nova < 4);
  // The class moves, not the score: the cap already set it.
  assert.equal(score('water, sucralose').score, 22);
});

test('organic always earns a benefit: all-penalised lists, capped products and animal foods', () => {
  const pairs = [
    [{ name: 'Cane Sugar', ingredients_text: 'cane sugar' }, { name: 'Cane Sugar', ingredients_text: 'organic cane sugar' }],
    [{ name: 'Honey', ingredients_text: 'honey' }, { name: 'Honey', ingredients_text: 'organic honey' }],
    [{ name: 'Canola Oil', ingredients_text: 'canola oil' }, { name: 'Canola Oil', ingredients_text: 'organic canola oil' }],
    [{ name: 'Drink', ingredients_text: 'water, sucralose' }, { name: 'Drink', ingredients_text: 'organic water, sucralose' }],
    [{ name: 'Eggs', ingredients_text: 'eggs' }, { name: 'Eggs', ingredients_text: 'organic eggs' }],
    [{ name: 'Ground Beef', ingredients_text: 'ground beef' }, { name: 'Organic Ground Beef', ingredients_text: 'ground beef' }],
    [{ name: 'Oats', ingredients_text: 'rolled oats' }, { name: 'Oats', ingredients_text: 'organic rolled oats' }],
  ];
  for (const [plain, organic] of pairs) {
    const a = engine.score(plain), b = engine.score(organic);
    assert.ok(b.score > a.score, `${organic.name}: ${organic.ingredients_text} ${b.score} vs ${a.score}`);
  }
  // Above a cap the panel still adds up, and says why the score passes the cap.
  const oil = engine.score({ name: 'Canola Oil', ingredients_text: 'organic canola oil' });
  assert.ok(oil.bad.some(h => h.cap && /organic counted above it/.test(h.why)));
});
