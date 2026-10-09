# Purchase history & trends

Version 1.11.0 adds opt-in Amazon.com order-page import, purchase-only monthly trends and
authenticated account sync. Other Amazon locales and other retailers' orders are not implemented.
Cart and viewed-product ratings never create purchase records.

## First import

Run setup again and select **Include my Amazon purchase history** on the goals step. Finish saves
your goals and warning choices, enables history with automatic account sync, and opens Amazon's
normal Orders page. Sign in to Amazon normally. Identifiable items on opened order pages are imported. **Scan all Amazon orders** in History & sync starts a separate ordinary browser tab that visits the available year filters and Next links. Background mode is on by default; Chrome must remain open. It pauses for sign-in, verification, unreadable pages or storage limits. Pause, Resume, Cancel and Open scan tab remain available. Imported purchases are kept and deduplicated on repeat scans. There is no checkout access. The extension never receives your Amazon password.

The page shows individual scores and a page average beside the order list, including image-only
and multi-item shipment tiles. Unscored items never count as zero. Non-food merchandise is
excluded; previously imported entries recognized as non-food on revisit stop driving trends.
Scores overlay product images by default; History & sync → Order score display can move them beside titles. Hover or keyboard focus opens saved purchase details. Historical point deductions appear only when the locally saved label and scoring setup still reproduce that snapshot. Clicking badges opens public product pages in a new tab. After reading a missing label there, use
**Refresh ratings** to reuse newly saved scores. Amazon challenges stop further public lookups;
refreshing does not bypass them. The summary states its coverage and excluded entries. **History & sync settings** opens the dashboard;
it is also linked from the toolbar and Settings → Backup. Sign in with Google there if needed.
Google sign-in identifies your sync account, not your Amazon account. Automatic sync starts within
about a minute after an import; **Sync now** works with automatic sync off. Failed requests keep
the local copy and retry. The master pause stops network requests. History and its enablement are
excluded from settings imports and backups.

Open additional order pages or change Amazon's year filter to include older purchases. This version
holds 10,000 distinct order/product entries and reads at most 100 lines per page. Capacity errors
are explicit, not silent deletion. Full-history scanning follows available year filters and pagination, with a 2,000-page limit. The initial estimate is 15–60 seconds per page (roughly ten orders); measured page times and discovered order counts update the range. OCR and retailer delays can extend it. Coverage describes what was actually readable, not guaranteed access to every archived order. Current layouts
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

## Visual dashboard and comparisons

The scan progress bar is an estimate: totals can grow as more year filters and pages are discovered.
Scan appearances can overlap across filters; the dashboard shows deduplicated totals. Product entries
are distinct products within an order, not quantities or pack counts. The order-summary table sums
entries within each identified order. Legacy records have unknown order grouping until their order
pages are revisited; they are not assumed to be separate orders.

Recorded scores are the default. **Recalculate with current goals & weights** is a local view using
your saved settings and today's engine, leaving original scores and timestamps unchanged. New
snapshots retain bounded original scoring inputs; older ingredient-only comparisons are approximate,
with no invented nutrition or certifications. Missing labels stay unscored. Settings changes update
an open comparison. No new product lookups are needed for this view.

Search/date/status/rating/score filters affect charts and item tables; sorting and progressive table
loading do not change the records. Only purchases enter statistics. Equal-product weighting is the
default; equal-order weighting excludes ungrouped legacy entries. The timeline keeps recorded
setups separate. Statistical details show sample size, median, sample SD, quartiles and range.
Optional confidence bars use conservative Student-t approximations with order clusters, require at
least two rated identified orders, and for item weighting require every rated entry to be grouped.
These are descriptive purchase intervals, not medical claims, label-accuracy confidence or a random
sample of consumption. Repeated products and household shopping may remain correlated.

Redeploy the updated backend to preserve order grouping and scoring inputs on other devices. An
older server drops fields it does not understand; local merging retains existing metadata, and
legacy entries imported from that server remain visibly ungrouped.

## Private account storage

Separate private backend rows hold product name/identity, a hashed order-group identifier, purchase date/status, score, bounded ingredient text and original scoring input (available nutrition, certifications and label evidence), warning matches, scoring identifier and timestamps. Every read/write verifies
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
October 8, 2026: purchase-history capabilities are enabled. For more than 1,000 records, redeploy the updated backend below; local import and trends already support 10,000.

1. Open the project above while signed in as its owner.
2. Replace the existing server code with [apps-script.gs](apps-script.gs), preserving the existing
   `OAUTH_CLIENT_ID` script property, spreadsheet binding and deployment configuration.
3. Choose **Deploy → Manage deployments → Edit → New version → Deploy** on the existing web app.
   Keep its existing `/exec` URL.
4. Open that `/exec` URL. It must return `"history": true` and `"historySchema": 1`, with `"historyCapacity": 10000` for large histories.
5. In Purchase history, sign in to Google and click **Sync now**. Confirm the timestamp and that
   another device using the same account can retrieve the history.

The extension checks capabilities BEFORE sending any history token/payload. Older deployments
receive only a capability GET; their legacy contribution handler never receives private history.
Older history deployments continue to sync up to 1,000 records. Larger uploads stop with an explicit backend-capacity update message before sending tokens or history. Local imports/trends still work.

## Validation

Node tests cover identity binding, opt-in, deduplication, snapshots, missing-label coverage, account
isolation, older-backend refusal, offline writes, retry-after-lost-acknowledgement, deletion and
stale-device prevention. The unpacked Chrome harness exercises setup, first/older order pages,
returns, the dashboard, automatic/manual sync, offline retention and deletion. OAuth and remote
history requests use controlled fixtures; these are not live account-sync or signed-in order checks.

## Score contributors and navigation

History's Biggest bonuses & deductions ranks net point contributions across filtered purchased
product entries. Positive and negative occurrences offset; score limits count only their additional
deduction, while processing bases and floor adjustments are separate. Quantities are not inferred.
Current-goal analysis uses saved inputs locally; older ingredient-only inputs are approximate.
Original recorded breakdowns are saved with new usable ratings and remain unchanged. Legacy scores
without a saved breakdown remain unavailable in the original-breakdown view. Redeploy the updated
Apps Script code to preserve this optional field across devices.

Purchase import, private account sync and order badge placement live in History. Goals, weights,
warnings, label reading, speed and appearance live in Settings, with contextual links from History.
