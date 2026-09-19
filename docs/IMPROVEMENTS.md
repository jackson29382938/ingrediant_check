# Ingredient Check — improvement plan

Read of `main` at `60cc287` (v1.0.2). Claims below are from the code, not from the README.
Earlier audits (`docs/AUDIT-*.md`) already landed most rulebase and worker fixes; this is what is still worth doing, in order.

**How to use this.** Do P0 before a store listing or a wider share. P1 is the next working slice. P2 is product, not hygiene. Do not start a rewrite — the current shape is the asset.

---

## 1. What it does

A Manifest V3 Chrome extension that rates Amazon grocery products **0–100** from the ingredient list (additives, oils, sugars, processing / NOVA). Weights, allergen flags, and an avoid list are user-owned. Scoring is local.

**UX flow**

1. Toolbar popup: master switch, search badges, food-only, hover / auto-score, OCR, Open Food Facts. Cached score for the current ASIN.
2. Product page (`/dp/`, `/gp/product/`): a shadow-DOM panel next to the grocery card. Honest failure + paste box if the list cannot be read.
3. Search / browse: score chips on tiles already cached; optional hover-fetch or viewport auto-score (Amazon session, throttled).
4. Settings: per-category sliders, allergens / diets, avoid list, optional Google Sheet provenance + diagnostics.

**Read path (first hit wins):** DOM extract → optional on-device OCR of the label photo → optional Open Food Facts barcode → paste. Non-food listings are refused, not scored as food.

**Main modules**

| Area | Path |
|---|---|
| Lifecycle, badges, tile fetch | `src/content/main.js` |
| Amazon DOM extract + nutrition | `src/content/extract.js` |
| Panel (escaped HTML, open shadow) | `src/content/panel.js` |
| Scoring engine | `src/engine/score.js` |
| Rule tables, gates, cache, prefs | `src/engine/db/*`, `src/engine/categories.js` |
| Service worker (OFF, OCR host, sheets, diagnostics) | `src/background.js` |
| Tesseract offscreen | `src/offscreen/ocr.js` |
| Popup / settings | `src/options/*` |

---

## 2. Architecture — keep this, fix these

**Strengths (leave alone)**

- Build-free, no `node_modules` at runtime. Node 20+ tests + `preflight` prove the package.
- Isolated-world content scripts; panel interpolations go through `esc()`; settings DOM is built with `textContent` / `createElement`.
- Storage is sanitized on read (`prefs.js`: unknown ids dropped, weights clamped, only Google Sheet / Apps Script URLs kept).
- Score cache is fingerprinted on `RULES_REVISION`, weights, and sheet hashes (`score-cache.js` + `tests/rules-revision.test.js`).
- Coverage gate (`MIN_COVERAGE = 0.34` in `main.js`) refuses a confident wrong score when the rulebase cannot read the list.
- Worker: serialized diagnostics queue, ACK-before-delete, 15s network timeout, master-switch aborts in-flight fetches, housekeeping alarm created only if missing.
- Comments in `extract.js` / `score.js` document live Amazon traps; the test files pin them.

**Smells (small, not a rewrite)**

- **Script-tag soup.** Sixteen files injected in manifest order via `AIRmodule` / IIFEs. Correct, but a missing line in `manifest.json` is a silent empty panel. `preflight` and `sanity.test.js` already guard this — keep those tests if you ever add a file.
- **`main.js` is ~1,040 lines** (product page + search gate + tile queue + lifecycle). The next reliability bug will hide here. Split only when you next touch search vs PDP, not as a project.
- **`background.js` is one worker** with OFF, OCR, CSV sheets, and diagnostics. Message handlers do not check `sender.id` / `sender.tab` (see P0).
- **Duplicate helpers.** `toCsvUrl` still exists in the worker as a fallback copy of `prefs.toSheetUrl`.
- **Open shadow root** (`panel.js` `attachShadow({ mode: 'open' })`). Amazon's JS can reach in. Closed shadow is a one-line hardening if the page ever starts fighting the panel.
- **IIFE dual-runtime** (`typeof module !== 'undefined'`) so Node tests can `require` the same files Chrome injects. Keep it; a bundler would be a large rewrite.

---

## 3. Security and privacy

### Already sound

