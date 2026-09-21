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
  { id: 'sweetener', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Sugar alcohols & novel sweeteners',
    help: 'Erythritol, xylitol, maltitol, allulose, stevia extract, monk fruit. Lower this if you use these deliberately.' },
  { id: 'preservative', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Preservatives',
    help: 'Sodium benzoate, potassium sorbate, nitrites, sulfites, EDTA and similar.' },
  { id: 'strongPreservative', group: 'Additives', kind: 'cap', def: 1,
    label: 'BHA / BHT / TBHQ',
    help: 'Synthetic antioxidant preservatives that set a hard ceiling rather than a point penalty.' },
  { id: 'flavour', group: 'Additives', kind: 'penalty', def: 1,
    label: 'Flavourings',
    help: '"Natural flavors", artificial flavours, and undisclosed proprietary flavour blends.' },
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
  { id: 'isolate', group: 'Grains & proteins', kind: 'penalty', def: 1,
    label: 'Isolated & industrial proteins',
    help: 'Soy protein isolate, pea protein, textured vegetable protein, hydrolysed protein, caseinate.' },

  // ---------------------------------------------------------------- fortification & dairy
  { id: 'fortification', group: 'Fortification & dairy', kind: 'penalty', def: 1,
    label: 'Synthetic vitamin fortification',
    help: 'Added folic acid, reduced iron, thiamin mononitrate and similar. Lower this if you consider fortification neutral or positive.' },
  { id: 'dairyProcessing', group: 'Fortification & dairy', kind: 'penalty', def: 1,
    label: 'Dairy processing',
    help: 'Ultra-pasteurised, homogenised, and fat-reduced dairy.' },

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
    label: 'Organic certification',
    help: 'Certified organic. Claims found only in the seller-written title or bullets count at half weight and are labelled unverified.' },
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

