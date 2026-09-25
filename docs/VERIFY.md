# Verifying the recent work

`npm test` proves the logic. `npm run preflight` proves the package. Neither can prove the parts
that only exist once Chrome loads the extension: the offscreen document, the optional permission
prompts, and the Apps Script round-trip. Those are what this page is for.

Run both first — if either fails, stop, because nothing below will behave.

```bash
npm test && npm run preflight
```

## 1. Load it

You do **not** need Chrome for Testing. That was only needed for the `--load-extension`
command-line flag; loading by hand works in your normal Chrome.

1. `chrome://extensions` → enable **Developer mode** (top right)
2. **Load unpacked** → select this folder
3. Expect: *Ingredient Check 1.1.0*, no errors under the card

If a red **Errors** button appears, open it — a manifest problem shows here and nowhere else.

## 2. The case that started this

Open `https://www.amazon.com/dp/B00LOAW7U6` (Lifeway Low Fat Kefir, Strawberry).

**Before**, this scored **86 GOOD**. Amazon publishes its product name in the ingredients field,
and the engine scored the marketing copy.

**Expect now:** *"Couldn't read the ingredients on this page"* with a paste box — because the blurb
is refused and nothing else is enabled yet. That refusal is the fix. If you still see 86, the old
cached score is being shown; the cache is version-stamped so it should not happen, but
**Clear cached scores** in the popup settles it.

## 3. Turn the optional features on

Extension popup (click the icon):

| Toggle | What to expect |
| --- | --- |
| **Open Food Facts fallback** | Chrome asks for permission. On the kefir page you should now get **~30 Poor** (30 on 2026-09-25) |
| **Read label photos** | *"Reading the label photo…"* for a few seconds, then **~31 Poor** (31 on 2026-09-25), footer reads *"Read from the label photo on this page"* |
| **Rate every search result** (on by default) | Score chips appear on tiles as you scroll a grocery search. The first time, a blue *"Ingredient Check is rating these results"* notice appears above the results. **Turn off automatic rating** unticks this toggle; **OK** hides the notice for good |

After a product scores, the toolbar icon shows the number as a badge, and reopening the popup
shows a "This page" card with the same score. Host permissions already cover Amazon tabs; the
popup does not need `activeTab`. The popup also exposes the existing weight presets (Balanced,
Conventional, Additive-averse, Whole-food, Sugar-conscious) — same objects as the settings page.

Both routes landing near 30 is the point: two independent readings of the same label agreeing,
against Amazon's 86.

**OCR is the one most likely to fail**, because the offscreen document has never run outside a
test page. If nothing happens after ~15 seconds:

- `chrome://extensions` → **service worker** → Console
- A `NetworkError … importScripts` means a vendored file is wrong — rerun `npm run preflight`
- *"offscreen API unavailable"* means Chrome is older than 116

### After removing `web_accessible_resources` (P0)

The offscreen page loads Tesseract with `chrome.runtime.getURL` from extension origin. Amazon
pages can no longer probe `chrome-extension://<id>/vendor/tesseract/*`.

**Retest (run live on 2026-09-25 and passed: 31 Poor from the label photo; see the live record below):**

1. Load unpacked, enable **Read label photos**
2. Open `https://www.amazon.com/dp/B00LOAW7U6`
3. Expect the loading card, then a score near **31 Poor**, footer *"Read from the label photo on this page"*
4. If the panel stays on the paste box: service worker console. A `NetworkError … importScripts` means a worker path still needed WAR — put back **only** that one `vendor/tesseract/` file, never `src/offscreen/*`.

## 4. The search gate

Search `running shoes` on Amazon, then `organic oats`.

Expect **nothing at all** on the first — no chips, no hover, no observer — and normal behaviour on
the second. Non-food departments and queries stand the extension down entirely. The popup's
"This page" card stays empty on search pages and shows a score once a product page has been scored.

## 5. The shared database and diagnostics

Needs a build with `ENDPOINT` set ([SETTINGS-SYNC.md](SETTINGS-SYNC.md)). Settings should show no
red "not set up in this build" line under *Shared online database*.

