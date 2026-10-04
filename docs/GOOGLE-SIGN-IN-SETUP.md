# Google account and Chrome profile setup

The extension has two independent backup routes. Chrome profile backup uses `chrome.storage.sync`; Chrome manages profile sign-in and cross-device sync. Google save/restore uses an OAuth token for one request to the Ingredient Check database. Signing in through one route does not sign in through the other.

## Chrome profile

In extension settings, click **Open Chrome profile settings**, sign in to Chrome with your chosen account, and enable Chrome sync if you want backups on other computers. Keep **Back up my settings to my Chrome account** enabled. The extension can open these settings, but cannot sign Chrome in or enable browser sync on your behalf.

Local Chrome storage and restoring a complete backup have been validated in Chrome for Testing. Actual cross-device synchronization requires two signed-in Chrome profiles and has not been verified in this cloud environment.

## Configured public client

The extension default is `483888107675-hofgo4a3uh1g2khv4hja9ci8nhama6tk.apps.googleusercontent.com`. The supplied OAuth export identifies a Web application but contains no authorized redirect URIs. Register the exact redirect shown in extension settings before testing sign-in. The client secret is not used or stored by this extension. Configure the same public client ID as the Apps Script `OAUTH_CLIENT_ID` property and deploy the updated backend; the local client setting alone does not enable account backup.

## Google account backup

Live checks on October 1, 2026 found that the deployed endpoint answers its health check, but an account read without a token returns `accounts are not configured`. The account code below must be configured and deployed before a real account save/restore can succeed. A Gmail address alone is not an OAuth client ID; no password or client secret should be added to extension code or supplied in chat.

1. Sign in to the [Google Cloud credentials console](https://console.cloud.google.com/apis/credentials) with the account that owns the project. Choose or create a project and configure Google Auth Platform branding, audience, and access for your users. If the OAuth app is in testing, add the account you will use as a test user.
2. Create an OAuth **Web application** client. The extension requests only `openid`. In extension settings, expand **Configure Google sign-in** and copy the displayed redirect address into the client's authorized redirect URIs.
3. For this cloud checkout, the observed address is `https://makjklodcnakffeaghipcgenpcipfcpn.chromiumapp.org/`. Other unpacked installations can have different IDs; a Web Store build uses its own stable ID. Register the actual address shown by the installation being tested. Do not change the extension ID to make an existing redirect fit, as that creates a different extension with different local storage.
4. Copy the public client ID into the extension's **Google OAuth client ID** field and click **Save sign-in configuration**. This value is kept locally and excluded from settings backups. A build-wide default can instead be set in `src/engine/db/prefs.js`.
5. In the spreadsheet's Apps Script project, install the updated [apps-script.gs](apps-script.gs). Under **Project Settings → Script Properties**, set `OAUTH_CLIENT_ID` to the same public ID. The supplied template already includes this public client ID as its fallback. A Script Property can override it for another client. Deploying the updated script is still required.
6. **Deploy → Manage deployments → Edit → New version** of the existing web app. Execute as the spreadsheet owner, with access suitable for the extension's public endpoint. Keep the spreadsheet restricted. Preserve the current `/exec` URL. Leave `PRODUCTS_OPEN` unset unless you intentionally accept the separate anonymous product-writing risk.
7. Click **Sign in with Google and save** in the extension. Grant the optional identity permission when Chrome asks, choose your account, and confirm the saved result. Then change a test preference, click **Sign in with Google and restore**, and verify that the saved preference and goals return after reload. Choose the same account for both operations.

Each operation selects an account explicitly. The access token stays in memory, is validated against the backend owner's client ID, and is never written into local storage, sync storage, reports, or the spreadsheet. The stored account identifier is a hash of Google's verified account ID; the extension does not pin all users to the developer's email.

## Storage and data collection

Settings backups contain scoring choices, goals and their importance, warnings, avoid terms, switches, sort preferences, freshness, and display preferences. They omit the master pause switch, OAuth configuration, tokens, caches, screenshots, and diagnostics queues.

The byte-sized sync format reads legacy backups. New writes stage an alternate set of avoid-list chunks and commit the main pointer last. Failed writes retain the prior backup, show a status, and retry through a Chrome alarm. Checksums reject parts arriving out of order; an incomplete backup must finish syncing before restore. Chrome sync conflict behavior across simultaneously editing devices still needs real multi-device validation.

Product readings and diagnostics are independent opt-ins. Their existing queued-write tests verify offline retention, confirmed receipts, duplicate handling, and pause behavior. These tests use controlled receivers. The live shared backend was not populated with synthetic products or diagnostic rows during this task; live Google account writes also remain unverified until the console setup above is completed.

## Redirect error reported October 4, 2026

For the installed extension reported by the owner, add this exact **authorized redirect URI** to the existing **Web application** OAuth client in Google Cloud Credentials:

`https://kimgmdjgfaoccgibnpklgcgillegenpd.chromiumapp.org/`

Keep the trailing slash. This is an authorized redirect URI, not a JavaScript origin. Use the public client ID configured in the extension. Other unpacked installations may have a different extension ID: setup displays the actual `chrome.identity.getRedirectURL()` and can copy it. Register each installation’s actual URI or use a stable published extension ID. A Google account email or a client secret does not register redirects.

Onboarding now offers optional Google sign-in. It stores choices locally first, then attempts account backup with an ephemeral token; a failed login or backend request leaves the choices local. No token or client secret is stored. Google Cloud registration and the account-backup backend deployment remain owner-console tasks until an authenticated management connection is available.
