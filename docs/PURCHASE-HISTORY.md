# Purchase history & trends

Version 1.11.0 adds opt-in Amazon.com order-page import, purchase-only monthly trends and
authenticated account sync. Other Amazon locales and other retailers' orders are not implemented.
Cart and viewed-product ratings never create purchase records.

## First import

Run setup again and select **Include my Amazon purchase history** on the goals step. Finish saves
your goals and warning choices, enables history with automatic account sync, and opens Amazon's
normal Orders page. Sign in to Amazon normally. Only identifiable items on the page you open are
imported. There is no background order-page fetching, automatic pagination, account crawling or
checkout access. The extension never receives your Amazon password.

The page shows individual scores and a page average beside the order list, including image-only
and multi-item shipment tiles. Unscored items never count as zero. Non-food merchandise is
excluded; previously imported entries recognized as non-food on revisit stop driving trends.
Badges open public product pages in a new tab. After reading a missing label there, use
**Refresh ratings** to reuse newly saved scores. Amazon challenges stop further public lookups;
refreshing does not bypass them. The summary states its coverage and excluded entries. **History & sync settings** opens the dashboard;
it is also linked from the toolbar and Settings → Backup. Sign in with Google there if needed.
Google sign-in identifies your sync account, not your Amazon account. Automatic sync starts within
about a minute after an import; **Sync now** works with automatic sync off. Failed requests keep
the local copy and retry. The master pause stops network requests. History and its enablement are
excluded from settings imports and backups.

Open additional order pages or change Amazon's year filter to include older purchases. This version
holds 1,000 distinct order/product entries and reads at most 100 lines per page. Capacity errors
are explicit, not silent deletion. Whole-account import is a future expansion. Current layouts
have controlled fixture coverage; no signed-in live order history was available here. Unrecognized
layouts/identities stay unimported.

## Ratings and trends

Order ratings use the same engine, labels/certifications, goals, weights and warnings as product
and cart ratings. Orders paint cached scores before network requests and automatically pick up ratings saved by
product pages. The same ASIN is fetched once per order page; new product readings stay in the local
cache. Missing text can use barcode/Open Food Facts and label-photo OCR when their existing
controls are enabled. History settings exposes those controls and product-fetch pace (2–5 at a
time). OCR has a separate bounded queue, reads ingredient text locally, and never supplies nutrition
numbers from images. Photo quality and Amazon restrictions can still leave an item unscored.

Public product lookups omit cookies and the order-page referrer, follow the selected bounded pace, and use the existing Speed budget (20–60 per page). Challenges stop new lookups. No private
retailer APIs are used. Valid saved scores and fresh local labels are reused first; cached scores without label text cannot supply warning matches. Each completed item is saved immediately.

Missing labels stay unscored, not zero; coverage is shown. Known non-food products are excluded.
Each distinct product in an order counts once. Quantities, prices and totals are not used for
weighting. Order IDs are hashed with product identity locally to deduplicate revisits, never stored
raw. Visible cancellations, completed returns and unconfirmed statuses are excluded from trends;
an unseen later return cannot be inferred. Once recorded, a cancellation/return is not undone by a later generic delivery status.

The first usable score snapshot is retained with its rating time, extension version and scoring
setup identifier. Today's ingredients may differ from the original package. Monthly averages group
by order month AND scoring setup/version, so changed preferences do not masquerade as shopping
changes. Warnings depend on available ingredient evidence. Purchases may be for a household; they
do not establish consumption or medical health.

## Private account storage

Separate private backend rows hold product name/identity, purchase date/status, score, bounded
ingredient text, warning matches, scoring identifier and timestamps. Every read/write verifies
the Google token's audience and subject; account keys are hashes of that subject. The backend
owner operates and can access the private spreadsheet. This is account-linked storage, not a file
automatically created in the user's Google Drive. Access tokens are never stored or logged by the
application. Addresses, payment details, prices and raw order numbers are not stored or uploaded.

Changing Google accounts never uploads the previous account's records to the new one. Sign back
into the original account to sync/delete its copy. Export downloads local history. Confirmed
**Delete local and account history** disables import, clears the local copy and requests remote
deletion. Offline account deletion remains visibly pending. Server reset epochs prevent stale
devices from restoring deleted records; a device learning of a reset discards its older copy.

## Backend deployment required

Target supplied by the owner: [open the Apps Script project](https://script.google.com/home/projects/1gppT8lt9Gz1_r6RWMStOhb7Sc9Imb1MNjML1xwmqfOozsU8pmk4gyNOs/edit).
The cloud environment has no authenticated Apps Script editing/deployment connection. The project
ID identifies the target but does not authorize the Google API. The live endpoint was checked on
October 7, 2026: accounts work, but purchase-history capabilities are absent.

1. Open the project above while signed in as its owner.
2. Replace the existing server code with [apps-script.gs](apps-script.gs), preserving the existing
   `OAUTH_CLIENT_ID` script property, spreadsheet binding and deployment configuration.
3. Choose **Deploy → Manage deployments → Edit → New version → Deploy** on the existing web app.
   Keep its existing `/exec` URL.
4. Open that `/exec` URL. It must return `"history": true` and `"historySchema": 1`.
5. In Purchase history, sign in to Google and click **Sync now**. Confirm the timestamp and that
   another device using the same account can retrieve the history.

The extension checks capabilities BEFORE sending any history token/payload. Older deployments
receive only a capability GET; their legacy contribution handler never receives private history.
Until deployment, the UI says **backend update required** and local imports/trends still work.

## Validation

Node tests cover identity binding, opt-in, deduplication, snapshots, missing-label coverage, account
isolation, older-backend refusal, offline writes, retry-after-lost-acknowledgement, deletion and
stale-device prevention. The unpacked Chrome harness exercises setup, first/older order pages,
returns, the dashboard, automatic/manual sync, offline retention and deletion. OAuth and remote
history requests use controlled fixtures; these are not live account-sync or signed-in order checks.
