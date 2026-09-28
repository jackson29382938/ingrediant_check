// Category taxonomy.
//
// Every rule in the database belongs to exactly one category here, and every category carries a
// user-adjustable weight. Weight 1.0 reproduces the built-in defaults; 0 switches the category off
// entirely; 2.0 doubles how much it matters.
//
// The point of this file is that the tool holds no opinions the user cannot change. Anything
// debatable — whether saturated fat should count against a food, whether stevia is a problem, how
// much a certification is worth — is a dial with a neutral label and a stated default, not a
// judgement baked into the engine.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./db/_module.js');

(function () {

// kind: 'penalty' scales point deductions
//       'cap'     scales hard ceilings (0 = no ceiling, 1 = default, 2 = twice as severe)
//       'bonus'   scales point additions
//       'base'    scales the processing-level starting score
//       'flag'    no score effect; surfaces a warning in the panel
const CATEGORIES = [
  // ---------------------------------------------------------------- processing
  { id: 'processing', group: 'Processing level', kind: 'base', def: 1,
    label: 'Degree of processing',
    help: 'How industrially processed the product is, on the NOVA 1–4 scale. This sets the starting score before individual ingredients are considered. Usually the single strongest signal.' },

  // ---------------------------------------------------------------- additives
  { id: 'colour', group: 'Additives', kind: 'cap', def: 1,
    label: 'Artificial colours',
    help: 'Synthetic dyes such as Red 40, Yellow 5, and titanium dioxide. Sets a hard ceiling on the score.' },
  { id: 'artificialSweetener', group: 'Additives', kind: 'cap', def: 1,
    label: 'Artificial sweeteners',
    help: 'Sucralose, aspartame, acesulfame potassium, saccharin. Sets a hard ceiling on the score.' },
  { id: 'sweetener', group: 'Additives', kind: 'penalty', def: 1, signed: true,
    label: 'Sugar alcohols & novel sweeteners',
    help: 'Erythritol, xylitol, maltitol, allulose, stevia extract, monk fruit. Lower this if you use these deliberately. Below 0 it counts in favour of the product — a goal can set that.' },
  { id: 'preservative', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Preservatives',
    help: 'Sodium benzoate, potassium sorbate, nitrites, sulfites, EDTA and similar.' },
  { id: 'strongPreservative', group: 'Additives', kind: 'cap', def: 1,
    label: 'BHA / BHT / TBHQ',
    help: 'Synthetic antioxidant preservatives that set a hard ceiling rather than a point penalty.' },
  { id: 'flavour', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Artificial & unspecified flavourings',
    help: 'Artificial flavours, bare "flavouring", and flavour enhancers such as vanillin and maltol.' },
  { id: 'naturalFlavour', group: 'Additives', kind: 'penalty', def: 1, signed: true,
    label: '"Natural flavors"',
    help: 'An undisclosed proprietary blend. Separate from artificial flavours so a goal that does not care about it (weight loss) can nearly switch it off. Below 0 it counts in favour of the product — a goal can set that.' },
  { id: 'glutamate', group: 'Additives', kind: 'penalty', def: 1,
    label: 'MSG & free glutamates',
    help: 'Monosodium glutamate, yeast extract, hydrolysed protein, disodium inosinate.' },
  { id: 'texture', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Emulsifiers, gums & thickeners',
    help: 'Xanthan and guar gum, mono- and diglycerides, polysorbates, methylcellulose, modified starch, maltodextrin.' },
  { id: 'carrageenan', group: 'Additives', kind: 'cap', def: 1,
    label: 'Carrageenan',
    help: 'Treated separately from other thickeners because of its association with gut inflammation. Sets a ceiling.' },
  { id: 'processingAid', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Processing aids & acidity regulators',
    help: 'Phosphates, industrial acids, anti-caking agents, dough conditioners, aluminium compounds.' },

  // ---------------------------------------------------------------- fats & oils
  { id: 'refinedOil', group: 'Fats & oils', kind: 'cap', def: 1,
    label: 'Refined seed & vegetable oils',
    help: 'Canola, soybean, sunflower, safflower, corn, cottonseed, and unspecified "vegetable oil". Sets a hard ceiling by default; lower the weight if you do not want these treated as disqualifying.' },
  { id: 'transFat', group: 'Fats & oils', kind: 'cap', def: 1,
    label: 'Partially hydrogenated oil (trans fat)',
    help: 'Industrial trans fat. The most severe ceiling in the system.' },
  { id: 'saturatedFat', group: 'Fats & oils', kind: 'penalty', def: 0,
    label: 'Saturated fat',
    help: 'OFF by default. Conventional nutrition guidance penalises saturated fat; other frameworks do not. Raise this if you want butter, cream, coconut oil and fatty meat to lower a score. Requires nutrition data on the page.' },

  // ---------------------------------------------------------------- sugars
  { id: 'sugar', group: 'Sugars', kind: 'penalty', def: 1,
    label: 'Added & refined sugars',
    help: 'Cane sugar, dextrose, glucose syrup, agave, fruit juice concentrate. Sugar occurring naturally in whole fruit or dairy is never counted here.' },
  { id: 'traditionalSweetener', group: 'Sugars', kind: 'penalty', def: 1, signed: true,
    label: 'Honey, maple & traditional sweeteners',
    help: 'Honey, maple syrup, molasses, coconut and date sugar, fruit juice concentrate. A light touch by default. Below 0 it counts in favour of the product — a goal can set that.' },
  { id: 'industrialSyrup', group: 'Sugars', kind: 'cap', def: 1,
    label: 'High-fructose corn syrup',
    help: 'HFCS and glucose-fructose syrup. Sets a ceiling rather than a point penalty.' },
  { id: 'naturalSugar', group: 'Sugars', kind: 'penalty', def: 0,
    label: 'Naturally occurring sugars',
    help: 'OFF by default. Sugar from whole fruit, dates, and dairy lactose. Raise this if you want total sugar counted regardless of source.' },
  { id: 'totalSugar', group: 'Sugars', kind: 'penalty', def: 0,
    label: 'Total sugar per serving',
    help: 'OFF by default. Scores grams of sugar from the nutrition panel, independent of ingredient source. Requires nutrition data on the page.' },

  // ---------------------------------------------------------------- grains & proteins
  { id: 'grain', group: 'Grains & proteins', kind: 'penalty', def: 1,
    label: 'Refined grains & gluten',
    help: 'Default 1.0: gluten grains are a penalty, including whole wheat. Enriched and white flour cost more; wheat, barley and rye still count when they are whole grain, because this dial is gluten as much as refinement. Traditionally prepared grains (sourdough, sprouted, soaked) count half. Lower this weight if you do not want gluten grains counted against a score. NOVA still treats plain flour as processed (3) and enriched as ultra (4) — that mapping is not this dial.' },
  { id: 'isolate', group: 'Grains & proteins', kind: 'penalty', def: 1, signed: true,
    label: 'Isolated & industrial proteins',
    help: 'Soy protein isolate, pea protein, whey and milk protein isolate, textured vegetable protein, caseinate. Below 0 it counts in favour of the product — a goal can set that.' },
  { id: 'plantDefense', group: 'Grains & proteins', kind: 'penalty', def: 0,
    label: 'Nuts, seeds & legumes',
    help: 'OFF by default. Beans, lentils, peas, peanuts, soy, tree nuts and seeds. Only the animal-based goal turns this on.' },

  // ---------------------------------------------------------------- fortification & dairy
  { id: 'fortification', group: 'Fortification & dairy', kind: 'penalty', def: 1, signed: true,
    label: 'Added vitamins & minerals',
    help: 'Added folic acid, reduced iron, thiamin mononitrate, vitamin D and similar. Lower this if you consider fortification neutral; the vitamins goal makes it a plus. Below 0 it counts in favour of the product — a goal can set that.' },
  { id: 'dairyProcessing', group: 'Fortification & dairy', kind: 'penalty', def: 1,
    label: 'Dairy processing',
    help: 'Ultra-pasteurised and homogenised dairy. Also scales the raw-milk bonus.' },
  { id: 'reducedFatDairy', group: 'Fortification & dairy', kind: 'penalty', def: 1, signed: true,
    label: 'Fat-reduced dairy',
    help: 'Skim, low-fat, reduced-fat and nonfat milk, yogurt, cheese and kefir. A processing penalty by default; weight-loss goals make it a plus. Below 0 it counts in favour of the product — a goal can set that.' },

  // ---------------------------------------------------------------- nutrition panel
  { id: 'sodium', group: 'Nutrition panel', kind: 'penalty', def: 0,
    label: 'Sodium per serving',
    help: 'OFF by default. Scores milligrams of sodium against per-serving thresholds. Requires nutrition data on the page.' },
  { id: 'fibre', group: 'Nutrition panel', kind: 'bonus', def: 0,
    label: 'Dietary fibre',
    help: 'OFF by default. Awards points for fibre per serving. Requires nutrition data on the page.' },
  { id: 'protein', group: 'Nutrition panel', kind: 'bonus', def: 0,
    label: 'Protein',
    help: 'OFF by default. Awards points for protein per serving. Requires nutrition data on the page.' },

  // ---------------------------------------------------------------- sourcing
  { id: 'organic', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Organic claim',
    help: 'Organic claims earn credit. Claims found only in the seller-written title or bullets count at half weight and are labelled unverified; this score does not verify certification.' },
  { id: 'animalWelfare', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Pasture-raised, grass-fed & wild-caught',
    help: 'Sourcing claims about how an animal was raised or caught.' },
  { id: 'fermented', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Fermented & live cultures',
    help: 'Cultured dairy, kefir, kimchi, sauerkraut, sourdough. Preservative systems that merely use the word "cultured" are excluded.' },
  { id: 'unrefined', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Minimally refined ingredients',
    help: 'Butter, ghee, tallow, olive, coconut and avocado oil, cold-pressed oils, and unrefined salt.' },
  { id: 'nonGmo', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Non-GMO',
    help: 'Non-GMO Project verification and equivalent claims.' },
  { id: 'traditionalPrep', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Traditional preparation',
    help: 'Sourdough, sprouted, soaked, dry-aged, and long-fermented preparation.' },
  { id: 'simplicity', group: 'Sourcing & certification', kind: 'bonus', def: 1,
    label: 'Short ingredient list',
    help: 'Rewards single-ingredient and few-ingredient foods.' },

  // ---------------------------------------------------------------- provenance
  { id: 'provenanceVerified', group: 'Provenance (whole foods)', kind: 'bonus', def: 1,
    label: 'Third-party certifications',
    help: 'Independently audited standards — American Grassfed, Animal Welfare Approved, USDA Organic, Global Animal Partnership steps, MSC. For a single-ingredient food like ground beef this is where nearly all the real variation lives.' },
  { id: 'provenanceClaimed', group: 'Provenance (whole foods)', kind: 'bonus', def: 1,
    label: 'Uncertified sourcing claims',
    help: 'Label claims with no audit behind them — "grass-fed", "pasture-raised", "no antibiotics". Worth roughly half a verified certification. Lower this to zero if you only want to credit audited claims.' },
  { id: 'provenanceUnknown', group: 'Provenance (whole foods)', kind: 'penalty', def: 1,
    label: 'No sourcing information',
    help: 'Applies only to whole animal foods that make no sourcing claim at all. Commodity meat with a silent label is conventionally raised by default, so silence is treated as information rather than as a free pass. Set to 0 to score unlabelled meat purely on its ingredients.' },
  { id: 'hollowClaims', group: 'Provenance (whole foods)', kind: 'flag', def: 1,
    label: 'Flag meaningless claims',
    help: 'Surfaces claims that sound like quality signals but are not — "USDA Inspected" (mandatory for all meat), "no hormones added" on pork and poultry (already illegal), "natural", "farm-raised". Never scored, only flagged.' },

  // ---------------------------------------------------------------- flags
  { id: 'allergens', group: 'Flags', kind: 'flag', def: 1,
    label: 'Allergen warnings',
    help: 'Flags the allergens you select in the panel. Does not change the score.' },
  { id: 'avoidList', group: 'Flags', kind: 'flag', def: 1,
    label: 'Personal avoid list',
    help: 'Flags any ingredient you have added to your own avoid list. Does not change the score.' },
];

// Named starting points. Each preset is a set of weight overrides against DEFAULT_WEIGHTS.
// This app scores ingredient quality (not calorie targets), so “bulking”, “cutting”, and
// training presets remap the existing dials — protein/fibre bonuses, sugar/grain penalties,
// isolate tolerance, processing — to match the goal. Add presets here; Settings and the popup
// read PRESET_CATEGORIES + PRESETS and need no UI rewrite for new entries.

const PRESET_CATEGORIES = [
  { id: 'everyday', label: 'Everyday',
    blurb: 'General philosophies for how strictly to judge ingredients.' },
  { id: 'goals', label: 'Body goals',
    blurb: 'Composition aims — building, cutting, or holding steady.' },
  { id: 'training', label: 'Training',
    blurb: 'Tuned for how hard you train and what fuel that implies.' },
  { id: 'style', label: 'Diet style',
    blurb: 'Macro and ingredient-style leanings (protein, carbs, sugar).' },
];

// Named goals. Each is a set of weight overrides against the defaults; several can be selected at
// once (goalWeights averages them). A weight below 0 on a signed category turns that rule into a
// plus — which is how Weight loss rewards fat-reduced dairy and Vitamins & minerals rewards added
// vitamin D. Caps never flip: Red 40 is not a plus under any goal.
const PRESETS = {
  // ----- Everyday -----------------------------------------------------------
  balanced: {
    label: 'Balanced', category: 'everyday', glyph: 'Bal',
    note: 'The defaults: processing and additives matter most; fat and total sugar stay off unless you turn them on. Rewards sourcing and short lists.',
    versus: 'The neutral baseline. Choosing nothing is the same as choosing this.',
    weights: {},
  },

  generalWellbeing: {
    label: 'General wellbeing', category: 'everyday', glyph: 'WB',
    note: 'Long-run health over any single number: harder on ultra-processing, artificial sweeteners and colours, seed oils and added sugar; rewards fermented foods, fibre and short lists.',
    versus: 'Stricter than Balanced across the board. Paired with Weight loss it pulls artificial sweeteners back down.',
    weights: {
      // Cap dials stay close to 1: a cap weight scales the ceiling from 100, so 1.6 on colours
      // put caramel colour's ceiling below the score floor.
      processing: 1.4, artificialSweetener: 1.1, colour: 1.15, preservative: 1.4, strongPreservative: 1.2,
      flavour: 1.3, naturalFlavour: 1.2, glutamate: 1.3, texture: 1.3, carrageenan: 1.2,
      refinedOil: 1.15, transFat: 1.3, sugar: 1.3, industrialSyrup: 1.2, sweetener: 1.2,
      fermented: 1.5, fibre: 1.2, simplicity: 1.3, unrefined: 1.3,
    },
  },

  conventional: {
    label: 'Conventional nutrition', category: 'everyday', glyph: 'CNV',
    note: 'Mainstream dietary guidance: counts saturated fat, sodium and total sugar; rewards fibre, low-fat dairy and fortification; treats vegetable oils and whole grains as fine.',
    versus: 'The only everyday goal where low-fat dairy and added vitamins are pluses. Unlike Weight loss, it is not aggressively anti-sugar.',
    weights: {
      saturatedFat: 1.2, sodium: 1.2, totalSugar: 1.2, naturalSugar: 0.5, fibre: 1.4, protein: 0.6,
      fortification: -0.5, reducedFatDairy: -1, refinedOil: 0.2, dairyProcessing: 0.2,
      grain: 0.4, naturalFlavour: 0.6, animalWelfare: 0.5,
    },
  },

  additive: {
    label: 'Additive-averse', category: 'everyday', glyph: 'Add',
    note: 'Everything that was added: colours, sweeteners, preservatives, flavourings (natural ones too), gums and emulsifiers cost much more. Sourcing bonuses shrink so the score is about additives, not farming.',
    versus: 'Harder on additives than any other goal; leaves sugar, grains and macros near default.',
    weights: {
      colour: 1.9, artificialSweetener: 1.9, preservative: 1.9, flavour: 1.9, naturalFlavour: 1.7,
      glutamate: 1.9, texture: 1.7, processingAid: 1.6, strongPreservative: 1.9, carrageenan: 1.9,
      sweetener: 1.5, organic: 0.5, animalWelfare: 0.3, nonGmo: 0.5,
    },
  },

  wholeFood: {
    label: 'Whole-food focused', category: 'everyday', glyph: 'Whl',
    note: 'Short lists and minimal processing above everything: isolates, gums, flavourings and fortification cost more; unrefined fats and traditional preparation earn more.',
    versus: 'About list length and industrial steps — not macros. High protein and Muscle gain are the opposite on isolates.',
    weights: {
      processing: 1.8, simplicity: 2, isolate: 1.8, texture: 1.6, flavour: 1.5, naturalFlavour: 1.5,
      fortification: 1.5, grain: 1.1, reducedFatDairy: 1.3, dairyProcessing: 1.3, unrefined: 1.5,
      traditionalPrep: 1.5,
    },
  },

  // ----- Body goals ---------------------------------------------------------
  weightLoss: {
    label: 'Weight loss / cutting', category: 'goals', glyph: 'WL',
    note: 'Calories and fullness first: fat-reduced dairy is a big plus, zero-calorie sweeteners and protein isolates a small one, "natural flavors" hardly count. Added and total sugar, honey and syrups cost much more; fibre and protein are rewarded.',
    versus: 'The only goal where fat-reduced dairy is a big plus and artificial sweeteners are lifted (not freed — a diet drink still cannot score top marks). Add General wellbeing to pull those sweeteners back down.',
    weights: {
      reducedFatDairy: -2, sweetener: -0.6, isolate: -0.5, naturalFlavour: 0.15, flavour: 0.6,
      artificialSweetener: 0.5, sugar: 1.8, totalSugar: 1.6, naturalSugar: 0.6, traditionalSweetener: 1.6,
      industrialSyrup: 1.8, processing: 1.3, fibre: 1.8, protein: 1.5, sodium: 0.6,
      saturatedFat: 0.6, refinedOil: 1.1, grain: 1.3,
    },
  },

  muscleGain: {
    label: 'Muscle gain / bulking', category: 'goals', glyph: 'MG',
    note: 'Protein is the point: a strong protein bonus, and whey, casein and pea protein count in a product\'s favour. Carbs, honey and grains are lenient; processing stays honest.',
    versus: 'Rewards isolates where Whole-food punishes them. High protein goes further on protein alone; Weight loss is the calorie-restricted opposite.',
    weights: {
      protein: 2, isolate: -0.8, fibre: 0.6, fortification: 0.3, sugar: 0.8, totalSugar: 0.3,
      traditionalSweetener: 0.6, grain: 0.5, processing: 0.9, refinedOil: 0.8, simplicity: 0.6,
      reducedFatDairy: 0.3,
    },
  },

  maintenance: {
    label: 'Maintenance', category: 'goals', glyph: 'Mnt',
    note: 'Steady eating: mild protein and fibre bonuses, light sodium, total-sugar and saturated-fat signals, and a little more weight on processing.',
    versus: 'Gentler than Conventional nutrition; no bulk or cut bias.',
    weights: {
      protein: 1.1, fibre: 1.1, sodium: 0.6, totalSugar: 0.6, sugar: 1.2, saturatedFat: 0.3,
      processing: 1.1,
    },
  },

  recovery: {
    label: 'Recovery / rest day', category: 'goals', glyph: 'Rcv',
    note: 'Gut and repair: fermented foods, traditional preparation and unrefined fats earn much more; seed oils, gums, carrageenan, MSG and preservatives cost more.',
    versus: 'The most gut-focused goal. Not a low-carb preset, and not carb-lenient like Endurance.',
    weights: {
      fermented: 2, traditionalPrep: 1.6, unrefined: 1.5, simplicity: 1.5, processing: 1.3,
      sugar: 1.3, refinedOil: 1.5, texture: 1.4, carrageenan: 1.8, glutamate: 1.3, preservative: 1.3,
      protein: 1.2, fibre: 1.3, fortification: 0.6,
    },
  },

  vitamins: {
    label: 'Vitamins & minerals', category: 'goals', glyph: 'Vit',
    note: 'Added vitamins and minerals — vitamin D, B vitamins, iron, folic acid, calcium — count in a product\'s favour instead of against it.',
    versus: 'The opposite of Whole-food on fortification. Combine it with any other goal.',
    weights: { fortification: -1.5, fibre: 0.8, protein: 0.5 },
    // This goal exists for that dial, so it decides it: averaged with another goal's incidental
    // fortification setting it would shrink to almost nothing.
    focus: ['fortification'],
  },

  // ----- Training -----------------------------------------------------------
  strength: {
    label: 'Strength training', category: 'training', glyph: 'Str',
    note: 'A strong protein bonus with protein powders counted slightly in a product\'s favour; carbs a little lenient; processing near default.',
    versus: 'Between Whole-food (isolates punished) and High protein (isolates rewarded). Less carb-friendly than Endurance.',
    weights: {
      protein: 1.8, isolate: -0.3, fibre: 0.7, fortification: 0.4, sugar: 0.9, totalSugar: 0.4,
      traditionalSweetener: 0.7, grain: 0.7, processing: 1.0,
    },
  },

  endurance: {
    label: 'Running / endurance', category: 'training', glyph: 'End',
    note: 'Fuel availability: added sugar, honey, grains and sodium barely count (sodium replaces sweat losses); HFCS keeps its cap; fibre is eased for training days.',
    versus: 'The most carb-lenient training goal. High-carb goes further still; Low-carb is the opposite.',
    weights: {
      sugar: 0.35, traditionalSweetener: 0.2, grain: 0.25, totalSugar: 0.2, naturalSugar: 0,
      industrialSyrup: 1.0, protein: 1.0, fibre: 0.7, sodium: 0, processing: 0.9, isolate: 0.4,
      fortification: 0.4,
    },
  },

  athlete: {
    label: 'High-activity / athlete', category: 'training', glyph: 'Ath',
    note: 'Fuel and repair: a strong protein signal, protein powders a slight plus, carbs and honey lenient, sodium not counted.',
    versus: 'Between Endurance (more carbs) and Strength (more protein). Sedentary is the opposite lifestyle.',
    weights: {
      protein: 1.6, isolate: -0.2, fibre: 1.0, sugar: 0.55, traditionalSweetener: 0.4, grain: 0.4,
      totalSugar: 0.35, sodium: 0, industrialSyrup: 1.1, processing: 1.0, fortification: 0.3,
    },
  },

  sedentary: {
    label: 'Sedentary / low-activity', category: 'training', glyph: 'Sed',
    note: 'Low energy demand: much stricter on sugar of every kind, processing, refined grains and oils; counts sodium and saturated fat; rewards fibre.',
    versus: 'The closest training cousin to Weight loss, but not calorie-driven: fat-reduced dairy is not a plus here.',
    weights: {
      sugar: 1.8, totalSugar: 1.6, naturalSugar: 0.5, traditionalSweetener: 1.5, processing: 1.5,
      fibre: 1.5, sodium: 1.2, saturatedFat: 1.0, protein: 1.0, refinedOil: 1.4, industrialSyrup: 1.8,
      simplicity: 1.3, grain: 1.3,
    },
  },

  generalFitness: {
    label: 'General fitness', category: 'training', glyph: 'Fit',
    note: 'Everyday active: protein and fibre bonuses, a little stricter on sugar and processing, light sodium.',
    versus: 'A step from Balanced toward Maintenance; not as macro-specific as Strength or Endurance.',
    weights: {
      protein: 1.1, fibre: 1.1, sugar: 1.2, totalSugar: 0.6, processing: 1.1, sodium: 0.4, isolate: 0.8,
    },
  },

  // ----- Diet style ---------------------------------------------------------
  highProtein: {
    label: 'High protein', category: 'style', glyph: 'Pro',
    note: 'Protein per bite: the maximum protein bonus; protein isolates and lean (fat-reduced) dairy count in a product\'s favour.',
    versus: 'Rewards isolates more than any other goal. Muscle gain is similar but carb-lenient.',
    weights: {
      protein: 2, isolate: -1, reducedFatDairy: -0.8, fibre: 0.5, fortification: 0.3, sugar: 1.0,
      totalSugar: 0.5, processing: 0.9, simplicity: 0.5,
    },
  },

  lowCarb: {
    label: 'Low-carb', category: 'style', glyph: 'LC',
    note: 'Carbohydrate is the enemy: every sugar (fruit, honey and dairy included) and every grain costs a lot; zero-calorie sweeteners are a small plus; full-fat dairy is preferred; saturated fat is not counted.',
    versus: 'The opposite of Endurance and High-carb. Stricter on natural sugar than Sugar-conscious.',
    weights: {
      sugar: 2, totalSugar: 1.8, naturalSugar: 1.5, traditionalSweetener: 1.8, grain: 2, industrialSyrup: 2,
      sweetener: -0.5, artificialSweetener: 0.6, protein: 1.3, fibre: 1.3, refinedOil: 0.4,
      processing: 1.1, reducedFatDairy: 1.3,
    },
  },

  highCarb: {
    label: 'High-carb / performance', category: 'style', glyph: 'HC',
    note: 'Carbohydrate as fuel: sugar, honey and grains barely count; fat-reduced dairy is a small plus (room for carbs); HFCS keeps its cap.',
    versus: 'Further than Endurance; the exact opposite of Low-carb.',
    weights: {
      sugar: 0.25, traditionalSweetener: 0.1, grain: 0.15, totalSugar: 0.1, naturalSugar: 0,
      industrialSyrup: 1.2, protein: 0.8, fibre: 0.8, processing: 0.9, isolate: 0.6,
      saturatedFat: 0.5, reducedFatDairy: -0.5,
    },
  },

  strictSugar: {
    label: 'Sugar-conscious', category: 'style', glyph: 'Sug',
    note: 'Sugar from every source counts double: refined, honey and maple, fruit and dairy, sugar alcohols and artificial sweeteners.',
    versus: 'Only about sugar. Low-carb also counts grains.',
    weights: {
      sugar: 2, totalSugar: 2, naturalSugar: 1.3, traditionalSweetener: 2, sweetener: 1.6,
      artificialSweetener: 1.8, industrialSyrup: 2,
    },
  },

  animalBased: {
    label: 'Animal-based (Paul Saladino)', category: 'style', glyph: 'AB',
    note: 'Meat, organs, animal fats, raw and full-fat dairy, fruit and honey. Seed oils, grains, legumes, nuts and seeds, soy, fat-reduced dairy, protein isolates and processing all cost much more; honey is a plus; fruit sugar and saturated fat are not counted.',
    versus: 'The only goal that counts nuts, seeds and legumes against a product. Vegetables are left neutral.',
    weights: {
      grain: 1.8, plantDefense: 1.6, refinedOil: 1.8, transFat: 2, processing: 1.5, isolate: 1.6,
      texture: 1.4, flavour: 1.3, naturalFlavour: 1.2, fortification: 1.3, reducedFatDairy: 1.6,
      dairyProcessing: 1.6, sugar: 1.4, industrialSyrup: 1.8, sweetener: 1.4, artificialSweetener: 1.6,
      traditionalSweetener: -0.8, naturalSugar: 0, saturatedFat: 0, unrefined: 2, animalWelfare: 1.8,
      simplicity: 1.4, provenanceUnknown: 1.2,
    },
  },
};

const DEFAULT_WEIGHTS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.def]));

