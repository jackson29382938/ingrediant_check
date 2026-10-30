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
    test: (doc, text) => /\bnutrition(al)? (facts|information)\b|\bn[äa]hrwert(angaben|e)?\b|\bvaleurs nutritionnelles\b|\binformaci[óo]n nutricional\b|\bvalori nutrizionali\b|\binforma[çc][ãa]o nutricional\b|\bvoedingswaarde\b|\bn[äa]ringsv[äa]rde\b|\bwarto[śs][ćc] od[żz]ywcza\b|\bbesin de[ğg]erleri\b|\bbeslenme bilgisi\b|栄養成分/i.test(text) },
  { id: 'supplementPanel', pts: 5, why: 'Supplement Facts panel',
    test: (doc, text) => /\bsupplement facts\b/i.test(text) },
  { id: 'servingSize', pts: 3, why: 'Serving size and servings per container',
    test: (doc, text) => /\bserving size\b|\bservings per container\b|\bportionsgr[öo]sse\b|\bpro portion\b|\bportion\b|\bpor[cç][ãa]o\b|\bporci[óo]n\b|\bporzione\b|\bporsiyon\b|\bper 100 ?g\b/i.test(text) },
  { id: 'foodDept', pts: 5, why: 'Listed in a food or supplement department',
    test: (doc, text) => /\b(grocery & gourmet food|grocery and gourmet food|grocery|food cupboard|fresh food|whole foods market|amazon fresh|vitamins & diet(?:ary)? supplements|vitamins and diet(?:ary)? supplements|sports nutrition|baby food|health & personal care)\b/i.test(text)
      || /\b(lebensmittel|getr[äa]nke|drogerie & k[öo]rperpflege|[ée]picerie|alimentation|produits frais|alimentaci[óo]n|supermercado|alimentari|generi alimentari|mercearia|boodschappen|livsmedel|artyku[łl]y spo[żz]ywcze|g[ıi]da)\b/i.test(text)
      || /食品|飲料|食品・飲料/.test(text) },
  { id: 'foodForm', pts: 2, why: 'Food-specific product attributes',
    test: (doc, text) => /\b(food form|diet type|flavou?r name|allergen information|country of origin)\b/i.test(text) },
];

const WEAK_POSITIVE = [
  { id: 'edibleWords', pts: 2, why: 'Edible product words in the title',
    test: (doc, text, title) => /\b(snack|cereal|granola|muesli|beverage|drink|coffee|tea|juice|sauce|seasoning|spice|flour|pasta|rice|beans?|jerky|bar|gummies|capsules?|tablets?|softgels?|powder|protein|vitamin|probiotic|collagen|electrolyte)\b/i.test(title) },
  { id: 'edibleFood', pts: 3, why: 'Named food in the title',
    test: (doc, text, title) => /\b(beef|pork|chicken|turkey|lamb|fish|salmon|tuna|shrimp|egg|milk|cheese|yogh?urt|butter|bread|oil|honey|fruit|vegetable|nuts?|chocolate|cookie|chips?|soup|broth)\b/i.test(title) },
];

