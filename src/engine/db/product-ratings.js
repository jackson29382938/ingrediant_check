// Category-specific label indices. Point weights are the app's disclosed rubric, not clinical
// effect sizes. Food rules never enter this module; missing functional/dose evidence declines.
//
// Three rating styles share one reading of the label:
//   evidence     what the label can establish: starts at 100 and is charged, as a food is, for what the
//                label shows (no function the category needs, fragrance, documented cautions); for
//                supplements a complete Supplement Facts panel with no serving above an adult upper limit
//   minimal      fewer declared ingredients is better, whatever they are
//   preferences  the reader's own avoid list, and nothing else
// A style never reads another's inputs, and none of them reads the food rules or the food weights.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js'); require('./ingestible.js'); require('./allergens.js');
}
(function () {
  const STYLES = ['evidence', 'minimal', 'preferences'];
  const styleOf = value => STYLES.includes(value) ? value : 'evidence';

  const CATEGORY_NAMES = {
    toothpaste: 'Toothpaste', mouthwash: 'Mouthwash', deodorant: 'Deodorant', shampoo: 'Shampoo',
    conditioner: 'Conditioner', 'body-wash': 'Body wash', moisturizer: 'Moisturizer', supplement: 'Supplement',
  };
  const CATEGORIES = Object.keys(CATEGORY_NAMES);
  // 'personal-care' is the unsupported products (sun care, makeup, a 2-in-1): named, never scored.
  const categoryName = category => CATEGORY_NAMES[category] || (category === 'personal-care' ? 'Personal care' : 'Food');

  // Display names. `translate(key, english)` is the caller's chrome.i18n lookup; without one the English
  // name is returned, so the engine and its tests never need a locale. Every key is in _locales
  // (tests/personal-care-label.test.js checks that each locale carries them).
  const CATEGORY_KEYS = {
    toothpaste: 'catToothpaste', mouthwash: 'catMouthwash', deodorant: 'catDeodorant', shampoo: 'catShampoo',
    conditioner: 'catConditioner', 'body-wash': 'catBodyWash', moisturizer: 'catMoisturizer', supplement: 'catSupplement',
  };
  const STYLE_NAMES = { evidence: 'Evidence-based', minimal: 'Minimal ingredients', preferences: 'Preference-focused' };
  const STYLE_KEYS = { evidence: 'styleEvidence', minimal: 'styleMinimal', preferences: 'stylePreferences' };
  const categoryLabel = (category, translate) => translate && CATEGORY_KEYS[category]
    ? translate(CATEGORY_KEYS[category], categoryName(category)) : categoryName(category);
  const styleLabel = (style, translate) => translate ? translate(STYLE_KEYS[styleOf(style)], STYLE_NAMES[styleOf(style)]) : STYLE_NAMES[styleOf(style)];
  // What a badge, a card and a tooltip call an index: "Shampoo · Evidence-based". Food has no caption here.
  const caption = (result, translate) => result && result.category && result.category !== 'food'
    ? [categoryLabel(result.category, translate), result.ratingStyle && result.ratingStyle !== 'food' ? styleLabel(result.ratingStyle, translate) : ''].filter(Boolean).join(' · ') : '';

  // ------------------------------------------------------------ functions each category needs
  // A cleansing surfactant is a head group on a fatty chain, and INCI writes both in dozens of
  // combinations ("Sodium Cocoyl Isethionate", "Ammonium Laureth Sulfate", "Coco-Glucoside",
  // "Sodium C14-16 Olefin Sulfonate"). The first list of literal names recognized fewer than half
  // of the sulfate-free shampoos tried, and declined them as having no cleansing ingredient.
  const SURFACTANT_HEAD = /(?:sulfate|sulphate|sulfonate|sulfosuccinate|sulfoacetate|isethionate|sarcosinate|taurate|glutamate|glycinate|carboxylate|betaine|sultaine|glucoside|amphoacetate|amphodiacetate|amphopropionate)\b/i;
  const SURFACTANT_CHAIN = /(?:laur|myrist|palm|coco|cocam|olefin|oleth|trideceth|decyl|capryl|c\d{2}-\d{2}|stearo|oleoyl|cetyl)/i;
  const surfactant = entry => SURFACTANT_HEAD.test(entry) && SURFACTANT_CHAIN.test(entry);
  const SOAP = /\b(?:sodium|potassium) (?:cocoate|coconutate|tallowate|palmate|palm kernelate|olivate|hempseedate|jojobate|castorate|avocadoate)\b/i;

  // A function is a pattern or a predicate over one declared ingredient. Fluoride is the
  // ingredient with the strongest documented benefit for toothpaste (ADA), cetylpyridinium chloride
  // and chlorhexidine for rinses, aluminum salts for antiperspirants, cleansing agents for
  // shampoo and soap, cationic and silicone conditioning agents for conditioner, and humectants,
  // emollients and occlusives for moisturizers (AAD).
  const FUNCTIONS = {
    toothpaste: [/\b(?:sodium fluoride|stannous fluoride|sodium monofluorophosphate|sodium mfp|amine fluoride|olaflur)\b/i],
    mouthwash: [/\b(?:sodium fluoride|stannous fluoride|cetylpyridinium|chlorhexidine|eucalyptol|thymol)\b/i],
    deodorant: [/\balumini?um (?:zirconium|chlorohydr|sesquichlorohydr|dichlorohydr|chloride|sulfate)/i,
      /\b(?:triethyl citrate|zinc ricinoleate|sodium bicarbonate|magnesium hydroxide|potassium alum|ammonium alum|alum|zinc phenolsulfonate)\b/i],
    shampoo: [surfactant],
    'body-wash': [surfactant, SOAP],
    conditioner: [/(?:behentrimonium|cetrimonium|steartrimonium|stearalkonium|distearyldimonium|dicetyldimonium|hydroxypropyltrimonium|behenamidopropyl|stearamidopropyl dimethylamine|\bquaternium-\d+|polyquaternium-\d+)/i,
      /\b(?:dimethicone|dimethiconol|amodimethicone|cyclopentasiloxane|cyclohexasiloxane|trimethylsilylamodimethicone)\b/i],
    moisturizer: [/\b(?:glycerin|glycerol|hyaluronic acid|sodium hyaluronate|urea|sodium pca)\b/i,
      /\b(?:petrolatum|petroleum jelly|mineral oil|paraffinum liquidum|dimethicone|ceramides?|shea butter|butyrospermum parkii|squalane|squalene|lanolin|colloidal oatmeal|avena sativa)\b/i],
  };
  const matches = (pattern, entry) => typeof pattern === 'function' ? pattern(entry) : pattern.test(entry);
  const NEEDS = {
    toothpaste: 'a fluoride ingredient',
    mouthwash: 'fluoride, cetylpyridinium chloride, chlorhexidine or an essential-oil active',
    deodorant: 'an antiperspirant salt or a recognized deodorizing ingredient',
    shampoo: 'a cleansing surfactant',
    'body-wash': 'a cleansing surfactant or soap',
    conditioner: 'a conditioning agent',
    moisturizer: 'a humectant, emollient or occlusive ingredient',
  };
  // What a label that shows no such ingredient costs. Fluoride is the one function with a documented health
  // effect (cavity prevention), so a toothpaste without it is charged most; a cleanser with no cleansing agent
  // is almost always a label read wrongly, so it is charged heavily too; a mouthwash, deodorant, conditioner or
  // moisturizer can be a legitimate cosmetic product, so the label is charged for not establishing its function.
  // This used to decline the product ("unavailable"), which skipped every natural deodorant.
  const FUNCTION_COST = { toothpaste: 30, mouthwash: 20, deodorant: 20, shampoo: 25, 'body-wash': 25, conditioner: 20, moisturizer: 20 };
  // The title promises an active ingredient the Drug Facts panel carries. A page that prints only the inactive
  // list leaves it out, and charging that as "no function" would punish the page's layout, not the product.
  const PROMISED_ACTIVE = {
    toothpaste: /\b(?:fluoride|anti-?cavity|cavity protection)\b/i,
    mouthwash: /\b(?:fluoride|anti-?cavity|anti-?septic|cetylpyridinium|cpc)\b/i,
    deodorant: /\banti-?perspirants?\b/i,
  };
  // A product that stays on the skin (the fragrance allergy literature names deodorants first) is charged
  // more for fragrance and for the leave-on irritants than a rinse-off one.
  const LEAVE_ON = ['deodorant', 'moisturizer'];
  const ORAL = ['toothpaste', 'mouthwash'];

  // ------------------------------------------------------------ cautions the label can establish
  // Only ingredients a regulator or a standard patch-test series has singled out, each charged
  // once however many of its relatives are listed. A claim in the listing's marketing copy
  // ("dermatologist tested", a seal in the title) is not label content and moves nothing here, for
  // the reason the food engine scores seller bullets at half weight.
  //
  // `c` is the charge. 15 is an ingredient a regulator has prohibited in cosmetics or classed as a human
  // carcinogen; 5 is one a state or national toxicology listing names; 3 or 4 is a documented contact allergen
  // charged only on a product that stays on the skin. `leaveOn` restricts a charge to such a product.
  const CAUTIONS = [
    { id: 'isothiazolinone', c: -15, test: /methyl(?:chloro)?isothiazolinone/i,
      why: 'Methylisothiazolinone preservative: a recognized contact allergen (Allergen of the Year 2013, American Contact Dermatitis Society), prohibited in EU leave-on cosmetics' },
    { id: 'formaldehyde', c: -15, test: /\b(?:formaldehyde|dmdm hydantoin|quaternium-15|imidazolidinyl urea|diazolidinyl urea|bronopol|2-bromo-2-nitropropane-1,3-diol|sodium hydroxymethylglycinate)\b/i,
      why: 'Formaldehyde-releasing preservative: formaldehyde is a recognized contact allergen and a classified human carcinogen' },
    { id: 'triclosan', c: -15, categories: ['body-wash'], test: /\b(?:triclosan|triclocarban)\b/i,
      why: 'Triclosan or triclocarban: in 2016 the FDA ruled that consumer antiseptic washes could not keep these without proof of added benefit' },
    { id: 'paraben', c: -15, test: /\b(?:isopropyl|isobutyl|phenyl|benzyl|pentyl)\s?paraben\b/i,
      why: 'A paraben the EU has prohibited in cosmetics (isopropyl-, isobutyl-, phenyl-, benzyl- and pentylparaben, since 2014); methylparaben and ethylparaben are not charged' },
    { id: 'phthalate', c: -15, test: /\b(?:dibutyl phthalate|diethylhexyl phthalate|bis\(2-ethylhexyl\) phthalate|dehp|dbp)\b/i,
      why: 'Dibutyl or diethylhexyl phthalate: prohibited in EU cosmetics as a reproductive toxicant' },
    { id: 'banned-fragrance', c: -15, test: /\bbutylphenyl methylpropional\b|\bhydroxyisohexyl 3-cyclohexene carboxaldehyde\b|\blyral\b|\bhicc\b/i,
      why: 'A fragrance chemical the EU has prohibited in cosmetics (butylphenyl methylpropional, "lilial", since 2022; HICC, "lyral", since 2021)' },
    { id: 'diethanolamide', c: -5, test: /\b(?:cocamide|lauramide|oleamide|linoleamide) dea\b|\bcocamide diethanolamine\b|\bdiethanolamine\b/i,
      why: 'Cocamide DEA or a related diethanolamide: listed under California Proposition 65 (cocamide diethanolamine, 2012) after animal studies found it carcinogenic' },
    { id: 'bha', c: -5, test: /^(?:bha|butylated hydroxyanisole)$/i,
      why: 'BHA (butylated hydroxyanisole): listed under California Proposition 65 and by the US National Toxicology Program as reasonably anticipated to be a human carcinogen' },
    { id: 'charcoal', c: -5, categories: ['toothpaste'], test: /\b(?:activated |bamboo )?charcoal\b/i,
      why: 'Charcoal: a 2019 review in the Journal of the American Dental Association found too little evidence of safety or effectiveness for charcoal dental products' },
    { id: 'propylene-glycol', c: -4, leaveOn: true, test: /^propylene glycol$/i,
      why: 'Propylene glycol: a recognized irritant and contact allergen in leave-on products (Allergen of the Year 2018, American Contact Dermatitis Society)' },
    { id: 'lanolin', c: -3, leaveOn: true, test: /^(?:hydrogenated |acetylated |hydroxylated )?lanolin(?: alcohol| oil| wax)?$|\bwool (?:wax )?alcohols?\b/i,
      why: 'Lanolin or wool alcohols: a long-standing patch-test allergen' },
  ];

  // The scent, in three rows that can all apply: the word "fragrance" (what is in it is not disclosed), the
  // fragrance allergens the EU requires a label to name once they pass a threshold (each is a recognized
  // contact allergen), and a scent essential oil (which carries the same limonene, linalool and geraniol).
  const FRAGRANCE = /\b(?:fragrance|parfum|perfume)\b/i;
  const FRAGRANCE_ALLERGEN = /\b(?:limonene|linalool|citronellol|geraniol|citral|coumarin|eugenol|isoeugenol|farnesol|cinnamal|cinnamyl alcohol|hydroxycitronellal|hexyl cinnamal|amyl cinnamal|amylcinnamyl alcohol|alpha-isomethyl ionone|benzyl salicylate|benzyl benzoate|benzyl cinnamate|anise alcohol|methyl 2-octynoate|evernia prunastri|evernia furfuracea)\b/i;
  // Only a plant that is grown for its scent, and only as an oil: coconut, shea, sunflower, olive, jojoba and
  // rose hip oils are carriers, not scents, and a rosemary or green-tea extract is an antioxidant.
  const SCENT_OIL = /\b(?:lavandula|lavender|melaleuca alternifolia|tea tree|mentha (?:piperita|spicata|arvensis|viridis)|peppermint|spearmint|eucalyptus|citrus (?:aurantium|limon|sinensis|paradisi|bergamia|reticulata|grandis|nobilis|medica|aurantifolia)|bergamot|lemon|orange|grapefruit|lime|pelargonium|geranium|cananga|ylang|rosmarinus|rosemary|cymbopogon|lemongrass|citronella|santalum|sandalwood|cedrus|cedarwood|juniperus|cinnamomum|cinnamon|syzygium aromaticum|clove|pogostemon|patchouli|jasminum|jasmine|rosa damascena|vetiveria|vetiver|salvia sclarea|clary sage|thymus|thyme|origanum|oregano)\b[^,]*\boil\b|\bessential oils?\b/i;
  const FRAGRANCE_COST = { leaveOn: 15, rinseOff: 12 };
  const ALLERGEN_COST = 2, ALLERGEN_MAX = 8, SCENT_OIL_COST = 4;
  // Only the active ingredient was read: the inactive list is most of the formula, and fragrance and cautions
  // live in it. A label that cannot be checked is not a clean one.
  const PARTIAL_COST = 25, MISSING_ACTIVE_COST = 15;

  // ------------------------------------------------------------ reading the entries
  // Words that mark an entry as an ingredient name rather than a sentence. The shape of an INCI
  // name is regular (a chemical suffix, a plant part, a numbered polymer), so recognition goes by
  // shape: a 20-ingredient moisturizer list (CeraVe) was "unreadable" at 30% coverage when only a
  // hand-built word list counted.
  const COMMON = /\b(?:water|aqua|eau|glycerin|glycerol|sorbitol|silica|calcium carbonate|xylitol|cellulose|gelatin|starch|flavou?r|aroma|fragrance|parfum|sodium|potassium|calcium|magnesium|zinc|alumini?um|cetyl|cetearyl|stearyl|glycol|glyceride|glycerides|phenoxyethanol|tocopherol|citric acid|lactic acid|benzoate|sorbate|edta|oil|butter|extract|panthenol|allantoin|polyquaternium|polysorbate|carbomer|hydroxide|chloride|ceramide|vitamin|niacin|folate|biotin|pectin|lecithin|maltodextrin|syrup|flour|capsule|annatto|dextrose|fructose|inulin|tapioca|rice|stearic acid|spirulina|turmeric)\b/i;
  const INCI_SHAPE = /(?:ate|ates|ide|ine|ene|ose|ol|yl|ium|ite|one|ane|ile|ase|ester|ether|amide|amine|acid|gum|wax|oil|butter|extract|juice|water|aqua|alcohol|glycol|glycerin|silicone|siloxane|polymer|copolymer|oxide|hydroxide|chloride|glyceride|petrolatum|lanolin|collagen|keratin|protein|peptide|enzyme|fragrance|parfum|aroma|flavou?r|essence|vitamin|clay|powder|starch|sugar|salt|talc|mica|silica|gelatin|cellulose|hydrate)$/i;
  const INCI_CODED = /^(?:peg|ppg|polyquaternium|quaternium|ceteareth|laureth|steareth|oleth|trideceth|polysorbate|carbomer|ci|fd&c|d&c|ext\.? d&c|sd alcohol|bht|bha|edta)\b|\b(?:peg|ppg)-?\d|\bci ?\d{5}\b/i;
  function recognized(entry) {
    const plain = entry.replace(/\([^)]*\)/g, ' ').replace(/[\d.%]+/g, ' ').replace(/\s+/g, ' ').trim();
    const words = plain.split(/[\s/-]+/).filter(Boolean);
    if (!words.length || words.length > 6) return false;   // a sentence, not a name
    return COMMON.test(entry) || INCI_CODED.test(plain) || words.some(word => INCI_SHAPE.test(word));
  }

  // ------------------------------------------------------------ Supplement Facts
  // The panel arrives as flattened text: "Supplement Facts Serving Size: 1 Softgel ... Vitamin D3
  // (as cholecalciferol) 125 mcg (5000 IU) 625%". An amount belongs to a nutrient only when it
  // follows the nutrient's own name, with at most a parenthetical "(as ...)" between: "Magnesium
  // Citrate 1000 mg" is a compound weight, not elemental magnesium, and is left alone.
  //
  // Upper limits are the National Academies' adult Tolerable Upper Intake Levels for
  // supplement-sourced amounts, at the highest value across adult age groups, so a flag means the
  // serving is over the limit for every adult. Units convert at the most generous ratio for the
  // same reason (1 IU of natural vitamin E is taken as 0.67 mg, of vitamin A as 0.3 mcg). A limit
  // is a daily ceiling for the general population; this compares one printed serving to it.
  const LIMITS = [
    { id: 'vitamin-c', label: 'Vitamin C', name: 'vitamin c|ascorbic acid', unit: 'mg', limit: 2000 },
    { id: 'vitamin-d', label: 'Vitamin D', name: 'vitamin d[23]?|cholecalciferol|ergocalciferol', unit: 'mcg', limit: 100, perIU: 0.025 },
    { id: 'vitamin-e', label: 'Vitamin E', name: 'vitamin e|(?:d-?|dl-?)?alpha[- ]tocopher(?:ol|yl)(?: acetate| succinate)?', unit: 'mg', limit: 1000, perIU: 0.67 },
    { id: 'vitamin-b6', label: 'Vitamin B6', name: 'vitamin b-?6|pyridoxine(?: hcl)?', unit: 'mg', limit: 100 },
    { id: 'niacin', label: 'Niacin', name: 'niacin(?:amide)?|nicotinic acid|nicotinamide', unit: 'mg', limit: 35 },
    // The folic acid limit is for the synthetic form only; folate in other forms has none.
    { id: 'folic-acid', label: 'Folic acid', name: 'folic acid|folate', unit: 'mcg', limit: 1000, needs: /folic acid/i, perDFE: 0.5 },
    // Only preformed vitamin A (retinol) has a limit; beta-carotene has none, so a mixed source is not judged.
    { id: 'vitamin-a', label: 'Preformed vitamin A', name: 'vitamin a', unit: 'mcg', limit: 3000, perIU: 0.3, needs: /retinyl|retinol/i, unless: /carotene/i },
    { id: 'calcium', label: 'Calcium', name: 'calcium', unit: 'mg', limit: 2500 },
    { id: 'iron', label: 'Iron', name: 'iron', unit: 'mg', limit: 45 },
    { id: 'zinc', label: 'Zinc', name: 'zinc', unit: 'mg', limit: 40 },
    { id: 'magnesium', label: 'Magnesium', name: 'magnesium', unit: 'mg', limit: 350 },
    { id: 'selenium', label: 'Selenium', name: 'selenium', unit: 'mcg', limit: 400 },
    { id: 'copper', label: 'Copper', name: 'copper', unit: 'mg', limit: 10 },
    { id: 'iodine', label: 'Iodine', name: 'iodine', unit: 'mcg', limit: 1100 },
    { id: 'manganese', label: 'Manganese', name: 'manganese', unit: 'mg', limit: 11 },
    { id: 'choline', label: 'Choline', name: 'choline', unit: 'mg', limit: 3500 },
    { id: 'molybdenum', label: 'Molybdenum', name: 'molybdenum', unit: 'mcg', limit: 2000 },
    { id: 'phosphorus', label: 'Phosphorus', name: 'phosphorus', unit: 'mg', limit: 4000 },
    { id: 'boron', label: 'Boron', name: 'boron', unit: 'mg', limit: 20 },
  ];
  const AMOUNT = '((?:\\s*\\((?:[^()]|\\([^()]*\\))*\\))*)\\s*:?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(mcg|µg|μg|ug|mg|g|iu)\\b(?:\\s*(rae|dfe|ne|at|α-te))?';
  const amountPattern = name => new RegExp('\\b(' + name + ')\\b' + AMOUNT, 'gi');
  const NUTRIENT_PATTERNS = LIMITS.map(def => ({ def, pattern: amountPattern(def.name) }));
  const CAFFEINE = amountPattern('caffeine');
  const MASS_IN_MG = { mcg: 0.001, mg: 1, g: 1000 };

  // The amount in the limit's own unit, or null when it cannot be converted without guessing.
  function inLimitUnit(def, value, unit, suffix) {
    const u = unit.toLowerCase().replace(/[µμ]g|ug/, 'mcg');
    let amount;
    if (u === 'iu') amount = def.perIU == null ? null : value * def.perIU;
    else amount = value * MASS_IN_MG[u] * (def.unit === 'mcg' ? 1000 : 1);
    if (amount != null && def.perDFE && /^dfe$/i.test(suffix || '')) amount *= def.perDFE;
    return amount;
  }

  // Every nutrient with a limit that the panel declares, and the largest amount it declares.
  function declaredAmounts(facts) {
    const body = String(facts || '').replace(/\s+/g, ' ').split(/\bother ingredients?\b/i)[0];
    const found = [];
    for (const { def, pattern } of NUTRIENT_PATTERNS) {
      pattern.lastIndex = 0;
      let best = null;
      for (let m = pattern.exec(body); m; m = pattern.exec(body)) {
        const forms = `${m[1]} ${m[2]}`;
        if (def.needs && !def.needs.test(forms)) continue;
        if (def.unless && def.unless.test(forms)) continue;
        const value = Number(m[3].replace(/,/g, ''));
        const amount = Number.isFinite(value) ? inLimitUnit(def, value, m[4], m[5]) : null;
        if (amount != null && (best == null || amount > best)) best = amount;
      }
      if (best != null) found.push({ id: def.id, label: def.label, unit: def.unit, limit: def.limit, amount: best, over: best > def.limit });
    }
    CAFFEINE.lastIndex = 0;
    let caffeine = null;
    for (let m = CAFFEINE.exec(body); m; m = CAFFEINE.exec(body)) {
      const mg = Number(m[3].replace(/,/g, '')) * (MASS_IN_MG[m[4].toLowerCase().replace(/[µμ]g|ug/, 'mcg')] || 0);
      if (Number.isFinite(mg) && mg > (caffeine || 0)) caffeine = mg;
    }
    return { nutrients: found, caffeine };
  }
  const formatAmount = n => Number(n.toFixed(1)).toLocaleString('en-US');

  // A panel is usable when it states a serving and at least one amount that is not just a macro line.
  const SERVING = /\bserving size\b\s*:?\s*(?:[1-9]|[½¼¾⅓⅔]|one|two|three|four|five|six|half)/i;
  const MACRO_LINE = /\b(?:calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrates?|carbohydrates?|dietary fiber|fiber|total sugars?|sugars?|added sugars?|sugar alcohols?)\b[^0-9<]{0,16}[<]?\d[\d.,]*\s*(?:mg|g|mcg|kcal)?/gi;
  const SERVING_LINE = /\bserving size\b[^a-z]{0,12}[\d.,]+\s*(?:g|mg|ml|oz)?/gi;
const hasActiveAmount = facts => /\b\d[\d,.]*\s*(?:mcg|mg|g|iu|µg|μg)\b/i.test(facts.replace(SERVING_LINE, ' ').replace(MACRO_LINE, ' '));

  const SOURCES = {
    oral: { label: 'ADA: oral care ingredients', url: 'https://www.ada.org/resources/ada-library/oral-health-topics/toothpastes' },
    cosmetic: { label: 'FDA: cosmetic allergens', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/allergens-cosmetics' },
    supplement: { label: 'NIH: Supplement Facts', url: 'https://ods.od.nih.gov/factsheets/WYNTK-Consumer/' },
  };
  const sourceFor = category => SOURCES[category === 'supplement' ? 'supplement' : /toothpaste|mouthwash/.test(category) ? 'oral' : 'cosmetic'];

  // `limits` is the engine's own scale ({ BANDS, SCORE_FLOOR }): an index is worded in the same five bands as a
  // food score, and stops at the same floor, from one definition rather than a second copy of either.
  const verdictOf = (score, limits) => (limits?.BANDS?.find(band => score >= band[0]) || [0, 'Label index'])[1];
  function rate(product, options, parseEntries, limits) {
    const ingestible = AIR.db.ingestible;
    const facts = typeof product.supplement_facts === 'string' ? product.supplement_facts : '';
    const kind = CATEGORIES.includes(product.category) ? { category: product.category, status: 'recognized' }
      : ingestible.classifyProduct(product.name, { supplementFacts: /\bsupplement facts\b/i.test(facts) });
    if (kind.category === 'unknown') return null;   // ordinary food continues through its original engine
    const category = kind.category;
    const ratingStyle = styleOf(options.ratingStyle);
    const review = ingestible.personalCareReview(product.name, product.ingredients_text, options, product.advisory_text, facts);
    const out = {
      category, ratingStyle, score: null, verdict: 'Unavailable', parsed: 0, coverage: 0, readable: false, limited: true,
      good: [], bad: [], flags: review?.flags || [], base: 0, selectedAllergens: options.allergens || [], supplementFacts: facts,
      sources: [sourceFor(category),
        ...(category !== 'supplement' ? [{ label: 'EU CosIng: ingredient functions', url: 'https://ec.europa.eu/growth/tools-databases/cosing/' }] : [])],
    };
    const decline = reason => ({ ...out, reason });
    const floor = Number.isFinite(limits?.SCORE_FLOOR) ? limits.SCORE_FLOOR : 0;
    if (kind.status !== 'recognized') return decline('This product category or combination is not yet supported.');
    if (options.personalCareEnabled === false) return decline('Personal-care and supplement ratings are switched off.');

    const raw = String(product.ingredients_text || '');
    if (!raw.trim() || raw.length > 6000 || /\b(?:see (?:the )?(?:label|package)|not available|ingredients unavailable)\b/i.test(raw)) return decline('A readable ingredient label is required.');
    const label = ingestible.prepareLabel(raw);
    const notIngredient = s => /^(?:no |without |free from |may contain|contains traces)|\bfree$/i.test(s);
    const entries = parseEntries(label.text).filter(e => !e.parent).map(e => e.ing).filter(s => !notIngredient(s));
    if (!entries.length || entries.some(s => s.length > 250)) return decline('The ingredient label could not be separated into readable entries.');
    if (facts.length > 4000) return decline('The Supplement Facts panel is too long to assess reliably.');
    out.parsed = entries.length;
    out.coverage = entries.filter(recognized).length / entries.length;
    if (!out.coverage) return decline('The label does not contain enough recognized ingredients.');

    const isSupplement = category === 'supplement';
    if (isSupplement && (!/\bsupplement facts\b/i.test(facts) || !SERVING.test(facts) || !hasActiveAmount(facts) || /proprietary blend/i.test(facts)))
      return decline('Supplement Facts with serving size and declared amounts are required; proprietary blend amounts cannot establish individual doses.');

    let base = 0;
    if (ratingStyle === 'minimal') {
      if (label.partial) return decline('Only the active ingredient is listed. The inactive ingredients are needed to count the list.');
      // A supplement's actives are its purpose; only what is added to them counts as length.
      const added = isSupplement && /\bother ingredients?\b/i.test(raw)
        ? parseEntries(ingestible.prepareLabel(raw.split(/\bother ingredients?\s*[:\-–]?\s*/i).slice(1).join(', ')).text).filter(e => !e.parent) : null;
      const counted = added ? added.length : entries.length;
      base = 100;
      const cost = Math.min(90, Math.max(0, counted - 1) * 3);
      if (cost) out.bad.push({ c: -cost, why: `${counted} declared ${added ? 'other ' : ''}ingredients; this style favors shorter lists, not greater safety` });
    } else if (ratingStyle === 'preferences') {
      if (!(options.avoidList || []).length) return decline('Add avoid-list preferences to use the preference-focused index.');
      if (label.partial) return decline('Only the active ingredient is listed. The inactive ingredients are needed to check your avoid list.');
      base = 100;
      const avoided = out.flags.filter(f => f.kind === 'avoid');
      if (avoided.length) out.bad.push({ c: -Math.min(100, avoided.length * 20), why: `${avoided.length} selected avoid-list terms matched`, ing: avoided.map(f => f.ingredient).join(', ') });
      out.good.push({ c: 0, why: 'Allergy and diet warnings are shown separately and never change this index' });
    } else if (isSupplement) {
      base = 0;
      out.good.push({ c: 40, why: 'Supplement Facts declares a serving size' },
        { c: 40, why: 'Amounts are declared on the available panel; higher doses earn no additional points' },
        { c: 20, why: 'An ingredient list is available' });
      const { nutrients, caffeine } = declaredAmounts(facts);
      const over = nutrients.filter(n => n.over).slice(0, 3);
      for (const n of over) {
        out.bad.push({ c: -20, ing: n.label,
          why: `${n.label}: ${formatAmount(n.amount)} ${n.unit} in one serving is above the adult upper limit of ${formatAmount(n.limit)} ${n.unit} set by the National Academies` });
      }
      out.good.push({ c: 0, why: over.length
        ? 'Upper limits are daily amounts for the general adult population; some people take more under medical supervision'
        : 'Compared with adult upper limits for the nutrients the panel quantifies; this is one printed serving, not your daily total' });
      if (caffeine >= 200) out.good.push({ c: 0, why: `Caffeine: ${formatAmount(caffeine)} mg in one serving; the FDA cites 400 mg a day as an amount not generally associated with dangerous effects for healthy adults` });
    } else {
      // Starts where a food does: at 100, charged for what the label shows. Nothing is charged that no rule
      // matches, so what could not be read is charged as unread (below), not passed as clean.
      base = 100;
      const leaveOn = LEAVE_ON.includes(category);
      const functionHit = (FUNCTIONS[category] || []).map(pattern => entries.find(e => matches(pattern, e))).find(Boolean);
      // "Fluoride-Free" and "aluminum free" promise the opposite of an active ingredient.
      const promised = PROMISED_ACTIVE[category]?.test(String(product.name || '').replace(/\b(?:no|non|without)[- ]fluoride\b|\bfluoride[- ]free\b/gi, ' '));
      if (functionHit) {
        out.good.push({ c: 0, ing: functionHit, why: 'A category-specific functional ingredient is disclosed; concentration and finished-product performance are not established' });
      } else if (promised) {
        out.bad.push({ c: -MISSING_ACTIVE_COST, why: `The title names an active ingredient, but the available list shows only the inactive ones (the active ingredient is printed in the Drug Facts panel); fragrance and cautions are checked on what is listed` });
      } else {
        out.bad.push({ c: -FUNCTION_COST[category], why: `The available label does not list ${NEEDS[category]}, so it does not show how this ${categoryName(category).toLowerCase()} does its job. If the page shows only part of the label, open the full ingredient list` });
      }
      if (label.partial) {
        out.bad.push({ c: -PARTIAL_COST, why: 'Only the active ingredient is listed on this page; the inactive ingredients are most of the formula, so fragrance and cautions could not be checked' });
      } else {
        const fragranceHit = entries.find(e => FRAGRANCE.test(e));
        if (fragranceHit) out.bad.push({ c: -(leaveOn ? FRAGRANCE_COST.leaveOn : FRAGRANCE_COST.rinseOff), ing: fragranceHit,
          why: leaveOn ? 'Fragrance is disclosed: a leading cause of cosmetic contact allergy, and leave-on products such as deodorants are the ones most often implicated'
            : 'Fragrance is disclosed; a sensitivity consideration for some users' });
        const allergens = [...new Set(entries.filter(e => FRAGRANCE_ALLERGEN.test(e)))];
        if (allergens.length) out.bad.push({ c: -Math.min(ALLERGEN_MAX, allergens.length * ALLERGEN_COST), ing: allergens.join(', '),
          why: `${allergens.length} fragrance allergen${allergens.length === 1 ? '' : 's'} named on the label (the EU requires these to be named; each is a recognized contact allergen)` });
        // Peppermint, spearmint and clove oil are what a toothpaste or rinse is flavored with, not scented with.
        const scentOil = ORAL.includes(category) ? null : entries.find(e => SCENT_OIL.test(e));
        if (scentOil) out.bad.push({ c: -SCENT_OIL_COST, ing: scentOil,
          why: 'A scent essential oil is listed; essential oils contain the same fragrance allergens (limonene, linalool, geraniol) as a synthetic fragrance' });
        for (const caution of CAUTIONS) {
          if (caution.categories && !caution.categories.includes(category)) continue;
          if (caution.leaveOn && !leaveOn) continue;
          const hit = entries.find(e => caution.test.test(e));
          if (hit) out.bad.push({ c: caution.c, why: caution.why, ing: hit });
        }
      }
      if (!out.bad.length && !label.partial) out.good.push({ c: 0, why: 'No fragrance and none of the documented cautions are on the available list' });
    }
    out.base = base;
    const total = () => base + out.good.reduce((s, r) => s + r.c, 0) + out.bad.reduce((s, r) => s + r.c, 0);
    // Charges can add past 100 (a label with several documented cautions). The floor is a clamp, so it shows
    // as a row of its own and the panel keeps adding up; it is never applied silently.
    if (total() < floor) out.good.push({ c: floor - total(), why: `Score floor — the scale stops at ${floor}` });
    out.score = total();
    out.verdict = verdictOf(out.score, limits); out.readable = true;
    return out;
  }
  const api = AIRmodule('productRatings', {
    rate, styleOf, STYLES, CATEGORIES, CATEGORY_KEYS, STYLE_KEYS, categoryName, categoryLabel, styleLabel, caption, declaredAmounts, recognized, LIMITS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
