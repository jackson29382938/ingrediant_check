# Mozilla reviewer notes — 1.15.2

Ingredient Check scores food ingredient labels locally and displays ratings on retailer search,
product, cart and order pages. Core scoring and settings require no extension account. Google
sign-in, profile backup and purchase-history sync are optional and require the user's own account
and explicit data-sharing consent. Retailer order-history features require the user's retailer login;
public search/product pages can be tested without an account. No shared test credentials are
included. To validate private-page handling without real accounts, use the repository's fixtures.

The source for this release is https://github.com/jackson29382938/ingrediant_check/tree/v1.15.2.
The extension includes only local executable code. Tesseract's JavaScript, WASM core and English
language data are vendored; product label images are processed on the user's machine.

## Changes addressing the 1.15.0 validation report

- Firefox ships a native sidebar/OCR-host implementation in src/browser-platform.js. Chrome's
  implementation is excluded from the Firefox package; shared code calls this interface.
- Score panels use DOMPurify with the HTML profile and return a sanitized DOM fragment.
  Script elements, event handlers and executable URLs are removed before mounting the fragment.
  Existing escaping of product text remains in place.
- Tesseract.js 5.1.1's two obsolete regenerator Function fallbacks and webpack's Function-based
  global lookup are replaced with direct globalThis access, available in all supported browsers.
- Two wasm-feature-detect comma-expression calls are expressed through lexical arrow wrappers
  to avoid the analyzer's "Unexpected callable" bug. Their feature probes and order are unchanged.
- DOMPurify 3.4.16's legacy innerHTML parsing fallback is removed. The supported HTML DOMParser
  path and all sanitization rules remain intact; a failed parse returns null and the panel refuses
  to mount it. Non-HTML namespace parsing through the legacy fallback is intentionally unsupported.
- The Node-only scoring loader uses module.require. Browser scoring and cache revisions are
  unchanged. Licenses are included beside all vendored libraries.

## Reproduce vendor files

Use Node 20+ and an external tools directory. Both build scripts verify the upstream SHA256 hash
and refuse to patch unexpected source. The OCR script also checks exact build-tool versions.

```sh
npm install --prefix /tmp/ic-vendor-tools --no-package-lock --ignore-scripts \
  tesseract.js@5.1.1 terser@5.44.0 acorn@8.19.0 dompurify@3.4.16
node scripts/build-ocr-vendor.mjs /tmp/ic-vendor-tools/node_modules
node scripts/build-panel-sanitizer.mjs /tmp/ic-vendor-tools/node_modules
git diff --exit-code -- vendor
```

The WASM glue and eng.traineddata.gz are unchanged from 1.15.0. Their upstream versions and
required file choices are documented in vendor/tesseract/VERSION.txt. DOMPurify's upstream source
hash and adaptation are recorded in scripts/build-panel-sanitizer.mjs.

## Reproduce packages and checks

```sh
npm test
npm run preflight
npm run pack
npm install --no-save --no-package-lock web-ext@10.0.0
npm run firefox:lint
npm run firefox:setup
# Set FIREFOX_BINARY and GECKODRIVER to the paths printed by firefox:setup.
npm run harness:firefox
```

The Firefox harness temporarily installs the real extension and exercises actual local OCR
recognition, storage, sidebar access, settings, purchase analytics and all 16 store fixtures. Retailer
traffic is routed only to local HTTPS test fixtures, never live private accounts. The Chrome harness
also verifies removal of executable panel input and failure when the HTML parser is unavailable.
See docs/BROWSERS.md for Chrome harness setup and Google redirect configuration.
