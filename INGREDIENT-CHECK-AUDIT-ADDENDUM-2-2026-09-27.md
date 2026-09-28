# Ingredient Check 1.1.0 — Audit addendum 2 (continuous live QA)

**Date:** 2026-09-27 (America/New_York)  
**Purpose:** Gaps and live numbers from a third continuous QA pass that are **thin or missing** in `INGREDIENT-CHECK-AUDIT-2026-09-27.md` and `INGREDIENT-CHECK-AUDIT-ADDENDUM-2026-09-27.md`.  
**Tree under test:** `/workspace/ingrediant_check` (Drive copy; **source not patched** this pass)  
**Extension ID:** `makjklodcnakffeaghipcgenpcipfcpn`  
**Baseline:** Master ON · Balanced · shared cache typically ON · settings restored to Balanced after goal experiments  

Companion engineering backlog (prioritized Do-next): `/workspace/ingredient-check-backlog.md`

---

## Conflict / reconciliation with addendum 1

| Topic | Addendum 1 (`ngmjaghklkcmhodglbilcfoadbngfpnl`) | This pass (`makjklodcnakffeaghipcgenpcipfcpn`) |
|--------|-----------------------------------------------|-----------------------------------------------|
| Side-panel **Open in new tab** | Silent no-op / `about:blank`; patched PASS on that box copy only | **Clean this trial:** Open → `sorted.html` immediately; product `<a target=_blank>` ~1–2s `about:blank` then PDP; **0 orphan blanks** |
| Drive sync of open-tab fix | Still unfixed on Drive | Confirms Drive still needs the `windowId` / feedback fix for hosts that still fail |

Treat open-in-tab as **intermittent / environment-sensitive** until Drive has the sorted.js fix and harness coverage.

---

## A. Missing P1 / P2 — Sort title truncation (Monster Ultra) → unit-price sink

| Field | Detail |
|--------|--------|
| **What** | Side-panel / sorted titles prefer the brand `<span>` inside `h2`, not the full `.a-text-normal` title. |
| **Live** | `https://www.amazon.com/s?k=monster+ultra` — **38/48 (79%)** brand-only titles (`Monster`, `GHOST`, `C4`, `Alani Nu`, `CELSIUS`). Only **10/48** full titles. |
| **Root cause** | `src/content/sort.js`: `card.querySelector('h2 span:not(.air-badge)') \|\| …` grabs the brand chip first on modern branded cards. |
| **Impact** | `parseQuantity(title)` never sees `16 Fl Oz` / `Pack of 15` → `unitSource: 'none'` → multipacks sunk under $/oz ranking. |
| **Fix** | Prefer complete `a-text-normal` (or outermost title link text) over brand-only span; add Monster-shaped regression. |
| **Status** | Open on Drive; high priority for sort UX honesty. |

---

## B. Missing P1 / P2 — Unit-price / `NUTRIENT_AFTER` anomalies (concrete ASINs)

| ASIN | Product shape | Live result | Mechanism |
|------|---------------|-------------|-----------|
| `B000GISTZ4` | ON Gold Standard whey 5 lb (`24g … 5.5g BCAA, 5 lb`) | **null** $/oz | `NUTRIENT_AFTER` knows `protein` but not `BCAA`/`MCT`/`serving`; `5.5g` vs `5 lb` disagree (>2%) → `parseQuantity` aborts |
| `B0106R5L8S` | Dymatize ISO100 3 lb | **null** $/oz | Same nutrient-gram vs tub-size clash |
| `B07BFG26QW` | Think! high-protein bars | Absurd **~$8.80–14.50/oz** | Lone `20g Protein` treated as package ounces when box weight absent from title |
| `B0073V8M2A` | Monster 16 Fl Oz × 24 (`384 Fl Oz Total`) | **null** or absent | Unequal volumes `16` vs `384` abort; no `24×16` recognition |

**Fix direction:** Extend `NUTRIENT_AFTER`; never promote nutrient grams to package ounces; recognize fluid×count and total-volume equivalence; keep olive-oil-style controls that already pass.

---

## C. Missing P1 — Natural flavors dial vs hard UPF / NOVA cliff

Paste path (RXBAR-shaped list):

