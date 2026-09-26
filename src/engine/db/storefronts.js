// Amazon storefronts: what a price and a package size look like on each, and where the sorted list is
// switched on.
//
// Price parsing used to assume dollars with a dot for decimals everywhere: "€4,99" and "£4.99" were
// missed, "R$ 4,99" became 4, and a unit price "R$ 4,99/kg" became 499 per kilogram. Each store now
// says which character is its decimal mark, what currency and locale the list page shows prices in,
// and whether its shoppers buy by the ounce (imperial) or by the 100 g / 100 ml (metric).
//
// `sort` is where Amazon's sort menu gets the Ingredient Check options. Only stores whose menus and
// listings match the tests (tests/sort.test.js, English menus, prices in the formats below) are on.
// The others parse correctly in the tests but stay off until someone checks them on the live store
// (docs/VERIFY.md, docs/STORES.md): their menus are not in English, and nobody has looked at how their
// listings render ratings and review counts.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const S = (currency, locale, decimal, units, sort) => Object.freeze({ currency, locale, decimal, units, sort });
  // Host without "www." and without the "amazon." prefix -> storefront.
  const STORES = Object.freeze({
    'com': S('USD', 'en-US', '.', 'imperial', true),
    'ca': S('CAD', 'en-CA', '.', 'metric', true),
    'com.au': S('AUD', 'en-AU', '.', 'metric', true),
    'sg': S('SGD', 'en-SG', '.', 'metric', true),
    'co.uk': S('GBP', 'en-GB', '.', 'metric', true),
    'ie': S('EUR', 'en-IE', '.', 'metric', true),
    'in': S('INR', 'en-IN', '.', 'metric', true),
    'ae': S('AED', 'en-AE', '.', 'metric', false),
    'sa': S('SAR', 'en-SA', '.', 'metric', false),
    'co.jp': S('JPY', 'ja-JP', '.', 'metric', false),
    'com.mx': S('MXN', 'es-MX', '.', 'metric', false),
    'de': S('EUR', 'de-DE', ',', 'metric', false),
    'fr': S('EUR', 'fr-FR', ',', 'metric', false),
    'es': S('EUR', 'es-ES', ',', 'metric', false),
    'it': S('EUR', 'it-IT', ',', 'metric', false),
    'nl': S('EUR', 'nl-NL', ',', 'metric', false),
    'com.be': S('EUR', 'fr-BE', ',', 'metric', false),
    'se': S('SEK', 'sv-SE', ',', 'metric', false),
    'pl': S('PLN', 'pl-PL', ',', 'metric', false),
    'com.tr': S('TRY', 'tr-TR', ',', 'metric', false),
    'com.br': S('BRL', 'pt-BR', ',', 'metric', false),
  });
  // Anything else (a test page, an unknown host) reads prices the way amazon.com writes them.
  const DEFAULT = 'com';

  // "www.amazon.co.uk", "https://www.amazon.de/s?k=hafer", "amazon.com" -> the table key.
  // The local test harness (npm run harness) stands in for amazon.com. Chrome never runs the content
  // scripts there: the manifest matches Amazon hosts only.
  const HARNESS = /^(?:127\.0\.0\.1|localhost)$/;
  function keyOf(hostOrUrl) {
    let host = String(hostOrUrl || '').trim().toLowerCase();
    if (/^[a-z]+:\/\//.test(host)) { try { host = new URL(host).hostname; } catch (e) { host = ''; } }
    host = host.replace(/:\d+$/, '');
    if (HARNESS.test(host)) return DEFAULT;
    const m = host.match(/(?:^|\.)amazon\.([a-z.]+)$/);
    return m && Object.hasOwn(STORES, m[1]) ? m[1] : '';
  }
  // -> { key, currency, locale, decimal, units, sort, known }
  function storefront(hostOrUrl) {
    const key = keyOf(hostOrUrl);
    return { key: key || DEFAULT, ...STORES[key || DEFAULT], known: !!key };
  }
  const sortEnabled = hostOrUrl => { const s = storefront(hostOrUrl); return s.known && s.sort; };

  // A number as this store writes it -> Number. "1,234.56" (dot decimal), "1.234,56" / "4,99" (comma
  // decimal), "1 234,56" with a (narrow) no-break space, "1,23,456.00" (India). null when none.
  // Thousands groups are only taken where they look like groups, so "$4.99 5 pack" is 4.99.
  const DOT_NUMBER = /\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/;
  const COMMA_NUMBER = /\d{1,3}(?:[.'\u00a0\u202f ]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/;
  function parseNumber(text, decimal = '.') {
    const m = String(text || '').match(decimal === ',' ? COMMA_NUMBER : DOT_NUMBER);
    if (!m) return null;
    const n = decimal === ','
      ? Number(m[0].replace(/[.'\u00a0\u202f ]/g, '').replace(',', '.'))
      : Number(m[0].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // Every currency mark the storefronts use, longest first so "R$" wins over "$".
  const CURRENCY_MARKS = ['CDN$', 'CA$', 'A$', 'AU$', 'S$', 'SG$', 'R$', 'MX$', 'US$', 'AED', 'SAR', 'SEK',
    'PLN', 'TRY', 'EUR', 'GBP', 'INR', 'JPY', 'Rs.', 'zł', 'kr', 'TL', '$', '£', '€', '₹', '¥', '￥', '₺', 'ر.س', 'د.إ'];
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const MARK = CURRENCY_MARKS.map(escape).join('|');
  // A price with its mark before or after the number: "$4.99", "£4.99", "4,99 €", "R$ 4,99", "₹1,299".
  const PRICE = `(?:(?:${MARK})\\s*(\\d[\\d.,\\u00a0\\u202f ]*\\d|\\d)|(\\d[\\d.,\\u00a0\\u202f ]*\\d|\\d)\\s*(?:${MARK}))`;

  // The first price in `text` as this store writes it, or null.
  function parsePrice(text, hostOrUrl) {
    const { decimal } = storefront(hostOrUrl);
    const m = String(text || '').replace(/\u00a0/g, ' ').match(new RegExp(PRICE));
    if (!m) return null;
    return parseNumber(m[1] || m[2], decimal);
  }

  const api = { STORES, DEFAULT, CURRENCY_MARKS, PRICE, keyOf, storefront, sortEnabled, parseNumber, parsePrice };
  const out = AIRmodule('storefronts', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
