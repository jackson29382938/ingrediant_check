# Personal-care and supplement label indices

These are transparent application rubrics for the **available label**, not clinically validated
safety scores, assessments of finished-product performance, or individualized supplement advice.
The research supports the ingredient functions, cautions and limits below; it does **not**
validate the numerical point weights chosen by this application. Compare indices only within the
same category and style. Food scoring and food goal weights remain unchanged.

An index is not a quality band. It is drawn in gray in every palette (panel, badges, cart, popup,
toolbar), captioned with its category and style, and never coloured green or red by its number.

## Coverage and controls

Supported: toothpaste, mouthwash, deodorant/antiperspirant, shampoo, conditioner, body wash/soap,
basic moisturizers (lotion, cream, body butter), vitamins and supplements. Sunscreen, makeup,
fragrances, serums and treatment skincare, dry shampoo, medicated creams and ambiguous multi-category
bundles (a 2-in-1, a gift set) remain unsupported. A product's identity and declared label are
required. Text cannot stand in for missing concentrations, formulation, usage instructions or doses.

Products are identified from the title, so the matching is deliberately conservative:
`tests/product-classification.test.js` pins more than 90 real listing titles. Pet, car, carpet, laundry,
dish and shoe products that carry a personal-care word ("dog shampoo", "car wash shampoo",
"shoe deodorant") are not claimed. A supplement needs both a nutrient or botanical and a dosage form
or dose in the title ("Vitamin C Gummies", "Biotin 10000 mcg"), or a Supplement Facts panel on the
page; "vitamin D milk", "turmeric powder" and "ginger chews" stay food.

Settings → What to rate provides an independent personal-care/supplement switch (on by default)
and three rating styles. The merchandise filter ("Skip unsupported merchandise") still skips other
products. Existing food settings are retained. Exports, imports, Chrome backup and optional Google
backup preserve the new choices. Ratings run locally. This change introduces no new automatic
network destination or permission. Source links open only when clicked.

## Reading the label

The shared food parser reads one comma-separated list. Personal-care labels use two conventions that
hid ingredients from it, and a hidden ingredient is not charged, so the product looked cleaner than it
was. `prepareLabel` in `src/engine/db/ingestible.js` rewrites both into a plain list first, for these
categories only (no food is read differently):

- **US Drug Facts.** "Active ingredient: Sodium fluoride 0.24% (0.14% w/v fluoride ion) Purpose:
  Anticavity. Inactive ingredients: …" becomes the active ingredient followed by the inactive list.
  Strengths and the purpose line are dropped. A label that names only an active ingredient is
  **partial**: the evidence index can still be rated from it (and says what it could not check), but
  the minimal and preference-focused indices decline, because a one-name list would read as "nothing
  else in it".
- **INCI.** "Sodium Laureth Sulfate (and) Cocamidopropyl Betaine" is two names; "Water (Aqua)" and
  "Aqua/Water/Eau" are water.

An entry counts toward the readability gate when it is shaped like an ingredient name (a chemical
suffix, a plant part, a numbered polymer such as PEG-40 or Ceteareth-20, a colourant code) and is not
a sentence. A 20-name moisturizer list used to fall below the gate at 30% recognized because only a
short word list counted; sentences and gibberish still do not count.

## Rubrics

| Style | Index calculation | Required evidence |
|---|---|---|
| Evidence-based, personal care | Base 50 + 30 for a disclosed category-specific functional ingredient; −10 when fragrance/parfum/perfume is listed; −10 for each documented caution below (once per caution) | Readable list and a matching function for that category |
| Evidence-based, supplements | 40 for serving-size disclosure + 40 for declared amounts + 20 for an available ingredient list; −20 for each nutrient whose one printed serving is above its adult upper limit (at most three) | Supplement Facts with serving size and a quantified active amount; proprietary-blend doses remain unavailable |
| Minimal ingredients | 100 − 3 for each top-level declared ingredient after the first, capped at 90 points deducted. For a supplement that declares "Other ingredients", only those are counted | Readable declared list; supplements also require serving/amount evidence |
| Preference-focused | 100 − 20 per matched avoid-list term, capped at 100 deducted | At least one selected avoid-list term and a readable list; supplements also require serving/amount evidence |

