# Ingredient Check 1.3.1 — consolidated audit

Date: October 1, 2026 (America/New_York). Commit: `c162dca304afbd08f23f8160d6017fa51f0906d7`.

## Integration follow-up

The subsequent [complete scoring/preset/default review](docs/SCORING-CALIBRATION-2026-10-01.md) inventories every contributor, implements neutral baseline and integrity fixes, and adds exhaustive factor and preset-combination regressions.

The release follow-up also fixes concurrent profile backup collisions, saves three real English labels, closes shared product exchange in this build, adds owner-only purge tools, and expands browser checks to narrow windows, zoom and the accessibility tree. See [the release validation and remaining external checks](docs/RELEASE-VALIDATION-2026-10-01.md).

The audit below records the original findings. Subsequent implementation in this working tree addresses A01–A06: byte-sized, staged Chrome backups with failure status and alarm retry; complete workflow preferences in backups; Target cache invalidation and toolbar clearing with asynchronous generation guards; UK/Irish imperial volume conversions; and corrected README/privacy/store copy.

The account review also found that the settings reload after restore did not reread goals and their importance, allowing the old page state to overwrite them on exit. That is fixed and covered by a real Chrome restore/reload check. Google sign-in now has local public-client configuration, optional identity permission, redirect/state/token validation, cancellation handling, and server-side client matching through an owner-controlled Script Property. Tokens are not persisted. Chrome profile settings have their own entry point.

The updated Node suite passes all 371 tests on Node 20, 22 and 24; lint, preflight, packaging, and the full browser harness pass, including a real Unicode backup and restoration of goals, sort, and freshness. Google token and account-storage tests use controlled responses, and receiver tests verify account isolation. The production health check succeeds, but the account read explicitly returns `accounts are not configured`. Live Google sign-in and cross-device Chrome synchronization are still outstanding; see [Google setup](docs/GOOGLE-SIGN-IN-SETUP.md). Changes are local and have not been published or deployed.

The earlier statements that application code was unchanged and all findings were open describe the audit-only pass, not this follow-up implementation. Historical live-store findings remain subject to the evidence limits listed below.

This audit combines current code inspection, fresh automated runs, targeted reproductions, and reconciliation of the September 27 audit and its three addenda. Application code and tests were not changed. This is an engineering audit, not validation of nutritional or medical claims. It does not establish that every product, language, retailer layout, or production backend works.

## Results and priority

Five current defects were reproduced. One documentation defect was confirmed by inspection. No new P0 or P1 defect was established in this pass. P2 means a correctness or reliability issue affecting a bounded workflow; P3 means documentation or polish. Historical P0/P1 labels are not automatically carried forward to version 1.3.1.

| ID | Priority | Current finding | Evidence |
|---|---|---|---|
| A01 | P2 | Valid Unicode avoid lists can exceed Chrome sync's per-item quota; backup failure is silent | Real Chrome quota rejection |
| A02 | P2 | Target result badges survive deletion or invalidation of their backing cache | Existing runner/fixture reproduction |
| A03 | P2 | Target toolbar retains the previous product score after SPA navigation | Existing runner/fixture reproduction |
| A04 | P2 | Settings backups omit speed and sort preferences | Backup/restore round trip |
| A05 | P2 | UK pint/quart/gallon sizes use US volume conversions | Direct quantity parser reproduction |
| A06 | P3 | README describes network features as default-on although defaults are off | README versus settings sanitizer |

### A01 — Unicode avoid lists break automatic backup

Location: `src/engine/db/prefs.js:203` and `src/background.js:749`.

The sanitizer accepts up to 80 terms of 80 JavaScript characters each. `toSyncItems` puts all terms into one `icBackupAvoid` item and assumes that is about 6.5 KB. Chrome measures encoded bytes, not character count. Eighty unique terms padded with `漢` produce a 19,154-byte item, above the 8,192-byte per-item limit. The real extension's `chrome.storage.sync.set` rejects this payload with `Resource::kQuotaBytesPerItem quota exceeded`. The debounced caller catches and ignores errors, so the user receives no failed-backup indication and an older backup can remain.

