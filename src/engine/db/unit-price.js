// Price per ounce, ported from the Amazon Cost per Ounce Sorter's price.js
// (github.com/jackson29382938/amazon_cost_sorting, the version with the Amazon sort-menu option).
//
// Amazon's own unit price ("$0.81/Ounce", "38.1¢/Ounce", "$4.99/Pound", "$1.25/100 g",
// "$0.25/Fl Oz") wins. Without one, the price per ounce can be worked out from the listed price and a
// package weight in the title, but only when the weight is unambiguous: repeated equivalent weights
// ("39 oz (2.4 lb)") are one size, a count ("100 Count, 7 oz") may be per item and is left alone, and
// a pack multiplier ("Pack of 6") is applied. Conditional coupons and subscription discounts are not
// included: the listed price is used. Prices and sizes are read the way each storefront writes them
// (storefronts.js); internally every unit price is per ounce (or fluid ounce), and displayUnit() turns
// it into per 100 g / 100 ml for metric stores.

if (typeof require !== 'undefined' && typeof module !== 'undefined') { require('./_module.js'); require('./storefronts.js'); }

(function () {
  const OUNCES_PER_POUND = 16;
  const OUNCES_PER_KILOGRAM = 35.27396195;
  const OUNCES_PER_GRAM = OUNCES_PER_KILOGRAM / 1000;
  const FL_OZ_PER_ML = 1 / 29.5735295625;
  // Every unit a title or Amazon's unit price uses, in ounces. `fluid` units are fluid ounces: a
  // liquid's "price per ounce" is per fluid ounce, as Amazon shows it ("$0.11/fluid ounce").
  // Longer spellings first, so "fl oz" wins over "oz" and "ml" over "l".
  const UNITS = [
    [/^(?:fl\.?\s*oz|fluid\s*ounces?|fl\.?\s*ounces?|fz)$/, 1, 'fluid'],
    [/^(?:ounces?|oz)$/, 1, 'weight'],
    [/^(?:pounds?|lbs?)$/, OUNCES_PER_POUND, 'weight'],
    [/^(?:kilograms?|kgs?)$/, OUNCES_PER_KILOGRAM, 'weight'],
    [/^(?:grams?|gramm|g)$/, OUNCES_PER_GRAM, 'weight'],
    [/^(?:ml|milliliters?|millilitres?)$/, FL_OZ_PER_ML, 'fluid'],
    [/^(?:cl)$/, 10 * FL_OZ_PER_ML, 'fluid'],
    [/^(?:l|liters?|litres?)$/, 1000 * FL_OZ_PER_ML, 'fluid'],
    [/^(?:qt|quarts?)$/, 32, 'fluid'],
    [/^(?:pt|pints?)$/, 16, 'fluid'],
    [/^(?:gal|gallons?)$/, 128, 'fluid'],
  ];
  const UNIT = 'fl\\.?\\s*oz|fluid\\s*ounces?|fl\\.?\\s*ounces?|fz|ounces?|oz|pounds?|lbs?|kilograms?|kgs?|gramm|grams?|g'
    + '|milliliters?|millilitres?|ml|cl|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal';
  // "10g Protein", "0g Added Sugar", "5 g of fiber": a nutrient amount, not the package size.
  const NUTRIENT_AFTER = /^\s*(?:of\s+)?(?:added\s+)?(?:protein|fat|carbs?|carbohydrates?|sugars?|fib(?:er|re)|net\s+carbs?|sodium|caffeine|collagen|probiotics?|prebiotics?|electrolytes?|creatine|BCAA|MCT|servings?)\b/i;
  // What to do when Amazon shows no unit price (the Cost Sorter's "missing price" setting).
  const MISSING = ['calculate-clear', 'displayed-only', 'infer-more'];
  const UNIT_DEFAULTS = { unitMissing: 'calculate-clear' };

  function unitInfo(unit) {
    const u = String(unit).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const hit = UNITS.find(([re]) => re.test(u) || re.test(u.replace(/ /g, '')));
    return hit ? { oz: hit[1], kind: hit[2] } : null;
  }

  const SF = () => AIR.db.storefronts;

  // Amazon's displayed unit price: { perOz, kind } or null, read the way `store` writes prices
  // (AIR.db.storefronts). Handles "$0.81/Ounce", "38.1¢/Ounce", "$4.99/Pound", "$1.25/100 g",
  // "$0.25/Fl Oz", "$0.11/fluid ounce", "$0.16/FZ", "$0.30/100 ml", "£1.25/100 g", "9,98 €/kg",
  // "R$ 4,99/kg", "₹49.90/100 g". Commas are never stripped: on a comma-decimal store "4,99" is 4.99.
  function parseDisplayedUnit(text, store) {
    const normalized = String(text || '').replace(/\u00a0/g, ' ');
    const { decimal } = SF().storefront(store);
    const qty = decimal === ',' ? '(\\d+(?:[.,]\\d+)?)' : '(\\d+(?:\\.\\d+)?)';
    const pattern = new RegExp(`(?:${SF().PRICE}|(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s*\u00a2)\\s*(?:\\/|per\\s+)\\s*${qty}?\\s*(${UNIT})(?![a-z])`, 'i');
    const match = normalized.match(pattern);
    if (!match) return null;
    const info = unitInfo(match[5]);
    if (!info) return null;
    const cents = match[3] != null ? SF().parseNumber(match[3], decimal) : null;
    const price = cents != null ? cents / 100 : SF().parseNumber(match[1] || match[2], decimal);
    const amount = match[4] != null ? SF().parseNumber(match[4], decimal) : 1;
    const perOz = price / (amount * info.oz);
    return Number.isFinite(perOz) && perOz > 0 ? { perOz, kind: info.kind } : null;
  }
  const parseDisplayedUnitPrice = (text, store) => (parseDisplayedUnit(text, store) || { perOz: null }).perOz;

  // Package size: { ounces, kind } or null when it is missing or ambiguous.
  // On a comma-decimal store "1,5 kg" is one and a half kilograms; elsewhere a comma only groups
  // thousands ("1,000 g").
  function parseQuantity(text, store) {
    const lower = String(text || '').toLowerCase();
    const source = SF().storefront(store).decimal === ','
      ? lower.replace(/(\d),(\d)/g, '$1.$2')
      : lower.replace(/,/g, '');
    const found = [];
    // One way to read each number, starting only where a number starts: the ported "\d*\.?\d+" could
    // split a run of digits in every possible way from every position, and took minutes on a long one.
    for (const match of source.matchAll(new RegExp(`(?<![\\d.])(\\d+(?:\\.\\d+)?|\\.\\d+)[\\s-]*(${UNIT})\\.?(?![a-z])`, 'g'))) {
      if (NUTRIENT_AFTER.test(source.slice(match.index + match[0].length))) continue;
      const info = unitInfo(match[2]);
      const ounces = Number(match[1]) * (info ? info.oz : 0);
      if (info && Number.isFinite(ounces) && ounces > 0) found.push({ ounces, kind: info.kind });
    }
    const total = source.match(new RegExp(`(\\d+(?:\\.\\d+)?)[\\s-]*(${UNIT})\\s+total\\b`, 'i'));
    if (total) {
      const info = unitInfo(total[2]);
      const ounces = Number(total[1]) * (info ? info.oz : 0);
      const count = source.match(/\bpack\s+of\s+(\d+)\b|\b(\d+)[\s-]*(?:pack|pk|count|ct|bottles?|cans?)\b/i);
      const multiplier = count ? Number(count[1] || count[2]) : 1;
      const item = found.find(f => f.kind === (info && info.kind)
        && Math.abs(f.ounces * multiplier - ounces) / Math.max(f.ounces * multiplier, ounces) <= 0.02);
      if (info && ounces > 0 && item) return { ounces, kind: info.kind };
      if (info && ounces > 0 && !found.length) return { ounces, kind: info.kind };
      if (info && ounces > 0) return null;
    }
    if (!found.length) return null;
    // Weight and volume in one title ("32 fl oz ... 2 lb") cannot be told apart safely.
    const kind = found[0].kind;
    if (found.some(f => f.kind !== kind)) return null;

    // Repeated equivalent sizes such as "39 oz (2.4 lb)" or "32 fl oz (946 ml)" are one package.
    const representative = found[0].ounces;
    if (!found.every(f => Math.abs(f.ounces - representative) / Math.max(f.ounces, representative) <= 0.02)) return null;

    const pack = source.match(/\bpack\s+of\s+(\d+)\b|\b(\d+)[\s-]*(?:pack|pk)\b/);
    const count = source.match(/\b(\d+)[\s-]*(?:count|ct|pieces?|bottles?|cans?|cartons?)\b/);
    let multiplier = pack ? Number(pack[1] || pack[2]) : 1;
    if (count) {
      // A liquid's size is per bottle ("3.1 fl oz, 8 Count" is 24.8 fl oz). A weight next to a
      // count may be the total or per item ("100 Count, 7 oz" tea), so that stays unsorted.
      if (kind !== 'fluid') return null;
      if (!pack) multiplier = Number(count[1]);
    }
    return { ounces: representative * multiplier, kind };
  }
  const parseWeightToOunces = (text, store) => { const q = parseQuantity(text, store); return q ? q.ounces : null; };

  function calculateUnitPrice(price, ounces) {
    if (!(price > 0) || !(ounces > 0)) return null;
    return price / ounces;
  }

  function sanitizeUnit(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return { unitMissing: MISSING.includes(src.unitMissing) ? src.unitMissing : UNIT_DEFAULTS.unitMissing };
  }

  // A search-result card's price per ounce: { unitPrice, unitSource, unitKind }. unitSource is
  // 'amazon', 'calculated' or 'none'; unitKind 'weight' or 'fluid' (per fluid ounce).
  // `store`: the storefront host (AIR.db.storefronts); amazon.com's formats when not given.
  function unitPriceFor({ title = '', text = '', listingPrice = null } = {}, settings, store) {
    const { unitMissing } = sanitizeUnit(settings);
    const none = { unitPrice: null, unitSource: 'none', unitKind: '' };
    const displayed = parseDisplayedUnit(text, store);
    if (displayed) return { unitPrice: displayed.perOz, unitSource: 'amazon', unitKind: displayed.kind };
    if (unitMissing === 'displayed-only') return none;
    const quantity = parseQuantity(unitMissing === 'infer-more' ? `${title} ${text}` : title, store);
    const calculated = quantity ? calculateUnitPrice(listingPrice, quantity.ounces) : null;
    return calculated != null ? { unitPrice: calculated, unitSource: 'calculated', unitKind: quantity.kind } : none;
  }

  // What the list shows for a price per ounce: per ounce / fluid ounce on imperial stores, per 100 g /
  // 100 ml on metric ones. -> { value, per } where per is 'oz', 'floz', '100g' or '100ml'.
  const OUNCES_PER_100G = 100 * OUNCES_PER_GRAM;
  const FL_OZ_PER_100ML = 100 * FL_OZ_PER_ML;
  function displayUnit(perOz, kind, units) {
    if (!(perOz > 0)) return null;
    if (units === 'metric') {
      return kind === 'fluid' ? { value: perOz * FL_OZ_PER_100ML, per: '100ml' } : { value: perOz * OUNCES_PER_100G, per: '100g' };
    }
    return { value: perOz, per: kind === 'fluid' ? 'floz' : 'oz' };
  }

  const api = {
    MISSING, UNIT_DEFAULTS, OUNCES_PER_POUND, OUNCES_PER_KILOGRAM, displayUnit,
    parseDisplayedUnit, parseDisplayedUnitPrice, parseQuantity, parseWeightToOunces, calculateUnitPrice, sanitizeUnit, unitPriceFor,
  };
  const out = AIRmodule('unitPrice', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
