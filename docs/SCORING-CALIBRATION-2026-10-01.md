# Scoring, presets and defaults review — October 1, 2026

Reviewed every score contributor and all 20 presets. The [complete factor inventory](SCORING-FACTOR-INVENTORY-2026-10-01.md)
lists all 45 controls, 173 penalty matchers, 56 ceilings, 15 label signals, seven nutrition factors,
17 certification signals, five non-scoring marketing flags, arithmetic constants and feature defaults.
The three neutral label signals remain recognized but award zero points.

These are configurable ingredient preferences and processing heuristics. Numeric weights and
ceilings describe this model, not measured health effects. Nutrition information, portions, source
quality and real-label validation remain relevant limitations. Scoring does not establish allergen
safety, microbiological safety, calorie needs or clinical outcomes.

## Changes made

| Area | Before | Result |
|---|---|---|
| Refined oils | Default category weight 1; common refined oil ceiling 25 | Default weight 0.5; ceiling 63. Stricter goals remain available. Qualifiers soften only the oil they accompany. |
| Artificial sweeteners | Default category weight 1; ceiling 22 | Default weight 0.5; ceiling 61. Weight-loss preference uses 0.35 and a less punitive processing weight. |
| Dairy | Fat reduction and ordinary treatment could determine processing class; reduced-fat dairy penalized by default | Heat/fat treatment alone no longer votes for processing. Dairy-processing and fat-reduction preferences default to zero. Percentage-labelled and qualified dairy stay recognized. |
| Fortification | Default deduction and a possible hard vote for ultra-processing | Neutral default; added micronutrients alone do not establish ultra-processing. Optional avoidance and Vitamins & minerals rewards remain. |
| Gluten and whole grains | One grain dial penalized refinement and gluten together | Separate optional gluten dial, default zero. Explicit whole-grain flour is exempt from refinement deductions. Refined flour and semolina retain milling preferences. |
| Raw milk, A2 and specialty salt | Automatic quality bonuses | No automatic credit. Salt branding is not a substitute for sodium quantity; raw/A2 wording alone does not establish better quality. |
| Sugar quantity | Sugar presence and quantity could stack; active natural-sugar preferences could count the same fact again | Usable added/total sugar quantity replaces presence deductions. When both quantity dials are active, total sugar counts the remainder. Missing values retain the ingredient fallback. |
| Low-carb | Claimed carbohydrate guidance without a carbohydrate quantity rule | Optional declared carbohydrate rule, used by Low-carb. Text and volume/quantity extraction now carry carbohydrate data. |
| Ingredient count | An extra eight-point raw deduction above 20 items; long whole-food mixtures could become processed by count alone | Removed the separate length deduction and the five-item limit for recognized whole-food mixtures. Ingredient facts and processing signals determine the result. |
| Reward ceilings | Organic credit could lift a product above an ingredient ceiling | Every ingredient ceiling remains binding. Goal, sourcing and organic rewards cannot bypass it. |
| Sourcing evidence | A structured field could promote a weak claim to verified; country-of-origin credit also removed the unknown-sourcing cost | Weak claims stay claims even in structured data. Country of origin earns no automatic quality credit or implied production-method verification. Unknown sourcing is described as uncertainty. |
| Label matching | Common spellings could be missed | Added calcium sulfate/sulphate, wheat gluten, dried egg white, liquid smoke and stevia-extract forms. The added wheat-gluten match now exposes an isolated-protein ingredient previously missed in a sprouted-bread fixture. |
| Explanation text | Some rows asserted extraction methods or health effects not established by the ingredient label | Replaced those explanations with ingredient/function descriptions. The Non-GMO generic bonus now calls itself a claim. |
| Nutrition integrity | Scoring wrote `_normalised` onto the input; beverages treated ml as grams; impossible data could generate rewards | Pure normalization; invalid data cannot produce deductions or rewards. Grams and ml stay distinct, including older cached readings with serving-size text. |
| Goal selection | Duplicate goals could add votes; inherited object names could pass weight checks | Sanitized, deduplicated goal IDs and own-property checks. Existing importance limits and focused-goal behavior remain. |
| Settings precision | Range step 0.1 rounded preset weights such as 0.35 | Exact slider values and readable fractional labels; checked in real Chrome. |

