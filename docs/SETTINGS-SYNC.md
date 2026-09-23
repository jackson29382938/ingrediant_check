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
| `products` | Script, first shared read | The product cache. See [CACHE.md](CACHE.md) |
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

After changing the script, **Deploy → Manage deployments → Edit → New version**. That keeps the
same `/exec` URL; a *new deployment* would change it and every installed copy would lose the
database until the next release.

## Settings online

The settings on the computer are always the ones in use. Nothing is ever applied on its own.

- **Chrome account backup** (default on). After every change the settings — weights, allergens,
  diets, the avoid list and the toggles, never the master switch — are written to
  `chrome.storage.sync` (`icBackup`, `icBackupAvoid`; split because an item is capped at 8 KB).
  Chrome syncs that privately to the Google account signed into Chrome. **Restore from my Chrome
  account** brings it back after a confirmation. No setup, and nothing goes to the shared sheet.
- **Sign in with Google** (optional, hidden until configured). For a browser that is not signed
  into Chrome. The options page gets an OAuth access token (scope `openid`) through
  `chrome.identity.launchWebAuthFlow` and hands it to the worker for one request. The script asks
  Google who the token belongs to, refuses a token issued to any other app, and keys the row by a
  SHA-256 of the account id — not the email. The token is never stored.

To turn sign-in on:

1. Google Cloud console → a project → **APIs & Services → OAuth consent screen** (External; scope
   `openid` only needs no verification).
2. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URI:
   `https://<extension-id>.chromiumapp.org/` — the Chrome Web Store id, or the unpacked id shown on
   `chrome://extensions`.
3. Put the client id in `OAUTH_CLIENT_ID` in both `src/engine/db/prefs.js` and `apps-script.gs`,
   and publish a new version of the script.

## Checks on the way in

Every row, on both sides, is re-validated: products by `sanitize()` (field bounds, known statuses,
no future timestamps, no pasted lists), settings by `parseBackup()` (unknown ids dropped, weights
clamped to the slider range). A hand-edited cell or a crafted POST cannot widen what the extension
will trust.