// ---------------------------------------------------------------- negative evidence
// The same non-food products in each store's own language. `\b` cannot see a leading or trailing
// "ü", "ş" or "ú", so these take explicit boundaries. Only the product words: "pasta" alone is food,
// "pasta de dientes" is not; "mama" is a Turkish baby food, "köpek maması" is dog food.
const LB = '(?<![a-zß-ÿ\\u0100-\\u017f])';
const RB = '(?![a-zß-ÿ\\u0100-\\u017f])';
const words = list => new RegExp(LB + '(?:' + list.join('|') + ')' + RB, 'i');
const COSMETIC_WORDS = words([
  'zahnpasta', 'zahncreme', 'duschgel', 'duschbad', 'haarsp[üu]lung', 'sonnencreme',   // de
  'dentifrice', 'shampooing', 'gel douche', 'cr[èe]me solaire',                         // fr
  'champ[úu]', 'pasta de dientes', 'dent[íi]frico', 'gel de (?:ducha|ba[ñn]o)', 'protector solar', // es
  'dentifricio', 'bagnoschiuma', 'balsamo per capelli',                                 // it
  'tandpasta', 'douchegel', 'zonnebrandcr[èe]me',                                      // nl
  'creme dental', 'pasta de dente', 'sabonete', 'protetor solar',                       // pt
  'tandkr[äa]m', 'schampo', 'duschtv[åa]l', 'solkr[äa]m',                               // sv
  'pasta do z[ęe]b[óo]w', 'szampon', '[żz]el pod prysznic', 'krem do opalania',          // pl
  'di[şs] macunu', '[şs]ampuan', 'du[şs] jeli', 'g[üu]ne[şs] kremi',                    // tr
]);
const HOUSEHOLD_WORDS = words([
  'waschmittel', 'sp[üu]lmittel', 'weichsp[üu]ler', 'allzweckreiniger',
  'lessive', 'liquide vaisselle', 'adoucissant', 'nettoyant',
  'detergente', 'lavavajillas', 'suavizante', 'lej[íi]a',
  'detersivo', 'ammorbidente', 'candeggina',
  'wasmiddel', 'afwasmiddel', 'wasverzachter',
  'amaciante', '[áa]gua sanit[áa]ria',
  'tv[äa]ttmedel', 'diskmedel', 'sk[öo]ljmedel',
  'proszek do prania', 'p[łl]yn do (?:naczy[ńn]|p[łl]ukania)',
  'deterjan[ıi]?', 'yumu[şs]at[ıi]c[ıi]', '[çc]ama[şs][ıi]r suyu',
]);
const PET_WORDS = words([
  'hundefutter', 'katzenfutter', 'hundesnacks?',
  'nourriture pour (?:chiens?|chats?)', 'croquettes (?:pour )?(?:chiens?|chats?)',
  'comida para (?:perros?|gatos?)', 'pienso (?:para )?(?:perros?|gatos?)',
  'cibo per (?:cani|gatti)', 'crocchette per (?:cani|gatti)',
  'hondenvoer', 'kattenvoer', 'hondensnacks?',
  'ra[çc][ãa]o (?:para )?(?:c[ãa]es|gatos|cachorros?)',
  'hundmat', 'kattmat', 'hundgodis',
  'karma dla (?:ps[aó]w?|kot[aó]w?|kota)',
  'k[öo]pek mamas[ıi]', 'kedi mamas[ıi]',
]);

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
    test: (doc, text, title) => /\b(shampoo|conditioner|body wash|body lotion|face cream|moisturi[sz]er|serum|deodorant|antiperspirant|sunscreen|sunblock|makeup|foundation|mascara|lipstick|lip gloss|nail polish|perfume|cologne|shaving|aftershave|toothpaste|mouthwash|soaps?|hand sanitizer|hair (dye|colou?r|spray|gel|mask)|face mask|exfoliant|cleanser|toner)\b/i.test(title) || COSMETIC_WORDS.test(title) },
  { id: 'household', pts: 12, why: 'Cleaning or household chemical product',
    test: (doc, text, title) => /\b(laundry detergent|dish(washer)? (soap|detergent)|all[- ]purpose cleaner|disinfectant|bleach|fabric softener|air freshener|toilet|drain cleaner|degreaser|glass cleaner|floor cleaner|insect(icide)? (spray|killer)|pesticide|motor oil|antifreeze)\b/i.test(title) || HOUSEHOLD_WORDS.test(title) },
  { id: 'medicine', pts: 12, why: 'Over-the-counter medicine',
    test: (doc, text, title) => /\b(pain reliever|cough (syrup|drops)|cold (and|&) flu|ibuprofen|acetaminophen|antacid|laxative|nasal spray|eye drops|first aid kit)\b/i.test(title) },
  { id: 'essentialOil', pts: 12, why: 'Essential oil or fragrance oil — not a food',
    test: (doc, text, title) => /\b(essential oil|fragrance oil|diffuser oil)\b/i.test(title) },
  { id: 'petFood', pts: 10, why: 'Pet food — scored by rules written for human diets',
    test: (doc, text, title) => /\b(dog|cat|puppy|kitten|pet|canine|feline|bird|reptile|ferret|hamster) (food|treats?|chews?|kibble|formula|supplement)\b|\bpet supplies\b/i.test(title + ' ' + text) || PET_WORDS.test(title + ' ' + text) },
  { id: 'furnitureOrSupport', pts: 12, why: 'Furniture or wearable support rather than something you eat',
    test: (doc, text, title) => /\b((?:folding|camping|portable|beach|side|coffee|dining|picnic|end) tables?|(?:knee|ankle|wrist|elbow|back) (?:braces?|sleeves?))\b/i.test(title) },
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

