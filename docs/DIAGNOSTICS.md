# Measuring whether the scores are right

The engine has 215 rules and a lot of hand-tuned constants. The test suite proves it behaves the
way it is specified to; it cannot tell you whether a score matches what a careful person would say
about the product. That needs volume, and it needs the evidence next to the answer.

Turning on **Accuracy diagnostics** sends one row per scored product to a Google Sheet you own.

## Setup

1. Create a Google Sheet.
2. **Extensions → Apps Script**, paste [`apps-script.gs`](apps-script.gs) over `Code.gs`, save.
3. **Deploy → New deployment → Web app**, execute as *Me*, access *Anyone*. Copy the `/exec` URL.
4. Extension settings → *Shared provenance database* → **Where to send contributions** → paste it.
5. Extension settings → *Accuracy diagnostics* → tick **Send scoring diagnostics to my endpoint**.

The sheet's `diagnostics` tab is created on the first write, with headers.

## What a row contains

| Column | Why it is there |
| --- | --- |
| `ts`, `version`, `store` | When, which build, which Amazon store |
| `asin`, `upc`, `brand`, `product_name` | Identify the product and look it up again |
| `source` | **The most useful column.** `nic-ingredients-content`, `open-food-facts`, `label-ocr`, `manual-paste`, `search-tile` — accuracy differs enormously between them |
| `via`, `confidence` | Which extraction tier fired |
| `gate` | Why the food gate let it through |
| `coverage`, `parsed` | How much of the list the rulebase recognised, out of how many entries |
| `score`, `verdict`, `nova`, `base`, `cap` | What came out |
| `penalties`, `bonuses` | Every row the panel showed, as `-13 Refined added sugar; …` |
| `flags`, `provenance` | Allergen/diet flags and certification handling |
| `weights` | Only the weights differing from default, so a row is reproducible |
| `ingredients` | The text that was actually scored |

`ingredients` is what makes this diagnostic rather than decorative: without it a wrong score can be
noticed but not explained.

## Questions worth asking of the data

Sort or filter the sheet:

- **Where does the engine go quiet?** `coverage` below 40 means the rulebase could not read the
  list. Cluster those by `brand` and you find the vocabulary that is missing.
- **Is a source untrustworthy?** Group `score` by `source`. If `label-ocr` rows skew high, OCR is
  dropping the tail of lists — which is where additives live.
- **Which rules carry the score?** `penalties` is greppable. A rule that never appears is either
  dead or its pattern is wrong; one that appears on everything may be too broad.
- **Are caps firing correctly?** Filter `cap` non-empty and read the `ingredients` beside it.
- **Did the food gate leak?** Filter obviously non-food `product_name` and read `gate`.
- **Same product, different answers?** Group by `upc` across `source`. Two sources disagreeing by
  more than a band is a bug in one of them — this is exactly how the Lifeway kefir error surfaced,
  where Amazon's own text said 86 and both Open Food Facts and OCR said 28.

## What is not collected

No name, account, user id or session id. Nothing from any page other than the product being
scored. No timing or history beyond the `ts` on each row.

It does record **which products were scored**. With *Rate every search result* enabled that is a
row per tile, which is a meaningful trace of browsing. It goes only to the endpoint configured
above. This is why the feature is off by default and says so in plain words in settings.

## Cost and batching

Rows accumulate in extension storage and are posted in batches of 12, with a flush on the twice-
daily housekeeping alarm so a partial batch is not stranded. The queue is capped at 300 rows;
beyond that the oldest are dropped, because losing diagnostic rows is a non-event and filling the
storage quota is not. A failed POST keeps the rows for the next attempt.

**Send queued rows now** in settings flushes immediately and reports what happened.

Each queued row carries a `rowId`, and each POST carries a `batchId`. The Apps Script in
`docs/apps-script.gs` remembers recent ids so a lost acknowledgement cannot duplicate the
batch. Redeploy the web app after updating the script. `rowId` is transport-only and is not
written to the sheet.
