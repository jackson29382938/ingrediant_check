# Current validation

The working patch is **1.16.1 (unreleased)**, based on published **1.16.0**, commit `fef8828`.

See [patch behavior and compatibility](releases/1.16.1.md), [scoring sensitivity](SCORING-SENSITIVITY.md), and [accuracy evidence](ACCURACY.md). Older dated audits describe the source at the time of that review, not the current defect status or defaults.

The implementation preserves the 1.16.0 shared readability gate, ingredient-share weighting and allergen-line handling. It corrects the remaining parser, nutrition, sourcing/persistence and settings-read issues from the October review. The verification script at `docs/review-verification-2026-10-18.cjs` now checks the corrected contracts.

Executed on the final patch source:

| Check | Result |
| --- | --- |
| `npm test` | 1,137 passed; zero failed or skipped |
| ESLint with `--max-warnings 0` | Passed |
| `npm run preflight` | Passed |
| Chromium 153 extension harness | Passed, including extension pages, settings, Amazon + 15 retailer previews, cart, recall, history and appearance |
| Firefox 157.0.1 extension harness | Passed, including startup, OCR lifecycle, Settings, Compare, Amazon + 15 retailer product/search/cart flows |
| Targeted Chromium review checks | Passed: incomplete readings declined, nested-code scores agree, enriched display/input replay both 99 |
| Website responsive/theme/header checks | Passed on local production-header fixtures |
| Chrome and Firefox ZIP packaging | Both 1.16.1 packages built, approximately 3.9 MB each |
| Mozilla `web-ext` 10 package validation | Zero errors, warnings or notices |

The one Firefox inactive-page lifecycle diagnostic was classified by the existing verified 1.16.0 allowlist; no new diagnostic was broadly suppressed. The previously reported OCR click timeout did not occur in these runs. A distinct delayed-read checkbox race is now covered by a deterministic regression test and fixed; its relationship to that earlier CI timeout is unproven.

Browser retailer pages, OCR labels, certification replies and account/backend responses in the harness are controlled fixtures. Real Google consent, live retailer freshness, signed Mozilla publication, backend deployment and independent health-score calibration remain separate evidence requirements. No release, store publication or backend deployment was performed.

For backend load decisions, use request `ms`, `lockWaitMs`, `lockHeldMs`, busy rates and sheet sizes. The template retains Sheets storage and atomic history deletion/merging; migrate to indexed storage only when measured load warrants it.
