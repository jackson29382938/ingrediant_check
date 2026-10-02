# Release validation — October 1, 2026

Local implementation and validation for the five release recommendations. No store release,
Google Cloud configuration, Apps Script deployment or production data deletion was performed.
The extension's live Google account feature remains unconfigured; permission and an email
address alone do not provide an authenticated Google console session or an OAuth client.
See [Google setup](GOOGLE-SIGN-IN-SETUP.md).

| Recommendation | Completed evidence | Remaining verification |
|---|---|---|
| Live storefronts | Amazon US kefir, fine tunUK granola and Target oats returned HTTP 200 and scored. Target scored after its label hydrated and was opened. Target search loaded. | US/CA search returned 503; CA product returned 500; UK search returned an error document with HTTP 202. Live variant changes and full search scoring are unverified. Controlled lifecycle/navigation tests pass. |
| Real label corpus | Three verbatim English labels now include public source URLs, capture dates, extractor provenance and regression bands. | Non-English evidence remains synthetic; no claim of real-label or clinical validation across those languages. |
| Backup reliability | Fixed concurrent chunk-bank collisions with per-profile namespaces. Two isolated real Chrome profiles passed concurrent-write/reordered-delivery simulations and storage quota checks. Maximum Unicode backups occupied about 78 KB with both profiles' alternating banks. Failed writes preserve the last committed copy; incomplete deliveries cannot restore. | Google-account transport between signed-in devices, conflicts over time and a third maximum-size profile need account-level testing. Chrome's 100 KB total quota still applies. |
| Shared uploads | Build gate rejects anonymous product reads/uploads even with saved opt-in; settings control stays disabled. Added owner-only close/purge functions and tested selective deletion under a lock. | Production lookup did not report `closed: true`. The owner must update/verify deployment and run closure/purge in Apps Script. No authenticated-writer trust system has been deployed. |
| Compatibility/accessibility | Chrome 153 extension harness passes on all six pages: named controls in the browser accessibility tree, contrast in light/dark themes, keyboard goal tabs, 400×600 layout and CSS 200% zoom layout at 1280×800. Chrome 116 page-level harness checks passed with standard cloud fonts. | Cloud managed policy blocked the unpacked extension in Chrome 116, so full minimum-version compatibility is unverified. CSS zoom approximates layout zoom; actual browser zoom and listening with NVDA/VoiceOver still need manual checks. |

The [public live evidence](live-storefront-checks-2026-10-01.json) contains product labels and
HTTP outcomes, without cookies, account sessions or OAuth tokens. The labels prove what the
extractor read from those pages; regression score bands guard engine behavior, not medical accuracy.

## Final automated checks

- Node 20.20.2, 22.23.3 and 24.19.0: all 371 tests pass, with no skipped tests.
- ESLint: zero warnings/errors. Preflight and packaging pass.
- Chrome 153.0.8010.12: full browser harness and two-profile storage simulation pass.
- Chrome 116.0.5845.96: page tests pass; extension worker blocked by managed extension policy.

Reproduce browser checks with the installed Chromium:

```sh
HARNESS_CHROME=/path/to/chrome npm run harness:ci
HARNESS_CHROME=/path/to/chrome node scripts/sync-profile-ci.mjs
```

The two-profile script uses signed-out disposable profiles and manually delivers sync items.
It checks real Chrome storage limits and coherent restoration, without claiming Google transport.
The regular harness also checks real Chrome restoration/reload of Unicode avoid lists, goals,
sort and speed preferences. Account isolation, OAuth audience/state handling, offline failure,
partial delivery and stale responses are covered by controlled tests.

For Chrome 116 in this cloud, the default `system-ui` font rendered zero-height spans. A local
Fontconfig override selecting DejaVu Sans resolved that page-rendering issue. Managed Chromium
policy (`ExtensionInstallBlocklist: ["*"]`) then prevented loading the unpacked extension.
Neither enterprise policy nor the declared minimum version was changed to conceal that limit.

## Owner steps before release

1. Follow the Google setup guide using an authenticated owner console session, then verify a
   real sign-in/save/restore with separate accounts and signed-in Chrome profiles.
2. Deploy the reviewed Apps Script source, run `closeSharedProducts()` and the selective
   historical purge from the editor, and confirm the public lookup returns `closed: true`.
3. Recheck blocked storefronts, live variants, minimum Chrome extension loading and real
   non-English labels in an environment with access. Perform actual browser-zoom and
   screen-reader listening checks. Keep unsupported-language gates in place.
