# Privacy (Chrome Web Store)

Ingredient Check scores Amazon grocery labels **on your computer**. By default two things go online: product data to the shared database (so products are not re-read from Amazon), and a settings backup to your own Chrome account. Both can be switched off.

This page is the one-screen note for a store listing. Settings copy and [DIAGNOSTICS.md](DIAGNOSTICS.md) say the same things at more length.

## What the extension reads

On Amazon product, search, browse, and store pages it already has permission to run on, it reads the product title, department crumbs, published ingredient text, nutrition table, barcode/ASIN, and (if you turn the option on) the product image URL already on the page.

It does not read your Amazon password, payment details, cart, orders, or account pages. Content scripts are not injected there.

## What leaves your computer

Scoring is always local: the rules, your weights and every score are computed in the browser.

| Feature | What is sent | Who sees it |
|---|---|---|
| **Shared online database** (on by default; off in settings) | The store and product IDs of search tiles this computer cannot already answer, in one batched request per page. For products you score: what was read off the page — ingredient text, title, feature bullets, certifications, nutrition numbers, how it was read — and when. One pull count when a shared read is used. Never your settings, your scores, or anything that identifies you. | The Ingredient Check Apps Script, which keeps a **private** spreadsheet (nobody can open it). It learns which products are being looked at, not by whom. See [CACHE.md](CACHE.md). |
| **Back up my settings** (on by default) | Weights, allergen and diet choices, avoid list, toggles | Chrome's own sync, for the Google account signed into Chrome. Not the Ingredient Check database. |
| **Sign in with Google** (only when you click it) | A Google access token (checked with Google, never stored) and the same settings | The Ingredient Check database, keyed by a SHA-256 of your Google account id — not your email. |
| **Rate every search result** or **Score on hover** | Ordinary `GET` of `/dp/ASIN` using your Amazon session (`credentials: same-origin`) | **Amazon.** Each auto-scored or hovered tile looks like you opened that product. |
| **Read label photos** | Fetch of the product image on `m.media-amazon.com` | The image is read **on your computer** (Tesseract). The pixels are not uploaded. |
| **Open Food Facts fallback** | The **barcode only** | Open Food Facts, after Chrome grants the host. |
| **Send certifications** / "Looks wrong?" | Product identifiers and certification text; a report adds what the score was | The Ingredient Check database. |
| **Accuracy diagnostics** (off by default) | One row per scored product (ASIN, store, ingredient text, score, source) | The Ingredient Check database. That is a trace of products you scored — with auto-score on, of tiles that scrolled into view. |

Turn off the shared database and the backup, leave the other options off, and the extension makes
no network requests of its own. A build shipped without an endpoint behaves the same way for
everything but the Chrome backup.

There is no Ingredient Check account, no analytics SDK, and no third-party ad or crash reporter.

## What is stored on the device

`chrome.storage.local` holds your weights, allergen/diet flags, avoid list, toggles, a **score cache** (number, verdict, ASIN) and the **product data** behind it (what was read off each product page, kept 30 days so a weight change does not refetch). **Clear cached scores** in the popup removes both.

## Single purpose

Help you read Amazon grocery ingredient lists. Network hosts are Amazon (the page itself), Google (the Ingredient Check Apps Script, Chrome sync, and sign-in if you use it), and Open Food Facts (barcode lookup you grant).
