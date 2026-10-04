# Chrome Web Store listing checklist

Code package: `npm run pack` → `dist/ingredient-check-<version>.zip` (preflight first). Do **not** bump `manifest.json` version until you are ready to submit.

Privacy copy to paste / host: [../PRIVACY.md](../PRIVACY.md). Store description source: `_locales/en/messages.json` → `appDescription` (132-character cap). Full name: **Ingredient Check**.

This folder holds the *checklist*, not screenshots. Capture shots from your own Chrome (or the local harness) when you submit. Do not invent promo images.

## Language honesty (do not over-claim)

Host permissions cover many Amazon storefronts. Scoring quality does **not**.

| Stores | Expectation |
|---|---|
| **US / UK / CA / AU** (English labels) | Best fit — full rulebase + OCR when needed |
| **DE / FR / ES / IT / PT / NL** | Ingredient headings extract; a synonym pack maps common additives, oils and flavours onto the English rules, plus E-numbers. **Tested only on synthetic translations**, not on real labels ([ACCURACY.md](../ACCURACY.md)) |
| **SE / PL / TR** | Headings extract; no synonym pack, so most lists are declined as unreadable. A list the gate lets through is scored on its E-numbers |
| **JP / AE / SA** | Declined. Photo OCR is off (English Tesseract misreads those scripts); paste still works |

**Sort by score / price per ounce** is on for amazon.com, .co.uk, .ie, .ca, .com.au, .sg and .in only,
and is a preview until the VERIFY.md §7 steps pass on live Amazon ([STORES.md](../STORES.md)). Do not
list it as a feature of every store. **Sharing product readings with other computers** is off by
default and experimental ([CACHE.md](../CACHE.md), *Trust*); describe the shared database as the
certification tables unless that changes.

Do **not** claim “works equally on all Amazon grocery stores”, and do not claim a language works on
the strength of the synonym tests. Prefer: *Best on English US/UK/CA/AU labels. Some support for
German, French, Spanish, Italian, Portuguese and Dutch labels. Other stores may decline to score.*

## Assets Chrome asks for

| Asset | Size | Notes |
|---|---|---|
| Store icon | 128×128 | Already in `icons/icon128.png`. |
| Screenshots | **1280×800** or **640×400** | At least 1, up to 5. PNG or JPEG. |
| Small promo tile | 440×280 | Optional. |
| Marquee promo | 1400×560 | Optional. |

Suggested screenshot set (capture live, or from `npm run harness` + popup):

1. Product panel on a grocery PDP (score + rows).
2. Honest failure + paste box (Lifeway-style unreadable list).
3. Toolbar popup (master switch, presets, compare).
4. Settings weights / presets.
5. Search badges on a grocery `/s` page.

Surfaces added in 1.1.0, worth a shot each if the five above leave room (or for the promo tiles):

- The ranked list in Chrome's side panel, opened from an Ingredient Check option in Amazon's *Sort by*
  menu (on a store where sorting is shown).
- The goals step of the setup page (`welcome.html`), which opens on install.
- The "why" breakdown card that opens from a search badge (hover, focus or click).
- A Target product page, marked as a preview in the popup and in [`docs/STORES.md`](../STORES.md).
- **Report a problem or suggest an improvement**, with its screenshot preview.

## Listing fields

- **Name:** Ingredient Check  
- **Summary:** `appDescription` (keep ≤132 characters in every locale).  
- **Category:** Shopping (or Productivity).  
- **Language:** English (primary). Mention EU synonym support in the long description, not as universal coverage.  
- **Privacy:** host [PRIVACY.md](../PRIVACY.md) (GitHub blob/raw or Pages) and paste that URL in the CWS privacy field.  
- **Single purpose:** local ingredient scoring on Amazon grocery pages.  
- **Permissions justification:** `storage` (weights + cache), `unlimitedStorage` (the cache keeps up to 10,000 saved scores and product readings — ingredient text up to 6,000 characters each — which does not fit Chrome's default 10 MB; the housekeeping sweep keeps it to that cap and to the *Speed* setting's age), `alarms` (housekeeping), `offscreen` (on-device OCR), `sidePanel` (choosing an Ingredient Check option in Amazon's sort menu opens the ranked list beside the Amazon page), `activeTab` (the screenshot in **Report a problem or suggest an improvement**, taken only when the user clicks that link in the toolbar popup while on an Amazon or retailer preview page, and shown to them before anything can be attached to an email), Amazon host permissions (read product and search pages; **Rate every search result**, on by default, and **Score on hover** request product pages with the user’s Amazon session — disclosed in the popup, in settings, and once on the first results page it rates, with a button to turn it off). Optional host: Open Food Facts (barcode only), requested when the user finishes setup with barcode fallback checked or enables it later. The Apps Script endpoint needs no host permission (its replies allow any origin). `identity` is an optional permission, requested only when the user starts Google sign-in during setup or a Google save/restore operation.

## Do not claim until VERIFY is green

Open Food Facts, live OCR after WAR removal, and Apps Script diagnostics are **owner-only** ([../VERIFY.md](../VERIFY.md)). Do not advertise them as proven in the store listing until you have run that checklist.

## Submit

1. `npm test && npm run preflight && npm run pack`
2. Drop the zip on the CWS developer dashboard.
3. Attach screenshots + privacy URL.
4. Then bump `manifest.json` version for the next upload.

Target, Walmart and Costco are previews. They read only pages the user opens and never request retailer pages in the background; content scripts are scoped to product and search routes, with no retailer host permissions.
