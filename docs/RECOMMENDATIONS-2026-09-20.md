# Ingredient Check — recommendations after P0–P2

Read of `main` at `fddcaf7` (v1.0.2), after PRs **#1–#4**. This is a new look at *what is left*, not a recap of the closed backlog in [IMPROVEMENTS.md](IMPROVEMENTS.md).

Do not start a rewrite. Do not rename the GitHub repo. Do not change scoring rules or `RULES_REVISION` unless you have decided a product question and are ready to retire the cache.

---

## 1. Current state

The extension is in good shape for a local, Amazon-only grocery rater.

**What is strong now**

- Permissions are tight (`storage`, `alarms`, `offscreen`). No WAR, no `activeTab`. OCR URLs are allowlisted. Runtime messages require this extension (and an Amazon tab for content-script types). Content scripts inject only on product/search/browse/store paths.
- Scoring is still local, cache-fingerprinted, and gated by coverage. Food and search gates stand down instead of scoring shampoo or running shoes as food.
- Content is split (`page.js` / `product.js` / `search.js` / thin `main.js`). Panel is a closed shadow. Popup exposes the existing weight presets. Tile auto-score pauses after five 403s.
- Tests are the asset: `node --test` on Node 20/22, `preflight`, Playwright harness CI (panel + lifecycle), Amazon HTML snapshots, real + sanitized OCR transcripts, two dated audit pins. `npm run pack` builds a store zip.
- Privacy copy, MIT `LICENSE`, and settings/popup chrome i18n (`_locales/en`) are in place.

**What is not a crisis**

There is no new P0 on this tree. The remaining work is live proof you can only do in Chrome, a few product decisions, and small DX / store / language follow-through.

---

## 2. Prioritized next work (relative to today)

### P0 — none

Do not invent security chores. Keep `preflight` and `sanity.test.js` as the guard if anyone reintroduces WAR, `activeTab`, or a host-wide `*.amazon.com/*` content match.

### P1 — you will feel this on real pages, or you cannot ship a claim

| # | Item | Where | What to do |
|---|---|---|---|
| 1 | **Live optional-network proof** | [VERIFY.md](VERIFY.md) §3–5, [DIAGNOSTICS.md](DIAGNOSTICS.md), [apps-script.gs](apps-script.gs) | Owner-only. Enable OFF on Lifeway `B00LOAW7U6` (~28 Poor). Redeploy Apps Script (**Execute as: Me**, **Anyone**). Paste `/exec`, flush diagnostics, confirm one row per score and no `batchId` replay. |
| 2 | **Post-WAR OCR on a real Amazon tab** | [VERIFY.md](VERIFY.md) “After removing WAR”, `src/offscreen/ocr.js`, `vendor/tesseract/` | [LIVE-TEST-2026-09-05.md](LIVE-TEST-2026-09-05.md) predates WAR removal. Node + `harness-ocr.html` do not prove the live offscreen path. Re-run Lifeway with **Read label photos** on unpacked `main`. |
| 3 | **Non-English lists still score “easy”** | `src/engine/db/additives.js`, `src/engine/score.js`, [AUDIT-2026-09-14.md](AUDIT-2026-09-14.md) item 12 | Headings and E-numbers work; most penalties are English. A Spanish twin of a chocolate list can clear coverage and miss `aroma` / `lecitina de soja`, so the score is flattered. Either add ~20 high-frequency synonyms per DE/FR/ES/IT **or** refuse more aggressively on those hosts. **This is a rule change** — bump `RULES_REVISION` and extend `tests/corpus.json`. Do not do it silently. |
| 4 | **Wheat / gluten / NOVA product story** | `src/engine/categories.js` (`grain` help), `src/engine/score.js` ~137–141, `src/engine/db/additives.js` GRAINS, `tests/audit-2026-09-14.test.js` | **Not missing code.** Help text already says whole wheat is penalized as gluten; NOVA treats plain flour as processed (3) and enriched as ultra (4). What is open is whether default weight `1.0` on `grain` is the product you want to sell. Decide; if you change behavior, bump `RULES_REVISION`. |
| 5 | **Amazon layout drift** | `src/content/extract.js`, `tests/pages/` (dated 2026-09-02) | Snapshots pin US oats/shampoo, SE havregryn, US grocery search. Do **not** add jsdom or refresh fixtures for sport. When a live grocery card breaks, drop a sanitized HTML next to those files and assert extract + food gate. |

