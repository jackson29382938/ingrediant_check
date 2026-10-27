// Category-specific label indices. Point weights are the app's disclosed rubric, not clinical
// effect sizes. Food rules never enter this module; missing functional/dose evidence declines.
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  require('./_module.js'); require('./ingestible.js'); require('./allergens.js');
}
(function () {
  const STYLES = ['evidence', 'minimal', 'preferences'];
  const styleOf = value => STYLES.includes(value) ? value : 'evidence';
  const FUNCTIONS = {
    toothpaste: [/\b(?:sodium fluoride|stannous fluoride|sodium monofluorophosphate)\b/i],
    mouthwash: [/\b(?:sodium fluoride|cetylpyridinium chloride|chlorhexidine|eucalyptol|thymol)\b/i],
    deodorant: [/\b(?:alumini?um (?:chlorohydrate|sesquichlorohydrate|chloride|zirconium)|triethyl citrate|sodium bicarbonate|magnesium hydroxide|zinc ricinoleate)\b/i],
    shampoo: [/\b(?:sodium (?:lauryl|laureth|coco)[a-z -]*(?:sulfate|sulphate|isethionate)|cocamidopropyl betaine|(?:decyl|coco|lauryl) glucoside|sodium lauroyl sarcosinate)\b/i],
    conditioner: [/\b(?:behentrimonium|cetrimonium|stearamidopropyl dimethylamine|dimethicone|amodimethicone)\b/i],
    'body-wash': [/\b(?:soap|sodium (?:palmat|palm kernelat|cocoat|tallowat|olivat)e|sodium (?:lauryl|laureth)[a-z -]*(?:sulfate|sulphate)|cocamidopropyl betaine|(?:decyl|coco|lauryl) glucoside)\b/i],
    moisturizer: [/\b(?:glycerin|glycerol|hyaluronic acid|sodium hyaluronate|urea)\b/i, /\b(?:petrolatum|dimethicone|ceramides?|shea butter|butyrospermum parkii)\b/i],
  };
  const COMMON = /\b(?:water|aqua|eau|glycerin|glycerol|sorbitol|silica|calcium carbonate|xylitol|cellulose|gelatin|starch|flavou?r|aroma|fragrance|parfum|sodium|potassium|calcium|magnesium|zinc|alumini?um|cetyl|cetearyl|stearyl|glycol|glyceride|glycerides|phenoxyethanol|tocopherol|citric acid|lactic acid|benzoate|sorbate|edta|oil|butter|extract|panthenol|allantoin|polyquaternium|polysorbate|carbomer|hydroxide|chloride|ceramide|vitamin|niacin|folate|biotin)\b/i;
  const SOURCES = {
    oral: { label: 'ADA: oral care ingredients', url: 'https://www.ada.org/resources/ada-library/oral-health-topics/toothpastes' },
    cosmetic: { label: 'FDA: cosmetic allergens', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/allergens-cosmetics' },
    supplement: { label: 'NIH: Supplement Facts', url: 'https://ods.od.nih.gov/factsheets/WYNTK-Consumer/' },
  };
  function rate(product, options, parseEntries) {
    const facts = typeof product.supplement_facts === 'string' ? product.supplement_facts : '';
    const kind = /^(?:toothpaste|mouthwash|deodorant|shampoo|conditioner|body-wash|moisturizer|supplement)$/.test(product.category) ? {category: product.category, status: 'recognized'} : AIR.db.ingestible.classifyProduct(product.name, { supplementFacts: /\bsupplement facts\b/i.test(facts) });
    if (kind.category === 'unknown') return null; // ordinary food continues through its original engine
    const category = kind.category, ratingStyle = styleOf(options.ratingStyle);
    const review = AIR.db.ingestible.personalCareReview(product.name, product.ingredients_text, options, product.advisory_text, facts);
    const out = { category, ratingStyle, score: null, verdict: 'Unavailable', parsed: 0, coverage: 0,
      readable: false, limited: true, good: [], bad: [], flags: review?.flags || [], base: 0,
      selectedAllergens: options.allergens || [], supplementFacts: facts, sources: [SOURCES[category === 'supplement' ? 'supplement' : /toothpaste|mouthwash/.test(category) ? 'oral' : 'cosmetic'], ...(category !== 'supplement' ? [{ label: 'EU CosIng: ingredient functions', url: 'https://ec.europa.eu/growth/tools-databases/cosing/' }] : [])] };
    const decline = reason => ({ ...out, reason });
    if (kind.status !== 'recognized') return decline('This product category or combination is not yet supported.');
    if (options.personalCareEnabled === false) return decline('Personal-care and supplement ratings are switched off.');
    const raw = String(product.ingredients_text || '');
    if (!raw.trim() || raw.length > 6000 || /\b(?:see (?:the )?(?:label|package)|not available|ingredients unavailable)\b/i.test(raw)) return decline('A readable ingredient label is required.');
    const entries = parseEntries(raw).filter(e => !e.parent).map(e => e.ing)
      .filter(s => !/^(?:no |without |free from |may contain|contains traces)|\bfree$/i.test(s));
    if (!entries.length || entries.some(s => s.length > 250)) return decline('The ingredient label could not be separated into readable entries.');
    const functional = (FUNCTIONS[category] || []).filter(pattern => entries.some(e => pattern.test(e)));
    if (facts.length > 2000) return decline('The Supplement Facts panel is too long to assess reliably.');
    const recognized = entries.filter(e => COMMON.test(e) || (FUNCTIONS[category] || []).some(pattern => pattern.test(e))).length;
    out.parsed = entries.length; out.coverage = recognized / entries.length;
    if (!recognized) return decline('The label does not contain enough recognized ingredients.');
    if (category === 'supplement' && (!/\bsupplement facts\b/i.test(facts) || !/\bserving size\b\s*:?\s*[1-9]/i.test(facts) || !/\b\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|iu|µg|μg)\b/i.test(facts) || /proprietary blend/i.test(facts)))
      return decline('Supplement Facts with serving size and declared amounts are required; proprietary blend amounts cannot establish individual doses.');
    let base = 0;
    if (ratingStyle === 'minimal') {
      base = 100;
      const cost = Math.min(90, Math.max(0, entries.length - 1) * 3);
      if (cost) out.bad.push({ c: -cost, why: `${entries.length} declared ingredients; this style favors shorter lists, not greater safety` });
    } else if (ratingStyle === 'preferences') {
      if (!(options.avoidList || []).length) return decline('Add avoid-list preferences to use the preference-focused index.');
      base = 100;
      const matches = out.flags.filter(f => f.kind === 'avoid');
      if (matches.length) out.bad.push({ c: -Math.min(100, matches.length * 20), why: `${matches.length} selected avoid-list terms matched`, ing: matches.map(f => f.ingredient).join(', ') });
      out.good.push({ c: 0, why: 'Allergy and diet warnings are shown separately and never change this index' });
    } else if (category === 'supplement') {
      base = 0;
      out.good.push({ c: 40, why: 'Supplement Facts declares a serving size' }, { c: 40, why: 'Amounts are declared on the available panel; higher doses earn no additional points' }, { c: 20, why: 'An ingredient list is available' });
    } else {
      if (!functional.length) return decline('The available label does not establish a category-specific functional ingredient for this rubric.');
      base = 50;
      out.good.push({ c: 30, why: 'A category-specific functional ingredient is disclosed; concentration and finished-product performance are not established' });
      if (/\b(?:fragrance|parfum|perfume)\b/i.test(entries.join(', '))) out.bad.push({ c: -10, why: 'Fragrance is disclosed; a sensitivity consideration for some users' });
    }
    out.base = base;
    out.score = base + out.good.reduce((s, r) => s + r.c, 0) + out.bad.reduce((s, r) => s + r.c, 0);
    out.verdict = 'Label index'; out.readable = true;
    return out;
  }
  const api = AIRmodule('productRatings', { rate, styleOf, STYLES });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