Fix: chunk the list by serialized UTF-8 byte size, version the storage format, retain backward compatibility, and show backup failures. Do not truncate valid avoid terms silently. Regression checks should include accented/CJK/emoji terms near quota boundaries and restoring an older successful backup after a rejected write.

### A02 — Target badges are not removed when a score becomes invalid

Location: `src/content/retailer.js:185`.

`searchPass` paints valid entries but has no branch removing an existing badge when its entry is missing, expired, or invalid. Cache keys are also absent from the settings-change listener. Reproduction: paint the cached oats score 98 on the saved Target results fixture, delete `s:target.com:79364857`, then run another pass. The badge remains connected and still reads 98. A later mutation does not heal it. Expiration and recycled result anchors create related stale-display risks.

Fix: remove badges for invalid/missing entries and refresh when relevant cache entries change. Guard asynchronous callbacks against navigation and changed settings. Test deletion, expiration, settings changes during reads, and virtualized tile reuse. The deletion behavior is reproduced; actual Target virtualization and callback races are not reproduced here.

### A03 — Target toolbar score survives navigation away from a product

Location: `src/content/retailer.js:230`.

`reset` clears the local `pageScore` and panel but sends a clear message only when the extension is disabled. It returns immediately on an unsupported page; search pages also do not send a replacement product score. Reproduction: score the saved Target chips fixture (96), change the same tab's URL to `/c/grocery/-/N-5xt1a`, and invoke the same reset used by the SPA navigation poll. The only worker message remains `{type:'pageScore', score:96, verdict:'Excellent'}`. The worker therefore has no instruction to clear the old toolbar score.

Fix: clear the action badge at the start of navigation/reset before attempting a new score. Test product → search, product → category, and product → a product waiting for its label.

### A04 — Backup is incomplete for newer settings

Location: `src/engine/db/prefs.js:179` and `src/background.js:744`.

`backupPayload` includes scoring settings, toggles, and breakdown display settings. It omits `speedMode`, `sortMissing`, `sortLoadMore`, `sortCount`, and `unitMissing`; the worker's source-key list also excludes these fields. A round trip with `speedMode:'freshest'`, `sortCount:500`, and `sortLoadMore:true` restores none of them. This contradicts the helper's description of backing up everything the user chose and prevents transferring freshness/sort preferences to another installation.

Fix: include and sanitize these preference groups in the source keys, payload, and restore path. Preserve compatibility with backups that predate them. Verify both Chrome sync and the account payload. Restoring into an existing installation currently leaves omitted values alone rather than necessarily resetting them.

### A05 — UK volume units use US definitions

Location: `src/engine/db/unit-price.js:32`.

The unit table maps every pint to 16 US fluid ounces, every quart to 32, and every gallon to 128 regardless of storefront. An imperial UK pint is 568.26125 ml, approximately 19.2152 US fluid ounces. `parseQuantity('Milk 1 pint','amazon.co.uk')` returns 16; `parseQuantity('Milk 1 litre (1.76 pints)','amazon.co.uk')` returns null because the equivalent-size check sees unequal quantities. A £1 one-pint product would be calculated at approximately £0.2113/100 ml instead of £0.1760/100 ml, about 20% too high. Affects calculated prices and displayed prices expressed per these units. Explicit ml/litre parsing is unaffected.

Fix: make volume definitions storefront-aware or decline ambiguous imperial-unit titles. Add UK pint/quart/gallon cases and retain US cases. Establish a policy for imported listings whose titles explicitly say US pint.

### A06 — Default-network behavior documentation is stale

Location: README sections “What it does” and “Network”; also opening comments in `src/background.js` and `src/engine/db/prefs.js`.

README says the shared database and automatic search rating are on by default. `TOGGLE_DEFAULTS` sets `autoScoreSearch`, `sharedCache`, and `sharedProducts` to false. README also says the shared endpoint is inert until set, while this build includes a nonempty endpoint. A configured endpoint is not evidence of connectivity or automatic network use; feature gates remain relevant.

