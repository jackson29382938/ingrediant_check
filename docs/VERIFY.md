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
| **Open Food Facts fallback** | Chrome asks for permission. On the kefir page you should now get **28 Poor** |
| **Read label photos** | *"Reading the label photo…"* for a few seconds, then **~28 Poor**, footer reads *"Read from the label photo on this page"* |
| **Rate every search result** (on by default) | Score chips appear on tiles as you scroll a grocery search. The first time, a blue *"Ingredient Check is rating these results"* notice appears above the results. **Turn off automatic rating** unticks this toggle; **OK** hides the notice for good |

After a product scores, the toolbar icon shows the number as a badge, and reopening the popup
shows a "This page" card with the same score. Host permissions already cover Amazon tabs; the
popup does not need `activeTab`. The popup also exposes the existing weight presets (Balanced,
Conventional, Additive-averse, Whole-food, Sugar-conscious) — same objects as the settings page.

Both routes landing near 28 is the point: two independent readings of the same label agreeing,
against Amazon's 86.

**OCR is the one most likely to fail**, because the offscreen document has never run outside a
test page. If nothing happens after ~15 seconds:

- `chrome://extensions` → **service worker** → Console
- A `NetworkError … importScripts` means a vendored file is wrong — rerun `npm run preflight`
- *"offscreen API unavailable"* means Chrome is older than 116

### After removing `web_accessible_resources` (P0)

The offscreen page loads Tesseract with `chrome.runtime.getURL` from extension origin. Amazon
pages can no longer probe `chrome-extension://<id>/vendor/tesseract/*`.

**Manual retest (not yet run on a live Amazon session; see the 2026-09-24 record below):**

1. Load unpacked, enable **Read label photos**
2. Open `https://www.amazon.com/dp/B00LOAW7U6`
3. Expect the loading card, then a score near **28–29 Poor**, footer *"Read from the label photo on this page"*
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

## 7. Worth a look while you are in there

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

## What is still unproven

The installed extension’s offscreen OCR round-trip was reported green on 2026-09-05 (before WAR
removal); see [history/LIVE-TEST-2026-09-05.md](history/LIVE-TEST-2026-09-05.md). Those PNG evidence files were
never checked in — treat the notes as a log, not a screenshot gallery. Re-run the post-WAR OCR
steps above before claiming live OCR.

Open Food Facts needs a grant on *your* Chrome profile, and the shared database needs the Apps
Script deployed, before either can be claimed as verified live. Client-side, an endpoint that is
not an Apps Script `/exec` URL is never called, queued diagnostic rows carry a `rowId`, and each
flush sends a `batchId`.

Amazon layouts outside the `.com` live checks and the harness snapshot are not fully proven.
The nutritional model is specified and tested, not scientifically validated.
