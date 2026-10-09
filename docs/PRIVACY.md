# Privacy (Chrome Web Store)

## Optional purchase history

Setup's **Include my Amazon purchase history** enables Amazon.com order-page imports and automatic
Google-account sync, with **Sync now** and a sync-off option in Purchase history. Only actual opened
order pages contribute purchases; carts and viewed products do not. An explicit **Scan all Amazon orders** action opens a dedicated browser tab and visits available year filters and pagination, optionally in the background while Chrome remains open. Local scan progress stores validated order-page URLs, counts and timing; it does not store raw order-page content. Verification pauses the scan. Public label lookups omit
cookies and referrers. Optional missing-label fallbacks send only a product barcode to Open Food
Facts (with its permission) or fetch public product-label images for local OCR. Orders, addresses
and payment details are never sent to those services. Fresh product readings stay in the local
cache; purchase capture does not publish them to shared product storage. Separate authenticated private backend rows hold product names/IDs, purchase
dates, status, scores, bounded ingredients, available nutrition/certifications, hashed order groups, bounded original point breakdowns and warning matches. Charts and current-goal comparisons run on your computer and do not rewrite the recorded ratings or contact a chart provider. Addresses, payment details, prices
and raw order numbers are not stored or uploaded. The feature is off until enabled and excluded
from settings imports/backups and shared product databases. Account switches do not transfer another
account's records. Export and confirmed local/account deletion are available; failed account
deletion stays visibly pending. The backend owner operates the private spreadsheet.
See [purchase history](PURCHASE-HISTORY.md) for limitations, retention and backend deployment.

## Existing scoring and settings

Ingredient Check scores grocery labels on Amazon, and as previews on Target, Walmart, Costco, Instacart and eleven additional grocery banners, **on your computer**. By default, settings backup uses your Chrome profile storage; Chrome syncs it to your own account when browser sync is enabled. Automatic search and cart rating, owner-kept certification lookups, and on-device label OCR are enabled by default. Barcode lookup is recommended and checked in setup but requires Chrome’s optional permission. Diagnostics and sharing product readings stay off. Backup can also be switched off.

This page is the one-screen note for a store listing. Settings copy and [DIAGNOSTICS.md](DIAGNOSTICS.md) say the same things at more length.

## What the extension reads

On Amazon product, search, browse, and store pages it already has permission to run on, it reads the product title, department crumbs, published ingredient text, nutrition table, barcode/ASIN, and (unless you switch label OCR off) the product image URL already on the page.

Regular scoring does not read passwords, payment details, orders or account pages. The separate opt-in purchase-history reader above reads only identifiable order items on Amazon.com. Cart rating reads only product links and product titles from cart line items. It does not collect quantities, prices, cart totals, delivery addresses, account identifiers or payment fields, and it never changes the cart or submits checkout. The cart average and the optional points are worked out on your computer from the scores.

Retailer previews read the product title, published ingredients, allergen warnings, nutrition and product identity on narrowly scoped public product/search pages. With **Rate search results and cart items** enabled (the default), they request each uncached result’s public product page on the same origin, without cookies (`credentials: omit`). Two requests run concurrently; the existing speed setting caps requests at 20–60 per search page. Requests stop on recognized challenges or rate-limit responses; no internal retailer APIs or access controls are bypassed. Missing labels remain unknown. Turning automatic rating off uses saved local scores only.

These previews do not share readings, call barcode/OCR services, or upload product data to Google. Product/search routes and narrowly scoped cart routes are matched. Account, order and checkout pages remain outside scoring routes. Automatic report screenshots still exclude carts.

Cart rating on all listed stores uses valid saved local scores first. With **Rate search results and cart items** enabled, uncached cart items can request their ordinary public product pages, two at a time and within the speed setting's 20–60 request budget. All cart-triggered requests, including Amazon, omit cookies and the cart-page referrer (`credentials: omit`, `referrerPolicy: no-referrer`). Only a public product ID and, for Instacart, its public retailer slug are sent; cart URL parameters and account data are not forwarded. Cart drawers on already supported product/search pages, and the page Amazon opens right after Add to Cart (`/cart/smart-wagon`), use the same rules. Only the lines of the active cart are read: not saved-for-later items, recommendations or the rest of the page. Missing, blocked and unreadable labels remain unavailable. On Amazon, what a cart read finds (the public label, not the cart) is kept on this computer as for a search result, so a score can say why it scored on hover; it is never shared. No cart contents are uploaded to Google or shared databases. Turning automatic rating off leaves saved-score display available.

## Access to Amazon

When it is installed, the extension asks Chrome for access to the 21 Amazon stores it supports
(`host_permissions` in `manifest.json`: amazon.com, .co.uk, .ca, .com.au, .ie, .in, .sg, .ae, .sa,
.de, .fr, .es, .it, .nl, .se, .pl, .com.be, .com.tr, .com.mx, .com.br and .co.jp). It needs that
access to read product, search and cart pages, plus narrowly scoped Amazon.com order-history pages when purchase history is enabled. **Rate search results and cart items** and **Score on hover** also
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

