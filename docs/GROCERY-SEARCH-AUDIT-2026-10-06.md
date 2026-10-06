# Remaining grocery banners — October 6, 2026

After the [bottom-five batch](BOTTOM-FIVE-AUDIT-2026-10-06.md) passed and was pushed as `2f64922`, the same search fixes were checked for Kroger, Fry’s, Ralphs, King Soopers, Smith’s and Fred Meyer. The five stores assigned to the other program—Amazon, Target, Walmart, Costco and Instacart—retain their existing adapters/pipelines.

The enhancement now lives in `src/stores/grocery-pages.js`. All eleven grocery banners use actual same-origin result URLs, avoid truncated title links and recognize numbered product cards. All nine Kroger-family banners receive the content script on both `/search` and `/search/`. Their existing ingredient, allergen and exact-nutrition reader remains intact.

## Fresh public checks

TLS-verified public GETs were made for Doritos UPC 0002840051646 and `search?query=chips`, without account cookies or internal APIs. All twelve requests returned HTTP 200; rendered data availability differed:

| Store | Product initial HTML | Search initial HTML |
| --- | --- | --- |
| Kroger | Readable title, ingredients and nutrition | 24 product cards |
| Fry’s | Readable title, ingredients and nutrition | 27 product cards |
| Ralphs | Readable title, ingredients and nutrition | 25 product cards |
| King Soopers | Readable title, ingredients and nutrition | Unrendered shell |
| Smith’s | Unrendered shell | No DOM product links; public hydration refers to results |
| Fred Meyer | Unrendered shell | No DOM product links; public hydration refers to results |

Actual parsed cards on Kroger, Fry’s and Ralphs all mount badges outside the title links and preserve their product/fulfillment URLs. An HTTP 200 response or a hydration reference is not evidence of a readable ingredient declaration. No scores are fabricated from those shells.

## Verification

Nineteen additional Node checks cover the six banners' route injection, actual URLs, card placement, known ingredient/nutrition declarations, stale canonicals, recycled identities and isolation of the separately maintained stores. The actual unpacked-extension Chrome harness repeats cold-cache/cached search, appended results, SPA navigation, label changes, recycled cards and missing-label checks for each banner. Existing bottom-five and all other browser regressions remain included.

These controlled browser checks establish extension behavior against the exercised markup. Direct live Chrome checks remain blocked by the environment's certificate trust, as recorded in the bottom-five audit. All grocery banners remain previews. Readable published labels are required for numerical scores, and the configured request budget still applies.

## Direct-product lifecycle follow-up

After 1.8.1, a Chrome test reproduced a disappearing panel: load a product directly, let its score settle, then remove the injected panel as a client renderer can during hydration. The unchanged label fingerprint prevented restoration. Version 1.8.2 adds an adapter opt-in used by these eleven grocery banners, with direct-product/remount coverage in each browser case and a Node lifecycle regression. The separately maintained adapters do not opt in. An older captured nutrition fixture was cleaned of executable/tracking scripts and nested document shells, with a sanitization regression. The full suite now has 967 passing tests.
