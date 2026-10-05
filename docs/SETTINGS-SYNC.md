# The shared database and settings online

Everything online goes through **one Apps Script web app** deployed from the shared spreadsheet.
The extension never reads the sheet directly, so the sheet stays private: nobody can open or edit
it. Scoring stays local either way.

| | |
| --- | --- |
| Spreadsheet | Ingredient Check — settings & provenance |
| ID | `1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y` |
| Endpoint | `ENDPOINT` in [`src/engine/db/prefs.js`](../src/engine/db/prefs.js) — the **Web app** deployment's `/exec` URL |

While `ENDPOINT` is empty the extension runs entirely on the computer: no shared cache, no
provenance, no diagnostics or contributions. The Chrome-account settings backup still works.

## Tabs

| Tab | Created by | Contents |
| --- | --- | --- |
| First sheet | You | Provenance: `asin`, `upc`, `brand`, `certifications`, `feed`, `origin`, `verified_by`, `notes` |
| `producers` | You (optional) | Brands confirmed in a certifier's own directory: `brand`, `certifications`, … |
| `products` | Script, first shared write (only once product rows are opened) | The product cache. See [CACHE.md](CACHE.md) |
| `accounts` | Script, first Google sign-in save | `id` (SHA-256 of the Google account id), `payload`, `ts` |
| `diagnostics` | Script, first batch | See [DIAGNOSTICS.md](DIAGNOSTICS.md) |
| `reports`, `contributions` | Script | "Looks wrong?" clicks and shared certifications |

The old one-row `settings` tab (every user's save replaced the last, and anyone with the link could
read the allergens in it) and the `ratings_cache` tab are no longer used and can be deleted.

## Deploy (once)

1. Open the spreadsheet. **Share → General access → Restricted.** The script runs as you, so it
   can still read and write; nobody else can open the sheet.
2. **Extensions → Apps Script.** Replace `Code.gs` with [`apps-script.gs`](apps-script.gs). Save.
3. **Deploy → New deployment → Web app.** Execute as **Me**, Who has access **Anyone**.
   Authorize when asked (spreadsheet access, and "connect to an external service" — that is the
   Google token check used by sign-in).
4. Copy the URL ending in `/exec` into `ENDPOINT` in `src/engine/db/prefs.js` and ship the build.
   It must come from a **Web app** deployment. A **Library** deployment also gets an `AKfycb…` id,
   but its `/exec` URL answers `403 Access Denied` to everyone. Check in an incognito window: a
   working URL shows `{"ok":true,"service":"ingredient-check",…}`.

Product rows (`lookup`, `products`) stay **closed** after this: the script neither stores nor serves
them. Anyone who has the `/exec` URL can write a row, and nothing checks that its ingredient text is
true ([CACHE.md](CACHE.md), *Trust*). To open them anyway, **Project Settings → Script Properties →
Add** `PRODUCTS_OPEN` = `true`; delete the property to close them again. No redeploy is needed.
Readers still have to turn on *Share product readings with other computers* in their own settings.

After changing the script, **Deploy → Manage deployments → Edit → New version**. That keeps the
same `/exec` URL; a *new deployment* would change it and every installed copy would lose the
database until the next release.

## Settings online

The settings on the computer are always the ones in use. Nothing is ever applied on its own.

- **Chrome account backup** (default on). After every change the settings — weights, allergens,
  diets, goals and their importance, the avoid list, sort/speed/display preferences and the toggles, never the master switch — are written to
  `chrome.storage.sync`. New backups use a versioned `icBackup` pointer plus byte-sized avoid-list chunks in alternating banks, committed only after the parts are written. Legacy `icBackupAvoid` backups remain readable. Failed writes retain the prior copy, show an error, and retry through a Chrome alarm. Partial cross-device sync is detected and must finish before restore.
  Chrome syncs that privately to the Google account signed into Chrome. **Restore from my Chrome
  account** brings it back after a confirmation. No setup, and nothing goes to the shared sheet.
- **Sign in with Google** (optional, disabled until configured). For a browser that is not signed
  into Chrome. The options page gets an OAuth access token (scopes `openid email profile`) through
  `chrome.identity.launchWebAuthFlow` and hands it to the worker for one request. The script asks
  Google who the token belongs to, refuses a token issued to any other app, and keys the row by a
  SHA-256 of the account id — not the email. The token is never stored. Only the signed-in name,
  email and picture are kept, in this browser's local storage, to show who is signed in at the top of
  Settings; they are never backed up or exported, and **Sign out** deletes them.
