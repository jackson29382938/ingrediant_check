# Stores

Where Ingredient Check runs, what is planned, and what has been checked. `src/stores/registry.js`
holds the same list; `tests/stores.test.js` fails if this page, the registry and `manifest.json`
disagree.

A store is **supported** only after its product page and its search results have been checked in a
real browser on the live site, in normal use. Tests against saved HTML do not count, and neither does
a local harness. **Preview** means a public-page adapter is implemented and tested, while live shopping/browser coverage remains incomplete. Each row states the evidence available.

## Status

Amazon.com has a separate opt-in Orders-page preview in 1.11.0, preserving purchase snapshots for
trends. Controlled Chrome/Node tests cover it; signed-in live validation remains pending. Other
stores/locales' orders, order details and checkout remain outside scope.
See [purchase history](PURCHASE-HISTORY.md).

| Store | Status | Implemented | Automated checks | Live checked | Notes |
|---|---|---|---|---|---|
| Amazon | supported | yes | pass (`npm test`, `npm run harness:ci`) | amazon.com product and search pages, 2026-09-05 and again 2026-09-25, including label-photo OCR, Open Food Facts and the shared database ([VERIFY.md](VERIFY.md)) | Only amazon.com has been live checked. The other 20 Amazon stores share its code and markup but were not checked one by one. |
| Target | preview | yes, 2026-09-25 (`src/stores/target.js`, `src/content/retailer.js`) | pass (`tests/target.test.js`, `tests/stores.test.js`), and the real extension on replica pages (`npm run retailers:check`) | **partly**, 2026-09-25: live product and search pages were read correctly, but behind Target's bot check. 2026-11-04: Target answered HTTP 429 to an automated browser | See *Target* below and *The sorted list on every store, and ad hiding on Walmart*. Needs one check in your own Chrome to become supported. |
| Walmart | preview | yes | adapter, identity and real-scoring browser fixture checks (`npm run walmart:check`), and the real extension on replica pages (`npm run retailers:check`) | Public product HTML retrieved 2026-10-04 (HTTP 200), product 10314926. 2026-11-04: Walmart showed its bot check to this environment, so no live search page was captured | Sponsored search items hidden; automatic ratings on public search results; sort by price per unit. See *The sorted list on every store, and ad hiding on Walmart* below. Live browser validation remains incomplete. |
| Costco | preview | yes | adapter and identity checks | Public product HTML retrieved 2026-10-04 (HTTP 200), product 100423971 | Visible labels only; retrieved initial page had no ingredient declaration. Paste fallback available. Live browser validation remains incomplete. |

| Instacart | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Initial product page retrieved; no usable label | instacart.com; readable public labels scored, missing labels remain unknown. |
| Kroger | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats page ingredients/nutrition read 2026-10-04 | kroger.com; readable public labels scored, missing labels remain unknown. |
| Fry’s | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats page ingredients/nutrition read 2026-10-04 | frysfood.com; readable public labels scored, missing labels remain unknown. |
| Ralphs | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | ralphs.com; readable public labels scored, missing labels remain unknown. |
| King Soopers | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | kingsoopers.com; readable public labels scored, missing labels remain unknown. |
| Smith’s | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | smithsfoodanddrug.com; readable public labels scored, missing labels remain unknown. |
| Fred Meyer | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML ingredients/nutrition read 2026-10-04; live browser pending | fredmeyer.com; readable public labels scored, missing labels remain unknown. |
| QFC | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML read 2026-10-04; live browser blocked by the site's bot protection 2026-10-06 (see *next five stores*) | qfc.com; readable public labels scored, missing labels remain unknown. |
| Harris Teeter | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML read 2026-10-04; live browser blocked by the site's bot protection 2026-10-06 (see *next five stores*) | harristeeter.com; readable public labels scored, missing labels remain unknown. |
| Dillons | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Public oats HTML read 2026-10-04; live browser blocked by the site's bot protection 2026-10-06 (see *next five stores*) | dillons.com; readable public labels scored, missing labels remain unknown. |
| Safeway | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Live product page scored in Chrome 2026-10-06; search not testable (see *next five stores*) | safeway.com; readable public labels scored, missing labels remain unknown. |
| Albertsons | preview | yes (`src/stores/grocery.js`) | adapter and Chrome fixture checks | Live product page scored in Chrome 2026-10-06; search not testable (see *next five stores*) | albertsons.com; readable public labels scored, missing labels remain unknown. |

