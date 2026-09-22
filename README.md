# Ingredient Check

Chrome extension that rates Amazon grocery products **0–100** on ingredients, additives, and processing. You set every weight. Scoring runs on your computer.

This is a guide to what is written on the label, not health or allergy advice. Always read the package.

## Load it

You do not need a build step.

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Expect **Ingredient Check 1.0.2** with no errors on the card

Optional local session (Chrome for Testing, extension preloaded):

```bash
npm run browser:setup        # once per machine
npm test && npm run preflight
npm run chrome
```

Node 20 or newer is supported. The extension and its automated checks remain build-free and
dependency-free. `browser:setup` installs the pinned optional browser tooling globally so native
package extraction does not fail inside cloud-synced workspaces such as Google Drive.
Set `INGREDIENT_CHECK_CHROME` to a Chrome for Testing executable when you manage the browser
yourself. The launcher otherwise discovers installs made by `npm run browser:setup` on Windows,
macOS, and Linux. The browser profile it creates lives in your user cache directory
(`INGREDIENT_CHECK_PROFILE` overrides it), never inside this folder, because the profile holds
cookies and logins and this folder may be cloud-synced.

After editing `src/`, `manifest.json`, or `icons/`, run `npm run chrome:reload`.

## What it does

On an Amazon product page it reads the ingredient list (page text, optional on-device OCR, optional Open Food Facts barcode, or a paste box) and scores it. Search pages can show score chips. Non-food listings are skipped. The toolbar icon shows the current product’s score.

The toolbar popup is the master switch plus network opt-ins and shortcuts to the existing weight presets (the same `categories.PRESETS` the settings page uses). On an Amazon product tab it also shows the cached score for that ASIN. If two or more `s:` cache entries are valid, **Compare cached scores** shows them side-by-side — no extra Amazon requests. Explanations are collapsed until you open **Why these matter**. **Scoring weights, allergens & avoid list** opens the full settings page (searchable categories, dark mode, avoid-list suggestions, section jump). Imports, sliders, and storage values are sanitized before they are trusted: unknown ids are dropped, weights stay in the 0–2 slider range, and only Google Sheet / Apps Script URLs are kept.

Ingredient headings are recognised in English and several EU languages (Zutaten, Ingredientes, Ingrédients, Ingredienti, Ingrediënten, Składniki, Ingredienser, İçindekiler), including same-line `Ingredients:` detail-bullet forms. Japanese and Arabic stores decline photo OCR until a local reader exists — English Tesseract misreads those labels. Scoring is strongest on English US/UK/CA/AU labels. DE/FR/ES/IT/PT/NL lists usually score via synonym pack + E-numbers; other storefronts may extract headings but under-score or decline unrecognised text. A list the rulebase mostly cannot read is declined rather than scored. Allergen and diet flags read the same four languages, cover the EU’s celery, mustard and lupin as well as the US list, and never move the score. Chrome 116 or newer is required.

## Tests

```bash
npm test
npm run preflight
npm run pack             # optional: zip a clean extension package under dist/
npm run harness          # http://127.0.0.1:8731 — panel, OCR, lifecycle
```

CI runs `npm test` and `npm run preflight` on Node 20 and 22, plus a Playwright job on the local panel and lifecycle harnesses (`npm run harness:ci`). That job never talks to Amazon.

| Harness | URL |
|---|---|
| Panel | http://127.0.0.1:8731/ |
| OCR | http://127.0.0.1:8731/tests/harness-ocr.html |
| Lifecycle | http://127.0.0.1:8731/tests/harness-lifecycle.html |
| Food-only + settings | http://127.0.0.1:8731/tests/verify-food-settings.html |

Live Amazon checks are in [docs/VERIFY.md](docs/VERIFY.md). When a rule changes, `tests/rules-revision.test.js` fails until `RULES_REVISION` in `src/engine/db/revision.js` is bumped — that is what retires cached scores.

## Optional network

All off by default.

- **Open Food Facts fallback** — barcode only, after Chrome grants the host
- **Read label photos** — local Tesseract; fetches the product image already on the page
- **Shared provenance / diagnostics / settings** — the Ingredient Check Google Sheet is the default database URL ([docs/SETTINGS-SYNC.md](docs/SETTINGS-SYNC.md)). Reads are CSV/gviz. Writes need an Apps Script `/exec` URL you deploy from [docs/apps-script.gs](docs/apps-script.gs); that field starts empty. Diagnostics: [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md). Redeploy the script so a lost ACK cannot double-write rows and so `kind: "settings"` is accepted.

## Accuracy

The test suite proves the engine matches its spec. To see whether scores match a careful reading of real labels, turn on diagnostics against a sheet you own, shop a grocery search, and sort by `coverage`, `source`, and `cap`. Promote misses into `tests/corpus.json` before changing rules.

Chrome Web Store submit checklist: [docs/store-listing/README.md](docs/store-listing/README.md).
Owner live checks: [docs/VERIFY.md](docs/VERIFY.md). Historical audit logs and plans live under
[docs/history/](docs/history/). Chrome Web Store privacy copy is [docs/PRIVACY.md](docs/PRIVACY.md).
Licensed under [MIT](LICENSE).

The GitHub folder spelling `ingrediant_check` is historical. The product name is **Ingredient Check**.
Renaming the GitHub repository is an owner action in GitHub settings (not a code change).
