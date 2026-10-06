# Remaining six grocery banners — live audit, October 6, 2026

The pasted follow-up left Kroger, Fry's, Ralphs, King Soopers, Smith's and Fred Meyer without live browser checks. Those checks have now been attempted with the combined `e64b658` main-branch fixes and the pending 1.8.3 fixes. All eleven grocery-banner fixture scenarios remain covered by the full Chrome harness.

The live run used signed-out Chrome 153, the unpacked extension, the configured cloud HTTP proxy and the user-approved platform CA. TLS verification stayed enabled. Search used `organic rolled oats`; product checks chose an actual numeric-scored result when available, otherwise the real Quaker oats UPC `0003000001020`. No bot check, account login or private store API was used.

| Store | Search observation | Product observation |
|---|---|---|
| Kroger | HTTP 200; 16 numeric scores among 24 badges | HTTP 200; Bob's Red Mill oats `0003997803375` scored (96) |
| Fry's | HTTP 503, cloud proxy tunnel failure; no results to inspect | HTTP 503, cloud proxy tunnel failure |
| Ralphs | HTTP 503, cloud proxy tunnel failure; no results to inspect | HTTP 503, cloud proxy tunnel failure |
| King Soopers | HTTP 200; 19 numeric scores among 25 badges | HTTP 200; Bob's Red Mill oats `0003997803375` scored; a separate recheck kept its title and scored panel present at all six observations over 18 seconds |
| Smith's | HTTP 503, cloud proxy tunnel failure; no results to inspect | HTTP 200; Quaker oats `0003000001020` scored |
| Fred Meyer | HTTP 503, cloud proxy tunnel failure; no results to inspect | HTTP 503, cloud proxy tunnel failure |

Screenshots of the failed public requests showed the platform's `upstream connect error` and `envoy://cloudflare_https_tunnel/` transport error. These do not establish retailer bot protection or an extension parsing defect. The same intermittent connection failure affected GitHub requests. A later screenshot in the initial King Soopers check had an empty product area, so the product was checked again with the extension disabled and enabled. Both returned HTTP 200 and kept the product title visible at six observations over 18 seconds; the extension-enabled run also kept a scored panel at every observation. React hydration errors occurred in the extension-disabled baseline too. No extension rendering regression was reproduced. The stores retain preview status and failed live cases remain incomplete.

The earlier Safeway/Albertsons skip-link fix and rendered-content/modal fix from `e64b658` were retained when integrating the pending Walmart panel recovery and Instacart query fix. The live-check script now gives all six banners known food-product fallbacks, saves its report after every visited page, logs numeric scores and panel state, and distinguishes proxy transport failure or HTTP errors from successful navigation. This prevents an HTTP 503 page from being reported as `ok`.

Validation on the combined application code: all 974 Node tests, zero-warning lint and the complete unpacked-extension Chrome harness passed. The harness covers cold/cached search scoring, pagination, SPA navigation, changed labels, recycled cards, badge geometry, removed-panel recovery, settings, profiles and Appearance. Actual website access, location-dependent inventory and unpublished labels cannot be established by these controlled tests. See [STORES.md](STORES.md) and the [first-five proxy audit](PROXY-RETAILER-AUDIT-2026-10-06.md).
