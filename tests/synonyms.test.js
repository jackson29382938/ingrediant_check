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
