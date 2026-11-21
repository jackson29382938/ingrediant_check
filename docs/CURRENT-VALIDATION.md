# Current validation

**Source version** 1.28.2. The [codebase audit](AUDIT-2026-11-21-FULL.md) records the 1.27.0
baseline, fixes and regression coverage. The scoring revision stays `2026-11-20.1`.

## Automated verification

- The Node suite covers score arithmetic, parser invariants, consent, cache/state transitions,
  purchase-history replay, and the Apps Script relay. The engine coverage run also enforces its
  line, branch, and function floors.
- Browser fixtures exercise the unpacked extension, including keyboard navigation, shortlist
  export and final-slot concurrency, OCR review, carts, purchase history, and the retailer
  sort controls. The website check covers navigation and both themes at mobile and desktop sizes.
- Both browser packages build from the same source. Preflight checks the manifest, locale keys,
  vendor assets and schema alignment. Firefox packaging passes WebExtension lint.

## Live-site and service evidence

- Three prior package images were rerun in unpacked Chromium after their SHA-256 digests were
  matched to the original audit. The noodle photo highlighted the uncertain `SO¥` transcription
  and showed soy, peanut and sesame after correction. The French biscuit photo without a detected
  heading stayed unscored. The bilingual crisps photo kept the wheat advisory and omitted the
  duplicate ingredient list.
- The November 21 signed-out spot check loaded Target search over HTTP 200 without numeric
  badges. Its direct oat product page matched and scored. Both the Walmart search and direct
  product sample returned challenge pages. The tool recorded them as blocked despite HTTP 200.
- [November 20 live audit](AUDIT-2026-11-20.md) records scored Target and Walmart samples.
  Amazon returned 503 and Instacart search returned 403. These checks were run against the
  previous source and should not be counted as new-release coverage.
- [November 16 evidence](audit-evidence-2026-11-16/README.md) contains the 16-retailer matrix,
  OCR source photos and results, accessibility scan, and backend responses.
- Public, signed-in, and consent-gated paths have different coverage. The fixture suite uses
  synthetic orders and intercepted store pages. Apps Script changes are verified against the
  checked-in template and take effect on the shared backend only after its owner deploys it.
- Source records and OCR should be compared with packaging where an exact ingredient or
  allergen finding matters. This release supplies implementation checks and makes no new
  claims of independent score validation.
