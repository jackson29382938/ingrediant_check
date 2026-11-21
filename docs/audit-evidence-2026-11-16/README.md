# Audit evidence

Source: Ingredient Check 1.26.4, `893c713b553c2a48b91f02bf3d159407df6ecb80`.
Captured 2026-11-16. See [the audit](../AUDIT-2026-11-16.md) for interpretation and limits.

- `live-stores.json`, `live-banners.json`: real public retailer requests with the unpacked extension;
  `ok` means HTTP access, **not** successful extraction or scoring.
- `live-detail.json`: a second focused Costco visit and a live Target sort-menu action. Includes
  public page text and the actual session result list.
- `backend*.json`: responses from the compiled-in Apps Script endpoint. Invalid credentials are
  deliberately fake. USDA and empty lookup operations are read-style probes; no account data was uploaded.
- `photo-sources.json`: URLs and SHA-256 hashes for eight real packaging photos. Photos and browser
  probe scripts remain at `/workspace/extension-audit/2026-11-16/`. Open Food Facts images are from
  its contributors; source pages provide attribution/licensing. The Amazon photo is a public product image.
- `ocr.json`: shipped Tesseract output and extracted ingredient blocks; confidence is engine output,
  not an independent measure of ingredient or allergen accuracy.
- `ocr-comparison.json`: manual photo transcriptions versus extracted blocks, with empty product
  names and selected allergens held constant. A no-block result has `actual:null`.
- `library-photos.json`: real extension file-upload workflow, followed by Check. Names are filenames;
  therefore a title-sensitive bonus can differ from the empty-name engine comparison. `panel` is
  actual rendered shadow-root text, including its styles. A null panel means no numeric result was shown.
- `extension-ocr.json`: the live Amazon-CDN image through the actual service worker/offscreen host.
- `ai-consent.json`: controlled queued-request reproduction with fake keys and mocked fetches.
- `hover.json`: actual sorted-page events around offscreen-chip hover, then a second hover and focus.
- `axe.json`: axe-core 4.10.3 on eight real extension pages in both themes at 360 px; includes checks
  requiring human review. The history scroll issue is present in both themes.
- Logs record the test suite, coverage, browser harnesses, validation-tool failures and packaging.
  The initial website launch failure was environmental; `website.log` is the passing configured run.
- `reproduction.txt`: output of `node docs/audit-verification-2026-11-16.cjs`.

The audit did not modify extension runtime code or deploy the backend. Production Google-account
round trips, authenticated sheet inspection and published-store installation remain separate checks.