| Scenario | Score | Verdict | NOVA |
|----------|------:|---------|------|
| Balanced, with “Natural Flavors” | **52** | Mediocre | **4** |
| NF dial **0.0×** | **65** | Mediocre | **4** (hard UPF still counted) |
| NF dial **−2.0×** | **85** | Good | **4** (+20 goal reward) |
| Same list **without** “Natural Flavors” | **85** | Good | **3** |

**Code:** `add.FLAVOURS` tagged `upf: 'hard'`; `score.js` increments `hardHits` independent of `w_('naturalFlavour')`; `novaClass` returns 4 if `hardHits > 0`; NOVA 4 base 60 vs NOVA 3 base 80.

**Copy problem:** Settings / `categories.js` say a goal can “nearly switch it off.” True for the **point penalty**, false for **NOVA / base**.

---

## D. Missing P1 — Skip setup bypasses auto-rate / shared-cache disclosure

| Field | Detail |
|--------|--------|
| **What** | `welcome.js` Skip handler only `chrome.storage.local.set({ onboarded: true }, closeTab)`. |
| **Defaults left ON** | `autoScoreSearch: true`, `sharedCache: true` (`prefs.js` `TOGGLE_DEFAULTS`). |
| **Bypassed** | Welcome step 4 copy that discloses signed-in Amazon product-page fetches (up to 60/page) and shared DB reuse. |
| **Also** | Welcome can persist `useOpenFoodFacts: true` while `permissions.request` still pending (Finish race — backlog P2-5). |

---

## E. Missing P2 — Goal averaging + refined-oil hard-cap clamp (misleading UI)

**Combine rule:** Arithmetic mean of overlapping dial votes (`categories.js` `goalWeights`); only `vitamins` has `focus: ['fortification']`. Averaging can cross zero (e.g. Animal-based + Weight loss → honey dial +0.4).

**Live clamp (Califia oat milk + sunflower oil):**

| Goals | Score | What the UI shows |
|-------|------:|-------------------|
| Weight loss + Vitamins | **18 Avoid** | Cap `100 − 75 × 1.1 → 18`; Disqualifying row invents large negative “caps score at 18” (−31), wiping fortification (+8) / salt pluses |
| Animal-based | **3** | `refinedOil` 1.8× → floor clamp; “caps score at 3” (−30) |
| Balanced (restore) | **25 Poor** | Standard 25-point seed-oil cap |

**Reward cap:** `GOAL_REWARD_CAP = 20` confirmed — dairy + vitamin A paste hit +18 / +2 → 74 Mediocre.

---

## F. Missing P1 — Report export privacy defaults + hardcoded support email

| Field | Detail |
|--------|--------|
| **Default** | Report `#inc-settings` **checked**; `report-data.js` `settingsFrom` copies allergens, diets, `avoidList` into mailto/HTML when settings kept. |
| **Live good path** | Unchecking settings → `Settings: left out`; allergens / avoid list **stripped** from preview and mailto body (bulk toggle works). |
| **Gap** | No per-field medical-prefs opt-in; default still ships sensitive prefs. |
| **Mailto** | `mailtoFor` fallback **`jackson29382938@gmail.com`**; also `store-request.js` `REQUEST_EMAIL` + options copy. Replace with support alias before CWS. |
| **Search URLs** | `pageAddress` / sorted summary can retain `?k=` / `searchTerm`; `activity.js` `clean()` strips to origin+pathname (nuance vs older notes). |

---

## G. Missing P1 / P2 — FR/DE staple paste coverage vs DE host extract

| Input | Host / path | Result |
|-------|-------------|--------|
| Paste `Haferflocken` | US paste card | **Coverage reject** (`coverage: 0`, `lowCoverage: true`) — no score shown |
| Paste `flocons d'avoine` | US paste card | **Coverage reject** (same) |
| Paste `Organic rolled oats` | US paste card | **95 Excellent** (control) |
| Alnatura search chips | `amazon.de` | ~**95 / 88** chips |
| PDP `B0G5FF8YQV` `Hafervollkornflocken*` | `amazon.de` | **88 Good** with “Only 50% of this list was recognised” |

**Also:** No custom-synonym UI in Settings (foreign synonyms are hardcoded regexes in `src/engine/db/*.js`). Suggest `avoine` / `hafer` / `avena` in `COMMON_PANEL`; separate low-coverage from unreadable so valid paste scores are not discarded.

