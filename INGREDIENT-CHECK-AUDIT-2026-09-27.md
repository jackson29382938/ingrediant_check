# Ingredient Check 1.1.0 — Full Audit Notes

**Date:** 2026-09-27 (America/New_York)  
**Product:** Ingredient Check Chrome MV3 extension v1.1.0  
**Source path (user machine):** `/Users/a2938/Library/CloudStorage/GoogleDrive-jackson29382938@gmail.com/My Drive/Coding/ingrediant_check`  
**Tester environment:** Grok Bot Linux Chrome, unpacked load  
**Extension ID (this session):** `makjklodcnakffeaghipcgenpcipfcpn`  
**Baseline toggles for most live runs (unless noted):** Master ON · Food-only ON · Balanced preset · Shared cache ON · OCR ON · Open Food Facts OFF · Diagnostics OFF  

This document records **issues**, **improvements**, **keeps** (what already works well), and **comments** from automated unit/preflight runs, code review, and live Chrome exercising on amazon.com, amazon.co.uk, amazon.de, and target.com.

---

## 1. Method

1. Copied the extension tree to the test machine (tar excluding `node_modules` / `.git`).
2. Removed ~173 macOS AppleDouble `._*` files that arrived via Drive sync; then `npm test` and `npm run preflight`.
3. Loaded unpacked in Chrome; walked `docs/VERIFY.md` plus broader UX / privacy / accuracy / i18n / dark-mode / multi-storefront checks.
4. Traced several live surprises to concrete file/line behavior (especially cache, food gate, provenance, and `stripBoilerplate`).

**Automated status after cleanup:** `npm test` **214/214 pass**; `npm run preflight` **green** (manifest 1.1.0, OCR vendor, locales, diagnostics columns).

---

## 2. Keeps (do not regress)

These behaviors were verified live and/or in tests and should be treated as regression-sensitive strengths.

### 2.1 Core product quality
- Local scoring engine with adjustable weights; scores 0–100 with expandable breakdowns.
- Food gate stands down on non-food search (e.g. running shoes: no chips / no rating banner).
- Hard non-food on apparel/footwear PDP with clear copy (“Apparel or footwear…”).
- Soft non-food still offers **Score anyway** → OCR/paste rather than inventing a score (Under Armour shoes).
- Blurb refusal path exists: with shared cache OFF + OCR OFF + Open Food Facts OFF + Clear, Amazon PDPs that lack readable ingredients show the paste box (kefir, Bob’s oats).
- Manual paste scores and updates the toolbar badge (`via: manual-paste`).
- Closed shadow DOM panel with escaped HTML; report link and copy-score controls.
- Cache invalidation via `RULES_REVISION` / fingerprinting (documented + tested).

### 2.2 UX features that worked live
- Welcome / setup wizard (goals, allergens/diets, avoid list, fetch choices).
- Toolbar badge reflects score; popup **This page** card matches PDP.
- Search chips on grocery results; auto-rate banner with dismiss / turn-off.
- Hover breakdown (“Show why on hover”) with ~200ms delay; click-to-pin.
- Amazon Sort by injection: **Ingredient Check score: High to Low** and **Price per ounce: Low to High**; Chrome side panel ranks listings with prioritize sliders.
- Unit price: 24/24 olive-oil grocery listings had plausible `$/fl oz`; no nonsense sizes in that sample.
- Avoid list: custom term surfaces a red chip (“On your avoid list: …”).
- Allergen flags: Milk on kefir shows flag + safety disclaimer; **does not change numeric score**.
- Diet flags: Vegan on kefir → “Not vegan”; score unchanged.
- Goals / presets: Weight loss flips fat-reduced dairy to **“a plus for your goals”**; Vitamins & minerals flips added vitamin D similarly; Whole-food changes olive-oil base/bonus math while net score stayed 97 in that sample.
- Compare cached scores: side-by-side for multiple Amazon ASINs.
- Master switch off removes all chips; on restores behavior.
- Multipack grocery (Bob’s oats 4-pack) scored 95 Excellent.
- Target preview: Good & Gather organic oats `A-79364857` → 95 Excellent from open Label info, **no network** as designed.
- amazon.co.uk and amazon.de **search** chips + sort options worked (no captcha in this session).
- amazon.de PDP oatmeal scored with high-confidence NIC extract (language of panel remained English).