// ---------------------------------------------------------------- personal care and supplements
// Classification is deliberately separate from the food gate: identifying a product does not
// establish that its label is complete or that there are sufficient criteria to rate it.
//
// Only the title is read, because the same function has to work on a search tile that has nothing
// else. Precision is worth more than recall here. A title this misses falls back to the old
// behaviour (skipped as merchandise); a title it wrongly claims puts a human-care index on a bottle
// of dog shampoo. Measured on 87 real listing titles, the first version missed 21 ("Tooth Paste",
// "Moisturizing Lotion", "Vitamin C Gummies") and claimed 6 it should not have (dog shampoo,
// car-wash shampoo, shoe deodorant).
const PRODUCT_CATEGORIES = [
  ['toothpaste', /\b(?:tooth[- ]?paste|tooth[- ]?gel|tooth[- ]?powder|dentifrice)\b/i],
  ['mouthwash', /\b(?:mouth[- ]?wash|mouth[- ]?rinse|oral rinse|(?:fluoride|anti-?cavity|breath) rinse)\b/i],
  ['deodorant', /\b(?:deodorants?|anti-?perspirants?)\b/i],
  ['shampoo', /\bshampoo\b/i],
  ['conditioner', /\bconditioner\b/i],
  ['body-wash', /\b(?:body[- ]?wash|shower (?:gel|wash|cream)|hand[- ]?wash|beauty bar|soap bar|(?:body|bar|hand|bath|castile|liquid|foaming) soap)\b/i],
  // A moisturizer is named by its product word or by "<where it goes> + lotion/cream". A bare
  // "cream" is never enough: it is also whipped cream, ice cream and cream cheese.
  ['moisturizer', /\b(?:moisturi[sz]er|moisturi[sz]ing (?:lotion|cream|creme|gel)|hydrating (?:lotion|cream|creme)|healing cream|(?:body|hand|foot|face|facial|baby|skin|daily|dry skin|all[- ]over|everyday) (?:moisture |hydrating |moisturi[sz]ing )?(?:lotion|cream|creme|butter))\b/i],
];

// Things that carry a personal-care word and are not for people. "Dog Shampoo" and "Car Wash Shampoo"
// publish ingredient lists too, and a hair-care index on them is a wrong answer, not a missing one.
const NOT_FOR_PEOPLE = new RegExp('\\b(?:dogs?|puppy|puppies|pets?|canine|kittens?|feline|equine|horses?|livestock|aquarium'  // "Pond's" is a moisturizer brand, so a pond is not excluded
  + '|cats?(?!\\W?s claw)|car|auto(?:motive)?|vehicle|truck|boat|carpet|rug|upholstery|floors?|dish(?:es|washing|washer)?'
  + '|laundry|fabric|textiles?|shoes?|sneakers?|footwear|insoles?|fridge|refrigerator|litter|(?:fabric|water|air|leather|dough|soil) conditioner)\\b', 'i');

