# Accuracy evidence

What the tests actually show about score accuracy, by language and by where the ingredient text
came from. Read this before you claim a language or a source works. `tests/languages.test.js`
checks the evidence table below against `tests/corpus.json`, so this page cannot quietly claim
more than the corpus holds.

The test suite proves the engine matches its spec. It does **not** prove that the spec matches
real labels. Only real labels read off live pages can show that, and the corpus has none yet.

## Evidence types

Every corpus entry declares `lang` and `evidence`:

| Evidence | Meaning |
|---|---|
| `live-capture` | Verbatim, sanitized text read off a live Amazon page. Must also record `store`, `via` (the extractor) and `captured` (date). |
| `representative` | Modelled on a named real product and typed in by hand. Not a verbatim capture. |
| `synthetic` | Written to exercise a rule, or a translation of an English list. |

## What the corpus holds

| Lang | Evidence | Entries |
|---|---|---|
| `en` | representative | 40 |
| `en` | synthetic | 11 |
| `es` | synthetic | 4 |
| `de` | synthetic | 2 |
| `und` | synthetic | 1 |

There are no `live-capture` entries in any language. Every non-English entry is `synthetic`.

## By language

| Language | Stores | What exists | Status |
|---|---|---|---|
| English | .com, .co.uk, .ca, .com.au, .ie, .in, .sg, .ae, .sa | 40 representative + 11 synthetic corpus entries; the live checks in [history/LIVE-TEST-2026-09-05.md](history/LIVE-TEST-2026-09-05.md) | Strongest. Still no verbatim captures in the corpus. |
| German, Spanish | .de, .es, .com.mx | Synthetic corpus entries (2 de, 4 es); translated twins in `tests/synonyms.test.js` | **Under-tested.** The synonym pack maps the common words onto English rules. No real German or Spanish label has been checked. |
| French, Italian, Portuguese, Dutch | .fr, .it, .com.br, .nl, .com.be | Translated twins in `tests/synonyms.test.js` only | **Under-tested.** No corpus entries. The twins show the synonyms match the English rules, not that real labels score well. |
| Swedish, Polish, Turkish | .se, .pl, .com.tr | Ten translated twins each in `tests/synonyms.test.js` (since 2026-09-26), plus the twins in `tests/languages.test.js` | **Under-tested.** No corpus entries. Every twin gives the English reasons, score and NOVA class. Before 2026-09-26 there was no synonym pack, and a list that cleared the gate on a few recognised words could score far too well (a Swedish biscuit 80 against 25 in English). |
| Japanese, Arabic | .co.jp, .ae / .sa listings in Arabic | `原材料` heading; OCR turned off for these stores | **Not supported.** Declined. |

**Swedish near miss (measured, fixed 2026-09-26).** Swedish chips (`Potatis, solrosolja, salt,
smakförstärkare (E621), dextros`) read as 33% recognised, one point under the 34% gate. The rules
didn't know `solrosolja` (sunflower oil), so the list missed the refined-oil cap: shown, it would
have scored 46 against 25 for its English twin. Other Swedish lists did clear the gate that way. A
biscuit list scored 80 against 25, and a hazelnut spread 55 against 36. The Swedish, Polish and
Turkish words for sugars, oils, flours, flavourings, lecithins, starches, acids, preservatives and function words
now map onto the English rules. Every twin scores exactly like English (`tests/languages.test.js`,
`tests/synonyms.test.js`). The same change fixed three English and Romance gaps the twins exposed.
UK "flavourings" and "natural flavourings" were charged nothing. Italian "aroma naturale" was charged
nothing. German and Dutch "natürliches Aroma" were charged twice. One corpus product moved: chicken
broth, 35 → 33, because "natural flavoring" is now charged as natural flavour (like "natural flavor")
rather than as unspecified flavouring. `RULES_REVISION` became `2026-09-26.8`, and `2026-09-26.9`
when Turkish followed (its "İ" lower-cases to "i" plus a combining dot, which no rule could match, so
entries are now normalised).

**Turkish false positive (caught 2026-09-25, fixed).** The goals change added a legume rule that
skipped "oil" and "lecithin" only in English. Turkish writes soy lecithin as `soya lesitini`, so it
was recognised as a legume. That lifted a Turkish chocolate list from 33% to 50% recognised, over the
gate, and it scored 49 against 31 for its English twin. `tests/languages.test.js` failed when the
goals change was merged. The rule now also skips the Turkish, French, Spanish, Italian and Polish
spellings of lecithin, and Turkish `yağ` (oil). `RULES_REVISION` became `2026-09-25`. The evidence is
a synthetic twin and the rule's own stated intent. No real Turkish label was checked. No default
score changed in the corpus under any goal (58 corpus entries, 51 products and 7 defects, × 21 settings compared).

