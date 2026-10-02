# Ingredient Check 1.4.0

This release recalibrates ingredient scores and goal presets, improves nutrition parsing, and strengthens profile backup and storage handling.

- Reviewed all 45 scoring controls, 20 presets, 173 penalty rules, 56 ceilings, 15 label signals, seven nutrition factors, and 17 provenance rules.
- Separated optional gluten preferences from grain refinement; neutralized automatic dairy-processing, reduced-fat and fortification penalties; removed unsupported raw-milk, A2 and specialty-salt bonuses.
- Fixed sugar double-counting, mass/volume nutrition normalization, fractional preset sliders, and organic bonuses exceeding ingredient ceilings. A new rule revision invalidates stale scores.
- Added optional Google sign-in configuration and profile-settings access, with OAuth response validation. Public OAuth client configuration is still required; live sign-in has not been verified.
- Improved profile backup staging, chunking, conflict handling and retry status. Signed-in remote transport remains unverified.
- Fixed stale retailer badges, Target nutrition units, and UK imperial volume handling.
- Disabled shared-product exchange in this build. Backend closure/purge tools are included but have not been deployed or run against production.

## Validation

633 automated tests pass on Node 20 and Node 24. Chrome 153 extension browser checks, accessibility checks, ESLint, extension preflight and ZIP packaging pass. Existing live retailer captures cover three English labels; broader language coverage remains synthetic. Scores are preference-based estimates, not clinical ratings.

## Install

Download the release ZIP, extract it, enable Developer mode at `chrome://extensions`, and use **Load unpacked** on the extracted directory. This GitHub release does not publish to the Chrome Web Store.

Existing custom settings are preserved. Select Balanced to apply the revised baseline, or reselect a goal preset to apply its new weights.
