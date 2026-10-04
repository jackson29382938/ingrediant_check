# Stores

Where Ingredient Check runs, what is planned, and what has been checked. `src/stores/registry.js`
holds the same list; `tests/stores.test.js` fails if this page, the registry and `manifest.json`
disagree.

A store is **supported** only after its product page and its search results have been checked in a
real browser on the live site, in normal use. Tests against saved HTML do not count, and neither does
a local harness. **Preview** means the extension runs there and read the live pages correctly, but
that check is not complete yet.

## Status

| Store | Status | Implemented | Automated checks | Live checked | Notes |
|---|---|---|---|---|---|
| Amazon | supported | yes | pass (`npm test`, `npm run harness:ci`) | amazon.com product and search pages, 2026-09-05 and again 2026-09-25, including label-photo OCR, Open Food Facts and the shared database ([VERIFY.md](VERIFY.md)) | Only amazon.com has been live checked. The other 20 Amazon stores share its code and markup but were not checked one by one. |
| Target | preview | yes, 2026-09-25 (`src/stores/target.js`, `src/content/retailer.js`) | pass (`tests/target.test.js`, `tests/stores.test.js`) | **partly**, 2026-09-25: live product and search pages were read correctly, but behind Target's bot check | See *Target* below. Needs one check in your own Chrome to become supported. |
| Walmart | preview | yes | adapter and identity checks | Public product HTML retrieved 2026-10-04 (HTTP 200), product 10314926 | Current-page embedded ingredient declaration; search shows saved scores only. Live browser validation remains incomplete. |
| Costco | preview | yes | adapter and identity checks | Public product HTML retrieved 2026-10-04 (HTTP 200), product 100423971 | Visible labels only; retrieved initial page had no ingredient declaration. Paste fallback available. Live browser validation remains incomplete. |

## Amazon: sorting by store

The Ingredient Check options in Amazon's *Sort by* menu, and the side-panel list they open, depend on
how each store writes prices and sizes (`src/engine/db/storefronts.js`, `tests/storefronts.test.js`).

| Stores | Sort options | Prices shown | Price per |
|---|---|---|---|
| amazon.com | on (preview: checked on a stand-in menu, not live) | US dollars | ounce / fluid ounce |
| .co.uk, .ie, .ca, .com.au, .sg, .in | on (preview: fixtures only) | £, €, C$, A$, S$, ₹ | 100 g / 100 ml |
| .de, .fr, .es, .it, .nl, .com.be, .se, .pl, .com.tr, .com.br, .com.mx, .co.jp, .ae, .sa | **off** | — | — |

The stores marked off parse prices, unit prices and sizes correctly in the tests, and the menu is
found by its option values in any language, but nobody has looked at their live listings (ratings,
review counts, price markup). Switch one on in `storefronts.js` after the VERIFY.md §7 steps pass
there.

## Target

**What it does.** On a Target product page (`/p/…/-/A-<TCIN>`) it reads the title, the breadcrumbs
and the list under *Label info → Ingredients:*. It runs the food gate and scores the product on your
computer, like Amazon. On a search page (`/s?searchTerm=…`, `/s/<words>`) it puts a score on any
result you have already opened on this computer.

**What it does not do.** It never requests anything from Target or anyone else. There is no
background rating of search results, no shared database, no Open Food Facts and no label photos.
The worker accepts only the toolbar-badge message from a Target tab. It has no host permission for
Target. Its content script is matched only on product (`/p/*`) and search (`/s…`) routes; cart,
checkout, account, order and login pages do not match at all.

**Why search results are not rated automatically.** Target's server HTML does not contain the
ingredient list, only a JSON blob inside a script, and Target runs bot detection on its pages.
Fetching product pages in the background would mean parsing that blob or calling Target's internal
API. Both are brittle, and both are the kind of automated traffic Target challenges.

**Known limits.**

- *Label info* renders nothing until it is opened. Grocery pages opened it by default (oats, chips);
  a shampoo and a supplement page did not. When it is closed, the panel asks you to open it and has a
  button that does. The extension never opens it by itself.
- Fresh produce (bananas) has no label section. The panel says the list is not published and offers
  the paste box.
- What a supplement's label looks like once opened was not seen: Target's bot check stopped the
  inspection before that page could be opened.
- The popup's compare view lists Amazon scores only: `listScores` in `score-cache.js` filters to
  Amazon stores explicitly, so even a Target id that happens to be ten digits long stays out.

**Live check, 2026-09-25.** Chromium 141 with the unpacked extension, fresh profile, signed out, on
live www.target.com:

| Page | Result |
|---|---|
| Boulder Canyon avocado oil chips, `A-16600402` | Panel scored 96 Excellent from *potatoes, avocado oil, sea salt* |
| Good & Gather organic oats, `A-79364857` | Panel scored 95 Excellent |
| Search "organic oats" | The oats tile got a 95 badge from this computer's cache; nothing was fetched |

Target showed its *Quick verification — Press & hold* bot check over the page to this automated
browser the whole time. The page had rendered underneath, and that is what the extension read. The
check was not touched. Because of that, this is not yet a check of normal use, and Target stays
**preview**.

