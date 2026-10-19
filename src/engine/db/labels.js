// Provenance bonuses and whole-food recognition.
//
// Two separate jobs:
//   BONUSES    — sourcing claims that lift a score, capped in aggregate so a label can lift a good
//                product but never launder a bad one.
//   WHOLE      — single-ingredient real foods, used by the NOVA classifier to recognise NOVA 1.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

// Manifest-declared content scripts share one top-level scope, so every const here
// must stay inside this closure or it collides with the other rule files at load time.
(function () {

  // Explicit word boundaries for the label-language words below: \b does not see the accented
  // letters they start and end with ("é", "ö", "ł", "ı").
  const PL = '(?<![a-zß-ÿœ\\u0100-\\u017f])', PR = '(?![a-zß-ÿœ\\u0100-\\u017f])';
  // An English rule plus the same claim in each label language. Without the local words
  // "sel marin" and "Meersalz" earned nothing where "sea salt" earns 5, and "maïs bio" nothing
  // where "organic maize" earns 8.
  const inLanguages = (en, local) => new RegExp(en.source + '|' + PL + '(?:' + local.join('|') + ')' + PR, 'i');

  const BONUSES = [
    { pts: 12, cat: 'animalWelfare', why: '100% grass-fed / grass-finished', applies: ['beef', 'lamb', 'dairy'], claimSurfaceOnly: true, provenanceIds: ['grassFed', 'grassFinished', 'aga'], m: /\bgrass[- ]?(fed|finished)\b/i },
    { pts: 10, cat: 'animalWelfare', why: 'Pasture-raised',              applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy'], claimSurfaceOnly: true, provenanceIds: ['pastureRaised', 'awa', 'gap4', 'gap5'], m: /\bpasture[- ]?(raised|fed)\b/i },
    { pts: 10, cat: 'animalWelfare', why: 'Wild-caught',                 applies: ['seafood'], claimSurfaceOnly: true, provenanceIds: ['wildCaught'], m: /\bwild[- ]?(caught|harvested)\b/i },
    { pts:  8, cat: 'organic', why: 'Organic label claim', provenanceIds: ['organic', 'organicClaim'], m: inLanguages(/\b(certified )?organic\b/i, [
      'bio', 'biologiques?', 'biol[óo]gic[oa]s?', 'biologic[oaie]', 'biologiche', 'biologisch(?:e[mnrs]?)?', 'ecol[óo]gic[oa]s?', 'eco',
      '[öo]kologisch(?:e[mnrs]?)?', '[öo]ko', 'ekologisk[at]?', 'ekologiczn[a-zęąó]*', 'eko', 'organik', 'biyolojik'] ) },
    { pts:  0, cat: 'dairyProcessing', why: 'Raw / unpasteurised dairy', applies: ['dairy'], m: inLanguages(/\braw (milk|cream|cheese|dairy|butter)\b|\bunpasteurized\b/i, [
      'lait cru', 'au lait cru', 'rohmilch[a-z]*', 'leche cruda', 'latte crudo', 'leite cru', 'rauwe melk', 'opast[öo]riserad[a-z]*',
      'mleko surowe', 'mleka surowego', '[çc]i[ğg] s[üu]t', 'non pastoris[ée]e?', 'no pasteurizad[oa]', 'non pastorizzat[oa]', 'unpasteurisiert[a-z]*'] ) },
    { pts:  7, cat: 'animalWelfare', why: 'Regeneratively farmed', provenanceIds: ['regenerative'], m: /\bregenerativ(e|ely)\b/i },
    { pts:  6, cat: 'fermented', why: 'Fermented / live cultures',       m: inLanguages(/\b(cultured|fermented|live active cultures|probiotic|kefir|kimchi|sauerkraut)\b/i, [
      'ferment[ée]e?s?', 'fermentad[oa]s?', 'fermentat[oaie]', 'fermentiert[a-z]*', 'gefermenteerd[a-z]*', 'fermenterad[a-z]*', 'fermentowan[a-zęąó]*', 'fermente',
      'k[ée]fir', 'kefiru?', 'probiotiques?', 'probi[óo]tic[oa]s?', 'probiotisch[a-z]*', 'probiotyczn[a-zęąó]*', 'probiyotik', 'choucroute', 'chucrut', 'crauti',
      'zuurkool', 'surk[åa]l', 'kapusta kiszona', 'ferments vivants', 'fermenti vivi', 'cultivos vivos', 'lebende kulturen', 'levende culturen', '[żz]ywe kultury'] ) },
    { pts:  6, cat: 'unrefined', why: 'Minimally refined cooking fat', requiresUnrefinedFat: true, m: inLanguages(/(?<!peanut |almond |cashew |sunflower |seed |nut |cocoa |shea |apple |soy )\b(butter|ghee|tallow|lard|suet|duck fat|coconut oil|olive oil|avocado oil)\b|\b(aceite de (?:oliva|coco)|huile d['’]olive|huile de coco|oliven[öo]l|kokos[öo]l|olio d['’]oliva|olio di cocco|mantequilla|beurre(?!\s+(?:de\s+(?:cacao|cacahu[èe]te|karit[ée]|coco|noix|noisette|amande)|d['’]arachide))|(?<!cacao )burro(?!\s+di\s+cacao))\b/i, [
      'olio (?:extra )?vergine di oliva', 'olio di oliva', 'olijfolie', 'olivolja', 'oliwa z oliwek', 'zeytinya[ğg][ıi]', 'azeite(?: de oliva)?', 'kokosolie', 'kokosolja',
      'olej kokosowy', '[óo]leo de coco', 'hindistan cevizi ya[ğg][ıi]', 'roomboter', 'boter', 'sm[öo]r', 'mas[łl]o(?! (?:kakaowe|orzechowe|shea))', 'tereya[ğg][ıi]', 'manteiga(?! de (?:caca[ou]|amendoim|karit[ée]|coco))',
      'butterreinfett', 'butterschmalz', 'butterfett', 'boterconcentraat', 'boterolie', 'gesmolten boter', 'sm[öo]rolja', 'sm[öo]rfett', 'koncentrat mas[łl]a', 'mas[łl]o klarowane', 'burro (?:concentrato|anidro|chiarificato)', 'mantequilla (?:concentrada|clarificada)', 'manteiga (?:concentrada|clarificada)', 'tereya[ğg][ıi] konsantresi', 'sade ya[ğg]', 'saindoux', 'schmalz', 'manteca de cerdo', 'strutto', 'reuzel', 'ister', 'smalec', 'banha'] ) },
    { pts:  0, cat: 'dairyProcessing', why: 'A2 dairy',                  m: /\ba2\b/i },
    { pts:  5, cat: 'traditionalPrep', why: 'Sourdough / sprouted grain', m: inLanguages(/\b(sourdough|sprouted|naturally leavened|einkorn|soaked)\b/i, [
      'levain', 'masa madre', 'lievito madre', '(?:roggen|weizen|dinkel|natur)?[- ]?sauerteig[a-z]*', 'zuurdesem', 'surdeg', 'zakwas(?:u|ie|em)?', 'ek[şs]i maya',
      'massa m[ãa]e', 'germée?s?', 'gekeimt[a-z]*', 'germinad[oa]s', 'germogliat[oaie]', 'gekiemd[a-z]*', 'groddad[a-z]*', 'kie[łl]kowan[a-zęąó]*', 'engrain', 'einkorn', 'tremp[ée]e?s', 'eingeweicht[a-z]*', 'remojad[oa]s', 'ammollat[oaie]', 'geweekt[a-z]*', 'bl[öo]tlagd[a-z]*', 'namoczon[a-zęąó]*', 'demolhad[oa]s', '[ıi]slat[ıi]lm[ıi][şs]'] ) },
    { pts:  5, cat: 'nonGmo', why: 'Non-GMO claim', provenanceIds: ['nonGmoVerified'], m: inLanguages(/\bnon[- ]?gmo\b/i, [
      'sans ogm', 'sin ogm', 'senza ogm', 'sem ogm', 'ohne gentechnik', 'gentechnikfrei', 'bez gmo', 'gdo[\'’]?suz', 'zonder gmo', 'utan gmo'] ) },
    { pts:  0, cat: 'unrefined', why: 'Unrefined salt',                  m: inLanguages(/\b(sea salt|redmond|celtic|real salt|himalayan salt)\b/i, [
      'sel marin', 'sel de mer', 'fleur de sel', 'sel de gu[ée]rande', 'gu[ée]rande salt', 'sal marina', 'sal de mar', 'sale marino', 'meersalz', 'zeezout', 'havssalt', 'havsalt',
      's[óo]l morska', 'deniz tuzu', 'sal marinho', 'flor de sal', 'sel de l[\'’]himalaya', 'sal del himalaya', 'sale dell[\'’]himalaya', 'himalayasalz', 'himalayazout', 'himalayasalt'] ) },
    { pts:  4, cat: 'animalWelfare', why: 'Heritage / heirloom breed',   applies: ['beef', 'pork', 'poultry', 'lamb'], claimSurfaceOnly: true, m: /\b(heritage|heirloom|berkshire|wagyu)\b/i },
    { pts:  4, cat: 'traditionalPrep', why: 'Dry-aged / traditionally cured', m: /\bdry[- ]?(aged|cured)\b/i },
    { pts:  3, cat: 'unrefined', why: 'Cold-pressed / unrefined', requiresCookingFat: true, m: inLanguages(/\b(cold[- ]pressed|expeller[- ]pressed|unrefined|first (?:cold )?press(?:ed|ing)?)\b/i, [
      'press[ée]e? [àa] froid', 'premi[èe]re pression [àa] froid', 'prensad[oa] en fr[íi]o', 'prensad[oa] a frio', 'spremitura a freddo', 'spremuto a freddo',
      'kaltgepresst[a-z]*', 'koudgeperst[a-z]*', 'kallpressad[a-z]*', 't[łl]oczon[a-zęąó]* na zimno', 'so[ğg]uk s[ıi]k[ıi]m', 'non raffin[ée]e?s?', 'no refinad[oa]s?',
      'non raffinat[oaie]', 'unraffiniert[a-z]*', 'ongeraffineerd[a-z]*', 'oraffinerad[a-z]*', 'nierafinowan[a-zęąó]*', 'n[ãa]o refinad[oa]s?'] ) },
  ];

  const BONUS_CAP = 15;        // total ceiling on all bonuses
  const TITLE_BONUS_CAP = 8;   // ceiling on claims found only in the marketing title

  // Whole, single-ingredient foods. Used for NOVA 1 detection, never penalised.
  // The animal lines match on the noun but must not match what is DERIVED from it: "chicken
  // flavor", "beef stock" and "milk chocolate" all read as NOVA 1 whole foods (96 Excellent for a
  // lone "Milk chocolate" entry) until the lookaheads below were added, and "peanut butter" was
  // dairy.
  const DERIVED = '(?!\\s+(?:flavou?r(?:ing|ed)?|stock|broth|bouillon|base|fat|extract|powder|solids|substitute|replacer|protein|seasoning|chocolate|sauce|oil)s?\\b)';
  const NOT_DAIRY = '(?<!(?:peanut|almond|cashew|sunflower|seed|nut|cocoa|cacao|shea|apple|soy|soya|coconut|oat|rice|hemp|pea|macadamia|pistachio|walnut|hazelnut|pecan|sesame) )';
  const WHOLE = [
    // Minimal dairy treatment and declared fat percentages do not make milk ultra-processed.
    new RegExp('^(?:(?:ultra[- ]pasteuri[sz]ed|pasteuri[sz]ed|homogeni[sz]ed|non[- ]?fat|fat[- ]free|low[- ]?fat|skim(?:med)?|semi[- ]skimmed|whole|full[- ](?:fat|cream)|organic|grade a|fresh|filtered|raw|uht|[0-9]+(?:\\.[0-9]+)?%)\\s+)*(?:milk|cream|kefir|yogh?urt|cheese|butter)\\b' + DERIVED, 'i'),
    new RegExp('^[\\w\' -]{0,28}\\b(beef|bison|lamb|mutton|goat|venison|elk|pork|chicken|turkey|duck)\\b' + DERIVED, 'i'),
    new RegExp('^[\\w\' -]{0,24}\\b(salmon|tuna|sardines?|anchov(y|ies)|mackerel|cod|halibut|trout|herring|shrimp|oysters?|mussels?)\\b' + DERIVED, 'i'),
    /^(organic |pasture[- ]?raised )*(eggs?|egg yolks?|egg whites?)$/i,
    new RegExp('^[\\w\' -]{0,24}' + NOT_DAIRY + '\\b(milk|cream|butter|ghee|yogh?urt|kefir|cheese|cheddar|mozzarella|parmesan)\\b' + DERIVED + '(?!\\s+of\\s+tartar)', 'i'),
    /^(beef |chicken |pork )?(liver|heart|kidney|bone marrow|tripe|sweetbreads)\b/i,
    /^(organic )?(water|sea salt|salt)$/i,
    new RegExp('^(?:sel(?: marin| de mer| de gu[ée]rande| fin)?|fleur de sel|sal(?: marina| de mar| marinho)?|sale(?: marino)?|(?:speise|meer)?salz|(?:zee|keuken)?zout|(?:hav)?salt|s[óo]l(?: morska)?|(?:deniz |kaya )?tuzu?|flor de sal)$', 'i'),
    /^(organic |raw )*(honey|maple syrup)$/i,
    /^(organic |raw |dry[- ]roasted |roasted |unsalted |salted |whole |shelled |blanched |sliced |slivered |flaked |chopped |ground |halved )*(almonds?|walnuts?|pecans?|pecan nuts?|macadamias?|macadamia nuts?|pistachios?|pistachio nuts?|pistachio kernels?|cashews?|cashew nuts?|cashew kernels?|hazelnuts?|hazelnut kernels?|peanuts?|peanut kernels?|pine nuts?|brazil nuts?|(?:pumpkin|sunflower|chia|flax|hemp|sesame) ?seeds?|flaxseed)$/i,
    /^(organic |dried |cooked )*(lentils?|chickpeas?|(?:black|kidney|pinto|navy|cannellini|garbanzo|white|red) beans?|split peas|edamame)$/i,
    /^(organic )?(?:(?:dried|freeze[- ]dried|frozen|fresh|chopped|pitted|sliced) )*(apples?|bananas?|berries|blueberries|strawberries|raspberries|cherries|oranges?|(?:(?:medjool|deglet noor) )?dates?|figs?|raisins?|sultanas|apricots?|prunes?|mangos?|mangoes|cranberries)$/i,
    // The same fruit in each label language: "dattes, amandes" scored 80 as NOVA 3 where "dates,
    // almonds" scores 94 as NOVA 1.
    new RegExp('^(?:pommes?|manzanas?|mel[ae]|[äa]pfel|appels?|[äa]pplen?|jab[łl]k[ao]|elma|ma[çc][ãa]s?'
      + '|bananes?|pl[áa]tanos?|banane|bananen|banaan|banan(?:y|er)?|muz|bananas?'
      + '|baies|bayas|bacche|beeren|bessen|b[äa]r|jagody|meyveler|bagas'
      + '|myrtilles|ar[áa]ndanos|mirtilli|heidelbeeren|blaubeeren|bosbessen|bl[åa]b[äa]r|bor[óo]wki|yaban mersini|mirtilos'
      + '|fraises|fresas|fragole|erdbeeren|aardbeien|jordgubbar|truskawki|[çc]ilek|morangos'
      + '|oranges|naranjas?|arancia|arance|orangen?|sinaasappels?|apelsin(?:er)?|pomara[ńn]cz[ae]|portakal|laranjas?'
      + '|dattes|d[áa]tiles|datteri|datteln|dadels|dadlar|daktyle|hurma|t[âa]maras'
      + '|figues|higos|fichi|feigen|vijgen|fikon|figi|incir|figos'
      + '|raisins secs|(?:uvas )?pasas|uvetta|uva sultanina|rosinen|sultaninen|rozijnen|russin|rodzynki|kuru [üu]z[üu]m|uvas passas)$', 'i'),
    /^(organic )?(?:(?:fresh|frozen|diced|chopped|crushed|sliced|peeled|whole) )*(spinach|kale|broccoli|carrots?|onions?|garlic|tomato(?:es)?|potato(?:es)?|sweet potato(?:es)?)$/i,
    // The same vegetables in each label language ("Kartoffeln, Sonnenblumenöl, Salz" was NOVA 3).
    new RegExp('^(?:[ée]pinards?|espinacas?|spinaci|spinat|spinazie|spenat|szpinak|ıspanak|espinafres?'
      + '|chou kale|col rizada|cavolo riccio|gr[üu]nkohl|boerenkool|gr[öo]nk[åa]l|jarmu[żz]|karalahana|couve galega'
      + '|brocolis?|br[óo]coli|broccoli|brokkoli|brokuły|brokoli|br[óo]colos?'
      + '|carottes?|zanahorias?|carot[ae]|karotten?|m[öo]hren?|wortel(?:en|s)?|mor[öo]t(?:ter)?|marchew|havu[çc]|cenouras?'
      + '|oignons?|cebollas?|cipoll[ae]|zwiebeln?|ui(?:en)?|l[öo]k|cebula|so[ğg]an|cebolas?'
      + '|ail|ajo|aglio|knoblauch|knoflook|vitl[öo]k|czosnek|sar[ıi]msak|alho'
      + '|tomates?|pomodor[oi]|tomaten|tomaat|tomater?|pomidor(?:y)?|domates'
      + '|pommes? de terre|patatas?|papas|patat[ae]|kartoffeln?|aardappel(?:en|s)?|potatis|ziemniak(?:i)?|patates|batatas?)$', 'i'),
    // "rolled oats", "oat flakes" and "brown rice" are the same whole grain as "oats" and "rice".
    /^(organic )?(?:(?:brown|white|wild|basmati|jasmine|long[- ]grain|short[- ]grain|whole ?grain|wholegrain) )?(rice|quinoa|buckwheat|(?:(?:rolled|whole|porridge|steel[- ]cut|jumbo|old[- ]fashioned|whole ?grain|wholegrain|gluten[- ]free) )*(?:oats|oat flakes))$/i,
    /^(black |white |cayenne )?pepper$/i,
    /^(?:(?:zwarte |witte )?peper|pepe(?: nero| bianco)?|(?:schwarzer |wei[ßs]er )?pfeffer|poivre(?: noir| blanc)?|pimienta(?: negra| blanca)?|pimenta(?: preta| branca|-do-reino)?|(?:svart|vit)?peppar|pieprz(?: czarny| bia[łl]y)?|karabiber)$/i,
    // An animal food alone, in each label language, as the English lines above read "chicken breast"
    // or "whole milk". Anchored to the whole entry, so "chocolat au lait" and "bouillon de poulet" are not.
    new RegExp('^(?:(?:bio|volle|halfvolle|magere|tam ya[ğg]l[ıi]|ya[ğg]l[ıi]|ya[ğg]s[ıi]z|past[öo]riserad|pasteurisierte|gepasteuriseerde|past[öo]rize|frais|fra[îi]che|frisch[e]?|fresc[oa]|vers[e]?|f[äa]rsk|[śs]wie[żz]\\w*|taze|filet de|blanc de|cuisse de|pechuga de|petto di|pier[śs] z)\\s+)*(?:b(?:œ|oe)uf|bovin|rindfleisch\\w*|rinder\\w*|rinds\\w*|kalb\\w*|ternera|vacuno|carne de res|manzo|vitello|rundvlees|rundsvlees|runder\\w*|rundergehakt|kalfs?vlees|n[öo]tk[öo]tt|kalv\\w*|wo[łl]owin\\w*|ciel[ęe]cin\\w*|s[ıi][ğg][ıi]r(?: eti)?|dana eti|carne bovina|vitela|novilho|porc|jambon|saucisses?|schwein\\w*|schinken|cerdo|jam[óo]n|maiale|salsicci[ae]|varkens?\\w*|fl[äa]sk\\w*|skinka|wieprzow\\w*|szynk[ai]|boczek|porco|presunto|toucinho|lingui[çc]a|poulet|dinde|canard|volaille|h[äa]hnchen\\w*|huhn|h[üu]hner\\w*|pute\\w*|truthahn|ente|gefl[üu]gel|pollo|pavo|pato|tacchino|anatra|kip(?:filet|pendij)?|kippen\\w*|kalkoen|eend|gevogelte|kyckling\\w*|kalkon|anka|kurczak\\w*|kurcz[ęe]\\w*|indyk\\w*|kaczk\\w*|dr[óo]b|tavuk(?: \\w+)?|hindi eti|[öo]rdek|frango|agneau|mouton|lamm\\w*|schaf\\w*|cordero|cabra|agnello|capra|lamsvlees|jagni[ęe]cin\\w*|baranin\\w*|kuzu(?: eti)?|koyun eti|borrego|cordeiro|(?:œ|oe)ufs?(?: entiers?| frais)?|eier|ei|huevos?|uov[ao]|eieren|[äa]gg|jaj(?:a|ka)|yumurta|ovos?|saumon|thon|cabillaud|crevettes?|lachs\\w*|thunfisch\\w*|kabeljau|garnelen?|salm[óo]n|salmone|at[úu]n|bacalao|gambas?|tonno|merluzzo|gamber[io]|zalm|tonijn|kabeljauw|garnalen?|lax|tonfisk|torsk|r[äa]kor|[łl]oso[śs]\\w*|tu[ńn]czyk\\w*|dorsz\\w*|krewetk\\w*|somon|ton bal[ıi][ğg][ıi]|morina|karides|salm[ãa]o|atum|bacalhau|camar[ãa]o|sardines?|sardinas?|sardinen|sardynk\\w*|sardalya|sardinhas?|maquereau|caballa|sgombro|makreel|makrill|makrel\\w*|uskumru|cavala|truites?|truchas?|trota|forellen?|forel|[öo]ring|pstr[ąa]g\\w*|alabal[ıi]k|truta|lait|cr[èe]me|beurre|fromage|yaourt|milch|(?:voll|mager|frisch|alpen|heu|weide|roh|bergbauern)milch|sahne|k[äa]se|joghurt|leche|nata|mantequilla|queso|yogur|latte|panna|burro|formaggio|melk|room|boter|kaas|(?:hel|skum|mellan|l[äa]tt|standard)?mj[öo]lk|gr[äa]dde|sm[öo]r|ost|mleko|[śs]mietan\\w*|mas[łl]o|ser|jogurt|s[üu]t|krema|tereya[ğg][ıi]|peynir|(?:pastörize )?inek s[üu]t[üu]|yo[ğg]urt|leite|manteiga|queijo|iogurte)(?:\\s+(?:frais|fra[îi]che|entier|enti[èe]re|hach[ée]e?|frisch|fresc[oa]|enter[oa]|inter[oa]|hele|f[äa]rsk|taze|inteir[oa]|pasteuris[ée]e?|pastorizad[oa]|pastorizzat[oa]|pasteurisiert[e]?|gepasteuriseerd[e]?|past[öo]riserad|pasteryzowane|past[öo]rize|pasteurizad[oa]|maigre|pe[łl]ne|odt[łl]uszczone|[ée]cr[ée]m[ée]e?|demi-[ée]cr[ée]m[ée]e?|desnatad[oa]|semidesnatad[oa]|scremat[oa]|parzialmente scremat[oa]|filets?|filé|brust|breast|g[öo]ğs[üu]|picad[ao]|macinat[oa]|gehakt|mald|mielon[ay]|k[ıi]yma))*$', 'i'),
    // The same single foods in each label language. Without these "amandes" or "flocons d'avoine"
    // scored 90 as NOVA 2 where "almonds" and "oats" score 96 as NOVA 1.
    /^(?:bio |biologique |ecol[óo]gic[oa] |organic |[öo]ko |eko )?(?:eau|agua|acqua|wasser|vatten|woda|su|[áa]gua|eau min[ée]rale naturelle|agua mineral natural|acqua minerale naturale|nat[üu]rliches mineralwasser|natuurlijk mineraalwater)$/i,
    /^(?:flocons d['’] ?avoine(?: compl[èe]te)?|avoine|copos de avena(?: integral)?|avena|fiocchi d['’] ?avena(?: integrale)?|haferflocken|hafer|havervlokken|haver|havregryn|havre|p[łl]atki owsiane|owies|yulaf(?: ezmesi)?|flocos de aveia|aveia)$/i,
    /^(?:riz(?: complet)?|arroz(?: integral)?|riso(?: integrale)?|reis|vollkornreis|rijst|ris|fullkornsris|ry[żz]|pirin[çc]|sarrasin|trigo sarraceno|grano saraceno|buchweizen|boekweit|bovete|gryka|karabu[ğg]day|trigo-sarraceno|quinoa|quinua|kinoa)$/i,
    /^(?:(?:blanchierte|ger[öo]stete|gehackte|gemahlene|gehobelte|halbe|blanszowane|pra[żz]one|pokrojone)\s+)?(?:amandes?|almendras?|mandorle|mandeln|mandelkerne|walnusskerne|haselnusskerne|paran[üu]sskerne|pekann[üu]sskerne|macadamian[üu]sskerne|amandelen|mandlar|migda[łl]y|badem|am[êe]ndoas|noisettes|avellanas|nocciole|haseln[üu]sse|hazelnoten|hasseln[öo]tter|orzechy laskowe|f[ıi]nd[ıi]k|avel[ãa]s|noix|nueces|noci|waln[üu]sse|walnoten|valn[öo]tter|orzechy w[łl]oskie|ceviz|nozes|noix de cajou|anacardos?|anacardi|noci di acagi[ùu]|orzechy nerkowca|cashewkerne|cashewnoten|cashewn[öo]tter|nerkowce|kaju|castanhas? de caju|caju)(?:\s+(?:d[ée]cortiqu[ée]e?s|mond[ée]e?s|blanchies|enti[èe]re?s|pelad[ao]s|tostad[ao]s|grill[ée]e?s|pelate|sgusciat[ei]|tostat[ei]|gesch[äa]lt(?:e)?|blanchiert(?:e)?|ger[öo]stet(?:e)?|gepeld(?:e)?|geroosterd(?:e)?|skalade|rostade|blancherade|obrane|pra[żz]one|kabuklu|kabuksuz|kavrulmu[şs]|descascad[ao]s|torrad[ao]s))?$/i,
    /^(?:lentilles|lentejas|lenticchie|linsen|linzen|linser|soczewica|mercimek|lentilhas|pois chiches|garbanzos|ceci|kichererbsen|kikkererwten|kik[äa]rtor|ciecierzyca|nohut|gr[ãa]o[- ]de[- ]bico)$/i,
    // Peanuts, the other nuts and the common seeds, which "peanuts" and "pumpkin seeds" already are:
    // "Erdnüsse, Palmöl, Salz" was NOVA 3 at 80 where "peanuts, palm oil, salt" is NOVA 2 at 90. A
    // roasted or salted form is the same food, as "roasted peanuts" is.
    new RegExp('^(?:(?:gr?ill[ée]e?s|torr[ée]fi[ée]e?s|tostad[oa]s|tostat[ei]|torrad[oa]s|ger[öo]stete|geroosterde|rostade|pra[żz]one|kavrulmu[şs]|sal[ée]e?s|salad[oa]s|salat[ei]|gesalzene|gezouten|saltade|solone|tuzlu)\\s+)?'
      + '(?:cacahu[èe]tes?|arachides?|cacahuetes?|man[íi]|arachidi|erdn[üu]sse|pinda(?:[\'’]?s)?|aardnoten|jordn[öo]tter|orzeszki ziemne|orzechy arachidowe|yer f[ıi]st[ıi][ğg][ıi]|amendoi[mn]s?'
      + '|pistaches?|pistachos?|pistacchi|pistazien(?:kerne)?|pistachenoten|pistaschn[öo]tter|pistacje|antep f[ıi]st[ıi][ğg][ıi]|pist[áa]chios?|pist[áa]cios?'
      + '|noix de p[ée]can|nueces pecanas?|noci pecan|pekann[üu]sse|pecannoten|pekann[öo]tter|orzechy pekan|pekan cevizi|nozes? pec[ãa]'
      + '|noix du br[ée]sil|nueces de brasil|noci del brasile|paran[üu]sse|paranoten|paran[öo]tter|orzechy brazylijskie|brezilya f[ıi]nd[ıi][ğg][ıi]|castanhas?[- ]do[- ]par[áa]'
      + '|pignons?(?: de pin)?|pi[ñn]ones|pinoli|pinienkerne|pijnboompitten|pinjen[öo]tter|orzeszki piniowe|[çc]am f[ıi]st[ıi][ğg][ıi]|pinh[õo]es'
      + '|noix de macadamia|nueces de macadamia|noci di macadamia|macadamian[üu]sse|macadamianoten|macadamian[öo]tter|orzechy makadamia|makadamya|nozes de macad[âa]mia'
      + '|graines de (?:tournesol|courge|citrouille|chia|lin|s[ée]same|chanvre)|semillas de (?:girasol|calabaza|ch[íi]a|lino|s[ée]samo|c[áa][ñn]amo)|pipas de girasol'
      + '|semi di (?:girasole|zucca|chia|lino|sesamo|canapa)|sonnenblumenkerne|k[üu]rbiskerne|leinsamen|sesam(?:saat)?|chiasamen|hanfsamen'
      + '|zonnebloempitten|pompoenpitten|lijnzaad|sesamzaad|chiazaad|hennepzaad|solrosfr[öo]n?|pumpafr[öo]n?|linfr[öo]n?|sesamfr[öo]n?|chiafr[öo]n?|hampafr[öo]n?'
      + '|(?:pestki|nasiona) (?:dyni|s[łl]onecznika)|siemi[ęe] lniane|sezam|nasiona (?:chia|sezamu|lnu)|ay[çc]i[çc]e[ğg]?[ıi]? [çc]ekirde[ğg]i|kabak [çc]ekirde[ğg]i|keten tohumu|susam|chia tohumu'
      + '|sementes de (?:girassol|ab[óo]bora|chia|linha[çc]a|s[ée]samo|c[âa]nhamo)|linha[çc]a)'
      + '(?:\\s+(?:gr?ill[ée]e?s|torr[ée]fi[ée]e?s|tostad[oa]s|tostat[ei]|torrad[oa]s?|sal[ée]e?s|salad[oa]s|salat[ei]|d[ée]cortiqu[ée]e?s|pelad[oa]s|sgusciat[ei]|descascad[oa]s|entier(?:e?s)?|enter[oa]s|inter[ei]|inteir[oa]s)){0,2}$', 'i'),
    /^(cinnamon|turmeric|ginger|paprika|cumin|coriander|oregano|basil|thyme|rosemary|garlic powder|onion powder)$/i,
    // The same spices and herbs in each label language ("cannelle" was NOVA 2 where "cinnamon" is 1).
    new RegExp('^(?:cannelle|canela|cannella|zimt|kaneel|kanel|cynamon|tar[çc][ıi]n'
      + '|curcuma|c[úu]rcuma|kurkuma|gurkmeja|zerde[çc]al|a[çc]afr[ãa]o-da-terra'
      + '|gingembre|jengibre|zenzero|ingwer|gember|ingef[äa]ra|imbir|zencefil|gengibre|piment[óo]n'
      + '|cumin|comino|cumino|cominho|kreuzk[üu]mmel|komijn|spiskummin|kmin(?: rzymski)?|kimyon'
      + '|coriandre|coriandolo|coentro|koriander|kolendra|ki[şs]ni[şs]'
      + '|origan|or[ée]gano|origano|oregano|basilic|albahaca|basilico|basilikum|basilicum|basilika|bazylia|fesle[ğg]en|manjeric[ãa]o'
      + '|thym|tomillo|timo|thymian|tijm|timjan|tymianek|kekik|tomilho|romarin|romero|rosmarino|rosmarin|rozemarijn|rozmaryn|biberiye|alecrim'
      + "|poudre d['’] ?(?:oignon|ail)|(?:cebolla|ajo) en polvo|(?:zwiebel|knoblauch)pulver|(?:cipolla|aglio) in polvere|(?:uien|knoflook)poeder"
      + '|(?:cebola|alho) em p[óo]|(?:l[öo]k|vitl[öo]ks?)pulver|(?:cebula|czosnek) w proszku|(?:so[ğg]an|sar[ıi]msak) tozu)$', 'i'),
  ];

  // Culinary ingredients — NOVA 2. Real foods, but extracted/concentrated.
  // With the same staples in each label language: "sucre, sel" scored 63 as NOVA 3 where "sugar,
  // salt" scores 73 as NOVA 2, because only the English words were culinary ingredients.
  const CULINARY = new RegExp('^(extra virgin |virgin |cold[- ]pressed |organic |raw )*(?:olive oil|avocado oil|coconut oil|butter|ghee|tallow|lard|honey|maple syrup|sea salt|salt|vinegar|apple cider vinegar|cream|sugar'
    + "|aceite de oliva(?: virgen(?: extra)?)?|huile d['’]olive(?: vierge(?: extra)?)?|oliven[öo]l|olio (?:extra vergine )?d['’]? ?oliva|olio (?:extra vergine )?di oliva|olijfolie|olivolja|oliwa z oliwek|zeytinya[ğg][ıi]|azeite(?: virgem(?: extra)?)?"
    + "|aceite de coco|huile de coco|kokos[öo]l|olio di cocco|kokosolie|kokosolja|olej kokosowy|[óo]leo de coco|hindistan cevizi ya[ğg][ıi]"
    + '|miel|honig|miele|mel|honing|honung|mi[óo]d|bal'
    + '|beurre|mantequilla|burro|boter|roomboter|sm[öo]r|mas[łl]o|tereya[ğg][ıi]|manteiga|saindoux|schmalz|strutto|manteca de cerdo|reuzel|ister|smalec|banha'
    + "|cr[èe]me(?: fra[îi]che)?|nata|panna|sahne|room|gr[äa]dde|[śs]mietan(?:a|ka)|krema|natas?"
    + '|sucre|az[úu]car|zucchero|zucker|suiker|socker|cukier|[şs]eker|a[çc][úu]car'
    + "|vinaigre(?: de cidre| de vin| d['’]alcool)?|vinagre(?: de vino| de manzana| de sidra| de [áa]lcool| de alcohol)?|aceto(?: di vino| di mele)?|(?:apfel|wein|branntwein)?essig|azijn|[äa]ttika|vin[äa]ger|ocet(?: jab[łl]kowy| spirytusowy)?|sirke"
    + "|sirop d['’][ée]rable|jarabe de arce|sciroppo d['’]acero|ahornsirup|ahornsiroop|l[öo]nnsirap|syrop klonowy|ak[çc]aa[ğg]a[çc] [şs]urubu|xarope de [áa]cer"
    + '|sel(?: marin| de mer| de gu[ée]rande| fin)?|fleur de sel|sal(?: marina| de mar| marinho)?|sale(?: marino)?|(?:speise|meer)?salz|(?:zee|keuken)?zout|(?:hav)?salt|s[óo]l(?: morska)?|(?:deniz |kaya )?tuzu?|flor de sal)$', 'i');

  // Signals of NOVA 3 processing — real food, meaningfully transformed. The English words alone
  // meant "cacahuetes tostados" was NOVA 2 where "roasted peanuts" is NOVA 3, and "lait
  // pasteurisé, ferments lactiques" or "Sauerteig" signalled nothing. Explicit boundaries, because
  // \b does not see the accented letters these words start and end with.
  const PROCESSED_SIGNAL = new RegExp(PL + '(?:' + [
    'cultured|fermented|smoked|cured|canned|celery (?:juice )?powder|cheese cultures|rennet|yeast|sourdough|brined|pickled|roasted|dried',
    // fermented, as an adjective: the nouns ("ferments", "Kulturen") are English "cultures", which
    // is not a signal either
    'ferment[ée]e?s?|fermentad[oa]s?|fermentat[oaie]|fermentiert[a-z]*|gefermenteerd[a-z]*|fermenterad[a-z]*|fermentowan[a-zęąó]*|fermente|kiszon[a-zęąó]*',
    // smoked and cured
    'fum[ée]e?s?|ahumad[oa]s?|affumicat[oaie]|ger[äa]uchert[a-z]*|gerookt[a-z]*|rökt[a-z]*|w[ęe]dzon[a-zęąó]*|füme|fumad[oa]s?|curad[oa]s?|stagionat[oaie]',
    // rennet
    'pr[ée]sure|cuajo|caglio|stremsel|löpe|ystenzym|podpuszczk[a-zęąó]*|peynir mayas[ıi]|coalho|labferment',
    // yeast and sourdough
    'levures?|levaduras?|leveduras?|lievit[oi]|(?:back|bier|trocken)?hefe[a-z]*|gist(?:extract)?|jäst[a-z]*|dro[żz]d[żz][a-zęąó]*|maya|fermento biol[óo]gico',
    'levain|masa madre|lievito madre|(?:roggen|weizen|dinkel|natur)?[- ]?sauerteig[a-z]*|zuurdesem|surdeg|zakwas(?:u|ie|em)?|ek[şs]i maya|massa m[ãa]e',
    // brined and pickled
    'saumure|salmuera|salamoia|salzlake|pekel|salmoura|salamura|encurtid[oa]s?|sott[\'’]?aceto|eingelegt[a-z]*|ingelegd[a-z]*|inlagd[a-z]*|marynowan[a-zęąó]*|tur[şs]u',
    // roasted
    'grill[ée]e?s?|torr[ée]fi[ée]e?s?|r[ôo]ti(?:e|s|es)?|tostad[oa]s?|tostat[oaie]|torrad[oa]s?|ger[öo]stet[a-z]*|geroosterd[a-z]*|rostad[a-z]*|pra[żz]on[a-zęąó]*|kavrulmu[şs][a-zıüş]*',
    // dried
    's[ée]ch[ée]e?s?|d[ée]shydrat[ée]e?s?|desidratad[oa]s?|deshidratad[oa]s?|disidratat[oaie]|secc(?:o|a|hi|he)|sec[oa]s?|getrocknet[a-z]*|gedroogd[a-z]*|torkad[a-z]*|suszon[a-zęąó]*|kurutulmu[şs][a-zıüş]*',
  ].join('|') + ')' + PR, 'i');

  // Dairy processing penalties. Weighted by the 'dairyProcessing' category.
  const DAIRY_PENALTY = [
    { pts: 8, why: 'Ultra-pasteurized dairy', m: /\bultra[- ]?(pasteurized|filtered|high temperature)\b|\buht\b/i },
    { pts: 5, why: 'Homogenized dairy',       m: /\bhomogenized\b/i },
    // The noun list matters: "lowfat kefir" and "low fat cottage cheese" were not fat-reduced
    // dairy as far as this rule was concerned, because only milk/dairy/yogurt/cheese counted.
    // Up to two words may sit between the qualifier and the noun: "nonfat dry milk",
    // "part-skim mozzarella cheese", "reduced fat sharp cheddar cheese". "1% milk" never matched: `\b` cannot
    // follow a "%". UK labels say "skimmed" and
    // "semi-skimmed", which read as full fat.
    { pts: 6, why: 'Fat-reduced dairy', cat: 'reducedFatDairy', m: new RegExp(/\b(non[- ]?fat|fat[- ]?free|skim(?:med)?|semi[- ]?skimmed|low[- ]?fat|lowfat|reduced[- ]?fat|part[- ]?skim|[12](?=%))\b%?(?:[\s-]+[\w'’]+){0,2}[\s-]+(milk|dairy|yogh?urt|cheese|kefir|cream|buttermilk|ricotta|cheddar|mozzarella)\b/.source
      // The same in each store language: Magermilch, lait écrémé, leche desnatada, latte scremato, magere melk,
      // leite desnatado, skummjölk, mleko odtłuszczone, yağsız süt.
      + '|\\b(?:mager|entrahmt)\\w*(?:milch|joghurt|quark)|\\bmagermilch|\\blait (?:demi[- ]?)?[ée]cr[ée]m[ée]|\\bleche (?:semi)?(?:desnatada|descremada)'
      + '|\\blatte (?:parzialmente )?scremato|\\bmagere (?:melk|yoghurt|kwark)|\\bleite (?:semi)?desnatado|\\bleite magro|\\bskummj[öo]lk|\\bl[äa]ttmj[öo]lk'
      + '|\\bmlek[oa] (?:odt[łl]uszczon\\w*|chude)|\\bya[ğg]s[ıi]z (?:inek )?s[üu]t|\\by[aâ]r[ıi]m ya[ğg]l[ıi] (?:inek )?s[üu]t'
      // With a word between the milk and the fat level ("leche en polvo desnatada", "leite em pó
      // desnatado", "lait concentré écrémé"), the reverse order ("odtłuszczone mleko") and Dutch fused by
      // Open Food Facts markup ("magere_melk_poeder" → "mageremelkpoeder").
      + '|\\b(?:leche|leite|lait|latte)(?: [a-zß-ÿ]{1,12}){1,2} (?:(?:semi)?desnatad[ao]|descremad[ao]|[ée]cr[ée]m[ée]e?|scremat[oa]|magro)(?![a-zß-ÿ])'
      + '|(?<![a-zß-ÿ\\u0100-\\u017f])odt[łl]uszczon[a-zęąó]* mlek[oa]|\\bmagere ?melk[a-z]*|\\b(?:yaourt|fromage blanc|fromage frais|faisselle|lait) maigre|\\bskummj[öo]lk[a-zåäö]*', 'i') },
  ];

  // Full-fat dairy, for the fat-reduced dairy rule above. A whole-milk kefir with some nonfat milk
  // added ("pasteurized organic milk, organic nonfat milk, pectin…") is not a fat-reduced product:
  // ingredients are listed by weight, so when full-fat dairy comes first the product is mostly
  // full fat (8 g fat in a 150-calorie bottle, in the Lifeway case). It was scored as fat-reduced
  // either way: a processing penalty by default and a +15 "a plus for your goals" under Weight loss.
  // Plain "milk" is whole milk on a US label. Plant milks and milk fractions (protein, powder
  // without "whole", whey, lactose…) are not counted as full-fat dairy.
  // With the same words in each label language, tested on one entry at a time. Without them
  // "LAIT entier, lait écrémé" was charged as fat-reduced dairy that "whole milk, skimmed milk" is not.
  // German and Swedish compounds ("Vollmilchpulver", "helmjölk") carry the words inside them.
  const DAIRY_NOUN = inLanguages(/\b(milk|cream|kefir|yogh?urt|cheese|buttermilk)\b/i, [
    'lait', 'cr[èe]me', 'yaourt', 'fromage', 'leche', 'nata', 'yogur', 'queso', 'latte', 'panna', 'yogurt', 'formaggio', 'leite', 'natas?',
    'iogurte', 'queijo', '[a-zäöü]*milch[a-zäöü]*', 'sahne', 'joghurt', 'k[äa]se', '(?:volle ?|magere ?|halfvolle ?)?melk(?:poeder|room|vet)?', 'room', 'kaas', '[a-zåäö]*mj[öo]lk[a-zåäö]*',
    'gr[äa]dde', 'ost', 'mleko', 'mleka', '[śs]mietan(?:a|ka)', 'jogurt', 'ser', 's[üu]t', 'krema', 'yo[ğg]urt', 'peynir', 'k[ée]fir']);
  const NOT_FULL_FAT_DAIRY = inLanguages(/\b(protein|isolate|concentrate|solids|powder|permeate|whey|casein(?:ate)?|lactose|minerals?|coconut|almond|oat|soy|soya|rice|cashew|hemp|pea|macadamia|chocolate|substitute|non[- ]?dairy|dairy[- ]?free|plant)\b/i, [
    'poudre', 'polvo', 'polvere', 'p[óo]', '[a-zäöü]*pulver', 'poeder', '[a-z]*poeder', 'proszku', 'toz(?:u)?', 'prot[ée]ines?', 'prote[íi]nas?', 'proteine',
    'eiwei(?:ss|[ßs])', 'eiwit', 'bia[łl]k[ao]', 'lactos[ée]rum', 'petit[- ]lait', 'suero', 'siero', 'soro', '[a-zäöü]*molke[a-zäöü]*', 'wei(?:poeder)?', 'vassle[a-z]*',
    'serwatk[ai]', 'peyniralt[ıi]', 'lactosa', 'lattosio', 'laktose', 'laktos', 'laktoz[ay]?', 'coco', 'cocco', 'kokos[a-z]*', 'hindistan cevizi', 'amandes?',
    'almendras?', 'mandorl[ae]', 'am[êe]ndoas?', 'mandel[a-z]*', 'amandel[a-z]*', 'migda[łl][a-zęąó]*', 'badem', 'avoine', 'avena', 'aveia', 'hafer[a-z]*', 'haver[a-z]*',
    'havre[a-z]*', 'owsian[a-zęąó]*', 'yulaf', 'soja', 'soia', 'sojow[a-zęąó]*', 'riz', 'arroz', 'riso', 'reis', 'rijst', 'ris', 'ry[żz]', 'pirin[çc]',
    'chocolat', 'cioccolato', '[a-zäöü]*schokolade', '[a-z]*chocolade', 'choklad', 'czekolad[a-zęąó]*', '[çc]ikolata', 'concentr[ée]', 'concentrad[oa]', 'concentrat[oa]',
    '[a-zäöü]*konzentrat', '[a-z]*concentraat', 'koncentrat']);
  const FULL_FAT_WORD = inLanguages(/\b(whole|full[- ]fat|full[- ]cream)\b/i, [
    'enti[èe]re?s?', 'entera', 'intero', 'inteiro', 'integral', 'voll[a-zäöü]*', 'volle', 'vollemelk[a-z]*', 'gordo', 'gorda', 'hel[a-zåäö]*', 'pe[łl]n[a-zęąó]*', 'tam ya[ğg]l[ıi]']);
  function isFullFatDairy(ing) {
    const s = String(ing || '');
    if (!DAIRY_NOUN.test(s)) return false;
    if (DAIRY_PENALTY.some(r => r.cat === 'reducedFatDairy' && r.m.test(s))) return false;
    return FULL_FAT_WORD.test(s) || !NOT_FULL_FAT_DAIRY.test(s);
  }
  // The title settles it too: "Whole Milk Kefir", "Full Fat Greek Yogurt".
  const FULL_FAT_TITLE = /\b(whole[- ]milk|full[- ]fat|full[- ]cream|whole[- ]fat)\b/i;

  const _exports = AIRmodule('labels', {
    BONUSES, BONUS_CAP, TITLE_BONUS_CAP, WHOLE, CULINARY, PROCESSED_SIGNAL, DAIRY_PENALTY,
    isFullFatDairy, FULL_FAT_TITLE,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
