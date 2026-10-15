# Ingredient Check

**See how healthy a grocery product is before you buy it.**

Ingredient Check is a Chrome extension (also works in Firefox). When you shop on Amazon, it reads the
ingredient list and gives the product a score from **0 to 100**. Scores are worked out on your own
computer, and you choose which things matter to you.

> This is a guide to what is written on the label. It is not medical or allergy advice.
> Always read the package.

---

## Install in Chrome (about 3 minutes)

You need **Chrome 116 or newer** and **Node.js 20 or newer** (download it from nodejs.org if you do not have it).

**1. Download the code**

Click the green **Code** button above, then **Download ZIP**. Unzip it into a folder you can find again.

**2. Build the extension**

Open Terminal in that folder and run:

```bash
npm run pack
```

This creates a folder called `dist/unpacked`.

**3. Load it into Chrome**

1. Open a new tab and go to `chrome://extensions`
2. Turn on **Developer mode** (switch in the top right)
3. Click **Load unpacked**
4. Select the `dist/unpacked` folder

You should see **Ingredient Check** in your list of extensions.

**4. Pin it**

Click the puzzle-piece icon in Chrome's toolbar and click the pin next to **Ingredient Check**.
Its score for the product you are looking at will show on the icon.

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
| No Ingredient Check in `chrome://extensions` | Check you selected the `dist/unpacked` folder, not the top folder |
| Errors on the card | Run `npm run pack` again, then press the **Reload** button on the card |
| No score on a product | The label may be missing or unreadable. The product page offers a paste box. |
| Updated the code | Run `npm run pack`, then press **Reload** on the card (keep the same folder) |

---

## More information

- [Full feature guide](docs/FULL-README.md) — every feature in detail
- [Which stores are supported](docs/STORES.md)
- [How accurate are scores](docs/ACCURACY.md)
- [Browser setup, including Firefox](docs/BROWSERS.md)
- [Developer notes and tests](docs/VERIFY.md)
- [Support website](website/) and [deployment steps](website/README.md)

Licensed under [MIT](LICENSE).
