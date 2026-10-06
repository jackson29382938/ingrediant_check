# Bottom-five grocery checks — October 6, 2026

Baseline: fetched GitHub main at `17f54ed` (1.8.0), including the Appearance review fixes. The bottom five entries in the store registry are QFC, Harris Teeter, Dillons, Safeway and Albertsons. Amazon, Target, Walmart, Costco and Instacart are being worked on separately; their adapters and content pipelines are unchanged.

## Public-page evidence

Ordinary signed-out, TLS-verified public GET requests were used. No internal catalog/account API, challenge bypass, cookie or login was used.

| Store | Product evidence | Search evidence |
| --- | --- | --- |
| QFC | Oats UPC 0003000001020 and Doritos UPC 0002840051646 returned 200 and readable ingredient/nutrition declarations. | `search?query=chips` returned 24 product cards. Their titles use a truncated link inside a numbered `product-card-*` container. |
| Harris Teeter | The sampled oats page returned an unrendered shell; Doritos UPC 0002840051646 returned 200 with a readable declaration. | The sampled search returned an unrendered shell. Dynamic rendering is covered by controlled Chrome tests, not a completed live shopping check. |
| Dillons | Oats and Doritos returned 200 with readable ingredient/nutrition declarations. | `search?query=chips` returned 24 product cards with the numbered/truncated-link layout. |
| Safeway | Valid oats 111050071 and Doritos 960543057 returned 200 and redirected to `/shop/pd/<name>/<id>`. Their public Next Flight declaration contains the exact catalog product and nested nutrition quantities. | The initial search response is a shell; live client-rendered cards remain unverified. |
| Albertsons | The same two valid food IDs returned 200, modern product routes and readable identity-bound public declarations. | The initial search response is a shell; live client-rendered cards remain unverified. |

The older sample ID 184710125 is unavailable in the current Safeway/Albertsons catalog (`numFound: 0`); it is not evidence that valid food labels are absent. Sanitized food declarations and observed QFC/Dillons card structure are saved in `tests/pages/bottom-five/`. Pricing, store configuration, account content and tracking are omitted.

## Fixes

- Modern Safeway/Albertsons named product routes now receive the content script. Public product IDs, canonical links, page wrappers and catalog `id`/`pid` must agree before accepting an embedded declaration.
- Public Next Flight records are parsed as bounded JSON, without executing scripts. Unavailable/mixed products, contradictory declarations, malformed data and unresolved references stay unknown. Only explicit Ingredients/Warnings and nutrition fields are read; marketing and recipe directions do not become ingredients.
- Exact nested nutrient quantities are read, including zeroes, with unit conversion. Missing serving weights, percentage-only fields and conflicting values remain unknown. A changed visible ingredient declaration cannot borrow the old embedded declaration's nutrition/advisories.
- Search requests use the result's actual same-origin product link, preserving its public fulfillment/location context. Modern product cards and title/image duplicates are recognized. Badges mount outside truncated links and cart controls; image-only cards receive a corner badge.
- Trailing-slash Kroger-banner searches are injected. Modern product paths also work with the popup's report-capture gate; private-looking routes remain excluded.

The enhancement is scoped to these five adapters. It does not change the scoring engine, search request limits, sharing settings, Google sign-in or the other program's five stores.

## Automated validation and limits

17 targeted regressions cover actual public declaration schemas, route injection, stale/mixed identities, quantities, malformed/unresolved data, recommendations, hidden labels, card placement and actual request URLs. The full suite includes these tests alongside the existing regressions.

The unpacked-extension Chrome harness checks all five stores: cold-cache and cached search scores, newly inserted results, SPA search/product navigation, product-label changes, recycled result nodes, unavailable labels and unclipped badge geometry. Existing Amazon/retailer/setup/Appearance browser checks remain included. These use captured declarations and controlled layouts, not a claim that every live retailer page works.

Direct live Chrome navigation failed with `ERR_CERT_AUTHORITY_INVALID` for the environment's HTTPS proxy. Automatic approval review rejected adding the environment proxy CA to Chrome's persistent trust store. Certificate verification was not disabled. Public GET evidence remains TLS-verified; direct live Chrome validation is still outstanding.

All five stores remain **preview**. Numerical scores require a readable published label; unavailable declarations and requests beyond the configured page budget retain a visible unavailable/open-to-rate state. This does not establish guaranteed numeric ratings for every food product or every live layout.