**To make Target supported:** in your own Chrome with the extension loaded, open a Target grocery
product and a Target grocery search. Confirm the panel scores the product, the toolbar shows the
number, and the product's tile on the search page gets a badge. Then change `status` to
`'supported'` in `src/stores/registry.js` and in the table above.

## Walmart and Costco

Historical check (2026-09-25), superseded in part by the October 4 check below.

- **Walmart.** A plain request was redirected to `walmart.com/blocked` ("Robot or human?"). In a
  real Chromium the product page showed *"Activate and hold the button to confirm that you're
  human"*. Nothing behind it was read, and no adapter was written.
- **Costco.** The server HTML carries no ingredient list, only the UI word "Ingredients". In a real
  Chromium, product pages (both `/p/-/<name>/<id>` and the older `.product.<id>.html`) and the search
  page stopped at *"This page couldn't load"*. Costco's page scripts returned 404 and its
  bot-management script was blocked. Costco Same-Day (`sameday.costco.com`, run with Instacart) is a
  separate site and would need its own adapter.

Both results come from a datacenter address with an automated browser, and ordinary shoppers may
not see either block. Full live browser validation remains incomplete, and the extension will
never work around a challenge. To continue, save each page from your own Chrome, signed out
(*Save page as… → Webpage, HTML only*): a grocery product with an ingredient list, one without, a
non-food product and a grocery search. Adapters can then be built and tested from those, and
checked live by you.

## Request a store

Settings → **Stores** lists the table above and has a **Request a store** form. It makes an email
draft to the maintainer with the store name and, optionally, the store's website (cut down to the
site address). The reader's email app opens the draft; nothing is sent until they press Send. See
[PRIVACY.md](PRIVACY.md).

## Adding a store

Each store gets its own adapter, kept apart from the other stores; there is no universal page
reader. Amazon keeps its own pipeline (`src/content/page.js`, `product.js`, `search.js`, `main.js`).
Every other store is one adapter file run by the shared `src/content/retailer.js`.

An adapter (`src/stores/<store>.js`, see `target.js`) registers on `AIR.storeAdapters` and provides:

| Member | Returns |
|---|---|
| `matchesHost(hostname)` | whether this adapter owns the page |
| `productId(url)` | the store's product id, or `''` |
| `isProductPage(location)` / `isSearchPage(location)` | which kind of page this is |
| `searchQuery(location)` | the search words, for the food gate |
| `readProduct(document, location)` | `{ id, title, crumbs, label: 'open' \| 'collapsed' \| 'missing', ingredients, labelText, nutrition }` |
| `labelToggle(document)` | the store's own control that reveals the list, if it hides it (optional) |
| `searchTiles(document)` | `[{ tile, id, title, anchor }]`; `anchor` receives the badge |

Then register it: a `content_scripts` entry in `manifest.json` (engine files, `panel.js`, the adapter,
`retailer.js`), the host in `RETAILER_HOST` in `src/worker/messages.js`, a row in
`src/stores/registry.js` and in the table above. `tests/stores.test.js` checks that they agree.

Amazon's own content-script matches (one pattern per host and path shape, several hundred in all)
are not edited by hand. `AMAZON_HOSTS` and `PATH_PATTERNS` in `scripts/content-matches.mjs` are the
source; `npm run preflight` fails when `manifest.json` differs from what they produce. Edit those
lists, run `node scripts/content-matches.mjs --write` to put the result into the manifest, then run
preflight.

For each store:

- Read only what a signed-out visitor sees. Never get past a CAPTCHA, a login, a bot check or any
  other access control. If a store blocks reading, it stays planned and this page says why.
- Match only that store's host and the product/search routes it needs; keep cart, checkout, account,
  order and login pages out of the content-script matches.
  Prefer a content script over a host permission. Any new host in the manifest, including a
  content-script match, makes Chrome ask existing users to approve it on update.
- Add sanitized fixtures under `tests/pages/` covering a product with a list, one without, a non-food
  product, a search page, and a known layout change. Add focused adapter and runner tests.
- Scoring stays local. The shared runner makes no requests. If a store ever needs one, say what and
  why in the popup, settings and [PRIVACY.md](PRIVACY.md) first.
- Change the store's row here with a date for each step: implemented, automated checks passed,
  live checked, or blocked.

## October 4, 2026 retailer checks

Normal public GET requests returned HTTP 200 for Target product 79364857, Walmart product 10314926, and Costco product 100423971. Target’s initial HTML did not expose its ingredient label. Walmart’s current-product `__NEXT_DATA__` contained `WHOLE GRAIN ROLLED OATS.`; the reader verifies `product.usItemId` against the URL before accepting that declaration. Costco redirected an older oats slug to a protein-bar product with the same numeric ID; its initial nutrition model was empty. These checks establish access and parsing evidence, not complete live browser support. No challenge was bypassed and no internal retailer APIs were called.

All three previews read only pages you open, offer a paste-label fallback, and show previously saved scores on search results. They do not fetch other product pages, share product readings, or call OCR/Google services. Cart, login, account and checkout routes are outside the content-script matches. Missing nutrition stays unknown.

## Parallel audit follow-up

The [October 4 parallel audit](PARALLEL-AUDIT-2026-10-04.md) records fresh public product/search evidence and fixes for all four stores. Target, Walmart and Costco remain previews; successful public responses and fixture-based browser tests do not establish complete live-site support.
