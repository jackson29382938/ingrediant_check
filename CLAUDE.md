# Ingredient Check

A Manifest V3 browser extension (Chrome, also Firefox) that reads a grocery product's ingredient list
and scores it 0–100 on the shopper's own computer. No build step and no runtime dependencies: the
engine runs unchanged in Node (tests) and in a content script.

## Commands

| Task | Command |
|---|---|
| Unit and integration tests (about 25 s on four cores) | `npm test` (parallel; files marked `// @serial` run alone afterwards; `npm run test:serial` runs everything one at a time) |
| Lint (installs pinned ESLint for this run only) | `npm run lint` |
| Manifest, scripts and locale checks | `npm run preflight` |
| Build Chrome and Firefox packages (plain Node, reproducible: same commit, same SHA256) | `npm run pack` |
| Coverage of `src/` from the test suite (content scripts and the worker run in `vm`, so their rows are partial) | `npm run test:coverage` |
| Content-script file lists and URL patterns in `manifest.json` | edit `scripts/script-lists.mjs` / `scripts/content-matches.mjs`, then `node scripts/script-lists.mjs --write` and `node scripts/content-matches.mjs --write` |
| Real-Chromium harness (no network) | `npm install --no-save --no-package-lock --ignore-scripts playwright@1.63.0`, then `HARNESS_CHROME=/opt/pw-browsers/chromium npm run harness:ci` |
| Firefox package lint | `npm install --no-save --no-package-lock --ignore-scripts web-ext@10.0.0`, then `npm run firefox:lint` |

