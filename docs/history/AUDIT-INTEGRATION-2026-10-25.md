# Audit integration — October 25, 2026

The nine functional findings in [the audit](AUDIT-2026-10-23.md) have implementation changes:

- Automatic Google saves check the token's profile against the selected account and recheck consent
  and linkage after authentication and before the settings write. Profile/network errors retain retry behavior.
- Local purchase deletion reaches the worker without requiring interactive authentication first;
  remote deletion stays pending when unavailable.
- Recorded order warnings render alongside every breakdown; order dialogs support dark mode.
- Stale badge text is rendered idempotently; saved Amazon badges retain hover eligibility.
- Cache housekeeping retains scores and labels through the configured grace window, subject to its hard cap.
- Retailer tile identities are indexed once per pass; HTTP-200 Press & Hold challenges stop the queue.

Additional changes implement parts of the follow-up recommendations:

- Preview-store score records now retain the local scoring input. Newly captured preview scores can
  show a local breakdown on hover/focus; older scalar-only cache entries need a fresh product read.
  Cart readings also retain inputs. This does not enable sharing or background network reads on hover.
- Purchase sync compares the merged records with the server copy and posts only differences in
  bounded batches. First-recorded ratings, account identity checks and reset epochs remain enforced.
- New purchase snapshots retain bounded source and rule-revision fields. The history table displays the source and supports source filtering. Existing snapshots are
  not reclassified or assigned invented source/confidence values. Backend schema source is updated.
- Website checks decode lazy images on every route, including Features.
- Browser packages have a concise README linking to the complete online guide.
- Future releases include SHA256SUMS and preserve already-published assets/notes on reruns.

## Work that remains separate

These changes do not constitute a complete implementation of every long-term audit recommendation:

- Additional independently reviewed real retailer/label/OCR evidence and signed-in live checks are
  still needed; synthetic fixtures cannot substitute for that evidence.
- The Apps Script source must be deployed by its owner to persist the new optional provenance fields
  remotely. Older deployments still accept records but may discard those fields. Delta sync uses
  the existing history API; an older schema that strips provenance fields can cause those records
  to remain different and be resent until the backend is updated. A server-side account index, batched Sheets writes and production
  1k/5k/10k load measurements remain follow-up work.
- Full purchase-history localization, expanded accessibility verification, confidence-based quality filters,
  and release provenance attestations remain follow-up work. Source metadata is not an OCR accuracy score.
- Permanent Firefox distribution still requires Mozilla signing. No signing credentials are bundled.

No scoring weights or rule semantics were changed, and no release tag was moved.

## Validation

Shared unit/integration tests, pinned ESLint and preflight passed. Real Chromium checks include
keyboard opening/closing of preview-store breakdowns and correct product links across 15 retailer
fixtures, plus search/cart/order/history and saved-score flows. The real Firefox harness passed
against the rebuilt temporary unsigned extension. Firefox package lint reports zero errors,
notices and warnings. The seven-page website check passes at both viewport widths and themes.
All account, retailer and purchase scenarios use controlled fixtures; these are not live sign-in,
clinical-scoring or retailer coverage claims. No GitHub release is cut by this change.
