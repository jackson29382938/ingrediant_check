// Is this thing food?
//
// The extension injects on every amazon.com product page, which means it was also offering opinions
// about running shoes. Mostly that was noise — no ingredients found, honest-failure panel, shrug.
//
// The sharper problem is the products that DO have an ingredient list and are not food. Shampoo,
// lotion, sunscreen, laundry detergent and lipstick all publish ingredients, and the scoring engine
// will happily read them. "Sodium Laureth Sulfate, Cocamidopropyl Betaine" parses perfectly well and
// would come back as an ultra-processed food. A score on a bottle of shampoo is not a harmless
// false positive: it implies the thing was assessed as something you could eat.
//
// So the gate is deliberately asymmetric. Positive evidence has to be real — Amazon's own grocery
// nutrition card, a Nutrition or Supplement Facts panel, a food department. Negative evidence wins
// ties, because staying quiet on a food is a small cost and scoring a cosmetic is a real one.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

// ---------------------------------------------------------------- positive evidence
const STRONG_POSITIVE = [
  { id: 'nutritionCard', pts: 6, why: "Amazon's grocery nutrition and ingredients card is present",
    test: doc => !!doc.querySelector('#nutritionalInfoAndIngredients_feature_div, #nic-ingredients-content, .nicDesktop') },
  { id: 'nutritionPanel', pts: 5, why: 'Nutrition Facts panel',
    // Amazon's international stores print the same panel under local names. Without these the
    // food gate scores 0 outside the US and every product is judged not-food, which would make
    // enabling those domains worse than not supporting them.
    test: (doc, text) => /\bnutrition(al)? (facts|information)\b|\bn[äa]hrwert(angaben|e)?\b|\bvaleurs nutritionnelles\b|\binformaci[óo]n nutricional\b|\bvalori nutrizionali\b|\binforma[çc][ãa]o nutricional\b|\bvoedingswaarde\b|\bn[äa]ringsv[äa]rde\b|\bwarto[śs][ćc] od[żz]ywcza\b|栄養成分/i.test(text) },
  { id: 'supplementPanel', pts: 5, why: 'Supplement Facts panel',
    test: (doc, text) => /\bsupplement facts\b/i.test(text) },
  { id: 'servingSize', pts: 3, why: 'Serving size and servings per container',
    test: (doc, text) => /\bserving size\b|\bservings per container\b|\bportionsgr[öo]sse\b|\bpro portion\b|\bportion\b|\bpor[cç][ãa]o\b|\bporci[óo]n\b|\bporzione\b|\bper 100 ?g\b/i.test(text) },
  { id: 'foodDept', pts: 5, why: 'Listed in a food or supplement department',
    test: (doc, text) => /\b(grocery & gourmet food|grocery and gourmet food|grocery|food cupboard|fresh food|whole foods market|amazon fresh|vitamins & dietary supplements|vitamins and dietary supplements|sports nutrition|baby food|health & personal care)\b/i.test(text)
      || /\b(lebensmittel|getr[äa]nke|drogerie & k[öo]rperpflege|[ée]picerie|alimentation|produits frais|alimentaci[óo]n|supermercado|alimentari|generi alimentari|mercearia|boodschappen|livsmedel|artyku[łl]y spo[żz]ywcze|g[ıi]da)\b/i.test(text)
      || /食品|飲料|食品・飲料/.test(text) },
  { id: 'foodForm', pts: 2, why: 'Food-specific product attributes',
    test: (doc, text) => /\b(food form|diet type|flavou?r name|allergen information|country of origin)\b/i.test(text) },
];

const WEAK_POSITIVE = [
  { id: 'edibleWords', pts: 2, why: 'Edible product words in the title',
    test: (doc, text, title) => /\b(snack|cereal|beverage|drink|coffee|tea|juice|sauce|seasoning|spice|flour|pasta|rice|beans?|jerky|bar|gummies|capsules?|tablets?|softgels?|powder|protein|vitamin|probiotic|collagen|electrolyte)\b/i.test(title) },
  { id: 'edibleFood', pts: 3, why: 'Named food in the title',
    test: (doc, text, title) => /\b(beef|pork|chicken|turkey|lamb|fish|salmon|tuna|shrimp|egg|milk|cheese|yogh?urt|butter|bread|oil|honey|fruit|vegetable|nuts?|chocolate|cookie|chips?|soup|broth)\b/i.test(title) },
];

