# Privacy (Chrome Web Store)

Ingredient Check scores Amazon grocery labels **on your computer**. By default three things go online: product data to the shared database (so products are not re-read from Amazon), a settings backup to your own Chrome account, and — to put a number on every search result — requests for product pages to Amazon itself. All three can be switched off.

This page is the one-screen note for a store listing. Settings copy and [DIAGNOSTICS.md](DIAGNOSTICS.md) say the same things at more length.

## What the extension reads

On Amazon product, search, browse, and store pages it already has permission to run on, it reads the product title, department crumbs, published ingredient text, nutrition table, barcode/ASIN, and (if you turn the option on) the product image URL already on the page.

It does not read your Amazon password, payment details, cart, orders, or account pages. Content scripts are not injected there.

## Access to Amazon

When it is installed, the extension asks Chrome for access to the 21 Amazon stores it supports
(`host_permissions` in `manifest.json`: amazon.com, .co.uk, .ca, .com.au, .ie, .in, .sg, .ae, .sa,
.de, .fr, .es, .it, .nl, .se, .pl, .com.be, .com.tr, .com.mx, .com.br and .co.jp). It needs that
access to read product and search pages. **Rate every search result** and **Score on hover** also
use it to request product pages. Settings → *What to rate* lists the stores and explains how to limit
access (`chrome://extensions` → *Details* → *Site access*).

**Rate every search result is on by default.** For each result the extension cannot already answer,
it requests the product page from the Amazon store you are on. The request uses your Amazon sign-in
(your cookies for that store), so Amazon sees it much as if you had opened the product yourself. You
are told about this in three places:

- the toolbar popup, in a line under the switch that is always shown;
- Settings → *What to rate*, next to the same switch;
- once on the first results page it rates, beside the results, with a **Turn off automatic rating**
  button.

Turn it off in any of those places. Results then only show a score for products already read, by you
or through the shared database. Scoring on product pages you open does not change.

## What leaves your computer

Scoring is always local: the rules, your weights and every score are computed in the browser.

| Feature | What is sent | Who sees it |
|---|---|---|
| **Shared online database** (on by default; off in settings) | The store and product IDs of search tiles this computer cannot already answer (one batched request per page), and of a product page whose ingredients Amazon did not publish as text. For products you score: what was read off the page — ingredient text, title, feature bullets, certifications, nutrition numbers, how it was read — and when. One pull count when a shared read is used. Never your settings, your scores, or anything that identifies you. | The Ingredient Check Apps Script, which keeps a **private** spreadsheet (nobody can open it). It learns which products are being looked at, not by whom. See [CACHE.md](CACHE.md). |
| **Back up my settings** (on by default) | Weights, allergen and diet choices, avoid list, toggles | Chrome's own sync, for the Google account signed into Chrome. Not the Ingredient Check database. |
| **Sign in with Google** (only when you click it) | A Google access token (checked with Google, never stored) and the same settings | The Ingredient Check database, keyed by a SHA-256 of your Google account id — not your email. |
| **Rate every search result** (on by default) or **Score on hover** | Ordinary `GET` of `/dp/ASIN` on the Amazon store you are on, using your Amazon session (`credentials: same-origin`), three at a time and at most 60 per results page — only for tiles this computer and the shared database cannot already answer | **Amazon.** Each auto-scored or hovered tile looks like you opened that product. See *Access to Amazon* above. |
| **Show why on hover** (on by default) | Nothing. The breakdown is worked out on your computer from what was already read. | — |
| **Read label photos** | Fetch of the product image on `m.media-amazon.com` | The image is read **on your computer** (Tesseract). The pixels are not uploaded. |
| **Open Food Facts fallback** | The **barcode only** | Open Food Facts, after Chrome grants the host. |
| **Send certifications** / "Looks wrong?" | Product identifiers and certification text; a report adds what the score was | The Ingredient Check database. |
| **Accuracy diagnostics** (off by default) | One row per scored product (ASIN, store, ingredient text, score, source) | The Ingredient Check database. That is a trace of products you scored — with auto-score on, of tiles that scrolled into view. |

Turn off the shared database, the backup and **Rate every search result**, leave the other options
off, and the extension makes no network requests of its own. A build shipped without an endpoint behaves the same way for
everything but the Chrome backup.

There is no Ingredient Check account, no analytics SDK, and no third-party ad or crash reporter.

## What is stored on the device

`chrome.storage.local` holds your weights, allergen/diet flags, avoid list, toggles, a **score cache** (number, verdict, ASIN) and the **product data** behind it (what was read off each product page, kept 30 days so a weight change does not refetch). **Clear cached scores** in the popup removes both.

## Single purpose

Help you read Amazon grocery ingredient lists. Network hosts are Amazon (the page itself), Google (the Ingredient Check Apps Script, Chrome sync, and sign-in if you use it), and Open Food Facts (barcode lookup you grant).
