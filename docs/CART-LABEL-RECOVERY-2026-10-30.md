# Amazon cart label recovery — October 30, 2026

Source version: **1.19.1**. Four unavailable products were identified by their public Amazon
listings without account access. Each exact public product page returned HTTP 200 and published
an ingredient field. The bounded verbatim text, source URL, date and response SHA256 are retained
in [amazon-cart-label-evidence.json](../tests/amazon-cart-label-evidence.json). The user's cart,
account data and full retailer HTML are not included.

The change was rebased onto main's concurrent grocery-search fix (`1f53a47`) before publishing.
The combined source retains that fix for hidden quantity-alert headings and searches whose
results arrive after the address changes. Combined unit and browser checks are rerun below.

| Product | Public source | Published label and cause |
| --- | --- | --- |
| Amazon Grocery Cut Watermelon, 32 oz | [B083318PX6](https://www.amazon.com/dp/B083318PX6) | “Watermelon” was not recognized by the whole-food dictionary. |
| Zorrer Premium Jujube Dates, 16 oz jar | [B0GK1PMRFD](https://www.amazon.com/dp/B0GK1PMRFD) | “Jujubes” was missing from the dictionary and too short for the OCR block minimum. |
| Navitas Organics Pomegranate Powder, 8 oz | [B001TNW23U](https://www.amazon.com/dp/B001TNW23U) | “CERTIFIED ORGANIC POMEGRANATE POWDER (PUNICA GRANATUM)” was dropped by a broad certification-only rule; its botanical alias was treated as another ingredient. |
| Amazon Grocery Original Sandwich Cookies, 14.3 oz | [B07X2643L7](https://www.amazon.com/dp/B07X2643L7) | Literal encoded `<br/>` breaks prevented separation of the recipe and “MAY CONTAIN” warning, causing the entire field to be discarded as advisory text. |

The cookie capture retains the published “PLAM” spelling and wheat/soy contains declaration and
peanut cross-contact warning. No recipe or nutrition values are guessed. Unknown ingredient and
OCR-noise checks remain in force. Known botanical pairs collapse only when the sole bracket
child exactly matches the known Latin alias; unrelated children remain part of coverage/scoring.

Cart lookups previously used only calculated scores before fetching a public page. They now
replay fresh public product evidence under current preferences and observe product-cache updates
from other tabs. If public DOM text is unreadable, Amazon carts may use enabled barcode/local
photo fallback. These paths validate the product identity, retain source evidence, respect the
existing worker permissions and master controls, and never publish cart-triggered readings.
Missing product markup no longer stops every remaining lookup as though it were a challenge;
actual challenge/rate-limit detection still stops new public-page requests.

## Verification

- **1,260 unit/integration tests passed** on the combined source: 1,231 parallel and 29 serial,
  with no failures or skips.
- Eight new tests cover the four public labels, encoded line breaks and all three cookie warning
  matches, certified ingredients, botanical aliases, short known OCR foods and negative cases.
- A real Chromium extension scenario scores all four captured labels, replays them with automatic
  rating off without network, heals a failed label from another tab, verifies barcode/photo
  fallback sources and disabled switches, rejects a mismatched ASIN, and checks that public cart
  requests contain neither cookies nor referrers. Barcode/photo responses in this scenario are
  controlled; it does not establish live OCR accuracy.
- The actual full public response HTML for each exact product also passes the food gate,
  extraction and scoring in Chromium's DOMParser: all four have readable labels.
- Compared all **54 product entries** in the existing scoring corpus against 1.19.0: default
  scores and readability unchanged. The seven additional defect records remain covered by the
  complete unit suite.
- The wider browser suite exposed a pre-existing sort fixture with a saved score of 90 beside
  label evidence that scores 98 on both 1.19.0 and 1.19.1. The fixture and its ordering/explanation
  assertions now agree with that evidence; production sorting logic is unchanged.
  Its mock storage also supplies the local warning-preference API introduced in 1.19.0.
- ESLint reports zero warnings; preflight passes with 660 matching English/German locale keys.
- The complete Chromium harness passes with no page errors, including the new four-label cart
  scenario, all retailer previews, cache/recall controls, Orders, history and shopping tools.
- Chrome and Firefox 1.19.1 packages build. Mozilla validation reports zero errors, warnings or
  notices. The real Firefox harness passes for Amazon and all fifteen retailer previews,
  including local OCR startup/recognition/cleanup and cart behavior (controlled fixtures).
- Website checks pass for all seven routes in both themes at 390 and 1280 pixels, including
  privacy copy, navigation and production security headers.

Public page captures establish the availability of those four labels on the capture date.
Controlled browser replay establishes extraction and cart behavior. Neither establishes access
from the user's current Amazon session or independent health-score accuracy. Chrome Web Store
publication and Mozilla signing remain separate publisher actions.
