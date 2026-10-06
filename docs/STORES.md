# Stores

Where Ingredient Check runs, what is planned, and what has been checked. `src/stores/registry.js`
holds the same list; `tests/stores.test.js` fails if this page, the registry and `manifest.json`
disagree.

A store is **supported** only after its product page and its search results have been checked in a
real browser on the live site, in normal use. Tests against saved HTML do not count, and neither does
a local harness. **Preview** means a public-page adapter is implemented and tested, while live shopping/browser coverage remains incomplete. Each row states the evidence available.

## Status

| Store | Status | Implemented | Automated checks | Live checked | Notes |
|---|---|---|---|---|---|
| Amazon | supported | yes | pass (`npm test`, `npm run harness:ci`) | amazon.com product and search pages, 2026-09-05 and again 2026-09-25, including label-photo OCR, Open Food Facts and the shared database ([VERIFY.md](VERIFY.md)) | Only amazon.com has been live checked. The other 20 Amazon stores share its code and markup but were not checked one by one. |
| Target | preview | yes, 2026-09-25 (`src/stores/target.js`, `src/content/retailer.js`) | pass (`tests/target.test.js`, `tests/stores.test.js`) | **partly**, 2026-09-25: live product and search pages were read correctly, but behind Target's bot check | See *Target* below. Needs one check in your own Chrome to become supported. |
| Walmart | preview | yes | adapter and identity checks | Public product HTML retrieved 2026-10-04 (HTTP 200), product 10314926 | Current-page embedded ingredient declaration; search can scan public product pages. Live browser validation remains incomplete. |
| Costco | preview | yes | adapter and identity checks | Public product HTML retrieved 2026-10-04 (HTTP 200), product 100423971 | Visible labels only; retrieved initial page had no ingredient declaration. Paste fallback available. Live browser validation remains incomplete. |

| Instacart | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Initial product page retrieved; no usable label | instacart.com; readable public labels scored, missing labels remain unknown. |
| Kroger | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats page ingredients/nutrition read 2026-10-04 | kroger.com; readable public labels scored, missing labels remain unknown. |
| Fry’s | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats page ingredients/nutrition read 2026-10-04 | frysfood.com; readable public labels scored, missing labels remain unknown. |
| Ralphs | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | ralphs.com; readable public labels scored, missing labels remain unknown. |
| King Soopers | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | kingsoopers.com; readable public labels scored, missing labels remain unknown. |
| Smith’s | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | smithsfoodanddrug.com; readable public labels scored, missing labels remain unknown. |
| Fred Meyer | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | fredmeyer.com; readable public labels scored, missing labels remain unknown. |
| QFC | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | qfc.com; readable public labels scored, missing labels remain unknown. |
| Harris Teeter | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | harristeeter.com; readable public labels scored, missing labels remain unknown. |
| Dillons | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | dillons.com; readable public labels scored, missing labels remain unknown. |
| Safeway | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Initial product page retrieved; no usable label | safeway.com; readable public labels scored, missing labels remain unknown. |
| Albertsons | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | albertsons.com; readable public labels scored, missing labels remain unknown. |

## Live check, 2026-10-06 (first five stores)

`npm run live-check -- <store...>` (`scripts/live-check.mjs`) loads the unpacked extension in Chrome for Testing,
signed out, opens each store's live search page and a food product page, and records what the extension did.
It never solves or bypasses a bot check. Results:

