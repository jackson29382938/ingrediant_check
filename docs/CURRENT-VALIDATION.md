# Current validation

The current source is **1.19.0**, built on **1.18.1** (commit `4229bf9`). It reworks how personal-care products are read, rated and shown: deodorants that were skipped are rated, the evidence index separates labels instead of reading 80 or 70, and an index is worded, colored and explained like a food score, with a hover card and a panel where a food's is. See [what changed](releases/1.19.0.md), [personal-care and supplement indices](PERSONAL-CARE.md), [scoring sensitivity](SCORING-SENSITIVITY.md) and [accuracy evidence](ACCURACY.md). Older dated audits describe the source at the time of that review.

Executed on the final 1.19.0 source:

| Check | Result |
| --- | --- |
| `npm test` | 1,245 passed (1,216 in parallel, 29 timing-sensitive tests run alone); zero failed or skipped |
| ESLint with `--max-warnings 0` | Passed |
| `npm run preflight` | Passed (manifest, scripts, 573 locale keys in English and German) |
| Chromium extension harness (`npm run harness:ci`) | Passed: 44 checks against the preinstalled Chromium with no Amazon network and no page errors, including the real unpacked extension on saved Amazon pages. The personal-care scenario now loads a deodorant product page laid out like Amazon's beauty pages (panel position, band color, verdict, caption) and a search page of three deodorants (three different scores, none "?", the hover card opens) |
| Website responsive/theme/header checks (`npm run website:check`) | Passed |
| Chrome and Firefox ZIP packaging | Both 1.19.0 packages built, about 3.9 MB each |
| Mozilla `web-ext` 10 package validation | Zero errors, warnings or notices |

The Firefox extension harness runs in CI (it needs Firefox and geckodriver downloads) and was not run in the environment that prepared this release.

Calibration: the score, verdict, NOVA class and every row of all 61 calibration entries (54 products and 7 regression cases) were compared with 1.18.1 and are identical, so no food score moves. The personal-care labels used in the tests are example labels typed from published formulas; their before-and-after scores are in the release notes. Supplement arithmetic is unchanged; its verdict words and colors now follow the bands.

Browser retailer pages, OCR labels, certification replies and account/backend responses in the harness are controlled fixtures. Real Google consent, the live Amazon and retailer pages (including where the panel lands on a real beauty page, which rests on Amazon's element ids and the saved-page fixtures), live retailer freshness, signed Mozilla publication, backend deployment, native-speaker review of the German catalog, independent health-score calibration and a live re-check of the supplement upper limits and cautions against the National Academies, NIH and FDA pages remain separate evidence requirements. The shared-database script (`docs/apps-script.gs`) is deployed by hand and was not deployed by this release.

For backend load decisions, use request `ms`, `lockWaitMs`, `lockHeldMs`, busy rates and sheet sizes. The template retains Sheets storage and atomic history deletion/merging; migrate to indexed storage only when measured load warrants it.
