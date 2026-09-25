# Sanitized Amazon HTML snapshots

Checked-in product and search markup for `extract()` and the food gate. These are
**hand-built fixtures** that reproduce the grocery-card structure captured on live
amazon.com (2026-09-02) and the EU heading/expander shape used on amazon.se.

They contain no cookies, account names, emails, order history, or session tokens.
ASINs are synthetic (`B00TEST…`). Image URLs are omitted.

## Target (`target-*.html`)

Reduced from live www.target.com pages rendered signed out in Chromium on 2026-09-25: the product
title, breadcrumbs and the *Label info* section (product pages), or the first six result tiles cut
down to their links and titles (search). Scripts, styles, classes, images, ads, prices, stock and
the store location are removed. TCINs are real, because they are public product ids.

| File | What it shows |
|---|---|
| `target-p-oats.html` | Grocery, *Label info* open, one-ingredient list |
| `target-p-chips.html` | Grocery, *Label info* open, three-ingredient list |
| `target-p-shampoo.html` | Non-food, *Label info* collapsed (nothing rendered until opened) |
| `target-p-banana.html` | Fresh produce, no *Label info* section at all |
| `target-s-oats.html` | Search results for "organic oats" |

Layout changes that were not captured are written inline in `tests/target.test.js` and marked
synthetic.
