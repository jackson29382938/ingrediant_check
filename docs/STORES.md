# Stores

Where Ingredient Check runs, what is planned, and what has been checked. `src/stores/registry.js`
holds the same list; `tests/stores.test.js` fails if this page, the registry and `manifest.json`
disagree.

A store is **supported** only after its product page and its search results have been checked in a
real browser on the live site. Tests against saved HTML do not count, and neither does a local
harness.

## Status

| Store | Status | Implemented | Automated checks | Live checked | Notes |
|---|---|---|---|---|---|
| Amazon | supported | yes | pass (`npm test`, `npm run harness:ci`) | amazon.com product and search pages, 2026-09-05 ([history/LIVE-TEST-2026-09-05.md](history/LIVE-TEST-2026-09-05.md)) | Only amazon.com has been live checked. The other 20 Amazon stores share its code and markup but were not checked one by one. Label-photo OCR after the `web_accessible_resources` change has not been rechecked live ([VERIFY.md](VERIFY.md)). |
| Target | planned | no | — | **blocked** 2026-09-25 | Not available. No permission, no content script. |
| Walmart | planned | no | — | **blocked** 2026-09-25 | Not available. No permission, no content script. |
| Costco | planned | no | — | **blocked** 2026-09-25 | Not available. No permission, no content script. |

### Why Target, Walmart and Costco are blocked

Work on these three starts with inspecting each store's current public product and search pages,
to see what can be read without a login and without getting past any bot check. On 2026-09-25 that
could not be done. The environment the work ran in could not reach target.com, walmart.com or
costco.com: its network policy refused the direct connection and the fetch tool alike, and
web.archive.org was refused too. A web search did return current page addresses:

| Store | Product page (seen in search results) | Search page |
|---|---|---|
| Target | `target.com/p/<name>/-/A-<TCIN>` | `target.com/s/<words>` (seen) |
| Walmart | `walmart.com/ip/<name>/<item id>` | not confirmed |
| Costco | `costco.com/p/-/<name>/<item number>`, and the older `costco.com/<name>.product.<item number>.html` | not confirmed |

The addresses say nothing about whether a page shows its ingredient list without a login, where the
list sits in the page, or whether the store challenges automated or background requests. Those
three things decide whether an adapter can work, so no adapter was written from guesses.

Two retailer-specific points are already clear:

- **Costco** runs Same-Day grocery on a separate site (`sameday.costco.com`) operated with
  Instacart. That is a different page structure and a different company, and would need its own
  adapter.
- **Walmart** and **Costco** are generally known to challenge automated traffic. That was not
  observed here, because neither site could be reached. Automatic rating of search results (Amazon's
  **Rate every search result**) fetches product pages in the background. If a store challenges those
  requests, that store gets scores only for products the reader opens. The extension will never
  work around a challenge.

### What is needed to continue

1. Open these pages in your own Chrome, signed out, and save each one (*Save page as… → Webpage,
   HTML only*): one grocery product with an ingredient list, one without, one non-food product, and
   one grocery search. Do this for each store.
2. Or run this work again from an environment that can reach the three sites.
3. Then, for each store: an adapter with its own URL matching, product id, ingredient extraction and
   search tiles; sanitized fixtures and tests; host permissions for that store's product and search
   pages only. See *Adding a store* below.

## Request a store

Settings → **Stores** lists the table above and has a **Request a store** form. It makes an email
draft to the maintainer with the store name and, optionally, the store's website (cut down to the
site address). The reader's email app opens the draft; nothing is sent until they press Send. See
[PRIVACY.md](PRIVACY.md).

## Adding a store

Each store gets its own adapter: URL matching, the product id, ingredient extraction and search
tiles, kept apart from the other stores. There is no universal page reader. For each store:

- Read only what a signed-out visitor sees. Never get past a CAPTCHA, a login, a bot check or any
  other access control. If a store blocks reading, it stays planned and this page says why.
- Add host permissions and content-script matches for that store's product and search pages only.
  Adding host permissions to an installed extension makes Chrome disable it until the user accepts
  the new permissions. Consider asking for a new store at runtime (`optional_host_permissions`)
  instead of at install.
- Add sanitized fixtures under `tests/pages/` covering a product with a list, one without, a non-food
  product, a search page, and a known layout change. Add focused extraction tests.
- Scoring stays local. Say in the popup, settings and [PRIVACY.md](PRIVACY.md) what the adapter
  fetches from that store and with which session.
- Change the store's row here with a date for each step: implemented, automated checks passed,
  live checked, or blocked.
