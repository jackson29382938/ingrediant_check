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
// The same denials in each label language: "sans conservateurs", "ohne Zuckerzusatz", "bez
// konserwantów" and Turkish "koruyucu içermez" stayed in the list as unreadable ingredients (90
// where "oats, salt, no preservatives" scores 94), and fused "konservierungsstofffrei" likewise.
const LOCAL_DENIAL_HEAD = /^(?:sans|sin|senza|ohne|zonder|utan|bez|sem|geen|ingen|kein(?:e[nr]?)?|aucun(?:e|s)?|ne contient (?:pas|aucun)(?: de| d['’])?|enth[äa]lt kein(?:e[nr]?)?|no contiene|non contiene|n[ãa]o cont[ée]m|bevat geen|inneh[åa]ller (?:inga|ej|inte)|nie zawiera)(?![a-zß-ÿ\u0100-\u017f])/i;
const LOCAL_DENIAL_SUFFIX = /^[a-zß-ÿ\u0100-\u017f][a-zß-ÿ\u0100-\u017f '-]{0,40}\s(?:i[çc]ermez|yoktur|kullan[ıi]lmam[ıi][şs]t[ıi]r|eklenmemi[şs]tir)$|^[a-zäöüßåæø]{3,28}(?:frei|vrij|fri)$/i;
// "(non hydrogenated)" is a claim about the oil beside it, in any language.
const CLAIM_ENTRY = /^(?:non[- ]?gmo|gmo[- ]free|all[- ]natural|kosher|halal|certified [a-z ]+|(?:first )?cold[- ]press(?:ed|ing)?|first press(?:ed|ing)?|extra virgin|unrefined|non[- ]?hydrogenated|unhydrogenated|non[- ]hydrog[ée]n[ée]e?s?|nicht geh[äa]rtet(?:e[snmr]?)?|no hidrogenad[oa]s?|n[ãa]o hidrogenad[oa]s?|non idrogenat[oaie]|niet gehydrogeneerde?|ej h[äa]rdad|oh[äa]rdad|nieuwodorniony|nie uwodorniony|hidrojenize olmayan)$/i;

// True when the whole entry is a claim and carries no ingredient worth scoring.
// CAPS is defined below; this only ever runs from score(), by which point it exists.
function isDenialEntry(entry) {
  if (DENIAL_SUFFIX_ENTRY.test(entry) || CLAIM_ENTRY.test(entry) || LOCAL_DENIAL_SUFFIX.test(entry)) return true;
  const head = entry.match(DENIAL_HEAD) || entry.match(LOCAL_DENIAL_HEAD);
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
const NOT_REAL_BUTTER = /(peanut|almond|cashew|sunflower|seed|nut|cocoa|shea|apple|soy|coconut)\s+butter|\bbutter\s+(flavou?r(?:ed|ing)?|powder|solids|substitute)\b|\bartificial\s+butter\b/gi;

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
  // An unnamed function word is charged but does not vote on the processing class: "color added"
  // on a fillet of salmon may be paprika extract, and it must not turn the fish into NOVA 3.
  // Tagged `unnamed` so score() can stand the charge down when the additive IS named alongside it:
  // "Sodium Benzoate (Preservative)" is a disclosure, not a second additive (see namedFam).
  ...tag(add.UNNAMED, 'none', 'processingAid').map(r => ({ ...r, upf: r.ultra ? 'hard' : r.upf, unnamed: true })),
  ...tag(add.PROCESSING, byPts(12), 'processing', 'processingAid'),
  ...tag(add.FORTIFICATION, byPts(7), 'fortification'),
  // Only stripped-and-re-dosed flour marks ultra-processing. Plain wheat flour sat exactly on the
  // 12-point threshold, so a four-ingredient loaf of whole-wheat bread was NOVA 4 with a base of 60
  // while a bag of sugar was NOVA 2 with a base of 90. The gluten penalty itself is unchanged —
  // that is a weight the user owns — but bread is processed, not ultra-processed.
  ...tag(add.GRAINS, r => (/enriched|bleached|refined|white/i.test(r.why) ? 'hard' : 'soft'), 'grain'),
  ...tag(labels.DAIRY_PENALTY, 'soft', 'dairy', 'dairyProcessing'),
  // sugar is penalised, but sugar alone is not ultra-processing. `refined` travels onto the panel
  // row, so the panel can tell added sugar from honey without re-listing rule names.
  ...tag(sugars.REFINED, 'soft', 'sugar').map(r => ({ ...r, refined: true })),
  ...tag(sugars.TRADITIONAL, 'none', 'sugar', 'traditionalSweetener'),
  // Weight 0 by default: only the animal-based goal counts these, and they never vote on NOVA.
  ...tag(add.PLANTS, 'none', 'plant', 'plantDefense'),
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

// A goal can set a signed category below zero (categories.js), which turns its rules into pluses:
// fat-reduced dairy under Weight loss, added vitamins under Vitamins & minerals. Those rows are
// collapsed per group like penalties (twelve vitamins are one fact) and capped in total, so a goal
// can lift a product but never launder it. Hard caps still apply after them.
const GOAL_REWARD_CAP = 20;
const goalHead = why => why.split(' — ')[0];

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
// Probiotic strains are written as a genus initial and a species: "B. breve", "L. acidophilus", and
// on Amazon's card "B, BREVE". Split at that period or comma, a kefir listing twelve strains became
// twenty-four fragments the rulebase could not read, and the label was declined as unreadable.
// joinStrains keeps each strain as one entry ("b breve"); parseEntries gives a run of them one shared
// position, the way a parenthetical sub-list shares its parent's, so twelve strains listed first do
// not push the milk to position thirteen.
const STRAIN_SPECIES = 'breve|lactis|longum|acidophilus|casei|paracasei|cremoris|plantarum|reuteri|rhamnosus'
  + '|diacetylactis|florentinus|bulgaricus|delbrueckii|thermophilus|bifidum|infantis|animalis|adolescentis'
  + '|helveticus|fermentum|salivarius|gasseri|johnsonii|kefiri|kefiranofaciens|mesenteroides|coagulans'
  + '|subtilis|boulardii|cerevisiae';
const STRAIN_JOIN = new RegExp('(^|[,;(:]\\s*)([a-z])[.,]\\s*(' + STRAIN_SPECIES + ')\\b', 'gi');
const STRAIN_ENTRY = new RegExp('^[a-z] (?:' + STRAIN_SPECIES + ')\\b', 'i');
const joinStrains = text => text.replace(STRAIN_JOIN, '$1$2 $3');

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
  // Probiotic organisms, by genus or as the "B. breve" / "L. acidophilus" short form (joined by
  // joinStrains below). A kefir that names its twelve strains is not an unreadable label.
  'bifidobacteri(?:um|a)|bifidus|lactobacill(?:us|i)|lactococcus|lacticaseibacillus|leuconostoc|saccharomyces|streptococcus thermophilus|probiotics?|live (?:and )?active cultures',
  '[a-z] (?:' + STRAIN_SPECIES + ')',
  'honey|maple|molasses|syrup',
  // Fortification vocabulary, which real cereal panels are full of. Without it a fortified product
  // reads as barely recognisable: Kellogg's Frosted Flakes measured 44% coverage against live
  // Amazon text, uncomfortably close to the 34% floor for a list the engine reads perfectly well.
  'corn|maize|vitamins?|minerals?|malt|niacin|thiamin[e]?|riboflavin|folate|folic|pyridoxine',
  'cobalamin|tocopherol|ascorb(ic|ate)|calcium|iron|zinc|magnesium|potassium|phosphate',
  // Non-English staples, so a Spanish/French panel that DOES hit the cap rules above clears the
  // coverage gate and gets scored rather than declined.
  'agua|eau|wasser|sal|sel|salz|az[uú]car|sucre|zucker|leche|lait|milch|harina|farine|mehl|avoine|hafer|avena|flocons|hafervollkornflocken|muesli|granola',
  'aceite|huile|[öo]l|jarabe|sirop|jugo|jus|saft|ma[ií]z|ma[ïi]s|trigo|bl[ée]|arroz|riz|reis',
  'soja|girasol|tournesol|colza|vegetal|v[ée]g[ée]tale|almid[óo]n|amidon|levadura|levure',
  // Italian staples, and German compounds: "Vollmilchpulver" and "Kakaobutter" contain the words
  // above but no word boundary, so they read as unrecognised and a correctly scored German list
  // still carried a "50% recognised" warning.
  'acqua|sale|latte|farina|olio|succo|riso|mais|soia|lievito|agenti lievitanti|amido|burro|panna|formaggio|uova|miele|nocciole|mandorle',
  '\\w*(?:milch|zucker|butter|mehl|pulver|st[äa]rke|sirup|saft|salz|wasser|sahne|k[äa]se|joghurt|schokolade|kakao|mandeln|n[üu]sse|haselnuss|erdnuss)\\w*',
  'emulgator(?:en)?|emulsionantes?|emulgentes?|[ée]mulsifiants?|emulsionanti|conservante|conservateur|konservierungsstoff|colorante|colorant|farbstoff|s[äa]uerungsmittel|acidulant|acidificante|correcteur',
  // Colours from food, which no rule charges. Without them "Annatto (color)" read as an unnamed
  // colour next to an unrecognised word, and "beta carotene" lowered coverage on a clean list.
  'annatto|carotenes?|carotenoids?|beet(?:root)? (?:juice|powder|red)|anthocyanins?|lycopene|curcumin|chlorophyll(?:in)?|carmine|cochineal|riboflavin|lutein|paprika (?:extract|oleoresin)|spirulina extract|caramel',
  // Swedish and Polish staples. Words that begin with a letter outside ASCII (äpple, śmietanka,
  // łosoś) follow the list, with explicit boundaries, because `\\b` cannot see those letters. Generic
  // words (olja, olej, mjöl, mąka, syra, kwas) are left out on purpose: "olej bawełniany" or "kwas
  // sorbowy" would then count as read while no rule charged them.
  'vatten|woda|havre|havregryn|havremj[öo]l|owies|owsiane|p[łl]atki|kakao|kulturer|kultury|bakterie|mleko|mleka|mleczn\\w*|dro[żz]d[żz]e|j[äa]st',
  'potatis|ziemniaki|ziemniaczan\\w*|tomater|tomatpur[ée]|pomidory|pomidorow\\w*|vitl[öo]k|czosnek|cebula|basilika|bazylia|oregano|persilja|pietruszka|peppar|pieprz|kanel|cynamon|ingef[äa]ra|imbir|paprika|papryka|kryddor|przyprawy',
  'russin|rodzynki|hasseln[öo]tter|mandlar|orzechy|migda[łl]y|solrosfr[öo]n|pumpafr[öo]n|nasiona|pestki|sesamfr[öo]n|sezam|jab[łl]ka|jab[łl]ko|jordgubbar|truskawki|hallon|maliny|bl[åa]b[äa]r|jagody|citron|cytryna|banan|banany|apelsin|pomara[ńn]cz\\w*',
  'gr[äa]dde|mj[öo]lk|skummj[öo]lk|helmj[öo]lk|mj[öo]lkpulver|\\w*mj[öo]lkspulver|ost|ser|mas[łl]o|jogurt|yoghurt|smetana|vassle|serwatka|jaja|jajka|honung|mi[óo]d|kakaosm[öo]r|kakaomassa|miazga kakaowa|t[łl]uszcz kakaowy',
  'pektin|pektyna|pektyny|koffein|kofeina|kolsyra|kolsyrat|gazowana|natriumbikarbonat|natriumv[äa]tekarbonat|bakpulver|wodorow[ęe]glan sodu|proszek do pieczenia|substancj[ae] spulchniaj[ąa]c[ae]|spulchniacz|j[äa]stpulver',
  'ris|ry[żz]|majs|kukurydza|kli|otr[ęe]by|b[öo]nor|fasola|linser|soczewica|kik[äa]rtor|ciecierzyca|groch|soja',
  'kyckling|kurczak|n[öo]tk[öo]tt|wo[łl]owina|fl[äa]sk|wieprzowina|lax|fisk|ryba|r[äa]kor|krewetki',
  'palmolja|olej palmowy|kokosolja|olej kokosowy|olivolja|oliwa z oliwek|sm[öo]r',
  'emulgeringsmedel|stabiliseringsmedel|f[äa]rg[äa]mne|barwnik|surhetsreglerande medel|regulator kwasowo[śs]ci|smakf[öo]rst[äa]rkare|wzmacniacz smaku|konserveringsmedel|konserwant',
  // Benign E-numbers, so an EU list written in codes is still recognised as a list. Every E-number
  // that a rule charges is recognised through that rule; these are the ones nothing charges.
  'e[- ]?(?:100|120|14[01]|16[0-3][a-i]?|262|32[5-7]|33[1-3]|40[1-6]|440a?|50[0-4](?:i{1,3})?|50[89]|524|57[45]|901|903|941|948)',
].join('|') + ')\\b'
  + '|(?<![a-zß-ÿ\\u0100-\\u017f])(?:ägg|äggula|äggvita|äpple|äpplen|ärtor|ärter|[śs]mietan[a-zß-ÿ\\u0100-\\u017f]*|łoso[śs]|żyto'
  // Turkish staples: most end or begin in ı, ş, ğ, ç or ü, so they take the same boundaries.
  + '|su|tuz|maya|s[üu]t|s[üu]t tozu|ya[ğg]s[ıi]z s[üu]t tozu|tam ya[ğg]l[ıi] s[üu]t tozu|krema|tereya[ğg][ıi]|peynir|yo[ğg]urt|yo[ğg]urt k[üu]lt[üu]r[üu]|k[üu]lt[üu]r(?:[üu]|ler)?|yumurta|bal|kakao|kakao ya[ğg][ıi]|kakao k[üu]tlesi'
  + '|patates|domates|sar[ıi]msak|so[ğg]an|fesle[ğg]en|kekik|biber|kuru [üu]z[üu]m|[üu]z[üu]m|f[ıi]nd[ıi]k|badem|ceviz|ay[çc][ıi][çc]e[ğg]i [çc]ekirde[ğg]i|elma|[çc]ilek|limon|portakal|muz'
  + '|pirin[çc]|m[ıi]s[ıi]r|nohut|mercimek|fasulye|bezelye|yulaf|yulaf ezmesi|tavuk|tavuk eti|s[ıi][ğg][ıi]r eti|dana eti|bal[ıi]k|baharat(?:lar)?|pektin|kafein|karbonatl[ıi] su|maden suyu'
  + '|kabart[ıi]c[ıi](?:lar)?|kabartma tozu|sodyum bikarbonat|lezzet artt?[ıi]r[ıi]c[ıi]|palm ya[ğg][ıi]|zeytinya[ğg][ıi]|hindistan cevizi ya[ğg][ıi]|aroma verici(?:ler)?'
  // Everyday words from real labels (Open Food Facts, 2026-09-26), per language, that matched no rule and
  // left real lists declined: nothing here is charged; it only lets the list be read.
  + '|b(?:1|2|3|5|6|7|9|12)|d[23]|vitamin[aeos]?|vitamine[ns]?|vitaminer|vitaminler|witaminy|tocopher\\w*|tocoferol\\w*|tokoferol\\w*|tokoferoller|beta[- ]?karoten|beta[- ]?caroten[eo]?|palm|palme|palma|palmiste|palmkern|shea|karit[ée]' // any
  + '|sodium citrates?|trisodium citrate|calcium citrate|carbon dioxide|carbonic acid|sodium acid carbonate|sodium hydrogen carbonate|ammonium hydrogen carbonate|(?:sodium|ammonium) carbonates?|raising agents?|baking powders?|oligofructose|sultanas|cranberries|humectant|cocoa mass|sunflower|rapeseed|glazing agent|flour treatment agent|anti-?caking agent|firming agent|gelling agent|carnauba wax|beeswax|palm fat|vegetable fats?' // en
  + '|poudres? [àa] lever|carbonates? (?:acides? )?d[e\'’] ?(?:sodium|ammonium)|bicarbonates?|noisettes?|cr[èe]me(?: fra[îi]che)?|magn[ée]sium|extrait de vanille|vanille|ferments? lact?iques?|vinaigre(?: de vin| d[\'’]alcool)?|ail|noix de cajou|noix|levain|levures?|pr[ée]sure(?: halal)?|fromage blanc|perm[ée]at de lactos[ée]rum|lactos[ée]rum(?: en poudre)?|basilic|raisins secs|flocons d[\'’]avoine(?: compl[èe]te)?|avoine|dattes|amandes?|citrates? de sodium|pectines?|huile de palme|graisses? v[ée]g[ée]tales?|mati[èe]re grasse\\w*|sirop d[\'’][ée]rable' // fr
  + '|kohlens[äa]ure|natriumcitrate?|trinatriumcitrat|cashewkerne|basilikum|vanilleextrakt|vanille|tomaten\\w*|sojabohnen|calciumcarbonat|knoblauch|backtriebmittel|eier|walnusskerne|haselnusskerne|sonnenblumen?|pektine?|tricalciumcitrat|tocopherolhaltige extrakte|datteln|weinessig|branntweinessig|essig|traubenmost|kichererbsen|hafer|haferflocken|gew[üu]rze|kartoffel\\w*|zitronen\\w*|lysozym|palm[öo]l|pflanzliche fette|speisesalz|meersalz|jodsalz|natriumhydrogencarbonat|ammoniumhydrogencarbonat|natriumcarbonate|ammoniumcarbonate' // de
  + '|avellanas|gasificantes?|calcio|carbonatos? [áa]cidos? de (?:sodio|amonio)|bicarbonato s[óo]dico(?: y am[óo]nico)?|almendras?(?: tostadas)?|extracto rico en tocoferoles|vitaminas?|manteca de palma|grasas? de palma|grasas? vegetales|copos de avena(?: integral)?|avena(?: integral)?|cacahuetes|oligofructosa|citratos? de sodio|citrato tric[áa]lcico|pectinas?|nata|hierro|yoduro de potasio|fibra de guisante|carbonato de calcio|cafe[íi]na|anacardos|pecanas|pacanas|nueces(?: de brasil)?|sal marina' // es
  + '|anidride carbonica|cipoll[ae]|carbonato acido di (?:sodio|ammonio)|vaniglia|semi di sesamo|noci(?: di acagi[ùu]| del brasile| sgusciate)?|pistacchi|fiocchi d[\'’] ?avena|avena|polpa di pomodoro|concentrato di pomodoro|pomodor[io]|peperoni(?: rossi)?|crusca|germe|anacardi|basilico|patate(?: disidratate)?|caffeina|girasole|olio di palma|grassi vegetali|sale marino|aceto' // it
  + '|[áa]gua|leite(?: de vaca)?(?: pasteurizado)?|levedantes?(?: qu[íi]micos)?|hidrogenocarbonato de (?:s[óo]dio|am[óo]nio)|carbonatos? de (?:s[óo]dio|c[áa]lcio|magn[ée]sio)|extr[ae]c?to rico em tocofer[óo]is|cacau(?: magro)?(?: em p[óo])?|manteiga de cacau|vitaminas?|citrato tric[áa]lcico|pectinas|citratos de s[óo]dio|[óo]leo de palma|flocos de aveia|aveia|milho|di[óo]xido de carbono|gorduras? vegeta(?:l|is)|gordura de palma|tomate|vinagre(?: de [áa]lcool)?|nata|fermentos?(?: vivos)?(?: de iogurte)?|ferro|[áa]cido pantot[ée]nico|ovos|cebola|am[êe]ndoas?|miolo de am[êe]ndoa|amendoins|sementes de s[ée]samo|fibras? vegeta(?:l|is)|fibra de ervilha|cafe[íi]na|avel[ãa]s|sal marinho' // pt
  + '|zout|zeezout|cacaomassa|cacaoboter|magere cacaopoeder|cacaopoeder|melk|pectinen?|natriumcitraten?|vanille|tricalciumcitraat|calciumcitraten|sojabonen|palmolie|bulgaricus|amandel(?:en)?|calciumcarbonaat|ijzer|wortelextract|eieren|plantaardige vetten|mangopit|geleermiddel|rijsmiddel(?:en)?|ammoniumcarbonaten|natriumcarbonaten|hazelnoten|weipoeder|haver|maïsvezel|walnoten|granen|gist|azijn' // nl
  + '|havssalt|ystenzym|tomatpur[ée]|koncentrerad tomatpur[ée]|tomatkoncentrat|[äa]ttika|vin[äa]ger|sojab[öo]nor|natriumkarbonater|jordn[öo]tter|kryddextrakt|[öo]rtextrakt|krydd- och [öo]rtextrakt|paprikaextrakt|l[öo]k|mandel|laktos|yoghurtkultur|chilipeppar|syrakulturer|syrningskultur|bakteriekultur|majsk[äa]rnor|hela majsk[äa]rnor|durumvete|kik[äa]rter|mor[öo]tter|[öo]rtkryddor|mj[öo]lkprotein|trinatriumcitrat|laktasenzym|vassleprodukt|snabbkaffe\\w*|kaffe|kokosfett|mj[öo]lkfett|apelsinjuice\\w*|citronjuice\\w*' // sv
  + '|s[óo]l(?: morska)?|dwutlenek w[ęe]gla|cytryniany sodu|orzeszki (?:ziemne|arachidowe)(?: pra[żz]one)?|pra[żz]one orzeszki arachidowe|gorczyc[ęa]|nap[óo]j sojowy|ekstrakt z wanilii|wyci[ąa]g z rozmarynu|s[łl]onecznik\\w*|miazga z orzech[óo]w laskowych|syrop klonowy|ocet(?: spirytusowy)?|ekstrakty? przypraw(?: i zi[óo][łl])?|przyprawy?|permeat serwatki|t[łl]uszcz palmowy|t[łl]uszcze ro[śs]linne|czekolada\\w*|t[łl]uszcz kakaowy|wodorow[ęe]glan (?:amonu|sodu)|p[łl]atki owsiane|pe[łl]noziarnist\\w* p[łl]atk\\w* owsian\\w*|kukurydz\\w*|ziarna kukurydzy|skrobia z manioku|kokos\\w*|migda[łl]\\w*|soj[ęa]|ziarna soi' // pl
  + '|karbondioksit|sodyum hidrojen karbonat|amonyum (?:hidrojen karbonat|bikarbonat)|ay[çc][ıi][çc]ek|deniz tuzu|yer f[ıi]st[ıi][ğg][ıi]|peynir ?alt[ıi] suyu tozu|poligliserol polirisin?oleat|pamuk|sirke|ni[şs]asta|sodyum metabis[üu]lfit|sodyum sitrat|sodyum asit pirofosfat|hindiba k[öo]k[üu] lifi|hindistan cevizi (?:s[üu]t[üu]|kremas[ıi])|un i[şs]lem maddesi|nem verici|s[ıi][ğg][ıi]r jelatini|parlatma maddesi|karnauba mumu|kalsiyum karbonat|tam ya[ğg]l[ıi] s[üu]t ?tozu|asitli[ğg]i d[üu]zenleyici(?:ler)?' // tr
  // From the second sample (page 2, 661 lists): additives English leaves uncharged but did not read either,
  // in each language, so they counted against the list as unreadable.
  + '|humectants?|humectantes?|humidificantes?|umidificant[ei]|feuchthaltemittel|bevochtigingsmiddel(?:en)?|fuktighetsbevarande medel|substancj[ae] utrzymuj[ąa]c[ae] wilgo[ćc]|nem vericiler?|nemlendirici(?:ler)?'
  + '|(?:sodium|potassium|calcium) alginates?|alginate de (?:sodium|potassium|calcium)|alginato (?:s[óo]dico|pot[áa]sico|c[áa]lcico|de s[óo]dio|di sodio)|(?:natrium|kalium|calcium)alginaa?t|alginian (?:sodu|potasu|wapnia)|sodyum aljinat'
  + '|emulsifying salts?|sels de fonte|sales (?:de )?fundid[oa]s?|sali di fusione|schmelzsalze?|smeltzouten|sm[äa]ltsalter|s[óo]le emulguj[ąa]ce|eritme tuzlar[ıi]|sais de fus[ãa]o'
  + '|polyglycerol esters?(?: of fatty acids)?|sorbitan (?:tri|mono)?stearate|sorbitan(?:tri|mono)stearat|trist[ée]arate de sorbitane|triestearato de sorbitano|(?:ya[ğg] asitlerinin )?poligliserol esterleri'
  + '|sodium hydroxide|natriumhydroxide?|hydroxyde de sodium|hidr[óo]xido de s[óo]dio|idrossido di sodio|wodorotlenek sodu|sodyum hidroksit|kaliumcarbonate?n?|carotin|b[ée]ta[- ]?carot[èe]ne'
  + '|siyah [çc]ay|ye[şs]il [çc]ay|[çc]ay|tahin[ie]?|tahina|karabu[ğg]day|nane|maydanoz|dereotu|fesle[ğg]en|kekik|biberiye|karabiber|mynta|persilja|basilika|timjan|rosmarin|peppar|menthe|persil|aneth|basilic|origan|thym|romarin|ciboulette|menta|perejil|eneldo|albahaca|or[ée]gano|tomillo|romero|prezzemolo|aneto|basilico|origano|timo|rosmarino|minze|petersilie|thymian|peterselie|dille|basilicum|tijm|rozemarijn|mi[ęe]ta|pietruszka|koperek|bazylia|tymianek|rozmaryn|hortel[ãa]|endro|manjeric[ãa]o|or[ée]g[ãa]os|tomilho|alecrim'
  + '|pectins|pantothenic acid|(?:calcium )?d-?pantothenate|biotin|mixed seeds|seed mix|seeds|vegetables|parsnips?|lovage|celeriac|mace|cloves?|chives|curcuma|nigari|salvia hispanica|caffeine|taurine|tartaric acid|invertase|psyllium(?: husks?)?|dietary fib(?:re|er)s?|vegetable fib(?:re|er)s?|ammonium acid carbonate|(?:green |black )?olives|peppermint oil|propellant gas|nitrogen'
  + '|iodine|iodised salt|iodized salt|jod|jodid|iode|yodo|iodio|jodium|jodek|iyot|iyodat|klumpf[öo]rebyggande medel|antiaglomerantes?|anti-?agglom[ée]rants?|trennmittel|antiagglomeranti?|antiklontermiddel(?:en)?|substancj[ae] przeciwzbrylaj[ąa]c[ae]|topaklanmay[ıi] [öo]nleyici(?:ler)?|antiaglutinantes?'
  + '|lactas[ea]|laktase?|lattasi|laktaz(?: enzimi)?|kahve|[öo][ğg][üu]t[üu]lm[üu][şs] kahve|caf[ée](?: moulu| soluble| torr[ée]fi[ée])?|caff[èe]|kaffee|koffie|kaffe|kawa|chicor[ée]e(?: soluble)?|achicoria|cicoria|zichorie|cichorei|cikoria|cykoria|hindiba|sumo|polpa'
  + "|huile de s[ée]same|aceite de s[ée]samo|olio di sesamo|sesam[öo]l|sesamolie|sesamolja|olej sezamowy|susam ya[ğg][ıi]|[óo]leo de s[ée]samo"
  + '|mj[öo]lksyrakulturer?|syrakulturer?|vitm[öo]gelkultur|l[öo]pe|milchs[äa]urekulturen|fermenti lattici|fermentos? l[áa]cticos|zuursel|kultury bakterii|pr[ée]sure|cuajo(?: microbiano)?|caglio|stremsel|podpuszczk[ai]|peynir mayas[ıi]|coalho(?: microbiano)?|labferment'
  // From the third sample (page 3, 715 lists): everyday words English reads and does not charge.
  + '|selderij|selleri|sellerie|apio|c[ée]leri|sedano|aipo|seler|kereviz|prei|purjol[öo]k|poireaux?|puerros?|porro|lauch|p[ıi]rasa'
  + '|citroen\\w*|zitrone|lim[óo]n|limone|lim[ãa]o|sinaasappel\\w*|naranjas?|arancia|arance|laranjas?|mandarijn\\w*'
  + '|vainilla|baunilha|vanilya|wanilia|vanilj\\w*|vanillepoeder|extracto de vainilla|estratto di vaniglia'
  + '|chocolat(?: noir| au lait| blanc)?|cioccolato(?: fondente| al latte| bianco)?|\\w*chocolade|[a-zß-ÿ]*choklad|(?:s[üu]tl[üu] |bitter |beyaz )?[çc]ikolata'
  + '|especias?|especiarias?|specerij(?:en)?|[ée]pices|gew[üu]rz|spezie|przyprawa'
  + '|kryddnejlik(?:a|or)|clavos?(?: de olor)?|chiodi di garofano|cravinhos?|clous? de girofle|(?:gew[üu]rz)?nelken|kruidnagel(?:en)?|go[źz]dzik[ia]?|karanfil'
  + '|mostaza|moutarde|senf|mosterd|senap|hardal|mostarda|senape|senapsfr[öo]n|semillas de mostaza|graines de moutarde|senfk[öo]rner|senfsa(?:men|at)|mosterdzaad|semi di senape|ziarna gorczycy|hardal tohumu|sementes de mostarda'
  + '|carotenos|karotener|karotenler|karoteny|carot[èe]nes?|caroteni|karotene|antocyjany|antocianinas?|antocianine|anthocyanes?|antocyaner|antosiyanin(?:ler)?|antocianos'
  + "|carbonato acido d['’] ?ammonio|ammoniumv[äa]tekarbonat|w[ęe]glany (?:amonu|sodu)|carbonatos? (?:de )?(?:amonio|am[óo]nio|sodio)|ammoniumcarbonat|natriums[äa]urecarbonat|natriumbicarbonaat|carbonati di (?:sodio|ammonio)|bicarbonato di sodio|bicarbonato de s[óo]dio|natriumcarbonate?|(?:sodyum|amonyum) karbonatlar?"
  + '|agent[ei] lievitant[ei]|triebmittel|trisodyum sitrat|citrato tris[óo]dico|citrate trisodique'
  + '|cloruro pot[áa]sico|kaliumchlorid|cloruro di potassio|cloreto de pot[áa]ssio|chlorek potasu|potasyum kl[öo]r[üu]r|kaliumklorid'
  + '|tiamina|tiammina|tiamin|tiamine|farinha|zonnebloem|girassol|solros|levedura|(?:back)?hefe'
  + '|estratt[io] di rosmarino|extrait de romarin|extracto de romero|rosmarinextrakt|rozemarijnextract|ekstrakt z rozmarynu|biberiye ekstrakt[ıi]'
  + ')(?![a-zß-ÿ\\u0100-\\u017f])', 'i');

// Marketing qualifiers in front of an ingredient carry no scoring information, but most sugar and
// sweetener rules are anchored at the start of the entry — so "organic agave nectar" matched nothing
// while "agave nectar" cost 16 points, and the organic bonus was paid on top. Measured: oats with
// agave 63, oats with organic agave 95. Every anchored rule now sees the entry as written AND with
// the qualifiers stripped; the displayed ingredient stays as written.
const QUALIFIERS = /^(?:(?:organic|raw|pure|natural|real|certified|fair[- ]trade|non[- ]?gmo|unsulph?ured|light|dark|golden|blue|100%|grade a|kosher)\s+)+/i;
const bare = ing => ing.replace(QUALIFIERS, '');
const hits1 = (re, ing) => re.test(ing) || (QUALIFIERS.test(ing) && re.test(bare(ing)));
const hitsAny = (rules, ing, pick = r => r) => rules.some(r => hits1(pick(r), ing));

// The penalty rules one entry trips, in PENALTIES order. The entry as written is tested first; the
// qualifier-stripped form may then add rules only in groups the written form did not already hit.
// Without that second condition "natural flavors" hit the natural-flavour rule as written AND the
// bare-"flavors" rule once "natural" was stripped, and paid for the same blend twice — the
// qualifier strip exists to catch "organic agave", not to invent a second flavouring.
// A hyphen inside a phrase is often just a space: "modified corn-starch", "natural-flavors",
// "soya-lecithin" escaped their rules. Rules are tried on both forms, because some need the hyphen
// ("mono- und", "demi-écrémé", "L-cysteine") and the text itself is left as written.
const spaced = s => (s.includes('-') ? s.replace(/([a-zß-ÿœ\u0100-\u017f])-(?=[a-zß-ÿœ\u0100-\u017f])/gi, '$1 ') : s);
const eitherForm = (re, s) => re.test(s) || (s.includes('-') && re.test(spaced(s)));

function penaltiesFor(ing) {
  const hit = new Set(PENALTIES.filter(r => eitherForm(r.m, ing)));
  if (!QUALIFIERS.test(ing)) return hit;
  const groups = new Set([...hit].map(r => r.group));
  const stripped = bare(ing);
  for (const r of PENALTIES) {
    if (!hit.has(r) && !groups.has(r.group) && r.m.test(stripped)) hit.add(r);
  }
  return hit;
}

// Whether the rulebase can read this entry at all — the per-entry half of the coverage measure.
// `unnamed` function words are excluded on request, because "preservative" is recognised in the
// sense of being charged, but it does not tell us WHICH preservative is beside it.
function recognised(ing, { unnamed = true } = {}) {
  return hitsAny(labels.WHOLE, ing)
    || hits1(labels.CULINARY, ing)
    || COMMON_PANEL.test(ing)
    || hitsAny(sugars.FREE, ing)
    || PENALTIES.some(r => (unnamed || !r.unnamed) && (hits1(r.m, ing) || (ing.includes('-') && hits1(r.m, spaced(ing)))))
    || CAPS.some(c => eitherForm(c.m, ing))
    || labels.BONUSES.some(b => b.m.test(ing));
}

// Entries, not strings: an entry whose organic word was taken off still counts as read, as it did
// when the organic claim itself was what the rules recognised ("Organic medjool dates").
// The sole bracket entry whose allergens and charges are all its parent's already: the same word, or
// an allergen declaration of it (and nothing the parent is not charged for).
function repeatedAllergenBrackets(entries) {
  const al = db.allergens ? db.allergens.ALLERGENS : [];
  const ids = ing => al.filter(a => a.m.test(ing)).map(a => a.id);
  const byFam = new Map(entries.map(e => [e.fam, e]));
  const kids = new Map();
  for (const e of entries) if (e.parent) kids.set(e.parent, [...(kids.get(e.parent) || []), e]);
  const out = [];
  for (const [fam, list] of kids) {
    const parent = byFam.get(fam);
    if (!parent || list.length !== 1) continue;
    const child = list[0];
    if (child.ing.split(' ').length > 3 || kids.has(child.fam)) continue;
    if (child.ing === parent.ing) { out.push(child); continue; }
    const mine = ids(child.ing);
    if (!mine.length) continue;
    const theirs = new Set(ids(parent.ing));
    if (!mine.every(id => theirs.has(id))) continue;
    const charged = penaltiesFor(parent.ing);
    if ([...penaltiesFor(child.ing)].every(r => charged.has(r))) out.push(child);
  }
  return out;
}

function recognitionCoverage(entries) {
  if (!entries.length) return 0;
  let seen = 0;
  for (const e of entries) if (e.organic || recognised(e.ing)) seen++;
  return seen / entries.length;
}

// ---------------------------------------------------------------- parsing
// "İ".toLowerCase() is "i" plus a combining dot, which no rule can match: "İnvert şeker" read as nothing.
// A trailing quantity ("sugar 20%", "Zucker 45 %", "hazelnuts min. 13%") is how EU labels declare
// the share of an ingredient, and every rule anchored at the end of the entry failed on it: the
// sugar in "sugar 20%" was charged nothing. The share is dropped from the entry the rules see.
const TRAILING_SHARE = /\s*(?:\b(?:min(?:imum)?|max(?:imum)?|ca|approx)\.?\s*|<\s*|>\s*)?(?:\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)$/i;
// Organic and footnote markers ("sucre*", "cane sugar #", "lait°") hid the ingredient from anchored rules.
const MARKERS = /[*°¹²³†‡#]+/g;
// The share in front ("19,5% sucre", "46% flocons d'avoine"), and an ingredient heading left inside
// the text ("Zutaten: Zucker"), hid the ingredient from rules anchored at the start of the entry.
// "1% milk" and "2% milk" are a fat level, not a share, and the fat-reduced dairy rule reads them.
const LEADING_SHARE = /^(?:\d+(?:[.,]\d+)?\s*%|%\s*\d+(?:[.,]\d+)?)\s+(?=\D)(?!(?:\S+\s+){0,2}(?:milk|milkfat|dairy|yogh?urt|cheese|kefir|cream|buttermilk|chocolate milk)\b)/;
const LEADING_HEADING = /^(?:ingredients?|zutaten|ingr[ée]dients|ingredientes|ingredienti|ingredi[ëe]nten|ingredienser|sk[łl]ad(?:niki)?|i[çc]indekiler)\s*:\s*/i;
const tidy = s => s.replace(MARKERS, ' ').replace(/^[\s*•\-–:]+/, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/i\u0307/g, 'i')
  .replace(TRAILING_SHARE, '').trim().replace(LEADING_HEADING, '').replace(LEADING_SHARE, '');
const usable = s => s.length > 1 && s.length < 80;

// Split on commas at the TOP level only, leaving parenthesised sub-lists attached to their parent.
// A full stop ends an entry only when it ends a sentence: "2.5%" and "vitamin b12." must not split.
// "Haselnüsse min. 13%": the full stop after min/max/ca before a number is an abbreviation.
const MIN_SHARE = /(?:^|[^a-z])(?:min|max|ca|approx)$/i;
function splitTopLevel(text) {
  const parts = [];
  parts.sentenceEnds = new Set();   // indices of parts a full stop or semicolon ended
  let depth = 0, buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') { depth++; buf += ch; }
    else if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; }
    // A comma between two digits is a decimal ("sugar 8,5%"), not the end of an entry.
    else if (depth === 0 && ((ch === ',' && !(/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')))
      || ch === ';' || (ch === '.' && !/\d/.test(text[i + 1] || '') && !(MIN_SHARE.test(buf) && /^\.\s?\d/.test(text.slice(i, i + 3)))))) {
      if (ch !== ',') parts.sentenceEnds.add(parts.length);
      parts.push(buf); buf = '';
    }
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
// EU labels name an additive after its job with a colon: "emulsifier: lecithins", "acidity regulator:
// sodium citrates". Rules anchored at the start of the entry never saw the additive, so the colon form
// is read as the parenthetical form it means: "emulsifier (lecithins)".
const FUNCTION_HEAD = /^([^:()]{3,40}):(.+)$/;
const SWEETENER_WORD = /^(?:sweeteners?|edulcorantes?|[ée]dulcorants?|s[üu][ßs]ungsmittel|dolcificanti|zoetstoff(?:en)?|s[öo]tningsmedel|substancje s[łl]odz[ąa]ce|tatland[ıi]r[ıi]c[ıi](?:lar)?|substancja s[łl]odz[ąa]ca)$/i;
// "flavouring: vanillin", "Aroma: Vanillin", "arôme : vanilline" name the flavouring after the colon.
const FLAVOUR_WORD = /^(?:flavou?rings?|flavou?rs?|ar[ôo]mes?|aromas?|aromen|aromi|aromat[ya]?|arom(?:er)?|aroma vericiler?|bulking agents?|agents? de charge|agentes? de carga|f[üu]llstoffe?|agent[ei] di carica|vulstof(?:fen)?|fyllnadsmedel|substancj[ae] wype[łl]niaj[ąa]c[ae]|dolgu maddesi|agentes? de volume)$/i;
function colonAsParenthesis(part) {
  // Only a short head before the colon can be a function word. Checked before the pattern runs, and
  // the pattern has no free whitespace to backtrack over: on 6,000 spaces it once took a second.
  const colon = part.indexOf(':');
  if (colon < 0 || colon > 60) return part;
  const m = part.trim().match(FUNCTION_HEAD);
  if (!m) return part;
  const head = tidy(m[1]);
  if (!(add.UNNAMED.some(r => r.m.test(head)) || SWEETENER_WORD.test(head) || FLAVOUR_WORD.test(head))) return part;
  // "emulsifier: lecithins (soy)" names the additive with its own parenthetical; the job word adds
  // nothing then, and nesting it would lose the source.
  return m[2].includes('(') ? m[2] : `${m[1]} (${m[2]})`;
}

// "lécithines (soja)", "lecithinen (zonnebloem)", "lecytyny (ze słonecznika)": the source of a lecithin
// in brackets, where English writes "soy lecithin". Read as the English form so the source rule applies.
const LECITHIN_HEAD = /^(?:lecithins?|l[ée]cithines?|lecitin[ae]s?|lecithine?n?|lecytyn[ay]?|lesitin|lecitin(?:er)?)$/i;
const LECITHIN_SOURCE = [
  [/^(?:from )?(?:soy|soya|soja|soia|soi|sojowa|sojy|z soi)$/i, 'soy lecithin'],
  [/^(?:from )?(?:sunflower|tournesol|girasol|girasole|girassol|zonnebloem|sonnenblumen?|solros|ze s[łl]onecznika|s[łl]onecznikowa|ay[çc][ıi][çc]ek)$/i, 'sunflower lecithin'],
];
function lecithinWithSource(part) {
  // Cheap checks first, and no free whitespace in the pattern: long runs of spaces must not backtrack.
  if (part.length > 120 || !/lec|l[ée]c|les/i.test(part) || !part.includes('(')) return part;
  const m = part.trim().match(/^([^()]+)\(([^()]+)\)$/);
  if (!m || !LECITHIN_HEAD.test(tidy(m[1]))) return part;
  const hit = LECITHIN_SOURCE.find(([re]) => re.test(tidy(m[2])));
  return hit ? hit[1] : part;
}

const E_CODE = /^[1-9]\d{2,3}[a-f]?(?:\s?(?:i{1,3}|iv|vi{0,3}|ix))?$/i;
const isFunctionWord = head => add.UNNAMED.some(r => r.m.test(head)) || SWEETENER_WORD.test(head) || FLAVOUR_WORD.test(head)
  // or a head that ends in one: "iodised salt and emulsifier (322, 471)", "vitamins and colour (150d)".
  || /(?:^|[\s,&])(?:raising agents?|leavening(?: agents?)?|preservatives?|antioxidants?|colou?rs?|colou?rings?|emulsifiers?|stabili[sz]ers?|thickeners?|acidity regulators?|acids?|sweeteners?|flavou?r enhancers?|anti-?caking agents?|gelling agents?|firming agents?|humectants?|glazing agents?|flour treatment agents?|dough conditioners?|improvers?)$/i.test(head);

// Each piece carries its family: `fam` is its own id and `parent` the id of the entry whose
// brackets it came from (0 at the top level), so a function word can be told apart from its
// siblings in a sub-list.
function expandEntry(raw, depth = 0, ids = { n: 0 }, parent = 0) {
  const fam = ++ids.n;
  const part = lecithinWithSource(colonAsParenthesis(raw));
  // A "may contain" statement stays one entry, brackets and all: "may contain cereals containing
  // gluten (spelt, barley, oats)" charged spelt, barley and oats as ingredients once the bracket
  // was split off, and a statement of 80 characters or more fell to the length filter, taking its
  // allergen warning with it. It is set aside from scoring and read only by the allergen flags.
  // (The text outside brackets comes from one linear pass: the pattern /\([^)]*\)/ took 150 ms on a
  // run of 20,000 open brackets, once per level.)
  const { head, groups } = bracketGroups(part);
  if (MAY_CONTAIN.test(tidy(head))) {
    const whole = tidy(part.replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/ ,/g, ',')).slice(0, 400);
    return whole.length > 1 ? [{ ing: whole, fam, parent }] : [];
  }
  // Brackets are read by depth. The flat pattern closed "milk chocolate (sugar, emulsifier:
  // lecithins (soy), flavouring: vanillin)" at the inner ")", so ", flavouring: vanillin)" stayed in
  // the parent entry and was charged there as an unspecified flavouring. A sub-ingredient's own
  // brackets are expanded the same way, a few levels deep; below that they are read flat as before.
  const pieces = [{ ing: tidy(head), fam, parent }];
  // UK labels drop the E from a code in a function word's bracket: "emulsifier (472e)", "raising
  // agents (503, 500)", "preservative (223)". Read there, the code is the E-number it names; anywhere
  // else a bare number stays a number.
  const codes = isFunctionWord(pieces[0].ing);
  for (const group of groups) {
    for (const child of group.split(/;|(?<!\d),|,(?!\d)/)) {
      if (depth < 3 && (child.includes('(') || child.includes(':'))) { pieces.push(...expandEntry(child, depth + 1, ids, fam)); continue; }
      const one = tidy(child.replace(/[()]/g, ' '));
      const bare = codes ? one.split(/\s*(?:&|\/|\band\b|\bund\b|\bet\b|\by\b|\be\b|\bi\b|\ben\b|\boch\b|\bve\b)\s*/) : [one];
      if (codes && bare.length && bare.every(c => E_CODE.test(c))) for (const c of bare) pieces.push({ ing: `e${c}`, fam: ++ids.n, parent: fam });
      else pieces.push({ ing: one, fam: ++ids.n, parent: fam });
    }
  }
  return pieces.filter(p => usable(p.ing));
}

// The text outside brackets, and each top-level bracket's contents with its own brackets kept.
// An unclosed bracket ("Base de soja (água, grãos…" with no ")") is read as closed at the end, so
// what follows it is still split into ingredients rather than left as one long unreadable entry.
function bracketGroups(part) {
  let depth = 0, head = '', buf = '';
  const groups = [];
  for (const ch of part) {
    if (ch === '(') { if (depth > 0) buf += ch; depth++; }
    else if (ch === ')') {
      if (depth === 0) { head += ' '; continue; }
      depth--;
      if (depth === 0) { groups.push(buf); buf = ''; head += ' '; }
      else buf += ch;
    }
    else if (depth > 0) buf += ch;
    else head += ch;
  }
  if (depth > 0) groups.push(buf);
  return { head, groups };
}

// "May contain milk, soy, wheat." is one statement to the end of its sentence. Split at its commas,
// "soy" and "wheat" became ingredients of their own and wheat was charged (72 against 94).
function joinStatements(parts) {
  const out = [];
  let open = null;
  parts.forEach((part, i) => {
    if (open) open.push(part);
    else if (MAY_CONTAIN.test(tidy(bracketGroups(part).head))) open = [part];
    else out.push(part);
    if (open && (parts.sentenceEnds.has(i) || i === parts.length - 1)) { out.push(open.join(', ')); open = null; }
  });
  return out;
}

// An organic qualifier before or after the ingredient. EU labels write it after ("sucre bio",
// "zucchero di canna biologico", "Kukurydza ekologiczna"), and every rule anchored at the end of
// the entry missed the ingredient: organic sugar was charged nothing where "sugar" costs 14. The
// qualifier is taken off the entry and kept as evidence for the organic bonus.
const ORGANIC_WORD = '(?:organic|bio|biologique|biologiques|biol[óo]gic[oa]s?|biologic[oaie]|biologiche|biologisch(?:e[mnrs]?)?'
  + '|ecol[óo]gic[oa]s?|eco|[öo]ko|ekologisk[at]?|ekologiczn[a-zęąó]*|organik|kbA)';
const ORGANIC_EDGE = new RegExp(`^(?:${ORGANIC_WORD}[- ]\\s*)+|(?:\\s+${ORGANIC_WORD})+$`, 'gi');
const BIO_FUSED = /^bio(?!t[iy]n|log|flav|cult|kult|akt|act|fib|fib|sph|mass|gas|eth|dyn|chem|synt|top|tech|degr|sol)(?=[a-zß-ÿ\u0100-\u017f]{4,}$)/i;
function withoutOrganic(ing) {
  if (ing.length > 80 || !/bio|org|eco|[öo]ko|eko|kba/i.test(ing)) return null;
  // A claim or a note is read whole ("certified organic", "*ingrédients biologiques").
  if (CLAIM_ENTRY.test(ing) || LABEL_NOTE.test(ing) || MAY_CONTAIN.test(ing)) return null;
  // German and Dutch also fuse it ("Biohafer", "Biomaïs"); words that merely start with "bio" stay.
  const bare = ing.replace(ORGANIC_EDGE, '').replace(BIO_FUSED, '').trim();
  return bare !== ing && bare.length > 1 ? bare : null;
}

// [{ ing, pos }] where pos is the TOP-LEVEL position, shared by an ingredient's own sub-list.
function parseEntries(text) {
  // "FD&C Red No. 40" and "Red #40" are how US labels print dyes. The full stop after "No" ended the
  // entry ("fd&c red no" / "40"), so the dye went unread; both now read as "no 40".
  const numbered = text.replace(/\bno\.\s*(?=\d)/gi, 'no ').replace(/#\s*(?=\d)/g, 'no ');
  const flat = joinStrains(numbered.replace(/\b((?:contains )?(?:less than \d+(?:\.\d+)?% of|\d+(?:\.\d+)?% or less of)|and\/or)\b/gi, ','));
  const out = [], ids = { n: 0 };
  let pos = -1, strainRun = false;
  for (const part of joinStatements(splitTopLevel(flat))) {
    const strain = STRAIN_ENTRY.test(tidy(part));
    if (!(strain && strainRun)) pos++;
    strainRun = strain;
    for (const e of expandEntry(part, 0, ids)) {
      const bare = withoutOrganic(e.ing);
      out.push({ ing: bare || e.ing, pos, fam: e.fam, parent: e.parent, ...(bare ? { organic: true } : {}) });
    }
  }
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
  const whole = i => hitsAny(labels.WHOLE, i);
  const culinary = i => hits1(labels.CULINARY, i);
  if (hardHits > 0) return 4;
  if (softHits >= 3) return 4;
  if (list.length === 1) {
    if (culinary(list[0])) return 2;
    if (whole(list[0])) return 1;
    return 2;
  }
  if (list.length <= 3 && list.every(culinary)) return 2;
  if (softHits >= 1) return 3;
  if (labels.PROCESSED_SIGNAL.test(text)) return 3;
  if (list.length <= 5 && list.every(whole)) return 1;
  // A short list whose FIRST ingredient is a recognised whole food is overwhelmingly that food —
  // "Atlantic Salmon, Color Added" is salmon with a note, not a manufactured product. Class 2
  // rather than 1, because the trailing ingredients are still doing something.
  if (list.length <= 3 && whole(list[0])) return 2;
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

// Cross-contact statements in each store language. Matched against a whole entry.
const MAY_CONTAIN = new RegExp('^(?:(?:this product )?(?:may|can) (?:also )?contain|(?:may )?contains? traces?|traces? of|possible traces?|traces? possibles?|possibles? traces?'
  + '|(?:produced|made|manufactured|packed) (?:in a (?:factory|facility)|on (?:equipment|a line))'
  + '|peut contenir|traces? (?:[ée]ventuelles? )?d[e\'’]|kann (?:spuren|.*enthalten)|enth[äa]lt spuren|puede contener|trazas de'
  + '|pu[òo] contenere|tracce di|pode conter|vest[íi]gios de|kan (?:sporen|innehålla|spår)|mo[żz]e zawiera[ćc]'
  + '|.*\\bi[çc]erebilir|eser miktarda)', 'i');
// Notes printed inside the list that are not ingredients: organic footnotes, "gluten free", "contains a
// source of phenylalanine", "packaged in a protective atmosphere". Like a "may contain" statement they
// were read as unrecognised ingredients and pulled real lists under the coverage gate.
const LABEL_NOTE = new RegExp('^(?:(?:\\*\\s*)?(?:(?:certified )?organic ingredients?|ingr[ée]dients? (?:issus? de|biologiques?|bio\\b)|.*\\bagriculture biologique'
  + '|ingredienti? (?:da|biologic)|.*agricultura (?:biol[óo]gica|ecol[óo]gica)|.*\\bkontrolliert biologische|.*\\bz upraw ekologiczn|sk[łl]adnik(?:i)?(?: pochodz[ąa]c[ey]| pochodz[ąa]cy)?(?: z)? (?:upraw |rolnictwa )?ekologiczn|.*\\brolnictw[ao] ekologiczn|ekologisk(?:a)? ingrediens(?:er)?|.*\\bfr[åa]n ekologisk|.*\\bekologisk (?:odling|produktion|jordbruk)|.*\\bbiologische landbouw'
  + '|.*commerce [ée]quitable|.*fair ?trade|rainforest alliance'
  // Where it was grown: "(origine Amérique du Nord ou Amérique du Sud)", "(Herkunft: EU)".
  + '|(?:country of )?origine?\\b|provenance\\b|herkunft\\b|origen\\b|provenienza\\b|proveni[êe]ncia\\b|oorsprong\\b|ursprung(?:sland)?\\b|kraj pochodzenia\\b|pochodzenie\\b|men[şs]e(?:i)?(?![a-zß-ÿ\\u0100-\\u017f]))'
  + '|(?:gluten[- ]free|sans gluten|glutenfrei|sin gluten|senza glutine|sem gl[úu]ten|glutenvrij|glutenfri|bezglutenow|glutensiz)$'
  + '|contains? a source of phenylalanine|contient une source de ph[ée]nylalanine|enth[äa]lt eine phenylalaninquelle|contiene una fuente de fenilalanina'
  + '|contiene una fonte di fenilalanina|cont[ée]m uma fonte de fenilalanina|bevat een bron van fenylalanine|inneh[åa]ller en fenylalaninkälla|zawiera [źz]r[óo]d[łl]o fenyloalaniny|fenilalanin kayna[ğg][ıi]'
  + '|packaged in a protective atmosphere|conditionn[ée] sous atmosph[èe]re protectrice|unter schutzatmosph[äa]re verpackt|envasado en atm[óo]sfera protectora'
  + '|confezionato in atmosfera protettiva|embalado em atmosfera protetora|verpakt onder beschermende atmosfeer|f[öo]rpackad i skyddande atmosf[äa]r|pakowano w atmosferze ochronnej|koruyucu atmosferde paketlenmi[şs]tir'
  + '|contient (?:de l[\'’])?alcool|gluten i[çc]erir)', 'i');

// ---------------------------------------------------------------- scoring
// options: { weights, allergens, diets, avoidList }
function score(product, options = {}) {
  const W = db.categories ? db.categories.resolveWeights(options.weights) : {};
  const w_ = id => (id in W ? W[id] : 1);
  // Open Food Facts marks allergens as _WHEAT_ / _SOJA_. An underscore is a word character, so every
  // `\b` rule failed on them: "_wheat_ flour" escaped the flour charge, and "lécithines de _soja_"
  // raised no soy warning. No label prints an underscore, so all of them go, without a space, because
  // they also mark part of a word ("_tarwe_bloem"). Square and curly brackets ("lécithines [SOJA]")
  // are read as the parentheses they stand for.
  // A hyphen left from a line break keeps its spaces in Open Food Facts text ("mono - i diglicerydy",
  // "glucose - fructosestroop", "zuurte - regelaar"), which no rule reads; it is closed up.
  const rawTxt = String(product.ingredients_text || '').replace(/_+/g, '').replace(/[[{]/g, '(').replace(/[\]}]/g, ')')
    .replace(/([a-zß-ÿœ\u0100-\u017f]) +- +([a-zß-ÿœ\u0100-\u017f])/gi, '$1-$2');
  // Parse the list as written, then drop only the entries that are themselves denials. The
  // scoring surface is rebuilt from what survives, so caps and penalties see the real ingredients
  // and never see "no artificial colors". See DENIAL_ENTRY above for why this replaced running
  // stripNegations() over the list.
  // A "may contain" statement is a cross-contact warning, not an ingredient: "may contain traces of
  // wheat" was charged as wheat. It still feeds the allergen flags below, and nothing else.
  const parsed = parseEntries(rawTxt);
  const aside = e => MAY_CONTAIN.test(e.ing) || LABEL_NOTE.test(e.ing);
  const mayContain = [...parsed.filter(aside).map(e => e.ing), ...(product.advisory_text ? [String(product.advisory_text)] : [])];
  const listed = parsed.filter(e => !isDenialEntry(e.ing) && !aside(e));
  // An allergen bracket that only repeats its parent ("Cacahuètes (arachides)", "Arachidi
  // (arachidi)", "cheese (milk)") is a declaration, not a second ingredient: counted as one it made
  // a three-ingredient peanut list four, and NOVA 3 where the English is NOVA 2. It still feeds the
  // allergen flags and the avoid list, where the word it uses may be the one that matters.
  const repeats = new Set(repeatedAllergenBrackets(listed));
  const entries = listed.filter(e => !repeats.has(e));
  const declared = [...repeats].map(e => e.ing);
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
  // Organic footnotes ("*Ingrédients issus de l'agriculture biologique") are set aside from scoring
  // but are claims printed on the regulated list, as "*organic" on its own already counted. So are
  // claim entries: "soybeans (non-GMO)" lost the bonus that "non-GMO soybeans" earns.
  const notes = [...parsed.filter(e => LABEL_NOTE.test(e.ing) || CLAIM_ENTRY.test(e.ing)).map(e => e.ing),
    ...(parsed.some(e => e.organic) ? ['organic'] : [])].join(', ');
  const bonusText = (notes ? txt + ', ' + notes : txt).replace(/\bcultured\s+(dextrose|celery|sugar|corn syrup|wheat|whey)\b[^,;.]*/gi, ' ');

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
  // Classified on the scored list, not the raw text: the eggs and milk of "may contain traces of
  // eggs, milk" made a rye bread an animal product with a sourcing charge (55 against 69).
  const kindInfo = prov ? prov.classify(txt || product.name || '') : null;

  const PROVENANCE_CRITICAL = ['beef', 'lamb', 'pork', 'poultry', 'egg', 'seafood'];
  const provenanceApplies = !!(kindInfo && (kindInfo.animal || kindInfo.seafood) && list.length <= 4);
  // Only the critical kinds hand sourcing over to the provenance block entirely. For dairy and
  // produce the generic label bonuses still apply, otherwise grass-fed butter quietly lost the
  // credit it had before this feature existed.
  const provenanceOwnsSourcing = provenanceApplies && PROVENANCE_CRITICAL.includes(kindInfo.kind);

  const good = [], bad = [], seen = new Set();
  const hits = [], rewards = [];
  let hardHits = 0, softHits = 0;
  const tradPrep = add.TRADITIONAL_PREP.test(txt);

  // A function word is an undisclosed additive only when nothing names the additive. EU labels
  // write "Emulsifier (Soy Lecithin)", so its own bracket names it; US labels write "Sodium
  // Benzoate (Preservative)", so the entry whose bracket holds nothing but function words names it.
  // Charging the word as well as the additive cost a label 7–9 points for saying more, and
  // "Annatto (Color)" — a natural colour, fully disclosed — was charged as an unnamed one.
  // It used to go by position, which a whole sub-list shares: "chocolate (sugar, cocoa butter,
  // emulsifier)" left the emulsifier uncharged because the sugar beside it was recognised.
  // The bare function word is not its own disclosure. Several translated words also live in
  // COMMON_PANEL so they contribute to coverage; without this guard a standalone "conservante"
  // or "emulgator" was recognised there and incorrectly suppressed its own unnamed charge.
  const bare = e => add.UNNAMED.some(r => r.m.test(e.ing));
  const names = e => !bare(e) && recognised(e.ing, { unnamed: false });
  const byFam = new Map(entries.map(e => [e.fam, e]));
  const childrenOf = new Map();
  for (const e of entries) if (e.parent) childrenOf.set(e.parent, [...(childrenOf.get(e.parent) || []), e]);
  const namedFam = new Set();
  for (const e of entries) {
    const kids = childrenOf.get(e.fam) || [];
    if (kids.some(names)) namedFam.add(e.fam);
    const up = byFam.get(e.parent);
    if (up && names(up) && (childrenOf.get(e.parent) || []).every(bare)) namedFam.add(e.fam);
  }

  // For the fat-reduced dairy rule: is there full-fat dairy ahead of this position?
  const fullFatTitle = labels.FULL_FAT_TITLE ? labels.FULL_FAT_TITLE.test(product.name || '') : false;
  const firstFullFat = entries.reduce((min, e) => (e.pos < min && labels.isFullFatDairy && labels.isFullFatDairy(e.ing) ? e.pos : min), Infinity);
  const fullFatBefore = pos => firstFullFat < pos;

  entries.forEach(({ ing, pos, fam }) => {
    const w = weight(pos);
    const tripped = penaltiesFor(ing);

    const isFreeSugar = hitsAny(sugars.FREE, ing);
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
      if (!tripped.has(r)) continue;
      if (seen.has(r.why)) continue;
      if (r.unnamed && namedFam.has(fam)) continue;   // the additive is named in or around its bracket
      // "flavouring (vanillin)" is not an unspecified flavouring: its bracket names one, which is
      // charged under its own rule.
      if (r.why === 'Unspecified flavouring' && (childrenOf.get(fam) || []).some(c => add.FLAVOURS.some(f => f.why !== r.why && !/^"Natural|^Artificial flavour$/.test(f.why) && f.m.test(c.ing)))) continue;
      // Fat-reduced dairy describes the product only when it is mostly fat-reduced: not when
      // full-fat dairy comes earlier in the list, or the title says whole milk / full fat.
      if (r.cat === 'reducedFatDairy' && (fullFatTitle || fullFatBefore(pos))) {
        if (!seen.has('fullFatLead')) {
          seen.add('fullFatLead');
          good.push({ c: 0, why: 'Mostly full-fat dairy — the fat-reduced dairy in it is not counted', ing });
        }
        continue;
      }
      // Sugar that comes with its whole food is exempt unless the user turns 'naturally occurring
      // sugars' on, at which point it is scored like any other sugar.
      // Traditional preparation (sourdough, sprouting, soaking) halves the grain penalty rather
      // than erasing it — zeroing it while also paying a bonus double-counted the same fact and
      // pushed sprouted bread to 95.
      const tradRelief = (r.gluten && tradPrep) ? 0.5 : 1;
      if (/citric acid|lactic acid/i.test(r.why) && FERMENT_ACID.test(ing)) continue;
      if (r.exemptIf && r.exemptIf.test(ing)) continue;
      if (r.exemptIfText && r.exemptIfText.test(txt)) continue;
      seen.add(r.why);
      // Processing describes the label, independent of the user's penalty preferences.
      if (!(r.gluten && tradPrep) && !(isFreeSugar && r.group === 'sugar')) {
        if (r.upf === 'hard') hardHits++;
        else if (r.upf === 'soft') softHits++;
      }
      if (isFreeSugar && r.group === 'sugar' && w_('naturalSugar') === 0) continue;
      const cw = w_(r.cat);
      if (cw < 0) {
        const earned = r.pts * w * -cw * tradRelief;
        if (earned >= 0.5) rewards.push({ off: Math.round(earned), why: r.why, ing, group: r.group, cat: r.cat });
        continue;
      }
      const scaled = r.pts * w * cw * tradRelief;
      if (scaled < 0.5) continue;                       // category switched off by the user
      hits.push({ off: Math.round(scaled), why: r.why, ing, group: r.group, cat: r.cat, refined: !!r.refined });
    }
  });

  const { kept, total: rawPenalty } = collapse(hits);
  const nova = novaClass(list, txt, hardHits, softHits);
  // Named strains are one ingredient ("cultures") spelled out, not a long recipe.
  const listLength = list.filter(i => !STRAIN_ENTRY.test(i)).length;
  const listPenalty = listLength > 20 ? 8 : 0;
  const rawTotal = rawPenalty + listPenalty;
  const penalty = saturate(rawTotal);

  // The panel shows a line per problem. Those lines must add up to the score the user is looking
  // at, so the saturation discount is distributed back across them proportionally rather than
  // applied invisibly at the end. Largest remainder gets the rounding slack.
  const shown = kept.map(h => ({ raw: h.scaled, why: h.why, ing: h.ing, cat: h.cat, refined: h.refined }));
  if (listPenalty) shown.push({ raw: listPenalty, why: `Very long ingredient list (${listLength} items)` });
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
  for (const h of shown) {
    const row = { c: h.c, why: h.why, ing: h.ing };
    if (h.cat) row.cat = h.cat;
    if (h.refined) row.refined = true;
    bad.push(row);
  }

  // The processing weight scales how far the NOVA class pulls the starting score down from 100.
  // Weight 0 means processing level is ignored entirely and every product starts at 100.
  const baseRaw = NOVA_BASE[nova];
  const base = Math.round(100 - (100 - baseRaw) * w_('processing'));
  let pts = base - penalty;

  // bonuses
  // When the provenance block is active it scores sourcing with far better resolution (verified vs
  // claimed, per certification). Paying the generic label bonus as well double-counts the same fact.
  const PROV_OVERLAP = /grass-fed|pasture|wild-caught|organic|regenerativ|non-gmo/i;
  // A label claim lifts a product, not an ingredient. When every ingredient on the list is itself
  // penalised or capped there is nothing for "organic" to be a better version of: a bag of organic
  // cane sugar scored 81 Good against 73 for plain sugar, and the cane rule was the only row.
  const capsHit = CAPS.filter(c => eitherForm(c.m, txt));
  const allPenalised = list.length > 0
    && list.every(i => hits.some(h => h.ing === i && h.cat !== 'naturalSugar') || capsHit.some(c => eitherForm(c.m, i)));
  let bonus = 0, titleBonus = 0;
  for (const b of labels.BONUSES) {
    if (allPenalised) break;
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

  // Goal rewards: largest first, trimmed at the cap so the rows still add up to what was added.
  let rewardLeft = GOAL_REWARD_CAP;
  for (const h of collapse(rewards).kept.sort((a, b) => b.scaled - a.scaled)) {
    const c = Math.min(h.scaled, rewardLeft);
    if (c < 1) break;
    rewardLeft -= c;
    pts += c;
    good.push({ c, why: `${goalHead(h.why)} — a plus for your goals`, ing: h.ing, cat: h.cat, goal: true });
  }

  // hard caps
  let cap = 100, capWhy = null;
  for (const c of capsHit) {
    let ceiling = c.cap;
    if (c.unless) {
      // Checked per entry, not against the whole text: a product listing both "sunflower oil" and
      // "cold-pressed olive oil" must keep the sunflower cap. Only when every entry naming this
      // oil carries the qualifier does the softer ceiling apply.
      const naming = list.filter(i => eitherForm(c.m, i));
      if (naming.length && naming.every(i => c.unless.test(i))) ceiling = c.soften;
    }
    // A ceiling of 25 at weight 1 becomes no ceiling at weight 0 and a ceiling of 0 at weight 2.
    // Clamped at the floor: at weight 2 the arithmetic can produce a negative ceiling, which then
    // escaped the band lookup entirely and crashed on an undefined verdict.
    const eff = Math.max(SCORE_FLOOR, Math.round(100 - (100 - ceiling) * w_(c.cat)));
    if (eff >= 100) continue;                            // category switched off by the user
    if (eff < cap) { cap = eff; capWhy = c.why; }
    // The row text carries a suffix, so an exact comparison never matched and two rules with the
    // same reason produced two rows.
    if (!bad.some(h => h.why.startsWith(c.why))) bad.push({ c: 'CAP', why: `${c.why} — caps score at ${eff}` });
  }

  // The bonus is for a whole food that is its own list, not for any lone ingredient: plain sugar
  // and a bottle of sunflower oil used to collect it too, next to their own penalty or cap.
  const simple = Math.round(4 * w_('simplicity'));
  const lone = list.length === 1 && (hitsAny(labels.WHOLE, list[0]) || hits1(labels.CULINARY, list[0]));
  if (lone && simple > 0 && !hits.length && !capsHit.length) {
    pts += simple;
    good.push({ c: +simple, why: 'Single-ingredient whole food' });
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
    // A declared 100 g basis (an EU panel) is already per 100g, and its rows should say so.
    if (per100 !== 1 || grams === 100) nut._normalised = true;
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
    ? [...db.allergens.detect([...list, ...declared, ...mayContain], options.allergens || [], options.diets || []),
       ...db.allergens.matchAvoidList([...list, ...declared], options.avoidList || [])]
    : [];

  // How much of this list the rulebase could actually read. Reported, never scored — a low number
  // means "we cannot assess this", which is a different statement from a low score.
  const coverage = recognitionCoverage(entries);

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
    // Proportionally, not biggest-first. Taking as much as possible from the largest row inverted
    // the ranking it was meant to preserve: on certified grass-fed beef the American Grassfed
    // certification (16 points, the strongest evidence available) displayed as +1 while USDA
    // Organic (12) displayed as +4, telling the reader the weaker certification counted for more.
    // Scaling every row by the same factor keeps the order of the evidence intact.
    const rows = good.filter(g => typeof g.c === 'number' && g.c > 0);
    const room = rows.reduce((a, g) => a + (g.c - 1), 0);   // each row keeps at least 1 point
    const take = Math.min(shave, Math.max(0, room));
    if (take > 0) {
      const cut = rows.map(g => ((g.c - 1) * take) / room);
      const whole = cut.map(Math.floor);
      let left = take - whole.reduce((a, b) => a + b, 0);
      // Largest remainder gets the leftover, so the rows still sum to exactly `take`.
      rows.map((g, i) => [i, cut[i] - whole[i]])
        .sort((a, b) => b[1] - a[1])
        .forEach(([i]) => { if (left > 0) { whole[i]++; left--; } });
      rows.forEach((g, i) => { g.c -= whole[i]; });
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
    selectedAllergens: options.allergens || [],
    good, bad,
    parsed: list.length,
    coverage,
    ruleCount: PENALTIES.length + CAPS.length + labels.BONUSES.length,
  };
}

return { score, parse, parseEntries, stripNegations, PENALTIES, CAPS, BANDS, NOVA_BASE };
});