Fix: reconcile README, privacy/store copy, setup disclosures, and code comments against the actual defaults and shipped endpoint. Distinguish default values on a new installation from retained preferences in upgraded installations.

## Verification performed

| Area | Result | Practical limit |
|---|---|---|
| Node suite | 359 passed, 0 failed, 0 skipped | Fixture/spec coverage, not all real labels |
| Preflight | Passed | Manifest/assets/localization consistency |
| ESLint | Passed, zero warnings | Static checks |
| Full browser harness | Passed, exit 0 | Saved pages and controlled data |
| OCR | Vendored worker initialized successfully | Does not establish accuracy on arbitrary label images |
| Extension startup | Worker loaded all modules; six pages checked | Chrome for Testing 153; not Chrome 116 |
| Product/search behavior | Oats scored 98, shampoo rejected, two search badges scored | Saved Amazon fixtures, no live shopping requests |
| Packaging | `npm run pack` succeeded | Store submission itself was not performed |
| Target edge cases | A02/A03 reproduced using existing runner and saved fixtures | Not a live Target SPA recording |
| Chrome sync edge case | A01 reproduced in a disposable real-extension profile | Local sync storage API, not cross-device synchronization |

Browser: pinned Playwright 1.63.0 and Chrome for Testing 153.0.8010.12. Node: 24.19.0. System Chromium was not used for this audit's full extension harness because it previously failed to load the extension worker.

Reproduction scripts and concise output are saved outside the repository at `/workspace/extension-audit/probes.cjs`, `/workspace/extension-audit/browser-quota.cjs`, and `/workspace/extension-audit/probe-results.txt`. Run the probes with Node. The fixture probe compiles a read-only copy of the existing Target test helper with test registration disabled; it does not modify that test file. The browser probe creates and removes a disposable profile. Routine logs are `/tmp/audit-tests.log`, `/tmp/audit-browser.log`, `/tmp/audit-preflight.log`, and `/tmp/audit-pack.log`.

## Coverage and remaining evidence gaps

| Component | Reviewed or exercised | Outstanding validation |
|---|---|---|
| Scoring/goals/allergens | Scoring source, sanitizers, corpus/spec suites, browser panels | Independent nutritional validity; real multilingual labels |
| Extraction and food gate | Existing product/search/Target tests and saved-page harness | Current regional live DOM, late hydration, variation changes |
| Target lifecycle | Runner, adapter fixtures, navigation/cache probes | Same-URL variant changes after `stopWatching`, live virtualized tiles |
| Cache/storage | Fingerprints, row sanitization, backup and freshness code | Long-session memory, 10,000-entry datasets, multitab stress |
| Network/messages | Sender/type allowlists, opt-in gates, bounded requests, OCR URL checks | Live backend configuration, actual anonymous-write policy, remote row integrity |
| OCR/OFF | Worker smoke, source restrictions, existing tests | Real OCR accuracy and live barcode responses |
| UI/accessibility | Harness contrast, named controls, keyboard tabs, six extension pages | Screen reader sessions, zoom, short displays, popup clipping |
| Reports/privacy | Escaped HTML export, settings allowlist, URL reduction, no automatic email sending | Screenshot redaction UX and real email-client limits |
| Localization | Preflight key consistency, synthetic language twins | Human translation review and live native labels |
| Release/dev tools | Preflight, lint, packaging, pinned-browser harness | Minimum Chrome version, Node 20/22 in this machine, Web Store review |

The score corpus still has no entries tagged `live-capture` (`docs/ACCURACY.md`). Some saved retailer HTML is genuinely captured, which is a separate evidence category. Passing synthetic translation twins must not be reported as live language validation. Chrome 116 is declared but this pass used Chrome 153.

## Reconciliation of earlier audits

Source documents: `INGREDIENT-CHECK-AUDIT-2026-09-27.md` and addenda 1–3. These describe earlier builds and sometimes box-only changes. The following is a consolidated disposition, not a claim that every historical live scenario was repeated.