A short list does not establish safety. No match to an avoidance preference establishes only that the
term was not found in the available text. Allergy and diet warnings are separate and never move these
indices. Avoid-list matches change **only** the explicitly selected preference-focused index; they
never change food scores or the other two styles. Every row shown is part of the number shown.

### The function each category needs (evidence-based)

Fluoride in toothpaste; fluoride, cetylpyridinium chloride, chlorhexidine or eucalyptol/thymol in
mouthwash; aluminum antiperspirant salts or a recognized deodorizing ingredient (baking soda,
magnesium hydroxide, alum, zinc ricinoleate) in deodorant; a cleansing surfactant in shampoo and body
wash (any head group on a fatty chain: sulfates, sulfonates, isethionates, glutamates, betaines,
glucosides, … — or a soap salt in body wash); a cationic or silicone conditioning agent in conditioner;
a humectant, emollient or occlusive in a moisturizer. The patterns live in
`src/engine/db/product-ratings.js`.

A label that lists none is **declined**, not scored low, and the panel says what it needed. The
absence may only mean the page showed part of the label (Amazon often keeps the Drug Facts active
ingredient in a different section from the ingredient list), so a low score would punish a product for
the page's layout. Fluoride-free toothpastes and natural deodorants are therefore unavailable under
this style, and still rated by the other two.

### Cautions (evidence-based, personal care)

Only ingredients that a regulator or a standard patch-test series has singled out, each charged once
however many relatives are listed:

| Caution | Why it is charged |
|---|---|
| Methylisothiazolinone and methylchloroisothiazolinone | A recognized contact allergen; the EU prohibits methylisothiazolinone in leave-on cosmetics |
| Formaldehyde and formaldehyde releasers (DMDM hydantoin, quaternium-15, imidazolidinyl urea, diazolidinyl urea, bronopol, sodium hydroxymethylglycinate) | Formaldehyde is a recognized contact allergen and a classified human carcinogen |
| Triclosan and triclocarban, in body wash and soap only | In 2016 the FDA ruled that consumer antiseptic washes could not keep these without proof of added benefit |

Claims in the listing's marketing copy ("dermatologist tested", a seal in the title) are not label
content and move nothing, for the reason the food engine scores seller bullets at half weight.

### Supplement upper limits

The evidence index for a supplement used to be 100 for every complete panel (the three point rows were
all guaranteed by the gate), so 9,000 mg of vitamin C scored the same as 90 mg. It now compares each
nutrient the panel quantifies with the adult Tolerable Upper Intake Level from the National Academies'
Dietary Reference Intakes, as the NIH Office of Dietary Supplements publishes them. Four rules keep a
flag honest:

- The limit is the highest across adult age groups, so a flag means the serving exceeds it for every
  adult. Units convert at the most generous ratio (1 IU of vitamin E = 0.67 mg, of vitamin A = 0.3 mcg,
  of vitamin D = 0.025 mcg).
- An amount belongs to a nutrient only when it follows that nutrient's own name, with at most an
  "(as …)" form between. "Magnesium Citrate 1000 mg" is a compound weight and is left alone.
- Where a limit applies only to one form it is applied only when that form is stated: preformed vitamin
  A (retinol; beta-carotene has no limit, and a mixed source is not judged) and folic acid (not other
  folates).
- The comparison is one printed serving against a daily limit. It is not your daily total and not a
  diagnosis; some people take more under medical supervision, and the panel says so.

| Nutrient | Limit | Nutrient | Limit |
|---|---|---|---|
| Vitamin C | 2,000 mg | Calcium | 2,500 mg |
| Vitamin D | 100 mcg (4,000 IU) | Iron | 45 mg |
| Vitamin E | 1,000 mg | Zinc | 40 mg |
| Vitamin B6 | 100 mg | Magnesium | 350 mg |
| Niacin | 35 mg | Selenium | 400 mcg |
| Folic acid | 1,000 mcg | Copper | 10 mg |
| Preformed vitamin A | 3,000 mcg | Iodine | 1,100 mcg |
| Manganese | 11 mg | Choline | 3,500 mg |
| Molybdenum | 2,000 mcg | Phosphorus | 4,000 mg |
| Boron | 20 mg | | |

