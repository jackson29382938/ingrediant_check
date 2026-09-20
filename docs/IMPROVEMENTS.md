# Ingredient Check — improvement plan

Read of `main` at `60cc287` (v1.0.2). Claims below are from the code, not from the README.
Earlier audits (`docs/AUDIT-*.md`) already landed most rulebase and worker fixes; this is what is still worth doing, in order.

**How to use this.** P0–P2 code items and the OCR-transcript pins are on `main` (`fddcaf7`). This file is the *historical* plan. For what to do next, see [RECOMMENDATIONS-2026-09-20.md](RECOMMENDATIONS-2026-09-20.md). Do not start a rewrite — the current shape is the asset.

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
| Shared content state | `src/content/page.js` |
| Product-page scoring | `src/content/product.js` |
| Search tiles + throttle | `src/content/search.js` |
| Lifecycle (observer, navigation) | `src/content/main.js` |
| Amazon DOM extract + nutrition | `src/content/extract.js` |
| Panel (escaped HTML, closed shadow) | `src/content/panel.js` |
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
- Coverage gate (`MIN_COVERAGE = 0.34` in `page.js`) refuses a confident wrong score when the rulebase cannot read the list.
- Worker: serialized diagnostics queue, ACK-before-delete, 15s network timeout, master-switch aborts in-flight fetches, housekeeping alarm created only if missing.
- Comments in `extract.js` / `score.js` document live Amazon traps; the test files pin them.

**Smells (small, not a rewrite)**

- **Script-tag soup.** Sixteen files injected in manifest order via `AIRmodule` / IIFEs. Correct, but a missing line in `manifest.json` is a silent empty panel. `preflight` and `sanity.test.js` already guard this — keep those tests if you ever add a file.
- **`main.js` was ~1,040 lines.** **Done (P2):** split into `page.js` (shared state), `product.js` (PDP), `search.js` (tiles / throttle), thin `main.js` (observer / navigation). No bundler; tests read `AIR.page`.
- **`background.js` is one worker** with OFF, OCR, CSV sheets, and diagnostics. Message handlers now require this extension (and an Amazon tab for content-script types).
- **Duplicate helpers.** `toCsvUrl` still exists in the worker as a fallback copy of `prefs.toSheetUrl`.
- **Closed shadow root** (`panel.js` `attachShadow({ mode: 'closed' })`). Host page JS cannot read `host.shadowRoot`. Tests and the harness use `AIR.panel.shadowOf(host)` because a second `attachShadow` on a closed root throws.
- **IIFE dual-runtime** (`typeof module !== 'undefined'`) so Node tests can `require` the same files Chrome injects. Keep it; a bundler would be a large rewrite.

---

## 3. Security and privacy

### Already sound

- Permissions are tight: `storage`, `alarms`, `offscreen`. Network hosts are Amazon (required) plus **optional** Open Food Facts and Google. `activeTab` was unused (host permissions already cover Amazon tabs for the popup card) and has been dropped.
- No `externally_connectable`. Pages cannot `chrome.runtime.sendMessage` in.
- CSP: `script-src 'self' 'wasm-unsafe-eval'` (wasm is for vendored Tesseract).
- Diagnostics / contributions are off by default, URL-allowlisted, `credentials: 'omit'`, no user id. Copy in `docs/DIAGNOSTICS.md` already says auto-score + diagnostics is a browse trace.
- Popup uses DOM APIs, not `innerHTML`, for the live score card.

### P0 — done (this branch)

1. **OCR internals are not web-accessible.**  
   `web_accessible_resources` removed. Preflight now fails if WAR exposes `tesseract` or `offscreen`. Offscreen still loads via `chrome.runtime.getURL`. **Manual live OCR retest** is in `docs/VERIFY.md` (Lifeway `B00LOAW7U6`); this environment did not run a signed-in Amazon session.

2. **OCR image URLs are allowlisted.**  
   `ocr-text.js` `isAllowedOcrUrl` / `allowedOcrUrls`: `https://m.media-amazon.com/images/I/` + `IMAGE_ID` only. Worker and offscreen both filter before `fetch`; a redirect that leaves that host is rejected.

