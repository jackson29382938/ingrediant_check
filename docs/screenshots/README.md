# README screenshots

The first three images were captured on 2026-10-19 from commit `a242330`; seven additional
views were captured on 2026-10-20 (UTC) from commit `bb8792d`. Both use extension version 1.17.1,
Chromium and Playwright. These are demonstration screenshots, not live retailer coverage evidence.
External HTTP(S) requests were blocked during capture; no private shopping or account data was used.

| Image | Source |
|---|---|
| `ingredient-score.png` | `tests/harness.html`, potato-chip fixture in `tests/harness-fixtures.json`, real extraction/scoring/panel code, balanced defaults, score panel expanded |
| `personalized-setup.png` | Real unpacked extension's `src/options/welcome.html`, goals step, Whole-food focused selected |
| `purchase-trends.png` | Real unpacked extension's `src/options/history.html`, 45 synthetic purchased product entries across 15 order groups in May–September 2026, six illustrative labels scored with the current engine |


| Additional image | Source |
|---|---|
| `allergen-warnings.png` | Real setup, warnings step, first allergen selected for illustration |
| `avoid-list.png` | Real setup, avoid step, `palm oil, natural flavors` entered and two-entry count verified |
| `scoring-weights.png` | Real Settings, Everything level, category filter set to `sugar` |
| `label-reading.png` | Real Settings, label-photo OCR and barcode lookup controls |
| `search-sorting.png` | Real Settings, score/unit-price sorting and comparison options |
| `cache-and-speed.png` | Real Settings, cache freshness, reuse and request pace controls |
| `appearance.png` | Real Settings, dark theme and colour-blind-safe score palette selected |

All 10 README images link to their original PNG. HTML width and height attributes set bounded,
proportional previews: the three feature images are at most 520 × 350 px, and gallery images at
most 330 × 270 px. No image is stretched or cropped to force an aspect ratio. These are demo
preferences in disposable profiles, not changes to the extension's defaults.

The purchase chart shows recorded scores under balanced settings. Product entries are not purchased
quantities. Goal selection shown in the separate setup screenshot does not describe the chart's
scoring profile. No Google sign-in, sync or real order scanning was performed for these images.

To refresh these assets, run the existing local harness server (`npm run harness`), load the unpacked
extension in a disposable Chromium profile, and capture the same UI states. Seed only synthetic
purchase records through that temporary profile's local storage. Keep screenshots free of addresses,
order numbers, payment information and real account details. Review image captions when the UI or
scoring engine changes.
