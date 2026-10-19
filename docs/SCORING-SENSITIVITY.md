# Scoring sensitivity

Generated from revision `2026-10-18.2` with `node scripts/scoring-sensitivity.mjs`.

This compares the current default model with processing weight zero, keeping every other preference unchanged. Ingredient deductions still apply. It measures model sensitivity, not health outcomes, and is not independent calibration.

| Label | Default | Processing off | Difference | Readable |
| --- | --- | --- | --- | --- |
| live-amazon-us-product-2026-10-01 | 89 | 98 | 9 | yes |
| live-amazon-uk-product-2026-10-01 | 35 | 63 | 28 | yes |
| live-target-product-2026-10-01 | 98 | 98 | 0 | yes |
| organic-whole-milk | 94 | 97 | 3 | yes |
| a2-grassfed-milk | 99 | 100 | 1 | yes |
| ultra-pasteurized-skim | 90 | 96 | 6 | yes |
| whole-milk-yogurt | 96 | 98 | 2 | yes |
| wild-sockeye-salmon | 99 | 99 | 0 | yes |
| atlantic-salmon-color-added | 67 | 77 | 10 | yes |
| commodity-ground-beef | 86 | 90 | 4 | yes |
| aga-grassfed-beef | 99 | 100 | 1 | yes |
| grassfed-butter | 96 | 97 | 1 | yes |
| extra-virgin-olive-oil | 96 | 98 | 2 | yes |
| refined-coconut-oil | 90 | 96 | 6 | yes |
| rolled-oats | 98 | 98 | 0 | yes |
| raw-honey | 85 | 93 | 8 | yes |
| pasture-raised-eggs | 98 | 99 | 1 | yes |
| soy-sauce | 48 | 88 | 40 | yes |
| sprouted-ezekiel-bread | 65 | 97 | 32 | yes |
| sourdough-bread | 78 | 95 | 17 | yes |
| white-sandwich-bread | 27 | 30 | 3 | yes |
| breakfast-cereal | 45 | 45 | 0 | yes |
| soy-protein-bar | 18 | 58 | 40 | yes |
| soda-hfcs | 30 | 30 | 0 | yes |
| diet-soda | 30 | 30 | 0 | yes |
| toaster-pastry | 18 | 18 | 0 | yes |
| potato-chips-plain | 63 | 63 | 0 | yes |
| potato-chips-avocado-oil | 94 | 97 | 3 | yes |
| peanut-butter-simple | 94 | 96 | 2 | yes |
| peanut-butter-industrial | 36 | 63 | 27 | yes |
| canned-tomatoes | 88 | 98 | 10 | yes |
| pasta-sauce-sugary | 36 | 63 | 27 | yes |
| chicken-broth | 45 | 85 | 40 | yes |
| bone-broth-clean | 74 | 93 | 19 | yes |
| deli-turkey-nitrite | 29 | 40 | 11 | yes |
| uncured-bacon | 24 | 64 | 40 | yes |
| almond-milk-gums | 34 | 74 | 40 | yes |
| greek-yogurt-fruit | 33 | 61 | 28 | yes |
| dates-only | 98 | 98 | 0 | yes |
| larabar-fruit-nut | 94 | 96 | 2 | yes |
| granola-bar-industrial | 5 | 5 | 0 | yes |
| sea-salt | 90 | 96 | 6 | yes |
| apple-cider-vinegar | 96 | 98 | 2 | yes |
| soda-natural-flavors | 44 | 84 | 40 | yes |
| ranch-dressing-disclosed | 29 | 63 | 34 | yes |
| cheddar-annatto-color | 80 | 96 | 16 | yes |
| eu-chocolate-e-numbers | 32 | 72 | 40 | yes |
| eu-diet-soda-e-numbers | 28 | 30 | 2 | yes |
| gummies-eu-azo-colours | 18 | 18 | 0 | yes |
| organic-cane-sugar-bag | 81 | 91 | 10 | yes |
| sandwich-bread-mono-diglycerides | 22 | 62 | 40 | yes |
| es-named-chocolate | 31 | 71 | 40 | yes |
| es-wheat-bread | 30 | 63 | 33 | yes |
| de-citric-vanillin | 29 | 69 | 40 | yes |

Processing and ingredient deductions can describe the same additive. Their effects are shown separately in the panel; hard ceilings can mask either effect. No automatic recalibration is inferred from these differences.

Independent evaluation still requires packaging-verified labels and reviewer judgments held out from rule development. Public database captures and translated twins retain their separate evidence types in [ACCURACY.md](ACCURACY.md).
