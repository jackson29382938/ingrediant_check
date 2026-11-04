# Walmart and Target screenshots (1.24.0)

Captured by `npm run retailers:check` (`scripts/retailer-sort-harness.mjs`): the **real unpacked extension** in
Chromium, on **replica** Walmart and Target pages (`scripts/retailer-replicas.mjs`) served over the real hostnames.
They are **not** captures of the live sites. On 2026-11-04 Walmart showed its "Robot or human?" press-and-hold check to
the capture environment and Target answered HTTP 429; neither was solved or bypassed. No retailer traffic is made (every
other host is unresolvable), and no account or personal data is involved. Product names, prices and pictures are made up.
See `docs/STORES.md` ("Sorting and ad hiding on Walmart and Target") for what the replicas copy from earlier recordings
and which parts are guesses.

| Image | What it shows |
|---|---|
| `00-before-1.23.0-search-from-home.png` | The **previous release** (1.23.0) after a search typed on the Walmart home page: no ratings, no sort tab, every sponsored tile, the sponsored carousel and the banner on screen. This is the reported problem, reproduced. |
| `02-walmart-search-from-home-ads-hidden.png` | 1.24.0, same flow: ratings on every organic result, five ads of five different markups gone, the grid closed up, the Ingredient Check summary tiles filling the leftover cells. |
| `03-walmart-search-paused-ads-visible.png` | The same page with Ingredient Check paused: the ads are exactly as the page rendered them (the "Sponsored" tile is the third card). |
| `04-walmart-sort-price-per-unit-low-to-high.png` | The Sort results panel on its default order, Price per unit: low to high. $1.66/lb apples sort second as $0.104/oz; results that cannot be priced per ounce are listed last and marked. |
| `04b-walmart-hover-score-breakdown.png` | Hovering a rating explains it (Froot Loops: Red 40 caps the score at 18). |
| `06-walmart-sort-price-per-item.png` | The same panel with *Price per* set to item: only results that state or give an item count are comparable. |
| `08b-walmart-cart-ratings.png` | Walmart cart: every line rated, with the cart's average. |
| `10-walmart-phone-sort-panel.png` | Phone width (390 px): the panel sits under the results; no horizontal scrolling. |
| `11-target-search-from-home-badges.png` | Target, search typed on the home page: results rated. |
| `12-target-sort-price-per-unit-low-to-high.png` | Target's Sort results panel, Price per unit: low to high ($0.20/oz first). Target's two advertisements are tagged Sponsored in the list. |

Regenerate: `HARNESS_CHROME=/path/to/chromium SHOT_DIR=out npm run retailers:check` (`SHOT_SCALE=2` for retina).
`00-` is made with `EXT_DIR` set to an unpacked 1.23.0 and `REPRO=1`.
