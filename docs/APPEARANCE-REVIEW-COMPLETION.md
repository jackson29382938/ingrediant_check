# Appearance review completion — October 5, 2026

The checkout was advanced from version 1.6.0 to the actual latest main, e0d719f, including 8a4e2b4 and the review follow-up. GitHub CI succeeded for both 8a4e2b4 and e0d719f. No previously completed setup/import/backup/accessibility fix was reverted.

The four remaining items are completed in version 1.8.0:

| Item | Implementation/evidence |
| --- | --- |
| Toolbar palette | Worker loads the selected palette, repaints existing exact scores on palette changes, and recovers retained Chrome badge numbers after worker suspension. Text contrast is at least 4.5:1; status badges remain neutral. No rescan or persistent tab record is required. |
| Full popup level wiring | Chromium loads the actual extension popup at all five levels; Chrome storage callbacks/events drive initial state and live changes. A pending actual checkbox save cannot swallow another page’s level change. Hidden values and legacy full view survive. |
| Panel theme in a real browser | Chromium’s DOM protocol inspects the actual content script’s closed shadow root. Forced dark/light beat the opposite OS scheme; System follows both. Palette foregrounds render correctly and the retailer document’s background remains unchanged. |
| Colour-blind separation | Full-severity Machado simulations in linear sRGB, measured in Oklab, check every band pair for ring colours, dark score foregrounds and toolbar fills under protanopia, deuteranopia and tritanopia. Numeric/verdict cues remain independent. |

Using the light score foregrounds as toolbar fills would collapse some bands under the simulations. Colour-blind toolbar fills instead use the more separated ring colours, with white or near-black numbers selected for contrast. The eight-point Oklab floor is an application regression threshold, not a WCAG requirement or a guarantee for every viewer.

Validation: 929 Node tests, zero-warning lint, preflight, packaging and Chrome harness. CI runs the same full suite on Node 20/22 and the browser checks. This release also packages the prior unreleased Appearance/settings-level and review fixes; Google Console registration and live account-backend deployment are separate configuration requirements.
