# Product cache

Reading a product from Amazon is the expensive part of a score: a page request per product, a few
at a time, and seconds of CPU when the label photo is read. Scoring what was read takes about a
millisecond. So the cache stores **what was read**, not the score:

- ingredient text, title, feature bullets, certifications, nutrition numbers
- how it was read (`via`) and whether the food gate passed it
- `unreadable` (no ingredients published) and `not-food`, so those are not re-fetched either

Every computer scores that under its own settings. Two people with different weights share every
row, a weight change rescores instantly instead of refetching, and a rule change needs no rescan.

Code: [`product-cache.js`](../src/engine/db/product-cache.js) (row shape, bounds, stale rule —
shared by the worker and the content scripts), [`background.js`](../src/background.js) (lookup,
write queue), [`search.js`](../src/content/search.js) (tile resolution), and
[`apps-script.gs`](apps-script.gs) (`lookup`, `products`).

## Lookup order

A search tile stops at the first source that can answer it:

1. **This computer's score** (`s:<store>:<asin>`), when it was worked out under the current settings.
2. **This computer's product data** (`p:<store>:<asin>`), scored on the spot. A weight change lands here.
3. **The shared `products` tab**, one request for every tile the first two could not answer.
4. **Amazon** — auto-score or hover, as before. The result is kept locally and uploaded.

The product page reads its own DOM first, which costs no request, and records what it read. When
Amazon published no ingredient text there, it asks this computer's `p:` entry and then the shared
tab before spending an Open Food Facts lookup or seconds of label OCR — someone may already have
read that label. Pasted lists and "Score anyway" overrides never leave the tab.

## Stale and rescan

A shared row is **stale** at `pulls >= 100` **or** 30 days after `scanned_at`, whichever comes
first. Readers skip stale rows, so the next visitor reads the product live and writes a fresh row.
Monthly, so a reformulated product is picked up. On this computer only the age counts.

Settings → *Speed* (`speedMode`, `src/engine/db/speed.js`) moves these ages on the reader's side only.
*Balanced*, the default, is the 30 days above. *Fastest* and *Faster* keep this computer's scores and
readings for 90 and 60 days. *Fresher* re-reads after 7 days and ignores shared rows older than 7
days. *Most up to date* re-reads after 1 day and never uses shared rows. Shared rows are never used
past 30 days, whatever the step, because the worker drops them first.

The twice-daily housekeeping sweep (`sweepCache` in `src/background.js`) deletes this computer's `s:`
and `p:` entries once they pass the current step's age, so a step's age is also how long they are
kept. Moving to a fresher step therefore deletes older readings at the next sweep; moving back does
not restore them. Open Food Facts records (`off:`) keep their own 30 days at every step.

- A newer scan replaces the row straight away, even before it is stale, and resets `pulls`.
- An older scan never overwrites a newer row.
- A pull counts only when its `scanned_at` still matches the row, so a view of an old scan never
  adds to a newer one.
- A robot-check or error page is never recorded as `unreadable` or `not-food`: a row is only
  written when the fetched page has a product title.

## Columns (`products` tab)

| Column | Contents |
| --- | --- |
| `key` | `store:asin`, e.g. `amazon.com:B00LOAW7U6` — one row per product per store |
| `store` | Amazon host without `www.` |
| `asin` | 10-character ASIN |
| `status` | `ok`, `unreadable`, or `not-food` |
| `data` | JSON: `title` (≤200), `text` (≤6000, the extractor's own limit), `labels` (≤3000), `certifications` (≤500), `nutrition` (known numeric fields only), `via`, `confidence`, `food` |
| `scanned_at` | ISO time of the read |
| `pulls` | How many times this read was served from the tab |

Nothing about the reader is stored: no settings, no score, no user or session id. Every field is
re-bounded by `sanitize()` whenever a row is read back, so a hand-made row cannot widen what the
engine is fed. A test scores the whole corpus from rows that went through a sheet cell and back and
checks every score matches the live read under several weight profiles.

## Reads

`POST { kind: 'lookup', keys }` with up to 100 `store:asin` keys — the tiles on the page the device
could not answer. The worker memoises answers (hits and misses) for 10 minutes, so infinite scroll
and a second observer pass do not ask again. Provenance (certifications for whole foods) is a
separate `GET ?kind=provenance`, fetched whole and kept for six hours.

## Writes

Upserts and pulls queue in `chrome.storage.local` (`productsQueue`, at most 300 of each). The queue
keeps the newest read per key and adds up pulls of the same read. It goes out as one
`{ kind: 'products', upserts, pulls }` POST:

- 15 seconds after the last queued item,
- straight away once 25 items are waiting, or
- on the housekeeping alarm.

Each POST carries at most 150 upserts and 150 pulls. After a failed send only the timer and the
alarm retry, so a broken endpoint does not get one request per tile. Items leave the queue only
when the script replies `tab: 'products'`.

## Off switch and offline

**Use the shared online database** (settings, on by default) turns reads and writes off together.
So does a build with no `ENDPOINT` ([SETTINGS-SYNC.md](SETTINGS-SYNC.md)). Either way the local
`p:` / `s:` cache keeps working, and anything it cannot answer is read from Amazon. A network
failure behaves the same: nothing waits on the sheet.

## Known ceilings

- The script reads the key column on every lookup and rewrites the whole tab on every write batch
  (`ponytail:` notes in `apps-script.gs`). Fine into the low tens of thousands of products; past
  that, keep a key→row map in `CacheService`, prune stale rows, or move off Google Sheets.
- All writes share one script lock, so heavy concurrent use returns `busy` and the queue retries.
- Pulls are counted only from browsers with the shared database on; for everyone else the 30-day
  limit decides the rescan.
- The endpoint URL ships inside the extension. Anyone who extracts it can write well-formed rows.
  Both sides re-check every row and a row only moves forward in time, but a plausible fake read
  would be served until a real read replaces it or it goes stale.
