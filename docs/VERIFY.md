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
3. Expect: *Ingredient Check 1.0.2*, no errors under the card

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
| **Rate every search result** | Score chips appear on tiles as you scroll a grocery search |

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

**Manual retest (this environment did not run a live Amazon session):**

1. Load unpacked, enable **Read label photos**
2. Open `https://www.amazon.com/dp/B00LOAW7U6`
3. Expect the loading card, then a score near **28–29 Poor**, footer *"Read from the label photo on this page"*
4. If the panel stays on the paste box: service worker console. A `NetworkError … importScripts` means a worker path still needed WAR — put back **only** that one `vendor/tesseract/` file, never `src/offscreen/*`.

## 4. The search gate

Search `running shoes` on Amazon, then `organic oats`.

Expect **nothing at all** on the first — no chips, no hover, no observer — and normal behaviour on
the second. Non-food departments and queries stand the extension down entirely. The popup's
"This page" card stays empty on search pages and shows a score once a product page has been scored.

## 5. Diagnostics to your sheet

Follow [DIAGNOSTICS.md](DIAGNOSTICS.md) to deploy `apps-script.gs` and paste the `/exec` URL into
settings, then tick **Send scoring diagnostics**.

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
- Settings → paste a non-Google URL in a database field — the field stays invalid and is not saved

## Browser harnesses (no Amazon login)

```bash
npm run harness
```

CI also runs `npm run harness:ci` (Playwright, Chromium, local pages only).

- Panel: http://127.0.0.1:8731/
- OCR: http://127.0.0.1:8731/tests/harness-ocr.html
- Lifecycle: http://127.0.0.1:8731/tests/harness-lifecycle.html
- Food-only + settings: http://127.0.0.1:8731/tests/verify-food-settings.html

## What is still unproven

The installed extension’s offscreen OCR round-trip now passes on the live Lifeway page; see
[LIVE-TEST-2026-09-05.md](LIVE-TEST-2026-09-05.md) for evidence and the additional fixes.

Open Food Facts and the Apps Script sheet still need a grant / deploy on *your* Chrome profile
before they can be claimed as verified. Client-side, invalid contribution URLs are rejected,
queued diagnostic rows carry a `rowId`, and each flush sends a `batchId`. Redeploy
[apps-script.gs](apps-script.gs) so a lost ACK cannot double-write the sheet.

Amazon layouts outside the `.com` live checks and the harness snapshot are not fully proven.
The nutritional model is specified and tested, not scientifically validated.
