// Provenance: how a whole food was actually produced.
//
// For a single-ingredient product the ingredient list carries almost no information. "Ground Beef"
// is one ingredient whether the animal spent its life on pasture or in a feedlot, and the scoring
// engine on its own will happily call both of them a 96. Everything that actually varies —
// feed, confinement, antibiotics, origin — lives in certifications, not in the ingredients.
//
// Three ideas do the work here:
//
//   1. VERIFICATION TIERS. A third-party-audited certification is a different kind of statement
//      from a word the seller typed. They are scored differently and labelled differently.
//   2. ABSENCE IS INFORMATION. For a commodity animal product with no claims at all, the default
//      production method is the industrial one. Silence should not read as excellence.
//   3. SOME CLAIMS MEAN NOTHING. "USDA Inspected" is mandatory for all meat sold. "No hormones
//      added" is meaningless on pork and poultry because hormones are already illegal there.
//      These get flagged, never rewarded.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

// ---------------------------------------------------------------- what kind of food is this
// Provenance only dominates for whole foods. A cracker's score is about its ingredients; a steak's
// score is almost entirely about the animal.
const WHOLE_FOOD_KINDS = [
  { kind: 'beef',    m: new RegExp(/\b(beef|steak|brisket|ribeye|sirloin|ground chuck|bison|veal)\b/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:b(?:œ|oe)uf|bovin|rindfleisch\\w*|rinder\\w*|rinds\\w*|kalb\\w*|ternera|vacuno|carne de res|manzo|vitello|rundvlees|rundsvlees|runder\\w*|rundergehakt|kalfs?vlees|n[öo]tk[öo]tt|kalv\\w*|wo[łl]owin\\w*|ciel[ęe]cin\\w*|s[ıi][ğg][ıi]r(?: eti)?|dana eti|carne bovina|vitela|novilho)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), animal: true },
  { kind: 'pork',    m: new RegExp(/\b(pork|bacon|ham|prosciutto|sausage|pancetta|lard)\b/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:porc|jambon|saucisses?|schwein\\w*|schinken|cerdo|jam[óo]n|maiale|salsicci[ae]|varkens?\\w*|fl[äa]sk\\w*|skinka|wieprzow\\w*|szynk[ai]|boczek|porco|presunto|toucinho|lingui[çc]a)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), animal: true, hormonesIllegal: true },
  { kind: 'poultry', m: new RegExp(/\b(chicken|turkey|duck|goose|poultry)\b/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:poulet|dinde|canard|volaille|h[äa]hnchen\\w*|huhn|h[üu]hner\\w*|pute\\w*|truthahn|ente|gefl[üu]gel|pollo|pavo|pato|tacchino|anatra|kip(?:filet|pendij)?|kippen\\w*|kalkoen|eend|gevogelte|kyckling\\w*|kalkon|anka|kurczak\\w*|kurcz[ęe]\\w*|indyk\\w*|kaczk\\w*|dr[óo]b|tavuk(?: \\w+)?|hindi eti|[öo]rdek|frango)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), animal: true, hormonesIllegal: true },
  { kind: 'lamb',    m: new RegExp(/\b(lamb|mutton|goat)\b/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:agneau|mouton|lamm\\w*|schaf\\w*|cordero|cabra|agnello|capra|lamsvlees|jagni[ęe]cin\\w*|baranin\\w*|kuzu(?: eti)?|koyun eti|borrego|cordeiro)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), animal: true },
  { kind: 'egg',     m: new RegExp(/\begg(s)?\b/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:(?:œ|oe)ufs?(?: entiers?| frais)?|eier|ei|huevos?|uov[ao]|eieren|[äa]gg|jaj(?:a|ka)|yumurta|ovos?)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), animal: true, hormonesIllegal: true },
  { kind: 'dairy',   m: new RegExp(/\b(milk|cream|butter|cheese|yogh?urt|kefir|ghee)\b/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:lait|cr[èe]me|beurre|fromage|yaourt|milch|sahne|k[äa]se|joghurt|leche|nata|mantequilla|queso|yogur|latte|panna|burro|formaggio|melk|room|boter|kaas|mj[öo]lk|gr[äa]dde|sm[öo]r|ost|mleko|[śs]mietan\\w*|mas[łl]o|ser|jogurt|s[üu]t|krema|tereya[ğg][ıi]|peynir|yo[ğg]urt|leite|manteiga|queijo|iogurte)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), animal: true },
  { kind: 'seafood', m: new RegExp(/\b(salmon|tuna|cod|shrimp|scallop|halibut|sardine|mackerel|trout|tilapia|oyster|mussel)\w*/.source + '|(?<![a-zà-ÿœ\\u0100-\\u017f])(?:saumon|thon|cabillaud|crevettes?|lachs\\w*|thunfisch\\w*|kabeljau|garnelen?|salm[óo]n|salmone|at[úu]n|bacalao|gambas?|tonno|merluzzo|gamber[io]|zalm|tonijn|kabeljauw|garnalen?|lax|tonfisk|torsk|r[äa]kor|[łl]oso[śs]\\w*|tu[ńn]czyk\\w*|dorsz\\w*|krewetk\\w*|somon|ton bal[ıi][ğg][ıi]|morina|karides|salm[ãa]o|atum|bacalhau|camar[ãa]o|sardines?|sardinas?|sardinen|sardynk\\w*|sardalya|sardinhas?|maquereau|caballa|sgombro|makreel|makrill|makrel\\w*|uskumru|cavala|truites?|truchas?|trota|forellen?|forel|[öo]ring|pstr[ąa]g\\w*|alabal[ıi]k|truta)(?![a-zà-ÿœ\\u0100-\\u017f])', 'i'), seafood: true },
  { kind: 'produce', m: /\b(apple|banana|berry|berries|spinach|kale|lettuce|tomato|carrot|potato|onion|broccoli|avocado|grape)\w*/i, produce: true },
  { kind: 'grain',   m: /\b(oats|rice|quinoa|wheat berries|barley|buckwheat)\b/i, produce: true },
  { kind: 'nut',     m: /\b(almond|walnut|pecan|cashew|pistachio|macadamia|peanut)\w*/i, produce: true },
];

