# Ingredient Check

**Understand grocery ingredient labels before you buy.**

A desktop **Chrome and Firefox** extension that scores readable grocery ingredient lists from
**0 to 100**, explains the bonuses and deductions, and lets you choose which goals matter to you.
Scoring runs on your computer. Browse ratings on products, search results and carts, or opt into
Amazon purchase-history trends.

**[Download the latest release](https://github.com/jackson29382938/ingrediant_check/releases/latest)**
· [Install](#installation)
· [See the features](#features-and-examples)
· [Store coverage](docs/STORES.md)
· [Get help](https://github.com/jackson29382938/ingrediant_check/issues)

> Scores describe the available label under your selected settings. They are not medical or
> allergy advice. Always check the package. Missing labels are shown as unavailable, not given a
> guessed score.

## Installation

**Start with the ZIP under “Assets” on the [latest release page](https://github.com/jackson29382938/ingrediant_check/releases/latest).**
You do **not** need Node, Python, a terminal or a Google account to install and score locally.

| Browser | Download under Assets | Installation type |
|---|---|---|
| **Chrome 116+** | `ingredient-check-<version>.zip` | Extract and use **Load unpacked** |
| **Firefox 142+** | `ingredient-check-<version>-firefox.zip` | **Temporary add-on**; removed when Firefox restarts |

Do not choose GitHub’s automatically generated **Source code (zip)** or **Source code (tar.gz)**
for these installation steps. The browser packages include the files needed to run the extension.

### Chrome: download → extract → load

1. Download the **Chrome ZIP** listed above and **extract all files** into a permanent folder,
   such as `Documents/Ingredient Check`. Keep this folder after installation.
2. Open **`chrome://extensions`** in Chrome’s address bar.
3. Turn on **Developer mode** in the top right, then click **Load unpacked**.
4. Select the **extracted folder containing `manifest.json`**, not the ZIP or its parent folder.
   You should now see an **Ingredient Check** extension card.
5. Finish the setup page. Choose your goals, warnings and optional features. If setup does not
   open, use the extension’s **Settings → Run setup again**.
6. Click Chrome’s **Extensions** puzzle-piece icon and pin **Ingredient Check**. Open or refresh
   a supported grocery page to start seeing ratings.

**To update:** download the new Chrome ZIP, replace the extension files in the **same install
folder**, click **Reload** on its card at `chrome://extensions`, then refresh your shopping tabs.
Keep the folder and existing extension installed to preserve its identity and local history.

### Firefox: temporary installation

The GitHub Firefox ZIP is **unsigned**. It is suitable for temporary installation and testing;
a permanent installation in standard Firefox requires a **Mozilla-signed XPI**.

1. Download the **Firefox ZIP** listed above and extract it.
2. Open **`about:debugging#/runtime/this-firefox`** in Firefox’s address bar.
3. Click **Load Temporary Add-on**, then select `manifest.json` inside the extracted Firefox folder.
4. Finish setup and grant access to the store websites you use if Firefox asks. Open or refresh
   a grocery page to check that ratings appear.

Firefox removes temporary add-ons on restart. Repeat these steps to load it again; use a signed
package for ongoing use. See [browser installation, permissions and signing](docs/BROWSERS.md).

## Features and examples

These screenshots show the **actual extension UI** using saved label fixtures and synthetic purchase
records. They contain no personal account or order data. Scores vary with the label, goals and
scoring version. [Screenshot details](docs/screenshots/README.md).

### See what contributed to a score

Open a grocery product and expand its score panel to see the ingredient bonuses, deductions and
score limits. The example below uses a saved potato-chip label and balanced scoring settings.

![Expanded ingredient score for a potato-chip label, showing its score and contributing factors](docs/screenshots/ingredient-score.png)

For example, a whole-food ingredient may earn a bonus while an oil or additive triggers a deduction
or limit. **Allergen, diet and avoid-list warnings are separate from the numerical score.** Hover over
listing, cart or order badges for details when **Score on hover** is enabled.

### Make the scoring fit your goals

Combine goals during setup, then adjust their importance and individual weights in Settings. Choose
a settings level from **Minimal** to **Everything** to control how many options you see.

<img src="docs/screenshots/personalized-setup.png" alt="Setup screen with Whole-food focused selected, alongside nutrition, activity and diet-style goals" width="580">

For example, select **Whole-food focused**, add an allergen warning, and enter
**`palm oil, natural flavors`** in the avoid list. The comma separates those into two ingredients.
Change goals or warnings later from the extension icon → **Settings**.

### Compare products while shopping

| Where | What you can do |
|---|---|
| **Product pages** | Read the score breakdown; paste label text when the site has no readable label |
| **Search results** | Compare food-product badges; on Amazon grocery searches, sort by score or price per unit |
| **Carts** | Review item ratings and the cart average where the store adapter can identify items and labels |
| **Amazon Orders** *(opt-in preview)* | Import actual purchases, inspect item ratings and open purchase trends |

On Amazon grocery searches, choose **Ingredient Check score: High to Low** in the sort menu,
or press **`Alt+Shift+H`** to open the score-sorted list. Compare price per ounce or select another
unit in the comparison view where product price and size are available.

Automatic search/cart scoring, badge placement, hover details, local-cache behavior, speed,
appearance and score palettes are adjustable in Settings. Cached readings help repeat visits load
faster; freshness, changed goals and changed scoring rules can still require a refresh or rescore.

### Explore your purchase trends

Opt into **Amazon purchase history** in setup or Purchase history’s own settings. Import an opened
Orders page, or use **Scan all Amazon orders** to work through available pages and year filters in
a background tab, with progress, time estimates, pause and resume. Keep the browser open; sign-in
checks can pause the scan.

![Purchase dashboard with synthetic data: 45 product entries across 15 orders, an average score of 63.4, a monthly score chart and a score-distribution chart](docs/screenshots/purchase-trends.png)

- **Preserve the original scores**, or compare saved labels using your current goals and weights.
- Track the average over time, score distribution and biggest net bonuses and deductions.
- Filter by date, product, status, rating or score; sort imported items and inspect statistical details.
- Distinguish **orders** from **product entries**: three distinct products in one order are one order
  and three entries. Purchased quantities are not inferred.

Only confirmed purchases drive trends; viewed products, carts, cancellations and returns are
excluded. These charts describe purchases, not what you ate or medical outcomes. Confidence intervals
in the statistical view describe variation in the recorded sample, not certainty that a health score
is correct. [Purchase-history guide](docs/PURCHASE-HISTORY.md).

## Which stores work?

**Amazon.com** is the primary live-checked store. **Target, Walmart, Costco, Instacart, Kroger,
Fry’s, Ralphs, King Soopers, Smith’s, Fred Meyer, QFC, Harris Teeter, Dillons, Safeway and Albertsons**
have preview adapters with varying live verification. Other Amazon storefronts share the adapter
but have not all been checked individually.

Product, search and cart behavior depends on the store layout, permissions and available labels.
Purchase-history import currently covers **Amazon.com Orders only**. A preview is not a guarantee
that every page works. See the [coverage and verification table](docs/STORES.md) for current limits.

## Privacy and optional accounts

- **Scoring and local caches run on your device.** On-device OCR can read supported label photos.
- A **Google account is optional** for local scoring. Google sign-in enables optional account backup
  and purchase-history sync; Chrome/Firefox profile backup uses the browser’s own sync service.
- Settings backup is on by default. Opting into Amazon history also enables automatic Google-account
  history sync; you can switch it off or use **Sync now** in Purchase history.
- Barcode lookup and other online lookups depend on their settings and permissions. Diagnostics and
  sharing product readings are off by default.

Read the [full privacy policy](docs/PRIVACY.md) for exactly what is stored, fetched and uploaded.

## Troubleshooting

| Problem | What to check |
|---|---|
| Cannot find the right download | Expand **Assets** on the latest release. Choose the browser ZIP, not **Source code**. |
| Chrome says the manifest is missing | Extract the ZIP first; select the folder that directly contains `manifest.json`. |
| No ratings after installation or an update | Refresh the shopping tab, check the extension is enabled, and allow access to that store. |
| “Label unavailable” | Open the product and expand Ingredients/Nutritional Facts. Check label-photo OCR or paste the ingredients. Some labels cannot be read. |
| Firefox disappears after restart | That is expected for a temporary add-on. Permanent installation requires Mozilla signing. |
| Google reports a redirect URI mismatch | Local scoring still works. The developer must register the exact redirect URL shown in Google backup settings. See [OAuth setup](docs/BROWSERS.md#google-sign-in-and-optional-data-sharing). |
| Still stuck | [Open an issue](https://github.com/jackson29382938/ingrediant_check/issues) with your browser, extension version, store URL and a redacted screenshot. Leave out account and order details. |

## More information

- [Full feature guide](docs/FULL-README.md)
- [Scoring accuracy and limitations](docs/ACCURACY.md)
- [Browser installation and signing](docs/BROWSERS.md)
- [Developer setup and tests](docs/VERIFY.md)
- [Support website files](website/) and [Vercel deployment steps](website/README.md)

Building from source is optional: with **Node 20+ and Python 3**, run `npm run pack` in the repository
root to create both browser ZIPs in `dist/`. The extracted Chrome folder is `dist/unpacked` and
Firefox is `dist/firefox`.

Licensed under [MIT](LICENSE).
