# Chrome and Firefox

Both desktop browsers share the scoring engine, retailer adapters, local caches, settings,
Google-account backup and purchase-history features. Chrome requires 116 or newer; Firefox
requires 142 or newer. Retailer coverage and label-availability limits apply equally to both.
Firefox for Android is not a supported release target.

`npm run pack` produces both packages with the same version:

- `dist/ingredient-check-VERSION.zip`: Chrome; unpacked files in `dist/unpacked`.
- `dist/ingredient-check-VERSION-firefox.zip`: Firefox; unpacked files in `dist/firefox`.

The Firefox manifest is generated from the canonical manifest. It uses an event background page,
a native sidebar and a hidden extension frame for local photo OCR. Temporary sorting state stays
in session storage. Each browser keeps its own local ratings/history; optional Google backup/history
sync can connect the same account across browsers. Browser-profile sync uses Chrome or Firefox's
own account and does not connect those two browser accounts.

## Installation

Chrome: replace files in the existing install folder, then Reload in `chrome://extensions`. Keeping
the folder preserves the unpacked extension ID, Google redirect and local history.

Firefox development/testing: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, then select `dist/firefox/manifest.json` or the Firefox ZIP. Grant the listed store access
in Firefox's extension permissions if needed. Temporary add-ons are removed on browser restart.

A normal permanent Firefox installation requires Mozilla signing. The GitHub Firefox ZIP is
unsigned source for temporary loading or submission; it is not a signed XPI and is not an AMO listing.
Submit it through [Mozilla's developer hub](https://addons.mozilla.org/developers/) as listed or
unlisted, or run the pinned web-ext signing tool with developer API credentials stored securely.
Firefox's stable add-on ID is `ingredient-check@jackson29382938.github.io`; keep it for future updates.
No signing credentials or signing-service access are present in the cloud environment.

## Google sign-in and optional data sharing

Open setup or Settings → Google backup in each browser. Register the **exact redirect URL displayed
there** in the existing Google OAuth Web client, preserving the existing Chrome redirect(s). Firefox
uses `identity.getRedirectURL()` for its stable add-on ID, not a `chromiumapp.org` URL.
For the released Firefox ID, the verified redirect is
`https://47e92c5d65dc0d985657412cae182ea41c77185f.extensions.allizom.org/`. A client secret
must never be embedded in either extension. Real Google login requires that Cloud Console change;
authentication tests use controlled callbacks and do not sign into a real account.

Firefox declares optional data-sharing categories and asks for consent before enabling uploads or
account/profile backups. Consent alone does not switch on contributions, diagnostics or purchase
imports. Local scoring, caches and local purchase analysis do not require uploading data.

## Development checks

Shared logic: `npm test`, `npm run preflight`, `npm run lint`.
Chrome: install the pinned Playwright tooling and run `npm run harness:ci`.
Firefox: `npm run firefox:setup` downloads pinned Firefox 157.0.1 and geckodriver 0.36.0 to an
external tools directory (`IC_FIREFOX_TOOLS`, default under `/tmp`). Firefox's archive is checked
against Mozilla's official SHA512SUMS. Set `FIREFOX_BINARY` and `GECKODRIVER` from its output,
then run `npm run harness:firefox`. Install web-ext 10.0.0 and run `npm run firefox:lint` after packing.

CI runs both real browsers. Firefox store requests use local HTTPS fixtures with a test certificate;
no retailer or private-account requests leave the test fixture proxy. It grants the production
store permissions in the temporary test profile, checks search/product/cart ratings on Amazon and
15 retailers, extension pages, local OCR worker startup and purchase analytics. Shared Chrome checks
also cover dynamic listings, cart edits, background order scanning and account-sync fixtures.
Mozilla's validator reports pre-existing vendored OCR and guarded Chrome-API warnings; these may
require explanation/source evidence during Mozilla review. Signing/publication approval is separate
from local tests and CI. Every GitHub release automatically attaches both browser ZIPs.
