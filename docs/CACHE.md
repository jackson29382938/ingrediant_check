# Shared ratings cache

A score worked out once can badge a search result for everyone else who uses the same engine
version and scoring settings. The shared copy is the `ratings_cache` tab on the existing shared
spreadsheet (see [SETTINGS-SYNC.md](SETTINGS-SYNC.md)). No new Drive file is created.

Code: [`ratings-cache.js`](../src/engine/db/ratings-cache.js) (rules, shared by the worker and the
content scripts), [`apps-script.gs`](apps-script.gs) (`kind: 'ratings'`), and
[`background.js`](../src/background.js) (read index, write queue).

## Lookup order

Search badges try each source in turn and stop at the first usable score:

1. **On-device cache** (`s:<store>:<asin>` in `chrome.storage.local`, 30-day TTL).
2. **Shared `ratings_cache`**, when it has a fresh row whose `prefs` matches this browser.
3. **Live score** (auto-score or hover), as before.

A shared hit is painted but not copied into the on-device cache. Every later view asks the shared
tab again, which keeps the pull count honest and the 14-day rule in charge. The product page always
scores live.

## Columns

| Column | Contents |
| --- | --- |
| `key` | `store:asin:prefs`, one row per product per scoring setup |
| `store` | Amazon host without `www.`, e.g. `amazon.com` |
| `asin` | 10-character ASIN |
| `score` | Integer 0–100 |
| `verdict` | Short label, e.g. `Good` |
| `prefs` | `p` + FNV-1a hash of the engine version and the score-cache fingerprint (rules revision, weights, food-only, sheet revisions) |
| `source` | Where the ingredient text came from, e.g. `search-tile`, `label-ocr` |
| `nova` | 1–4, or blank |
| `name` | Product title, at most 80 characters |
| `scanned_at` | ISO time of the scan |
| `pulls` | How many times this scan was served from the tab |

Ingredient text, notes, and browse history are not stored. Manual pastes and food overrides never
leave the device. The Apps Script creates the tab, with its header row, on the first write
(`sheetFor`, the same as `settings` and `diagnostics`). Cells are written with a leading `'` so
Sheets keeps ISO dates, all-digit ASINs, and anything starting with `= + - @` as text.

## Stale and rescan

A row is **stale** when `pulls >= 100` **or** `scanned_at` is 14 or more days old, whichever comes
first. Readers skip stale rows, so the next visitor scores live and writes a fresh row.

- A newer local scan upserts straight away, even when the row is not stale yet.
- An older scan never overwrites a newer row.
- An upsert that replaces a row resets `pulls` to 0.
- A pull counts only when its `scanned_at` still matches the row, so a view of an old scan never
  adds to a newer one.

## Reads

The worker fetches the whole tab from `gviz/tq?tqx=out:csv&sheet=ratings_cache` on the database
URL. It never asks for one ASIN, so the sheet host does not learn what you browse. The index is
kept in IndexedDB for 6 hours and uses the provenance size caps (2 MB, 8000 rows). An empty
database URL turns reads off. A published `/e/` URL cannot select a tab by name, so it gets no
shared ratings.

## Writes

Writes go to the Contribution URL (`/exec`) that you paste. Nothing invents one. They are sent only
when **Send certifications and scores I come across back to the sheet** is ticked.

Upserts and pulls are queued in `chrome.storage.local` (`ratingsQueue`, at most 300 of each). The
queue keeps the newest scan per key and adds up pulls of the same scan. It goes out as one
`{ kind: 'ratings', upserts, pulls }` POST:

- 15 seconds after the last queued item,
- straight away once 25 items are waiting, or
- on the housekeeping alarm.

Each POST carries at most 150 upserts and 150 pulls. After a failed send, only the 15-second timer
and the alarm retry, so a broken endpoint does not get one request per tile. Items leave the queue
only when the script replies `tab: 'ratings_cache'`. An older deployment that does
not know the kind appends to `contributions` and is not counted as delivered. After updating
`apps-script.gs`, redeploy it (**Deploy → Manage deployments → Edit → New version**).

## Known ceilings

- The script rewrites the whole tab on each batch. That is fine up to the 8000 rows the extension
  will read. Past that, prune stale rows by hand or move to per-row writes.
- Pulls are counted only from browsers that have sharing on. Readers without it are not counted, so
  for them the 14-day age limit usually decides when a row is rescanned.
- `prefs` is a 32-bit hash, so two setups could collide. The chance for one product is negligible.
- Anyone who holds the `/exec` URL can write rows. Both sides re-check every row (ASIN, score range,
  source), but a bad score that is well-formed would still be served until it goes stale.
