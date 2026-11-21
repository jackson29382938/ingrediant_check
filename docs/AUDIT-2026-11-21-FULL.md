# Ingredient Check codebase audit

**Baseline** `84f84e7` (local and remote main after the 1.27.0 tag). **Date** November 21, 2026.

The review traced extension entry points through the retailer adapters, background message
routing, scoring and cache layers, OCR and barcode fallbacks, purchase history, local settings,
Apps Script, website, and the release workflow. The baseline passed 1,433 Node tests. The
1.27.0 tag workflow passed browser and Node validation and failed lint on the unused `writing`
variable in Settings. Its package publication job was skipped.

The structural snapshot covered the tracked runtime, scripts, tests, site, and workflows. The
static extraction mapped 2,464 nodes and 5,255 edges. The prior [November 16 real-photo, browser
and backend audit](AUDIT-2026-11-16.md) and [November 20 consent and storage audit](AUDIT-2026-11-20.md)
supply reproduced failures. Their historical live and authenticated results are dated evidence.

## Findings and changes

| Priority | Area | Finding | Change and verification |
| --- | --- | --- | --- |
| P1 | AI consent | A queued OpenRouter job retained the key from enqueue time. The schema fallback could send after disabling AI, revoking permission, or replacing the key. | Recheck the feature, permission and current key immediately before each request and fallback. Cover queued and fallback calls with network doubles. |
| P1 | Retail consent | Walmart overrode the global automatic rating and result-badge switches and bypassed the same search budget used by the other previews. Public search reads can use Walmart cookies. | Honor both switches and the Speed budget. Keep sponsored hiding and the sort menu independent. Disclose session behavior in the privacy and store guides. |
| P1 | Photo uncertainty | A 91%-confidence photo reading missed a selected soy warning after misreading `SOY` as `SO¥`. English OCR also lost the ingredient heading on a French label, and Library scored the raw output. | Examine word-level uncertainty, withhold automatic scores for suspicious readings, and require review or correction in Library. Keep the original extracted text available. |
| P2 | Photo boundaries and evidence | OCR could absorb a duplicate language, importer details and allergen statements into the ingredient list. An early unusable image could hide a better reading. OpenRouter transcriptions displayed generic product-page evidence and a fixed numerical confidence. | Separate ingredient and advisory text, check additional candidate images when needed, and label AI evidence explicitly. Photo sources stay uncertain in the no-warning filter even at full vocabulary coverage. |
| P2 | Shortlists | Two tabs could both pass the final-slot check, and the capped read hid overflow. A two-product Library save could partially succeed. Recent comparisons selected by storage order before sorting by capture time. | Serialize writes through the extension worker, atomically save the comparison selection, recover and order all existing entries, report the 200-item cap, and select the latest recent entries after sorting. A local JSON export provides a portable copy of saved inputs. |
| P2 | Value ranking | Best-value badges could use incomparable scoring categories or a sole candidate, and swap tie-breaking could mix incompatible unit-price families. | Require comparable candidates and the selected unit family. Exercise ties, missing units, and mixed-category cases in the sort tests. |
| P2 | Sorted-list interaction | A scroll event sent after hover immediately closed the tooltip for a formerly offscreen score chip. Stopping work could leave the view stuck in its loading state. | Reposition a tooltip whose chip still holds focus or hover after scrolling. Finalize the active run through the worker on Stop and reject late updates to that run. |
| P2 | Purchase history | The entries table could not receive keyboard focus on small screens. History treated AI transcriptions as page text for source filtering. Reformulation alerts could mistake punctuation and same-day observations for recipe changes or show changes across different score settings. Snapshot cleanup stripped label markup and quantity markers before replay. | Add named, focusable scroll regions to the tables, distinguish sources, and show possible reformulations with an on-demand ingredient comparison. Show deltas for comparable recorded setups. Preserve exact bounded ingredient inputs for new snapshots. |
| P2 | USDA evidence | A freshly fetched record could contain a years-old label. Retrieval time alone hid the date on the source record. | Carry the reported source date separately through barcode readings and saved evidence. Prompt a package comparison for records over two years old. |
| P2 | USDA proxy | The Apps Script hourly counter lived in an evictable cache and concurrent misses could reserve the same slot. Manual Library lookup could call USDA without its opt-in. | Reserve requests under a script lock with a durable, fixed UTC-hour counter and release the lock before upstream work. Honor the USDA switch in Library. |
| P2 | Validation and release | A live HTTP success could hide a failed panel or a search without scores. The UI review locator matched two elements, the current validation page still pointed at 1.19.2, and the 1.27.0 settings refactor left a lint-blocking variable. | Report retailer transport and extension outcomes separately. Use a role-specific locator, update the validation record, and remove dead settings state. |

| P2 | Popup settings | An in-flight write suppressed unrelated storage changes. Permission removals could leave the settings display stale. | Track pending writes by key, apply unrelated local changes, and refresh the AI and USDA switches when permission is removed. |
| P2 | Packaging checks | Preflight missed Library locale coverage and had no common version check for the checked-in diagnostic schema. The documented purchase-history sync command was missing. | Check Library locale keys and schema versions. Add the existing documented schema synchronization command. |
| Feature | Label and comparison workflow | The photo flow required a file chooser, and nutrition values could be hard to find from a score. | Accept a dropped or pasted image and show reported nutrients with a per-100-g or per-100-mL basis. Add a Side Panel entry through the Chrome and Firefox platform adapters. |

The shipped sanitizer and OCR vendor builds keep their pinned sources.

## Engineering decisions and limits

- **Scoring and labels.** Preserve the existing score calibration and revision. Verify readable
  inputs, source gates, arithmetic, nutrition normalization, and real-browser fixture behavior.
  Product scores remain dependent on available labels. Clinical validation and a new independent
  scoring calibration require external evidence.
- **Storage and migration.** Existing local shortlist overflow is visible and editable. New
  additions require available capacity. Old purchase history snapshots already missing markup
  cannot recover it from local records. Existing barcode cache entries may lack the new date
  until refreshed.
- **Privacy.** The checkout contains a separate draft of Google ecosystem proposals. This audit
  did not adopt a new hosting provider or transfer user data. A deployed Apps Script can only
  enforce the new USDA quota behavior after its owner deploys this template.
- **Retail/browser evidence.** Code and fixture checks can reproduce observed behavior in a
  controlled environment. Broad live coverage, authenticated purchase sync, and review of
  browser-store signing and publication require their respective environments and accounts.
- [Current release validation](CURRENT-VALIDATION.md) records the checks run on the new source.