// ---------------------------------------------------------------- negative evidence
// These outrank positives. A shampoo bottle can mention "nourishing" and "extract" all day.
const HARD_NEGATIVE = [
  { id: 'externalUse', pts: 20, why: 'Labelled "for external use only"',
    test: (doc, text) => /\bfor external use only\b|\bnot for (human )?(internal )?consumption\b|\bdo not (ingest|swallow)\b/i.test(text) },
  { id: 'drugFacts', pts: 16, why: 'Drug Facts panel — medicine, not food',
    test: (doc, text) => /\bdrug facts\b/i.test(text) },
  { id: 'nonFoodDept', pts: 14, why: 'Listed in a non-food department',
    test: (doc, text) => /\b(clothing, shoes & jewelry|shoes & (bags|jewelry)|toys & games|electronics|cell phones & accessories|tools & home improvement|automotive|books|video games|musical instruments|office products|patio, lawn & garden|sports & outdoors|arts, crafts & sewing|industrial & scientific|appliances|luggage|beauty & personal care|beauty and personal care|luxury beauty|premium beauty|fashion|garden & outdoors|home & kitchen)\b/i.test(text)
      || /\b(bekleidung|schuhe & handtaschen|elektronik|spielzeug|b[üu]cher|baumarkt|auto & motorrad|k[üu]che & haushalt|beleuchtung|schmuck|v[êe]tements|chaussures|informatique|livres|bricolage|jardin|jeux et jouets|beaut[ée] et parfum|ropa|zapatos|electr[óo]nica|libros|juguetes|bricolaje|belleza|abbigliamento|scarpe|elettronica|libri|giocattoli|bellezza|kleding|schoenen|elektronica|speelgoed|odzie[żz]|elektronika|zabawki)\b/i.test(text) },
  { id: 'cosmetic', pts: 12, why: 'Cosmetic or topical personal-care product',
    test: (doc, text, title) => /\b(shampoo|conditioner|body wash|body lotion|face cream|moisturi[sz]er|serum|deodorant|antiperspirant|sunscreen|sunblock|makeup|foundation|mascara|lipstick|lip gloss|nail polish|perfume|cologne|shaving|aftershave|toothpaste|mouthwash|soaps?|hand sanitizer|hair (dye|colou?r|spray|gel|mask)|face mask|exfoliant|cleanser|toner)\b/i.test(title) },
  { id: 'household', pts: 12, why: 'Cleaning or household chemical product',
    test: (doc, text, title) => /\b(laundry detergent|dish(washer)? (soap|detergent)|all[- ]purpose cleaner|disinfectant|bleach|fabric softener|air freshener|toilet|drain cleaner|degreaser|glass cleaner|floor cleaner|insect(icide)? (spray|killer)|pesticide|motor oil|antifreeze)\b/i.test(title) },
  { id: 'medicine', pts: 12, why: 'Over-the-counter medicine',
    test: (doc, text, title) => /\b(pain reliever|cough (syrup|drops)|cold (and|&) flu|ibuprofen|acetaminophen|antacid|laxative|nasal spray|eye drops|first aid kit)\b/i.test(title) },
  { id: 'essentialOil', pts: 12, why: 'Essential oil or fragrance oil — not a food',
    test: (doc, text, title) => /\b(essential oil|fragrance oil|diffuser oil)\b/i.test(title) },
  { id: 'petFood', pts: 10, why: 'Pet food — scored by rules written for human diets',
    test: (doc, text, title) => /\b(dog|cat|puppy|kitten|pet|canine|feline|bird|reptile|ferret|hamster) (food|treats?|chews?|kibble|formula|supplement)\b|\bpet supplies\b/i.test(title + ' ' + text) },
  { id: 'equipment', pts: 12, why: 'Equipment or kitchenware rather than something you eat',
    test: (doc, text, title) => /\b(blenders?|cookware|skillets?|frying pans?|sauce pans?|stock pots?|dutch ovens?|instant pots?|pressure cookers?|chef'?s? knives|steak knives|cutting boards?|food storage|storage containers?|bottle openers?|utensils?|travel mugs?|dinner plates?|bowl sets?|thermos|lunch box(es)?|air fryers?|stand mixers?|food processors?|electric (grill|smoker|kettle)s?|gas grills?|pellet (grill|smoker)s?)\b/i.test(title) },
  // "cap", "hat" and "watch" only count with an apparel word beside them: a bare `cap` made ketchup
  // "with Flip Cap" not-food, and a bottle cap, a screw cap and a sports cap are all groceries.
  { id: 'apparel', pts: 12, why: 'Apparel or footwear',
    test: (doc, text, title) => /\b(shoes?|sneakers?|boots?|sandals?|shirt|t-shirt|pants|jeans|jacket|hoodie|socks?|(?:baseball|trucker|snapback|bucket|beanie|knit|sun|dad|men'?s|women'?s|kids'?|unisex)\s+(?:cap|hat)s?|(?:wrist|smart|analog|digital|quartz|apple|sports?)\s?watch(?:es)?|watch\s+(?:band|strap)s?|dress|skirt|shorts|underwear|bra|handbag|backpack|wallet)\b/i.test(title) },
  { id: 'merchandise', pts: 12, why: 'General merchandise rather than something you eat',
    test: (doc, text, title) => /\b(laptops?|desktops?|monitors?|keyboards?|headphones?|earbuds?|speakers?|chargers?|cables?|adapters?|batteries|battery|tablets? (computer|pc)|smartphones?|iphones?|ipads?|cameras?|printers?|routers?|televisions?|\btvs?\b|consoles?|controllers?|video games?|puzzles?|board games?|lego|dolls?|action figures?|mattress(es)?|pillows?|blankets?|towels?|curtains?|rugs?|lamps?|desks?|chairs?|sofas?|couch(es)?|bookshel(f|ves)|vacuums?|paperback|hardcover|dvds?|blu[- ]?rays?|tires?|brake pads?|drills?|hammers?|screwdrivers?|wrench(es)?|paint(brush(es)?)?|notebooks?|binders?|staplers?|printer paper|light bulbs?|extension cords?)\b/i.test(title) },
  // "Case of 24", "Variety Case" and "with Scoop" are how groceries are sold; a bare "case" is a
  // phone case and a bare "scoop" is a utensil. The unguarded words made a case of sparkling water
  // not-food on its own page and stood a whole sparkling-water search down.
  // "Funnel Cake Mix" is a dessert and "24 Count Case" is how sparkling water is sold.
  { id: 'supplementEquipment', pts: 8, why: 'Accessory rather than a consumable',
    test: (doc, text, title) => /\b(shaker bottle|pill organi[sz]er|dispenser|funnel(?!\s+cakes?)|holder)\b|(?<!variety\s|count\s|ct\s|pack\s|pk\s|cans?\s|bottles?\s|\d\s|\d)\bcases?\b(?!\s+(?:of\s+)?\d)|(?<!with\s|includes\s|free\s|\+\s)\bscoops?\b(?!\s+included)/i.test(title) },
];

// Some words appear in both worlds and must not be treated as food evidence on their own:
// "collagen serum" is skincare, "protein shaker" is a bottle.
// "cream" is topical only when it is not ice cream, cream cheese, sour cream, a coffee creamer or
// a cream filling — "Protein Ice Cream" is a freezer aisle, not a skincare shelf.
const AMBIGUOUS_PAIRS = /\b(collagen|protein|vitamin|biotin|keratin|caffeine|charcoal|aloe|coconut oil|shea)\b[^.]{0,20}\b(serum|(?<!ice |sour |whipped |heavy |double |coffee |clotted )cream(?!\s+(?:cheese|soda|liqueur|filling|sauce|puffs?|of\b)|er\b)|lotion|mask|shampoo|conditioner|soap|scrub|balm|oil for (hair|skin))\b/i;

const THRESHOLD = 4;

// `doc` is a Document; `title`/`text` are pulled from it when not supplied.
function assess(doc, opts = {}) {
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const title = opts.title != null ? opts.title
    : clean(doc.querySelector('#productTitle')?.innerText || doc.title || '');
  // Bounded: a whole Amazon page's innerText is large and this runs on every navigation.
  const text = opts.text != null ? opts.text
    : clean([
        doc.querySelector('#wayfinding-breadcrumbs_feature_div')?.innerText,
        doc.querySelector('#detailBullets_feature_div, #productDetails_detailBullets_sections1')?.innerText,
        doc.querySelector('#feature-bullets')?.innerText,
        doc.querySelector('#important-information')?.innerText,
        doc.querySelector('#nav-subnav')?.getAttribute('data-category'),
        title,
      ].filter(Boolean).join(' \n ')).slice(0, 8000);

  const positives = [], negatives = [];
  let score = 0;

  for (const rule of HARD_NEGATIVE) {
    try {
      if (rule.test(doc, text, title)) { negatives.push(rule); score -= rule.pts; }
    } catch (e) { /* a broken probe must not break the page */ }
  }
  for (const rule of [...STRONG_POSITIVE, ...WEAK_POSITIVE]) {
    try {
      if (rule.test(doc, text, title)) { positives.push(rule); score += rule.pts; }
    } catch (e) { /* ignore */ }
  }
  if (AMBIGUOUS_PAIRS.test(title)) {
    negatives.push({ id: 'ambiguousTopical', pts: 10,
      why: 'Food-adjacent word used in a topical product name' });
    score -= 10;
  }

  const ok = score >= THRESHOLD;
  return {
    ok,
    score,
    kind: negatives.length ? negatives[0].id : (positives[0] ? positives[0].id : 'unknown'),
    reason: ok
      ? (positives[0] ? positives[0].why : 'Food evidence present')
      : (negatives[0] ? negatives[0].why : 'No evidence this is food, a supplement, or otherwise ingestible'),
    positives: positives.map(p => p.id),
    negatives: negatives.map(n => n.id),
  };
}

// Title-only assessment. A stub document is used so the surrounding page cannot leak department
// crumbs into the verdict, which makes this both cheap and portable: one short string in, a full
// verdict out, no DOM walk. That is what lets a product page reject a shampoo before paying for
// extract().
function assessTitle(title) {
  const stub = { querySelector: () => null };
  return assess(stub, { title: title || '', text: title || '' });
}

// Prefilter. Only returns true when there is *negative* evidence — an ambiguous title still goes
// to the product page, where Nutrition Facts can save a store-brand food.
function looksNonFoodFromTitle(title) {
  const g = assessTitle(title);
  return !g.ok && g.negatives.length > 0;
}

// ---------------------------------------------------------------- search-page gate
//
// assess() answers "is THIS thing food". It cannot answer "is this whole search about food", and
// nothing did: searching for running shoes still swept every result tile, armed hover listeners on
// each one and ran the IntersectionObserver over the page. Individually harmless, collectively the
// extension was running everywhere it had no business running.
//
// Amazon states the department in the URL, which is a far better signal than any single tile
// title. `i=` carries the search alias; the dropdown carries the human label. Query text is the
// weakest of the three and is only consulted when neither department signal is present.
//
// Ambiguity resolves to ALLOW, unlike the per-product gate. A search page is not a claim about
// anything — the per-tile filter and the per-product gate still stand behind it — so the cost of
// staying on is low, while wrongly standing down on a grocery search makes the extension look
// broken. Only clear negative evidence stops it.

// Amazon search-alias values (the `i=` parameter).
const FOOD_ALIASES = /^(grocery|amazonfresh|fresh|wholefoods|gourmet-food|natural-foods|specialty-foods|beverages|nutrition)$/i;
const NONFOOD_ALIASES = /^(fashion(-\w+)?|apparel|shoes|watches|jewelry|handbags|luggage|electronics|computers|mobile|photo|videogames|software|instant-video|movies-tv|dvd|music|popular|classical|stripbooks|digital-text|audible|audiobooks|toys-and-games|baby-toys|tools|hi|garden|lawngarden|appliances|automotive|industrial|mi|office-products|arts-crafts|sporting|outdoor|pets|beauty|luxury-beauty|premium-beauty|gift-cards|collectibles|handmade|vehicles|financial|localservices|smart-home|furniture|kitchen)$/i;

const STUB_DOC = { querySelector: () => null };
const ruleById = (list, id) => list.find(r => r.id === id);

// ctx: { query, alias, label } — all plain strings, so this is testable without a DOM.
function assessSearch(ctx = {}) {
  const query = String(ctx.query || '').trim();
  const alias = String(ctx.alias || '').trim();
  const label = String(ctx.label || '').trim();

  if (alias && FOOD_ALIASES.test(alias)) {
    return { ok: true, signal: 'department', reason: `Searching a food department (${alias})` };
  }
  if (alias && NONFOOD_ALIASES.test(alias)) {
    return { ok: false, signal: 'department', reason: `Searching the ${alias.replace(/-/g, ' ')} department` };
  }

  // The visible dropdown label, for the shapes where Amazon omits `i=`.
  if (label) {
    const food = ruleById(STRONG_POSITIVE, 'foodDept');
    if (food && food.test(STUB_DOC, label, label)) {
      return { ok: true, signal: 'label', reason: `Searching ${label}` };
    }
    const nonFood = ruleById(HARD_NEGATIVE, 'nonFoodDept');
    if (nonFood && nonFood.test(STUB_DOC, label, label)) {
      return { ok: false, signal: 'label', reason: `Searching ${label}` };
    }
  }

  // Weakest signal, and deliberately last: "organic" is a query, "running shoes" is a verdict.
  if (query && looksNonFoodFromTitle(query)) {
    return { ok: false, signal: 'query', reason: `"${query}" is not a search for food` };
  }

  return { ok: true, signal: 'none', reason: 'Nothing in this search says it is not about food' };
}

// Last resort, used when the department and query are both silent: Amazon's own results say what
// the search meant. A clear majority of non-food titles is a stronger statement than an ambiguous
// query, and it catches brand-name searches ("nike air max") that name no category at all.
const RESULT_SAMPLE_MIN = 5;
const RESULT_NONFOOD_SHARE = 0.7;

function looksNonFoodFromResults(titles) {
  const usable = (titles || []).map(t => String(t || '').trim()).filter(t => t.length > 2);
  if (usable.length < RESULT_SAMPLE_MIN) return false;   // too little to conclude anything
  const nonFood = usable.filter(t => looksNonFoodFromTitle(t)).length;
  return nonFood / usable.length >= RESULT_NONFOOD_SHARE;
}

// Open Food Facts is a food database, but barcodes collide with Open Beauty Facts / Open Products
// Facts. product_type is the clean signal; categories catch older records that omit it.
function isOpenFoodFactsFood(product) {
  if (!product) return false;
  const type = String(product.product_type || '').toLowerCase();
  if (type && type !== 'food') return false;
  const hay = [
    ...(product.categories_tags || []),
    product.pnns_groups_1 || '',
    product.categories || '',
  ].join(' ').toLowerCase();
  if (/\b(en:beauty|en:cosmetics?|en:shampoos?|en:hair-care|en:skin-care|en:detergents?|en:household|en:pet-foods?|beauty|cosmetic)\b/.test(hay)) {
    return false;
  }
  return true;
}

const _exports = AIRmodule('ingestible', {
  assess, assessTitle, looksNonFoodFromTitle, isOpenFoodFactsFood,
  assessSearch, looksNonFoodFromResults,
  STRONG_POSITIVE, WEAK_POSITIVE, HARD_NEGATIVE, THRESHOLD,
  FOOD_ALIASES, NONFOOD_ALIASES, RESULT_SAMPLE_MIN, RESULT_NONFOOD_SHARE,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