// Categories a weight below zero makes a reward: the engine books those rows as pluses (score.js,
// goal rewards). Caps and bonuses are never signed — a hard ceiling cannot be a plus.
const SIGNED = new Set(CATEGORIES.filter(c => c.signed).map(c => c.id));

function resolveWeights(stored) {
  const w = { ...DEFAULT_WEIGHTS };
  if (stored && typeof stored === 'object') {
    for (const [k, v] of Object.entries(stored)) {
      // Clamped to the range the settings slider can actually express. This used to allow 3,
      // so an imported or hand-edited file could set a weight the UI could neither display nor
      // reproduce, and moving any slider afterwards silently discarded it.
      if (k in w && typeof v === 'number' && isFinite(v)) w[k] = Math.max(SIGNED.has(k) ? -2 : 0, Math.min(2, v));
    }
  }
  return w;
}

function presetWeightMap(presetOrId) {
  const preset = typeof presetOrId === 'string' ? PRESETS[presetOrId] : presetOrId;
  if (!preset || typeof preset !== 'object') return { ...DEFAULT_WEIGHTS };
  return resolveWeights({ ...DEFAULT_WEIGHTS, ...(preset.weights || {}) });
}

function weightsMatchPreset(weights, presetOrId, epsilon = 0.001) {
  const target = presetWeightMap(presetOrId);
  const current = resolveWeights(weights);
  return Object.keys(target).every(k => Math.abs((current[k] ?? 0) - target[k]) < epsilon);
}

