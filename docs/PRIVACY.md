# Privacy (Chrome Web Store)

Ingredient Check scores grocery labels on Amazon, and as a preview on Target, **on your computer**. By default three things go online: product data to the shared database (so products are not re-read from Amazon), a settings backup to your own Chrome account, and — to put a number on every search result — requests for product pages to Amazon itself. All three can be switched off.

This page is the one-screen note for a store listing. Settings copy and [DIAGNOSTICS.md](DIAGNOSTICS.md) say the same things at more length.

## What the extension reads

On Amazon product, search, browse, and store pages it already has permission to run on, it reads the product title, department crumbs, published ingredient text, nutrition table, barcode/ASIN, and (if you turn the option on) the product image URL already on the page.

It does not read your Amazon password, payment details, cart, orders, or account pages. Content scripts are not injected there.

On Target (preview) it reads the same kind of thing from the product page you have open: the title,
the breadcrumbs, and the *Label info* section with the ingredient list and nutrition numbers. On a
Target search page it reads the product id and title of each result, to show scores you already
have. The content script is matched only on Target product (`/p/…`) and search (`/s…`) routes; it
does not run on cart, checkout, account, order or login pages.

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

## Access to Target (preview)

Target is reached through a content script on product (`https://www.target.com/p/*`) and search
(`/s…`) routes only. The extension has **no host permission** for Target, and
on Target it **makes no network requests**. It does not fetch product pages, does not use the shared
database, Open Food Facts or label photos, and cannot send diagnostics or reports from there. Scores
are computed and kept on your computer. A search page shows a score only for products you have
opened before. The only message a Target tab may send the extension's worker is the number for the
toolbar badge. Chrome lists Target in the extension's site access because of that content script;
you can switch it off in `chrome://extensions` → *Details* → *Site access*.

## What leaves your computer

Scoring is always local: the rules, your weights and every score are computed in the browser.

| Feature | What is sent | Who sees it |
|---|---|---|
| **Shared online database** (on by default; off in settings) | The store and product IDs of search tiles this computer cannot already answer (one batched request per page), and of a product page whose ingredients Amazon did not publish as text. For products you score: what was read off the page — ingredient text, title, feature bullets, certifications, nutrition numbers, how it was read — and when. One pull count when a shared read is used. Never your settings, your scores, or anything that identifies you. | The Ingredient Check Apps Script, which keeps a **private** spreadsheet (nobody can open it). It learns which products are being looked at, not by whom. See [CACHE.md](CACHE.md). |
| **Back up my settings** (on by default) | Weights, allergen and diet choices, avoid list, toggles | Chrome's own sync, for the Google account signed into Chrome. Not the Ingredient Check database. |
| **Sign in with Google** (only when you click it) | A Google access token (checked with Google, never stored) and the same settings | The Ingredient Check database, keyed by a SHA-256 of your Google account id — not your email. |
| **Rate every search result** (on by default) or **Score on hover** | Ordinary `GET` of `/dp/ASIN` on the Amazon store you are on, using your Amazon session (`credentials: same-origin`), three at a time and at most 60 per results page — only for tiles this computer and the shared database cannot already answer | **Amazon.** Each auto-scored or hovered tile looks like you opened that product. See *Access to Amazon* above. |
| **Sort results → Rate them first** (the default sort setting; only when *Rate every search result* is on) | The same product-page `GET`s as *Rate every search result*, for listings on the page without a score, at most 60 per results page | **Amazon**, as above. |
| **Sort results → Load more results** (off by default) | Amazon search pages after this one, until the chosen number of listings (1–500), then, with *Rate them first*, product pages of listings still without a score: three at a time, with your Amazon session, stopping if Amazon refuses | **Amazon**, as above. The shared database is asked first, like for badges, if it is on. |
| **Show why on hover** (on by default) | Nothing. The breakdown is worked out on your computer from what was already read. | — |
| **Read label photos** | Fetch of the product image on `m.media-amazon.com` | The image is read **on your computer** (Tesseract). The pixels are not uploaded. |
| **Open Food Facts fallback** | The **barcode only** | Open Food Facts, after Chrome grants the host. |
| **Send certifications** / "Looks wrong?" | Product identifiers and certification text; a report adds what the score was | The Ingredient Check database. |
| **Request a store** (only when you open the draft and send it yourself) | Nothing from the extension. Your email app sends the store name and optional site address, if you press Send | The maintainer, by email from your address. See *Requesting a store* below. |
| **Accuracy diagnostics** (off by default) | One row per scored product (ASIN, store, ingredient text, score, source) | The Ingredient Check database. That is a trace of products you scored — with auto-score on, of tiles that scrolled into view. |

Turn off the shared database, the backup and **Rate every search result**, leave the other options
off, and the extension makes no network requests of its own. A build shipped without an endpoint behaves the same way for
everything but the Chrome backup.

There is no Ingredient Check account, no analytics SDK, and no third-party ad or crash reporter.

## Requesting a store

Settings → **Stores** has a **Request a store** form. The extension sends nothing when you use it.
It builds an email draft and opens your own email app with it:

- **To:** jackson29382938@gmail.com
- **Subject:** `Store request: <the store name you typed>`
- **Body:** the store name, and the store's website if you gave one. Only the site address is kept
  (for example `https://www.example.com`). Any product, search or tracking part of a pasted link is
  removed first.

The page shows the draft exactly before you open it. It contains nothing else: no browsing history,
no products, no settings, no account details. Nothing is sent until you press Send in your email
app. If you do, it goes from your email address, and the recipient sees that address as with any
email. The extension does not keep a copy of what you typed. There is no form service, backend or
tracking behind this.

## What is stored on the device

The sorted list (*Open sorted list*) is kept in `chrome.storage.session`: in memory, for this
browser session only, gone when Chrome closes. It holds each listing's title, link, image link,
price, rating text and score. Nothing about it is sent anywhere.

`chrome.storage.local` holds your weights, allergen/diet flags, avoid list, toggles, a **score cache** (number, verdict, ASIN) and the **product data** behind it (what was read off each product page, kept 30 days so a weight change does not refetch). **Clear cached scores** in the popup removes both.

## Single purpose

Help you read grocery ingredient lists on Amazon and, as a preview, Target. Network hosts are Amazon (the page itself), Google (the Ingredient Check Apps Script, Chrome sync, and sign-in if you use it), and Open Food Facts (barcode lookup you grant).