// Products that name a category and are something else. Sun care and treatment cosmetics have
// their own rules, so they are "unsupported", which shows a clear notice. Medicated creams are
// medicine: they stay "unknown" so the food gate's own reason ("over-the-counter medicine") shows.
const UNSUPPORTED_ANYWHERE = /\b(?:sunscreen|sunblock|spf\s*\d+|after[- ]?sun|self[- ]?tann(?:er|ing)|tanning|dry shampoo|hair (?:dye|colou?r)|serum|retinol|anti-?aging|wrinkle)\b/i;
const MEDICATED = /\b(?:hydrocortisone|anti-?itch|diaper rash|antifungal|athlete'?s foot|medicated|acne|eczema|psoriasis|first aid|ointment|insect repellent|drug facts)\b/i;
const UNSUPPORTED_ALONE = /\b(?:makeup|make-?up|mascara|lipstick|lip (?:balm|gloss|care)|chapstick|foundation|concealer|blush|eyeliner|eye ?shadow|nail polish|perfume|cologne|fragrance|face (?:wash|scrub|mask)|facial (?:cleanser|wash)|cleanser|toner|skin ?care|hair (?:spray|gel|wax|styling))\b/i;
const COMBINED = /\b(?:[2-5][- ]?in[- ]?[1-5]|two[- ]in[- ]one|all[- ]in[- ]one)\b/i;
// Accessories and bundles cannot be represented by one product's ingredient label.
const ACCESSORY = /\b(?:toothbrush(?:es)?|dispenser|empty bottle|replacement heads?|gift sets?|variety pack|bundle|kit|sampler|duo|trio|combo)\b/i;

// A supplement is a nutrient or botanical in a dosage form. Either half alone is not enough: a
// "ginger chew" is candy and "vitamin D milk" is milk. The nutrient list is the strict one, so
// foods that merely borrow a word ("vitamin water", "calcium fortified") never reach it.
// A dose in the title ("Biotin 10000 mcg") is as good a sign of a supplement as a dosage form.
const SUPPLEMENT_FORM = /\b(?:capsules?|vcaps|softgels?|soft gels?|gel caps?|tablets?|caplets?|gummy|gummies|chewables?|lozenges?|sublingual|tincture|drops|stick packs?|effervescent)\b|\b\d[\d,.]*\s?(?:mcg|µg|iu|mg)\b/i;
// "Turmeric powder" and "spirulina powder" are spices and greens. A powder is a supplement only when
// it is one of the sports amino acids that are sold as nothing else.
const SPORTS_POWDER = /\b(?:creatine|glutamine|citrulline|l-?arginine|taurine|beta-?alanine|bcaas?)\b/i;
const SUPPLEMENT_ACTIVE = new RegExp('\\b(?:vitamins?\\s+[a-ek]\\d*|b[- ]?(?:complex|1|2|3|5|6|7|9|12)|multi-?vitamins?|prenatal|folate|folic acid|biotin|niacin(?:amide)?|choline|inositol'
  + '|calcium|magnesium|zinc|iron|potassium|selenium|iodine|copper|manganese|chromium|boron|molybdenum'
  + '|omega[- ]?3|fish oil|krill oil|cod liver oil|flax(?:seed)? oil|dha|epa|probiotics?|digestive enzymes?'
  + '|creatine|l-?theanine|taurine|glutamine|l-?arginine|citrulline|carnitine|5-?htp|melatonin|coq-?10|ubiquinol|nac|n-acetyl|alpha[- ]lipoic'
  + '|sam-?e|glucosamine|chondroitin|msm|lutein|zeaxanthin|resveratrol|quercetin|curcumin|turmeric|ashwagandha|ginseng|ginkgo|echinacea'
  + '|elderberry|milk thistle|saw palmetto|valerian|st\\.? john\'?s wort|berberine|black cohosh|moringa|spirulina|chlorella|lion\'?s mane|reishi|cordyceps'
  + '|astaxanthin|lycopene|beta[- ]carotene|bromelain|boswellia|bacopa|rhodiola|d-mannose|nmn|pqq)\\b', 'i');
// Something sold to be eaten as food, or a medicine, is not rated as a supplement on a keyword alone.
const NOT_A_SUPPLEMENT = /\b(?:candy|candies|chocolate|snacks?|fruit snacks?|bars?|tea|coffee|drink|juice|soda|water|cereal|bread|cookies?|crackers?|jerky|sauce|syrup|honey|yogh?urt|cheese|milk|soup|antacid|pain relie(?:f|ver)|cough|cold (?:and|&) flu|allergy relief|laxative)\b/i;

function classifyProduct(title, { supplementFacts = false } = {}) {
  const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (NOT_FOR_PEOPLE.test(name) || MEDICATED.test(name)) return { category: 'unknown', status: 'unknown' };
  if (UNSUPPORTED_ANYWHERE.test(name)) return { category: 'personal-care', status: 'unsupported' };
  const matches = PRODUCT_CATEGORIES.filter(([, pattern]) => pattern.test(name)).map(([id]) => id);
  if (ACCESSORY.test(name)) return { category: matches.length ? 'personal-care' : 'unknown', status: 'ambiguous' };
  if (matches.length > 1 || (matches.length && COMBINED.test(name))) return { category: 'personal-care', status: 'ambiguous' };
  if (matches.length === 1) return { category: matches[0], status: 'recognized' };
  if (UNSUPPORTED_ALONE.test(name)) return { category: 'personal-care', status: 'unsupported' };
  // A vitamin in a food or cosmetic name is not by itself evidence of a supplement.
  if (supplementFacts || /\b(?:dietary supplement|food supplement|vitamin supplements?|multi-?vitamins?)\b/i.test(name)
    || (!NOT_A_SUPPLEMENT.test(name) && ((SUPPLEMENT_FORM.test(name) && SUPPLEMENT_ACTIVE.test(name))
      || (SPORTS_POWDER.test(name) && /\bpowder\b/i.test(name)))))
    return { category: 'supplement', status: 'recognized' };
  return { category: 'unknown', status: 'unknown' };
}

// Supported categories use their own index even when the merchandise filter is enabled.
function allowsProduct(title, prefs = {}) {
  return prefs.personalCareEnabled !== false && classifyProduct(title).status === 'recognized';
}
function allowsSearch(context, titles = [], prefs = {}) {
  if (prefs.personalCareEnabled === false) return false;
  if (allowsProduct(context.query, prefs)) return true;
  if (/beauty|personal care|oral care|hair care|skin care/i.test(context.label || '')) return true;
  return titles.length > 0 && titles.filter(t => allowsProduct(t, prefs)).length / titles.length >= 0.7;
}

// ---------------------------------------------------------------- reading a personal-care label
// The shared food parser reads a list of comma-separated names. Two conventions of these labels
// break that, and a broken read here is silent: the ingredient is not charged, so the product looks
// cleaner than it is.
//
//  1. US over-the-counter products (fluoride toothpaste, antiperspirant, anti-dandruff shampoo,
//     anticavity rinse) print a Drug Facts block: "Active ingredient: X 0.24% Purpose: Y. Inactive
//     ingredients: A, B, C". Read as food, the active ingredient came back glued to the heading
//     ("active ingredient: sodium fluoride 0.24% purpose: anticavity") or, on the antiperspirant
//     sampled, was dropped altogether, so its aluminum salt was never found.
//  2. INCI lists join and translate names in ways a food list never does: "Sodium Laureth Sulfate
//     (and) Cocamidopropyl Betaine", "Water (Aqua)", "Aqua/Water/Eau".
//
// This rewrites both into the plain list the parser already handles. It is applied only to these
// categories, so no food reads differently.
const STRENGTH = /\s*\d+(?:[.,]\d+)?\s*(?:%|(?:mg|mcg|g|ml)\b)(?:\s*(?:w\/[vw]|v\/v)\b)?|\s*\((?:[^()]*\bw\/[vw]\b[^()]*|[^()]*\bfluoride ion\b[^()]*)\)/gi;
// A purpose printed beside its active ingredient in the Drug Facts table ("... 0.24% Anticavity").
const PURPOSE = /\b(?:anti-?(?:cavity|perspirant|plaque|gingivitis|dandruff|septic)|antiseptic|cavity protection)\b/gi;
// The active ingredient printed after its own name instead of under a heading: "Aluminum Zirconium
// Tetrachlorohydrex GLY (20%) (Active Ingredient), Cyclopentasiloxane, Stearyl Alcohol". The heading search
// below found the marker, took everything after it as "the actives" and dropped the salt in front of it, so
// the antiperspirant read as having no active ingredient at all and was declined.
const ACTIVE_MARK = /\(\s*active(?:\s+ingredients?)?\s*\)/i;
const TOP_LEVEL_COMMA = /\s*,\s*(?![^()]*\))/;
// "Active ingredient:" and the short "Active:" a seller types; the long form needs no colon (a Drug Facts
// table flattened to text has none), the short form does, because "active" is also a word in a name.
const ACTIVE_HEADING = /\bactive(?:\s+ingredients?\b\s*(?:\([^)]*\))?\s*[:\-–]?|\s*[:\-–])\s*/i;
const INACTIVE_HEADING = /\b(?:inactive|other)\s+ingredients?\b\s*[:\-–]?\s*|\binactive\s*[:\-–]\s*/i;
function markedActives(raw) {
  if (!ACTIVE_MARK.test(raw)) return null;
  const parts = raw.split(TOP_LEVEL_COMMA).map(part => part.trim()).filter(Boolean);
  const marked = parts.filter(part => ACTIVE_MARK.test(part));
  const actives = marked.map(part => part.replace(ACTIVE_MARK, ' ').replace(STRENGTH, ' ').replace(/[.:()]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(name => /[a-z]{3}/i.test(name));
  const rest = parts.filter(part => !ACTIVE_MARK.test(part));
  return { actives, rest };
}
function prepareLabel(text) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 12000);
  let actives = [];
  let partial = false;
  const marked = markedActives(raw);
  const heading = marked && marked.actives.length ? null : ACTIVE_HEADING.exec(raw);
  if (marked && marked.actives.length) {
    // The unmarked names are the inactive list; nothing but the marked ones means the page printed nothing else.
    actives = marked.actives;
    partial = !marked.rest.length;
    raw = [...marked.actives, ...marked.rest].join(', ');
  } else if (heading) {
    const rest = raw.slice(heading.index + heading[0].length);
    const split = INACTIVE_HEADING.exec(rest);
    // The printed table puts "Active ingredient" and "Purpose" in one header row and the values below, so flattened
    // text can start with the word "Purpose" and carry its Uses, Warnings and Directions with no colons.
    const activePart = (split ? rest.slice(0, split.index) : rest).replace(/^\s*purposes?\b\s*/i, '')
      .split(/\bpurposes?\b|\buses?\b|\bwarnings?\b|\bdirections?\b|\bkeep out\b/i)[0];
    actives = activePart.replace(STRENGTH, ' ').replace(PURPOSE, ' ').split(/\s*(?:,|;|\band\b|&)\s*/i)
      .map(s => s.replace(/[.:()]/g, ' ').replace(/\s+/g, ' ').trim()).filter(s => /[a-z]{3}/i.test(s));
    // The label names an active ingredient but not what else is in the product.
    partial = !split;
    raw = [...actives, split ? rest.slice(split.index + split[0].length) : ''].filter(Boolean).join(', ');
  }
  raw = raw
    // A heading left in the text would be glued to the first name after it; so would a trailing
    // "Questions? Call ..." or "Distributed by ..." line.
    .split(/\b(?:questions\?|comments\?|distributed by|manufactured (?:by|for)|dist\. by)/i)[0]
    .replace(/\b(?:inactive|other)\s+ingredients?\s*[:\-–]\s*|\binactive\s*[:\-–]\s*/gi, ', ')
    .replace(/^[\s,]+/, '').replace(/,(?:\s*,)+/g, ',')
    .replace(/\s*\(\s*and\s*\)\s*/gi, ', ')
    .replace(/\s*\(\s*(?:aqua|water|eau|agua)\s*\)/gi, '')
    .replace(/\b(?:aqua|eau|agua)\s*\/\s*water(?:\s*\/\s*(?:aqua|eau|agua))?|\bwater\s*\/\s*(?:aqua|eau|agua)(?:\s*\/\s*(?:aqua|eau|agua))?/gi, 'water');
  return { text: raw, actives, partial };
}

