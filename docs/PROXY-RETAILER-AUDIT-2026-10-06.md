# Live retailer checks through the cloud proxy — October 6, 2026

Started at main `0050171`, then fetched and integrated the concurrently published `236e9a0` Instacart/modal fixes before final validation. This audit uses a signed-out Chrome 153 session with the unpacked extension and the environment's configured HTTP proxy. The user authorized importing the platform public CA into Chrome's NSS certificate store. TLS verification remained enabled; no human-verification challenge was solved or bypassed. Cloud certificate trust is not shipped inside the extension.

## Verified results

Counts are observations from individual sessions after a finite scoring wait, not guarantees for all products, locations or future requests. Numeric scores and status badges are counted separately.

| Store | Live search | Live food product |
|---|---|---|
| Amazon | Rolled-oats searches returned HTTP 503; no results were available to score. | Lifeway plain kefir, `B0DX45213W`, scored again with the latest combined code. |
| Target | Chips: 20 numeric scores among 30 badges. Latest combined code, organic rolled oats: 26 numeric scores among 30 badges; HTTP 200, no challenge observed. | Good & Gather oats `79364857` and Oats Overnight starter kit `94894200` scored. |
| Walmart | Latest combined code, chips: 16 numeric scores among 44 badges; HTTP 200, no challenge observed. | Oats `10314926` scored with its panel still present after hydration. |
| Costco | Chips: eight numeric scores among 32 badges after a longer wait. Organic oats: six numeric scores among 26 badges. Other items remained unavailable; the final search request returned HTTP 503 during the cloud connection failure. | Sampled protein bars `100423971` and whole-bean coffee `100493931` had no readable ingredient declaration or Nutritional Facts toggle in this session. Both showed the missing-label/paste fallback after the grace period. |
| Instacart | Latest combined code, `k=organic+rolled+oats`: five numeric scores among 119 badges; HTTP 200, no challenge observed. | Quaker oats `2695935`, Dillons result, scored using the identity-bound public page declaration. |

The original `query=chips` Instacart URL rendered a shopping shell without results; its actual search parameter is `k`. The earlier session loaded the pre-update reader and therefore could not score the declared Instacart ingredients. The final check loaded the new GitHub reader. Both detail and search results above are actual extension states, not inferred from a successful HTTP response.

Not every result can receive a numeric score. Search scans are bounded by the configured speed budget, omit account cookies, and stop when access fails. Missing labels remain unknown. Separate public HTML diagnostics on two Instacart product routes returned an Envoy HTTP 503 tunnel transport failure even though normal browser pages were accessible. GitHub's API and Git endpoint subsequently returned the same cloud connection failure. These transport errors do not establish a retailer access denial. Access to one page/request does not establish access to every product scan. No private retailer APIs, account sign-ins, CAPTCHA solvers, rotating egress or fingerprint changes were used.

## Fixes and verification

Walmart opts into the existing shared runner's recovery when hydration removes a scored panel but leaves the label unchanged. The real Chrome harness now deliberately removes the Walmart panel and confirms that it returns with a numeric score. Instacart's `k` query is passed to the food-category gate, with route/query regressions. The live-check script now uses `HTTPS_PROXY`, recognizes current Costco product routes, chooses a scored food result before unrelated header promotions, includes a known Amazon food fallback, waits for missing-label rendering, and records numeric badge counts.

All 972 Node tests, zero-warning lint and the complete unpacked-extension Chrome harness passed against the integrated code. Harness coverage includes the Walmart removal regression, cold/cached search scans, identity changes, Costco badge geometry, eleven additional grocery banners, settings, profiles, Google setup, Appearance and toolbar colors. These controlled checks are separate from live retailer evidence.

Reusable startup instructions were saved to the cloud environment configuration draft. They preserve the existing isolated checkout and pinned browser, explicitly use the environment proxy, and import the public CA immediately before launching Chrome in the same shell command. Saving that draft does not publish an environment snapshot. Store availability can still vary after certificate trust is fixed; the retailer previews retain their status.
