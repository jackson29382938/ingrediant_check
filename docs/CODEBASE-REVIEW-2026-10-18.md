> Historical findings from the pre-1.16.0 source. The remaining fixes are integrated in the unreleased 1.16.1 patch; see [current validation](CURRENT-VALIDATION.md). The linked verification script now asserts corrected behavior.

# Codebase and scoring review — October 18, 2026

The extension has a strong automated foundation, but passing its fixtures does not establish that scores are calibrated health measurements. The highest-value next work is preserving scoring evidence, making nutrition bases consistent, and correcting parser and sourcing discontinuities before expanding retailer coverage.

## Scope and verification

Reviewed the scoring pipeline and rule tables, preferences, label extraction and food/coverage gates, product and score caches, product/search/cart flows, purchase snapshots and analytics, worker message/network boundaries, Google account/backend handling, manifests, CI, and accuracy/privacy documentation. This was a source review with targeted executable probes, not an exhaustive proof of every execution path.

- `npm test`: **1,085 passed, zero failed or skipped**.
- `npm run preflight`: passed.
- Additional Node probes reproduced the issues below without changing application code.
- Follow-up: `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm run harness:ci` **passed**, ending with `harness CI passed (no Amazon network, no page errors)`. This includes actual extension startup, six extension pages, saved Amazon pages, retailer/cart flows, purchase history, recall and settings checks.
- Follow-up verification also ran five targeted Chromium 153 DOM/panel reproductions. All retailer pages, certification replies, OAuth and backend responses in these checks were fixtures; no live retailer or signed-in Google validation was performed. Firefox was not run.

## Follow-up verification