- Score a product, wait 15 seconds, and a `products` tab appears on the sheet with one row.
- On a second Chrome profile, search for the same product: its tile gets a badge with no Amazon
  request for it (DevTools → Network shows no `/dp/<asin>` fetch), and its row's `pulls` goes up.
- Move a weight slider: badges change at once, with no `/dp/` fetches.
- Untick **Use the shared online database**: nothing goes to `script.google.com` any more.

For diagnostics, tick **Send scoring diagnostics**.

Only the settings page can flush the queue. In the popup's DevTools console,
`chrome.runtime.sendMessage({type: 'flushDiagnostics'}, r => console.log(r, chrome.runtime.lastError))`
logs `undefined` and *"The message port closed before a response was received."* The same line in the
settings page's console logs a result object.

Rows batch in twelves, so browse a dozen products or press **Send queued rows now**. The status
line reports what happened. Expect a `diagnostics` tab to appear with headers.

If nothing arrives: the Apps Script deployment must be **Execute as: Me**, **Who has access:
Anyone**. Anything else returns a redirect to a login page and the POST silently fails.

## 6. The master switch

The first toggle in the popup is now a real off switch, not just "hide the panel". Off means no
panel, no badges, no page watching, no queued work — and nothing below it is forgotten.

Turn it off and reload an Amazon product page. Expect **nothing at all**, and the rows below greyed
out with *"Paused. Everything below is kept…"*. Turn it back on: your toggles, weights, allergens
and avoid list are exactly as they were.

Measured with `tests/harness-lifecycle.html`, which counts what the content script actually does:

| Page | `extract()` calls | MutationObserver |
| --- | --- | --- |
| Non-food product | **0** | connects once, disconnects |
| Food product | **1** | connects once, disconnects |
| Master off | **0** | never connects |

Previously the observer stayed connected for the life of the page and re-ran the full extraction on
every Amazon ad refresh, on non-food pages included.

## 7. Sort by score or price per ounce

Reload the extension in `chrome://extensions` first, then open an Amazon grocery search
(`organic rolled oats`).

1. Open Amazon's **Sort by** menu. *Price per ounce: Low to High* sits under *Price: Low to High*, and
   *Ingredient Check score: High to Low* is at the end.
2. Choose **Price per ounce: Low to High**. Chrome's side panel opens beside the page, and Amazon's
   page does not change or reload. The panel says *Reading Amazon listings…*, then fills in, cheapest
   per ounce first. With *Rate every search result* on, listings without a score are rated while you
   watch; **Stop rating** halts that.
3. In **Prioritize**, try *Healthiest*, *Balanced* and the sliders: the list re-ranks at once. With
   more than one factor, each listing shows a *Match* number.
   Hover (or tab to) a score: a pop-up says why it scored that ("What's good", "What hurt"), and
   **Why it scored N** under each listing shows the same. A score saved before its reading was kept
   says to open the product instead.
4. **Open in new tab** (next to **Back to Amazon search**) shows the same list, same priorities, in a
   tab. **Back to Amazon search** returns to the search tab.
5. Choose **Ingredient Check score: High to Low** from Amazon's menu: a new list, healthiest first.
6. Amazon's own options (*Price: High to Low*) still sort Amazon's page as normal.
7. Toolbar popup → turn **Price per ounce** off: its menu option and the price-per-ounce slider go.
8. Settings → *Sort* → turn on *Load more Amazon results* and set 30; choose an option again: the
   panel collects 30 listings across Amazon's results pages.
9. Settings → *Speed*: *Balanced* is selected. *Most up to date* rates results without asking the
   shared database; *Fastest* rates at most 20 per results page.
10. Turn the master switch off: the options leave Amazon's menu.

## 8. Worth a look while you are in there

- A product with a normal ingredient list — panel expands, rows sum to the score
- A capped product (anything with canola or soybean oil) — a **numbered** `CAP` row, not a bare label
- A shampoo — *"Not scored — this does not look like food"* with **Score anyway**
- Settings → move a slider — scores on screen change and the cache clears
- Settings → import a random JSON file — it is refused; a stamped export re-imports
- Settings → **Restore from my Chrome account** after changing a weight — the backup comes back, the
  master switch does not change

## Browser harnesses (no Amazon login)

```bash
npm run harness
```

CI also runs `npm run harness:ci` (Playwright, Chromium, local pages only).

