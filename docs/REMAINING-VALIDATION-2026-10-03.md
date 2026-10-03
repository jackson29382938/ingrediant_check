# Remaining validation and deployment work — October 3, 2026

The extension's local workflow is validated: 644 automated tests, Chrome 153 browser/accessibility checks, lint, preflight and packaging. Current cloud runtime inspection shows no authenticated Google outbound identity. User permission is sufficient; account access is the remaining prerequisite for the Google console operations.

## Highest-priority next steps

1. **Complete live Google account backup.** Register the redirect shown by the installed extension, confirm OAuth test-user access where applicable, deploy the prepared Apps Script receiver, and verify save/change/restore with a real account. The public client ID is included in both templates. Tokens remain ephemeral, and no client secret is needed in the extension. See [Google setup](GOOGLE-SIGN-IN-SETUP.md).
2. **Validate actual cross-device profile synchronization.** Use two Chrome profiles signed into the same account. Change distinct preferences on both devices, restore the committed backup, and verify complete avoid entries and goal priorities. Local quota, interruption and concurrent-write simulations already pass; signed-in Google transport remains unverified.
3. **Expand real retailer and language evidence.** Add reviewed live labels for the supported stores, especially Canadian pages, Target search and non-English ingredient/nutrition panels. Existing synthetic multilingual fixtures do not establish live extraction accuracy. See [accuracy evidence](ACCURACY.md).
4. **Publish through the Chrome Web Store.** Use the developer account, a stable extension ID and its registered OAuth redirect. GitHub release publication does not publish to the store. Validate the final store build and privacy disclosures before submitting it.
5. **Keep anonymous product exchange closed until the live receiver is verified closed.** The build gate protects this extension. Production closure/purging has not been performed from this session. Reopening requires a reviewed trust design and authenticated deployment access.

No Google console settings, production spreadsheet rows or Web Store submissions were changed during this review. The prepared backend changes take effect only after owner deployment.