## Access to retailer previews

Target and the other retailer previews use narrowly scoped product, search and cart content scripts.
They have no additional broad host permissions. Automatic rating can fetch public product pages
from the same origin without cookies; cart lookups also omit the referrer. These scans do not call
the shared database, Open Food Facts, OCR or Google. Chrome lists these sites in the extension's
site access because of the content scripts; you can disable them in
`chrome://extensions` → *Details* → *Site access*.

## What leaves your computer

Scoring is always local: the rules, your weights and every score are computed in the browser.

| Feature | What is sent | Who sees it |
|---|---|---|
| **Shared online database** (on by default; can be disabled in settings) | A request for the certification tables (organic, grass-fed, origin), a few times a day. Nothing about the products you look at. | The Ingredient Check Apps Script, which keeps a **private** spreadsheet (nobody can open it). |
| **Share product readings with other computers** (off by default; experimental) | The store and product IDs of search tiles this computer cannot already answer (one batched request per page), and of a product page whose ingredients Amazon did not publish as text. For products you score: what was read off the page — ingredient text, title, feature bullets, certifications, nutrition numbers, how it was read — and when. One pull count when a shared read is used. Never your settings, your scores, or anything that identifies you. Readings from other computers are not checked, so a badge could show a score for text that is not on the label (product pages you open are always read from the page). | The Ingredient Check Apps Script, as above. It learns which products are being looked at, not by whom. See [CACHE.md](CACHE.md). |
| **Back up my settings** (on by default) | Weights, goals and their importance, allergen and diet choices, avoid list, toggles, sort, speed and display preferences | Chrome's own sync, for the Google account signed into Chrome. Not the Ingredient Check database. |
| **Sign in with Google** (only when you click it) | Signing in asks Google for your name, email and picture (scopes `openid email profile`) so Settings can show who is signed in; the picture is then loaded from Google's image host each time Settings opens. Those three are kept only in this browser's local storage, never backed up, exported or sent anywhere else; **Sign out** deletes them. The access token is never stored. **Save my settings to Google** also sends the same settings as the Chrome backup, and while you are signed in and this computer has saved or restored once, the same copy is sent a few seconds after each change (switch off with *Keep my Google copy up to date automatically*). | Google, for the profile. The Ingredient Check database, for a saved copy, keyed by a SHA-256 of your Google account id — not your email. |
| **Automatic Amazon search rating** (on by default) or **Score on hover** | Ordinary `GET` of `/dp/ASIN` on the Amazon store you are on, using your Amazon session (`credentials: same-origin`), three at a time and at most 60 per results page — only for tiles this computer and the shared database cannot already answer | **Amazon.** Each auto-scored or hovered tile looks like you opened that product. See *Access to Amazon* above. |
| **Automatic cart rating** (on by default) | Public same-origin product pages only, without cookies or referrer, two at a time and at most 20–60 per cart view depending on Speed. No quantities, prices, totals, delivery information or cart URL parameters are sent. | The retailer hosting that public product page; no cart data goes to Google or the shared database. |
| **Cart points** (off by default) | Nothing. A running total, and for each product the day it last earned points (store and product ID only), are kept in `chrome.storage.local` on this computer. | Nobody. Not part of a backup, the settings file or a report, and never uploaded; **Reset points** in Settings deletes it. |
| **Sort menu → Rate them** (the default sort setting; only when *Rate every search result* is on) | After you choose an Ingredient Check option in Amazon's sort menu: the same product-page `GET`s as *Rate every search result*, for listings in the list without a score. They go through the same queue as the badges: three at a time in total, never twice for one product, paused for both when Amazon refuses, and inside the same limit — 60 product pages (fewer under *Speed*) for each Amazon results page in the list, counting the ones the badges already requested. It stops at that limit or when you press *Stop rating* | **Amazon**, as above. |
| **Sort menu → Load more results** (off by default) | Amazon search pages after this one, until the chosen number of listings (1–500), then, with *Rate them*, product pages of listings still without a score, as above | **Amazon**, as above. Shared product readings are asked first, like for badges, if you turned them on. |
| **Price per ounce** (on by default) | Nothing. Read from the results page already open | Nobody. |
| **Speed and freshness** | *Fastest* and *Faster* request fewer product pages than before; *Fresher* and *Most up to date* re-read products sooner and trust shared readings less, so they request more. *Most up to date* never asks the shared database for answers | **Amazon** (product pages), as above. |
| **Show why on hover** (on by default) | Nothing. The breakdown is worked out on your computer from what was already read. | — |
| **Read label photos** | Fetch of the product image on `m.media-amazon.com` | The image is read **on your computer** (Tesseract). The pixels are not uploaded. |
| **Open Food Facts fallback** | The **barcode only** | Open Food Facts, after Chrome grants the host. |
| **Send certifications** / "Looks wrong?" | Product identifiers and certification text; a report adds what the score was | The Ingredient Check database. |
| **Report a problem or suggest an improvement** (only when you attach the file and send the draft yourself) | Nothing from the extension. Your email app sends what you wrote, and the report file if you attach it: a screenshot of the Amazon or a retailer preview tab you were on (no other tab is captured), that page's address (path and search term only), its score and the side panel list, your Ingredient Check settings, your recent clicks in the extension, and the extension and browser version. Every part is shown first and can be left out | The maintainer, by email from your address. See *Reporting a problem* below. |
| **Request a store** (only when you open the draft and send it yourself) | Nothing from the extension. Your email app sends the store name and optional site address, if you press Send | The maintainer, by email from your address. See *Requesting a store* below. |
| **Accuracy diagnostics** (off by default) | One row per scored product (ASIN, store, ingredient text, score, source) | The Ingredient Check database. That is a trace of products you scored — with auto-score on, of tiles that scrolled into view. |

