// Price per ounce, ported from the Amazon Cost per Ounce Sorter's price.js
// (github.com/jackson29382938/amazon_cost_sorting, the version with the Amazon sort-menu option).
//
// Amazon's own unit price ("$0.81/Ounce", "38.1¢/Ounce", "$4.99/Pound", "$1.25/100 g",
// "$0.25/Fl Oz") wins. Without one, the price per ounce can be worked out from the listed price and a
// package weight in the title, but only when the weight is unambiguous: repeated equivalent weights
// ("39 oz (2.4 lb)") are one size, a count ("100 Count, 7 oz") may be per item and is left alone, and
// a pack multiplier ("Pack of 6") is applied. Fluid ounces are treated as ounces, as the Cost Sorter
// does. Conditional coupons and subscription discounts are not included: the listed price is used.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const OUNCES_PER_POUND = 16;
  const OUNCES_PER_KILOGRAM = 35.27396195;
  const OUNCES_PER_GRAM = OUNCES_PER_KILOGRAM / 1000;
  const WEIGHT_UNIT = 'pounds?|lbs?|ounces?|oz|kilograms?|kgs?|grams?|g';
  // What to do when Amazon shows no unit price (the Cost Sorter's "missing price" setting).
  const MISSING = ['calculate-clear', 'displayed-only', 'infer-more'];
  const UNIT_DEFAULTS = { unitMissing: 'calculate-clear' };

  function ouncesPerUnit(unit) {
    const normalized = String(unit).toLowerCase().replace(/\./g, '');
    if (/^(?:pounds?|lbs?)$/.test(normalized)) return OUNCES_PER_POUND;
    if (/^(?:ounces?|oz)$/.test(normalized)) return 1;
    if (/^(?:kilograms?|kgs?)$/.test(normalized)) return OUNCES_PER_KILOGRAM;
    return OUNCES_PER_GRAM;
  }

  // Amazon's displayed unit price, per ounce. null when the text has none.
  function parseDisplayedUnitPrice(text) {
    const normalized = String(text || '').replace(/\u00a0/g, ' ').replace(/,/g, '');
    const pattern = new RegExp(`(?:\\$\\s*(\\d+(?:\\.\\d+)?)|(\\d+(?:\\.\\d+)?)\\s*\u00a2)\\s*(?:\\/|per\\s+)\\s*(\\d+(?:\\.\\d+)?)?\\s*(?:fl\\.?\\s*)?(${WEIGHT_UNIT})(?![a-z])`, 'i');
    const match = normalized.match(pattern);
    if (!match) return null;
    const price = match[1] != null ? Number(match[1]) : Number(match[2]) / 100;
    const perOz = price / (Number(match[3] || 1) * ouncesPerUnit(match[4]));
    return Number.isFinite(perOz) && perOz > 0 ? perOz : null;
  }

  // Package weight in ounces, or null when it is missing or ambiguous.
  function parseWeightToOunces(text) {
    const source = String(text || '').toLowerCase().replace(/,/g, '');
    const matches = [...source.matchAll(new RegExp(`(\\d*\\.?\\d+)[\\s-]*(${WEIGHT_UNIT})\\.?\\b`, 'g'))];
    const amounts = matches.map(match => Number(match[1]) * ouncesPerUnit(match[2]))
      .filter(ounces => Number.isFinite(ounces) && ounces > 0);
    if (!amounts.length) return null;

    // Repeated equivalent weights such as "39 oz (2.4 lb)" describe one package size.
    const representative = amounts[0];
    const equivalent = amounts.every(value => Math.abs(value - representative) / Math.max(value, representative) <= 0.02);
    if (!equivalent) return null;

    // "100 Count, 7 oz" may be the total or per item; leave it unsorted rather than guess.
    if (/\b\d+[\s-]*(?:count|ct|pieces?)\b/.test(source)) return null;

    const pack = source.match(/\bpack\s+of\s+(\d+)\b|\b(\d+)[\s-]*(?:pack|pk)\b/);
    return representative * (pack ? Number(pack[1] || pack[2]) : 1);
  }

  function calculateUnitPrice(price, weightOz) {
    if (!(price > 0) || !(weightOz > 0)) return null;
    return price / weightOz;
  }

  function sanitizeUnit(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return { unitMissing: MISSING.includes(src.unitMissing) ? src.unitMissing : UNIT_DEFAULTS.unitMissing };
  }

  // A search-result card's price per ounce: { unitPrice, unitSource } where unitSource is 'amazon',
  // 'calculated' or 'none'. `text` is the card's visible text, `title` its product name.
  function unitPriceFor({ title = '', text = '', listingPrice = null } = {}, settings) {
    const { unitMissing } = sanitizeUnit(settings);
    const displayed = parseDisplayedUnitPrice(text);
    if (displayed != null) return { unitPrice: displayed, unitSource: 'amazon' };
    if (unitMissing === 'displayed-only') return { unitPrice: null, unitSource: 'none' };
    const weightText = unitMissing === 'infer-more' ? `${title} ${text}` : title;
    const calculated = calculateUnitPrice(listingPrice, parseWeightToOunces(weightText));
    return calculated != null ? { unitPrice: calculated, unitSource: 'calculated' } : { unitPrice: null, unitSource: 'none' };
  }

  const api = {
    MISSING, UNIT_DEFAULTS, OUNCES_PER_POUND, OUNCES_PER_KILOGRAM,
    parseDisplayedUnitPrice, parseWeightToOunces, calculateUnitPrice, sanitizeUnit, unitPriceFor,
  };
  const out = AIRmodule('unitPrice', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