| Historical issue group | Current disposition |
|---|---|
| AppleDouble/packaging pollution | Packaging excludes `._*` and `.DS_Store`; clean archive checked. Keep regression coverage. |
| May-contain/facility advisories charged as ingredients | Current scoring separates advisories; relevant suite passed. Historical ASINs not rechecked live. |
| Supplement / Home & Kitchen food-gate misses | Existing ingestible/storefront suites passed; specific historical live captures remain a verification backlog. |
| Default-on auto-rating / Skip disclosure | New-install auto-rating is now false. Verify upgrade and setup wording independently; A06 remains. |
| Shared products default-on / anonymous poisoning | New key `sharedProducts` defaults false; receiver source closes reads/writes unless `PRODUCTS_OPEN` is true. Opt-in integrity risk remains if an operator opens anonymous writes. Production deployment state is unknown. |
| Polish OCR poison `amazon.pl:B00MCJ3180` | Current pipeline contains host-based OCR rejection, including cached OCR source checks. No remote row lookup/purge was done; historical poisoned-row cleanup remains unverified. |
| Regional hidden NIC / EU headings / mounting | Current extraction and lifecycle tests passed. Historical UK/CA/IE/DE/MX/BR pages require renewed live checks; do not close by inference. |
| Target Compare IDs | Score cache supports numeric Target IDs and `target.com`; general fixture tests passed. |
| Target junk paste fallback | Current runner declines low coverage and panel has a paste validator. Historical interactive junk-paste scenario not repeated; retain until exact strings are tested. |
| Allergen empty state looks like clearance | Current panel explicitly says missing warnings do not confirm allergen freedom. Preserve this wording. |
| Open-in-new-tab no-op | Browser harness exercises sorted list behavior; prior addenda disagree on live status. Actual toolbar-triggered Chrome side-panel failure paths remain live validation work. |
| Unit title truncation / nutrient-size anomalies | Unit parsing skips nutrient amounts and bounds ambiguous sizes. Specific historical listings not rechecked; A05 is a newly reproduced regional defect. |
| Natural-flavor weight versus NOVA / refined-oil goal cap | These are specification/UX questions, not newly proved bugs here. Review expected scoring semantics before changing rules. |
| Dark contrast | Current browser harness passes text contrast in checked states and light/dark extension pages. Manual zoom/OS modes remain. |
| Report screenshot/privacy defaults | Export is escaped and user-reviewed; sending remains manual. Screenshot may contain sensitive page content. No new leak established. |
| OFF duplicate in-flight requests | Current worker deduplicates by barcode; tests passed. No live request performed. |
| Shared cache refill after Clear / OCR-vs-OFF precedence | Remain product policy and source-honesty verification work, distinct from A02's reproduced stale local badge. |
| Broad Amazon permissions | Present and disclosed; architectural tradeoff, not a new exploit. Consider narrower optional grants separately. |
| Bare organic provenance / diagnostics opacity / locale gaps | Existing automated coverage provides partial evidence. Historical examples and production diagnostics need targeted follow-up. |
| SERP OOM, popup clipping, side-panel navigation staleness | Historical observations requiring stress/manual reproduction; not reconfirmed in this pass. |

## Recommended implementation order

1. Fix A01 and A04 together: versioned, byte-safe, complete backups with visible failures and compatibility tests.
2. Fix A02 and A03 together: Target navigation/cache invalidation, guarded callbacks, and lifecycle regressions.
3. Fix A05 with storefront-specific volume tests and an explicit ambiguity policy.
4. Reconcile A06 and historical audit wording; retain old reports as history.
5. Build a release evidence matrix: Chrome 116/current Chrome, live regional layouts, multilingual captured lists, opt-in OCR/OFF, short-screen accessibility, and long-session cache stress.
6. Separately verify production shared-backend write policy and the historical Polish row before advertising shared readings as trustworthy.

The original audit-only pass made no application fixes or backend writes. A01–A06 have since been addressed in this working tree, as described in the integration follow-up. Live Google account activation, multi-device sync, and the historical live-store validation backlog remain outstanding. No release or backend deployment has been published.
