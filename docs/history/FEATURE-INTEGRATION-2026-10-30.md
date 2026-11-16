# Feature integration — October 30, 2026

Source version: **1.19.0**. Implements the repository-side work from the feature review and the
requested compact Orders-page interface. Store publication and independently validated live
retailer coverage remain separate from implementation and controlled regression checks.

## Orders-page behavior

The previous early return when `historyEnabled` was false prevented all item badges from being
drawn. Display now works independently of optional purchase saving. With automatic rating off,
valid local readings are shown without new label requests. With it on, public missing-label
requests remain bounded and omit cookies and the order-page referrer. `purchaseImport` is never
sent when import is off or its account does not match. The master pause still stops rating.

The visible overview contains the existing two buttons, an optional 160×38 inline SVG chart and
available period averages. It omits the long explanatory paragraph. Import status remains in a
tooltip. There is no empty chart or placeholder average. Periods use the browser's local
calendar: today, the week starting Monday, and the calendar month. Averages use rated purchased
product entries; missing labels, returns and cancellations are excluded. Account-mismatched
history is not shown. Badges recover when Amazon replaces item markup with unchanged identities.

Changing comparison goals does not trigger another purchase import. Recorded snapshots stay
unchanged, and showing an item score does not create purchase-history records.

## Shopping features

| Area | Implemented behavior |
| --- | --- |
| Evidence | Source, capture date, partial reading and missing selected nutrition data in product panels, local cache metadata, popup comparisons and ranked results; legacy missing metadata remains unknown. |
| Comparisons | Larger local comparison page with warnings, assessed/unassessed information, normalized nutrient amounts, scoring dimensions and principal point contributions. Current-session Amazon prices are included when product/store identity matches. |
| Constraints | Maximum price, minimum score, required label/nutrition evidence and selected warning-match filters before ranking, with an explicit unknown-warning choice and an empty-result explanation. Warning evidence is checked against the current selected warnings; stale checks become unknown instead of being reused. |
| Standalone checking | Pasted ingredients, bounded local photo OCR with text review, optional entered nutrition, and explicit permission-based barcode lookup. Explicit lookup does not enable automatic lookup. |
| Saved products | Local named shortlists independent of expiring caches, product-page Save controls, removal controls, and saving recently compared product evidence. |
| Warning evidence | Current food warnings distinguish ingredient detection, a contains declaration, cross-contact and another advisory. Numerical rules and warning matches are unchanged. |
| Preview goals | Compare saved labels under another goal without changing preferences or saved records. |
| Distribution | Chrome/Firefox packaging plus updated submission copy and privacy descriptions. Publication/signing has not been performed. |
| Retailer reliability | Existing previews retain their documented status; all fifteen remain in the real-browser fixture checks. No new live-site support claim is made. |

## Verification

- Unit/integration suite: **1,247 passed** (1,218 parallel and 29 serial), with no failures or skipped tests.
- Added behavioral checks for absent/current calendar periods, unavailable and excluded ratings,
  evidence constraints, unknown warning handling, mixed allergen declarations, exact label-text
  replay, separate durable storage and the narrow barcode message permission.
- Chromium's new shopping checks exercise actual extension UI/storage, local OCR of a generated
  label, controlled barcode responses, durable named lists, detailed comparisons, read-only goal
  preview, constraints and responsive widths. Orders checks cover import-off score display,
  conditional graphs/averages, item replacement, original import/sync behavior and deletion.
- ESLint with zero warnings and preflight pass, including both locale catalogs.
- Chrome/Firefox 1.19.0 ZIPs build. Mozilla package validation reports zero errors, warnings or notices.
- The existing real Firefox harness passes against the temporary unsigned package, including
  extension pages, local OCR startup/cleanup, Amazon and fifteen retailer fixtures.
- Website checks pass at both viewport widths and themes, including the updated privacy page.

The full Chromium extension harness passed with no page errors. After the final warning-profile
change, the targeted shopping browser suite also passed, including preference-change invalidation
and explicit unknown-warning handling. Retailer, OCR-photo, OAuth and backend scenarios use controlled fixtures. These are not live account, clinical scoring,
independent label-calibration, signing or publication claims. Screenshots are synthetic examples.