- Panel: http://127.0.0.1:8731/
- OCR: http://127.0.0.1:8731/tests/harness-ocr.html
- Lifecycle: http://127.0.0.1:8731/tests/harness-lifecycle.html
- Food-only + settings: http://127.0.0.1:8731/tests/verify-food-settings.html

## Verification record — 2026-09-24

Run from a cloud container. Its network policy blocks `www.amazon.com`, `world.openfoodfacts.org`
and `script.google.com`, so **none of the three live flows below could be run**. Nothing here counts
as live verification. What did run:

| Check | How | Result |
|---|---|---|
| `npm test`, `npm run preflight`, `npm run harness:ci` | Node 22; Playwright Chromium on local pages | Pass |
| Unpacked extension loads; worker starts; `importScripts` globals resolve; no `web_accessible_resources` | Chromium 141 (headless), `--load-extension`, driven over CDP | Pass |
| `flushDiagnostics` from `options.html` answered; from `popup.html` refused (no reply); `diagnosticsStatus` from the popup still answered (since 2026-09-25 the popup is refused for every settings message) | Same, messages sent from the real extension pages | Pass |
| Offscreen OCR document created by the worker; vendored Tesseract runs in it with no WAR | Same, a label drawn on a canvas, not an Amazon image | Pass, ~0.8 s |
| Content script → worker → offscreen OCR → panel, and search auto-rating with the new notice | Same, but `www.amazon.com` and `m.media-amazon.com` mapped to a local TLS server serving hand-built pages; all other hosts mapped to NOTFOUND | Pass: DOM list 95, label photo 35 (`label-ocr`), 8 badges from 7 `/dp/` fetches, notice's turn-off button sets `autoScoreSearch: false` |

The last row shows the extension's own chain works in a real Chromium with no WAR. It does not
show Amazon's real markup, its image CDN, or its CORS headers. **Live OCR is still unverified.**

**Still unverified, and what the owner needs to do:**

1. **Post-WAR OCR on real Amazon.** Load unpacked in your own Chrome, turn on **Read label photos**,
   and open `https://www.amazon.com/dp/B00LOAW7U6`. Expect ~28–29 Poor with the footer *"Read from
   the label photo on this page"*. If it fails, follow the steps in *After removing
   `web_accessible_resources`* above.
2. **Open Food Facts.** Needs a click on Chrome's permission prompt in your profile, which automation
   here cannot give. Popup → **Open Food Facts fallback** → **Allow** → the same Lifeway page. Expect
   ~28 Poor. Then untick it and check `chrome://extensions` → *Details* → *Site access* no longer
   lists world.openfoodfacts.org.
3. **Shared database and diagnostics.** `ENDPOINT` is set in this build. Whether the Apps Script
   behind it is deployed as **Execute as: Me** / **Anyone** could not be checked. Run section 5
   above. Nothing was sent to it from here.
4. **The notice on real Amazon.** On a grocery search, check the notice sits above the results, not
   above Amazon's header, and that **Turn off automatic rating** stops the `…` badges.

## Verification record — 2026-09-25, before network access was opened

Same environment, same result for the live flows. `www.amazon.com`, `world.openfoodfacts.org`,
`script.google.com`, `www.target.com`, `www.walmart.com`, `www.costco.com` and `web.archive.org` were
all refused, both on direct connections and through the web-fetch tool. **No live store, Open Food
Facts or Apps Script check was possible, and none is claimed.**

Re-run on the merged tree (goals change + this work), unpacked extension in Chromium 141:

| Check | Result |
|---|---|
| Settings messages (`flushDiagnostics`, `diagnosticsStatus`, `refreshSheet`, `accountLoad`) from `popup.html` and `welcome.html` get no reply; from `options.html` they are answered | Pass (19/19 smoke checks) |
| Offscreen OCR runs the vendored Tesseract with no `web_accessible_resources` | Pass |
| Simulated Amazon (local TLS server, all other hosts NOTFOUND): DOM list, label-photo OCR, search auto-rating and its notice | Pass (6/6) |
| Settings → Stores renders the registry; the request draft is previewed, trimmed to the site address, and refused when invalid (`harness:ci`) | Pass |

