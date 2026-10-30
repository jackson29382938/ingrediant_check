# Feature review — October 30, 2026

Implementation follow-up: [1.19.0 feature integration](FEATURE-INTEGRATION-2026-10-30.md).

Ingredient Check 1.18.1 already has substantial functionality. The best next investment is making its scores easier to interpret and its comparisons more useful, while improving installation and real-store reliability. Additional retailer adapters and more scoring preferences have lower priority until those foundations are stronger.

This is a source-based product assessment, not user research or a fresh live-store audit. Priorities reflect the current implementation and documented evidence gaps; adoption and retention benefits are hypotheses to validate.

## What already exists

- Local ingredient scoring, score breakdowns, nutrition-factor assessment and processing/ingredient/nutrition/sourcing contributions.
- Twenty combinable goals, individual weights, separate allergen/diet/avoid warnings, and settings detail levels.
- Local label-photo OCR, optional barcode lookup, and product-page label pasting.
- Product/search/cart badges, cart averages, saved-score reuse and hover/focus explanations.
- Amazon score/unit-price sorting with adjustable priorities and a comparison panel that follows searches.
- A two-product comparison in the popup, using compatible cached scores.
- Opt-in Amazon purchase history, trends, recorded/current scoring, source filters, exports and optional account sync.
- Chrome/Firefox packaging, themes and color-vision palettes. Personal care and supplements have separate label indices.

These should be extended where useful rather than proposed as entirely new features. Findings in older audits must be checked against the current source and [the integration record](AUDIT-INTEGRATION-2026-10-25.md); many earlier defects are already fixed.

## Prioritized opportunities

Effort is relative: S = a focused change within an existing flow; M = several UI/data-contract changes; L = a broader feature or ongoing validation program. These are not delivery estimates.

| Order | Improvement or addition | Why it matters | Effort |
| --- | --- | --- | --- |
| 1 | Improve evidence-quality summaries across shopping surfaces | A strong score can still rely on partial recognition or unavailable nutrition factors. | M |
| 2 | Improve comparisons with aligned differences and tradeoffs | The existing popup shows scores and names, but does not explain why one product fits better. | M |
| 3 | Add explicit comparison filters | Ranking priorities cannot enforce a budget, a selected ingredient exclusion, or minimum evidence requirements. | M |
| 4 | Improve installation and updating through store distribution | Chrome requires unpacked installation; unsigned Firefox installs disappear on restart. | M, plus publisher steps |
| 5 | Improve current retailer reliability and evidence | Many adapters are previews; successful fixture tests do not establish dependable daily shopping. | L, ongoing |
| 6 | Add a standalone label checker | Current manual pasting is attached to a retailer product page. Unsupported pages and package photos need an accessible entry point. | M |
| 7 | Improve allergen warnings with evidence types | A declared ingredient and a cross-contact advisory currently converge into the same allergen flag shape. | M |
| 8 | Add saved products and shopping shortlists | Cached comparisons are temporary; useful discoveries need an intentional, durable home. | M |
| 9 | Improve onboarding with a worked example and a settings-impact preview | Existing progressive disclosure helps, but shoppers still need to understand how a goal changes a familiar product. | S–M |
| 10 | Improve purchase insights with practical next actions | The dashboard already has substantial statistics; clearer recurring drivers and comparable periods would help more than additional charts. | M |

### 1. Consistent evidence-quality summaries

The engine already returns `coverage`, `parseWarnings`, `nutritionAssessment` and `dimensions` in [score.js](../src/engine/score.js). The product panel already shows partial recognition and unavailable nutrition factors in [panel.js](../src/content/panel.js). The gap is consistency and decision support across badges, cached comparisons and ranked results.

Show a compact evidence summary next to the score: label source, capture age, recognition completeness, and whether factors selected by the shopper were assessable. Expand it on focus/click. Retain source types independently: OCR, page text and barcode matches are different evidence, not a single ordered accuracy scale. Recognition coverage is not the probability that a label is correct.

Use plain labels such as “Partial reading” and “Protein amount unavailable.” Offer a filter requiring the evidence a selected goal needs. Keep evidence quality separate from the preference score; missing quantities must remain unknown.

