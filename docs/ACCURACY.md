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
| Swedish, Polish, Turkish | .se, .pl, .com.tr | Headings are recognised (`tests/pages.test.js`). Synthetic twins in `tests/languages.test.js` | **Not supported.** No synonym pack. Most lists are declined by the coverage gate. A list with several E-numbers can clear the gate. The E-numbers then set the score, and it matches the English twin. |
| Japanese, Arabic | .co.jp, .ae / .sa listings in Arabic | `原材料` heading; OCR turned off for these stores | **Not supported.** Declined. |

**Swedish near miss (measured).** Swedish chips (`Potatis, solrosolja, salt, smakförstärkare
(E621), dextros`) read as 33% recognised, one point under the 34% gate. The rules don't know
`solrosolja` (sunflower oil), so the list misses the refined-oil cap. If it were shown, it would
score 46. Its English twin scores 25. `tests/languages.test.js` pins this, so it fails if the gate is
lowered or if the list starts to score without the cap.

**Turkish false positive (caught 2026-09-25, fixed).** The goals change added a legume rule that
skipped "oil" and "lecithin" only in English. Turkish writes soy lecithin as `soya lesitini`, so it
was recognised as a legume. That lifted a Turkish chocolate list from 33% to 50% recognised, over the
gate, and it scored 49 against 31 for its English twin. `tests/languages.test.js` failed when the
goals change was merged. The rule now also skips the Turkish, French, Spanish, Italian and Polish
spellings of lecithin, and Turkish `yağ` (oil). `RULES_REVISION` became `2026-09-25`. The evidence is
a synthetic twin and the rule's own stated intent. No real Turkish label was checked. No default
score changed in the corpus under any goal (58 products × 21 settings compared).

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

## Adding real evidence

1. Turn on **Send scoring diagnostics**, or copy the text from the panel.
2. Remove anything that is not the ingredient list, such as seller names or any account details.
   Keep the store, the ASIN and `via`.
3. Add it to `tests/corpus.json` with `"evidence": "live-capture"`, `store`, `via` and
   `captured`. Set a band that a careful reading of the physical label supports.
4. If it fails, you have found a miss. Keep the entry, then fix the rules and bump
   `RULES_REVISION`. `tests/rules-revision.test.js` tells you how.
5. Update the tables on this page. The test tells you which row changed.