- Permissions are tight: `storage`, `alarms`, `offscreen`, `activeTab`. Network hosts are Amazon (required) plus **optional** Open Food Facts and Google.
- No `externally_connectable`. Pages cannot `chrome.runtime.sendMessage` in.
- CSP: `script-src 'self' 'wasm-unsafe-eval'` (wasm is for vendored Tesseract).
- Diagnostics / contributions are off by default, URL-allowlisted, `credentials: 'omit'`, no user id. Copy in `docs/DIAGNOSTICS.md` already says auto-score + diagnostics is a browse trace.
- Popup uses DOM APIs, not `innerHTML`, for the live score card.

### P0 — do these

1. **Stop exposing OCR internals to Amazon pages.**  
   `manifest.json` `web_accessible_resources` lists `vendor/tesseract/*` and `src/offscreen/*` for every Amazon origin. The offscreen document is extension-origin and loads those files with `chrome.runtime.getURL`; it should not need WAR. This is a **fingerprinting surface** (a page can probe `chrome-extension://<id>/vendor/tesseract/tesseract.min.js`) and, if a future offscreen page ever reflected query params, an XSS gadget.  
   Two audits already asked to remove it after a live OCR run. That run exists (`docs/LIVE-TEST-2026-09-05.md`).  
   **Action:** remove the WAR block (or shrink it to nothing), run OCR on Lifeway `B00LOAW7U6`, then **invert** the preflight check that currently *requires* WAR (`scripts/preflight.mjs` “vendor is web-accessible”). If OCR breaks, the failure mode is “worker importScripts”, and you put back only the one path the worker actually requests — not `src/offscreen/*`.

2. **Allowlist OCR image URLs in the worker.**  
   `ocrLabels` in `background.js` forwards `msg.urls` unchanged. `ocr.js` `fetch`es them from the extension origin. Content script *intends* only `https://m.media-amazon.com/images/I/…` (`ocr-text.js` `hiResUrl`), but nothing enforces that. A buggy or injected message could point the offscreen document at any URL the extension can reach (Amazon hosts are already granted).  
   **Action:** reject unless `https://m.media-amazon.com/images/I/` + the existing `IMAGE_ID` pattern. Cap length (already `limit = 5`).

3. **Bind network-touching messages to a real sender.**  
   `lookupBarcode`, `ocrLabels`, `contribute`, `report`, `diagnostic`, `provenanceLookup` accept any extension context. Fine today (no external connect). Cheap insurance: require `sender.id === chrome.runtime.id` and, for content-script types, `sender.tab` plus an Amazon host. Ignore the rest.

4. **Do not inject on the whole Amazon origin.**  
   Content scripts match `*://*.amazon.com/*` (and 20 other stores). That is cart, account, checkout, video, seller central — not just grocery. `main.js` then stands down, but the engine still loads and a 500ms URL poll starts.  
   **Action:** either narrow `matches` / add `exclude_matches` for `/ap/`, `/gp/css/`, checkout, and similar, or gate `watchNavigation()` until `isProductPage()` / `isListPage()` is true. Same privacy story as the food gate, one layer out.

### P1

- **`activeTab` is barely used.** Popup talks to the current tab; host permissions already cover Amazon. Keep it if you want the “this page” card on a tab the user just clicked without waiting for a content-script inject; otherwise drop it to shorten the install prompt.
- **Auto-score / hover fetch** (`fetch('/dp/' + asin, { credentials: 'same-origin' })`) uses the signed-in session. Copy in the popup is honest. Before a store listing, add a one-screen privacy note: what leaves the machine (nothing by default; barcode only if opted in; diagnostics only to *your* sheet; Amazon sees hover/auto-score as ordinary product views).
- **Closed shadow** for the panel, unless a test harness needs `open`.
- **No LICENSE file** in the repo. Add one before publishing.

### Not a bug

- Diagnostics include ingredient text (capped 1,200 chars) by design. Leave that; the feature is useless without it.
- `unlimitedStorage` is correctly absent. Cache no longer stores the ingredient blob (comment in `cacheScore`).

---

## 4. Reliability and edge cases

**Extraction** (`extract.js`) is the best-documented part of the repo: collapsed expanders, hashed class names, product-name-as-ingredients (Lifeway), trailing boilerplate, EU decimal commas, nutrition summary tables with values above labels. Keep treating new Amazon layouts as *test fixtures*, not as a new parser.

