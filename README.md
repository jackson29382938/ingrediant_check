# Ingredient Check

**Conveniently, quickly, and safely inspects, analyzes, and briefs grocery ingredient labels before you buy.**

Ingredient Check is a Chrome extension (also works in Firefox). When you shop on Amazon (and many other online stores), it reads the
ingredient list and gives the product a score from **0 to 100**. Scores are worked out on your own
computer, and you choose which things matter to you.

> This is a guide to what is written on the label. It is not medical or allergy advice.
> Always read the package.

---

## Install in Chrome (about 3 minutes)

You need **Chrome 116 or newer**. Download the ready-to-install extension; Node and Python are only needed to package the source yourself.

**1. Download the release**

Open the [latest release](https://github.com/jackson29382938/ingrediant_check/releases/latest).
Choose `ingredient-check-<version>.zip` for Chrome. The file ending in `-firefox.zip` is for Firefox.
Extract it into a permanent folder you can find again.

**2. Keep the install folder**

Chrome loads the extracted extension files directly. When updating, replace the files in this
same folder and press **Reload**. Keeping the folder preserves the extension ID, local data and Google redirect.

**3. Load it into Chrome**

1. Open a new tab and go to `chrome://extensions`
2. Turn on **Developer mode** (switch in the top right)
3. Click **Load unpacked**
4. Select the folder containing the extracted `manifest.json`

You should see **Ingredient Check** in your list of extensions.

**4. Pin it**

Click the puzzle-piece icon in Chrome's toolbar and click the pin next to **Ingredient Check**.
Its score for the product you are looking at will show on the icon.

---

## Install in Firefox

Use Firefox 142 or newer. Download the ZIP ending in `-firefox.zip` from the same release.
Until a Mozilla-signed version is available, extract it, open `about:debugging#/runtime/this-firefox`,
choose **Load Temporary Add-on**, and select its `manifest.json`. Grant access to the stores you use.
Temporary installation ends when Firefox restarts; permanent installation requires Mozilla signing.
See [browser installation and signing](docs/BROWSERS.md).

For developers: source packaging needs **Node 20+ and Python 3** (`python3` on PATH).
Run `npm run pack` from the repository root; the Chrome output is `dist/unpacked` and Firefox is
`dist/firefox`. Development tests and setup are in [docs/VERIFY.md](docs/VERIFY.md).

---

## How to use it

| Where you are | What you see |
|---|---|
| An Amazon product page | A score for the ingredient list, and the toolbar icon shows it too |
| An Amazon search results page | A small score on each food product |
| Your Amazon cart | A score on each item and the **cart average** |

- **Hover** over a score to see why it got that number.
- **Click** a score to open the product.
- **Sort by score:** on an Amazon grocery search, pick *Ingredient Check score: High to Low* from the
  *Sort by* menu.
- **Keyboard shortcut:** on an Amazon search page, press `Alt+Shift+H` to see the list sorted by score.

## Set it up for you

The first time you open the extension, a short setup asks about:

- your **goals** (for example weight loss or vitamins)
- **allergens and diets** you avoid
- an **avoid list** of ingredients you do not want

Change any of this later from the extension icon → **Settings**, or click **Run setup again**.

---

## Privacy

- Scores are worked out on your computer.
- Settings can be backed up to your own Chrome account. You can turn that off.
- Full details: [docs/PRIVACY.md](docs/PRIVACY.md)

## Troubleshooting

| Problem | Try this |
|---|---|
| No Ingredient Check in `chrome://extensions` | Select the extracted release folder containing `manifest.json` |
| Errors on the card | Check you downloaded the Chrome ZIP, then press **Reload** |
| No score on a product | The label may be missing or unreadable. The product page offers a paste box. |
| Updated the code | Extract the newer release into the same folder, then press **Reload** |

---

## More information

- [Full feature guide](docs/FULL-README.md) — every feature in detail
- [Which stores are supported](docs/STORES.md)
- [How accurate are scores](docs/ACCURACY.md)
- [Browser setup, including Firefox](docs/BROWSERS.md)
- [Developer notes and tests](docs/VERIFY.md)
- [Support website](website/) and [deployment steps](website/README.md)

Licensed under [MIT](LICENSE).