## Earlier live check, 2026-10-06 (first five stores)

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

## Live check, 2026-10-06 (next five stores)

Same tool and rules as above (`npm run live-check -- qfc harristeeter dillons safeway albertsons`; no bot check is solved or bypassed).

| Store | Search results page | Food product page | Notes |
|---|---|---|---|
| QFC | **not testable**: the page loads headed but shows no product tiles for this automated browser (headless: `ERR_HTTP2_PROTOCOL_ERROR`) | **not testable**: 403 Access Denied | Akamai bot protection. Covered by saved-page tests only. |
| Harris Teeter | **not testable**: same as QFC (loads headed, 0 tiles; headless `ERR_HTTP2_PROTOCOL_ERROR`) | **not testable**: 403 Access Denied | Same Kroger-family protection. |
| Dillons | **not testable**: same as QFC (loads headed, 0 tiles; headless `ERR_HTTP2_PROTOCOL_ERROR`) | **not testable**: 403 Access Denied | Same Kroger-family protection. |
| Safeway | loads, but the results never render for the automated browser (no product cards to score); 0 badges | scored (Quaker whole grain oats, `111050071`) | After the fix below there is no stray badge on the empty results page. |
| Albertsons | same as Safeway; 0 badges | scored (Quaker whole grain oats, `111050071`) | Same. |

Fixed in this check (`src/stores/grocery-pages.js`):

