# Ingredient Check 1.1.0 — Audit addendum 3 (continuous multi-storefront QA)

**Date:** 2026-09-27 (America/New_York)  
**Purpose:** Gaps from a continuous signed-out multi-storefront pass that are **thin or missing** in `INGREDIENT-CHECK-AUDIT-2026-09-27.md`, `INGREDIENT-CHECK-AUDIT-ADDENDUM-2026-09-27.md`, and `INGREDIENT-CHECK-AUDIT-ADDENDUM-2-2026-09-27.md`.  
**Tree under test:** `/workspace/ingrediant_check` (box copy; **easy-win patches applied on box only** — Mac Drive source **not** modified this pass)  
**Extension ID (box):** `makjklodcnakffeaghipcgenpcipfcpn` · v1.1.0  
**Baseline:** Master ON · Food-only ON · Balanced · Shared cache typically ON · OCR ON · signed-out Amazon  
**Stop:** Continuous QA halted on user `stop` (2026-09-27 ~15:40 ET); PL re-verify after §9 was interrupted.

---

## Conflict / reconciliation

| Topic | Prior room docs | This pass |
|--------|-----------------|-----------|
| Shared cache integrity | Mentioned as quiet failures / default-on / Clear refill | **Live poison incident** with concrete key + no purge API (below) |
| PL / OCR | Not in audit or addenda 1–2 | **P0/P1** English OCR invents Excellent on PL; shared row sticks |
| Regional DOM (UK/CA/IE/DE/MX/BR) | Thin or absent in the three published audit files | Confirmed live + box patches §1–7 |
| Open-in-tab | Addendum 1 silent fail vs addendum 2 clean | Not re-tested this pass after `stop` |

---

## A. P0 / P1 — Live shared-DB poison: `amazon.pl:B00MCJ3180`

| Field | Detail |
|--------|--------|
| **What** | Polish multipack ASIN `B00MCJ3180` scored **90 Excellent** via `label-ocr` on a **German chocolate fragment** from a pack image. Native Polish DOM lists correctly hit the coverage gate; `showFailure` then called `tryOcr` because `localeStatus('amazon.pl')` fell through to `{ locale: 'en', ocrReady: true }`. |
| **Persistence** | After local `s:` / `p:` clear **and** boxing `ocrReady: false` for PL, the PDP **still** served **90 Excellent** from `productsLookup` — prior shared `via: label-ocr` row. Invented Latin OCR often scores high against English rules, so coverage cannot catch it. |
| **Owner action (required)** | Purge sheet row **`amazon.pl:B00MCJ3180`**. Apps Script has **no delete/purge kind** (only `lookup` + `products` upserts/pulls per `docs/CACHE.md`). Extension cannot remove the key; overwrite with an honest upsert or delete the sheet row manually. |
| **Box mitigations (§8–9, not on Drive)** | Add `pl` to `OCR_NOT_READY`; `localeStatus` → `{ locale: 'pl', ocrReady: false }`; `ocrReadingBlocked(via)` rejects shared/local `label-ocr`/`ocr` when host declines OCR (`sharedOk` / `freshLocal` / `usableCache`). Re-verify interrupted by `stop`. |
| **Why missing from prior audit MD** | Audit §3.4 covers Clear + shared OCR refill UX; it does not record this ASIN, the English-OCR-on-PL path, or the lack of a purge API. |

---

## B. P0 / P1 — Shared product DB is default-on and anonymously writable

| Field | Detail |
|--------|--------|
| **What** | `TOGGLE_DEFAULTS.sharedCache: true`; content uploads shared rows by default; `ENDPOINT` is baked into the build; Apps Script deploy is **Who has access: Anyone** (lookup + upsert). Docs already note a plausible fake read can be served until stale (~30 days or 100 pulls). |
| **Impact** | Poisoned rows affect **scores and allergen/diet flags** for other installs — not only the writer. Incident A is the live proof. |
| **Fix direction** | Shared cache opt-in; disable anonymous upserts (lookup-only from clients); controlled/signed ingest; treat shared rows as untrusted; never let shared imply allergen clearance; add purge/admin tooling. |
| **Files** | `src/engine/db/prefs.js`, `src/content/page.js`, `src/content/search.js`, `docs/apps-script.gs`, `docs/CACHE.md` |
| **Vs prior audit** | Audit notes baked endpoint + quiet failures; addendum 1 notes “do not call it user-optional.” Neither frames **Anyone-writable + live poison** as a ship blocker. |

---

## C. P1 — Regional live / DOM gaps (confirmed this pass)