---

## H. Missing P2 — `packaged in a facility` blocks paste submit

| Paste on `B00LR30OB4` | Result |
|-----------------------|--------|
| `Organic Red Quinoa` | **95 Excellent** |
| `Organic Red Quinoa. Packaged in a facility that also processes tree nuts and wheat.` | **Score disabled** (`aria-invalid`); `looksLikeIngredients` / `pasteLooksValid` false — `stripBoilerplate` handles `packed in/by` but not `packaged in` |

EN clean short lists still pass. Related: may-contain / facility lines scored as ingredients is already audit §3.2.

---

## I. Missing P2 — Home & Kitchen food-gate twin ASINs

| ASIN | Listing | Result |
|------|---------|--------|
| `B012W327D0` | Sensible Portions Veggie Straws 7 oz (title ends **Home & Kitchen**) | **Not food**; Score anyway → paste (no ingredients/OCR) |
| `B00HKLK3X6` | Same brand 24-pack (not H&K) | Passes food gate → ingredient read/paste |
| `B07DD5YHMH` | Anker USB cable | Correct not-food; search fully stands down |

Search shows **no badge** for gated not-food straw (not a `?` chip disagreement). Soften H&K when nutrition evidence coexists; harvest NIC text better.

---

## J. Missing P2 — Open Food Facts in-flight double-fetch

| Field | Detail |
|--------|--------|
| **Code** | `background.js` `lookupBarcode`: storage check then fetch; **no** pending promise map. Concurrent callers can double-GET `world.openfoodfacts.org`. |
| **Live** | Many Amazon PDPs never expose UPC in bullets → OFF often not tripped; race is structural / hard to catch on grocery PDPs. |
| **Tests** | Concurrent OFF sharing test was sketched then **missing** from `tests/background.test.js` on this tree (suite green without it). Re-add when fixing. |

---

## K. Compare UI (softening)

Full-tab `popup.html` Compare with 2+ cached products: `#compareA` / `#compareB` **PASS** this Linux trial (no intermittent dismiss). Compare UI is **absent** from `options.html` (only sort “Products to compare” label). Keep low-priority flake note if prior sessions saw popup dismissal.

---

## L. chrome://extensions details presentation

Chrome **Permissions** UI shows only **Site access** (21 Amazon hosts + optional OFF + Target content script). Declared `identity` and `unlimitedStorage` are **silent** — never listed for the user. Aligns with CWS story work in audit §3.12 / addendum G.

---

## M. Extra keeps from this pass (do not regress)

- Shared DB toggle OFF→ON updates storage immediately; Califia PDP panel remounted cleanly (Balanced seed-oil **25 Poor**).
- Goal reward rows render when expected (calcium fortification; fat-reduced dairy + synthetic A).
- Report settings unchecked path strips medical prefs from mailto preview (bulk control works).
- USB / non-food search stand-down; Balanced restore after goal experiments.
- DE host oat extract can score with partial-coverage caveat (contrast with bare-word US paste reject).

---

## N. Suggested PR slices (this pass only — additive to main audit §6)

1. `sort.js` title node preference + Monster Ultra fixture.  
2. `unit-price.js` nutrient-after + fluid×count / total-volume.  
3. `stripBoilerplate` / `looksLikeIngredients` for `packaged in a facility` + single-ingredient + advisory.  
4. Coverage gate vs unreadable split; `COMMON_PANEL` staples (`avoine`, `hafer`, `avena`).  
5. Welcome Skip → confirm defaults or force step 4; NF settings copy vs hard UPF; optional soft-UPF.  
6. Report default-exclude medical prefs; support alias mailto; goal×oil-cap UX.  
7. Sync open-in-tab `windowId` fix from addendum 1 onto Drive.

---

## O. Artifacts

- `/workspace/ingredient-check-backlog.md` — full prioritized backlog (P2-26 oil-cap, paste coverage, etc.)  
- `/workspace/ingrediant_check` — extension under test (unpatched this pass)  
- This file: `/workspace/INGREDIENT-CHECK-AUDIT-ADDENDUM-2-2026-09-27.md`

*End of addendum 2.*