3. **Runtime messages are bound to a real sender.**  
   `allowMessage` in `background.js`: `sender.id` must be this extension; content-script types also need an Amazon tab URL.

4. **Content scripts no longer match the whole Amazon origin.**  
   `matches` are product/search/browse/store paths on the 21 hosts. `exclude_globs` cover login, cart, checkout, and account. `main.js` only starts the observer on a product or results URL; the URL poll starts only after the master switch is on.

5. **Docs hygiene.**  
   `VERIFY.md` names 1.0.2. `corpus.json` defect notes are regressions, not open bugs (`OPEN_DEFECTS` is empty).

### P1 — done on this branch (except owner-only live steps)

- **`activeTab` dropped (P2).** Popup talks to the current tab; host permissions already cover Amazon. The “this page” card works on product/search tabs where content scripts inject. Preflight fails if `activeTab` returns.
- **Privacy note + LICENSE.** [docs/PRIVACY.md](PRIVACY.md) is the one-page CWS note: default install sends nothing; auto-score / hover is an Amazon product view; diagnostics are a browse trace to *your* sheet. Root `LICENSE` is MIT (README did not imply otherwise).
- **Closed shadow (P2).** Panel attaches `{ mode: 'closed' }`. Harness / tests use `AIR.panel.shadowOf(host)`.

### Not a bug

- Diagnostics include ingredient text (capped 1,200 chars) by design. Leave that; the feature is useless without it.
- `unlimitedStorage` is correctly absent. Cache no longer stores the ingredient blob (comment in `cacheScore`).

---

## 4. Reliability and edge cases

**Extraction** (`extract.js`) is the best-documented part of the repo: collapsed expanders, hashed class names, product-name-as-ingredients (Lifeway), trailing boilerplate, EU decimal commas, nutrition summary tables with values above labels. Keep treating new Amazon layouts as *test fixtures*, not as a new parser.

**Still fragile**

| Risk | Where | What to do |
|---|---|---|
| Amazon grocery card markup changes | `extract.js` tiers 1–3, harness fixtures dated 2026-09-02 | **Done (P1):** sanitized snapshots in `tests/pages/` (US oats PDP, US shampoo PDP, SE havregryn PDP, US grocery search) plus `tests/pages.test.js`. Replace a fixture when a live layout actually breaks extract — do not add jsdom. |
| 21 hosts, incomplete languages | Heading regexes now include SE `Ingredienser` and TR `İçindekiler` (plus EN/ES/NL/FR/DE/IT/PL/JA `原材料`). Scoring + OCR stay English-first. OCR `BLOCK` is English `INGREDIENT(S\|EN)` only; `eng.traineddata` only. | **Done (P1):** JP (`amazon.co.jp`) and AR (`amazon.ae`, `amazon.sa`) skip English OCR (`ocrReadyForHost`). Unreadable lists still hit the coverage gate. Do not add `jpn`/`ara` traineddata until a heading + rule pack exists. |
| OCR reads the wrong block | `ocr-text.js` stops at ALLERGEN/CONTAINS; nutrition is correctly excluded | **Done:** `tests/ocr.test.js` pins the real Lifeway transcript plus sanitized EU-label, dark/hard-photo, and ingredients-on-back transcripts. Asserts block recovery, ALLERGEN/CONTAINS stop, nutrition excluded, and `bestBlock` picking the back-of-pack image. |
| Tile fetch 403 / captcha | `scoreTile` | **Done (P1):** after `TILE_FAIL_LIMIT` (5) consecutive non-abort failures, pause the queue, keep ASINs in `seen` (no retry-storm), show `#air-throttle-notice`. Reset on navigation. |
| Food gate false positives | `ingestible.js` — heavily patched Sept 16 | Any new title miss goes in `food-gate.test.js` *and* a corpus note. Do not loosen the gate globally. |
| Calibration, not a bug | Sept 14 item 11: plain wheat flour vs a bag of sugar vs NOVA framing | Product decision. If you keep gluten-as-penalty, say so in the refined-grains help string in `categories.js`. |