function matchPreset(weights) {
  for (const [id, preset] of Object.entries(PRESETS)) {
    if (weightsMatchPreset(weights, preset)) return [id, preset];
  }
  return null;
}

// Several goals at once. Each goal votes only on the dials it sets; where goals overlap the votes are
// averaged, and a dial no goal mentions stays at its default. So Weight loss (artificial sweeteners
// 0.5) with General wellbeing (1.1) lands at 0.8: lifted from the default cap, but less than Weight
// loss alone. A dial a goal lists in `focus` is decided by the goals focused on it, not averaged
// away by another goal's incidental setting. No goals, or only Balanced, is the defaults.
function goalWeights(ids) {
  const goals = (Array.isArray(ids) ? ids : []).map(id => PRESETS[id]).filter(Boolean);
  const focused = new Set(goals.flatMap(g => g.focus || []));
  const votes = {};
  for (const g of goals) {
    for (const [k, v] of Object.entries(g.weights || {})) {
      if (focused.has(k) && !(g.focus || []).includes(k)) continue;
      (votes[k] = votes[k] || []).push(v);
    }
  }
  const out = {};
  for (const [k, list] of Object.entries(votes)) out[k] = list.reduce((a, b) => a + b, 0) / list.length;
  return resolveWeights({ ...DEFAULT_WEIGHTS, ...out });
}

