# Search ratings and grocery expansion audit — October 4, 2026

## Cause and correction

The non-Amazon shared runner intentionally read only cached search scores, so a first visit to Target chips or Walmart search had no health badges. Version 1.6.0 adds signed-out public same-origin product-page reads, triggered by the existing automatic-rating setting. Product identity and declared ingredient coverage are checked before local scoring/cache writes. Every detected eligible card receives a numeric score or an explicit checking/unavailable/open-to-rate state. Search routes keep observing hydration and recycled cards.

The renderer previously prepended a badge as a direct Costco card child, altering its grid/flex layout. Adapters now identify title anchors; image-only cards request an absolute corner badge. Costco product panels use the outer product-description block. Shadow styles isolate badge appearance. A Chromium geometry assertion checks unchanged image-only card height.

## Added stores

Twelve public product/search adapters: Instacart, Kroger, Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC, Harris Teeter, Dillons, Safeway and Albertsons. All are registered in content scripts, settings, popup product detection, toolbar message allowlisting and report-page eligibility. Private account/cart/checkout routes are not included. No new broad host permissions or worker network messages are granted.

## Public-page observations

- Target’s ordinary GET of `/p/-/A-16600402` returned HTTP200. Its exact core product module/matching child declares POTATOES, AVOCADO OIL, SEA SALT, sodium120mg and a 1oz serving. The sanitized ingredient/nutrition model is committed as a regression fixture. The HTML also references CAPTCHA tooling; that alone is not treated as a challenge when a normal public declaration is present.
- All nine Kroger-family public `/p/item/0003000001020` requests returned HTTP200. Each adapter independently extracted Whole Grain Rolled Oats, Contains Oats, protein5g and serving40g. The sanitized observed nutrition markup is committed; raw pages are not.
- Walmart’s ordinary search markup uses role-group cards with absolutely positioned overlay links and separate product-title spans. The adapter binds the visible title to the same product instead of inserting UI in an overlay link or borrowing from the whole item grid.
- Costco’s ordinary legacy public route for coffee ID100493931 returned HTTP200 and retained the exact ID through its canonical redirect. Initial pages lack usable declarations; nothing is inferred from the product name.
- Instacart sample169289 redirected to a nonfood brew-bag page. Safeway and Albertsons sample184710125 returned HTTP200 but no visible product title/declaration. Their route, visible-label and missing-label behaviors have controlled tests; complete live shopping/search support remains unverified.

## Limits and data behavior

Public requests omit cookies. They use no private/internal retailer API, do not execute fetched scripts and stop on recognized challenges or rate-limit responses. Two run concurrently, with a 15-second timeout, an 8MiB response bound and the existing speed budget of20–60 requests per search route. Disabling automatic rating retains local cached scores and open-to-rate statuses; disabling badges/master pause removes badges and aborts work.

Readable ingredients are required for a score. Unpublished declarations, location-dependent hydration, protected pages and results beyond the budget remain unscored. Missing nutrition stays unknown. Advisory warnings remain separate from numeric scoring, including negated allergen claims. No preview product readings go to Google, the shared database or diagnostics. Chrome may request approval of new content-script sites on update.

## Checks

All 807 Node tests, lint, preflight and packaging validate the integrated release. Chrome fixtures cover all fifteen non-Amazon adapters: uncached and cached search scores, product scoring, late label hydration, toolbar messages and protected badge layout. Existing Amazon, setup/profile backup, keyboard, light/dark contrast and OCR smoke checks remain included. GitHub CI runs Node20/22 plus the same browser harness on the release commit. Fixture checks and public GET evidence are distinguished from full live browser validation; every new store remains marked Preview.