**Whole-milk kefir scored as fat-reduced (reported 2026-09-25, fixed).** Lifeway Organic Plain
Kefir (amazon.com `B0DX45213W`) lists *pasteurized organic milk, organic nonfat milk, pectin…*: whole
milk first, 8 g fat in a 150-calorie bottle. The fat-reduced dairy rule fired on the nonfat milk, so
the kefir took a processing penalty by default (81) and a +15 "a plus for your goals" under Weight
loss (91, ranked like a cutting food). The rule now stands down when full-fat dairy comes earlier in
the list (ingredients are listed by weight) or the title says whole milk / full fat, and the panel
says so. Now 88 by default and 76 under Weight loss; the same kefir made with lowfat milk still ranks
above it for weight loss. Plant milks and milk fractions (protein, whey, nonfat dry milk) ahead of
the nonfat milk do not count as full-fat dairy. The label was read from the owner's screenshot of the
listing, not captured by the extension. No corpus entry changed (3 of the 58 entries contain fat-reduced dairy;
none has full-fat dairy ahead of it). `RULES_REVISION` became `2026-09-25.1`.

## Automated evidence and live observations

These are different kinds of evidence. Only the second kind says anything about a real store.

**Automated** (repeatable, runs in CI or locally, no live store):

- `npm test`: engine, corpus bands, synonym and language twins, extraction on sanitized snapshots.
- `npm run harness:ci`: the panel, lifecycle, OCR engine and popup/settings pages in Chromium, on
  local pages.
- Local runs of the unpacked extension in Chromium with Amazon replaced by a local server
  ([VERIFY.md](VERIFY.md), 2026-09-24/25). They prove the extension's own chain works, not that
  Amazon's pages still look the way the fixtures assume.

**Live observations** (a real store page in a real browser), newest first:

| Date | Store | What was seen | Source |
|---|---|---|---|
| 2026-09-25 | amazon.com | Lifeway kefir `B00LOAW7U6`: 31 Poor from the label photo and 30 Poor from Open Food Facts. Two independent readings agree | [VERIFY.md](VERIFY.md) live record |
| 2026-09-25 | amazon.com | Grocery search "organic rolled oats": 20 tiles scored 95–97 from `nic-ingredients-content`, several `?` where no list was published | same |
| 2026-09-25 | target.com | Avocado-oil chips 96, organic oats 95 from *Label info*. Read behind Target's bot check | [STORES.md](STORES.md) |
| 2026-09-24 | amazon.com | "The low-fat kefir" (product not named) scored 31 at default weights and 44 under Weight loss + Vitamins & minerals; the score held through 30 s of page updates | Reported in the goals commit (`bcfcc87`). Not re-checked here. |
| 2026-09-05 | amazon.com | Lifeway kefir `B00LOAW7U6`: blurb refused with fallbacks off; 29 Poor from the label photo (before the `web_accessible_resources` change) | [history/LIVE-TEST-2026-09-05.md](history/LIVE-TEST-2026-09-05.md) |
| 2026-09-05 | amazon.com | Organic-oats grocery search scored tiles; running-shoes search showed nothing | same |

None of these were captured as corpus entries, so none can be replayed. The Target chips and oats
lists are kept as sanitized page fixtures (`tests/pages/target-p-*.html`), which test reading, not
score accuracy. No live observation exists for any non-English Amazon store.

## By extraction source

`via` on a diagnostics row or a shared-database row says how the text was read.