// ---------------------------------------------------------------- certifications
// tier 3 = independently audited against a published standard
// tier 2 = government-regulated claim with real enforcement
// tier 1 = label claim, no verification behind it
const CERTIFICATIONS = [
  { id: 'aga', tier: 3, pts: 16, label: 'American Grassfed Association certified',
    m: /\b(american grassfed|AGA[- ]certified|certified american grassfed)\b/i,
    means: '100% forage from weaning, pasture-raised without confinement, never any antibiotics or added hormones, born and raised in the US, audited every 15 months.',
    applies: ['beef', 'lamb', 'dairy'] },
  { id: 'awa', tier: 3, pts: 15, label: 'Animal Welfare Approved (A Greener World)',
    m: /\b(animal welfare approved|a greener world|AWA[- ]certified)\b/i,
    means: 'Pasture or range required for the whole life, independently audited. Among the strictest welfare standards available.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy'] },
  { id: 'gap5', tier: 3, pts: 14, label: 'Global Animal Partnership step 5 / 5+',
    m: /\b(step\s*5\+?|G\.?A\.?P\.?\s*(step\s*)?5)\b/i,
    means: 'Animal-centred: pasture based, no physical alterations, and at 5+ the animal spends its entire life on one farm.',
    applies: ['beef', 'pork', 'poultry', 'lamb'] },
  { id: 'gap4', tier: 3, pts: 10, label: 'Global Animal Partnership step 4',
    m: /\b(step\s*4|G\.?A\.?P\.?\s*(step\s*)?4)\b/i,
    means: 'Pasture centred. Animals live outdoors on pasture for a meaningful part of their lives.',
    applies: ['beef', 'pork', 'poultry', 'lamb'] },
  { id: 'organic', tier: 3, pts: 12, label: 'USDA Organic',
    m: /\b(usda organic|certified organic|organic)\b/i,
    means: 'Organic feed, no antibiotics or added hormones, outdoor access required. Note: organic does NOT mean 100% grass-fed.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy', 'produce', 'grain', 'nut'] },
  { id: 'humane', tier: 3, pts: 8, label: 'Certified Humane',
    m: /\bcertified humane\b/i,
    means: 'Audited welfare standard covering space, bedding and handling. Base certification does not by itself require pasture.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy'] },
  { id: 'regenerative', tier: 3, pts: 12, label: 'Certified regenerative (ROC / Land to Market)',
    m: /\b(regenerative organic certified|ROC certified|land to market|ecological outcome verified)\b/i,
    means: 'Verified soil and grazing outcomes on top of an organic base.',
    applies: ['beef', 'lamb', 'dairy', 'produce', 'grain'] },
  { id: 'msc', tier: 3, pts: 10, label: 'MSC / ASC certified seafood',
    m: /\b(marine stewardship council|MSC certified|aquaculture stewardship|ASC certified|best aquaculture)\b/i,
    means: 'Independently audited fishery or farm standard.',
    applies: ['seafood'] },
  { id: 'productOfUsa', tier: 2, pts: 6, label: 'Product of USA (2026 standard)',
    m: /\bproduct of (the )?usa\b|\bborn,? raised,? and harvested in the u\.?s\.?a?\b/i,
    means: 'Since 1 January 2026 this claim requires the animal to be born, raised, slaughtered AND processed in the United States. Before that date the same words could mean only that the meat was repackaged here.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg'] },
  { id: 'wildCaught', tier: 2, pts: 8, label: 'Wild-caught',
    m: /\bwild[- ]caught\b|\bwild[- ]harvested\b/i,
    means: 'Not farmed. No feed, no pens, no routine antibiotics.',
    applies: ['seafood'] },

  // --- tier 1: label claims with no third-party audit behind them ---
  { id: 'grassFinished', tier: 1, pts: 9, label: '100% grass-fed and grass-finished (claim)',
    m: /\b(100%\s*grass[- ]?fed|grass[- ]?finished|grass fed and finished)\b/i,
    means: 'The strongest feed claim, but USDA withdrew its grass-fed labelling standard in 2016, so an uncertified claim rests on the seller\'s word.',
    applies: ['beef', 'lamb', 'dairy'] },
  { id: 'grassFed', tier: 1, pts: 5, label: 'Grass-fed (claim)',
    m: /\bgrass[- ]?fed\b/i,
    means: 'Without "finished", cattle are commonly moved to grain for the last months. Nearly all cattle eat grass at some point.',
    applies: ['beef', 'lamb', 'dairy'] },
  { id: 'pastureRaised', tier: 1, pts: 7, label: 'Pasture-raised (claim)',
    m: /\bpasture[- ]?raised\b|\bpastured\b/i,
    means: 'No federal definition for most species. Meaningful when a certifier stands behind it, marketing copy when not.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy'] },
  { id: 'freeRange', tier: 1, pts: 3, label: 'Free-range (claim)',
    m: /\bfree[- ]?range\b/i,
    means: 'For poultry this requires only some access to the outdoors, of unspecified quality or duration.',
    applies: ['poultry', 'egg'] },
  { id: 'noAntibiotics', tier: 1, pts: 5, label: 'Raised without antibiotics (claim)',
    m: /\b(no antibiotics|raised without antibiotics|antibiotic[- ]free|never any antibiotics)\b/i,
    means: 'A real distinction from conventional production, though self-declared unless certified.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy'] },
  { id: 'nonGmoVerified', tier: 2, pts: 4, label: 'Non-GMO Project Verified',
    m: /\bnon[- ]?gmo project\b/i,
    means: 'Third-party verified absence of GMO inputs. For animals this covers feed.',
    applies: ['beef', 'pork', 'poultry', 'lamb', 'egg', 'dairy', 'produce', 'grain'] },
];