| Store | Search results page | Food product page | Notes |
|---|---|---|---|
| Amazon (amazon.com) | 29 score badges on "organic rolled oats" | scored (Bob's Red Mill oats) | Works as documented. |
| Target | **not testable**: "Quick verification, press & hold" appeared over the page for this automated browser | scored (Good & Gather oats, `A-79364857`) | Same bot check as 2026-09-25; search is covered by saved-page tests. |
| Walmart | **not testable**: "Robot or human?" | **not testable**: "Robot or human?" | Public product pages are blocked for automated browsers; covered by saved-page tests only. |
| Costco | 26 badges; 2 scored, the rest "Label unavailable" | "waiting" until the reader opens *Nutritional Facts*, then scored | Costco's bot protection answers repeated plain requests with HTTP 429 (Kasada), so most search scans cannot read labels. The extension stops on it and never retries around it. |
| Instacart | 91 badges with real scores (98, 96, 97) after the fix below | scored (Sprouts organic rolled oats) | Before the fix: the signed-out signup modal marks the page `aria-hidden`, which the adapters read as "hidden", so no panel appeared; and search scans read no labels because Instacart renders the label with scripts. |

Fixed in this check: an `aria-hidden` ancestor no longer hides content that is on screen (`hiddenFromSight` in
`src/stores/label-reader.js`, used by the Instacart, Walmart, Costco and Target readers; saved test pages without layout
keep the old rule), and Instacart's label is read from its page state (`<script id="node-apollo-state">`), bound to the
product id in the URL.

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

**What it does.** Target reads visible ingredient labels or an identity-bound product declaration in the public page’s hydration data. Search badges use saved scores first, then request public same-origin product pages when automatic rating is on. Only the matching TCIN/child variant is accepted; contradictory canonical/product identity stays unknown. Missing labels receive a visible status and can be expanded or pasted on the product page.

**Network behavior.** Retailer previews run two signed-out public-page requests at a time, limited by the existing speed setting to 20–60 per results page. They stop on recognized challenges/rate limits. They do not call internal APIs, execute page scripts, or share product readings. No additional host permission is required: same-origin content-script requests follow ordinary browser origin restrictions. Automatic search rating can be disabled in Settings.

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
- Scoring stays local. Public same-origin search scans are disclosed in the popup, settings and [PRIVACY.md](PRIVACY.md). No internal APIs or account cookies are used.
- Change the store's row here with a date for each step: implemented, automated checks passed,
  live checked, or blocked.

## October 4, 2026 retailer checks

Normal public GET requests returned HTTP 200 for Target product 79364857, Walmart product 10314926, and Costco product 100423971. Target’s initial HTML did not expose its ingredient label. Walmart’s current-product `__NEXT_DATA__` contained `WHOLE GRAIN ROLLED OATS.`; the reader verifies `product.usItemId` against the URL before accepting that declaration. Costco redirected an older oats slug to a protein-bar product with the same numeric ID; its initial nutrition model was empty. These checks establish access and parsing evidence, not complete live browser support. No challenge was bypassed and no internal retailer APIs were called.

The original previews offer paste-label fallback. Version 1.6.0 adds public same-origin scans for uncached search results, while keeping saved-score reuse. They do not share product readings or call OCR/Google services. Cart, login, account and checkout routes are outside the content-script matches. Missing nutrition stays unknown.

## Parallel audit follow-up

The [October 4 parallel audit](PARALLEL-AUDIT-2026-10-04.md) records fresh public product/search evidence and fixes for all four stores. Target, Walmart and Costco remain previews; successful public responses and fixture-based browser tests do not establish complete live-site support.

## Search expansion and placement — October 4, 2026

Version 1.6.0 adds twelve grocery previews and uncached public-page rating on all fifteen non-Amazon retailer adapters. Target chips TCIN16600402 was retrieved by an ordinary GET: the identity-bound core module contains POTATOES, AVOCADO OIL, SEA SALT and nutrient quantities. Ordinary public GETs on all nine Kroger-family banners (Kroger, Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC, Harris Teeter and Dillons) returned HTTP200. Oats UPC0003000001020 exposes Whole Grain Rolled Oats, an allergen declaration and an explicit 40g serving. These are public HTML declarations, not internal API calls. Instacart, Safeway and Albertsons returned HTTP200 but lacked a readable initial declaration in the sampled pages. Their fallbacks have controlled DOM/Chrome tests; they are not claims of complete live shopping support.

Walmart’s public search cards use overlay links beside product-title spans. Costco badges now mount in title content rather than as grid/flex children; image-only cards use an out-of-flow corner badge, and product panels sit outside the title/wishlist row. Badge styles use a shadow root. Cached, first-visit and missing-label results all have a visible state.

Search results depend on published readable declarations. Blocked pages, store/location-dependent hydration, absent labels and results beyond the speed budget cannot receive honest numeric scores; open those products to expand/paste a label. Amazon retains its existing separate search pipeline.

## Bottom-five follow-up — October 6, 2026

The [bottom-five audit](BOTTOM-FIVE-AUDIT-2026-10-06.md) records new public-page evidence and fixes for QFC, Harris Teeter, Dillons, Safeway and Albertsons. Modern Safeway/Albertsons `/shop/pd/<name>/<id>` products and identity-bound public declarations are read; search badges avoid truncated title links and scans preserve actual same-origin result URLs. Chrome fixture tests now cover pagination, cached/cold searches, SPA navigation, changed declarations and recycled cards. Direct live Chrome validation remains blocked by the environment's certificate-trust setup; these stores remain previews.

The [remaining grocery-banner audit](GROCERY-SEARCH-AUDIT-2026-10-06.md) extends the verified search fixes and browser lifecycle checks to Kroger, Fry’s, Ralphs, King Soopers, Smith’s and Fred Meyer. All eleven banners use `src/stores/grocery-pages.js`; the separate Amazon/Target/Walmart/Costco/Instacart pipelines are unchanged.
