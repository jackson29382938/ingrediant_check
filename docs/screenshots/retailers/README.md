# Walmart, Target and Kroger screenshots (1.24.0)

Captured by `npm run retailers:check` (`scripts/retailer-sort-harness.mjs`): the **real unpacked extension** in
Chromium, on **replica** store pages (`scripts/retailer-replicas.mjs`, `scripts/retailer-replica-kroger.mjs`) served over
the real hostnames. They are **not** captures of the live sites. On 2026-11-04 Walmart showed its "Robot or human?"
press-and-hold check to the capture environment and Target answered HTTP 429; neither was solved or bypassed. No retailer
traffic is made (every other host is unresolvable), and no account or personal data is involved. Product names, prices
and pictures are made up. See `docs/STORES.md` ("The sorted list on every store, and ad hiding on Walmart") for what the
replicas copy from earlier recordings and which parts are guesses.

The list pages (`05`, `05b`, `06b`, `12`, `12b`, `13`) are the **same extension page Amazon uses** (`sorted.html` /
`sidepanel.html`), fed by the real service worker. Headless Chromium refuses `sidePanel.open`, so the full-width ones are
the tab the worker opens instead; `06b` is the side-panel page in a 420 px column.

| Image | What it shows |
|---|---|
| `00-before-1.23.0-search-from-home.png` | The **previous release** (1.23.0) after a search typed on the Walmart home page: no ratings, no sort button, every sponsored tile, the sponsored carousel and the banner on screen. This is the reported problem, reproduced. |
| `02-walmart-search-from-home-ads-hidden.png` | 1.24.0, same flow: ratings on every organic result, five ads of five different markups gone, the grid closed up, the summary tiles filling the leftover cells. |
| `03-walmart-search-paused-ads-visible.png` | The same page with Ingredient Check paused: the ads are exactly as the page rendered them (the "Sponsored" tile is the third card). |
| `04b-walmart-hover-score-breakdown.png` | Hovering a rating on the page explains it (Froot Loops: Red 40 caps the score at 18). |
| `04c-walmart-sort-menu.png` | The **Ingredient Check sort** button's menu: Amazon's two entries, with the unit most listings state. |
| `05-walmart-list-price-per-ounce-all-pages.png` | Price per ounce, low to high, with **Load more results** on and a count of 30: 22 results from three result pages (page 4 was empty, so "Walmart has no more results"), no ads, each result labelled with its page. $1.66/lb apples rank second as $0.104/oz; page 3's canister ranks third among page 1's results. |
| `05b-walmart-list-hover-notes.png` | Hovering a score shows why it scored that way ("What's good", "Not counted against it"), as on Amazon. |
| `06b-walmart-side-panel.png` | The same list in the side panel's narrow column. |
| `08b-walmart-cart-ratings.png` | Walmart cart: every line rated, with the cart's average. |
| `11-target-search-from-home-badges.png` | Target, search typed on the home page: results rated, although Target's HTML holds no products (scripts draw them). |
| `12-target-list-price-per-ounce-all-pages.png` | Target's list: 20 results from three pages, read through a hidden frame because the page's HTML has no products. Target's ads are listed and marked Sponsored. |
| `12b-target-list-hover-notes.png` | Hover notes on Target's list. |
| `13-kroger-list-price-per-ounce-by-scrolling.png` | Kroger-style page with no next-page address: the page is scrolled to load more, the list stops at the count of 20, and the page is put back. The other banners that share this adapter use the same path. |

Regenerate: `HARNESS_CHROME=/path/to/chromium SHOT_DIR=out npm run retailers:check` (`SHOT_SCALE=2` for retina).
`00-` is made with `EXT_DIR` set to an unpacked 1.23.0 and `REPRO=1`.