const PRESETS = {
  // ----- Everyday -----------------------------------------------------------
  balanced: {
    label: 'Balanced', category: 'everyday', glyph: 'Bal',
    note: 'Default starting point: processing and additives matter most; fat and total sugar stay off unless you turn them on. Rewards sourcing and short lists.',
    versus: 'The neutral baseline. Prefer this when you have no stronger goal than “less ultra-processed”.',
    weights: {},
  },

  conventional: {
    label: 'Conventional nutrition', category: 'everyday', glyph: 'CNV',
    note: 'Mainstream guidance: counts saturated fat, sodium and total sugar, rewards fibre (and a little protein), and softens refined-oil / dairy-processing penalties.',
    versus: 'Unlike Balanced, nutrition-panel numbers move the score. Unlike Weight loss, it is not aggressively anti-sugar.',
    weights: {
      saturatedFat: 1, sodium: 1, totalSugar: 1, naturalSugar: 0.5, fibre: 1, protein: 0.5,
      fortification: 0, refinedOil: 0.3, dairyProcessing: 0.3, animalWelfare: 0.5,
    },
  },

  additive: {
    label: 'Additive-averse', category: 'everyday', glyph: 'Add',
    note: 'Emphasises colours, sweeteners, preservatives, flavours and texture agents. Softens organic / welfare / non-GMO bonuses so the score is about what was added, not how it was farmed.',
    versus: 'Stricter on additives than Whole-food; does not push protein, fibre, or sugar dials.',
    weights: {
      colour: 1.5, artificialSweetener: 1.5, preservative: 1.5, flavour: 1.5, glutamate: 1.5,
      texture: 1.3, processingAid: 1.3, strongPreservative: 1.5,
      organic: 0.5, animalWelfare: 0.3, nonGmo: 0.5,
    },
  },

  wholeFood: {
    label: 'Whole-food focused', category: 'everyday', glyph: 'Whl',
    note: 'Rewards short ingredient lists and low processing above everything else. Isolates, gums and fortification cost more.',
    versus: 'About list length and industrial steps — not macros. Strength / High protein are softer on isolates.',
    weights: {
      processing: 1.5, simplicity: 2, isolate: 1.5, texture: 1.3, flavour: 1.3,
      fortification: 1.2, grain: 1.2,
    },
  },

  // ----- Body goals ---------------------------------------------------------
  muscleGain: {
    label: 'Muscle gain / bulking', category: 'goals', glyph: 'MG',
    note: 'Rewards protein strongly and eases the isolate penalty so fortified protein foods and powders are not auto-punished. Keeps sugar and processing honest without a cut-phase clamp.',
    versus: 'Softer on isolates than Strength training; less sugar-focused than Weight loss. High protein is the same idea with an even stronger protein dial.',
    weights: {
      protein: 1.6, fibre: 0.7, isolate: 0.35, fortification: 0.5,
      sugar: 1.0, totalSugar: 0.6, processing: 1.0, refinedOil: 0.85,
      simplicity: 0.8,
    },
  },

  weightLoss: {
    label: 'Weight loss / cutting', category: 'goals', glyph: 'WL',
    note: 'Tightens added sugar, total sugar and processing; rewards fibre and protein for satiety; keeps HFCS and refined oils costly.',
    versus: 'Stricter on sugar than Muscle gain. Sedentary is similar but also turns sodium and saturated fat up for desk-day defaults.',
    weights: {
      sugar: 1.5, totalSugar: 1.3, naturalSugar: 0.4, sweetener: 1.2, artificialSweetener: 1.3,
      industrialSyrup: 1.5, processing: 1.35, fibre: 1.5, protein: 1.25,
      sodium: 0.8, refinedOil: 1.2, simplicity: 1.2,
    },
  },

  maintenance: {
    label: 'Maintenance', category: 'goals', glyph: 'Mnt',
    note: 'Near Balanced, with mild protein and fibre bonuses and a light sodium signal — steady eating without a bulk or cut bias.',
    versus: 'Gentler macro nudges than Conventional nutrition; no saturated-fat penalty.',
    weights: {
      protein: 0.9, fibre: 0.9, sodium: 0.45, totalSugar: 0.4, sugar: 1.1,
    },
  },

  recovery: {
    label: 'Recovery / rest day', category: 'goals', glyph: 'Rcv',
    note: 'Favours fermented foods, simpler lists and unrefined fats; keeps sugar in check without athlete-level carb leniency.',
    versus: 'More anti-inflammatory / restorative than High-activity; not a low-carb preset.',
    weights: {
      fermented: 1.6, traditionalPrep: 1.3, unrefined: 1.3, simplicity: 1.35,
      processing: 1.2, sugar: 1.2, refinedOil: 1.25, protein: 1.0, fibre: 1.1,
      texture: 1.2,
    },
  },

  // ----- Training -----------------------------------------------------------
  strength: {
    label: 'Strength training', category: 'training', glyph: 'Str',
    note: 'Solid protein bonus with a moderated isolate penalty — useful when training food includes powders — while sugar and processing stay near default.',
    versus: 'Isolate tolerance sits between Whole-food (harsh) and High protein / Muscle gain (lenient). Less carb-friendly than Endurance.',
    weights: {
      protein: 1.45, isolate: 0.55, fibre: 0.75, fortification: 0.6,
      sugar: 1.05, totalSugar: 0.5, processing: 1.05,
    },
  },

  endurance: {
    label: 'Running / endurance', category: 'training', glyph: 'End',
    note: 'Higher carbohydrate availability: softens refined-grain and added-sugar penalties, keeps HFCS capped, and still rewards fibre and adequate protein for frequent training.',
    versus: 'More carb-lenient than Strength or Balanced. High-carb / performance goes further; Low-carb is the opposite.',
    weights: {
      sugar: 0.55, grain: 0.45, totalSugar: 0.35, naturalSugar: 0,
      industrialSyrup: 1.1, protein: 0.9, fibre: 1.1, sodium: 0.25,
      processing: 0.95, isolate: 0.7,
    },
  },

  athlete: {
    label: 'High-activity / athlete', category: 'training', glyph: 'Ath',
    note: 'Combines a strong protein signal with moderate carb leniency and a very light sodium penalty — fuel and repair without ignoring ultra-processing.',
    versus: 'Between Endurance (more carbs) and Strength (more protein focus). Sedentary is the inverse lifestyle lean.',
    weights: {
      protein: 1.35, fibre: 1.05, sugar: 0.7, grain: 0.55, totalSugar: 0.45,
      sodium: 0.2, industrialSyrup: 1.15, processing: 1.0, isolate: 0.5,
      fortification: 0.55,
    },
  },

  sedentary: {
    label: 'Sedentary / low-activity', category: 'training', glyph: 'Sed',
    note: 'Stricter on sugar, processing and refined oils; rewards fibre; counts sodium and a little saturated fat — desk-day defaults when energy demand is low.',
    versus: 'Closest training cousin to Weight loss, but less protein-driven and more sodium / sat-fat aware.',
    weights: {
      sugar: 1.55, totalSugar: 1.35, processing: 1.35, fibre: 1.25,
      sodium: 1.0, saturatedFat: 0.85, protein: 0.85, refinedOil: 1.25,
      industrialSyrup: 1.5, simplicity: 1.15,
    },
  },

  generalFitness: {
    label: 'General fitness', category: 'training', glyph: 'Fit',
    note: 'Balanced scoring with light protein and fibre bonuses — everyday active people who are not in a named training block.',
    versus: 'A small step from Balanced toward Maintenance; not as macro-specific as Strength or Endurance.',
    weights: {
      protein: 0.85, fibre: 0.85, sugar: 1.1, totalSugar: 0.35, processing: 1.05,
    },
  },

  // ----- Diet style ---------------------------------------------------------
  highProtein: {
    label: 'High protein', category: 'style', glyph: 'Pro',
    note: 'Maximises the protein bonus and nearly stands down the isolate penalty so protein-forward products are not scored as industrial junk by default.',
    versus: 'Stronger protein dial than Muscle gain or Strength; does not specially loosen carbs like Endurance.',
    weights: {
      protein: 2.0, isolate: 0.25, fibre: 0.6, fortification: 0.45,
      sugar: 1.0, totalSugar: 0.5, processing: 1.0, simplicity: 0.7,
    },
  },

  lowCarb: {
    label: 'Low-carb', category: 'style', glyph: 'LC',
    note: 'Heavy on sugars and refined grains (including whole gluten grains on that dial); rewards protein and fibre; eases refined-oil ceilings common in low-carb cooking; softens novel-sweetener sting.',
    versus: 'Opposite of High-carb / Endurance. Sugar-conscious also hits sugar hard but still punishes all sweeteners and does not raise grain as far.',
    weights: {
      sugar: 1.8, totalSugar: 1.55, naturalSugar: 1.15, grain: 1.55,
      industrialSyrup: 1.8, sweetener: 0.65, artificialSweetener: 0.75,
      protein: 1.25, fibre: 1.1, refinedOil: 0.45, processing: 1.1,
    },
  },

  highCarb: {
    label: 'High-carb / performance', category: 'style', glyph: 'HC',
    note: 'Makes room for grain- and sugar-containing fuel while still capping HFCS and watching ultra-processing. Protein and fibre stay modestly rewarded.',
    versus: 'More permissive on carbs than Endurance; not a free pass on additives or seed-oil ceilings.',
    weights: {
      sugar: 0.35, grain: 0.25, totalSugar: 0.25, naturalSugar: 0,
      industrialSyrup: 1.25, protein: 0.85, fibre: 0.9, processing: 0.9,
      isolate: 0.75,
    },
  },

  strictSugar: {
    label: 'Sugar-conscious', category: 'style', glyph: 'Sug',
    note: 'Counts sugar from every source, including fruit and dairy, and penalises sweeteners of all kinds — including the “natural” ones.',
    versus: 'Unlike Low-carb, grain is unchanged and novel sweeteners stay costly. Unlike Weight loss, fibre/protein are not the focus.',
    weights: {
      sugar: 1.5, totalSugar: 1.5, naturalSugar: 1, sweetener: 1.5, artificialSweetener: 1.5,
      industrialSyrup: 1.5,
    },
  },
};

const DEFAULT_WEIGHTS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.def]));

function resolveWeights(stored) {
  const w = { ...DEFAULT_WEIGHTS };
  if (stored && typeof stored === 'object') {
    for (const [k, v] of Object.entries(stored)) {
      // Clamped to the range the settings slider can actually express. This used to allow 3,
      // so an imported or hand-edited file could set a weight the UI could neither display nor
      // reproduce, and moving any slider afterwards silently discarded it.
      if (k in w && typeof v === 'number' && isFinite(v)) w[k] = Math.max(0, Math.min(2, v));
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
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
