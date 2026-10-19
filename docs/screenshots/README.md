# README screenshots

Captured on 2026-10-19 from the extension UI at commit `a242330` (version 1.17.1), using
Chromium and Playwright. These are demonstration screenshots, not live retailer coverage evidence.
External HTTP(S) requests were blocked during capture; no private shopping or account data was used.

| Image | Source |
|---|---|
| `ingredient-score.png` | `tests/harness.html`, potato-chip fixture in `tests/harness-fixtures.json`, real extraction/scoring/panel code, balanced defaults, score panel expanded |
| `personalized-setup.png` | Real unpacked extension's `src/options/welcome.html`, goals step, Whole-food focused selected |
| `purchase-trends.png` | Real unpacked extension's `src/options/history.html`, 45 synthetic purchased product entries across 15 order groups in May–September 2026, six illustrative labels scored with the current engine |

The purchase chart shows recorded scores under balanced settings. Product entries are not purchased
quantities. Goal selection shown in the separate setup screenshot does not describe the chart's
scoring profile. No Google sign-in, sync or real order scanning was performed for these images.

To refresh these assets, run the existing local harness server (`npm run harness`), load the unpacked
extension in a disposable Chromium profile, and capture the same UI states. Seed only synthetic
purchase records through that temporary profile's local storage. Keep screenshots free of addresses,
order numbers, payment information and real account details. Review image captions when the UI or
scoring engine changes.
