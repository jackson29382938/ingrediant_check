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

// Named starting points. Each is a set of weight overrides against the defaults.
const PRESETS = {
  balanced: { label: 'Balanced (default)', weights: {},
    note: 'Weighs processing level and additives heavily, ignores fat and total sugar, and rewards sourcing claims.' },

  conventional: { label: 'Conventional nutrition',
    note: 'Follows mainstream dietary guidance: counts saturated fat, sodium and total sugar, rewards fibre, and treats fortification as neutral.',
    weights: { saturatedFat: 1, sodium: 1, totalSugar: 1, naturalSugar: 0.5, fibre: 1, protein: 0.5,
               fortification: 0, refinedOil: 0.3, dairyProcessing: 0.3, animalWelfare: 0.5 } },

  additive: { label: 'Additive-averse',
    note: 'Cares mainly about what was added to the food, not about macronutrients or sourcing.',
    weights: { colour: 1.5, artificialSweetener: 1.5, preservative: 1.5, flavour: 1.5, glutamate: 1.5,
               texture: 1.3, processingAid: 1.3, strongPreservative: 1.5,
               organic: 0.5, animalWelfare: 0.3, nonGmo: 0.5 } },

  wholeFood: { label: 'Whole-food focused',
    note: 'Rewards short ingredient lists and minimal processing above everything else.',
    weights: { processing: 1.5, simplicity: 2, isolate: 1.5, texture: 1.3, flavour: 1.3,
               fortification: 1.2, grain: 1.2 } },

  strictSugar: { label: 'Sugar-conscious',
    note: 'Counts sugar from every source, including fruit and dairy, and penalises sweeteners of all kinds.',
    weights: { sugar: 1.5, totalSugar: 1.5, naturalSugar: 1, sweetener: 1.5, artificialSweetener: 1.5,
               industrialSyrup: 1.5 } },
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

const _exports = AIRmodule('categories', { CATEGORIES, PRESETS, DEFAULT_WEIGHTS, resolveWeights });
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