// ---------------------------------------------------------------- claims that mean nothing
// Flagged so the panel can say so. Never scored — rewarding these is how a label wins credit for
// obeying the law.
const HOLLOW_CLAIMS = [
  { id: 'usdaInspected', m: /\busda (approved|inspected|certified)\b(?!\s*organic)/i,
    label: '"USDA Approved / Inspected"',
    why: 'Federal inspection is mandatory for all meat and poultry sold in the US. Every competing product has it too.' },
  { id: 'noHormonesPoultry', m: /\b(no (added )?hormones|hormone[- ]free)\b/i, onlyIf: 'hormonesIllegal',
    label: '"No hormones added"',
    why: 'Hormones are prohibited by law in pork and poultry, so this claim describes the legal minimum rather than anything the producer chose.' },
  { id: 'natural', m: /\b(all[- ])?natural\b/i,
    label: '"Natural"',
    why: 'Means only minimally processed with no artificial ingredients. It says nothing about how the animal was raised or fed.' },
  { id: 'farmFresh', m: /\b(farm[- ]fresh|farm[- ]raised|premium|pure|wholesome|hand[- ]selected)\b/i,
    label: 'Unregulated marketing language',
    why: 'No legal definition and no verification. "Farm-raised" in particular is true of essentially all livestock.' },
  { id: 'noMsg', m: /\bno msg\b/i, label: '"No MSG"',
    why: 'Often appears on products containing yeast extract or hydrolysed protein, which supply the same free glutamates.' },
];

// ---------------------------------------------------------------- helpers
function classify(text) {
  const t = String(text || '');
  for (const k of WHOLE_FOOD_KINDS) if (k.m.test(t)) return k;
  return null;
}

// Detect certifications present in a given evidence string, restricted to those meaningful for
// this kind of food. Returns the best of any overlapping pair (grass-finished beats grass-fed).
function detectCertifications(evidence, kind) {
  const found = [];
  for (const c of CERTIFICATIONS) {
    if (kind && c.applies && !c.applies.includes(kind)) continue;
    if (c.m.test(evidence)) found.push(c);
  }
  const drop = new Set();
  if (found.some(c => c.id === 'grassFinished')) drop.add('grassFed');
  if (found.some(c => c.id === 'aga')) { drop.add('grassFed'); drop.add('grassFinished'); }
  if (found.some(c => c.id === 'gap5')) drop.add('gap4');
  return found.filter(c => !drop.has(c.id));
}

function detectHollowClaims(evidence, kindInfo) {
  return HOLLOW_CLAIMS.filter(h => {
    if (h.onlyIf && !(kindInfo && kindInfo[h.onlyIf])) return false;
    return h.m.test(evidence);
  });
}

const _exports = AIRmodule('provenance', {
  WHOLE_FOOD_KINDS, CERTIFICATIONS, HOLLOW_CLAIMS,
  classify, detectCertifications, detectHollowClaims,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