Success criterion: shoppers can distinguish a high score supported by a complete reading from a high score with important unassessed factors without opening Settings. Verify this on product, listing, cart, popup and comparison views.

### 2. Explain differences in the existing comparison

[paintCompareCard](../src/options/popup.js) currently renders a score, verdict, product summary and product link. Its inputs are saved scores; the comparison does not load full product readings. Build a larger comparison view backed by saved evidence and retain the lightweight popup as its entry point.

Start with two products and show aligned rows for selected warning matches, available nutrients on compatible bases, processing contribution, ingredient deductions, sourcing, unit price where known, and source/freshness. Summarize the biggest differences: for example, “Higher ingredient score; higher price per 100 g; protein comparison unavailable.” Show changed goals in both columns together.

Success criterion: a shopper can explain the tradeoff between two products using their selected goals. Missing fields must be visible, incompatible rating categories must stay separate, and every explanation must agree with the displayed score.

### 3. Constraints before ranking, plus a next step toward alternatives

The current ranking factors in [sorted-results.js](../src/engine/db/sorted-results.js) are score, unit price, listing price, stars and review count. [sorted.js](../src/options/sorted.js) ranks the collected items without a shopper-facing constraint stage.

Add maximum price, minimum score, selected avoid/allergen-match exclusions, and required evidence filters. Preserve unknown matches in a distinct state and provide an explicit choice for handling them; never describe a filtered result as allergy-safe. Explain an empty result and offer to relax one constraint at a time.

Once filters work, add “Find alternatives in these results” from a product or cart item. Start with already collected products of comparable type and compatible package units. Show at most a few options with score and price differences. Broader cross-store matching should follow a reliable product/variant identity model.

Success criterion: products that violate explicit constraints never rise to the top because of another strong ranking factor. Alternatives must show their evidence, price basis and reason for inclusion.

### 4. Installation and updates

[README.md](../README.md) documents ZIP extraction, Developer mode and manual reloads for Chrome. [BROWSERS.md](BROWSERS.md) documents temporary unsigned Firefox installs. These are substantial adoption and maintenance costs even if the extension itself works well.

Prepare Chrome Web Store publication and a Mozilla-signed Firefox package, with browser-managed updates and a simple first-run verification. Signing/publication requires the publisher's accounts and release process. This review does not establish whether any external store listing exists beyond the repository's documented distribution path.

Success criterion: a new shopper installs from a normal browser installation flow, sees a first score, and retains the extension after browser restart without handling source files.

### 5. Reliable coverage before broader coverage

[STORES.md](STORES.md) records partial live validation, changing layouts and challenges on several retailers. [ACCURACY.md](ACCURACY.md) separates the three retailer live-capture corpus entries from representative/synthetic labels and seven public database records. Those distinctions matter more than a large supported-host count.

Prioritize the stores shoppers actually use. Maintain independently reviewed labels across variants, languages, text/OCR sources and common product categories. Measure correct product binding, label completeness, false warning matches, missing-label abstention and successful scoring separately. Add a shopper-facing store/status explanation and an immediate recovery action such as opening label details, pasting text or reporting an incorrect reading.

Review score behavior with held-out labels and independent judgments before retuning defaults. [SCORING-SENSITIVITY.md](SCORING-SENSITIVITY.md) already shows processing-weight changes of up to 40 points on some fixtures; this is evidence of model sensitivity, not proof that a particular ranking is wrong. Make the ingredient/preference nature of the score clear wherever a broad verdict is shown.

Success criterion: a maintained set of representative shopping journeys works on the live stores, with capture dates and failure reasons. Passing synthetic tests alone is insufficient for promoting a preview.

### 6. Standalone label checker

Add “Check a label” to the popup, opening an extension page that accepts pasted ingredients, an uploaded package photo, or an explicit barcode lookup. Reuse the existing engine, local OCR and permission model. Let shoppers correct extracted text before scoring and keep manually entered labels distinct from retailer evidence.

Start with text input and local image upload. Camera scanning or a mobile companion can be evaluated later; neither needs to block the desktop feature.

Success criterion: a shopper can assess a label from an unsupported store without navigating to a supported product page. A manual check must not silently overwrite a retailer product's evidence.

### 7. Allergen evidence types