### 2.3 Privacy / packaging hygiene (good patterns)
- Report flow: per-section omit, live previews, download / mailto / copy — **no silent upload**.
- Request a store: URL scrubbed to **origin only** with privacy notice; mailto draft only.
- Target has no host permission; local DOM read only.
- No Walmart/Costco CAPTCHA workarounds (documented blockers — correct posture).
- Privacy docs and store-listing honesty about language limits are directionally strong.

### 2.4 Settings / ops
- Settings backup to Chrome account: clear copy that restore is user-initiated and master switch is excluded.
- Speed tiers explained in Settings; PDP still re-reads live (by design).
- Diagnostics: “Send queued rows now” reported `Sent 1 rows` when exercised; toggle restored OFF.

---

## 3. Issues (bugs / honesty / risk)

Severity: **P0** ship/CI blocker · **P1** user-visible wrongness or store/privacy risk · **P2** polish / docs / secondary.

### 3.1 P0 — Packaging / CI pollution from AppleDouble files

| Field | Detail |
|--------|--------|
| **What** | macOS / Google Drive sync drops `._*` AppleDouble companions throughout the tree (~173 files; many under `src/`, `icons/`, `_locales/`, `vendor/`). |
| **Impact** | `tests/sanity.test.js` runs `node --check` on every `*.js` under `src/` → fails with `SyntaxError: Invalid or unexpected token`. Preflight still says “Ready to load unpacked,” so CI can look green on preflight alone while `npm test` is red. A Chrome Web Store zip from a dirty Mac checkout can ship junk. |
| **Evidence** | Live on this copy before cleanup; `scripts/pack.mjs` excludes only `*.DS_Store` / `.DS_Store`, not `._*`. `.gitignore` lacks `._*`. |
| **Fix** | Delete `._*`; add to `.gitignore`; exclude in `pack.mjs` (zip `-x` and Python fallback); skip in sanity `walk()`. |

### 3.2 P1 — May-contain / facility allergen advisories scored as ingredients

| Field | Detail |
|--------|--------|
| **What** | Allergen advisory text is kept in the ingredient string and then **scored** as if those allergens were recipe ingredients. |
| **Impact** | Pure oats on amazon.de (`B0DSWGD186`) scored **72 Mediocre** with **−8 Wheat** and milk natural-sugar noise. Page ingredients are essentially **“Oatmeal”**; the manufacturing line says it is *not suitable for* nut/peanut/milk/wheat/sesame/soy / coeliac. Expected culinary oats ~95. Same class: US paste including “May contain wheat, milk…” applied wheat **score** penalties and dropped base toward Processed even with allergen **flags** off. |
| **Root cause** | `src/content/extract.js` `stripBoilerplate`: comments state logistics sentences are dropped but allergen declarations (“Contains…”, “May contain…”) **stay** so the allergen detector can read them. That same string feeds the scorer. |
| **Fix direction** | Split streams: allergen-scan text vs score-ingredient text; or strip `may contain` / `not suitable for` / facility lines before scoring while still scanning them for flags. Add corpus + unit tests for pure oats + advisory and chocolate + may-contain. |

### 3.3 P1 — Supplement food-gate miss (`Vitamins & Diet Supplements`)

| Field | Detail |
|--------|--------|
| **What** | Nature’s Bounty Vitamin D3 (`B00DYSUQEA`) soft-refused as non-food under food-only. |
| **Why** | `ingestible.js` `foodDept` regex matches `vitamins & dietary supplements` but Amazon’s live crumb uses **`Vitamins & Diet Supplements`**. Positive evidence scored below threshold; Supplement Facts not in first DOM sample. |
| **Impact** | Real supplements require **Score anyway**; search still auto-rates vitamin queries. Inconsistent with “Only rate food & supplements.” |
| **Fix** | Widen dept regex (e.g. `vitamins & diet(?:ary)? supplements`); improve Supplement Facts detection; add food-gate fixture/test. |