The processing class remains a heuristic rather than a validated NOVA classifier. Its class is
independent of user weights. Remaining oil, additive, grain and sourcing deductions are stated
preferences; they were retained with bounded stacking and explicit user controls rather than
presented as dose-dependent risk estimates.

## Every preset

All 20 preset maps were reviewed for known controls, ranges, signed rewards, descriptions,
relative priorities and actual score behavior. Balanced uses the revised defaults. Whole-food
focused explicitly retains stricter oil and artificial-sweetener preferences. Weight loss uses
measured added sugar when available and a modest reduced-fat-dairy reward. Low-carb now uses
measured carbohydrate. Descriptions no longer promise calorie estimates or individual fueling
requirements. Other presets retain their declared priorities, subject to the same limits.

All 190 pairs of distinct presets, and each preset individually, are exercised against the corpus
for bounded integer scores and exact displayed arithmetic. Each combination also scores all
ceiling witnesses with organic evidence to verify that bonuses cannot bypass a ceiling. Further
checks verify actual protein, carbohydrate, sugar and dairy ordering, focused vitamins preferences,
weighted goal importance, flags and signed rewards.

## Representative score changes

These are model changes on fixed fixtures, not independent nutrition validation:

| Fixture | Previous score | Revised score | Main cause |
|---|---|---|---|
| Live UK granola | 25 | 35 | Less severe oil preference; sugar/flavour deductions remain. |
| Plain seed-oil potato chips | 25 | 63 | Moderate default oil ceiling; stricter presets retain stronger avoidance. |
| Diet soda | 22 | 30 | Moderate sweetener ceiling; flavour/preservative deductions still apply. |
| Sprouted bread with added wheat gluten | 86 | 65 | Previously missed isolated gluten now matches its protein rule. Sprouting does not erase that ingredient. |
| Organic whole milk with vitamin D | 82 | 94 | Neutral fortification and corrected classification behavior. |
| Sea salt | 93 | 90 | Removed specialty-salt credit. |

Existing explicit custom weight values remain stored. Revised defaults fill missing controls;
selecting Balanced applies the new baseline. Existing saved presets may show Custom if their
stored weight values differ from the revised preset. Allergen/diet selections and avoid lists
are preserved. Revision `2026-10-01.1` retires old cached scores, even when weights remain unchanged.

## Defaults retained after review

Local scoring, badges, the food gate, local hover explanations, unit-price calculations and
Chrome profile backup stay on. Search-page fetching, hover fetching, OCR, barcode lookup,
contributions, diagnostics and shared-database lookups stay off until enabled. Shared product
exchange remains closed in this build. Freshness stays Balanced; sort/load-more/display settings
remain as documented in the complete inventory. These settings affect data availability,
freshness and presentation rather than acting as hidden health-score multipliers.

Source confidence and recognition coverage govern whether a reading can be used or displayed;
they do not turn uncertainty into a lower-quality-food score. Allergen, dietary, avoid-list and
hollow-marketing flags remain non-scoring and respect their warning controls.

## Verification

Final validation passed: **633 tests on Node 20.20.2 and Node 24.19.0**, ESLint with zero
warnings, extension preflight, the Chrome 153 browser harness, and ZIP packaging.

Run `npm test`, `npm run preflight`, ESLint, and `npm run harness:ci` with the supported installed
Chromium. `node scripts/scoring-audit.mjs` regenerates the inventory from the actual rule tables.
`tests/scoring-factor-fixtures.json` carries an explicit witness for every penalty, ceiling,
label and certification rule. New/removed rules or changed witnesses require review.

The Chrome harness checks all six extension pages, contrast, narrow windows, layout zoom,
browser accessibility names, keyboard goal tabs, fractional weights, setup persistence, backup
restoration and actual extension scoring on saved retailer pages. Live multilingual evidence is
still limited as recorded in [ACCURACY.md](ACCURACY.md); these changes do not add live-language,
medical or signed-in Google verification.