The owner steps in the 2026-09-24 record above still stand, and one is added:

5. **Store wishlist.** Settings → *Stores* → type a store name → **Open email draft**. Your email
   app should open a draft to jackson29382938@gmail.com matching the preview. You do not need to
   send it. Automation here cannot open a mail app.

## Live record — 2026-09-25, after network access was opened

Chromium 141 with the unpacked extension, fresh profiles, signed out of Amazon, through this
environment's egress proxy (US datacenter address, delivery location Dallas). These **are** live
checks on the real sites. Amazon showed no robot check at any point.

| Flow | Store / page | Expected | Result |
|---|---|---|---|
| Label-photo OCR after the `web_accessible_resources` removal | amazon.com `/dp/B00LOAW7U6` (Lifeway kefir), **Read label photos** on | Loading card, then a Poor score read from the photo | **Pass.** 31 Poor, source `label-ocr`, toolbar badge 31. (The old "28–29" predates the goals retune; the goals commit also reported 31.) |
| Open Food Facts fallback | same page, photos off, **Open Food Facts** on, shared database off | A score from the barcode | **Pass with the permission granted:** 30 Poor, source `open-food-facts`. The lookup is for barcode 017077103329 only. Without the grant it fails, as designed. OFF's CORS preflight does not allow the `X-Client-Id` header, so only the granted host permission lets the lookup through. |
| Open Food Facts permission prompt | popup toggle | Chrome asks, user allows | **Not verified.** Automation cannot press Chrome's permission dialog. The run above used a throwaway copy of the extension with the host already granted. The repository was not changed. |
| Shared database lookup and upload | amazon.com grocery search "organic rolled oats", defaults | Tiles scored; rows uploaded | **Pass.** `lookup` and `products` POSTs to the Apps Script answered 200. The worker's flush confirmed 20 rows on the `products` tab. |
| Shared database read-back | same profile, lookup for 10 scored products | Rows come back | **Pass.** 10 of 10 found, including the kefir's label-photo reading. |
| Diagnostics round trip | Settings → **Send queued rows now** | Rows sent, queue empties | **Pass.** Status went from "5 rows waiting to send" to "Sent 5 rows"; the receipt confirmed the write. |
| Settings-only messages | popup, setup page, settings page | Only settings answered | **Pass** (19/19 smoke checks). |

**Written to the shared sheet by these checks:** `products` rows for 21 amazon.com products
(the Lifeway kefir and 20 oat products from the search), their pull counts, and 5 `diagnostics`
rows (the kefir and 4 search tiles: ASIN, ingredient text, score, source). Nothing else. Diagnostics
were switched off again, and the test profiles were deleted.

**Seen but not changed:** each Open Food Facts lookup went out twice for one page view (two GETs
for the same barcode). It is harmless but wasteful, and it predates this work.

**Target, Walmart, Costco:** see [STORES.md](STORES.md). Target was read live behind its bot check
and stays preview. Walmart and Costco were blocked by theirs.

## Record: Amazon sort menu, price per ounce, priorities and speed, 2026-09-25