function personalCareReview(title, text, prefs = {}, advisory = '', supplementFacts = '') {
  const classification = classifyProduct(title, { supplementFacts: /\bsupplement facts\b/i.test(String(supplementFacts || '')) });
  if (classification.status !== 'recognized') return null;
  const raw = String(text || '').trim().slice(0, 12000);
  if (!raw || !/[a-z]{3}/i.test(raw)) return null;
  const entries = prepareLabel(raw).text.split(/[,;\n]+/).map(x => x.trim().toLowerCase())
    .filter(x => x && !/^(?:free (?:of|from)|without|no\s|contains no\s)/i.test(x) && !/\b(?:free|free from)\s*$/i.test(x));
  if (!entries.length) return null;
  const allergens = AIR.db && AIR.db.allergens;
  const flags = allergens ? [
    ...allergens.detect([...entries, String(advisory || '').toLowerCase()], prefs.allergens || [], prefs.diets || []),
    ...allergens.matchAvoidList(entries, prefs.avoidList || []),
  ] : [];
  const notes = [];
  const sources = [];
  const listed = entries.join(', ');
  if (classification.category === 'toothpaste' && /\b(?:sodium fluoride|stannous fluoride|sodium monofluorophosphate)\b/i.test(listed))
    notes.push('A fluoride ingredient is listed. The label alone may not show its concentration or establish effectiveness.');
  if (classification.category === 'deodorant' && /\balumini?um\s+(?:chlorohydrate|chloride|zirconium)\b/i.test(listed))
    notes.push('An aluminum ingredient commonly used in antiperspirants is listed.');
  if (/\b(?:fragrance|parfum|perfume)\b/i.test(listed))
    notes.push('Fragrance is listed; the individual components may not be disclosed.');
  if (classification.category === 'moisturizer' && /\b(?:glycerin|glycerol|petrolatum|ceramide|hyaluronic acid|sodium hyaluronate)\b/i.test(listed)) {
    notes.push('A commonly used moisturizing ingredient is listed. The formulation and concentration still matter.');
    sources.push({ label: 'AAD: choosing a moisturizer', url: 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/pick-moisturizer' });
  }
  if (classification.category === 'toothpaste') sources.push({ label: 'ADA: toothpastes', url: 'https://www.ada.org/resources/ada-library/oral-health-topics/toothpastes' });
  if (classification.category === 'mouthwash') sources.push({ label: 'ADA: mouthrinse', url: 'https://www.ada.org/resources/ada-library/oral-health-topics/mouthrinse-mouthwash' });
  if (classification.category === 'supplement') sources.push({ label: 'NIH: supplement labels', url: 'https://ods.od.nih.gov/factsheets/WYNTK-Consumer/' });
  else sources.push({ label: 'FDA: cosmetic allergens and labels', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/allergens-cosmetics' });
  return { category: classification.category, flags, notes, sources, ingredients: raw,
    supplementFacts: classification.category === 'supplement' ? String(supplementFacts || '').slice(0, 4000) : '' };
}

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
    productCategory: classifyProduct(title, { supplementFacts: positives.some(p => p.id === 'supplementPanel') }),
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
const FOOD_ALIASES = /^(grocery|same-day-grocery|amazonfresh|fresh|wholefoods|gourmet-food|natural-foods|specialty-foods|beverages|nutrition)$/i;
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
  assess, assessTitle, looksNonFoodFromTitle, isOpenFoodFactsFood, classifyProduct, personalCareReview, prepareLabel, allowsProduct, allowsSearch,
  assessSearch, looksNonFoodFromResults,
  STRONG_POSITIVE, WEAK_POSITIVE, HARD_NEGATIVE, THRESHOLD,
  FOOD_ALIASES, NONFOOD_ALIASES, RESULT_SAMPLE_MIN, RESULT_NONFOOD_SHARE,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
