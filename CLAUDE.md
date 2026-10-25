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
| Build Chrome and Firefox packages | `npm run pack` |
| Real-Chromium harness (no network) | `npm install --no-save --no-package-lock playwright@1.63.0`, then `HARNESS_CHROME=/opt/pw-browsers/chromium npm run harness:ci` |
| Firefox package lint | `npm install --no-save --no-package-lock web-ext@10.0.0`, then `npm run firefox:lint` |

In a cloud session Playwright's pinned browser is not installed and must not be downloaded; set
`HARNESS_CHROME` to the preinstalled Chromium as above (`/opt/pw-browsers/chromium` is a symlink that survives
the image's browser build number changing). Installing Playwright with `--no-save` prunes the lint tools from
`node_modules`, and `npm run lint` prunes Playwright: run one, then reinstall for the other. The harness catches what unit tests cannot,
such as a wrapper object that drops a field the engine now returns.

## Scoring engine (`src/engine/`)

`score.js` is the whole pipeline: parse the list into entries (each with a position, and a declared
share if the label gives one) → NOVA processing class sets the base → position- or share-weighted
penalties → bounded bonuses → hard caps. Rules live in `src/engine/db/*.js`; user weights and goal
presets live in `categories.js`.

Rules that are easy to break:

- **Bump the revision when a score can move.** Editing `score.js`, `categories.js` or
  `db/{oils,sugars,additives,labels,allergens,provenance}.js` fails `tests/rules-revision.test.js`
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
- **Allergen, diet and avoid-list flags never move a score.**
- **Calibration is pinned to bands, not numbers** (`tests/corpus.json`). Moving a corpus product out of
  its band needs a reason written in the release notes.

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
- Locale strings live in `_locales/<lang>/messages.json`; preflight checks that every key resolves, that `de`
  has the English keys with the same `$TOKEN$`s, and that no `de` message is the English text (a name, a unit
  or a word that is the same in German goes on `SAME_AS_ENGLISH` in `scripts/preflight.mjs`, with the reason).
  A new English key needs a real German string.
- A content script that fetches another page of the store reads it with `AIR.cart.publicDocument` /
  `readHtml` (`src/stores/cart.js`): one cap, one abort rule, one definition of a block page. Do not add a
  fourth way.
- A service-worker message handler that returns `true` answers through `answer()` in `background.js`, so a
  rejected promise still replies and leaves a trace.
- A test that asserts a millisecond limit carries a `// @serial` comment so `npm test` runs it alone.
- `docs/apps-script.gs` ends with a byte-for-byte copy of `src/engine/db/purchase-history.js`; after editing that file run
  `node scripts/sync-apps-script-schema.mjs` (a test fails otherwise) and redeploy the script by hand.
- Do not add runtime dependencies. Vendored OCR and DOMPurify bundles are reproduced by scripts in
  `scripts/` from pinned inputs.
