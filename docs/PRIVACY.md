# Privacy (Chrome Web Store)

Ingredient Check scores Amazon grocery labels **on your computer**. Nothing is required to leave the machine for the default install.

This page is the one-screen note for a store listing. Settings copy and [DIAGNOSTICS.md](DIAGNOSTICS.md) say the same things at more length.

## What the extension reads

On Amazon product, search, browse, and store pages it already has permission to run on, it reads the product title, department crumbs, published ingredient text, nutrition table, barcode/ASIN, and (if you turn the option on) the product image URL already on the page.

It does not read your Amazon password, payment details, cart, orders, or account pages. Content scripts are not injected there.

## What leaves your computer

**Default: scoring stays on the computer.** The shared Google Sheet link is filled in for a new
install, but Chrome blocks that read until you allow `docs.google.com`. Clearing the database URL
skips it. Nothing is written to the sheet until you paste an Apps Script URL and turn a send
option on.

| You turn on | What is sent | Who sees it |
|---|---|---|
| **Rate every search result** or **Score on hover** | Ordinary `GET` of `/dp/ASIN` using your Amazon session (`credentials: same-origin`) | **Amazon.** Each auto-scored or hovered tile looks like you opened that product. The extension does not send those views anywhere else. |
| **Read label photos** | Fetch of the product image on `m.media-amazon.com` | The image is read **on your computer** (Tesseract). The pixels are not uploaded to us. |
| **Open Food Facts fallback** | The **barcode only** | Open Food Facts, after Chrome grants the host. |
| **Accuracy diagnostics** | One row per scored product (ASIN, store, ingredient text, score, source) | **Only the Google Sheet / Apps Script URL you paste.** That is a browse trace of products you scored — and with auto-score on, of tiles that scrolled into view. Off by default. |
| **Save / load scoring settings** | The settings export: weights, allergen and diet flags, avoid list, food-only switch | The Apps Script URL you paste, which upserts the `settings` tab. Load reads that tab (or `GET ?kind=settings`). Not which products you opened. Off until you use the button or the update toggle. |

There is no Ingredient Check account, no analytics SDK, and no third-party ad or crash reporter.

## What is stored on the device

`chrome.storage.local` holds your weights, allergen/diet flags, avoid list, optional sheet URLs, and a **score cache** (number, verdict, ASIN — not the full ingredient blob). You can clear the cache from the popup.

## Single purpose

Help you read Amazon grocery ingredient lists. Optional network hosts are Amazon (required for the page), Open Food Facts (barcode lookup you grant), and Google (the shared sheet, after you allow it, and an Apps Script URL if you paste one).