[score.js](../src/engine/score.js) passes ingredient, declared-allergen and cross-contact text together to the detector. [allergens.js](../src/engine/db/allergens.js) returns a flag with `kind`, `id`, `label` and a matching entry, without preserving which of those evidence types produced it.

Preserve separate “Ingredient detected,” “Contains statement,” “May contain/shared facility,” and “Unassessed” states, with the matched source text. Carry these through caches, comparisons and purchase snapshots without inventing classifications for historical records. Keep warnings independent of scoring.

Success criterion: a shopper can see why a warning appeared, and an absent warning on incomplete evidence never appears as confirmed absence.

### 8. Saved products and shortlists

Introduce an explicit local saved-products collection rather than relying on expiring cache entries. Save identity, product link, selected evidence and capture time; retain a last-checked score and distinguish it from a fresh score. Support named shortlists and sending saved items into comparison.

Start with user-triggered refresh. Automated price or formulation-change monitoring adds background requests, stale-evidence handling and notification preferences and should be a later decision. Optional account sync can follow proven demand.

Success criterion: saved choices survive cache housekeeping, and a shopper can return to a shortlist with clear freshness indicators.

### 9. First-run learning and settings-impact preview

[welcome.js](../src/options/welcome.js) already adapts setup steps to a selected detail level. Preserve that structure. Add a short interactive example showing a readable label, its biggest score contributors, separate warnings, and what changes when one goal is selected. Give the shopper a direct path to a first real score.

In Settings, preview the effect of a pending goal/weight change on a few saved products. Label missing evidence and changes to ranking; avoid suggesting a more favorable number means a measured health improvement.

Success criterion: first-time shoppers can identify what the score measures and how to change a goal without adjusting individual weights.

### 10. Purchase insights that lead to decisions

The dashboard already offers source/date/status filters, score drivers, frequent products, recorded/current views, distributions and statistical details. Improve the summary around recurring purchases, repeated warning matches and opportunities to compare an often-purchased product with a saved alternative.

Keep changes in goals, scoring revision and evidence coverage visible when comparing periods. Highlight comparable periods rather than interpreting every movement in the average as improvement. Complete purchase-history localization and verify keyboard/screen-reader use before expanding the statistics further.

Success criterion: a shopper can identify one recurring purchase to review and understand whether a trend reflects different products, different settings or different label coverage. Purchase records remain distinct from consumption.

## Suggested release sequence

1. **Interpretation and first use:** consistent evidence summaries, worked onboarding example, clearer scoring terminology and store-installation preparation. Run live validation alongside this work.
2. **Shopping decisions:** evidence-backed comparison, explicit constraints, then alternatives within collected results.
3. **Repeat use:** standalone checking and saved shortlists, then actionable purchase summaries.

Move allergen evidence typing earlier if warning-driven shopping is the main use case. Move distribution to the front if the near-term objective is public adoption. These choices should be informed by actual user needs rather than inferred usage.

Defer more store adapters, additional scoring knobs, a full mobile app, and broad background monitoring until the earlier flows demonstrate value. Anonymous product exchange is currently disabled by `SHARED_PRODUCTS_ALLOWED = false` in [prefs.js](../src/engine/db/prefs.js); any future enablement needs verified trust controls rather than treating shared records as established label evidence.

## How to evaluate the roadmap

Use moderated usability sessions and local debug counters first. Any collection from shoppers should follow the project's explicit opt-in approach.

- Installation completion and time to first usable score.
- Correct label/product binding and scoring availability by store/source, with unknown results counted separately.
- Whether shoppers can distinguish preference scores, missing evidence and warning matches.
- Comparison completion and whether the shopper understands the stated tradeoff.
- Return use of saved products and shortlists.
- Support reports per completed shopping flow and recurring retailer failures.

Do not use higher average scores as the primary success measure: changing preferences or losing label coverage can move that number without improving decisions.

## Verification performed for this review

- Reviewed current source, feature documentation, scoring/evidence records, installation instructions and the October 25 audit integration.
- `npm test`: **1,236 passed**, zero failures, cancellations or skipped tests (1,207 parallel and 29 serial).
- `npm run preflight`: passed, including manifest/script inventory and English/German locale checks.
- No fresh live-retailer, signed-in account, independent scoring-calibration or browser usability validation was performed.
- Application behavior was not changed; this document is the review artifact.
