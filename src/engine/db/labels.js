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

  const BONUSES = [
    { pts: 12, cat: 'animalWelfare', why: '100% grass-fed / grass-finished', m: /\bgrass[- ]?(fed|finished)\b/i },
    { pts: 10, cat: 'animalWelfare', why: 'Pasture-raised',              m: /\bpasture[- ]?(raised|fed)\b/i },
    { pts: 10, cat: 'animalWelfare', why: 'Wild-caught',                 m: /\bwild[- ]?(caught|harvested)\b/i },
    { pts:  8, cat: 'organic', why: 'Certified organic',                 m: /\b(certified )?organic\b/i },
    { pts:  8, cat: 'dairyProcessing', why: 'Raw / unpasteurised dairy', m: /\braw (milk|cream|cheese|dairy|butter)\b|\bunpasteurized\b/i },
    { pts:  7, cat: 'animalWelfare', why: 'Regeneratively farmed',       m: /\bregenerativ(e|ely)\b/i },
    { pts:  6, cat: 'fermented', why: 'Fermented / live cultures',       m: /\b(cultured|fermented|live active cultures|probiotic|kefir|kimchi|sauerkraut)\b/i },
    { pts:  6, cat: 'unrefined', why: 'Minimally refined cooking fat', m: /(?<!peanut |almond |cashew |sunflower |seed |nut |cocoa |shea |apple |soy )\b(butter|ghee|tallow|lard|suet|duck fat|coconut oil|olive oil|avocado oil)\b|\b(aceite de (?:oliva|coco)|huile d['’]olive|huile de coco|oliven[öo]l|kokos[öo]l|olio d['’]oliva|olio di cocco|mantequilla|beurre(?!\s+de\s+cacao)|(?<!cacao )burro(?!\s+di\s+cacao))\b/i },
    { pts:  5, cat: 'dairyProcessing', why: 'A2 dairy',                  m: /\ba2\b/i },
    { pts:  5, cat: 'traditionalPrep', why: 'Sourdough / sprouted grain', m: /\b(sourdough|sprouted|naturally leavened|einkorn|soaked)\b/i },
    { pts:  5, cat: 'nonGmo', why: 'Non-GMO verified',                   m: /\bnon[- ]?gmo\b/i },
    { pts:  5, cat: 'unrefined', why: 'Unrefined salt',                  m: /\b(sea salt|redmond|celtic|real salt|himalayan salt)\b/i },
    { pts:  4, cat: 'animalWelfare', why: 'Heritage / heirloom breed',   m: /\b(heritage|heirloom|berkshire|wagyu)\b/i },
    { pts:  4, cat: 'traditionalPrep', why: 'Dry-aged / traditionally cured', m: /\bdry[- ]?(aged|cured)\b/i },
    { pts:  3, cat: 'unrefined', why: 'Cold-pressed / unrefined',        m: /\b(cold[- ]pressed|expeller[- ]pressed|unrefined|first press)\b/i },
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
    new RegExp('^[\\w\' -]{0,28}\\b(beef|bison|lamb|mutton|goat|venison|elk|pork|chicken|turkey|duck)\\b' + DERIVED, 'i'),
    new RegExp('^[\\w\' -]{0,24}\\b(salmon|tuna|sardines?|anchov(y|ies)|mackerel|cod|halibut|trout|herring|shrimp|oysters?|mussels?)\\b' + DERIVED, 'i'),
    /^(organic |pasture[- ]?raised )*(eggs?|egg yolks?|egg whites?)$/i,
    new RegExp('^[\\w\' -]{0,24}' + NOT_DAIRY + '\\b(milk|cream|butter|ghee|yogh?urt|kefir|cheese|cheddar|mozzarella|parmesan)\\b' + DERIVED + '(?!\\s+of\\s+tartar)', 'i'),
    /^(beef |chicken |pork )?(liver|heart|kidney|bone marrow|tripe|sweetbreads)\b/i,
    /^(organic )?(water|sea salt|salt)$/i,
    /^(organic |raw )*(honey|maple syrup)$/i,
    /^(organic |raw |dry[- ]roasted |roasted |unsalted |salted |whole |shelled )*(almonds?|walnuts?|pecans?|macadamias?|pistachios?|cashews?|hazelnuts?|peanuts?|pine nuts?|brazil nuts?|(?:pumpkin|sunflower|chia|flax|hemp|sesame) ?seeds?|flaxseed)$/i,
    /^(organic |dried |cooked )*(lentils?|chickpeas?|(?:black|kidney|pinto|navy|cannellini|garbanzo|white|red) beans?|split peas|edamame)$/i,
    /^(organic )?(apples?|bananas?|berries|blueberries|strawberries|oranges?|dates?|figs?|raisins?)$/i,
    /^(organic )?(spinach|kale|broccoli|carrots?|onions?|garlic|tomatoes?|potatoes?|sweet potatoes?)$/i,
    /^(organic )?(rice|quinoa|oats|buckwheat)$/i,
    /^(black |white |cayenne )?pepper$/i,
    // An animal food alone, in each label language, as the English lines above read "chicken breast"
    // or "whole milk". Anchored to the whole entry, so "chocolat au lait" and "bouillon de poulet" are not.
    new RegExp('^(?:(?:bio|frais|fra[îi]che|frisch[e]?|fresc[oa]|vers[e]?|f[äa]rsk|[śs]wie[żz]\\w*|taze|filet de|blanc de|cuisse de|pechuga de|petto di|pier[śs] z)\\s+)*(?:b(?:œ|oe)uf|bovin|rindfleisch\\w*|rinder\\w*|rinds\\w*|kalb\\w*|ternera|vacuno|carne de res|manzo|vitello|rundvlees|rundsvlees|runder\\w*|rundergehakt|kalfs?vlees|n[öo]tk[öo]tt|kalv\\w*|wo[łl]owin\\w*|ciel[ęe]cin\\w*|s[ıi][ğg][ıi]r(?: eti)?|dana eti|carne bovina|vitela|novilho|porc|jambon|saucisses?|schwein\\w*|schinken|cerdo|jam[óo]n|maiale|salsicci[ae]|varkens?\\w*|fl[äa]sk\\w*|skinka|wieprzow\\w*|szynk[ai]|boczek|porco|presunto|toucinho|lingui[çc]a|poulet|dinde|canard|volaille|h[äa]hnchen\\w*|huhn|h[üu]hner\\w*|pute\\w*|truthahn|ente|gefl[üu]gel|pollo|pavo|pato|tacchino|anatra|kip(?:filet|pendij)?|kippen\\w*|kalkoen|eend|gevogelte|kyckling\\w*|kalkon|anka|kurczak\\w*|kurcz[ęe]\\w*|indyk\\w*|kaczk\\w*|dr[óo]b|tavuk(?: \\w+)?|hindi eti|[öo]rdek|frango|agneau|mouton|lamm\\w*|schaf\\w*|cordero|cabra|agnello|capra|lamsvlees|jagni[ęe]cin\\w*|baranin\\w*|kuzu(?: eti)?|koyun eti|borrego|cordeiro|(?:œ|oe)ufs?(?: entiers?| frais)?|eier|ei|huevos?|uov[ao]|eieren|[äa]gg|jaj(?:a|ka)|yumurta|ovos?|saumon|thon|cabillaud|crevettes?|lachs\\w*|thunfisch\\w*|kabeljau|garnelen?|salm[óo]n|salmone|at[úu]n|bacalao|gambas?|tonno|merluzzo|gamber[io]|zalm|tonijn|kabeljauw|garnalen?|lax|tonfisk|torsk|r[äa]kor|[łl]oso[śs]\\w*|tu[ńn]czyk\\w*|dorsz\\w*|krewetk\\w*|somon|ton bal[ıi][ğg][ıi]|morina|karides|salm[ãa]o|atum|bacalhau|camar[ãa]o|sardines?|sardinas?|sardinen|sardynk\\w*|sardalya|sardinhas?|maquereau|caballa|sgombro|makreel|makrill|makrel\\w*|uskumru|cavala|truites?|truchas?|trota|forellen?|forel|[öo]ring|pstr[ąa]g\\w*|alabal[ıi]k|truta|lait|cr[èe]me|beurre|fromage|yaourt|milch|sahne|k[äa]se|joghurt|leche|nata|mantequilla|queso|yogur|latte|panna|burro|formaggio|melk|room|boter|kaas|mj[öo]lk|gr[äa]dde|sm[öo]r|ost|mleko|[śs]mietan\\w*|mas[łl]o|ser|jogurt|s[üu]t|krema|tereya[ğg][ıi]|peynir|yo[ğg]urt|leite|manteiga|queijo|iogurte)(?:\\s+(?:frais|fra[îi]che|entier|enti[èe]re|hach[ée]e?|frisch|fresc[oa]|enter[oa]|inter[oa]|hele|f[äa]rsk|taze|inteir[oa]|pasteuris[ée]e?|pastorizad[oa]|pastorizzat[oa]|pasteurisiert[e]?|gepasteuriseerd[e]?|past[öo]riserad|pasteryzowane|past[öo]rize|pasteurizad[oa]|filets?|filé|brust|breast|g[öo]ğs[üu]|picad[ao]|macinat[oa]|gehakt|mald|mielon[ay]|k[ıi]yma))*$', 'i'),
    // The same single foods in each label language. Without these "amandes" or "flocons d'avoine"
    // scored 90 as NOVA 2 where "almonds" and "oats" score 96 as NOVA 1.
    /^(?:bio |biologique |ecol[óo]gic[oa] |organic |[öo]ko |eko )?(?:eau|agua|acqua|wasser|vatten|woda|su|[áa]gua|eau min[ée]rale naturelle|agua mineral natural|acqua minerale naturale|nat[üu]rliches mineralwasser|natuurlijk mineraalwater)$/i,
    /^(?:flocons d['’] ?avoine(?: compl[èe]te)?|avoine|copos de avena(?: integral)?|avena|fiocchi d['’] ?avena(?: integrale)?|haferflocken|hafer|havervlokken|haver|havregryn|havre|p[łl]atki owsiane|owies|yulaf(?: ezmesi)?|flocos de aveia|aveia)$/i,
    /^(?:riz(?: complet)?|arroz(?: integral)?|riso(?: integrale)?|reis|vollkornreis|rijst|ris|fullkornsris|ry[żz]|pirin[çc])$/i,
    /^(?:amandes?|almendras?|mandorle|mandeln|amandelen|mandlar|migda[łl]y|badem|am[êe]ndoas|noisettes|avellanas|nocciole|haseln[üu]sse|hazelnoten|hasseln[öo]tter|orzechy laskowe|f[ıi]nd[ıi]k|avel[ãa]s|noix|nueces|noci|waln[üu]sse|walnoten|valn[öo]tter|orzechy w[łl]oskie|ceviz|nozes|noix de cajou|anacardos|anacardi|cashewkerne|cashewnoten|cashewn[öo]tter|nerkowce|kaju|castanhas? de caju)$/i,
    /^(?:lentilles|lentejas|lenticchie|linsen|linzen|linser|soczewica|mercimek|lentilhas|pois chiches|garbanzos|ceci|kichererbsen|kikkererwten|kik[äa]rtor|ciecierzyca|nohut|gr[ãa]o[- ]de[- ]bico)$/i,
    /^(cinnamon|turmeric|ginger|paprika|cumin|coriander|oregano|basil|thyme|rosemary|garlic powder|onion powder)$/i,
  ];

  // Culinary ingredients — NOVA 2. Real foods, but extracted/concentrated.
  const CULINARY = /^(extra virgin |virgin |cold[- ]pressed |organic |raw )*(olive oil|avocado oil|coconut oil|butter|ghee|tallow|lard|honey|maple syrup|sea salt|salt|vinegar|apple cider vinegar|cream|sugar|aceite de oliva|huile d['’]olive|oliven[öo]l|olio d['’]oliva|aceite de coco|huile de coco|kokos[öo]l|olio di cocco|miel|honig|miele)$/i;

  // Signals of NOVA 3 processing — real food, meaningfully transformed.
  const PROCESSED_SIGNAL = /\b(cultured|fermented|smoked|cured|canned|pasteurized|celery (juice )?powder|cheese cultures|rennet|yeast|sourdough|brined|pickled|roasted|dried)\b/i;

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
    { pts: 6, why: 'Fat-reduced dairy', cat: 'reducedFatDairy', m: new RegExp(/\b(non[- ]?fat|fat[- ]?free|skim(?:med)?|semi[- ]?skimmed|low[- ]?fat|lowfat|reduced[- ]?fat|part[- ]?skim|[12](?=%))\b%?(?:[\s-]+\w+){0,2}[\s-]+(milk|dairy|yogh?urt|cheese|kefir|cream|buttermilk|ricotta|cheddar|mozzarella)\b/.source
      // The same in each store language: Magermilch, lait écrémé, leche desnatada, latte scremato, magere melk,
      // leite desnatado, skummjölk, mleko odtłuszczone, yağsız süt.
      + '|\\b(?:mager|entrahmt)\\w*(?:milch|joghurt|quark)|\\bmagermilch|\\blait (?:demi[- ]?)?[ée]cr[ée]m[ée]|\\bleche (?:semi)?(?:desnatada|descremada)'
      + '|\\blatte (?:parzialmente )?scremato|\\bmagere (?:melk|yoghurt|kwark)|\\bleite (?:semi)?desnatado|\\bleite magro|\\bskummj[öo]lk|\\bl[äa]ttmj[öo]lk'
      + '|\\bmlek[oa] (?:odt[łl]uszczon\\w*|chude)|\\bya[ğg]s[ıi]z s[üu]t|\\by[aâ]r[ıi]m ya[ğg]l[ıi] s[üu]t', 'i') },
  ];

  // Full-fat dairy, for the fat-reduced dairy rule above. A whole-milk kefir with some nonfat milk
  // added ("pasteurized organic milk, organic nonfat milk, pectin…") is not a fat-reduced product:
  // ingredients are listed by weight, so when full-fat dairy comes first the product is mostly
  // full fat (8 g fat in a 150-calorie bottle, in the Lifeway case). It was scored as fat-reduced
  // either way: a processing penalty by default and a +15 "a plus for your goals" under Weight loss.
  // Plain "milk" is whole milk on a US label. Plant milks and milk fractions (protein, powder
  // without "whole", whey, lactose…) are not counted as full-fat dairy.
  const DAIRY_NOUN = /\b(milk|cream|kefir|yogh?urt|cheese|buttermilk)\b/i;
  const NOT_FULL_FAT_DAIRY = /\b(protein|isolate|concentrate|solids|powder|permeate|whey|casein(?:ate)?|lactose|minerals?|coconut|almond|oat|soy|soya|rice|cashew|hemp|pea|macadamia|chocolate|substitute|non[- ]?dairy|dairy[- ]?free|plant)\b/i;
  const FULL_FAT_WORD = /\b(whole|full[- ]fat|full[- ]cream)\b/i;
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