- **Automatic Google saving** (default on while signed in). After every settings change the worker
  waits about eight seconds, asks Google for a token without opening a window (`prompt=none`) and
  writes the same copy as **Save my settings to Google**. It runs only once this computer has saved
  to or restored from the account (`googleLinked`), so a new computer cannot overwrite a saved copy
  with its defaults. If Google needs the reader again, saving pauses with a status on the settings
  page and nothing is opened; pressing **Save my settings to Google** resumes it. The master switch
  stops it like every other request.
- **Check my backups** (Settings → Your settings online). Compares every setting on this computer
  with the Chrome profile backup and, when signed in, the Google copy, and names any that differ.
  The Google copy is fetched and compared, never applied. `tests/settings-saved-e2e.test.js` runs the
  real worker and the real Apps Script against in-memory storage and a simulated Gmail account, changes
  every setting one at a time, and reads each copy back.

To turn sign-in on:

1. Google Cloud console → a project → **APIs & Services → OAuth consent screen** (External; scope
   `openid` only needs no verification).
2. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URI:
   `https://<extension-id>.chromiumapp.org/` — the Chrome Web Store id, or the unpacked id shown on
   `chrome://extensions`.
3. Settings → Shared database & backups → Configure Google sign-in shows the redirect address.
   Enter the public client ID there. `identity` is already declared as optional and is requested
   from the sign-in button; no client secret is used. The build constant can supply a default.
4. In Apps Script Project Settings → Script Properties, set `OAUTH_CLIENT_ID` to the same public ID.
   Deploy the updated `apps-script.gs` as a new version of the existing deployment. Account tokens
   from any other client are refused. See [GOOGLE-SIGN-IN-SETUP.md](GOOGLE-SIGN-IN-SETUP.md).

## Checks on the way in

Every row, on both sides, is re-validated: products by `sanitize()` (field bounds, known statuses,
no future timestamps, no pasted lists), settings by `parseBackup()` (unknown ids dropped, weights
clamped to the slider range). A hand-edited cell or a crafted POST cannot widen what the extension
will trust.

## Measuring load

The script takes the lock and reads (and, for product batches, rewrites) the whole tab on every
write. That is fine for a few readers; whether it holds for many is a measurement, not a guess.
Every request logs one line — `{"ic":"request","kind":…,"items":…,"ms":…,"ok":…,"busy":…,"closed":…}` —
with no product, token or payload in it. **Apps Script → Executions** lists them; linking the
project to a Google Cloud project lets Cloud Logging chart them.

During a pilot, watch per day:

| Signal | Where | Act when |
| --- | --- | --- |
| Requests per kind | count of lines by `kind` | Approaching the Apps Script quotas for the owning account (executions and runtime per day) |
| Write latency | `ms` of `products` and `diagnostics` | 95th percentile above ~5 s: writers are queuing on the lock |
| Refused as busy | share of lines with `busy: true` | Above ~1%: the 15 s lock wait is not enough |
| Tab size | rows on `products` and `diagnostics` | Past ~20,000 rows: each write rereads too much |

What to change, cheapest first: prune stale `products` rows (older than 30 days, or at 100 pulls);
write single product rows in place (TextFinder on the key column, one `setValues`) instead of
rewriting the tab; keep a key→row map in CacheService for lookups; and only if those are not
enough, move product rows off Sheets.

## Concurrent Chrome profiles

Sync format 3 assigns a random local device ID to each profile and writes chunks into
that profile's alternating banks before committing the shared pointer. This prevents
two devices from combining chunks into a corrupt backup. Restore validates hashes,
refuses incomplete deliveries and retries a changed pointer. Format 1 and 2 backups
remain readable. Concurrent complete backups use Chrome's final delivered pointer;
settings are never merged or automatically applied. Review the backup before restore.

Chrome sync has a 100 KB total quota. Two maximum-size Unicode profiles fit in isolation;
additional profiles or legacy chunks can exhaust it. A failed write preserves the last
committed copy and shows an error with retry. Export a local JSON backup as an additional
recovery copy. Account-level cross-device delivery still requires testing with signed-in
Chrome profiles; the regression tests simulate reordered delivery and concurrent writers.