### 3.4 P1 — Shared cache + Clear vs OFF/OCR toggles (expectation gap)

| Field | Detail |
|--------|--------|
| **What** | With Open Food Facts and Read label photos **off**, Clear cache, kefir still scored from a shared/local `label-ocr` row instead of paste refusal (when shared DB still on). |
| **Root cause** | `product.js` `fromCache` prefers local `p:` then shared `productsLookup` before OFF/OCR/paste. OFF/OCR only gate **new** barcode/OCR runs, not reuse of cached `via`. Shared default ON; Clear removes local `p:`/`s:`/`off:` but shared can refill. |
| **Also** | Clear button label/count sound like “scores” only; count excludes `p:` even though `p:` is deleted (`popup.js`). Shared toggle lives in Settings / welcome step 4, not beside Clear / OFF / OCR in the popup. |
| **Verified good path** | Shared OFF + OCR OFF + OFF OFF + Clear → paste box reliably. |
| **Fix options** | (1) Rename Clear + toast that shared may refill; (2) Settings/popup copy; (3) Skip cached `via: label-ocr` / `open-food-facts` when those toggles are off; (4) optional skip `fromCache` when both OFF and OCR off. |

### 3.5 P1 — Default-on Amazon session fetches (`autoScoreSearch`)

| Field | Detail |
|--------|--------|
| **What** | `prefs.js` `TOGGLE_DEFAULTS.autoScoreSearch: true`. Fetches product pages with `credentials: 'same-origin'` (signed-in Amazon cookies), up to 60 per results page. |
| **Impact** | Disclosed in popup/settings/PRIVACY/welcome, but a tough default for Chrome Web Store privacy review and for privacy-sensitive users who click through setup. Live banner confirms behavior. |
| **Fix** | Consider default **off** or explicit first-run opt-in; keep triple disclosure if default stays on. |

### 3.6 P1 — Target Compare IDs Amazon-only

| Field | Detail |
|--------|--------|
| **What** | `score-cache.js` `parseKey` requires exactly 10 `[A-Z0-9]` (ASIN). Target TCINs are 6–12 digits. |
| **Impact** | Target scores never appear in **Compare cached scores** (live compare showed 8 Amazon ASINs only). Product page scoring on Target still works. |
| **Fix** | Widen id model for retail adapters in parseKey / listScores / related helpers; document Amazon-only compare until fixed. |

### 3.7 P1 — Accuracy / store-claim honesty

| Field | Detail |
|--------|--------|
| **What** | `docs/ACCURACY.md`: **0** live-capture corpus entries. Historically only amazon.com deeply live-checked; 20 other Amazon TLDs share code. |
| **This session** | `.co.uk` and `.de` **search** chips worked; `.de` PDP worked once; `.co.uk` PDP OOM’d this VM. Still thin evidence for “21 stores” without caveats. |
| **Fix** | Promote live captures into `tests/corpus.json`; keep store-listing caveats; optional live checks on more TLDs. |

### 3.8 P1 — Broad Amazon `host_permissions`

| Field | Detail |
|--------|--------|
| **What** | Manifest grants `*://*.amazon.<tld>/*` for 21 storefronts; content scripts are path-limited with cart/account excludes. |
| **Impact** | Privileged cookie-bearing fetches possible to any path on those hosts from extension contexts that use host permission. Auto-score path should stay on `/dp/{asin}` (spot-checked intent). |
| **Fix** | Document for CWS; keep fetches narrowly scoped; consider narrowing patterns if Chrome allows. |

### 3.9 P2 — Dark mode contrast failures

