# Settings sync

Scoring settings can live on the shared Google Sheet as well as on this computer. Reads use the
sheet's CSV export. Writes use the Apps Script web app. The extension does not use Google OAuth.

## Default sheet

New installs, and any profile that has never stored a database URL, use this spreadsheet:

| | |
| --- | --- |
| Title | Ingredient Check — settings & provenance |
| ID | `1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y` |
| URL | https://docs.google.com/spreadsheets/d/1UwIIewq0rsLdIFu57d4W1ifkmv_leQnc76dbDGO6C1Y/edit |

That link is the **Database URL** on the settings page. Clear the field and it stays empty: lookups
and settings loads then stay on this computer. The **Contribution URL** is not filled in. Nothing
in the extension invents an `/exec` address. Paste one only after the deploy below.

## Tabs

| Tab | Created by | Contents |
| --- | --- | --- |
| First sheet (the provenance table) | You, on the first tab | Product rows the extension reads for certifications: `asin`, `upc`, `brand`, `certifications`, `feed`, `origin`, `verified_by`, `notes`. A gid on the database URL pins a different tab. |
| `settings` | Apps Script, on the first settings save | One `payload` row. Columns: `key`, `value`, `ts`. `value` is the scoring export JSON. Later saves replace that row. |
| `diagnostics` | Apps Script, on the first diagnostic batch | One row per scored product. See [DIAGNOSTICS.md](DIAGNOSTICS.md). |
| `reports` | Apps Script, on the first "Looks wrong?" | The same columns as a contribution. |
| `contributions` | Apps Script, on the first shared certification | Product identifiers and certification text. |

Provenance reads use `gviz/tq?tqx=out:csv` on the database URL (first tab, or the gid you pasted).
Settings reads use the same spreadsheet with `&sheet=settings`. They do not share a tab, so a
settings row is never indexed as a product.

## What is saved

The body is the same object as **Export settings**, produced by `exportPayload` and read back
through `parseImport`:

- `_format`, `_version`
- `weights`, `allergens`, `diets`, `avoidList`, `foodOnly`

URLs, the diagnostics queue, score cache, and anything else in `chrome.storage` are not uploaded.
On the way in, unknown ids are dropped and weights are clamped again. A hand-edited cell cannot
widen what the extension will trust.

## Deploy the web app

Do this once, from the spreadsheet above. Skip it and **Save settings to sheet** has nowhere to
write; **Load settings from sheet** can still read a public `settings` tab.

1. Open the spreadsheet. **Share → General access → Anyone with the link → Viewer**, so a read
   does not need a Google sign-in. Writes still go through the script, which runs as you.
2. **Extensions → Apps Script**. Replace `Code.gs` with [`apps-script.gs`](apps-script.gs). Save.
3. **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the URL that ends in `/exec`.
5. Extension settings → **Shared provenance database** → **Contribution URL**. Paste it.
   Chrome will ask for `script.google.com`. Allow it.
6. **Save settings to sheet**, or tick **Keep scoring settings updated on the sheet**.
7. On another browser, paste the same contribution URL (or rely on the public `settings` tab)
   and click **Load settings from sheet**.

Redeploy as a new deployment after you change the script. An old `/exec` URL keeps the previous
code, including one that does not know `kind: "settings"`.

`GET ?kind=settings` on that `/exec` URL returns `{ ok, kind: "settings", payload, ts }`. Any other
GET is only a liveness check. The extension tries the `settings` tab first and uses this GET when
the tab is missing or not public.

## Privacy

Anyone who can open the spreadsheet can read the settings row. Anyone who has the `/exec` URL can
replace it. The web app URL is a write secret. The row is weights and an avoid list, not a browse
history — diagnostics are a separate toggle and a separate tab.