- On Safeway and Albertsons, a relative link such as `href="#"` (the page's skip links) was resolved against a *product* URL, so it
  read as product `0003000001020` and a "Label unavailable" badge was attached in the page header. Relative links now resolve
  against the site root. Regression test: `skip links and other relative non-product links…` in `tests/grocery-pages.test.js`.
- These adapters now use the same `hiddenFromSight` rule as the others, so a modal that marks the whole page `aria-hidden`
  (as Instacart's signup modal did) cannot hide the product or the results.

The subsequent [cloud-proxy audit](PROXY-RETAILER-AUDIT-2026-10-06.md) records checks with Chrome certificate trust configured. Target and Walmart search were accessible in that session; availability can differ between sessions and queries.

The six remaining Kroger banners were subsequently checked in the [grocery live audit](GROCERY-LIVE-AUDIT-2026-10-06.md). Kroger and King Soopers search showed numeric ratings; Kroger, Fry's, King Soopers and Smith's products scored. A King Soopers recheck kept its score visible throughout six observations. Other checks encountered cloud-proxy transport failures. Complete live coverage remains pending.

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
- Match only that store's host and the product/search/cart routes it needs; keep checkout, account,
  order and login pages out of the content-script matches. Cart readers must inspect only public
  product links/titles, omit cookies and referrers on lookups, and preserve cart controls.
  Prefer a content script over a host permission. Any new host in the manifest, including a
  content-script match, makes Chrome ask existing users to approve it on update.
- Add sanitized fixtures under `tests/pages/` covering a product with a list, one without, a non-food
  product, a search page, and a known layout change. Add focused adapter and runner tests.
- Scoring stays local. Public same-origin search scans are disclosed in the popup, settings and [PRIVACY.md](PRIVACY.md). No internal APIs or account cookies are used.
- Change the store's row here with a date for each step: implemented, automated checks passed,
  live checked, or blocked.

## October 4, 2026 retailer checks

Normal public GET requests returned HTTP 200 for Target product 79364857, Walmart product 10314926, and Costco product 100423971. Target’s initial HTML did not expose its ingredient label. Walmart’s current-product `__NEXT_DATA__` contained `WHOLE GRAIN ROLLED OATS.`; the reader verifies `product.usItemId` against the URL before accepting that declaration. Costco redirected an older oats slug to a protein-bar product with the same numeric ID; its initial nutrition model was empty. These checks establish access and parsing evidence, not complete live browser support. No challenge was bypassed and no internal retailer APIs were called.

The original previews offer paste-label fallback. Version 1.6.0 adds public same-origin scans for uncached search results, while keeping saved-score reuse. They do not share product readings or call OCR/Google services. At that version cart routes were excluded; version 1.9.0 adds narrowly scoped cart readers. Login, account and checkout remain outside scoring routes. Missing nutrition stays unknown.

## Parallel audit follow-up

The [October 4 parallel audit](PARALLEL-AUDIT-2026-10-04.md) records fresh public product/search evidence and fixes for all four stores. Target, Walmart and Costco remain previews; successful public responses and fixture-based browser tests do not establish complete live-site support.

## Search expansion and placement — October 4, 2026

Version 1.6.0 adds twelve grocery previews and uncached public-page rating on all fifteen non-Amazon retailer adapters. Target chips TCIN16600402 was retrieved by an ordinary GET: the identity-bound core module contains POTATOES, AVOCADO OIL, SEA SALT and nutrient quantities. Ordinary public GETs on all nine Kroger-family banners (Kroger, Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC, Harris Teeter and Dillons) returned HTTP200. Oats UPC0003000001020 exposes Whole Grain Rolled Oats, an allergen declaration and an explicit 40g serving. These are public HTML declarations, not internal API calls. Instacart, Safeway and Albertsons returned HTTP200 but lacked a readable initial declaration in the sampled pages. Their fallbacks have controlled DOM/Chrome tests; they are not claims of complete live shopping support.

Walmart’s public search cards use overlay links beside product-title spans. Costco badges now mount in title content rather than as grid/flex children; image-only cards use an out-of-flow corner badge, and product panels sit outside the title/wishlist row. Badge styles use a shadow root. Cached, first-visit and missing-label results all have a visible state.

Search results depend on published readable declarations. Blocked pages, store/location-dependent hydration, absent labels and results beyond the speed budget cannot receive honest numeric scores; open those products to expand/paste a label. Amazon retains its existing separate search pipeline.

## Bottom-five follow-up — October 6, 2026

The [bottom-five audit](BOTTOM-FIVE-AUDIT-2026-10-06.md) records new public-page evidence and fixes for QFC, Harris Teeter, Dillons, Safeway and Albertsons. Modern Safeway/Albertsons `/shop/pd/<name>/<id>` products and identity-bound public declarations are read; search badges avoid truncated title links and scans preserve actual same-origin result URLs. Chrome fixture tests now cover pagination, cached/cold searches, SPA navigation, changed declarations and recycled cards. The environment's certificate-trust issue was subsequently resolved in the [proxy audit](PROXY-RETAILER-AUDIT-2026-10-06.md); complete live-browser coverage of these stores is still pending and they remain previews.

The [remaining grocery-banner audit](GROCERY-SEARCH-AUDIT-2026-10-06.md) extends the verified search fixes and browser lifecycle checks to Kroger, Fry’s, Ralphs, King Soopers, Smith’s and Fred Meyer. All eleven banners use `src/stores/grocery-pages.js`; the separate Amazon/Target/Walmart/Costco/Instacart pipelines are unchanged.

## Cart rating preview — October 6, 2026

Version 1.9.0 adds item ratings on narrowly scoped cart pages for Amazon, Target, Walmart, Costco,
Instacart, Kroger, Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC, Harris Teeter, Dillons,
Safeway and Albertsons. Amazon's 21 storefronts share the reader. Cart drawers on supported product
and search routes use it too. Costco Same-Day remains outside scope.

Saved local scores show first. Automatic rating can request each item's public product page without
cookies or a cart referrer, two requests at a time, bounded by the Speed setting. The cart reader
uses the same scoring rules and preferences as product pages; it never invents a score for an absent,
blocked or unreadable label. Recommendations, saved-for-later items, hidden rows and ambiguous
product identities are excluded. No quantities, totals, delivery/account information or payment
fields are collected. Cart reports remain excluded from automatic screenshot capture.

The unpacked-extension Chrome harness covers all 16 store cart routes: cold and cached scores,
added/removed rows, mixed food/non-food carts, missing labels, request privacy, preserved quantities
and totals, and navigation into checkout. It also opens/closes a Target drawer on a search route.
Node tests cover identity binding, semantic rows, Amazon title-slug links, saved-for-later exclusion,
supported hosts and cart routes. These are controlled fixtures, not 16 live shopping sessions.
The live Amazon food sample returned HTTP 200 but offered no Add to Cart control to the signed-out
browser, so it did not establish live filled-cart coverage. Cart support remains a preview until
ordinary live carts are checked. Retailer access checks still apply.

### Live check, 2026-10-07 (Amazon cart)

The 1.9.0 cart tests used invented cart markup, so none of this showed until a real cart was opened. A
signed-out guest cart on amazon.com (one grocery item added in a throwaway Chrome profile with the unpacked
extension, then removed and the profile deleted) found these, all fixed in 1.10.0:

| On the live cart | 1.9.0 | Now |
|---|---|---|
| The line in the cart | No score visible: Amazon keeps hidden "was removed from Shopping Cart" copies of the title link ahead of the visible one, and the badge went into those | The score sits on the visible title (96) |
| The image link | Its hidden "Opens in a new tab" label made it look like the title link | Hidden text is ignored when choosing the link |
| "Customers who shopped for … also shopped for", carousels, the page footer | 14 badges ("Open to rate", "Checking label…", scores) | None: only `#sc-active-cart` lines are read |
| The page right after Add to Cart (`/cart/smart-wagon`) | Not covered | The mini-cart line is rated on its image |
| Titles over about 175 characters | The line was dropped (the full title and its cut-off copy were both counted against a 300-character limit) | Read from `data-producttitle` |
| Scoring | Labels and certifications were not passed in, and the food check used the title alone | The same inputs and food check as a product page, so a product reads the same number everywhere |
| A robot-check page | Read as a product with no label | Recognised, and requests stop |
| The cart as a whole | Nothing | The average, how many lines were rated and, with points on, the level: under *Shopping Cart* and on the toolbar icon |

`tests/pages/amazon-cart.html` and `amazon-smart-wagon.html` keep the real structure (sanitized: made-up names, ASINs
and ids), and the Chrome harness checks the real extension on them, including that each of the old failures would be
caught. Other stores' carts are still checked on fixtures only: their sites block automated browsers or need an
account, so live filled-cart coverage there remains pending. Rows inside carousels, suggestions, "buy it again" and
footers are now excluded on every store.

## Walmart search in 1.20.1

(1.23.1 replaced this drawer with the sorted list described at the end of this page.) In **1.21.0**, the **Price & health** tab at the right edge opened a comparison drawer using the same
ranking and unit-price engines as Amazon. Choose Healthiest, Lowest price, Lowest price per oz,
or Balanced, or adjust the two importance sliders. It compares loaded organic results and refreshes
as labels arrive. Unknown values remain unknown; unit-price comparison is for weight-based prices.
Search grids compact around removed sponsored cells and collapse empty promotional slots. Pausing
restores Walmart's layout. Live desktop/mobile browser captures were checked with injected content
scripts; the managed browser's unpacked-extension installation restriction remains.

In **1.21.1**, isolated final rows that cannot pull products from the next Walmart result group use
the ten predefined search summaries listed in [the release notes](releases/1.21.1.md). Compaction
still comes first. These summaries occupy only residual columns and describe actual loaded products,
ratings, prices and label progress; missing values remain unknown. Pausing restores the original page.

While Ingredient Check is enabled, Walmart search hides sponsored cards/modules and automatically
rates discovered organic results, including results loaded later. Walmart search always shows its
rating badges regardless of the global **Rate every search result** and **Result badges** switches;
other stores retain those preferences. Pausing the extension removes badges and restores hidden ads.
Public product-page reads run at most two at a time and stop when the store blocks or rate-limits
requests. Missing readable ingredient declarations show **Label unavailable**, never an estimated
score from the title. Search URLs with a trailing slash are supported too.

`HARNESS_CHROME=/path/to/chromium npm run walmart:check` exercises the real content scripts and
scoring engine with intercepted pages: 65 uncached beef results, sponsored exclusions, late cards,
recycled cards, pause/resume, and missing declarations. This is fixture validation, not a live-site
check. The managed cloud environment blocks Walmart network access and unpacked extension installs.

## The sorted list on every store, and ad hiding on Walmart (1.23.1)

**One list, every store.** Amazon's two sort entries, the side-panel list behind them and the settings that drive them
now work the same on all fifteen retailer previews (Walmart, Target, Costco, Instacart, Kroger, Fry's, Ralphs, King
Soopers, Smith's, Fred Meyer, QFC, Harris Teeter, Dillons, Safeway, Albertsons). A retailer's own sort menu is a
script-built widget this extension cannot safely extend, so the page gets one **Ingredient Check sort** button (at the
right edge) that offers the same two entries with Amazon's wording: *Ingredient Check score: High to Low* and *Price
per ounce (or pound, fl oz, item…): Low to High*. The unit is the one most listings already state. Choosing one never
reorders the store's page: it opens Chrome's side panel (a tab where Chrome will not) with this search's listings ranked
there, in the same page Amazon uses (`src/options/sorted.js`): the Prioritize sliders, the unit picker, **hovering a score
shows why it scored that way**, Stop, *Back to <store> search*, and "Open in new tab". The keyboard shortcuts
(`chrome://extensions/shortcuts`) work on any of these searches, and with the panel open a new search in the tab fills it
again ("Follow new searches in the side panel").

**How the list is built** (`src/content/retailer-sort.js`, a port of Amazon's `sort.js` onto the shared adapter interface),
in Amazon's order and under Amazon's settings (*Settings > Search and unit-price sorting*):

1. the listings on this page, with the scores this computer already holds and the reasons behind them;
2. with **Load more results** on, further result pages until **Products to compare** is reached or the time limit is up
   (both off by default, as on Amazon). A store's page is read three ways, tried in order:
   - its HTML, through the shared page reader (`AIR.cart.publicDocument`: one size cap, one abort rule, one block-page test).
     The next page is the page's own *Next* link, else the store's page number (Walmart `page=`) or offset (Target `Nao=`);
   - when that HTML holds no products (Target, Instacart and the Kroger banners draw them with scripts), the same address
     rendered in a **hidden same-origin frame**, as your browser would show it, read once it settles and removed;
   - when the store gives no next-page address at all, the page itself is **scrolled** (or its own "show more" button
     pressed) to make it load more, and put back where it was.
   Each stops at the count or the time limit, and at once on a challenge page;
3. with **Rate them** and automatic rating on, the product pages of listings still without a score, through the runner's
   one reader (`readProductScore` in `retailer.js`, shared with the badges): two at a time, one request per product, one
   throttle flag, one per-page budget. Stop, the master switch or the store refusing ends it.

Results from a later page say where they came from ("Target page 3"); Walmart's ads are hidden and never listed, Target's
are listed and marked *Sponsored*. Weight, volume and item counts are never converted into one another, so a list is
priced in one family at a time (the unit picker changes it) and results that cannot be priced in it come last, marked.

**Worker side.** A store's tab may now send the sorted-list messages (`openSortedPanel`, `updateSortedResults`,
`openSortedTab`, `followSortedSearch`, `logAction`); it still may not ask for anything the worker fetches (OCR,
barcodes, AI, the shared database). What a list may contain is decided by the **sending tab's address**, never by the
message: only that store's own product ids, its own links, and pictures from its own site or a CDN the registry names
(`src/stores/registry.js`, `src/engine/db/sorted-results.js` `scopeFor`). Amazon's list is exactly as strict as before.

**Walmart ad hiding.** Walmart's markup is built from generated class names, and nobody has been able to capture its
current advertisement markup from an automated browser. The detector therefore never reads a class name and accepts
any one of several independent signals: a click-through via Walmart's ad tracker (`/sp/track?...&plmt=sp-...`), a
placement attribute, an accessible name that ends in "Sponsored", or the visible label as its own element
("Sponsored", "Advertisement", "Ad"). A card holding one signal is hidden whole (the outermost wrapper that holds
nothing but that ad, so the grid closes up); banners and brand carousels are hidden as modules; an organic card is
never hidden, and neither is the results grid or the page. Ads that arrive after load are hidden on the next frame.
Pausing the extension restores every ad exactly as the page rendered it.

**Why Walmart ads were still showing before 1.23.1** (reproduced on 1.23.0: `REPRO=1 npm run retailers:check` with
`EXT_DIR` set to an unpacked 1.23.0): both sites are single-page apps, so a search typed in the header from the home page
changes the address without loading a page. The script was injected only on `/search` and `/ip/*` (Target: `/s`,
`/p/*`), so for a search started anywhere else **nothing ran: no ratings, no sort, every ad visible**. Reloading the
results page made it appear to work. Separately, a banner marked only by its "Sponsored" label and an ad whose only link
was Walmart's tracker were never hidden even after a reload. 1.23.1 also injects on the public routes a search starts
from: the home page, `/browse/*`, `/cp/*` and `/shop/*` (Walmart), `/c/*`, `/pl/*` and `/b/*` (Target). It does nothing
there until a search or product page appears. Account, cart, checkout, login and order pages stay out by construction
(`tests/retailer-sort.test.js` fails if a route is added that is not on the list). A search started from any other
public page still needs a reload. The other thirteen stores keep their own routes; they are not injected on a home page.

**How this was checked, and what it does not prove.** `npm run retailers:check` loads the real unpacked extension in
Chromium and serves *replica* Walmart, Target and Kroger pages over the real hostnames
(`scripts/retailer-replicas.mjs`, `scripts/retailer-replica-kroger.mjs`; every other host is unresolvable, so there is no
retailer traffic). The replicas copy the structure earlier sessions recorded from the real sites and serve several
different ad markups on one page, since the real one is not known. The run drives what a shopper does (home page, type,
Enter, the menu) and checks injection, ads hidden and never rated, a late-arriving ad, the list through the real worker
(ranking across units, pages 2 and 3 read from HTML on Walmart and through a hidden frame on Target, the count cap,
scrolling on a Kroger-style page, hover notes, Follow, the keyboard shortcut, the panel's narrow column), the product page,
the cart and a phone width. `tests/retailer-sort-all-stores.test.js` checks, for **all fifteen stores**, that the registry
and each adapter agree on what a search page is and that each store's real product ids and links survive its own list's
sanitizer. Screenshots are in [screenshots/retailers](screenshots/retailers/README.md).
**On 2026-11-04 Walmart showed its "Robot or human?" press-and-hold check to this environment and Target answered
HTTP 429, so none of this has been seen on the live sites; no check was solved or bypassed.** For the other thirteen
stores only the shared path and the registry/adapter agreement are covered; **their live pagination (whether a next link,
a page number or scrolling is what works) is unverified**, and Costco's, Instacart's, Safeway's and Albertsons' page
numbers are not guessed: they rely on the page's own next link or on scrolling. If a store's list stops at the first
page, or Walmart's ads still show, save the results page from your own Chrome (*Save page as... > Webpage, HTML only*,
signed out, no account details) and add it under `tests/pages/` as a fixture so the reader can be corrected against the
real markup rather than a guess.

**Known limits.** Category and browse pages are not rated, sorted or ad-filtered (search results only). A frame-rendered
or scrolled results page is the slowest way to read a page and runs only with *Load more results* on. Walmart's own sort
menu, filters and *Add to cart* stay as they are; the list links to each product.