Run `node docs/review-verification-2026-10-18.cjs` to reproduce **11 expected-defect probes**. Successful execution means the documented defects were reproduced; it does not mean those behaviors are correct. Add `--browser` with Playwright and its browser available to run five actual DOM/closed-shadow-panel cases. In this workspace:

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node docs/review-verification-2026-10-18.cjs --browser
```

The five Chromium 153 cases displayed **96** for the dropped oil entry, **88** for organic unknown identities, **56 versus 31** for equivalent nested code notation, and **99** for enriched beef while its saved input replayed at **86**. All mounted as scored panels with no page errors. This uses real manifest-ordered engine, extraction, panel and product modules, with browser storage and certification replies stubbed. It verifies reachability through the UI on synthetic labels, not prevalence on live products. The diagnostic script passes ESLint with zero warnings.

**The sourcing persistence issue is broader than history serialization.** The actual `enrichProvenance` path in `src/content/product.js:394–403` calls `presentResult` without the enriched `input`. The numeric score cache is updated to 99 while the product-input cache stays at 86. The unchanged `savedRating` function from `src/content/orders.js:112–124` prefers that input cache and imports **86**. The history-schema probe also remains valid, but preserving provenance in the history sanitizer alone would not fix this upstream omission. Persist the same versioned evidence snapshot used for every displayed score, then carry it through product/history schemas.

**The nested parser defect has a substantial score effect.** `chocolate (sugar, cocoa butter, emulsifiers (322, 471))` scores **56 / NOVA 3**. Adding the optional E prefixes, `chocolate (sugar, cocoa butter, emulsifiers (E322, E471))`, scores **31 / NOVA 4**. Both describe the same additive codes. The second bare numeric code loses its function-word context and is not converted to E471. Prioritize this alongside silent entry loss, rather than treating it only as a parse-tree maintenance issue.

**Additional confirmed gaps:**

| Finding | Reproduction | Location and recommendation |
| --- | --- | --- |
| Cold-pressed qualifiers vary by language | `cold-pressed sunflower oil`: **78**; French `huile de tournesol pressée à froid`, German `kaltgepresstes Sonnenblumenöl`, Polish `olej słonecznikowy tłoczony na zimno`: **63** each | `src/engine/db/oils.js:63` recognizes English qualifiers only. Add language-aware qualifier normalization tied to the specific oil entry; verify translated qualifier twins. |
| Missing total sugar borrows a later nutrient | Actual extraction of `Nutrition Facts Serving size 30g Calories 120 Includes 0g Added Sugars Protein 4g` returns **sugar: 4** despite no total-sugar amount | `src/content/extract.js:290`: the total-sugar expression can start at “Added Sugars” and run into the Protein row. Bound matches to their nutrient row and prevent the total-sugar matcher from using an added-sugar label. |
| Three decimal places become thousands | Actual extraction of `Nutrition Facts Sodium 0mg Protein 0.125g Total Sugars 0g` returns **protein: 125** | `src/content/extract.js:280–283`: separator interpretation is based on digit count alone. Use locale/unit context and retain ambiguity when unresolved. This is a synthetic precision edge case, not measured live frequency. |

The nutrition-basis issue was also reproduced through the actual nutrition extractor using two readable nutrient fields, rather than the earlier engine-only single-field input. With only sodium weighting enabled, the results remain **95 without serving size versus 80 with a 30g serving**. Existing tests intentionally verify normalized comparisons when serving size is known; they do not resolve the policy mismatch when it is unavailable.

## How the score works

Ingredient text is normalized, split into positioned entries and bracket families, and filtered for claims and cross-contact statements. Matching rules infer a processing class with base scores of 96/90/80/60. Position-weighted deductions are grouped and saturated; label and goal rewards follow. Optional nutrition quantities and sourcing evidence adjust the total. A soft ceiling compresses totals above 88, then ingredient ceilings and the floor of 3 apply. Display rows are reconciled to the final integer score. Allergen/diet/avoid warnings are separate from the score.

This is an adjustable preference model with processing heuristics. Its exact point values and verdict bands are policy choices, not measured probabilities or clinical outcomes.

## Prioritized findings

### 1. High: nutrition uses one threshold curve for incompatible bases

**Location:** `src/engine/score.js:718–752` and nutrition scoring at `:1077` onward.

When mass or volume is known, amounts are normalized to 100g/100ml. Without it, amounts stay per serving. Both feed the same `NUTRITION.calc` curves. Sodium still advertises per-serving thresholds in the category help. This makes data completeness change the meaning of the calculation.

Reproduction with `ingredients_text: 'oats'` and `weights: {sodium: 1}`:

| Nutrition input | Sodium deduction | Final score |
| --- | --- | --- |
| `{sodium: 400}` | 2 | 95 |
| `{sodium: 400, servingGrams: 30}` | 20 | 80 |

**Recommendation:** choose an explicit comparison basis for each policy. Either require a convertible 100g/100ml basis and report unavailable amounts, or define separately calibrated per-serving curves. Define solid and beverage behavior deliberately, and align settings/help text. Verify equivalent composition at different serving sizes gives the same result when normalized comparison is selected.

### 2. High: long ingredient entries silently disappear

**Location:** `src/engine/score.js:470` (`usable`) and `:581`.

Entries of 80 or more characters are discarded rather than retained as unassessed. Their absence also removes them from the coverage denominator, potentially improving both score and apparent confidence.

Reproduction: score `'oats, sunflower oil ' + 'processed '.repeat(8)`. The oil entry disappears; the result is **96, 100% coverage, one parsed ingredient**, rather than retaining the refined-oil ceiling or declining an incomplete parse. This probe is synthetic; it establishes a parser failure, not its frequency on real labels.

**Recommendation:** keep the bounded original entry and an explicit unassessed/parse-warning state. Separate resource limits from ingredient eligibility. A skipped entry must never make the remaining reading look complete. Add a length-boundary regression with a capped ingredient.

### 3. High: sourcing switches off at five parsed ingredients

**Location:** `src/engine/score.js:843`.

`provenanceApplies` requires `list.length <= 4`, including expanded children. Adding a seasoning can remove an unrelated sourcing deduction.

| Ingredient list | Default score |
| --- | --- |
| `beef, salt, pepper, garlic` | 82 |
| `beef, salt, pepper, garlic, onion` | 94 |

**Recommendation:** scope sourcing by the dominant ingredient/product kind and whether certification applies to that ingredient. Do not use a cliff in flattened ingredient count. Include seasonings and bracket-disclosure invariance checks. Keep sourcing uncertainty visibly separate from measured nutritional quality.

### 4. Medium: organic claims count as ingredient recognition

**Location:** `src/engine/score.js:448–452`.

`e.organic || recognised(e.ing)` makes an unknown ingredient count as understood merely because it has an organic adjective.

- `qzx, zqx`: coverage **0%**, so callers decline it.
- `organic qzx, organic zqx`: coverage **100%**, score **88**, so the coverage gate accepts it.

**Recommendation:** track recognized ingredient identity and recognized claims separately. Organic evidence may support a sourcing claim but must not establish knowledge of the underlying ingredient. Do not simply lower or raise the global coverage threshold; preserve this distinction first.

### 5. High: nested sub-list splitting loses parent relationships and additive codes

**Location:** `src/engine/score.js:573–578`.

`expandEntry` splits a bracket group on commas before respecting inner bracket depth. In `milk chocolate (sugar, cocoa butter, emulsifier (soy lecithin, sunflower lecithin)), salt`, soy lecithin belongs to the emulsifier family, but sunflower lecithin is incorrectly assigned to the outer chocolate family. Family membership controls whether function words are charged separately.

Synthetic probes with nested function words also produced different deductions after swapping equal-position children. Follow-up Chromium verification established a **25-point** difference for equivalent nested numeric/E-prefixed additive codes, documented above. Frequency on real labels still needs corpus measurement.

**Recommendation:** use a depth-aware tokenizer at every nesting level, preserving the existing decimal-comma behavior. Test parse-tree parent IDs and equivalence under harmless formatting changes, in addition to final score fixtures.

### 6. High: sourcing evidence is lost between displayed, cached and historical scores

**Location:** `src/content/product.js:394–403`; `src/engine/db/product-cache.js:37–68`; `src/engine/db/purchase-history.js:4–15`; `src/engine/db/purchase-analytics.js:3–11`. The Apps Script copy of the history schema must remain aligned.

The enrichment path does not update the saved input, and product/history input sanitizers do not retain `provenanceRecord`. Current-goal analytics then rescores incomplete input while treating the presence of `record.input` as a complete snapshot. The follow-up reproduction above also confirms an immediate product-page/Orders discrepancy.

Reproduction: `{ingredients_text: 'beef', provenanceRecord: {certifications: 'American Grassfed Association certified'}}` scores **99**. Passing it through `cleanInput` and rescoring gives **86**, without any change in rules or goals. Recorded scores remain intact; replay/current comparisons are affected when the original input used this evidence.

**Recommendation:** version the scoring-input schema and retain a bounded, validated snapshot of scoring-relevant provenance. Store a completeness indicator for older snapshots and mark comparisons partial when evidence is unavailable. Add a serialization/replay invariant over every supported source of score adjustments.

## Broader scoring improvements

1. **Expose enabled-but-unavailable factors.** Nutrition fields that are missing or invalid currently contribute nothing. Return an assessment status per enabled factor and display, for example, “Protein assessed; sodium unavailable.” Keep confidence separate from the food score, but make it visible beside badges and comparisons. A protein goal should not quietly compare a fully documented product against one with no protein data as if both were equally assessed.
2. **Strengthen nutrition integrity.** Individual upper bounds accept internally contradictory compositions; a probe with 90g saturated fat, 90g carbohydrate and 10g protein per 100g is accepted. Reject contradictions supported by the source's declared basis and account for rounding and jurisdictional carbohydrate/fibre conventions. Do not naively sum all fields: sugar is part of carbohydrate and saturated fat is part of fat. Report invalid fields explicitly rather than silently erasing the entire panel.
3. **Distinguish nutrition, processing and sourcing.** A single total currently mixes these dimensions. Keep the personalized total if useful, but expose component summaries and call it an ingredient/preference score consistently. Avoid suggesting that organic/welfare certification offsets a nutritional issue or that “Excellent” establishes overall healthfulness. Existing hard ingredient ceilings already prevent some reward bypasses.
4. **Calibrate against independent labels and judgments.** Preserve a held-out, versioned set of real labels by retailer, language, food category and source. Measure extraction completeness, false acceptance, ingredient detection precision/recall, pairwise ranking and abstention separately. Existing translated twins and rule witnesses are valuable regression checks but do not independently validate the model. The evidence limitations in `ACCURACY.md` are candid and should remain visible.
5. **Reduce processing double counting deliberately.** One additive can lower the NOVA-derived base and also incur an ingredient deduction. This is an explicit current design, not an arithmetic bug. Run sensitivity/ablation comparisons to determine whether it overwhelms quantity data or user goals, and explain both effects in the UI.

## Engineering and reliability recommendations

- **Make scoring stages explicit.** Split the 1,283-line engine into pure parsing, evidence assessment, classification, factor evaluation, aggregation and explanation stages. Preserve the current public interface and score snapshots during the refactor. Several large settings/background files would benefit from the same boundary-based approach.
- **Centralize the assessment contract.** The 0.34 coverage gate is repeated across Amazon, retailer, cart and history consumers. Share one assessment function returning `usable`, coverage, parse warnings and unavailable factors. This reduces divergence and makes missing-data behavior testable once.
- **Add metamorphic and replay tests.** Prioritize harmless formatting equivalence, nested-family integrity, serialization round trips, equal-composition serving changes and seasoning additions. Avoid asserting arbitrary numeric scores without an underlying behavioral invariant.
- **Improve fallback data completeness.** `src/background.js:20` does not request Open Food Facts nutriments. Barcode fallback can therefore recover ingredients while leaving enabled quantity factors dependent on page data. Request and map explicitly based OFF quantities where reliable; do not combine mismatched serving and 100g amounts.
- **Plan backend scaling before wider rollout.** The Apps Script backend uses a global script lock for writes and history reads, with sheet scans and some authentication/network work inside locked paths. Instrument lock wait, request latency, errors and row counts. Bound batches and reduce critical sections while preserving deletion and merge atomicity. Move to indexed storage when measured load warrants it.
- **Make validation status easy to find.** Documentation contains extensive dated audits and superseded defaults. Keep one current release/evidence index generated or checked against actual defaults. Link historical reports as history so their older numbers and feature defaults cannot be mistaken for current behavior.

## Existing strengths to preserve

Pure local scoring; separate allergen flags; bounded/grouped deductions; visible ceiling/floor arithmetic; explicit preference controls; cache invalidation by rule revision and settings; bounded cache storage; worker message allowlists; optional external-service permissions; cancellation on pause; account separation and deletion handling; and CI coverage spanning Node tests, packaging checks and browser harnesses. These are valuable foundations for correcting the above behavior without a wholesale rewrite.

## Recommended implementation order

1. Prevent silent parse loss and organic-based coverage inflation; correct nested tokenization.
2. Specify nutrition comparison bases, then implement basis-aware assessment and missing-data reporting.
3. Remove the sourcing ingredient-count cliff and preserve evidence through history serialization.
4. Add the corresponding invariants, bump the scoring revision/cache compatibility as needed, and rerun existing Node and browser checks.
5. Collect independent real-label validation and calibrate weights before expanding coverage further.
