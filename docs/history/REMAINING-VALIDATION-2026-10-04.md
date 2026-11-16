# Remaining live validation — October 4, 2026

## Google

The extension supports optional sign-in during setup, registration help with the installed redirect URL, local-first saving, ephemeral tokens and confirmed account-backup receipts. Automated tests cover these paths. Full Google consent and account save/restore have not been verified against the owner’s production client and backend. This session has no authenticated Google Cloud management access.

The owner’s reported OAuth error requires the existing Web client to authorize `https://kimgmdjgfaoccgibnpklgcgillegenpd.chromiumapp.org/` exactly, including the final slash. Setup displays any installation’s actual redirect URL. Confirm the OAuth consent screen permits the intended users, the Apps Script deployment uses the same public client ID, and account storage is configured; then test sign-in, save and explicit restore in the owner’s Chrome.

## Retailers

Target, Walmart and Costco stay previews. Public product requests returned HTTP 200 without bypassing a challenge. Walmart supplied a current-product ingredient declaration; Target and Costco initial responses did not expose usable labels. The Chrome harness checks product panels, toolbar badges and cached search badges using intercepted pages. Complete normal-use live browser validation remains pending.

In Chrome, open each store’s grocery page, expand its ingredient/nutrition section, check the package text against the score, revisit search to confirm the saved badge, and try a missing-label and non-food product. Check SPA navigation changes product identity, pause removes scores, and cart/account/checkout pages receive no content script. Costco Same-Day is unsupported.