### P2 — later, useful, not blocking

| # | Item | Where | What to do |
|---|---|---|---|
| 6 | **Compare two cached ASINs** | **done** | Popup `#compareBlock` + `CACHE.listScores` (`s:` entries only). No network. |
| 7 | **Chrome Web Store package** | **done (checklist)** | [store-listing/README.md](store-listing/README.md). Screenshots still owner-captured; version bump only at submit. |
| 8 | **OCR wasm in CI** | **done** | `harness-ocr.html` default is a no-Amazon worker smoke; `?live=1` keeps the old Amazon image path. `npm run harness:ci` waits on `__ocrSmoke.ok`. |
| 9 | **Worker hygiene** | **done (`toCsvUrl`)** | Worker delegates to `prefs.toSheetUrl`. Tests load `prefs.js`. Message-type inventory still optional. |
| 10 | **i18n leftovers** | `src/engine/categories.js`, `src/options/options.html` notes, `src/content/search.js` (`throttleCopy`) | Chrome is localized; category help, verdict words, and long settings notes are still English. Add `search.js` keys to the `preflight` harvest. Do not add `_locales/de` until category strings move. |
| 11 | **Optional eslint** | `package.json` | Only if it stays a devDependency and CI stays install-light for the main job. Not blocking. |
| 12 | **Dead evidence links** | **done** | LIVE-TEST / VERIFY no longer point at missing `evidence/2026-09-05/*.png`. |
| 13 | **`flushDiagnostics` sender** | `src/background.js` `allowMessage` | Any extension page can flush the queue (data goes to *your* endpoint). Optional: restrict to `options.html`. |

**Still do not start:** other retailers (second `extract.js`), a bundler, mass-renaming `AIR`, loosening the food gate globally, putting live Amazon in CI.

---

## 3. Blocked on the owner / product

These cannot be closed by another code PR:

1. **Live OFF grant** on Lifeway `B00LOAW7U6` (VERIFY §3).
2. **Live OCR after WAR removal** on the same page (VERIFY “After removing WAR”).
3. **Apps Script deploy + diagnostics round-trip** (`batchId` / `rowId`; VERIFY §5).
4. **Wheat / gluten default:** keep gluten-as-penalty at weight 1.0 (current, already documented in `categories.js`), or lower the default / retune NOVA and bump `RULES_REVISION`.
5. **Non-English strategy:** synonym pack (rule change) vs decline more lists on DE/FR/ES/IT.
6. **GitHub repo rename** `ingrediant_check` → something spelled *ingredient*. Conscious clone-URL break. Product name stays **Ingredient Check**. Leave it.
7. **Chrome Web Store submit** (screenshots, privacy URL, version bump). Code can prepare the zip; only you can list it.
8. **`.chrome-profile/` leftover** on any Drive-synced clone — delete locally if it still has cookies (gitignored; default profile is already off-repo).

---

## 4. If given free rein — ship this next

Ordered for user-visible accuracy first, then store, then hygiene. Skip 1–2 until you have a Chrome session if you want; they are owner steps, not code.

1. **Run the VERIFY checklist** (OFF + post-WAR OCR + Apps Script). Until that is green, do not claim those features in a store listing.
2. **Decide the grain story** in one sentence (“we penalize gluten grains by default; turn the dial down if you disagree” is already the code). Only then touch rules.
3. **DE/FR/ES/IT top-20 additive synonyms** (or a stricter non-English coverage refuse) — the largest remaining *accuracy* gap for 15 of 21 hosts. Requires `RULES_REVISION` + corpus pins. Not a rewrite.
4. ~~**Compare two cached ASINs**~~ in the popup (`CACHE.listScores`).
5. ~~**Store-listing folder + `harness-ocr` in CI**~~ — [store-listing/README.md](store-listing/README.md); wasm smoke in `harness:ci`.

`toCsvUrl` now delegates to `prefs.toSheetUrl`. Leftover i18n is still a drive-by.

---

## Leave alone

Panel `esc()`, prefs sanitizers, denial/negation, penalty saturation, diagnostics ACK-before-delete, cache fingerprint, OCR cancel / idle close, master switch that suspends the observer, Sept 16 food/search gates, build-free layout, optional-by-default network, closed shadow + `shadowOf`, `categories.PRESETS` as the only weight shortcuts.

The nutritional model is a specified engine, not a validated diet.
