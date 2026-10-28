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
//
// A listing can be priced in three families of unit, and each one it can supply is kept: per weight (oz),
// per volume (fl oz) and per count (each). Any unit in a family converts to any other (per lb, per kg,
// per 100 g; per gallon, per litre), but weight, volume and count never convert into one another, since
// that needs a density or a pack size nobody printed. `unitPrices` holds the per-base-unit price for each
// family a listing can supply; `likelyUnit` picks the unit most listings in a search already show.

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
    // A count is a unit of price, never a package size: it is read from Amazon's own unit price
    // ("$0.25/Count") and from pack words (parseCount), not by parseQuantity, so it has no title pattern.
    [/^(?:counts?|cts?|each|ea|pieces?|pcs?|units?|items?)$/, 1, 'count'],
  ];
  const UNIT = 'fl\\.?\\s*oz|fluid\\s*ounces?|fl\\.?\\s*ounces?|fz|ounces?|oz|pounds?|lbs?|kilograms?|kgs?|gramm|grams?|g'
    + '|milliliters?|millilitres?|ml|cl|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal';
  // The words Amazon prints after a unit price when the unit is an item: "$0.25/Count", "$1.20/Each".
  const COUNT_UNIT = 'counts?|cts?|each|ea|pieces?|pcs?|units?|items?';
  // "10g Protein", "0g Added Sugar", "5 g of fiber": a nutrient amount, not the package size.
  const NUTRIENT_AFTER = /^\s*(?:of\s+)?(?:added\s+)?(?:protein|fat|carbs?|carbohydrates?|sugars?|fib(?:er|re)|net\s+carbs?|sodium|caffeine|collagen|probiotics?|prebiotics?|electrolytes?|creatine|BCAA|MCT|servings?)\b/i;
  // What to do when Amazon shows no unit price (the Cost Sorter's "missing price" setting).
  const MISSING = ['calculate-clear', 'displayed-only', 'infer-more'];
  const UNIT_DEFAULTS = { unitMissing: 'calculate-clear' };

  // The UK and Ireland measure pints, quarts, gallons and fluid ounces in imperial sizes. A store is given as its
  // host ("www.amazon.co.uk") or its key ("co.uk"); parsing a size and pricing a unit must read both the same way.
  const IMPERIAL_STORE = /^(?:(?:www\.)?amazon\.)?(?:co\.uk|ie)$/i;
  const isImperialStore = store => IMPERIAL_STORE.test(String(store || ''));

  function unitInfo(unit, store) {
    const u = String(unit).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const imperial = isImperialStore(store);
    const hit = UNITS.find(([re]) => re.test(u) || re.test(u.replace(/ /g, '')));
    if (!hit) return null;
    const imperialMl = /^(?:pt|pints?)$/.test(u) ? 568.26125
      : /^(?:qt|quarts?)$/.test(u) ? 1136.5225
      : /^(?:gal|gallons?)$/.test(u) ? 4546.09
      : hit[2] === 'fluid' && hit[1] === 1 ? 28.4130625 : null;
    return { oz: imperial && imperialMl ? imperialMl * FL_OZ_PER_ML : hit[1], kind: hit[2] };
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
    const pattern = new RegExp(`(?:${SF().PRICE}|(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s*\u00a2)\\s*(?:\\/|per\\s+)\\s*${qty}?\\s*(${UNIT}|${COUNT_UNIT})(?![a-z])`, 'i');
    const match = normalized.match(pattern);
    if (!match) return null;
    const info = unitInfo(match[5], store);
    if (!info) return null;
    const cents = match[3] != null ? SF().parseNumber(match[3], decimal) : null;
    const price = cents != null ? cents / 100 : SF().parseNumber(match[1] || match[2], decimal);
    const amount = match[4] != null ? SF().parseNumber(match[4], decimal) : 1;
    const perOz = price / (amount * info.oz);
    // The unit the store itself prices in ("lb" for meat, "gal" for milk), kept so a search can default
    // to whatever most of its listings use. null when the amount is not a unit people sort by.
    const unit = unitIdOf(match[5], amount);
    return Number.isFinite(perOz) && perOz > 0 ? { perOz, kind: info.kind, unit } : null;
  }
  // The price per ounce or fluid ounce only: a price per count is not a price per ounce, so it reads as none here
  // (unitPricesFor carries counts).
  const parseDisplayedUnitPrice = (text, store) => {
    const shown = parseDisplayedUnit(text, store);
    return shown && shown.kind !== 'count' ? shown.perOz : null;
  };

  // ---------------------------------------------------------------- the units a price can be shown in
  // `size` is how many base units (oz, fl oz or one item) the unit holds, so a price per base unit times
  // `size` is the price per this unit. Pints, quarts and gallons differ between the US and the UK/Ireland.
  const FAMILIES = ['weight', 'fluid', 'count'];
  const UNIT_CHOICES = [
    { id: 'oz', family: 'weight', short: 'oz', long: 'ounce', size: 1 },
    { id: 'lb', family: 'weight', short: 'lb', long: 'pound', size: OUNCES_PER_POUND },
    { id: '100g', family: 'weight', short: '100 g', long: '100 g', size: 100 * OUNCES_PER_GRAM },
    { id: 'kg', family: 'weight', short: 'kg', long: 'kilogram', size: OUNCES_PER_KILOGRAM },
    { id: 'g', family: 'weight', short: 'g', long: 'gram', size: OUNCES_PER_GRAM },
    { id: 'floz', family: 'fluid', short: 'fl oz', long: 'fl oz', size: 1 },
    { id: 'pt', family: 'fluid', short: 'pt', long: 'pint', size: 16 },
    { id: 'qt', family: 'fluid', short: 'qt', long: 'quart', size: 32 },
    { id: 'gal', family: 'fluid', short: 'gal', long: 'gallon', size: 128 },
    { id: '100ml', family: 'fluid', short: '100 ml', long: '100 ml', size: 100 * FL_OZ_PER_ML },
    { id: 'l', family: 'fluid', short: 'L', long: 'liter', size: 1000 * FL_OZ_PER_ML },
    { id: 'ml', family: 'fluid', short: 'ml', long: 'ml', size: FL_OZ_PER_ML },
    { id: 'ct', family: 'count', short: 'ct', long: 'count', size: 1 },
  ];
  const UNIT_IDS = UNIT_CHOICES.map(u => u.id);
  const IMPERIAL_ML = { pt: 568.26125, qt: 1136.5225, gal: 4546.09 };
  const choice = id => UNIT_CHOICES.find(u => u.id === id) || null;
  const isUnitId = id => UNIT_IDS.includes(id);
  const familyOf = id => (choice(id) || {}).family || null;
  const sanitizeFamily = family => (FAMILIES.includes(family) ? family : '');

  function unitSize(id, store) {
    const u = choice(id);
    if (!u) return null;
    const imperial = isImperialStore(store);
    return imperial && IMPERIAL_ML[id] ? IMPERIAL_ML[id] * FL_OZ_PER_ML : u.size;
  }
  // A price per base unit -> the price per `id`. null when the unit or the price is not usable.
  function perUnit(perBase, id, store) {
    const size = unitSize(id, store);
    return perBase > 0 && size > 0 ? perBase * size : null;
  }
  // The unit a store's shoppers expect when nothing says otherwise.
  function defaultUnit(family, units) {
    if (family === 'count') return 'ct';
    if (family === 'fluid') return units === 'metric' ? '100ml' : 'floz';
    return units === 'metric' ? '100g' : 'oz';
  }
  // The unit id a displayed unit price names: "$4.99/Pound" -> 'lb', "$1.25/100 g" -> '100g'.
  function unitIdOf(unitText, amount) {
    const u = String(unitText).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    const hit = UNITS.findIndex(([re]) => re.test(u) || re.test(u.replace(/ /g, '')));
    if (hit < 0) return null;
    const kind = UNITS[hit][2];
    const one = amount === 1 || amount == null;
    let id = null;
    if (kind === 'count') id = one ? 'ct' : null;
    else if (/^(?:fl\.?\s*oz|fluid\s*ounces?|fl\.?\s*ounces?|fz)$/.test(u)) id = one ? 'floz' : null;
    else if (/^(?:ounces?|oz)$/.test(u)) id = one ? 'oz' : null;
    else if (/^(?:pounds?|lbs?)$/.test(u)) id = one ? 'lb' : null;
    else if (/^(?:kilograms?|kgs?)$/.test(u)) id = one ? 'kg' : null;
    else if (/^(?:grams?|gramm|g)$/.test(u)) id = amount === 100 ? '100g' : one ? 'g' : null;
    else if (/^(?:ml|milliliters?|millilitres?)$/.test(u)) id = amount === 100 ? '100ml' : one ? 'ml' : null;
    else if (/^(?:l|liters?|litres?)$/.test(u)) id = one ? 'l' : null;
    else if (/^(?:qt|quarts?)$/.test(u)) id = one ? 'qt' : null;
    else if (/^(?:pt|pints?)$/.test(u)) id = one ? 'pt' : null;
    else if (/^(?:gal|gallons?)$/.test(u)) id = one ? 'gal' : null;
    return id && isUnitId(id) ? id : null;
  }

  // How many items a listing holds, when its title or card says so unambiguously: "Pack of 12",
  // "12 Count", "24-pack", "6 bottles". A pack word and an item count together ("Pack of 6, 12 ct each")
  // could be either the total or each, so they only count when they agree or the pack is one.
  const COUNT_WORDS = 'count|ct|pieces?|pcs?|bottles?|cans?|cartons?|bags?|bars?|pouches?|packets?|sachets?|jars?|tubs?|sticks?|capsules?|tablets?|softgels?|gummies';
  function parseCount(text) {
    const source = String(text || '').toLowerCase().replace(/,(?=\d{3}\b)/g, '');
    const packs = [], items = [];
    for (const m of source.matchAll(/\bpack\s+of\s+(\d{1,4})\b/g)) packs.push(Number(m[1]));
    for (const m of source.matchAll(/(?<![\d.])(\d{1,4})[\s-]*(?:pack|pk)\b/g)) packs.push(Number(m[1]));
    for (const m of source.matchAll(new RegExp(`(?<![\\d.])(\\d{1,4})[\\s-]*(?:${COUNT_WORDS})(?![a-z])`, 'g'))) items.push(Number(m[1]));
    const agreed = list => (list.length && list.every(n => n === list[0]) ? list[0] : list.length ? NaN : null);
    const pack = agreed(packs), item = agreed(items);
    let n;
    if (Number.isNaN(pack) || Number.isNaN(item)) n = null;
    else if (pack != null && item != null) n = pack === 1 ? item : pack === item ? pack : null;
    else n = pack != null ? pack : item;
    return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : null;
  }

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
      const info = unitInfo(match[2], store);
      const ounces = Number(match[1]) * (info ? info.oz : 0);
      if (info && Number.isFinite(ounces) && ounces > 0) found.push({ ounces, kind: info.kind });
    }
    const total = source.match(new RegExp(`(\\d+(?:\\.\\d+)?)[\\s-]*(${UNIT})\\s+total\\b`, 'i'));
    if (total) {
      const info = unitInfo(total[2], store);
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
    const shown = parseDisplayedUnit(text, store);
    const displayed = shown && shown.kind !== 'count' ? shown : null;   // weight or volume only; unitPricesFor adds counts
    if (displayed) return { unitPrice: displayed.perOz, unitSource: 'amazon', unitKind: displayed.kind };
    if (unitMissing === 'displayed-only') return none;
    const quantity = parseQuantity(unitMissing === 'infer-more' ? `${title} ${text}` : title, store);
    const calculated = quantity ? calculateUnitPrice(listingPrice, quantity.ounces) : null;
    return calculated != null ? { unitPrice: calculated, unitSource: 'calculated', unitKind: quantity.kind } : none;
  }

  // Every unit price a listing can supply: { unitPrice, unitSource, unitKind, unitId, unitPrices, unitSources }.
  // `unitPrice` / `unitKind` / `unitSource` are the listing's main price, as before (Amazon's own, else a
  // weight or volume worked out from the title). `unitPrices` adds every other family it can be priced in,
  // each per base unit: a "12 ct, 7 oz" box has a price per count even though its weight is ambiguous.
  function unitPricesFor({ title = '', text = '', listingPrice = null } = {}, settings, store) {
    const { unitMissing } = sanitizeUnit(settings);
    const unitPrices = {}, unitSources = {};
    let unitId = '';
    const displayed = parseDisplayedUnit(text, store);
    if (displayed) { unitPrices[displayed.kind] = displayed.perOz; unitSources[displayed.kind] = 'amazon'; unitId = displayed.unit || ''; }
    if (unitMissing !== 'displayed-only') {
      const source = unitMissing === 'infer-more' ? `${title} ${text}` : title;
      const quantity = parseQuantity(source, store);
      const sized = quantity ? calculateUnitPrice(listingPrice, quantity.ounces) : null;
      if (sized != null && unitPrices[quantity.kind] == null) { unitPrices[quantity.kind] = sized; unitSources[quantity.kind] = 'calculated'; }
      const items = parseCount(source);
      const each = items ? calculateUnitPrice(listingPrice, items) : null;
      if (each != null && unitPrices.count == null) { unitPrices.count = each; unitSources.count = 'calculated'; }
    }
    // `unitPrice` / `unitKind` / `unitSource` stay a price per ounce or fluid ounce, as before units: Amazon's
    // when it shows one in those, else what the title gives. A listing priced only per count has none of the three
    // and keeps its price in `unitPrices.count`, so nothing that reads `unitPrice` as an ounce price is misled.
    const kind = displayed && displayed.kind !== 'count' ? displayed.kind : ['weight', 'fluid'].find(f => unitPrices[f] != null) || '';
    return {
      unitPrice: kind ? unitPrices[kind] : null, unitSource: kind ? unitSources[kind] : 'none', unitKind: kind,
      unitId: displayed ? unitId : '', unitPrices, unitSources,
    };
  }

  // The price per base unit of `family` a listing carries, from the newer `unitPrices` or, for a listing
  // saved before them, its single `unitPrice`.
  function priceIn(product, family) {
    if (!product || !family) return null;
    const own = product.unitPrices && product.unitPrices[family];
    if (own > 0) return own;
    return product.unitPrice > 0 && product.unitKind === family ? product.unitPrice : null;
  }
  function sourceIn(product, family) {
    if (!product || priceIn(product, family) == null) return 'none';
    return (product.unitSources && product.unitSources[family]) || product.unitSource || 'none';
  }

  // The unit most of a search's listings already show. Each listing votes for the unit Amazon prices it
  // in ("lb" for meat, "gal" for milk) or, with no Amazon unit price, the store's usual unit for the
  // family it was priced in. A tie goes to the family more listings can be priced in, then to weight,
  // volume, count. -> { unit, family, votes, listings } where `listings` is how many could vote.
  function likelyUnit(products, units) {
    const list = (Array.isArray(products) ? products : []).filter(Boolean);
    const votes = new Map(), reach = { weight: 0, fluid: 0, count: 0 };
    let listings = 0;
    for (const p of list) {
      for (const f of FAMILIES) if (priceIn(p, f) != null) reach[f]++;
      // The unit Amazon itself prices it in, when it shows one; else the family it can be priced in.
      const named = isUnitId(p.unitId) && priceIn(p, familyOf(p.unitId)) != null ? p.unitId : '';
      const family = named ? familyOf(named) : FAMILIES.includes(p.unitKind) && priceIn(p, p.unitKind) != null ? p.unitKind
        : FAMILIES.find(f => priceIn(p, f) != null);
      if (!family) continue;
      listings++;
      const id = named || defaultUnit(family, units);
      votes.set(id, (votes.get(id) || 0) + 1);
    }
    if (!votes.size) return null;
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1]
      || reach[familyOf(b[0])] - reach[familyOf(a[0])]
      || FAMILIES.indexOf(familyOf(a[0])) - FAMILIES.indexOf(familyOf(b[0]))
      || UNIT_IDS.indexOf(a[0]) - UNIT_IDS.indexOf(b[0]))[0];
    return { unit: best[0], family: familyOf(best[0]), votes: best[1], listings };
  }

  // Servings in the package, from the label line Amazon prints ("19.0 servings per container"): the price per
  // serving is shown beside the sortable units, not sorted on, because only a product page carries it.
  function servingsOf(nutrition) {
    const text = nutrition && typeof nutrition === 'object' ? String(nutrition.servingSize || '') : '';
    const m = text.match(/(\d+(?:[.,]\d+)?)\s*servings?\s*(?:per|\/)\s*(?:container|package|pack|bottle|box|bag|jar|can)/i);
    const n = m ? Number(m[1].replace(',', '.')) : NaN;
    return Number.isFinite(n) && n >= 1 && n <= 1000 ? Math.round(n * 10) / 10 : null;
  }

  // What the list shows for a price per ounce: per ounce / fluid ounce on imperial stores, per 100 g /
  // 100 ml on metric ones. -> { value, per } where per is 'oz', 'floz', '100g' or '100ml'.
  const OUNCES_PER_100G = 100 * OUNCES_PER_GRAM;
  const FL_OZ_PER_100ML = 100 * FL_OZ_PER_ML;
  function displayUnit(perOz, kind, units) {
    if (!(perOz > 0)) return null;
    if (kind === 'count') return { value: perOz, per: 'ct' };
    if (units === 'metric') {
      return kind === 'fluid' ? { value: perOz * FL_OZ_PER_100ML, per: '100ml' } : { value: perOz * OUNCES_PER_100G, per: '100g' };
    }
    return { value: perOz, per: kind === 'fluid' ? 'floz' : 'oz' };
  }

  const api = {
    MISSING, UNIT_DEFAULTS, OUNCES_PER_POUND, OUNCES_PER_KILOGRAM, displayUnit,
    parseDisplayedUnit, parseDisplayedUnitPrice, parseQuantity, parseWeightToOunces, calculateUnitPrice, sanitizeUnit, unitPriceFor,
    FAMILIES, UNIT_CHOICES, UNIT_IDS, isUnitId, familyOf, sanitizeFamily, unitSize, perUnit, defaultUnit, unitIdOf, parseCount,
    unitPricesFor, priceIn, sourceIn, likelyUnit, servingsOf,
  };
  const out = AIRmodule('unitPrice', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