function sanitizeGoals(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === 'string' && Object.hasOwn(PRESETS, id)))];
}

function weightsMatchGoals(weights, ids, epsilon = 0.001) {
  const target = goalWeights(ids);
  const current = resolveWeights(weights);
  return Object.keys(target).every(k => Math.abs((current[k] ?? 0) - target[k]) < epsilon);
}

// Which goals describe these weights. The stored list when the weights still match it; otherwise a
// single preset they happen to match (settings from before goals could be combined); otherwise the
// list is kept but marked custom, because a slider has moved.
function describeGoals(weights, goals) {
  const ids = sanitizeGoals(goals);
  if (weightsMatchGoals(weights, ids)) return { ids, custom: false };
  const single = matchPreset(weights);
  if (single) return { ids: single[0] === 'balanced' ? [] : [single[0]], custom: false };
  return { ids, custom: true };
}

// Click a goal: add it or take it off. Balanced clears the selection.
function toggleGoal(goals, id) {
  const ids = sanitizeGoals(goals);
  if (id === 'balanced' || !Object.hasOwn(PRESETS, id)) return [];
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

const goalsLabel = ids => (ids.length ? ids.map(id => PRESETS[id].label).join(' + ') : PRESETS.balanced.label);

function presetsInCategory(categoryId) {
  return Object.entries(PRESETS)
    .filter(([, p]) => p.category === categoryId)
    .map(([id, p]) => [id, p]);
}

function listPresets() {
  return Object.entries(PRESETS).map(([id, p]) => [id, p]);
}

const _exports = AIRmodule('categories', {
  CATEGORIES, PRESETS, PRESET_CATEGORIES, DEFAULT_WEIGHTS, resolveWeights,
  presetWeightMap, weightsMatchPreset, matchPreset, presetsInCategory, listPresets,
  SIGNED, goalWeights, sanitizeGoals, weightsMatchGoals, describeGoals, toggleGoal, goalsLabel,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