In a cloud session Playwright's pinned browser is not installed and must not be downloaded; set
`HARNESS_CHROME` to the preinstalled Chromium as above (`/opt/pw-browsers/chromium` is a symlink that survives
the image's browser build number changing). Installing Playwright with `--no-save` prunes the lint tools from
`node_modules`, and `npm run lint` prunes Playwright: run one, then reinstall for the other. The harness catches what unit tests cannot,
such as a wrapper object that drops a field the engine now returns. A whole run is about ten minutes; `HARNESS_ONLY=orders,amazon npm run harness:ci` runs just the named stages (the names are in `extensionSmoke`, `scripts/harness-ci.mjs`) for a one-minute look at a failure.

## Scoring engine (`src/engine/`)

`score.js` is the whole pipeline: parse the list into entries (each with a position, and a declared
share if the label gives one) → NOVA processing class sets the base → position- or share-weighted
penalties → bounded bonuses → hard caps. Rules live in `src/engine/db/*.js`; user weights and goal
presets live in `categories.js`.

Rules that are easy to break:

- **Bump the revision when a score can move.** Editing `score.js`, `categories.js` or
  `db/{oils,sugars,additives,labels,allergens,provenance,ingestible,product-ratings}.js` fails `tests/rules-revision.test.js`
  until `RULES_REVISION` and `RULES_HASH` in `src/engine/db/revision.js` are updated (the failing
  test prints the hash). That retires every cached score. The hash covers code only: whole-line comments, blank
  lines and trailing spaces are not hashed, so prose can be edited freely; a renamed variable or a comment
  trailing code still counts. Then run `node scripts/scoring-audit.mjs`
  to regenerate `docs/SCORING-FACTOR-INVENTORY-2026-10-01.md`, and add or update `docs/releases/<version>.md`
  (the release workflow requires one for the manifest version).
- **Nothing is charged that no rule matches.** Silence reads as cleanliness, so an ingredient hidden
  by punctuation the parser does not understand quietly scores better. When you find a format that hides
  one, fix the parser (`cleanText`, `tidy`, `splitTopLevel`, `rejoinWrapped`) and add the format to
  `tests/invariants.test.js`. Formats already covered there: separators and invisible characters, HTML,
  a line wrapped inside an ingredient, a word broken by a hyphen at a line end, one ingredient per line.
- **One readability gate.** `engine.MIN_COVERAGE` and `engine.isReadable(result)` / `result.readable`
  are the only definition of "readable enough to show". Do not copy the threshold; `tests/languages.test.js`
  fails if a content script does. A list with no entries scores 90, so never show a score without
  asking `readable` first. Anything that wraps `engine.score()` must pass `readable` through.
- **Panel arithmetic must add up.** Every row shown is part of the score the user sees
  (`tests/arithmetic.test.js`). A clamp pushes its own row rather than moving the score silently.
- **Food allergen, diet and avoid-list flags never move a score.** Personal-care/supplement indices are separate: the explicitly selected Preference-focused style counts avoid-list matches, as requested by the product specification. Allergy and diet warnings remain separate in every style. See docs/PERSONAL-CARE.md.
- **Calibration is pinned to bands, not numbers** (`tests/corpus.json`). Moving a corpus product out of
  its band needs a reason written in the release notes.
- **Personal care and supplements (`product-ratings.js`, `ingestible.js`).** Test them on real titles and
  labels, not one-line fixtures: `tests/product-classification.test.js` (precision first: a missed title
  falls back to the old behaviour, a wrong one rates dog shampoo), `tests/personal-care-label.test.js`
  (Drug Facts and INCI, which the food parser reads wrongly, so `prepareLabel` rewrites them for these
  categories only). A new upper limit or caution goes in `docs/PERSONAL-CARE.md` too; a test fails if the
  limit table drifts. An index is never drawn in a quality-band colour (`theme.neutral()`), and a saved
  score carries its `category` so `score-cache.fingerprint` retires it by its own settings only.
  The harness's `extensionSmoke` half installs the extension; `HARNESS_CONTENT_ONLY=1` skips it, which hid
  stale "shampoo is not food" fixtures once. Run the whole harness when you can.

## Layout

- `src/content/` — content scripts per store page type (product, search, cart, orders, sort, panel).
- `src/stores/` — store adapters (Amazon, Target, Walmart, Costco, Kroger-family banners, Instacart).
- `src/background.js`, `src/worker/` — service worker; every message is allow-listed in `worker/messages.js`.
- `src/options/` — popup, settings, history dashboard, report, side panel.
- `tests/` — `node --test`; `tests/pages/` and `tests/harness*` are saved-page fixtures for the harness.
- `docs/` — user and reviewer documentation; `docs/history/` holds superseded audits.

## Conventions

- Match the surrounding comment style: comments explain why and cite the measured failure that
  motivated the rule. Keep that when you change a rule.
- Locale strings live in `_locales/en/messages.json` (English is the only UI language); preflight checks that every key
  the code uses resolves. Label-language support (reading German, Spanish, French... ingredient lists) is scoring
  behaviour, not UI translation, and is unaffected.
- A content script that fetches another page of the store reads it with `AIR.cart.publicDocument` /
  `readHtml` (`src/stores/cart.js`): one cap, one abort rule, one definition of a block page. Do not add a
  fourth way.
- A service-worker message handler that returns `true` answers through `answer()` in `background.js`, so a
  rejected promise still replies and leaves a trace.
- A test that asserts a millisecond limit carries a `// @serial` comment so `npm test` runs it alone.
- `docs/apps-script.gs` ends with a byte-for-byte copy of `src/engine/db/purchase-history.js` (a test fails when they differ):
  after editing that file, paste it over the tail of the script, and redeploy the script by hand.
- **Every script list has one source.** `scripts/script-lists.mjs` writes `content_scripts[].js`; a page or group that
  uses an `AIR.db.x` module it does not load fails `tests/page-dependencies.test.js`. A new `src/` file the content
  scripts need goes in that list, not into `manifest.json` by hand.
- **Watch for address changes with `AIR.nav.onChange` (`src/content/nav.js`)**, never a `setInterval` on `location.href`.
- **Change a panel's state with `AIR.panel.setPanelState`**, never `host.dataset.airState = …`; a state it does not know
  is flagged, and the test reads every call.
- **Automatic requests to Amazon go through the budget** (`search.js` `budget`, worker `fetchBudget` / `fetchBlocked`)
  and wait for the first-use answer; a hover is the reader's own request and does not. A page that comes back as a
  robot check is `AIR.cart.isChallenge`, never "no ingredients".
- **Purchase history is read and written through `AIR.db.purchaseStore`** (64 buckets plus an index), never under one
  `purchaseHistory` key; watch `purchaseStore.changed(changes)`, not `changes.purchaseHistory`.
- A message a content script sends the worker with free-form content is bounded in `worker/messages.js`
  (`cleanProductPost`, `boundedRecord`) before it is stored or posted.
- `connect-src` in the manifest lists every host non-content code fetches; a new one must be added there (a test checks).
- ESLint's `max-len` ratchet (300) applies to every `src` file not on the legacy list in `eslint.config.mjs`; do not add to the list.
- Do not add runtime dependencies. Vendored OCR and DOMPurify bundles are reproduced by scripts in
  `scripts/` from pinned inputs.
