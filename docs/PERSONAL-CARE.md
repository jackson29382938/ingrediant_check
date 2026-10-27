# Personal-care and supplement label indices

These are transparent application rubrics for the **available label**, not clinically validated
safety scores, assessments of finished-product performance, or individualized supplement advice.
The research supports the ingredient functions and label limitations below; it does **not**
validate the numerical point weights chosen by this application. Compare indices only within the
same category and style. Food scoring and food goal weights remain unchanged.

## Coverage and controls

Supported: toothpaste, mouthwash, deodorant/antiperspirant, shampoo, conditioner, body wash/soap,
basic moisturizers, vitamins and supplements. Sunscreen, makeup, fragrances, specialty skincare and
ambiguous multi-category bundles remain unsupported. A product's identity and declared label are
required. Text cannot stand in for missing concentrations, formulation, usage instructions or doses.

Settings → What to rate provides an independent personal-care/supplement switch (on by default)
and three rating styles. The merchandise filter still skips other products. Existing food settings
are retained. Exports, imports, Chrome backup and optional Google backup preserve the new choices.
Ratings run locally. This change introduces no new automatic network destination or permission.
Source links open only when clicked.

## Rubrics

| Style | Index calculation | Required evidence |
|---|---|---|
| Evidence-based, personal care | Base 50 + 30 for a disclosed category-specific functional ingredient; −10 when fragrance/parfum/perfume is listed | Readable list and a matching function for that category |
| Evidence-based, supplements | 40 for serving-size disclosure + 40 for declared amounts + 20 for an available ingredient list | Supplement Facts with serving size and quantified amount; proprietary-blend doses remain unavailable |
| Minimal ingredients | 100 − 3 for each top-level declared ingredient after the first, capped at 90 points deducted | Readable declared list; supplements also require serving/amount evidence |
| Preference-focused | 100 − 20 per matched avoid-list term, capped at 100 deducted | At least one selected avoid-list term and a readable list; supplements also require serving/amount evidence |

The evidence-based index never rewards higher supplement doses. A short list does not establish
safety. No match to an avoidance preference establishes only that the term was not found in the
available text. Allergy and diet warnings are separate and never move these indices. Avoid-list
matches change **only** the explicitly selected preference-focused index; they never change food
scores or the other two styles.

Category function rules recognize fluoride in toothpaste; fluoride/CPC/chlorhexidine and selected
essential-oil actives in mouthwash; aluminum antiperspirant salts and selected deodorant ingredients;
selected cleansing surfactants in shampoo/body wash; conditioning agents in conditioner; and
humectants/emollients in basic moisturizers. The complete finite patterns live in
`src/engine/db/product-ratings.js`. A missing match means insufficient evidence for this rubric,
not proof that a formulation lacks the relevant function. Recognized ingredient coverage must also
pass the engine's shared readability gate. Unsupported languages/unknown lists stay unavailable.

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
  Facts, amounts, serving sizes, and why label information alone cannot determine suitability.

## Shopping and cache behavior

Product pages show the category, selected style, calculation and limitations. Search and cart badges
show the category. The hover breakdown reruns the same engine from the saved reading. Amazon and
retailer adapters use the declarations actually available on the page; missing/collapsed labels
require opening the section or pasting the list. Supplement Facts are preserved when a recognizable
published panel is available, without estimating absent amounts.

Mixed carts report separate category averages. Mixed-category or mixed-style lists exclude the label
index from ranking; price and retailer-review priorities remain usable. A homogeneous list can rank
by its label index. Popup comparisons explicitly identify incomparable categories/styles. Food
purchase-history imports do not add new personal-care label indices to food trends.

Weighted caches include category/style, rules revision and relevant preferences. Raw product readings
preserve category and Supplement Facts. Changing the style or preference-focused avoid list retires
the previous score and reruns scoring. Manual overrides remain private to the tab.

## Verification

`tests/product-ratings.test.js` covers all categories/styles, arithmetic, missing evidence,
unsupported combinations, dose neutrality, warnings, preferences, cache changes and backups.
`scripts/personal-care-harness.mjs` exercises real manifest content scripts in Chromium against
controlled public product/search/cart pages, including settings changes, cache refresh and pause.
`HARNESS_CONTENT_ONLY=1` runs browser content checks on managed machines that block unpacked
extension installation; it explicitly skips the separate extension-installation smoke test.