**Still fragile**

| Risk | Where | What to do |
|---|---|---|
| Amazon grocery card markup changes | `extract.js` tiers 1–3, harness fixtures dated 2026-09-02 | Save 2–3 live HTML snapshots per store (US + one EU) under `tests/pages/` and assert `extract()` still finds the list. Highest-leverage reliability test you do not have. |
| 21 hosts, incomplete languages | Heading regexes cover EN/ES/NL/FR/DE/IT/PL/JA (`原材料`). Scoring + OCR are English-first + E-numbers + ES/FR/DE/IT function words. Missing headings: Swedish `Ingredienser`, Turkish `İçindekiler`, Arabic, Portuguese-only forms, Hindi. OCR `BLOCK` is English `INGREDIENT(S\|EN)` only; `eng.traineddata` only. | For SE/TR/AE/SA/IN/JP: **decline** unreadable lists (already the coverage gate). Add headings before adding rules. Do not score JP/AR labels with English OCR. |
| OCR reads the wrong block | `ocr-text.js` stops at ALLERGEN/CONTAINS; nutrition is correctly excluded | Pin 3 more real OCR transcripts (EU label, dark photo, ingredients on the back) in `tests/ocr.test.js`. |
| Tile fetch 403 / captcha | `scoreTile` swallows errors, drops the pending chip, allows retry | Surface a single “Amazon throttled scoring” state after N failures; stop the queue. Do not retry-storm. |
| Food gate false positives | `ingestible.js` — heavily patched Sept 16 | Any new title miss goes in `food-gate.test.js` *and* a corpus note. Do not loosen the gate globally. |
| Calibration, not a bug | Sept 14 item 11: plain wheat flour vs a bag of sugar vs NOVA framing | Product decision. If you keep gluten-as-penalty, say so in the refined-grains help string in `categories.js`. |

**Open Food Facts / Apps Script** still have no live grant in this tree (`VERIFY.md` “still unproven”). Client-side URL checks and `rowId` / `batchId` are in place. Redeploy `docs/apps-script.gs` on the owner’s sheet before trusting diagnostics.

**Stale comments in `tests/corpus.json` defects:** `OPEN_DEFECTS` in `corpus.test.js` is **empty**, so `non-gmo-soybean-oil` and `cold-pressed-sunflower-oil` are now hard assertions. The JSON `_comment` / `note` fields still describe the old bugs. Clean the notes so the next reader does not think those defects are open.

---

## 5. Testing gaps

**What is strong:** Node suites for scoring, negation, gates, nutrition, cache, prefs, background (mocked Chrome), content lifecycle (mocked DOM), OCR *text* recovery, arithmetic, two dated audit pins, harness fixtures, `preflight`. CI = `npm test` + `preflight` on Node 20 and 22. No install step.

**Gaps**

| Gap | Priority | Concrete add |
|---|---|---|
| No saved Amazon HTML | P1 | 3 PDP + 1 search snapshot; run `extract()` + food gate in Node (`jsdom` or the existing harness DOM shim). |
| Browser harnesses are manual | P1 | One Playwright/Puppeteer job on `harness.html` + `harness-lifecycle.html` in CI (no Amazon login). `npm run harness` already serves them. |
| Live Amazon / OFF / Apps Script | P1 (manual) | Keep `docs/VERIFY.md` as the checklist; fix the version line (it still says **1.0.1**, manifest is **1.0.2**). |
| `package.json` `test` is a 20-file `&&` chain | P2 | `node --test tests/*.test.js` (one file already uses it). Today a mid-chain failure hides later suites. |
| No lint / format | P2 | Optional `eslint` on `src/` only if it stays dependency-light; not blocking. |
| OCR wasm path | already covered | `preflight` + `harness-ocr.html`. Do not add a unit test that importScripts the wasm. |

Do **not** put live Amazon in CI ( captcha, ToS, flakes ).

---

## 6. DX: build, packaging, CI, docs, naming