| Source (`via`) | Tested by | Live status |
|---|---|---|
| `nic-ingredients-content` | `tests/pages.test.js` (US oats snapshot), `npm run harness:ci` | Seen live on .com (Sept 5 log) |
| `heading-scan:*`, `scope:*`, `line-*` | `tests/pages.test.js` (SE expander, TR inline), `tests/ocr.test.js` | .se layout built by hand from a captured shape, not a live capture |
| `feature-bullets` | `tests/pages.test.js` (Lay's placeholder case) | Lay's `B0005Z6FYA` shape seen live |
| `label-ocr` | `tests/ocr.test.js`, the OCR smoke in `harness:ci` (no Amazon image) | Last seen live **before** `web_accessible_resources` was removed. Not rechecked since. See [VERIFY.md](VERIFY.md). |
| `open-food-facts` | `tests/background.test.js` (fetch mocked) | Seen live 2026-09-25 with the host granted (kefir 30 Poor). The grant dialog itself was not exercised. |
| shared database rows | `tests/product-cache.test.js`, `tests/background.test.js` | Seen live 2026-09-25: upload, read-back and diagnostics against the deployed Apps Script |
| `label-ocr` (post-WAR) | as above | Seen live 2026-09-25 on the kefir (31 Poor) |
| Target *Label info* | `tests/target.test.js` | Seen live 2026-09-25 behind Target's bot check |

## The coverage gate

`MIN_COVERAGE = 0.34` in `src/content/page.js`. A list with less than a third of its entries
recognised is declined rather than scored. `tests/languages.test.js` fails if the gate moves, or
if `tests/corpus.test.js` calibrates against a different value. Do not lower it to make more
products score. The Swedish case above shows what a lower gate would put on the page.

## Real labels from Open Food Facts (2026-09-26)

About 650 real ingredient lists, the most-scanned products with a list in the store's language
(`world.openfoodfacts.org` search API, one pull per language), were scored to find words no rule
reads. This is real label text, but transcribed by Open Food Facts contributors, not read off Amazon
by the extension, so none of it is in the corpus and none of it counts as a live capture.

What it found, and what changed:

- **Parsing gaps that moved scores.** A declared share ("sugar 20%", "Zucker 45 %", Turkish "%13"),
  a decimal comma ("azúcar 8,5%"), an organic or footnote marker ("sucre*"), the EU colon form
  ("emulsifier: lecithins") and Open Food Facts' own allergen markup (`_WHEAT_`) each hid an
  ingredient from its rule. "May contain traces of wheat" was charged as wheat.
- **64 words English already charges**, missing in other languages (Dutch glucose-fructose syrup and
  rapeseed oil, German citric acid, phosphoric acid in three languages, Italian MSG, and others),
  pinned as twins in `tests/synonyms.test.js`.
- **Coverage.** Real lists were declined as unreadable because everyday words (água, zout, sól,
  Kohlensäure, poudres à lever, vitamins, nuts) matched nothing. Declined lists, before and after:

  | Language | Lists | Declined before | Declined after |
  |---|---|---|---|
  | French | 97 | 16 | 3 |
  | German | 60 | 6 | 1 |
  | Spanish | 54 | 11 | 0 |
  | Italian | 51 | 7 | 1 |
  | Portuguese | 58 | 18 | 1 |
  | Dutch | 41 | 21 | 1 |
  | Swedish | 58 | 4 | 1 |
  | Polish | 59 | 9 | 2 |
  | Turkish | 61 | 8 | 2 |
  | English (UK) | 92 | 2 | 2 |

  These are the same lists the words were taken from, so the "after" column is an upper bound on
  how well unseen labels will do. Nothing added for coverage is charged; words that would open the
  gate for a non-food list (a bare "sodium", "sweetener" or "acid") were left out on purpose.
  (Last measured 2026-09-27.)

  **A second sample, not used to write the rules.** Page 2 of the same searches (661 more lists, none
  of them in the first sample) was scored with the rules as they stood, before any word from it was
  added. That is the fairer measure of an unseen label: 23 of 661 declined (3.5%), against 20 of 631
  in the first sample after its fixes. French 4 of 94, German 1 of 47, Spanish 0 of 71, Italian 1 of
  69, Portuguese 5 of 58, Dutch 1 of 44, Swedish 3 of 55, Polish 1 of 76, Turkish 6 of 56, English 1 of
  91. It also turned up 27 words English already charges (a Portuguese glucose syrup, Italian
  sucralose, Spanish sucrose, Dutch potassium phosphates…), which were then added.

  **A third sample** (page 3, 715 lists, none in the first two), scored the same way after the second
  sample's fixes: 26 of 715 declined (3.6%). Nearly all of them are Swedish (7) and Turkish (8), and
  most of those are not ingredient lists at all (nutrition panels, mineral-water analyses, Norwegian
  or Cyrillic text); the ones that were lists used words added after this measurement (accented
  erythritol, steviol glycosides, buckwheat, tahini, whole-grain durum). The rate did not fall between
  the second and third samples, which is the honest reading: the vocabulary each sample adds mostly
  fixes that sample.

  With every fix since, the three samples together decline 36 of 2,007 (1.8%): 14 of 631, 11 of 661
  and 11 of 715. These are the lists the words came from, so this is the in-sample figure; the 3.5%
  and 3.6% above are the out-of-sample ones. (Measured 2026-09-27, `RULES_REVISION` 2026-09-27.35.)

### The same product in two languages (2026-09-27)

About 550 products whose Open Food Facts record carries the list in English and in one or more other
label languages give about 1,050 pairs where both lists are readable. A pair's two scores should
agree unless the two lists really differ (Open Food Facts often has an older recipe or a looser
translation in one of them, so they never all agree). Comparing them found fixes in the engine, not
only in the vocabulary, each pinned in `tests/synonyms.test.js`:

- **Parsing.** Brackets inside brackets closed at the first ")"; a "may contain" statement was split
  at its commas and its bracket, so the traces were charged; an organic word after the ingredient
  ("sucre bio") hid it from every anchored rule; a function word in a sub-list was "named" by its
  siblings; a denial ("sans conservateurs") and an origin note stayed as ingredients.
- **Negation.** "non-hydrogenated palm oil" was charged as hydrogenated fat (25 where palm oil scores
  90), in English as well.
- **Word edges.** `\b` cannot sit against an accented letter, so "amidon modifié", "äppelsyra" and
  "hydrogéné" never matched; `tests/accent-boundaries.test.js` now fails on any such pattern.
- **English gaps found on the way**: "sodium metabisulfite" matched no sulphite rule, PGPR had no rule,
  and "pistachio nuts" and "peanut kernels" were not whole foods.

Pairs whose scores differ by 8 points or more went from 206 to 143, and pairs in different NOVA
classes from 106 to 81. As with the declines above, these are the pairs the fixes were found on.

## Allergen and diet flags

Flags never move the score, and a missing flag looks exactly like "clear", so the rule in
`src/engine/db/allergens.js` is to flag borderline terms rather than miss them. What the tests hold
(`tests/audit-2026-09-16.test.js`, `tests/label-languages.test.js`):

- **The declaration words themselves**: "Contains: tree nuts", "shellfish", UK "nuts", and the generic
  words in Spanish, Italian, French and German (frutos secos, frutta a guscio, fruits à coque,
  Schalenfrüchte, Nüsse).
- **Allergens named only by the food**: cheeses, curds, butterfat, half-and-half (milk); aioli,
  eggnog, German egg compounds (egg); graham, panko, breadcrumbs, shortbread (wheat); natto, TVP
  (soy); surimi, bonito, caviar, roe, dashi (fish); pesto, nougat, frangipane (tree nuts); halva,
  gomasio, za'atar (sesame); metabisulfite salts (sulfites); dijon (mustard).
- **Animal ingredients in each language** for the vegetarian and vegan checks, plus collagen, pepsin,
  confectioner's glaze and L-cysteine.
- **Look-alikes that must stay clear**: peanut butter, cocoa butter and coconut milk (dairy), milk
  thistle, crab apple, bean curd, breadfruit, tiger nuts, nutmeg, lemon rind, porcini, "vitamin D3
  (from lichen)".
- **Swedish, Polish, Dutch, Portuguese and Turkish** (`tests/label-languages.test.js`): every allergen, the
  meat, fish and honey words for the diet checks, and pork for pork-free. Before 2026-09-26 a Swedish
  or Polish list raised only a soy flag, and a Dutch or Portuguese one missed milk. Plant milks and
  butters in those languages (kokosmjölk, masło kakaowe, cacaoboter, manteiga de cacau) and lactic
  acid (mjölksyra, melkzuur, Milchsäure, which also flagged as milk before) stay clear. Foreign fish
  and shellfish words now conflict with vegetarian as well as flagging the allergen.
- **Keto, corn and nightshades in every label language** (2026-09-26, from comparing products whose
  Open Food Facts record has the list in English and another language). Keto had conflicted only
  with English words, so it cleared nearly every non-English list with sugar or flour; corn and
  nightshades likewise. Nut and coconut flours, `maison` and sweet potato stay clear. Five corpus
  entries in German and Spanish gain the keto or corn flag their English twins would have.

Every flag change is checked against all 58 corpus entries (51 products and 7 defects): none of them changes its flags, except the five keto and corn flags noted above. What is
**not** proven: that a real label never words an allergen some other way. The panel says so next to
the flags, and the probe lists above are where a new miss belongs.

## Adding real evidence

1. Turn on **Send scoring diagnostics**, or copy the text from the panel.
2. Remove anything that is not the ingredient list, such as seller names or any account details.
   Keep the store, the ASIN and `via`.
3. Add it to `tests/corpus.json` with `"evidence": "live-capture"`, `store`, `via` and
   `captured`. Set a band that a careful reading of the physical label supports.
4. If it fails, you have found a miss. Keep the entry, then fix the rules and bump
   `RULES_REVISION`. `tests/rules-revision.test.js` tells you how.
5. Update the tables on this page. The test tells you which row changed.
