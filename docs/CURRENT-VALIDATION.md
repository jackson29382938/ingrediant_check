# Current validation

The current source is **1.19.0**. See [the feature integration and verification record](FEATURE-INTEGRATION-2026-10-30.md)
and [release notes](releases/1.19.0.md) for Orders scores independent of history saving, the compact
history overview, evidence summaries, comparisons, filters, standalone label checking and local
shortlists. Both browser packages are prepared; browser-store publication and Mozilla signing
remain separate publisher actions.

## Previous release baseline — 1.18.1

The previous **1.18.1** baseline was built on published **1.18.0** (commit `7deb375`). It combined the scoring review, parser and shared-database fixes, and the new icon. See [what changed](releases/1.18.1.md), [scoring sensitivity](SCORING-SENSITIVITY.md), [personal-care and supplement indices](PERSONAL-CARE.md) and [accuracy evidence](ACCURACY.md). Older dated audits describe the source at the time of that review.

Executed on the final 1.18.1 source:

| Check | Result |
| --- | --- |
| `npm test` | 1,236 passed (1,207 in parallel, 29 timing-sensitive tests run alone); zero failed or skipped |
| ESLint with `--max-warnings 0` | Passed |
| `npm run preflight` | Passed (manifest, scripts, 573 locale keys in English and German) |
| Chromium extension harness (`npm run harness:ci`) | Passed: 44 checks against the preinstalled Chromium with no Amazon network and no page errors, including the real unpacked extension on saved Amazon pages |
| Website responsive/theme/header checks (`npm run website:check`) | Passed (pages, navigation, privacy, light and dark at 390 and 1280 px, production headers) |
| Chrome and Firefox ZIP packaging | Both 1.18.1 packages built, about 3.9 MB each |
| Mozilla `web-ext` 10 package validation | Zero errors, warnings or notices |

The Firefox extension harness runs in CI (it needs Firefox and geckodriver downloads) and was not run in the environment that prepared this release.

Calibration: the default score of every one of the 61 corpus products was compared with 1.18.0. Five move (kefir 91 to 89, bone broth 88 to 74, deli turkey 40 to 29, uncured bacon 38 to 24, Medjool dates 95 to 98), each for the stated reason in the release notes, and two calibration bands widen (bone broth 80–100 to 70–100, uncured bacon 30–65 to 20–65). The other 56 are unchanged. Twenty-nine real personal-care and supplement label formats (antiperspirant, deodorant, toothpaste, mouthwash, shampoo, conditioner, soap, moisturizer, supplements) score identically in both styles on 1.18.0 and 1.18.1.

Browser retailer pages, OCR labels, certification replies and account/backend responses in the harness are controlled fixtures. Real Google consent, live retailer freshness, signed Mozilla publication, backend deployment, native-speaker review of the German catalog, independent health-score calibration and a live re-check of the supplement upper limits and cautions against the National Academies, NIH and FDA pages remain separate evidence requirements. The shared-database script (`docs/apps-script.gs`) is deployed by hand and was not deployed by this release.

For backend load decisions, use request `ms`, `lockWaitMs`, `lockHeldMs`, busy rates and sheet sizes. The template retains Sheets storage and atomic history deletion/merging; migrate to indexed storage only when measured load warrants it.