| Store / area | Observed | Severity | Box patch? |
|--------------|----------|----------|------------|
| **UK** `B0168UUHQ2` | Granola title **2 < 4** food-gate (`granola` missing from `WEAK_POSITIVE`); empty `display:none` `#nic-ingredients-content` masked `#important-information`; expanding NIC → **25 Poor**; early `not-food` settle disconnected forever | High | §1 granola/muesli; §4 skip empty NIC; §5 soft settle |
| **CA** | Same NIC-mask / fail-card pattern; `#centerCol` often missing signed-out | High | §3–5, §6 mount |
| **IE** | `#nutritionalInfoAndIngredientsEU_feature_div` hydrates late; panel stuck on weak `#feature-bullets` / `#dp` | High | §3 EU selectors; §7 `ensureHost` remount |
| **DE** | `Bestandteile` absent from `INGREDIENT_HEADING`; native coverage ~**0.34–0.36** cliff; native score example **57** @ 36.4% | High | §2 Bestandteile |
| **AU** II-only `B0FP1KSTV6` | **25 Poor**, search badge OK — cleaner baseline | OK / keep | — |
| **MX** Oreo `B0CWMQ9223` | **25 Poor**; mount often top-of-`#dp` without `#centerCol`; locale should be `es` | Med | §6 MX→es + II mount |
| **BR** Biscoff `B07FN8T31H` | **32 Poor**; same mount; locale `pt` + PT delimiters missing | Med | §6 BR→pt + PT stop headings |
| **IT** | **35** @ 45% coverage — partial, not complete-list certainty | Med | note |
| **NL** | No-ingredients product fails honestly | Keep | — |
| **PL** | See §A | Critical | §8–9 |

Also: English `Accept-Language` bias on DE/FR box Chrome; `mountPoint()` exact-ID miss for regional feature IDs before §3.

---

## D. P1 / P2 — Already in FINDINGS summary but thin in the three audit files

Worth carrying into the combined backlog even if partially echoed elsewhere:

1. **Allergen empty-state** looks like clearance when flags are empty (`panel.js`); incomplete list must never read “clear.”
2. **Paste scores** are intentionally tab-local (no `s:` / `p:`); document, don’t “fix” as cache bug.
3. **Report / side-panel:** search score null by `isProductPage()`; stale panel across navigation; `chrome://` capture empty.
4. **SERP OOM** risk with auto-rate + many tiles (logged this pass).
5. **OCR honesty:** “label photo was checked” over-broad; distinguish no-images / no-block / rejected / engine-error (`B00LOAW7U6` verify).
6. **Welcome Skip** leaves `autoScoreSearch` + `sharedCache` at true defaults (addendum 2 covers Skip disclosure; keep tied to §B integrity).
7. **Store evidence:** 21 Amazon hosts declared; live-capture corpus thin; empty `identity` OAuth still required.
8. **Packaging:** AppleDouble `._*` (covered in audit §3.1 / addendum 1 — confirm only).

---

## E. Keeps (this pass)

- Closed shadow DOM, HTML escaping, OCR URL allowlist, message allowlists, private `manual-paste`.
- Soft non-food → Score anyway / paste rather than inventing (when OCR not poisoning).
- AU II-only and NL no-ingredients honest fail paths.
- Paste privacy (no shared upload of manual paste).
- After box patches: UK cold-load still **25 Poor** but hidden empty NIC skipped and II remount survives; `npm test` **222 pass**, preflight green on patched box tree.

---

## F. Box-only patch inventory (Drive source still needs these)

Documented in `/workspace/ingrediant_check-box-patches.md` (also copied under Coding on Mac earlier):

1. granola / muesli food-gate (+ dedicated +4 rule)  
2. `Bestandteile` in extract matchers  
3. EU NIC + `#importantInformation_feature_div` selectors  
4. Skip empty / `display:none` NIC  
5. Soft not-food settle (don’t disconnect forever)  
6. MX→es / BR→pt + Portuguese delimiters + II mount without `centerCol`  
7. IE `ensureHost` remount from weak anchors  
8. PL `ocrReady: false` / `OCR_NOT_READY`  
9. Reject shared/local `label-ocr`/`ocr` on OCR-declined hosts  

**Not on Drive until copied.** Mac repo was left untouched by request/default.

---

## G. Immediate owner / eng actions

1. **Manually delete** shared sheet row `amazon.pl:B00MCJ3180` (or overwrite with honest DOM extract).  
2. Treat **Anyone-writable shared DB** as P0 before marketing shared scores / allergens.  
3. Land box patches §1–9 (or equivalent) on Drive / PR; re-run PL verify after purge.  
4. Merge this addendum with audit + addenda 1–2 into one backlog; do not drop the live poison ASIN.

---

*End addendum 3 — continuous multi-storefront QA (stopped 2026-09-27).*
