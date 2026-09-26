// Swedish, Polish, Dutch and Portuguese labels (amazon.se, .pl, .nl, .com.br).
// Run: node --test tests/label-languages.test.js
//
// The extractor reads these stores' headings and nutrition panels, so the allergen and diet flags
// must read their ingredient words too: a missed flag reads as "clear" to someone who relies on it.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require(path.join(__dirname, '..', 'src', 'engine', 'db', '_module.js'));
const allergens = require(path.join(__dirname, '..', 'src', 'engine', 'db', 'allergens.js'));

const ALL = allergens.ALLERGENS.map(a => a.id);
const DIETS = allergens.DIETS.map(d => d.id);
const flags = text => allergens.detect([text], ALL, DIETS).map(f => f.id).sort();
const has = (text, id) => flags(text).includes(id);

const FLAGGED = {
  milk: ['skummjölkspulver', 'helmjölk', 'smör', 'grädde', 'vasslepulver', 'ost', 'mleko w proszku odtłuszczone', 'masło',
    'śmietanka', 'serwatka w proszku', 'ser', 'mleczna czekolada', 'magere melkpoeder', 'roomboter', 'kaas', 'wei',
    'leite em pó desnatado', 'manteiga', 'queijo', 'soro de leite'],
  egg: ['ägg', 'äggula', 'helägg', 'jaja', 'jajka', 'żółtko', 'eieren', 'eigeel', 'ovos', 'gema de ovo'],
  peanut: ['jordnötter', 'jordnötssmör', 'orzeszki ziemne', 'pindakaas', 'amendoim'],
  treeNut: ['hasselnötter', 'mandlar', 'cashewnötter', 'orzechy laskowe', 'migdały', 'hazelnoten', 'walnoten', 'avelãs', 'castanha de caju'],
  soy: ['lecytyna sojowa', 'sojabönor'],
  wheat: ['vetemjöl', 'rågmjöl', 'mąka pszenna', 'jęczmień', 'mąka żytnia', 'tarwebloem', 'gerst', 'rogge', 'cevada', 'centeio'],
  fish: ['fisk', 'lax', 'tonfisk', 'łosoś', 'tuńczyk', 'śledź', 'vis', 'zalm', 'peixe', 'bacalhau'],
  shellfish: ['räkor', 'skaldjur', 'krewetki', 'małże', 'garnalen', 'mosselen', 'camarão'],
  sesame: ['sezam', 'gergelim'],
  sulfite: ['svaveldioxid', 'dwutlenek siarki', 'zwaveldioxide'],
  celery: ['selleri', 'seler', 'selderij', 'aipo'],
  mustard: ['senap', 'gorczyca', 'musztarda', 'mosterd', 'mostarda'],
  lupin: ['łubin', 'tremoço'],
  vegetarian: ['nötkött', 'fläskkött', 'kycklingbuljong', 'wieprzowina', 'żelatyna', 'varkensvlees', 'rundvlees', 'kip', 'frango',
    'banha', 'tonfisk', 'łosoś', 'atún', 'crevettes'],
  vegan: ['honung', 'miód', 'honing', 'mel', 'miel', 'honig', 'mjölk'],
  porkFree: ['fläsk', 'wieprzowina', 'smalec', 'boczek', 'varkensvlees', 'reuzel', 'toucinho', 'żelatyna'],
};

test('allergen and diet words in Swedish, Polish, Dutch and Portuguese are flagged', () => {
  for (const [id, words] of Object.entries(FLAGGED)) for (const w of words) assert.ok(has(w, id), `${w} → ${id}`);
});

test('plant milks and butters, lactic acid and look-alike words are not', () => {
  for (const w of ['kokosmjölk', 'havremjölk', 'kakaosmör', 'masło kakaowe', 'mleko kokosowe', 'kokosmelk', 'cacaoboter',
    'leite de coco', 'manteiga de cacau', 'mjölksyra', 'melkzuur', 'milchsäure', 'kwas mlekowy']) {
    assert.ok(!has(w, 'milk'), `${w} is not dairy`);
  }
  assert.ok(!has('białko', 'egg'), 'białko alone is protein');
  assert.ok(!has('orzeszki ziemne', 'treeNut'), 'peanuts are not tree nuts');
  assert.ok(!has('jordnötter', 'treeNut'));
  for (const w of ['ragout', 'rundkornreis', 'veterinary']) assert.ok(!has(w, 'wheat'), w);
  for (const w of ['sel gris', 'rundkornreis', 'caramel', 'melon']) assert.deepEqual(flags(w), [], w);
});