| Field | Detail |
|--------|--------|
| **What** | No manual dark toggle; styling via `@media (prefers-color-scheme: dark)` only. |
| **Failures** | Popup links stay `#007185` on `#1b1c1c` (~2.5:1, near-illegible). Panel `.head` keeps light pastel `--bg` behind dark score circle. Breakdown `.pts` and hover `.pop` headings/list items can inherit dark host text on dark backgrounds. Panel already uses `#4db6c8` for some links — popup not aligned. |

### 3.10 P2 — Provenance over-claim for bare “organic”

| Field | Detail |
|--------|--------|
| **What** | `provenance.js` maps `\b(usda organic|certified organic|organic)\b` → label **“USDA Organic”**. |
| **Impact** | Paste/ingredient text “Organic whole milk” surfaced “~ USDA Organic” without a real certification widget. |
| **Fix** | Require `usda organic` / `certified organic` for that label; demote bare “organic” or treat as weaker unverified claim (align with categories help about title/bullets). |

### 3.11 P2 — OCR vs Open Food Facts precedence

| Field | Detail |
|--------|--------|
| **What** | In `refreshAfterSaved`, if barcode (OFF) returns usable text, OCR is skipped (`if (!used) photo()`). |
| **Impact** | Enabling “Read label photos” while OFF is on can be a no-op for footer/source; VERIFY’s OCR ~31 expectation holds when OFF is off. |
| **Fix** | Document in UI; or allow OCR to replace when text/score differs; or run OCR in parallel and prefer higher-confidence / page-photo source. |

### 3.12 P2 — Permissions / store listing drift

| Field | Detail |
|--------|--------|
| **What** | `identity` declared but `OAUTH_CLIENT_ID = ''` (sign-in UI gated off). `unlimitedStorage` present; store-listing blurb historically incomplete; older history docs drift. |
| **Fix** | Drop `identity` until OAuth ships, or justify both in store listing. |

### 3.13 P2 — German locale gaps

| Field | Detail |
|--------|--------|
| **What** | `_locales/en` 381 keys vs `_locales/de` 376. Missing: `optPresetActive`, `optPresetCustomLabel`, `optPresetOptimized`, `optPresetVersus`, `optPresetCatsAria`. |
| **Impact** | German UI falls back to English for preset chrome. Panel on `.de` PDP was English overall (Chrome UI language / locale packing). |

### 3.14 P2 — Soft failure / diagnostics opacity

| Field | Detail |
|--------|--------|
| **What** | Widespread `catch` + `void chrome.runtime.lastError` on messaging/storage. Shared Apps Script endpoint is a build constant; failures often quiet while local scoring continues. |
| **Impact** | Hard to notice dead shared cache / OCR without Diagnostics on. |

### 3.15 P2 — Olive oil in Home & Kitchen

| Field | Detail |
|--------|--------|
| **What** | Pompeian EVOO (`B07BCX2YNG`) can sit under Home & Kitchen; food-only / override awareness matters. Still scored 97 when treated as food. Comment only unless gate false-negatives appear more often. |

### 3.16 Comments — environment / test harness

| Field | Detail |
|--------|--------|
| **VM memory** | Heavy Amazon/Target tabs + content scripts caused renderer OOM on this sandbox (~400MB) for some `.co.uk` PDPs and multi-tab stress. Not necessarily a user-machine bug; avoid parallel heavy tabs in automated live tests. |
| **Closed shadow DOM** | Correct for isolation; automation must use coordinate clicks (noted for future harness work). |
| **Folder spelling** | GitHub/Drive folder `ingrediant_check` is historical; product name is Ingredient Check (README already notes). |

---

## 4. Improvements (ranked backlog)

### Ship / correctness first
1. **Strip or bifurcate may-contain / facility advisory text** before scoring (keep for allergen flags). Add DE oats + US may-contain tests.
2. **Widen supplement department matching** (`Diet Supplements`) + Supplement Facts signals; food-gate tests.
3. **Exclude `._*`** in gitignore, pack, and sanity.
4. **Clear / shared-cache / OFF-OCR honesty** — copy at minimum; optional `via` gate when toggles off.
5. **Target compare id regex** for non-ASIN product ids.

