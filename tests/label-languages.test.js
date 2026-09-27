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

test('Turkish allergen and diet words are flagged; coconut, almond milk and vegetable cream are not', () => {
  const TR = {
    milk: ['süt', 'yağsız süt tozu', 'tereyağı', 'peynir altı suyu tozu', 'yoğurt', 'krema', 'laktoz', 'sütlü çikolata'],
    egg: ['yumurta', 'yumurta sarısı'], peanut: ['yer fıstığı', 'fıstık'],
    treeNut: ['fındık', 'badem', 'ceviz içi', 'antep fıstığı', 'kaju', 'fıstık', 'sert kabuklu meyveler'],
    wheat: ['buğday unu', 'arpa', 'çavdar unu', 'irmik', 'glüten'], fish: ['balık', 'ton balığı', 'somon', 'hamsi'],
    shellfish: ['karides', 'yengeç', 'midye'], sesame: ['susam', 'tahin'], sulfite: ['kükürt dioksit'],
    celery: ['kereviz'], mustard: ['hardal'], lupin: ['acı bakla'],
    vegetarian: ['sığır eti', 'tavuk', 'hindi eti', 'jelatin', 'sucuk', 'et suyu', 'ton balığı'],
    vegan: ['bal', 'süt'], porkFree: ['domuz', 'jelatin'],
  };
  for (const [id, words] of Object.entries(TR)) for (const w of words) assert.ok(has(w, id), `${w} → ${id}`);
  for (const w of ['hindistan cevizi sütü', 'badem sütü', 'bitkisel krema', 'kakao yağı']) assert.ok(!has(w, 'milk'), w);
  for (const w of ['hindistan cevizi', 'balkabağı']) assert.deepEqual(flags(w), [], w);
  assert.deepEqual(flags('yulaf ezmesi'), ['keto'], 'oat flakes: only the keto conflict');
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

test('keto, corn and nightshade read every label language; nut flours and sweet potato stay clear', () => {
  // Found by comparing products whose Open Food Facts record has the list in English and another
  // language: keto conflicted on 212 French lists' English twins and on none of the French lists.
  const FLAGGED = {
    keto: ['sucre', 'Zucker', 'farine de blé', 'Weizenmehl', 'harina de trigo', 'sirop de glucose', 'riz', 'patatas', 'miel', 'Hafer',
      'tarwebloem', 'vetemjöl', 'mąka pszenna', 'buğday unu', 'açúcar', 'zucchero'],
    corn: ['maïs', 'semoule de maïs', 'maíz', 'Maisstärke', 'milho', 'kukurydza', 'mısır'],
    nightshade: ['tomates', 'Tomaten', 'pomodori', 'pomme de terre', 'patate', 'Kartoffeln', 'aardappelen', 'poivron', 'pimiento', 'domates'],
    soy: ['soję', 'soi'],
    // compounds: maize maltodextrin, maple syrup
    compound: [['maïsmaltodextrine', 'corn'], ['Ahornsiroop', 'keto'], ['Ahornsirup', 'keto']],
  };
  for (const [id, words] of Object.entries(FLAGGED)) {
    for (const w of words) Array.isArray(w) ? assert.ok(has(w[0], w[1]), `${w[0]} → ${w[1]}`) : assert.ok(has(w, id), `${w} → ${id}`);
  }
  for (const w of ["farine d'amandes", 'harina de almendra', 'Mandelmehl', 'kokosmeel', 'mandelmjöl']) assert.ok(!has(w, 'keto'), w);
  for (const w of ['maison']) assert.ok(!has(w, 'corn'), w);
  for (const w of ['patate douce', 'karabiber']) assert.ok(!has(w, 'nightshade'), w);
});

test('buckwheat and the Italian flours of other grains are not wheat', () => {
  // "Farina di grano saraceno, farina di riso" is a gluten-free cracker; it read as wheat twice over.
  for (const w of ['farine de blé noir', 'sarrasin (blé noir)', 'trigo sarraceno', 'harina de trigo sarraceno', 'farinha de trigo sarraceno',
    'farinha de trigo mourisco', 'farina di grano saraceno', 'farina di riso', 'farina di mais', 'farina di ceci', "farina d'avena", 'farina integrale di riso']) {
    assert.ok(!has(w, 'wheat'), w);
  }
  for (const w of ['farine de blé', 'harina de trigo', 'farinha de trigo', 'farina di grano tenero', 'farina di frumento', 'farina', 'farina 00',
    "farina d'orzo", 'farina di farro', 'farina di segale', 'semola di grano duro', 'blé noir, blé dur']) {
    assert.ok(has(w, 'wheat'), w);
  }
});

test('egg by its local names; lactic acid, cream of tartar, nutmeg and milk are not what they look like', () => {
  for (const w of ['yema de huevo', 'tuorlo', 'albume', 'mayonesa', 'maionese', 'Majonäse', 'merengue', 'meringa', 'Eigelbpulver', 'Eiklar',
    'Volleipulver', 'Eiernudeln', 'ovoalbumina', 'lisozima', 'Lysozym']) {
    assert.ok(has(w, 'egg'), w);
  }
  assert.ok(!has('Eiersatz', 'egg'));
  // "Kippeneiwit" is hen's egg white: egg, and vegetarian.
  assert.ok(has('kippeneiwit', 'egg') && !has('kippeneiwit', 'vegetarian'));
  assert.ok(has('kippenvlees', 'vegetarian'));
  for (const w of ['süt asidi', 'crème de tartre', 'crème de marrons', 'crema di tartaro']) assert.ok(!has(w, 'milk'), w);
  for (const w of ['süt', 'süt tozu', 'crème fraîche', 'crema']) assert.ok(has(w, 'milk'), w);
  for (const w of ['noz-moscada', 'noz moscada']) assert.ok(!has(w, 'treeNut'), w);
  assert.ok(has('nozes', 'treeNut'));
  // Swedish milk is not flour: "mjölk" and "mjölksyrakultur" conflicted with keto on every dairy list.
  for (const w of ['pastöriserad mjölk', 'mjölksyrakultur', 'mellanmjölk']) assert.ok(!has(w, 'keto'), w);
  for (const w of ['vetemjöl', 'mjöl']) assert.ok(has(w, 'keto'), w);
});

test('ß is a letter: "weiß" is not Dutch whey, and Swiss "ss" spellings keep their flags', () => {
  // The explicit word boundaries stopped at à, so "weiße Bohnen" read as "wei" (whey) and flagged milk.
  for (const w of ['weiße Bohnen', 'weißes Maismehl', 'Weißzucker', 'Weißwein', 'Weißkohl', 'Weißbrot']) assert.ok(!has(w, 'milk'), w);
  assert.ok(has('wei', 'milk') && has('weipoeder', 'milk'));
  // ...and a word running on past ß must still reach its end.
  for (const w of ['Hartweizengrieß', 'Weizengrieß', 'Grieß', 'Hartweizengriess', 'Griess']) assert.ok(has(w, 'wheat'), w);
  for (const w of ['Hühnereiweiß', 'Hühnereiweiss']) assert.ok(has(w, 'egg'), w);
  for (const w of ['Erdnußöl', 'Erdnuß', 'Erdnußbutter']) assert.ok(has(w, 'peanut'), w);
  for (const w of ['Haselnuß', 'Walnuß']) assert.ok(has(w, 'treeNut'), w);
  assert.ok(!has('Erdnußbutter', 'milk'));
  assert.ok(has('Butter', 'milk') && has('Sahne', 'milk'));
});

test('words that only look like an allergen or a meat, from the samples', () => {
  // Polish "masa kakaowa" is cocoa mass and Spanish "masa madre" sourdough, not corn masa.
  for (const w of ['masa kakaowa', 'czekolada gorzka: masa kakaowa', 'masa madre']) assert.ok(!has(w, 'corn'), w);
  assert.ok(has('masa harina', 'corn') && has('masa', 'corn'));
  assert.ok(!has('tamarind', 'soy') && has('tamari', 'soy'));
  // Polish "ostra papryka" is hot paprika; "ostras" are oysters.
  for (const w of ['ostra papryka', 'papryka ostra']) assert.ok(!has(w, 'shellfish'), w);
  assert.ok(has('ostras', 'shellfish') && has('salsa de ostra', 'shellfish'));
  assert.ok(!has('Susurluk/Balıkesir işletme kayıt no', 'fish') && has('balık', 'fish'));
  // Polish "mieszanka" (a mixture) is not "mięso" (meat), and "porcjach" (portions) is not pork.
  for (const w of ['mieszanka owoców', 'mieszanka fasoli w zmiennych proporcjach', 'mieszane']) assert.ok(!has(w, 'vegetarian'), w);
  for (const w of ['mięso', 'mieso', 'mięsny']) assert.ok(has(w, 'vegetarian'), w);
  assert.ok(!has('czerwone owoce w zmiennych pro-porcjach', 'porkFree') && has('poitrine de porc', 'porkFree'));
});

test('fish by species, sulfite salts in compounds, and Dutch egg compounds', () => {
  // A missed fish flag reads as "clear": trout and hake were, in English, and so were most species elsewhere.
  for (const w of ['trout', 'hake', 'plaice', 'eels', 'swordfish', 'catfish', 'filets de maquereaux', 'poissons', 'cabillaud', 'colin d\'Alaska',
    'merluza', 'boquerones', 'sgombro', 'alici', 'Heringsfilet', 'Alaska-Seelachs', 'Kabeljau', 'Forelle', 'pescada', 'truta', 'koolvis',
    'visolie', 'strömming', 'skarpsill', 'pstrąg', 'mintaj', 'alabalık', 'palamut']) {
    assert.ok(has(w, 'fish'), w);
    assert.ok(has(w, 'vegetarian'), `${w} → vegetarian`);
  }
  for (const w of ['Kaliummetabisulfit', 'Natriumdisulfit', 'natriumbisulfiet', 'metabisolfito di potassio', 'disulfite de potassium']) {
    assert.ok(has(w, 'sulfite'), w);
  }
  for (const w of ['Kaliumsulfat', 'sulfate de calcium']) assert.ok(!has(w, 'sulfite'), w);
  for (const w of ['eiwitpoeder', 'eigeelpoeder']) assert.ok(has(w, 'egg'), w);
  assert.ok(!has('melkeiwitpoeder', 'egg'));
});

test('crustaceans and molluscs by species; words with another meaning stay clear', () => {
  for (const w of ['scampi', 'cockles', 'whelks', 'snails', 'cuttlefish', 'cigalas', 'vieiras', 'pulpo', 'coques', 'coquilles Saint-Jacques',
    'seiches', 'poulpe', 'écrevisses', 'seppie', 'polpo', 'capesante', 'Jakobsmuscheln', 'Miesmuscheln', 'Kalmar', 'Flusskrebse', 'Austern',
    'inktvis', 'krab', 'sint-jakobsschelpen', 'lagostins', 'amêijoas', 'lulas', 'kräftor', 'blåmusslor', 'ostron', 'ośmiornica',
    'przegrzebki', 'mątwy', 'ślimaki', 'salyangoz', 'ahtapot', 'istakoz']) {
    assert.ok(has(w, 'shellfish'), w);
  }
  // "Fruits à coque(s)" are nuts; "leche en polvo" is milk powder; "choco" is chocolate.
  assert.ok(!has('fruits à coques', 'shellfish') && has('fruits à coques', 'treeNut'));
  for (const w of ['leche en polvo', 'choco chips', 'Krebs']) assert.ok(!has(w, 'shellfish'), w);
});

test('tree nuts by their local and compound names, pine nuts, and nut sweets', () => {
  for (const w of ['pignons de pin', 'piñones', 'pinoli', 'Pinienkerne', 'pijnboompitten', 'rostade pinjenötter', 'pinhões', 'Paranüsse',
    'paranusskerne', 'Pekannüsse', 'anacardi', 'pistacios torrados', 'pistácios', 'macadâmia', 'makadamianötter', 'praliné', 'massepain',
    'mazapán', 'marsepein', 'marcepan', 'marsipan', 'gianduia', 'turrón', 'torrone']) {
    assert.ok(has(w, 'treeNut'), w);
  }
  for (const w of ['Kokosnüsse', 'Muskatnuss', 'crème de marrons']) assert.ok(!has(w, 'treeNut'), w);
});

test('cheeses, fresh cheeses and dairy compounds by name; soy, sesame, mustard, celery and lupin forms', () => {
  for (const w of ['natriumcaseïnaat', 'milkfat', 'comté', 'roquefort', 'gorgonzola', 'taleggio', 'manchego', 'Topfen', 'Schmand',
    'Butterschmalz', 'kesella', 'kaşar', 'labne', 'natas', 'faisselle', 'latticello', 'yoghourt', 'twarożek', 'kefiru']) {
    assert.ok(has(w, 'milk'), w);
  }
  for (const w of ['Kakaobutter', 'Sheabutter', 'Erdnussbutter', 'beurre de karité']) assert.ok(!has(w, 'milk'), w);
  assert.ok(has('yuba', 'soy') && has('tahina', 'sesame') && has('senapsfrön', 'mustard'));
  assert.ok(has('Knollensellerie', 'celery') && has('selderijzout', 'celery'));
  assert.ok(has('puede contener trazas de altramuces', 'lupin'));
});

test('wheat products named without "wheat"; German malt is not Polish mussels', () => {
  for (const w of ['chapelure', 'pan rallado', 'Semmelbrösel', 'ströbröd', 'bułka tarta', 'pain', 'Vollkornbrot', 'knäckebröd', 'roggebrood',
    'chleb żytni', 'pão', 'ekmek', 'Grünkern', 'boulgour', 'semoule', 'kasza manna', 'pęczak', 'mannagryn', 'Graupen', 'Nudeln', 'makaron',
    'Malzextrakt', 'extracto de malta', 'estratto di malto', 'moutextract', 'ekstrakt słodowy']) {
    assert.ok(has(w, 'wheat'), w);
  }
  for (const w of ['semoule de maïs', 'sémola de maíz', 'sêmola de milho', 'Reisnudeln', 'fideos de arroz', 'nouilles de riz',
    'mączka chleba świętojańskiego', 'Johannisbrotkernmehl', 'moutarde', 'mouton', 'słodki', 'substancja słodząca', 'maltitol', 'Brotaufstrich']) {
    assert.ok(!has(w, 'wheat'), w);
  }
  // "Malz" (German malt) matched the ASCII spelling of Polish "małże" (mussels).
  assert.ok(!has('Malzextrakt', 'shellfish') && has('małże', 'shellfish'));
});

test('vegetarian: carmine, rennet, animal fat, tallow, collagen, gelatine and sausages in each language', () => {
  for (const w of ['Rindergelatine', 'gelatyna', 'carmin', 'cochenille', 'Karmin', 'karmijn', 'koszenila', 'cochinilla', 'Tierfett',
    'graisse animale', 'grasa animal', 'dierlijk vet', 'tłuszcz zwierzęcy', 'hayvansal yağ', 'suif', 'Rindertalg', 'łój', 'présure', 'caglio',
    'cuajo', 'tierisches Lab', 'stremsel', 'löpe', 'podpuszczka', 'peynir mayası', 'coalho animal', 'Kollagen', 'colágeno', 'collagène',
    'E542', 'Knochenbrühe', 'rosół', 'salchichón', 'Bratwurst', 'Wurst', 'mortadella', 'kiełbasa', 'parówki', 'rookworst', 'falukorv']) {
    assert.ok(has(w, 'vegetarian'), w);
  }
  // Microbial and vegetable rennet are vegetarian, pregelatinised starch is starch, Dutch "gehakte" is "chopped".
  for (const w of ['caglio microbico', 'coalho microbiologico', 'cuajo microbiano', 'présure microbienne', 'mikrobielles Lab',
    'vegetabiliskt löpe', 'bitkisel peynir mayası', 'gelatinised starch', 'gelatinisierte Stärke', 'gehakte noten', 'Wurstgewürz']) {
    assert.ok(!has(w, 'vegetarian'), w);
  }
});

test('vegan: bee products, shellac, lanolin and L-cysteine; pork-free: local pork words', () => {
  for (const w of ['gelée royale', 'jalea real', 'pappa reale', 'mleczko pszczele', "cire d'abeille", 'Bienenwachs', 'bivax', 'wosk pszczeli',
    'balmumu', 'gomme laque', 'Schellack', 'goma laca', 'szelak', 'lanoline', 'Wollfett', 'L-Cystein', 'L-cisteína', 'propolis', 'Bienenpollen']) {
    assert.ok(has(w, 'vegan'), w);
  }
  // Royal jelly is "bee milk" in Turkish, not milk.
  assert.ok(has('arı sütü', 'vegan') && !has('arı sütü', 'milk'));
  for (const w of ['Schwein', 'Schmalz', 'saindoux', 'panceta', 'tocino', 'strutto', 'guanciale', 'späck', 'słonina', 'carne magra de suíno',
    'salami', 'sobrasada', 'Leberwurst', 'Kassler', 'rillettes']) {
    assert.ok(has(w, 'porkFree'), w);
  }
  for (const w of ['Butterschmalz', 'Gänseschmalz', 'Geflügelwurst', 'Putenwurst', 'gelatinised starch']) assert.ok(!has(w, 'porkFree'), w);
});

test('nightshades and corn in each language, and their look-alikes', () => {
  for (const w of ['passata', 'potatisstärkelse', 'skrobia ziemniaczana', 'papryka', 'guindilla', 'peperoncino', 'papryczki jalapeño',
    'harissa', 'bakłażan', 'beringela', 'ajvar', 'capsicum', 'pul biber']) {
    assert.ok(has(w, 'nightshade'), w);
  }
  for (const w of ['zoete aardappel', 'słodki ziemniak', 'tatlı patates', 'piment de la Jamaïque', 'kara biber', 'karabiber', 'papaya']) {
    assert.ok(!has(w, 'nightshade'), w);
  }
  for (const w of ['polenta', 'grits', 'nachos', 'arepa', 'fubá', 'Maisflocken', 'mısırözü yağı', 'zein', 'HFCS']) assert.ok(has(w, 'corn'), w);
  // Gherkins, garam masala and oat groats are not corn.
  for (const w of ['cornichons', 'Cornichon', 'garam masala', 'oat grits']) assert.ok(!has(w, 'corn'), w);
});
