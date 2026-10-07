# Ingredient Check

Chrome extension that rates Amazon grocery products **0–100** on ingredients, additives, and processing. You set every weight. Scoring runs on your computer.

This is a guide to what is written on the label, not health or allergy advice. Always read the package.

## Load it

You do not need a build step.

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Expect **Ingredient Check 1.4.4** with no errors on the card

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

Stores: **Amazon** (21 storefronts), plus **15 retailer previews**, including Target, Walmart, Costco, Instacart, Kroger and Fry’s. Search previews reuse saved scores and request uncached public product pages from the same site when automatic rating is enabled. Readable labels receive scores; missing labels are marked and offer a paste fallback on the product page. Live validation is still incomplete; see [store checks](docs/STORES.md). Settings → Stores lets you request another store through an email draft. The toolbar’s report form previews a screenshot, settings and recent extension actions before you choose what to attach; the extension sends nothing.

On an Amazon product page it reads the ingredient list (page text, optional on-device OCR, optional Open Food Facts barcode, or a paste box) and scores it. Search pages can show score chips. Non-food listings are skipped. The toolbar icon shows the current product’s score.

**Cart ratings.** The Amazon cart (checked on a live cart, 2026-10-07) shows a score on each item and the **cart average** under *Shopping Cart* and on the toolbar icon, and rates the line on the page Amazon opens right after Add to Cart. Only your active cart lines are rated, never saved-for-later items, recommendations or carousels. Each number shows why it scored when you hover it (on Amazon) and opens the product when you click it, as on a search result. The 15 retailer previews have cart readers too, checked on fixtures only. Ratings reuse saved scores and can fetch missing public product labels with **Rate search results and cart items** enabled; lookups omit cookies and referrers, and quantities, prices, totals and checkout controls are left alone. Missing labels stay unavailable. **Earn points for healthy carts** (Settings → *What to rate*, off by default) gives XP for good items and levels you up; the points stay on this computer. See [cart coverage](docs/STORES.md#cart-rating-preview--october-6-2026).

**Sort by score or price per ounce (preview).** On an Amazon grocery search on amazon.com, .co.uk, .ie, .ca, .com.au, .sg or .in, Amazon's own *Sort by* menu gets two more options: *Ingredient Check score: High to Low* and *Price per ounce: Low to High* (*per 100 g* on the metric stores). Prices show in the store's currency. The other Amazon stores do not get the options yet ([docs/STORES.md](docs/STORES.md)). It is a preview until it has been checked on live Amazon ([docs/VERIFY.md](docs/VERIFY.md) §7). Choosing one opens Chrome's side panel with this search's listings ranked. Amazon's page is left as it is. In the panel, *Prioritize* weighs health score, price per ounce, total price, customer rating and number of reviews (0–10 each, with one-click starting points), and *Open in new tab* sits beside *Back to Amazon search*. Price per ounce is Amazon's unit price when the results page shows one (per fluid ounce for liquids: "$0.11/fluid ounce", "FZ"), otherwise worked out from the listed price and an unambiguous package size in the title (ounces, pounds, grams, fluid ounces, ml, litres, quarts, gallons; nutrient amounts like "10g Protein" are not a package size). It can be switched off in the toolbar popup. Both are ported from the [Amazon Cost per Ounce Sorter](https://github.com/jackson29382938/amazon_cost_sorting). Settings → *Sort* chooses whether unscored listings are rated while the panel fills in and how many listings *Load more* collects (off by default, up to 500). **Keyboard:** on an Amazon search page, `Alt+Shift+H` opens the sorted list by Ingredient Check score without the mouse. A second command, price per ounce, has no default key; both can be set or changed at `chrome://extensions/shortcuts` (Settings → *Sort* shows the current keys). First-run setup also works from the keyboard: `Enter` next, `B` back, `Shift+S` skip, `1`–`5` pick how many settings to show, `Tab` and `Space` choose.

**Speed and freshness.** Settings → *Speed* has five steps from *Fastest* to *Most up to date*. They set how long saved scores are reused (90 days down to 1), how many product pages *Rate every search result* may request per results page (20 up to 60), and how old a shared-database reading may be (never used at the freshest step). *Balanced*, the default, is how the extension always behaved. A product page you open is always read again: a saved reading shows at once, and the label photo or barcode lookup (when on) replaces it if it reads something different.

The toolbar popup is the master switch plus network opt-ins and shortcuts to the existing weight presets (the same `categories.PRESETS` the settings page uses). On an Amazon product tab it also shows the cached score for that ASIN. If two or more `s:` cache entries are valid, **Compare cached scores** shows them side-by-side — no extra Amazon requests. The switches that make requests stay on top, each with a line saying what it sends; the rest (result badges, food only, why on hover, price per ounce, label photos, Open Food Facts), the comparison, setup and the cache clear sit under **More**, and explanations stay collapsed until you open **Why these matter**. **Settings** opens the full settings page (a sidebar of sections, searchable categories, dark mode, avoid-list suggestions); each setting shows one line, and its longer explanation opens when you click that line. Imports, sliders, and storage values are sanitized before they are trusted: unknown ids are dropped, weights stay in the 0–2 slider range. Settings back up to your Chrome account and come back only when you click Restore.

Ingredient headings are recognised in English and several EU languages (Zutaten, Ingredientes, Ingrédients, Ingredienti, Ingrediënten, Skład, Składniki, Ingredienser, İçindekiler), including same-line `Ingredients:` detail-bullet forms. Japanese and Arabic stores decline photo OCR until a local reader exists — English Tesseract misreads those labels. Scoring is strongest on English US/UK/CA/AU labels. A synonym pack plus E-numbers lets DE/FR/ES/IT/PT/NL/SV/PL/TR lists score, but that is tested only on synthetic translations, not on real labels. Japanese and Arabic lists are declined. A list the rulebase mostly cannot read is declined rather than scored. [docs/ACCURACY.md](docs/ACCURACY.md) lists the evidence behind each language. Allergen and diet flags read the same languages, cover the EU’s celery, mustard and lupin as well as the US list, and never move the score. Chrome 116 or newer is required.

## Appearance and the settings level

Settings → *Appearance* sets a colour scheme (match the system, light or dark), the score colours (standard, or a colour-blind safe blue-to-maroon palette) and one accent colour. They apply to Settings, the toolbar popup, setup, the sorted list and the score badges and panel on store pages. The Chrome toolbar badge also follows the score palette, including existing tab badges after a palette change. Text stays readable whatever is chosen: the number and the verdict word always say the score, and an accent that would be hard to read is nudged until text in it reaches WCAG AA (4.5:1), with the shift shown beside the picker. The toolbar popup follows the same *How many settings to show* level as Settings: Minimal and Simple show only the essentials, and Standard and up match the full popup. Open `src/engine/db/theme.js` for the palettes and the accent maths; `tests/theme.test.js` checks contrast; `tests/color-vision.test.js` checks separation under simulated protanopia, deuteranopia and tritanopia. The browser harness drives real popup level changes and forced panel themes.

## Goals

A new install opens a one-minute setup (goals, allergens and diets, an avoid list, and four fetch choices); **Run setup again** in the popup or settings reopens it. Goals can be combined — where two set the same dial they are averaged, weighted by how much each goal counts (a slider per goal in settings, 1 each by default) — and some turn a minus into a plus: fat-reduced dairy under **Weight loss**, added vitamins under **Vitamins & minerals**, honey under **Animal-based (Paul Saladino)**. Those rows are marked "a plus for your goals" and capped at +20 in total; hard caps such as Red 40 never become pluses. Definitions live in `src/engine/categories.js` (`PRESETS`, `goalWeights`).

## Tests

```bash
npm test
npm run preflight
npm run pack             # optional: zip a clean extension package under dist/
npm run harness          # http://127.0.0.1:8731 — panel, OCR, lifecycle
```

`npm run harness:ci` drives those pages in headless Chromium and fails on any page error, `[AIR]` line or
console error, even when a page's own checks pass. It then loads the real unpacked extension, checks the service worker
started with every module, and opens each extension page against the real `chrome.*` APIs. Last, with
Chromium sending `https://www.amazon.com` to a local server of the saved pages (a certificate made for the run) in `tests/pages/` (and every other
host nowhere), the real content scripts score a product page, stand down on a non-food one and rate
search results through the badge queue. Set `HARNESS_CHROME` to a Chromium executable to
use it instead of the one Playwright downloads.

CI runs `npm test` and `npm run preflight` on Node 20 and 22, `npm run lint` (pinned ESLint, no warnings allowed), and a Playwright job on the local panel and lifecycle harnesses (`npm run harness:ci`). That job never talks to Amazon. It runs on pull requests and on pushes to `main`.

| Harness | URL |
|---|---|
| Panel | http://127.0.0.1:8731/ |
| OCR | http://127.0.0.1:8731/tests/harness-ocr.html |
| Lifecycle | http://127.0.0.1:8731/tests/harness-lifecycle.html |
| Food-only + settings | http://127.0.0.1:8731/tests/verify-food-settings.html |

Live Amazon checks are in [docs/VERIFY.md](docs/VERIFY.md). When a rule changes, `tests/rules-revision.test.js` fails until `RULES_REVISION` in `src/engine/db/revision.js` is bumped — that is what retires cached scores.

## Network

Scoring is always local. Chrome profile settings backup is on by default. The four final setup choices are recommended and checked by default: **Rate every search result**, certification-table lookups, on-device label OCR, and barcode fallback. Barcode fallback requires Chrome’s optional permission. Existing saved opt-outs are preserved. Diagnostics and shared product readings remain off. Hover a score on a results page to see why it scored that way (**Show why on hover**, computed locally).

**Rate every search result** requests product pages from the Amazon store you are on, a few at a time and at most 60 per results page. The sorted side-panel list uses the same queue and the same limit (60 for each results page it collected, counting what the badges already requested), and never requests a product twice. The requests use your Amazon sign-in. This is shown under the switch in the popup, in Settings → *What to rate*, and once on the first results page it rates, with a **Turn off automatic rating** button. The extension has access to the 21 supported Amazon stores, granted by Chrome at install. Settings lists them and explains how to limit that access. See [docs/PRIVACY.md](docs/PRIVACY.md).

- **Open Food Facts fallback** — barcode only, after Chrome grants the host
- **Read label photos** — local Tesseract; fetches the product image already on the page
- **Shared online database** (on by default) — certification tables for whole foods, kept by the developer on a private Google Sheet behind one Apps Script ([docs/SETTINGS-SYNC.md](docs/SETTINGS-SYNC.md)). This build has a configured endpoint, used only when the relevant feature is enabled. Diagnostics use the same endpoint: [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).
- **Share product readings with other computers** (closed in this build) — what was read off each product, before weighting, so a product is read from Amazon about once a month instead of once per person. Anyone can upload a reading and nothing yet checks that it is true, so it is off in the extension and closed on the receiver until the owner opens it ([docs/CACHE.md](docs/CACHE.md), *Trust*).
- **Settings backup** (on by default) — Chrome's own sync; optional Google sign-in copy on the shared database. Google sign-in needs a registered OAuth client ID and a matching backend configuration; it does not sign Chrome itself into a profile.

## Accuracy

The test suite proves the engine matches its spec. To see whether scores match a careful reading of real labels, turn on diagnostics, shop a grocery search, and sort by `coverage`, `source`, and `cap`. Promote misses into `tests/corpus.json` before changing rules. Every corpus entry records its language and whether it is a live capture, modelled on a real product, or synthetic. Three English entries are live captures; non-English corpus evidence remains synthetic. See [docs/ACCURACY.md](docs/ACCURACY.md).

Chrome Web Store submit checklist: [docs/store-listing/README.md](docs/store-listing/README.md).
Owner live checks: [docs/VERIFY.md](docs/VERIFY.md). Historical audit logs and plans live under
[docs/history/](docs/history/). Chrome Web Store privacy copy is [docs/PRIVACY.md](docs/PRIVACY.md).
Licensed under [MIT](LICENSE).

The GitHub folder spelling `ingrediant_check` is historical. The product name is **Ingredient Check**.
Renaming the GitHub repository is an owner action in GitHub settings (not a code change).

Release evidence and outstanding owner checks: [October 1 validation](docs/RELEASE-VALIDATION-2026-10-01.md).

Scoring and preset decisions: [complete calibration review](docs/SCORING-CALIBRATION-2026-10-01.md), including an inventory of every factor and default.
