# Ingredient Check 1.1.0 — Audit addendum (parallel QA)

**Date:** 2026-09-27 (America/New_York)  
**Purpose:** Gaps and live re-checks from a second QA pass that are **not** covered (or only lightly covered) in `INGREDIENT-CHECK-AUDIT-2026-09-27.md`.  
**Tree under test:** `/workspace/ingredient_check` (copy of Drive `ingrediant_check`); Drive tree was **not** modified in that session.  
**Extension ID (this pass):** `ngmjaghklkcmhodglbilcfoadbngfpnl`

---

## A. Missing P1 — Side panel “Open in new tab” silent no-op / `about:blank`

| Field | Detail |
|--------|--------|
| **What** | From the Chrome side panel sorted list, **Open in new tab** often fails silently. README advertises the control next to **Back to Amazon search**. |
| **Root cause** | `src/options/sorted.js` `openInTab` creates a tab without a reliable `windowId` when the side panel is the opener; failure is swallowed (`catch` empty / no user feedback). Settings / Back can hit the same class of messaging fail. |
| **Live before patch** | Click did nothing useful; no toast. |
| **Fix applied on box copy only** | Pass a real `windowId`, surface failure via locale string `sortedOpenTabFail`, same pattern for Settings/Back feedback. Diff: `ingredient_check-suggested-fixes/0004-sorted-open-new-tab.diff`. |
| **Live after reload** | **PASS** — real tab titled “Sorted list — Ingredient Check” at `chrome-extension://…/src/options/sorted.html` with ranked cards; **Back to Amazon search** restored focus to the search tab. |
| **Ship note** | Still **unfixed on Drive** until those files are copied back. Treat as open until synced. |

---

## B. Missing P1 — Target paste fallback can score junk as Excellent ~90

| Field | Detail |
|--------|--------|
| **What** | When Target Label info is collapsed / unreadable, paste/fallback path can accept boilerplate (“see label”, similar) and score it like a clean single-ingredient food (**Excellent ~90**). |
| **Why it matters** | False confidence on Target preview pages; opposite of the careful Amazon paste/OCR refusal paths. |
| **Status this session** | Flagged from code + prior notes; full live “Label info collapsed → junk paste” repro was queued when continuous QA stopped. Still needs a recorded screenshot before closing. |
| **Fix direction** | Tighten Target paste gate / refuse low-signal strings; mirror Amazon “does not look like ingredients” handling. |

---

## C. Missing P2 — Popup too tall on short displays (~800px)

| Field | Detail |
|--------|--------|
| **What** | On the box desktop (1280×800), the toolbar popup content exceeds the usable height so lower actions / click targets are awkward or effectively click-through. |
| **Fix direction** | Cap max-height + internal scroll; verify on laptop / short Chromebook viewports before CWS screenshots. |

---

## D. Missing P2 — `harness:ci` vs live harness port clash

| Field | Detail |
|--------|--------|
| **What** | `npm run harness:ci` always binds `127.0.0.1:8731`. If `npm run harness` is already up → `EADDRINUSE` and a red CI run. Clean retry alone → **PASS**. |
| **Fix** | Reuse existing server, pick a free port, or fail with a clear “kill harness first” message. |

---

## E. Packaging — AppleDouble (confirms audit §3.1; patch status)

| Field | Detail |
|--------|--------|
| **Confirm** | ~176 `._*` AppleDouble files on the Drive-synced copy broke sanity (`node --check` on binary sidecars). |
| **Box patches applied** | `.gitignore`, `pack.mjs`, sanity `walk()` skip `._*` (`0001`–`0003` diffs under `ingredient_check-suggested-fixes/`). |
| **After cleanup on box** | `npm test` **214/214**; preflight green. |
| **Drive** | Source folder still needs the same hygiene before a Mac/CWS zip. |

---

## F. Extra live variety matrix (additive keeps)

These passed on Amazon US / UK with the patched box build; useful as regression anchors alongside the main audit matrix.

| Case | Result |
|------|--------|
| Soybean-oil mayo paste (`B00I8GN37A` representative list) | **25 Poor**; numbered **DISQUALIFYING** soybean oil caps score at 25; sugar also listed under WHAT HURT |
| Shampoo PDP (`B08SSM21R4`) | **Not scored — this does not look like food**; **Score anyway** → paste card (no crash) |
| US honey paste (`B00CMQD3VS` → `Honey`) | **85 Good**; −5 concentrated sweetener |
| amazon.co.uk olive oil (`B088HQV9TX`) auto-extract | **96 Excellent**; + minimally refined fat / single-ingredient bonuses |
| Master switch off on US food PDP | Full stand-down (no panel/badges/watcher); on restores |
| amazon.co.uk grocery search | Chips + auto-rate notice OK; no captcha this pass |
| Side panel Open in new tab (post-fix) | **PASS** (see §A) |

Kefir OCR ~31 Poor and shoes-vs-oats search gate also **PASS** on this pass (same as main audit).

---

## G. CWS / privacy notes (overlap with audit §3.5 / §3.12 — ship checklist)

Already in the main audit; keep on the CWS checklist before upload:

1. Drop or justify inert **`identity`** (`OAUTH_CLIENT_ID` empty).  
2. Justify **`unlimitedStorage`** in store-listing copy.  
3. Do not describe the Apps Script shared endpoint as a user-optional host if `ENDPOINT` is baked and `sharedCache` defaults on.  
4. Single-purpose / listing copy should mention **Target preview**, not Amazon-only.  
5. Revisit default-on **`autoScoreSearch`** (Skip setup leaves defaults true).

Suggested listing bullets drafted at: `ingredient_check-suggested-fixes/PRIVACY-CWS.md` (box only).

---

## H. Artifacts on the box (not necessarily on Drive)

- `/workspace/ingredient_check-findings.md` — rounds 1–8 detail  
- `/workspace/ingredient_check-backlog.md` — top-10 + ship blockers  
- `/workspace/ingredient_check-suggested-fixes/` — diffs + PRIVACY-CWS.md  
- Continuous hourly QA routine was **paused** on user stop

*End of addendum.*