**Open Food Facts / Apps Script** — owner-only live grant. Do not block other work on this. Client-side URL checks and `rowId` / `batchId` are in place.

Owner checklist (not done in this environment):

1. Chrome popup → enable **Open Food Facts fallback** and accept the host grant.
2. Open a product with a barcode and no readable DOM list (Lifeway `B00LOAW7U6` is the fixture) and confirm a score arrives via OFF.
3. Deploy / redeploy `docs/apps-script.gs` on the owner’s sheet (**Execute as: Me**, **Anyone**).
4. Paste the `/exec` URL in settings, enable diagnostics, score a handful of products or **Send queued rows now**.
5. Confirm the `diagnostics` tab has headers and one row per score, with no duplicate `batchId` replay.

**Corpus defect notes** now say these are locked regressions (`OPEN_DEFECTS` is empty). Keep it that way: a `defect` id is a historical name, not an open bug.

---

## 5. Testing gaps

**What is strong:** Node suites for scoring, negation, gates, nutrition, cache, prefs, background (mocked Chrome), content lifecycle (mocked DOM), OCR *text* recovery, arithmetic, two dated audit pins, harness fixtures, `preflight`. CI = `npm test` + `preflight` on Node 20 and 22. No install step.

**Gaps**

| Gap | Priority | Concrete add |
|---|---|---|
| No saved Amazon HTML | **done** | `tests/pages/*.html` + `tests/pages.test.js` (custom DOM loader, no jsdom). |
| Browser harnesses are manual | **done** | `.github/workflows/test.yml` `harness` job: CI-only Playwright, `npm run harness:ci`, no Amazon. |
| Live Amazon / OFF / Apps Script | P1 (manual, owner) | Keep `docs/VERIFY.md` as the checklist, including the OCR-after-WAR-removal retest. Checklist above. |
| `package.json` `test` is a 20-file `&&` chain | **done** | `node --test --test-concurrency=1 tests/*.test.js`. A mid-suite failure no longer hides later files. Concurrency 1 keeps the IIFE/`AIR` globals from racing. |
| No lint / format | P2 | Optional `eslint` on `src/` only if it stays dependency-light; not blocking. |
| OCR wasm path | already covered | `preflight` + `harness-ocr.html`. Do not add a unit test that importScripts the wasm. |

Do **not** put live Amazon in CI ( captcha, ToS, flakes ).

---

## 6. DX: build, packaging, CI, docs, naming

| Item | Status | Suggestion |
|---|---|---|
| Build | None, by design | Keep. |
| Packaging | **done** | `npm run pack` runs `preflight` then zips `manifest.json`, `src/`, `icons/`, `_locales/`, `vendor/`, `LICENSE`, `README.md`, `docs/PRIVACY.md` to `dist/ingredient-check-<version>.zip`. |
| CI | `.github/workflows/test.yml` | Node 20/22 `test` + `preflight`. Separate `harness` job installs Playwright for the two local harness pages only. |
| Chrome profile | Defaulted off-repo; `.chrome-profile/` still gitignored | Owner should `rm -rf .chrome-profile` if a Drive-synced copy still has cookies (Sept 16 leftover). |
| Docs | README is good; audits are resolution logs | Point README “Accuracy” at this file. Fix `VERIFY.md` version. |
| Locales | `_locales/en` only | **Done (P2):** settings chrome (headings, nav, buttons, placeholders, flash strings) and popup preset labels go through `chrome.i18n`. Category help in `categories.js` stays English until a real second locale exists. |
| **Naming** | GitHub repo `ingrediant_check`; npm/package `ingredient-check`; UI **Ingredient Check**; internal prefix `AIR` / `#air-score-panel` | Do not rename the GitHub repo unless you are ready to update every clone URL. For a store listing, keep **Ingredient Check**. A README one-liner (“repo folder spelling is historical”) is enough. Do not mass-rename `AIR` — it is in DOM ids, storage-adjacent comments, and tests. |