### Privacy / store
6. Revisit **autoScoreSearch** default or first-run opt-in.
7. Justify or remove **`identity`**; justify **`unlimitedStorage`** in store listing.
8. Keep host-permission documentation tight; no account/cart fetches.

### Accuracy / i18n / UX
9. Tighten **USDA Organic** provenance regex.
10. Fill **5 DE preset strings**; decide EN-only category help for v1.1.
11. Fix **dark mode** popup links, panel header, `.pts`, hover popover foregrounds.
12. Clarify OCR vs OFF when both enabled (UI copy or behavior).
13. Grow **live-capture corpus**; bump accuracy tables honestly.
14. Add missing tests from cache investigation (Clear+shared refill, toggle+`via`, popup `cacheKeys` count).

### Later / non-goals this session
15. Walmart / Costco only after owner-saved HTML fixtures — no bot bypass.
16. Manual dark-mode toggle (optional; system preference may be enough once CSS is fixed).

---

## 5. Live test matrix (this session)

| Case | Result |
|------|--------|
| Load unpacked 1.1.0, no Errors | Pass; welcome wizard |
| Unit tests after `._*` cleanup | 214/214 |
| Preflight | Pass |
| Kefir + Open Food Facts ~30 | Pass; barcode footer |
| Kefir OCR alone ~31 | Pass; label-photo footer |
| OFF+OCR both on | OFF can win; OCR skipped if barcode usable |
| Clear + OFF/OCR off + shared ON | Still scored from shared OCR (issue 3.4) |
| Clear + OFF/OCR off + shared OFF | Paste box Pass |
| Search gate shoes vs organic oats | Pass |
| Sort score + $/oz + side panel | Pass |
| Unit price olive oil 24 listings | Pass |
| Target oats A-79364857 | 95 Excellent, local |
| Report privacy UX | Pass |
| Avoid list | Pass |
| Master switch | Pass |
| Compare | Amazon ASINs only (Target gap) |
| Non-food + Score anyway | Pass → paste |
| Allergen Milk flag | Pass; score unchanged |
| Vegan diet flag | Pass; score unchanged |
| Goals Weight loss / Vitamins on kefir | Pass; plus-for-goals |
| Whole-food olive oil | Pass; base/bonus shift |
| Paste happy path | Pass (80 Good); organic over-claim noted |
| Hover breakdown | Pass |
| amazon.co.uk oats search | Chips Pass; PDP OOM on VM |
| amazon.de haferflocken search | Chips + sort Pass |
| amazon.de oatmeal PDP | Scored 72; advisory wheat issue |
| Vitamin D3 supplement PDP | Soft non-food (issue 3.3) |
| Request a store scrub + mailto | Pass |
| Diagnostics send 1 row | Pass |
| Multipack Bob’s 4-pack | 95 Pass |
| Settings backup UI copy | Clear (restore not executed) |
| Dark mode popup links | Fail contrast |
| Speed Balanced ↔ Fastest | Pass; restored Balanced |

---

## 6. Suggested immediate PR slices

1. **Accuracy PR:** may-contain / “not suitable for” not scored; tests with DE oats fixture + may-contain paste.  
2. **Food-gate PR:** `Diet Supplements` + tests; optional Supplement Facts.  
3. **Pack hygiene PR:** `._*` gitignore/pack/sanity.  
4. **UX honesty PR:** Clear label + shared refill toast; optional cached-`via` respect for OFF/OCR.  
5. **Polish PR:** dark-mode CSS; DE strings; provenance organic regex; Target parseKey.

---

## 7. Artifacts

- Shorter running notes also at: `FINDINGS-2026-09-27.md` (same folder).  
- Extension under test remains the Drive project `ingrediant_check` (historical spelling).  

*End of audit notes — compiled from live Chrome sessions and code traces on 2026-09-27.*
