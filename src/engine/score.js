// Ingredient Check — scoring engine.
//
//   NOVA processing class -> base score
//        -> ingredient penalties (position-weighted)
//        -> provenance bonuses (capped; marketing-title claims worth half)
//        -> hard caps (one disqualifying ingredient sets a ceiling)
//
// Runs unchanged in Node (test suites) and in a Chrome content script.

(function (root, factory) {
  const req = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? p => require(p)
    : null;
  const db = req
    ? { oils: req('./db/oils.js'), sugars: req('./db/sugars.js'),
        additives: req('./db/additives.js'), labels: req('./db/labels.js'),
        allergens: req('./db/allergens.js'), categories: req('./categories.js'),
        provenance: req('./db/provenance.js') }
    : root.AIR.db;
  const api = factory(db);
  if (req) module.exports = api;
  else { root.AIR = root.AIR || {}; root.AIR.engine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (db) {

const { oils, sugars, additives: add, labels } = db;

const NOVA_BASE = { 1: 96, 2: 90, 3: 80, 4: 60 };
const BANDS = [[90, 'Excellent'], [75, 'Good'], [50, 'Mediocre'], [25, 'Poor'], [0, 'Avoid']];
const SCORE_FLOOR = 3;

// The top of the scale had no resolution: 12 of 38 corpus products landed on exactly 100, including
// plain organic milk, A2 grass-fed milk from a regenerative dairy, refined coconut oil and wild
// sockeye salmon. Clipping threw away the difference precisely where someone choosing between two
// good products needs it.
//
// Rather than lowering every base and re-anchoring the whole corpus, the excess above CEIL_KNEE is
// compressed asymptotically. Anything scoring below the knee is completely untouched, so every
// calibration decision already made below 88 still holds; above it, products separate by how far
// they overshot instead of all piling onto the same number.
const CEIL_KNEE = 88;
const CEIL_SOFTNESS = 12;
function softCeiling(raw) {
  if (raw <= CEIL_KNEE) return raw;
  const over = raw - CEIL_KNEE;
  return CEIL_KNEE + (100 - CEIL_KNEE) * (1 - Math.exp(-over / CEIL_SOFTNESS));
}

// Label copy routinely advertises absence — "No artificial colors, free of preservatives".
// Without this a denial reads as a presence and clean products get condemned for their own
// marketing. This was a live bug; see tests/adversarial.js.
// Denials come in far more shapes than the first version handled. Confirmed failures that used to
// hard-cap clean products: "Made with no artificial colors", "Made without...", "Free from...",
// "Absolutely no...", "100% free of..." (the % broke the delimiter), and the suffix form "MSG free".
// Delimiters now include % and dashes, the vocabulary is broader, and a separate pass handles
// "<thing> free" / "<thing>-free", which reads backwards from every prefix rule.
const NEGATION = /(^|[.;,()%\-–—])\s*(?:\d+%\s*)?(?:(?:made|produced|prepared|formulated|packed)\s+(?:with\s+)?|certified\s+|absolutely\s+|completely\s+|totally\s+|guaranteed\s+)?(?:contains\s+)?(?:no|non|not|never|none|free\s+(?:of|from)|without|zero|devoid\s+of|0g?\s+of)\b[^.;,()]*/gi;
const NEGATION_SUFFIX = /\b[a-z][a-z0-9 '&-]{1,28}?[- ]free\b/gi;
const stripNegations = t => t.replace(NEGATION, '$1 ').replace(NEGATION_SUFFIX, ' ');

// ...but ONLY on those claim surfaces. Run over an ingredient list it is destructive, because it
// consumes from the negation word to the next delimiter and a comma is the delimiter — so the rest
// of the ingredient goes with it. "Water, Non-GMO Soybean Oil, Sugar" became "Water, , Sugar": the
// most heavily penalised ingredient class in the engine, erased by its own marketing adjective, and
// a product that should cap at 25 read 68. "Non-GMO Canola Oil" is on a large share of US panels.
//
// An ingredient list gets entry-level treatment instead. A parsed entry is dropped only when the
// WHOLE entry is a denial, so "made with no artificial colors" goes and "non-gmo soybean oil"
// stays and still trips the cap. Note there is no bare `non` here on purpose: "non-dairy creamer"
// and "nonfat dry milk" are ingredients, not denials.
// A denial's scope is its object: "free from artificial colors" denies the colours, and the
// entry is pure marketing. But "no cholesterol added soybean oil" denies the cholesterol, and the
// soybean oil is a real ingredient that must still cap. Dropping the entry wholesale gets the
// first right and launders the second; keeping it gets the second right and re-fires a false
// colour cap on the first. So the object is identified rather than assumed.
//
// `non` is deliberately absent from the head: "non-gmo", "non-dairy" and "nonfat" are adjectives
// on real ingredients, and it was bare `non` in the old NEGATION pattern that erased
// "Non-GMO Soybean Oil" down to nothing. `not` excludes "not from concentrate", which is a juice.
const DENIAL_HEAD = /^(?:\d+%\s*)?(?:(?:made|produced|prepared|formulated|packed)\s+(?:with\s+)?|certified\s+|absolutely\s+|completely\s+|totally\s+|guaranteed\s+)?(?:contains\s+)?(?:no|not(?!\s+from\b)|never|none|free\s+(?:of|from)|without|zero|devoid\s+of|0\s*g?\s+of)\b/i;
const DENIAL_SUFFIX_ENTRY = /^[a-z][a-z0-9 '&-]{0,28}[- ]free$/i;
const CLAIM_ENTRY = /^(?:non[- ]?gmo|gmo[- ]free|all[- ]natural|kosher|halal|certified [a-z ]+)$/i;

// True when the whole entry is a claim and carries no ingredient worth scoring.
// CAPS is defined below; this only ever runs from score(), by which point it exists.
function isDenialEntry(entry) {
  if (DENIAL_SUFFIX_ENTRY.test(entry) || CLAIM_ENTRY.test(entry)) return true;
  const head = entry.match(DENIAL_HEAD);
  if (!head) return false;
  const after = entry.slice(head[0].length).trim();
  if (!after) return true;                       // "contains no" and nothing else
  for (const c of CAPS) {
    const hit = after.match(c.m);
    if (!hit) continue;
    // Words between the negation and the capped term. None or one means the cap IS what is being
    // denied, so the entry is a claim. More than that means the denial was about something else
    // and this entry still names a disqualifying ingredient — keep it, and let it cap.
    const gap = after.slice(0, hit.index).trim().split(/\s+/).filter(Boolean).length;
    if (gap > 1) return false;
  }
  return true;
}

// "Butter" is a cooking fat; "peanut butter" and "cocoa butter" are not.
const NOT_REAL_BUTTER = /(peanut|almond|cashew|sunflower|seed|nut|cocoa|shea|apple|soy|coconut)\s+butter|\bbutter\s+(flavou?r|powder|solids|substitute)\b|\bartificial\s+butter\b/gi;

// Fermentation-derived acids come from culturing, not from an added industrial acid.
const FERMENT_ACID = /\b(cultured|encapsulated|fermented)\b[^,]{0,25}(lactic|citric) acid/i;

// ---------------------------------------------------------------- rule assembly
// Each penalty rule is tagged with how strongly it signals ultra-processing, so the NOVA
// classifier derives from the same rules the penalties do rather than a duplicate marker list.
function tag(rules, mode, group, cat) {
  return rules.filter(r => (r.pts || 0) > 0).map(r => ({
    ...r,
    group,
    cat: r.cat || cat || group,
    upf: typeof mode === 'function' ? mode(r) : mode,
  }));
}
// A few rule sets mix two concerns. Glutamates sit in the flavour table but are their own category
// so a user can care about MSG without also down-weighting "natural flavors".
const GLUTAMATE = /msg|glutamate|yeast extract|hydrolyzed|ribonucleotide|torula/i;
const byPts = threshold => r => (r.pts >= threshold ? 'hard' : 'soft');

const PENALTIES = [
  ...tag(add.ISOLATES, 'hard', 'isolate'),
  ...tag(add.FLAVOURS, 'hard', 'flavour').map(r => (GLUTAMATE.test(r.why) ? { ...r, cat: 'glutamate' } : r)),
  ...tag(add.TEXTURE, byPts(12), 'texture'),
  ...tag(add.PRESERVATIVES, 'hard', 'preservative'),
  ...tag(add.PROCESSING, byPts(12), 'processing', 'processingAid'),
  ...tag(add.FORTIFICATION, byPts(7), 'fortification'),
  ...tag(add.GRAINS, byPts(12), 'grain'),
  ...tag(labels.DAIRY_PENALTY, 'soft', 'dairy', 'dairyProcessing'),
  ...tag(sugars.REFINED, 'soft', 'sugar'),   // sugar is penalised, but sugar alone is not ultra-processing
  ...tag(sugars.TRADITIONAL, 'none', 'sugar'),
  ...tag(sugars.ALCOHOLS, 'hard', 'sweetener', 'sweetener'),
];

// A product listing twelve synthetic vitamins is doing one thing — fortifying — not twelve. Without
// this, breakfast cereal collapsed to the score floor purely by stacking. Within a group the worst
// offender counts in full, each additional one counts a quarter, and the group is capped at 1.6x
// its own worst entry.
// Death by a thousand cuts is not the same as one disqualifying ingredient. Raw penalty totals are
// passed through a saturation curve so that more problems always lower the score, but a long
// ingredient list can never on its own drive a product below the genuinely disqualifying ones —
// that job belongs to the hard caps.
const PENALTY_SATURATION = 55;
const saturate = total => Math.round(PENALTY_SATURATION * (1 - Math.exp(-total / PENALTY_SATURATION)));

const GROUP_EXTRA = 0.25;
const GROUP_CEIL = 1.6;
function collapse(hits) {
  const byGroup = new Map();
  for (const h of hits) {
    const g = h.group || h.why;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(h);
  }
  const kept = [];
  let total = 0;
  for (const [, list] of byGroup) {
    list.sort((a, b) => b.off - a.off);
    const max = list[0].off;
    let sum = max;
    list[0].scaled = max;
    for (let i = 1; i < list.length; i++) {
      const extra = Math.max(1, Math.round(list[i].off * GROUP_EXTRA));
      list[i].scaled = Math.min(extra, Math.max(0, Math.round(max * GROUP_CEIL) - sum));
      sum += list[i].scaled;
    }
    sum = Math.min(sum, Math.round(max * GROUP_CEIL));
    total += sum;
    kept.push(...list.filter(h => h.scaled > 0));
  }
  return { kept, total };
}

// Hard caps from every source that can set a ceiling.
const CAPS = [
  { m: oils.TRANS.m, cap: oils.TRANS.cap, why: oils.TRANS.why, cat: 'transFat' },
  // `soften` lifts the ceiling when the ingredient itself carries a cold-pressed / unrefined
  // qualifier. oils.js has said this softening exists since the file was written, but UNREFINED
  // was never exported and never referenced, so "cold-pressed unrefined sunflower oil" was capped
  // at 25 identically to the refined version — while labels.BONUSES paid points for the same
  // words. Softened rather than lifted: mechanical pressing changes the extraction, not the fact
  // that these are high-linoleic oils.
  ...oils.HARD.map(o => ({ m: o.m, cap: 25, why: `${o.why} — refined seed oil`, cat: 'refinedOil',
                           unless: oils.UNREFINED, soften: 55 })),
  ...add.CAPS,
  ...sugars.INDUSTRIAL.map(x => ({ ...x, cat: 'industrialSyrup' })),
  ...sugars.ARTIFICIAL.map(x => ({ ...x, why: `${x.why} — artificial sweetener`, cat: 'artificialSweetener' })),
];

// ---------------------------------------------------------------- recognition coverage
//
// The engine penalises what it recognises, so anything it does not recognise is free. That makes
// silence indistinguishable from cleanliness: an unknown single ingredient scores 93, and the same
// product scored 5 in English and 80 in Spanish purely because none of the rules are in Spanish.
// novaClass already refuses to call unrecognised text NOVA 1 for this reason; coverage extends the
// same scepticism to the score as a whole.
//
// This measures how much of the list the rulebase can actually see. The caller decides what to do
// with a low number — content/main.js declines to show a score rather than showing a confident
// wrong one.
//
// Vocabulary that is unmistakably an ingredient panel but matches no scoring rule, so a clean
// short list is never mistaken for an unreadable one. Deliberately generous: being liberal with
// ENGLISH food nouns costs the gate nothing, because the text this is meant to catch — another
// language, OCR noise, a cosmetics panel — will not match English food words either. Matched
// anywhere in the entry, since "turmeric root powder" should count as much as "turmeric".
const COMMON_PANEL = new RegExp('\\b(?:' + [
  // panel staples
  'water|salt|spices?|herbs?|seasoning|vinegar|yeast|baking soda|baking powder|sodium bicarbonate',
  'culture|cultures|rennet|enzymes?|pectin|gelatin|agar|broth|stock|juice|puree|paste|extract',
  // beverages and their raw forms
  'tea|green tea|black tea|matcha|coffee|arabica|robusta|espresso|chicory|kombucha|cocoa|cacao|chocolate',
  // aromatics, spices, seasonings
  'vanilla|cinnamon|turmeric|ginger|paprika|cumin|coriander|oregano|basil|thyme|rosemary|sage|dill',
  'nutmeg|clove|cardamom|allspice|fennel|anise|saffron|chili|chilli|cayenne|peppercorns?|mustard',
  'garlic|onion|shallot|leek|celery|parsley|cilantro|bay leaf|bay leaves|lemongrass|mint',
  // produce
  'tomato|potato|carrot|cabbage|cauliflower|broccoli|spinach|kale|lettuce|cucumber|zucchini|squash',
  'pumpkin|beet|beetroot|turnip|radish|asparagus|artichoke|pepper|eggplant|aubergine|mushrooms?',
  'apple|banana|orange|lemon|lime|grape|berry|berries|mango|pineapple|peach|pear|plum|cherry|melon',
  'avocado|olive|coconut|date|fig|raisin|apricot|cranberry|currant',
  // grains, legumes, seeds, nuts
  'oats?|rice|quinoa|barley|millet|sorghum|buckwheat|amaranth|teff|rye|spelt|farro|couscous|pasta',
  'beans?|lentils?|chickpeas?|peas?|soy|edamame|tofu|tempeh|hummus',
  'chia|flax|linseed|hemp|sesame|tahini|sunflower seeds?|pumpkin seeds?|poppy',
  'almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamias?|peanuts?|nuts?',
  'flour|starch|bran|germ|semolina|masa|tapioca|arrowroot|cornmeal',
  // animal foods
  'beef|pork|chicken|turkey|lamb|duck|bison|veal|venison|goat|liver|bone|gelatine',
  'fish|salmon|tuna|cod|halibut|sardines?|anchov(?:y|ies)|mackerel|trout|shrimp|crab|scallops?|oysters?',
  'milk|cream|butter|cheese|yogh?urt|kefir|ghee|whey|curd|eggs?',
  // seaweed, fungi, ferments
  'nori|kombu|wakame|seaweed|kelp|spirulina|chlorella|miso|kimchi|sauerkraut|sourdough|nutritional yeast',
  'honey|maple|molasses|syrup',
  // Fortification vocabulary, which real cereal panels are full of. Without it a fortified product
  // reads as barely recognisable: Kellogg's Frosted Flakes measured 44% coverage against live
  // Amazon text, uncomfortably close to the 34% floor for a list the engine reads perfectly well.
  'corn|maize|vitamins?|minerals?|malt|niacin|thiamin[e]?|riboflavin|folate|folic|pyridoxine',
  'cobalamin|tocopherol|ascorb(ic|ate)|calcium|iron|zinc|magnesium|potassium|phosphate',
  // Non-English staples, so a Spanish/French panel that DOES hit the cap rules above clears the
  // coverage gate and gets scored rather than declined.
  'agua|eau|wasser|sal|sel|salz|az[uú]car|sucre|zucker|leche|lait|milch|harina|farine|mehl',
  'aceite|huile|[öo]l|jarabe|sirop|jugo|jus|saft|ma[ií]z|ma[ïi]s|trigo|bl[ée]|arroz|riz|reis',
  'soja|girasol|tournesol|colza|vegetal|v[ée]g[ée]tale|almid[óo]n|amidon|levadura|levure',
].join('|') + ')\\b', 'i');

function recognitionCoverage(list) {
  if (!list.length) return 0;
  let seen = 0;
  for (const ing of list) {
    const known =
      labels.WHOLE.some(w => w.test(ing))
      || labels.CULINARY.test(ing)
      || COMMON_PANEL.test(ing)
      || sugars.FREE.some(f => f.test(ing))
      || PENALTIES.some(r => r.m.test(ing))
      || CAPS.some(c => c.m.test(ing))
      || labels.BONUSES.some(b => b.m.test(ing));
    if (known) seen++;
  }
  return seen / list.length;
}

// ---------------------------------------------------------------- parsing
const tidy = s => s.replace(/^[\s*•\-–]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
const usable = s => s.length > 1 && s.length < 80;

// Split on commas at the TOP level only, leaving parenthesised sub-lists attached to their parent.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, buf = '';
  for (const ch of text) {
    if (ch === '(') { depth++; buf += ch; }
    else if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; }
    else if (depth === 0 && (ch === ',' || ch === ';' || ch === '.')) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

// One top-level ingredient becomes its own head plus any sub-ingredients it declares, and they all
// share its position. This is the point: position is a proxy for how much of the product something
// is, and a sub-ingredient of the first item is not the seventh most abundant thing in the jar.
//
// Flattening parentheses into the main list made the engine reward opacity. "Enriched Flour, Sugar"
// charged sugar 13 points at position 1; spelling out the flour's own six sub-ingredients pushed
// sugar to position 7, where the weight drops to 0.5, and the same sugar cost 5. A manufacturer got
// a better score on everything downstream by disclosing more.
function expandEntry(part) {
  const pieces = [part.replace(/\([^)]*\)/g, ' ')];
  for (const m of part.matchAll(/\(([^)]*)\)/g)) pieces.push(...m[1].split(/[,;]/));
  return pieces.map(tidy).filter(usable);
}

// [{ ing, pos }] where pos is the TOP-LEVEL position, shared by an ingredient's own sub-list.
function parseEntries(text) {
  const flat = text.replace(/\b(contains \d+% or less of|less than \d+% of|\d+% or less of|and\/or)\b/gi, ',');
  const out = [];
  splitTopLevel(flat).forEach((part, pos) => {
    for (const ing of expandEntry(part)) out.push({ ing, pos });
  });
  return out;
}

function parse(text) {
  return parseEntries(text).map(e => e.ing);
}

// Earlier ingredients make up more of the product, so they carry more weight. Indexed by TOP-LEVEL
// position: a sub-ingredient declared inside the first item shares the first item's weight.
const weight = i => (i === 0 ? 1.5 : i <= 2 ? 1.25 : i <= 6 ? 1.0 : 0.5);

// ---------------------------------------------------------------- NOVA
function novaClass(list, text, hardHits, softHits) {
  if (hardHits > 0) return 4;
  if (softHits >= 3) return 4;
  if (list.length === 1) {
    if (labels.CULINARY.test(list[0])) return 2;
    if (labels.WHOLE.some(w => w.test(list[0]))) return 1;
    return 2;
  }
  if (list.length <= 3 && list.every(i => labels.CULINARY.test(i))) return 2;
  if (softHits >= 1) return 3;
  if (labels.PROCESSED_SIGNAL.test(text)) return 3;
  if (list.length <= 5 && list.every(i => labels.WHOLE.some(w => w.test(i)))) return 1;
  // A short list whose FIRST ingredient is a recognised whole food is overwhelmingly that food —
  // "Atlantic Salmon, Color Added" is salmon with a note, not a manufactured product. Class 2
  // rather than 1, because the trailing ingredients are still doing something.
  if (list.length <= 3 && labels.WHOLE.some(w => w.test(list[0]))) return 2;
  // Unrecognised is NOT the same as minimally processed. Falling back to NOVA 1 here gave soy
  // sauce a base of 96 simply because "soybeans" and "alcohol" are not in the whole-food list.
  // Anything we cannot positively identify as whole or culinary is treated as processed.
  return 3;
}

// ---------------------------------------------------------------- nutrition panel
// Off by default (every weight here defaults to 0). When a user turns one on, it scores grams and
// milligrams from the product's own nutrition facts rather than from the ingredient list, so it is
// only available when the page actually publishes those numbers.
const NUTRITION = [
  { cat: 'sodium',       field: 'sodium',       why: 'Sodium per serving',
    calc: v => Math.min(20, Math.max(0, (v - 300) / 45)), unit: 'mg', sign: -1 },
  { cat: 'saturatedFat', field: 'saturatedFat', why: 'Saturated fat per serving',
    calc: v => Math.min(20, Math.max(0, (v - 5) * 1.2)), unit: 'g', sign: -1 },
  { cat: 'totalSugar',   field: 'sugar',        why: 'Total sugar per serving',
    calc: v => Math.min(25, Math.max(0, (v - 10) * 0.9)), unit: 'g', sign: -1 },
  { cat: 'fibre',        field: 'fibre',        why: 'Dietary fibre',
    calc: v => Math.min(10, Math.max(0, v * 0.9)), unit: 'g', sign: +1 },
  { cat: 'protein',      field: 'protein',      why: 'Protein',
    calc: v => Math.min(10, Math.max(0, v * 0.3)), unit: 'g', sign: +1 },
];

// ---------------------------------------------------------------- scoring
// options: { weights, allergens, diets, avoidList }
function score(product, options = {}) {
  const W = db.categories ? db.categories.resolveWeights(options.weights) : {};
  const w_ = id => (id in W ? W[id] : 1);
  const rawTxt = product.ingredients_text || '';
  // Parse the list as written, then drop only the entries that are themselves denials. The
  // scoring surface is rebuilt from what survives, so caps and penalties see the real ingredients
  // and never see "no artificial colors". See DENIAL_ENTRY above for why this replaced running
  // stripNegations() over the list.
  const entries = parseEntries(rawTxt).filter(e => !isDenialEntry(e.ing));
  // Close the gaps left by dropped claim entries, so a leading "no artificial colors" does not
  // leave the real first ingredient sitting at position 1.
  const dense = new Map();
  for (const e of entries) if (!dense.has(e.pos)) dense.set(e.pos, dense.size);
  for (const e of entries) e.pos = dense.get(e.pos);
  const list = entries.map(e => e.ing);
  const txt = list.join(', ');

  // "Cultured dextrose" and "cultured celery powder" are preservative systems, not living food.
  // Without this the same panel showed "-8 a preservative in disguise" and "+6 Fermented / live
  // cultures" for the same ingredient, so the preservative improved the score.
  const bonusText = txt.replace(/\bcultured\s+(dextrose|celery|sugar|corn syrup|wheat|whey)\b[^,;.]*/gi, ' ');

  // Only the ingredient list is strong evidence. Seller-written surfaces — the marketing title AND
  // the feature bullets — are claims, worth half and labelled unverified. Bullets used to feed the
  // strong path, which let "100% GRASS-FED" ad copy add full points to a soy-protein-isolate bar.
  const hayStrong = ((product.certifications || '') + ' ' + bonusText).toLowerCase().replace(NOT_REAL_BUTTER, '$1 spread');
  // The seller-written title and bullets are exactly the surface stripNegations() was written for:
  // "Made without artificial colors" is an absence, and reading it as a presence condemned clean
  // products for their own marketing. This is where that pass belongs, and it used to be missing
  // here while running over the ingredient list instead.
  const hayTitle = stripNegations((product.name || '') + ' ' + (product.labels || ''))
    .toLowerCase().replace(NOT_REAL_BUTTER, '$1 spread');

  const prov = db.provenance;
  const kindInfo = prov ? prov.classify(product.ingredients_text || product.name || '') : null;

  const PROVENANCE_CRITICAL = ['beef', 'lamb', 'pork', 'poultry', 'egg', 'seafood'];
  const provenanceApplies = !!(kindInfo && (kindInfo.animal || kindInfo.seafood) && list.length <= 4);
  // Only the critical kinds hand sourcing over to the provenance block entirely. For dairy and
  // produce the generic label bonuses still apply, otherwise grass-fed butter quietly lost the
  // credit it had before this feature existed.
  const provenanceOwnsSourcing = provenanceApplies && PROVENANCE_CRITICAL.includes(kindInfo.kind);

  const good = [], bad = [], seen = new Set();
  const hits = [];
  let hardHits = 0, softHits = 0;
  const tradPrep = add.TRADITIONAL_PREP.test(txt);

  entries.forEach(({ ing, pos }) => {
    const w = weight(pos);

    const isFreeSugar = sugars.FREE.some(f => f.test(ing));
    if (isFreeSugar && !seen.has('freesugar')) {
      seen.add('freesugar');
      // Fruit and dairy sugar is exempt by default. Turning the 'naturally occurring sugars'
      // weight up scores it like any other sugar — the exemption alone was not enough, because
      // dates and milk match no sugar rule to begin with, so lifting it changed nothing.
      const natural = w_('naturalSugar');
      if (natural > 0) {
        hits.push({ off: Math.round(8 * w * natural), why: 'Naturally occurring sugar', ing,
                    group: 'sugar', cat: 'naturalSugar' });
      } else {
        good.push({ c: 0, why: 'Natural sugar (fruit or dairy) — not counted against the score', ing });
      }
    }

    for (const r of PENALTIES) {
      if (seen.has(r.why)) continue;
      // Sugar that comes with its whole food is exempt unless the user turns 'naturally occurring
      // sugars' on, at which point it is scored like any other sugar.
      if (isFreeSugar && r.group === 'sugar' && w_('naturalSugar') === 0) continue;
      // Traditional preparation (sourdough, sprouting, soaking) halves the grain penalty rather
      // than erasing it — zeroing it while also paying a bonus double-counted the same fact and
      // pushed sprouted bread to 95.
      const tradRelief = (r.gluten && tradPrep) ? 0.5 : 1;
      if (/citric acid|lactic acid/i.test(r.why) && FERMENT_ACID.test(ing)) continue;
      if (r.exemptIf && r.exemptIf.test(ing)) continue;
      if (r.exemptIfText && r.exemptIfText.test(txt)) continue;
      if (!r.m.test(ing)) continue;
      seen.add(r.why);
      const scaled = r.pts * w * w_(r.cat) * tradRelief;
      if (scaled < 0.5) continue;                       // category switched off by the user
      hits.push({ off: Math.round(scaled), why: r.why, ing, group: r.group, cat: r.cat });
      // A sprouted or sourdough grain is a processing-level 3 signal, not a marker of ultra-
      // processing. Counting it toward the UPF tally pushed Ezekiel bread to NOVA 4.
      if (r.gluten && tradPrep) continue;
      if (r.upf === 'hard') hardHits++;
      else if (r.upf === 'soft') softHits++;
    }
  });

  const { kept, total: rawPenalty } = collapse(hits);
  const nova = novaClass(list, txt, hardHits, softHits);
  const listPenalty = list.length > 20 ? 8 : 0;
  const rawTotal = rawPenalty + listPenalty;
  const penalty = saturate(rawTotal);

  // The panel shows a line per problem. Those lines must add up to the score the user is looking
  // at, so the saturation discount is distributed back across them proportionally rather than
  // applied invisibly at the end. Largest remainder gets the rounding slack.
  const shown = kept.map(h => ({ raw: h.scaled, why: h.why, ing: h.ing }));
  if (listPenalty) shown.push({ raw: listPenalty, why: `Very long ingredient list (${list.length} items)` });
  if (rawTotal > 0 && shown.length) {
    // Largest-remainder allocation. Every row gets at least 1 point when there is room for it,
    // and the leftover is corrected against the biggest rows in whichever direction it lands, so
    // the displayed numbers sum to exactly `penalty` rather than approximately.
    const ratio = penalty / rawTotal;
    const floorAt = penalty >= shown.length ? 1 : 0;
    shown.sort((a, b) => b.raw - a.raw);
    const alloc = shown.map(h => Math.max(floorAt, Math.round(h.raw * ratio)));
    let sum = alloc.reduce((a, b) => a + b, 0);
    for (let i = 0; sum > penalty; i = (i + 1) % alloc.length) {
      if (alloc[i] > floorAt) { alloc[i]--; sum--; }
      else if (alloc.every(a => a <= floorAt)) break;
    }
    for (let i = 0; sum < penalty; i = (i + 1) % alloc.length) { alloc[i]++; sum++; }
    shown.forEach((h, i) => { h.c = -alloc[i]; });
  }
  for (let i = shown.length - 1; i >= 0; i--) if (shown[i].c === 0) shown.splice(i, 1);
  for (const h of shown) bad.push({ c: h.c, why: h.why, ing: h.ing });

  // The processing weight scales how far the NOVA class pulls the starting score down from 100.
  // Weight 0 means processing level is ignored entirely and every product starts at 100.
  const baseRaw = NOVA_BASE[nova];
  const base = Math.round(100 - (100 - baseRaw) * w_('processing'));
  let pts = base - penalty;

  // bonuses
  // When the provenance block is active it scores sourcing with far better resolution (verified vs
  // claimed, per certification). Paying the generic label bonus as well double-counts the same fact.
  const PROV_OVERLAP = /grass-fed|pasture|wild-caught|organic|regenerativ|non-gmo/i;
  let bonus = 0, titleBonus = 0;
  for (const b of labels.BONUSES) {
    if (provenanceOwnsSourcing && PROV_OVERLAP.test(b.why)) continue;
    if (bonus >= labels.BONUS_CAP) break;
    const strong = b.m.test(hayStrong);
    const titleOnly = !strong && b.m.test(hayTitle);
    if (!strong && !titleOnly) continue;
    if (titleOnly && titleBonus >= labels.TITLE_BONUS_CAP) continue;
    const worth = Math.round((titleOnly ? b.pts / 2 : b.pts) * w_(b.cat));
    const room = titleOnly
      ? Math.min(labels.BONUS_CAP - bonus, labels.TITLE_BONUS_CAP - titleBonus)
      : labels.BONUS_CAP - bonus;
    const add_ = Math.min(worth, room);
    if (add_ <= 0) continue;
    bonus += add_;
    if (titleOnly) titleBonus += add_;
    good.push({ c: +add_, why: titleOnly ? `${b.why} (label claim, unverified)` : b.why });
  }
  pts += bonus;

  const simple = Math.round(4 * w_('simplicity'));
  if (list.length <= 1 && simple > 0) { pts += simple; good.push({ c: +simple, why: 'Single-ingredient whole food' }); }

  // hard caps
  let cap = 100, capWhy = null;
  for (const c of CAPS) {
    if (!c.m.test(txt)) continue;
    let ceiling = c.cap;
    if (c.unless) {
      // Checked per entry, not against the whole text: a product listing both "sunflower oil" and
      // "cold-pressed olive oil" must keep the sunflower cap. Only when every entry naming this
      // oil carries the qualifier does the softer ceiling apply.
      const naming = list.filter(i => c.m.test(i));
      if (naming.length && naming.every(i => c.unless.test(i))) ceiling = c.soften;
    }
    // A ceiling of 25 at weight 1 becomes no ceiling at weight 0 and a ceiling of 0 at weight 2.
    // Clamped at the floor: at weight 2 the arithmetic can produce a negative ceiling, which then
    // escaped the band lookup entirely and crashed on an undefined verdict.
    const eff = Math.max(SCORE_FLOOR, Math.round(100 - (100 - ceiling) * w_(c.cat)));
    if (eff >= 100) continue;                            // category switched off by the user
    if (eff < cap) { cap = eff; capWhy = c.why; }
    if (!bad.some(h => h.why === c.why)) bad.push({ c: 'CAP', why: `${c.why} — caps score at ${eff}` });
  }

  // Nutrition-panel categories, when the page supplied numbers and the user enabled them.
  const nut = product.nutrition || null;
  if (nut) {
    // Normalise to 100g where the label declares a serving weight. Without this a cereal declaring
    // a 28g serving scores better than an identical one declaring 55g, purely on packaging choice.
    const grams = nut.servingGrams;
    let per100 = (grams && grams > 0) ? (100 / grams) : 1;
    // Defence in depth against a serving weight read off the wrong line. No food contains more
    // than 100g of a macronutrient per 100g, and nothing out-salts pure salt, so a normalisation
    // that produces one is arithmetic on a parse error rather than a fact about the product.
    // Seen in the wild shape: a 1g "serving" turned 2g of sugar into 200g per 100g and dropped
    // plain bread from 54 to 15 under the conventional-nutrition preset.
    if (per100 !== 1) {
      const impossible =
        ['saturatedFat', 'sugar', 'addedSugar', 'fibre', 'protein']
          .some(f => typeof nut[f] === 'number' && nut[f] * per100 > 100)
        || (typeof nut.sodium === 'number' && nut.sodium * per100 > 40000);
      if (impossible) per100 = 1;                     // score per serving instead, and say so
    }
    if (per100 !== 1) nut._normalised = true;
    for (const n of NUTRITION) {
      const weight = w_(n.cat);
      if (!weight) continue;
      const raw = nut[n.field];
      if (typeof raw !== 'number' || !isFinite(raw)) continue;
      const v = Math.round(raw * per100 * 10) / 10;
      const amount = Math.round(n.calc(v) * weight);
      if (amount < 1) continue;
      const label = nut._normalised
        ? `${n.why.replace(/ per serving$/, '')} per 100g`
        : n.why;
      const shown = nut._normalised ? `${v}${n.unit}/100g` : `${raw}${n.unit}`;
      if (n.sign < 0) { pts -= amount; bad.push({ c: -amount, why: label, ing: shown }); }
      else { pts += amount; good.push({ c: +amount, why: label, ing: shown }); }
    }
  }

  // ---- provenance -------------------------------------------------------------------------
  // For a whole food the ingredient list says almost nothing. "Ground Beef" is one ingredient
  // whether the animal lived on pasture or in a feedlot, and without this block the engine scores
  // both about 96. Certifications are the only place the difference is written down.
  let provenance = null;
  if (provenanceApplies) {
    // Two evidence pools of different quality: structured certification data and the record from
    // the shared database count as verified; seller-written title and bullets are claims.
    const record = product.provenanceRecord || null;
    // Three qualities of evidence, kept distinct: Amazon's structured certification widget, a
    // shared-database record, and a producer registry entry confirmed against a certifier's own
    // directory. All three count as verified; the seller's title and bullets never do.
    const registry = record && record.producerRegistry ? record.producerRegistry : null;
    const strong = [
      product.certifications || '',
      record ? (record.certifications || '') : '',
      registry ? (registry.certifications || '') : '',
    ].join(' ');
    const claimed = [product.name || '', product.labels || '', txt].join(' ');

    // Hollow claims are things the SELLER said, so they are read off the seller's surfaces only.
    // Reading them off `claimed`, which includes the ingredient text, made "natural flavors" in a
    // chicken breast's ingredient list render as '"Natural" means nothing here' — a rebuttal to a
    // claim nobody made.
    const marketing = [product.name || '', product.labels || ''].join(' ');
    const hollow = w_('hollowClaims') ? prov.detectHollowClaims(marketing, kindInfo) : [];

    // A whole animal food starts from "we don't know how this was produced" and certifications buy
    // that back. Adding them on top instead left an uncertified "grass-fed" claim and an audited
    // AGA certification both pinned at 100, which defeats the entire point of the distinction.
    const PROV_CAP = 22;
    // The penalty is for absent VERIFICATION, not for being a whole food, so it clears once a
    // third-party certification exists. A flat cost applied on top of every whole food punished
    // well-sourced products (organic grass-fed milk fell to 75) instead of only silent ones.
    // Scoped to foods where production method genuinely changes the product. For beef the
    // difference between pasture and feedlot is enormous and the label is the only clue; plain
    // dairy varies far less, and charging it the same penalty dropped ordinary whole-milk yoghurt
    // to 68, which is a worse answer than the one this feature was added to fix.
    const critical = provenanceOwnsSourcing;
    const verified = prov.detectCertifications(strong, kindInfo.kind);
    const claims = prov.detectCertifications(claimed, kindInfo.kind)
      .filter(c => !verified.some(v => v.id === c.id));
    const undisclosed = !critical || verified.length ? 0 : (claims.length ? 10 : 14);
    const unknownCost = Math.round(undisclosed * w_('provenanceUnknown'));
    let gained = 0;
    for (const c of verified) {
      const add = Math.min(Math.round(c.pts * w_('provenanceVerified')), PROV_CAP - gained);
      if (add <= 0) continue;
      gained += add;
      good.push({ c: +add, why: `${c.label} — verified` });
    }
    for (const c of claims) {
      const add = Math.min(Math.round((c.pts / 2) * w_('provenanceClaimed')), PROV_CAP - gained);
      if (add <= 0) continue;
      gained += add;
      good.push({ c: +add, why: `${c.label}, unverified` });
    }
    pts += gained;

    if (unknownCost > 0) {
      pts -= unknownCost;
      bad.push({ c: -unknownCost, why: verified.length || claims.length
        ? 'Production method not fully disclosed — certifications below earn this back'
        : 'No sourcing information — feed, confinement and origin are undisclosed' });
    }

    provenance = {
      kind: kindInfo.kind,
      verified: verified.map(c => ({ id: c.id, label: c.label, means: c.means, tier: c.tier })),
      claims: claims.map(c => ({ id: c.id, label: c.label, means: c.means, tier: c.tier })),
      hollow: hollow.map(h => ({ id: h.id, label: h.label, why: h.why })),
      gained, unknownCost,
      source: record ? (record.source || 'shared-database') : 'page',
    };
  }

  // Flags never move the score. "Does this contain dairy" is a different question from "is this a
  // good product", and answering both with one number helps nobody.
  const flags = db.allergens
    ? [...db.allergens.detect(list, options.allergens || [], options.diets || []),
       ...db.allergens.matchAvoidList(list, options.avoidList || [])]
    : [];

  // How much of this list the rulebase could actually read. Reported, never scored — a low number
  // means "we cannot assess this", which is a different statement from a low score.
  const coverage = recognitionCoverage(list);

  const rawTotal_ = Math.round(pts);
  // Ceiling only at this point. The floor and the hard cap are applied AFTER the display rows are
  // reconciled below, and each pushes its own row, so every clamp stays visible in the panel.
  let final = Math.min(100, Math.round(softCeiling(pts)));

  // The panel prints a number beside every line, and those lines have to add up to the score the
  // user is looking at. The soft ceiling shaves points off the total after the fact, which would
  // leave the panel showing "base 80, +15" beside a score of 93 — an arithmetic lie of exactly the
  // kind tests/arithmetic.test.js exists to catch.
  //
  // So the shave is pushed back into the display rather than hidden. Bonus rows absorb it first,
  // biggest first, because bonuses are what carried the product into compressed territory; each row
  // keeps at least 1 point so an earned bonus never displays as nothing. Whatever is left comes off
  // the starting score. Nothing below the knee is touched, so this is inert for most products.
  let displayBase = base;
  let shave = rawTotal_ - final;
  if (shave > 0) {
    for (const g of good.slice().sort((a, b) => b.c - a.c)) {
      if (shave <= 0) break;
      const take = Math.min(shave, Math.max(0, g.c - 1));
      g.c -= take;
      shave -= take;
    }
    displayBase -= shave;
  }

  // Every clamp below this line has to leave the panel adding up. The soft ceiling above is
  // redistributed into the bonus rows; the floor and the cap cannot be, because neither is a
  // proportional adjustment — a cap is a ceiling imposed on the whole product. So each one pushes
  // an explicit row carrying its own arithmetic instead of moving the score silently.
  //
  // Before this, both were applied after the reconciliation and the panel simply lied: plain
  // salted chips in safflower oil rendered "+3 minimally refined cooking fat" with no penalties
  // at all beside a red 25, and the CAP row that explained it carried no number. 7 of 47 corpus
  // products were wrong at default weights, more under the presets.
  if (final > cap) {
    const drop = final - cap;
    // Attach the arithmetic to the cap that actually binds; the others stay as bare labels.
    const row = bad.find(h => h.c === 'CAP' && h.why.startsWith(capWhy));
    if (row) { row.c = -drop; row.cap = true; }
    else bad.push({ c: -drop, cap: true, why: `${capWhy} — caps score at ${cap}` });
    final = cap;
  }
  if (final < SCORE_FLOOR) {
    good.push({ c: SCORE_FLOOR - final, why: `Score floor — the scale stops at ${SCORE_FLOOR}` });
    final = SCORE_FLOOR;
  }

  return {
    score: final,
    verdict: BANDS.find(b => final >= b[0])[1],
    nova, base: displayBase, novaBase: base, cap: capWhy, flags, provenance,
    good, bad,
    parsed: list.length,
    coverage,
    ruleCount: PENALTIES.length + CAPS.length + labels.BONUSES.length,
  };
}

return { score, parse, parseEntries, stripNegations, PENALTIES, CAPS, BANDS, NOVA_BASE };
});