`LICENSE` is MIT. Store-listing privacy copy is [docs/PRIVACY.md](PRIVACY.md).

---

## 7. Product / UX opportunities

These are not defects. Pick at most one.

- **Search chips without fetching Amazon:** barcode/title → OFF only when the user already granted it; otherwise keep “cached after open” as the default (current honest model).
- **Compare two ASINs** in the popup (both already in the score cache). Small, uses existing `score-cache`.
- **Per-store language pack** (headings + top 20 additives) for DE/FR/ES/IT first; JA/AR as decline-only until then.
- **Weight presets on the popup** — **done (P2).** Popup chips apply `categories.PRESETS` (balanced / conventional / additive / wholeFood / strictSugar). No new scoring system.
- **Other retailers:** do not start. Extraction is Amazon-specific; a second host is a second `extract.js`.
- **Health claims:** keep the disclaimer. Allergen chips are “found in this text”, not a safety check — do not bury that.

---

## Prioritized backlog

### P0 — done

1. ~~Remove `web_accessible_resources`; flip `preflight`.~~ Manual Lifeway OCR retest still needed (see `VERIFY.md`).
2. ~~Allowlist OCR fetch URLs.~~
3. ~~Ignore runtime messages from unexpected senders.~~
4. ~~Stop injecting on every Amazon URL.~~
5. ~~`VERIFY.md` version + corpus defect notes.~~

### P1 — reliability you will feel on real pages

6. ~~Check in 3–4 Amazon HTML snapshots; assert extract + food gate.~~ `tests/pages/` + `tests/pages.test.js`.
7. ~~CI the existing browser harnesses (panel + lifecycle), still without Amazon.~~ `npm run harness:ci` / workflow `harness` job.
8. Owner: live OFF grant + Apps Script round-trip; redeploy receiver for `batchId` / `rowId`. **Not done here** — checklist in §4.
9. ~~After N tile-fetch failures, pause auto-score and say so.~~ `TILE_FAIL_LIMIT` (5); `#air-throttle-notice`; no `seen.delete` on failure.
10. ~~Headings for `amazon.se` / `.com.tr`; JP/AR decline-until-ready (no English OCR).~~ `Ingredienser` / `İçindekiler`; `ocrReadyForHost`.
11. ~~One-page privacy summary for a store listing; add `LICENSE`.~~ [PRIVACY.md](PRIVACY.md), MIT `LICENSE`.
12. **Open product question:** wheat-flour vs a bag of sugar vs NOVA framing (Sept 14 calibration item 11). Do not change scoring rules until that is decided. If gluten-as-penalty stays, say so in the refined-grains help string in `categories.js`.

### P2 — later / done on this branch

13. ~~Split `main.js` along PDP vs search.~~ `page.js` / `product.js` / `search.js` / thin `main.js`. Behavior unchanged.
14. ~~`node --test` for the whole suite; optional `npm run pack`.~~ `npm test` is `node --test --test-concurrency=1 tests/*.test.js`. `npm run pack` writes `dist/ingredient-check-<version>.zip`.
15. ~~Settings i18n; closed shadow; drop unused `activeTab`.~~ Settings/popup chrome wired to `_locales`; panel `mode: 'closed'` + `shadowOf`; `activeTab` removed (preflight fails if it returns).
16. ~~Popup shortcuts to existing weight presets.~~ Same `PRESETS` objects as settings; no new weights.
17. Repo rename `ingrediant` → `ingredient` only as a conscious GitHub move. **Still open — do not rename.** The product name stays **Ingredient Check**; the GitHub folder spelling is historical (README one-liner already says so).

---

## Leave alone

Panel `esc()`, prefs sanitizers, denial/negation handling, penalty saturation, diagnostics ACK-before-delete, cache fingerprint + `RULES_REVISION`, OCR cancellation / idle close, master switch that actually suspends the observer, food/search gates as they stand after Sept 16, build-free layout, optional-by-default network.

The nutritional model is a specified engine, not a validated diet. Changing rules without bumping `RULES_REVISION` is how stale badges ship — the hash test is the guard; use it.
