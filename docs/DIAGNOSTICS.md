# Measuring whether the scores are right

The engine has 215 rules and a lot of hand-tuned constants. The test suite proves it behaves the
way it is specified to; it cannot tell you whether a score matches what a careful person would say
about the product. That needs volume, and it needs the evidence next to the answer.

Turning on **Accuracy diagnostics** sends one row per scored product — and one per scan that could not be
scored, and one per "Looks wrong?" click — to the shared database — the
same Apps Script and private spreadsheet as the product cache ([SETTINGS-SYNC.md](SETTINGS-SYNC.md)).

## Setup

1. Deploy the web app once (see [SETTINGS-SYNC.md](SETTINGS-SYNC.md)); the build carries its URL.
2. Extension settings → *Accuracy diagnostics* → tick **Send scoring diagnostics to the shared database**.

The sheet's `diagnostics` tab is created on the first write, with headers. To collect into a sheet
of your own instead, deploy the same script from it and build with that `ENDPOINT`.

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
| `outcome` | `scored`, or why there is no score: `unreadable` (no ingredient list found), `low-coverage` (list found, rulebase could not read it), `not-food` (food gate declined), `locale-declined` (Japanese/Arabic label, no local reader). `wrong-score` marks a "Looks wrong?" click |
| `feedback` | `looks-wrong` on a click; blank otherwise |

`ingredients` is what makes this diagnostic rather than decorative: without it a wrong score can be
noticed but not explained.

## Misses and feedback

A scan that produces no score is the cheapest signal there is, so it gets a row too: the product
(`asin`, `brand`, `product_name`, `source`) with `score` blank and the reason in `outcome`. Filter
`outcome` to anything but `scored` to see where the extension goes quiet, then group by `brand` or
`store`. A `low-coverage` row also carries `coverage`, `parsed` and `ingredients`, so the missing
vocabulary is on the row.

The **Looks wrong?** link on a product's score panel files the full row with `outcome` =
`wrong-score`, `feedback` = `looks-wrong`. It is one click, so it says a score is disputed, not in
which direction: read `ingredients`, `penalties` and `bonuses` beside it. Like every row it is sent
only while diagnostics is on (the older report to the `reports` tab is unchanged).

Sheets made before these columns existed are upgraded on the next write: `rowId` moves to column 27
and the two new headers appear. Publish a new version of the Apps Script deployment first.

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

**Send queued rows now** in settings flushes immediately and reports what happened. Only the
settings page can ask for that flush. The service worker refuses `flushDiagnostics` from the popup,
the setup page, a content script or any other page. The same applies to the queue status, the
database refresh and the Google-account save and restore (`SETTINGS_MESSAGE_TYPES` in
`src/worker/messages.js`). The alarm and the full-batch flush run inside the worker and are not
affected.

The same web app serves the product cache, provenance and account settings; each has its own tab.
Publish a new version of the deployment after updating [`apps-script.gs`](apps-script.gs).

Each queued row carries a `rowId`, and each POST carries a `batchId`. The Apps Script in
`docs/apps-script.gs` remembers recent ids so a lost acknowledgement cannot duplicate the
batch. Redeploy the web app after updating the script. `rowId` is transport-only and is not
written to the sheet.