Caffeine of 200 mg or more in one serving adds a note (the FDA cites 400 mg a day as an amount not
generally associated with dangerous effects for healthy adults); it is not charged.

A panel is usable when it states a serving size ("1 capsule", "One (1) tablet", "½ tsp") and at least
one active amount that is not a macronutrient line or the serving weight. The evidence-based index
never rewards higher supplement doses.

## Evidence sources

- [ADA: toothpastes](https://www.ada.org/resources/ada-library/oral-health-topics/toothpastes) and
  [mouthrinse](https://www.ada.org/resources/ada-library/oral-health-topics/mouthrinse-mouthwash)
  describe oral-care actives and the distinction between ingredient presence and product-level evidence.
- [EU CosIng](https://ec.europa.eu/growth/tools-databases/cosing/) provides ingredient-function
  information; inclusion in the database is not approval of a formulation or a safety determination.
- [FDA: cosmetic allergens](https://www.fda.gov/cosmetics/cosmetic-ingredients/allergens-cosmetics)
  explains fragrance disclosure limitations and sensitivities. Fragrance disclosure is a limited
  sensitivity indicator here, not a prediction that a particular user will react.
- [AAD: moisturizers](https://www.aad.org/public/everyday-care/skin-care-basics/dry/pick-moisturizer)
  describes moisturizing ingredients and the role of formulation and individual skin needs.
- [NIH: dietary supplements](https://ods.od.nih.gov/factsheets/WYNTK-Consumer/) explains Supplement
  Facts, amounts, serving sizes, and why label information alone cannot determine suitability. The
  upper limits are the National Academies' Dietary Reference Intakes, which the NIH Office of Dietary
  Supplements reproduces in its nutrient fact sheets.

The caution and limit sources are cited by name rather than linked: the panel links only to the pages
above, which are the ones this project has checked.

## Shopping and cache behavior

Product pages show the category, selected style, calculation and limitations. Search and cart badges
show the category. The hover breakdown reruns the same engine from the saved reading. Amazon and
retailer adapters use the declarations actually available on the page; missing/collapsed labels
require opening the section or pasting the list. Supplement Facts are preserved (up to 4,000
characters, enough for a thirty-nutrient multivitamin) when a recognizable published panel is
available, without estimating absent amounts, and are shown with the details, not above the score.

Mixed carts report separate category averages. A cart of one category is averaged and named for that
category, not given a band word such as "Good". Mixed-category or mixed-style lists exclude the label
index from ranking; price and retailer-review priorities remain usable. A homogeneous list can rank
by its label index. Popup comparisons explicitly identify incomparable categories/styles. Food
purchase-history imports do not add personal-care label indices to food trends, including through a
saved score that shares a product's key.

A saved score is retired only by the settings it was computed from. A food score reads the food
weights, the food-only switch and the provenance indexes; a personal-care or supplement index reads the
rating style, the category switch and, for the preference-focused style only, the avoid list. Both are
retired by a change of rules revision. Choosing a different shampoo style therefore does not send the
cart, search page and popup back to the network for the foods they have already rated. Raw product
readings preserve category and Supplement Facts. Manual overrides remain private to the tab.

## Verification

`tests/product-classification.test.js` pins the title matching (what is claimed and what is not).
`tests/personal-care-label.test.js` pins label reading (Drug Facts, INCI, real label formats),
the cautions, the upper-limit parser and its non-flags, and the 0–100 and arithmetic invariants.
`tests/personal-care-ui.test.js` pins the gray colour, captions, localisation and the module wiring.
`tests/product-ratings.test.js` covers all categories and styles, arithmetic, missing evidence,
unsupported combinations, warnings, preferences, cache changes and backups.
`tests/score-cache.test.js` pins which setting retires which saved score.
`scripts/personal-care-harness.mjs` exercises real manifest content scripts in Chromium against
controlled public product/search/cart pages, including settings changes, cache refresh and pause.
`HARNESS_CONTENT_ONLY=1` runs browser content checks on managed machines that block unpacked
extension installation; it explicitly skips the separate extension-installation smoke test.