The in-page sort bar (and reordering Amazon's page) is gone. Amazon's own *Sort by* menu gets two
options, and choosing one opens the side panel. This follows the newer Amazon Cost per Ounce Sorter
(read from the owner's Google Drive copy; GitHub had only its first commit).

| Check | How | Result |
|---|---|---|
| A real (trusted) click on *Price per ounce: Low to High* in a stand-in for Amazon's menu opens Chrome's side panel (a `SIDE_PANEL` context, no fallback tab); Amazon's page does not navigate; the list fills in over 2 results pages with scores and price per ounce; the panel ranks it; *Open in new tab* keeps the priorities; the score option starts a new list; Amazon's own options still work; only Amazon search and product pages requested | Real extension in Chromium, local TLS stand-ins for amazon.com | Pass, 9/9 |
| Menu options in the right places; a pick caught before the menu script (which sets the `<select>` jQuery-style, with no native change event, the likely reason the Cost Sorter's panel did not open); keyboard change; turning price per ounce off removes it from a list Amazon already built; the list page's presets, sliders and buttons; the settings defaults | `npm run harness:ci` | Pass. Disabling the click interception makes it fail. |
| Unit-price parsing (the Cost Sorter's own `price.test.js` cases), ranking, speed steps (*Balanced* equal to the old constants), sanitizer, worker: `sidePanel.open` called before anything else, stale runs refused | `npm test` | Pass |
| Product page: a saved reading shows first, the label photo is read again and a different reading replaces it; the same or a failed re-read leaves it; speed steps change what the badges reuse | `npm test` (`tests/content-lifecycle.test.js`) | Pass. Removing the re-read makes it fail. |
| Existing Amazon auto-rating, OCR and Target flows | Earlier extension simulations, run again | Pass (6/6, 19/19, 8/8) |
| **Live on amazon.com** | | **Not verified.** Amazon still answers this machine's search pages with HTTP 503. Whether Amazon's real menu passes the click through the same way is the open question. |

**For the owner:** run §7 above once in your own Chrome, starting with step 2.

**Follow-up, same day.** The owner's Chrome opened the side panel but it stayed empty. The side panel
itself was then checked in the simulation over Chrome's DevTools protocol (not a copy in a tab): it
shows the ranked list. The likely cause on real Amazon was card detection. The sort code required an
`h2 a` link or Amazon's image link, while current Amazon cards put the `h2` inside the link and grocery
/ Whole Foods cards can have neither. It now finds listings the way the badges do (an ASIN plus a
title), and `harness:ci` includes three cards in those shapes (it fails with the old detection). The
panel also now reports an error or a stall instead of staying blank. Still not checked live: Amazon
answers this machine's search pages with 503.

## Record: price per fluid ounce and the report page, 2026-09-25

From the owner's kefir search (55 listings): most showed "No price per ounce" and several Lifeway
bottles showed $7.34/oz and $19.82/oz.

- Amazon writes liquids' unit price as "$0.11/fluid ounce", which was not recognised. Fluid ounces,
  "Fl Oz", Whole Foods' "FZ", ml, litres, quarts, pints and gallons are read now; liquids show "/fl oz".
- "10g Protein" was read as the package (10 g = 0.35 oz): $2.59 / 0.35 = $7.34. Nutrient amounts
  (protein, fat, sugar, fibre…) are skipped now; the 8 fl oz bottle is $0.32/fl oz.
- "3.1 fl oz, 8 Count" is 24.8 fl oz (a liquid's size is per bottle); a weight next to a count is
  still left alone, as the Cost Sorter did.
- `npm test` has the owner's titles; the simulation's oat milk (64 fl oz) now ranks first by price.

**Report a problem or suggest an improvement** (toolbar popup): the real extension in the simulation
opened the report page from the popup; it listed the recent clicks (the sort menu choice, the side
panel's preset and buttons), the settings and the side panel summary, and **Download report file**
saved one `ingredient-check-report-….html` with the text and data. The screenshot needs a real click
on the toolbar button (`activeTab`), which the simulation cannot make, so it showed "No screenshot
was taken". **For the owner:** click the toolbar button on an Amazon page and try it once.

**Still for the owner:**

1. Press **Allow** on Chrome's Open Food Facts prompt once in your own profile, to confirm the grant
   dialog (the flow behind it is verified above).
2. Open a Target grocery product and a Target search in your own Chrome, to promote Target from
   preview (steps in [STORES.md](STORES.md)).
3. Settings → *Stores* → **Open email draft**, to confirm your mail app opens the draft.

## What is still unproven

- **Chrome's Open Food Facts permission dialog.** The lookup behind it was verified live with the host
  granted (2026-09-25), but pressing **Allow** needs a person.
- **Target in normal use.** Target's pages were read live, but behind its bot check ([STORES.md](STORES.md)).
- **Walmart and Costco.** Not implemented; their bot checks blocked inspection.
- **The sort-menu options on live Amazon.** Checked only on a stand-in for Amazon's menu; amazon.com
  refused this machine's search pages on 2026-09-25 (§7 has the steps).
- **Amazon stores other than amazon.com.** They share code and markup with .com and the harness
  snapshots, but none was checked live one by one.
- The nutritional model is specified and tested, not scientifically validated.

Client-side, an endpoint that is not an Apps Script `/exec` URL is never called, queued diagnostic
rows carry a `rowId`, and each flush sends a `batchId`.