| Item | Status | Suggestion |
|---|---|---|
| Build | None, by design | Keep. |
| Packaging | Unpacked folder | Before Chrome Web Store: zip without `.chrome-profile/`, `.git`, `tests/`, `docs/AUDIT-*` if you want a small package; keep `vendor/tesseract`. Add a `npm run pack` that files `preflight` then zips. |
| CI | `.github/workflows/test.yml` | Sufficient. Add harness job when Playwright exists. |
| Chrome profile | Defaulted off-repo; `.chrome-profile/` still gitignored | Owner should `rm -rf .chrome-profile` if a Drive-synced copy still has cookies (Sept 16 leftover). |
| Docs | README is good; audits are resolution logs | Point README “Accuracy” at this file. Fix `VERIFY.md` version. |
| Locales | `_locales/en` only; settings page is hardcoded English | P2. Popup/panel already go through `chrome.i18n`. |
| **Naming** | GitHub repo `ingrediant_check`; npm/package `ingredient-check`; UI **Ingredient Check**; internal prefix `AIR` / `#air-score-panel` | Do not rename the GitHub repo unless you are ready to update every clone URL. For a store listing, keep **Ingredient Check**. A README one-liner (“repo folder spelling is historical”) is enough. Do not mass-rename `AIR` — it is in DOM ids, storage-adjacent comments, and tests. |

No `LICENSE` file — add one if this is meant to be public beyond the current GitHub visibility.

---

## 7. Product / UX opportunities

These are not defects. Pick at most one.

- **Search chips without fetching Amazon:** barcode/title → OFF only when the user already granted it; otherwise keep “cached after open” as the default (current honest model).
- **Compare two ASINs** in the popup (both already in the score cache). Small, uses existing `score-cache`.
- **Per-store language pack** (headings + top 20 additives) for DE/FR/ES/IT first; JA/AR as decline-only until then.
- **Weight presets on the popup** (“default / strict additives / keto flags”) — presets already exist in `categories.js`, only the settings page shows them.
- **Other retailers:** do not start. Extraction is Amazon-specific; a second host is a second `extract.js`.
- **Health claims:** keep the disclaimer. Allergen chips are “found in this text”, not a safety check — do not bury that.

---

## Prioritized backlog

### P0 — security / honesty, small diffs

1. Remove (or prove-and-minimize) `web_accessible_resources`; flip `preflight` accordingly. Re-run live OCR on `B00LOAW7U6`.
2. Allowlist OCR fetch URLs in `background.js` / `ocr.js` (`m.media-amazon.com/images/I/` only).
3. Ignore runtime messages whose `sender` is not this extension (and not an Amazon tab for content types).
4. Stop paying the content-script tax on non-product Amazon URLs (`exclude_matches` or late `watchNavigation`).
5. Fix `docs/VERIFY.md` “1.0.1” → `1.0.2`. Rewrite stale `corpus.json` defect notes.

### P1 — reliability you will feel on real pages

6. Check in 3–4 Amazon HTML snapshots; assert extract + food gate.
7. CI the existing browser harnesses (panel + lifecycle), still without Amazon.
8. Owner: live OFF grant + Apps Script round-trip; redeploy receiver for `batchId` / `rowId`.
9. After N tile-fetch failures, pause auto-score and say so.
10. Headings for `amazon.se` / `.com.tr` (and decide JP/AR: heading-only vs decline). Do not turn on English OCR there.
11. One-page privacy summary for a store listing; add `LICENSE`.
12. Decide wheat-flour vs sugar / NOVA copy in `categories.js` (Sept 14 calibration item).

### P2 — later

13. Split `main.js` along PDP vs search when you next change one of them.
14. `node --test` for the whole suite; optional `npm run pack`.
15. Settings i18n; closed shadow; drop unused `activeTab` if unused.
16. Popup shortcuts to existing weight presets.
17. Repo rename `ingrediant` → `ingredient` only as a conscious GitHub move.

---

## Leave alone

Panel `esc()`, prefs sanitizers, denial/negation handling, penalty saturation, diagnostics ACK-before-delete, cache fingerprint + `RULES_REVISION`, OCR cancellation / idle close, master switch that actually suspends the observer, food/search gates as they stand after Sept 16, build-free layout, optional-by-default network.

The nutritional model is a specified engine, not a validated diet. Changing rules without bumping `RULES_REVISION` is how stale badges ship — the hash test is the guard; use it.