Turn off the shared database, the backup and **Rate search results and cart items**, leave the other options
off, and the extension makes no network requests of its own. A build shipped without an endpoint behaves the same way for
everything but the Chrome backup.

There is no Ingredient Check account, no analytics SDK, and no third-party ad or crash reporter.

## Reporting a problem or suggesting an improvement

The toolbar popup has **Report a problem or idea**. When the tab you are on is an
Amazon or a retailer preview page, clicking it takes a screenshot of that tab (Chrome allows this only right after
you click the toolbar button, which is what the `activeTab` permission is for; it grants nothing on any
other tab or at any other time). On any other tab — your email, your bank — it takes no screenshot and
notes no address; you can add an image yourself. Then it opens a report page. That page shows
everything that would be included:

- what you type: the kind of report, a title, what happened, what you clicked, what you expected
- the screenshot (you can replace it, or add one by pasting)
- the page's address, cut to its path and search term, the score shown for it, and a summary of the
  side panel list (option, how many listings, how many with a score or a price per ounce, its status)
- your Ingredient Check settings, read through the same checks the extension uses: switches, weights,
  goals and how much each counts, allergens, diets, avoid list, sort and speed settings, and how many scores are cached. Never
  the cached scores themselves, a sign-in token, queued diagnostics, or anything another page stored
- your recent clicks in the extension this browser session (up to 60 short lines, such as "popup:
  autoScoreSearch off" or "Amazon sort menu: chose Price per ounce on /s"), kept in memory only
  (`chrome.storage.session`) and gone when Chrome closes
- the extension version, rules revision, browser and language

Each part except the version line can be left out. Nothing is sent from the page. **Download report
file** saves one `.html` file with the screenshot and every detail to your Downloads folder; **Open
email draft** opens your own email app addressed to jackson29382938@gmail.com with the text of the
report, for you to attach that file and send, or not.

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

The sorted list (opened from Amazon's sort menu) and the priorities set in its *Prioritize* bar are kept in `chrome.storage.session`: in memory, for this
browser session only, gone when Chrome closes.

`chrome.storage.local` holds your weights, allergen/diet flags, avoid list, toggles, the optional cart points (a total and, per product, the day it last earned them; only when you turn points on), a **score cache** (number, verdict, ASIN) and the **product data** behind it (what was read off each product page, kept 30 days by default, 1 to 90 days under Settings → *Speed*, so a weight change does not refetch). **Clear cached scores** in the popup removes both.

## Single purpose

Help you read grocery ingredient lists on Amazon and, as previews, Target, Walmart and Costco. Network hosts are Amazon (the page itself), Google (the Ingredient Check Apps Script, Chrome sync, and sign-in if you use it), and Open Food Facts (barcode lookup you grant).


## Google and Chrome profile sign-in

Chrome profile sign-in is managed by Chrome itself; settings includes a link to Chrome profile settings.
The separate Google save/restore flow requests the optional `identity` permission only when you use it.
It requests the `openid` scope and selects a Google account for one operation. Tokens stay in memory
and are not saved in extension storage, reports, backups, or the account spreadsheet. OAuth client IDs
are public configuration, stored locally and excluded from backups. Google backups are keyed by a
hash of the verified account ID and contain settings, not your email, browsing cookies, or product cache.

## Grocery retailer previews

Target, Walmart, Costco, Instacart, Kroger, Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC, Harris Teeter, Dillons, Safeway and Albertsons use the shared local-scoring runner described above. Store adapters identify each current product and search card before accepting a label. Scores are kept in local storage. The same-site public-page requests are visible to the retailer and carry your normal browser connection metadata, but omit cookies. Costco Same-Day is outside scope. New content-script sites may cause Chrome to request approval of site access when updating.
