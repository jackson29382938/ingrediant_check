# Current validation

Source version: **1.19.2**. This maintenance release bounds unit-price parsing on long numeric
input and refuses fluid unit prices when pack and item counts conflict. See
[1.19.2 release notes](releases/1.19.2.md). The scoring rules and score revision are unchanged.

## Checks run on 1.19.2

| Check | Result |
| --- | --- |
| `npm test` | 1,261 passed (1,232 parallel and 29 serial); zero failed or skipped |
| `npm run lint` | Passed with `--max-warnings 0` |
| `npm run preflight` | Passed: manifest, scripts, 660 English/German locale messages and release-note checks |
| `npm run pack` | Chrome and Firefox 1.19.2 packages built, about 3.9 MB each |
| Chromium harness | All content/UI scenarios passed in `HARNESS_CONTENT_ONLY=1` mode; full unpacked-extension smoke timed out waiting for the service worker in installed Chrome |

The unit-price hostile-input regression completes in about 33 ms locally against its 400 ms limit.
Fixture coverage and automated tests establish implementation behavior; they do not prove live
retailer coverage or independent nutrition/health-score accuracy.

## Live retailer smoke checks

The unpacked extension was exercised on public pages in Playwright Chromium on 2026-10-30. These
were smoke tests, not exhaustive journeys; no accounts were used and no bot challenge was bypassed.

- Product scores appeared on Target, Safeway, Albertsons and Instacart; Instacart search also showed
  numeric score badges.
- Amazon returned HTTP 503 for search and no score panel on the attempted product page.
- Walmart showed a “Robot or human?” challenge; the test stopped there.
- Costco search did not yield a verified score. The previous checker could select an unrelated
  product when no scored result existed; 1.19.2 now requires an oat-related result before using a
  Costco search link as its product sample. A direct public product route still needs live recheck.
- Kroger, Dillons, Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC and Harris Teeter failed
  navigation with `ERR_HTTP2_PROTOCOL_ERROR` in this environment.

The 15-retailer fixture harness is controlled test data, not live-site validation. Store layouts,
anti-bot responses and network access can change; blocked checks are not counted as successful.

## External evidence still required

- Independent nutrition or dietitian review against packaging-verified, held-out labels and a
  predeclared rubric. The scoring corpus and passing tests do not establish clinical validity.
- Live checks for retailers blocked by transport errors or bot challenges, and a Costco product
  route that exposes a readable ingredient label.
- Deployment owner verification of Apps Script properties. The checked-in template keeps shared
  product reads/writes closed unless `PRODUCTS_OPEN=true`; the deployed setting and sheet were not
  accessible during this review.
- Browser-store publication and Mozilla signing remain publisher actions.

## Historical baseline

The prior 1.18.1 verification record is retained in
[the 1.18.1 release notes](releases/1.18.1.md) and dated audits. Those results are not the current
1.19.2 verification.
