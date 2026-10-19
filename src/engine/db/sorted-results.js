// The sorted list: what leaves the Amazon page (sort.js -> worker -> sorted.html / sidepanel.html),
// and how the list page ranks it.
//
// Ported from the Amazon Cost per Ounce Sorter. The list page ranks by the reader's priorities
// (rank): health score, price per ounce, total price, customer rating and number of reviews, each
// weighted 0-10. A listing missing a value counts as the worst on that factor, and among equal
// matches listings with fewer missing values come first, then Amazon's order. Pure functions only, so
// the content script, the worker and the list page share one definition and Node can test it.
//
// sanitizeResults is the gate for data a web page's content script hands the worker: every field is
// typed and bounded, links must be https Amazon store pages, and images must come from Amazon's image
// hosts. The results page renders with textContent only, so this is defence in depth, not the only
// line.

if (typeof require !== 'undefined' && typeof module !== 'undefined') { require('./_module.js'); require('./storefronts.js'); require('./unit-price.js'); }

(function () {
  const MAX_RESULTS = 500;
  const COUNT_MIN = 1;
  const COUNT_MAX = 500;
  const AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|ca|com\.au|ie|in|sg|ae|sa|de|fr|es|it|nl|se|pl|com\.be|com\.tr|com\.mx|com\.br|co\.jp)$/i;
  const IMAGE_HOST = /^(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-eu\.ssl-images-amazon\.com|images-fe\.ssl-images-amazon\.com)$/i;
  const SOURCES = new Set(['scored', 'unreadable', 'not-food', 'unrated']);
  const UNIT_SOURCES = new Set(['amazon', 'calculated', 'none']);

  const finiteScore = s => (typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= 100 ? s : null);
  // Loaded after this file on some pages, so looked up when used rather than when this file runs.
  const UP = () => AIR.db.unitPrice;
  const FAMILIES = ['weight', 'fluid', 'count'];
  const unitNumber = raw => { const n = raw == null ? NaN : Number(raw); return Number.isFinite(n) && n > 0 && n < 1e5 ? Math.round(n * 10000) / 10000 : null; };
  // The prices a listing can be shown in, per base unit (oz, fl oz or one item), one per family.
  function sanitizeUnitPrices(raw, rawSources) {
    const prices = {}, sources = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    const from = rawSources && typeof rawSources === 'object' ? rawSources : {};
    for (const f of FAMILIES) {
      const n = unitNumber(src[f]);
      if (n == null) continue;
      prices[f] = n;
      sources[f] = from[f] === 'amazon' ? 'amazon' : 'calculated';
    }
    return { prices, sources };
  }
  // 'auto', or one of the units a price can be shown in.
  const sanitizeUnitChoice = raw => (raw === 'auto' || (typeof raw === 'string' && UP().isUnitId(raw)) ? raw : 'auto');
  const sanitizeUnitId = raw => (typeof raw === 'string' && UP().isUnitId(raw) ? raw : '');

  // Best score first. Missing scores keep their relative order at the end; equal scores keep Amazon's.
  function sortByScore(products) {
    return (Array.isArray(products) ? products : []).map((product, index) => ({ product, index }))
      .sort((left, right) => {
        const a = finiteScore(left.product && left.product.score);
        const b = finiteScore(right.product && right.product.score);
        if (a == null && b == null) return left.index - right.index;
        if (a == null) return 1;
        if (b == null) return -1;
        return b - a || left.index - right.index;
      })
      .map(({ product }) => product);
  }

  // The first price in `text`, read the way `store` writes prices (AIR.db.storefronts): "$1,234.56"
  // -> 1234.56 on amazon.com, "1.234,56 €" -> 1234.56 on amazon.de. null when there is none.
  function parseMoney(text, store) {
    return AIR.db.storefronts.parsePrice(text, store);
  }

  // The sort settings, bounded. `sortMissing`: 'rate-first' rates listings without a score before
  // sorting (only when "Rate every search result" is on); 'end' puts them last with no requests.
  // `sortTimeLimit`: seconds to spend building the list before it is shown as it stands (0 = no limit).
  const TIME_LIMITS = [15, 30, 60, 120, 300, 0];
  const SORT_DEFAULTS = { sortMissing: 'rate-first', sortLoadMore: false, sortCount: 100, sortTimeLimit: 60 };
  function sanitizeSort(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const count = Math.round(Number(src.sortCount));
    return {
      sortMissing: src.sortMissing === 'end' ? 'end' : 'rate-first',
      sortLoadMore: src.sortLoadMore === true,
      sortCount: Number.isFinite(count) ? Math.min(COUNT_MAX, Math.max(COUNT_MIN, count)) : SORT_DEFAULTS.sortCount,
      sortTimeLimit: TIME_LIMITS.includes(Number(src.sortTimeLimit)) ? Number(src.sortTimeLimit) : SORT_DEFAULTS.sortTimeLimit,
    };
  }

  // Control characters are stripped on purpose: they have no place in a title or a detail line.
  // eslint-disable-next-line no-control-regex
  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : '');

  function safeUrl(raw, hostTest) {
    try {
      const u = new URL(String(raw || ''));
      if (u.protocol !== 'https:' || u.username || u.password || !hostTest.test(u.hostname)) return '';
      return u.href;
    } catch (e) { return ''; }
  }

  // Why a listing scored what it did (sort.js whyOf): up to 8 rows per section, each a number of
  // points (or 'CAP'), a reason and the ingredient it came from. Shown as text only.
  const WHY_SECTIONS = { caps: 8, plus: 8, minus: 8, neutral: 3 };
  function sanitizeWhy(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    let any = false;
    for (const [section, max] of Object.entries(WHY_SECTIONS)) {
      out[section] = (Array.isArray(raw[section]) ? raw[section] : []).slice(0, max).map(r => {
        if (!r || typeof r !== 'object') return null;
        const c = r.c === 'CAP' ? 'CAP' : Math.round(Number(r.c));
        const why = str(r.why, 140);
        if (!why || (c !== 'CAP' && (!Number.isFinite(c) || Math.abs(c) > 100))) return null;
        return { c, why, ing: str(r.ing, 80) };
      }).filter(Boolean);
      if (out[section].length) any = true;
    }
    return any ? out : { caps: [], plus: [], minus: [], neutral: [], clean: true };
  }

  function sanitizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const asin = /^[A-Z0-9]{10}$/.test(String(raw.asin || '')) ? raw.asin : '';
    const url = safeUrl(raw.url, AMAZON_HOST);
    if (!asin && !url) return null;
    const price = Number(raw.listingPrice);
    const unit = raw.unitPrice == null ? NaN : Number(raw.unitPrice);
    const { prices, sources } = sanitizeUnitPrices(raw.unitPrices, raw.unitSources);
    const servings = raw.servings == null ? NaN : Number(raw.servings);
    const stars = raw.ratingValue == null ? NaN : Number(raw.ratingValue);
    const count = raw.reviewCount == null ? NaN : Math.round(Number(raw.reviewCount));
    const page = Math.round(Number(raw.pageNumber));
    return {
      asin,
      title: str(raw.title, 400) || 'Amazon listing',
      url,
      image: safeUrl(raw.image, IMAGE_HOST),
      listingPrice: Number.isFinite(price) && price > 0 && price < 1e6 ? Math.round(price * 100) / 100 : null,
      unitPrice: Number.isFinite(unit) && unit > 0 && unit < 1e5 ? Math.round(unit * 10000) / 10000 : null,
      unitSource: UNIT_SOURCES.has(raw.unitSource) && Number.isFinite(unit) && unit > 0 && unit < 1e5 ? raw.unitSource : 'none',
      unitKind: Number.isFinite(unit) && unit > 0 && unit < 1e5 && FAMILIES.includes(raw.unitKind) ? raw.unitKind : '',
      unitId: (Number.isFinite(unit) && unit > 0 && unit < 1e5) || Object.keys(prices).length ? sanitizeUnitId(raw.unitId) : '',
      unitPrices: prices,
      unitSources: sources,
      servings: Number.isFinite(servings) && servings >= 1 && servings <= 1000 ? Math.round(servings * 10) / 10 : null,
      score: finiteScore(raw.score),
      verdict: str(raw.verdict, 20),
      source: SOURCES.has(raw.source) ? raw.source : 'unrated',
      rating: str(raw.rating, 80),
      ratingValue: Number.isFinite(stars) && stars >= 0 && stars <= 5 ? stars : null,
      reviews: str(raw.reviews, 40),
      reviewCount: Number.isFinite(count) && count >= 0 && count < 1e9 ? count : null,
      bought: str(raw.bought, 60),
      sponsored: raw.sponsored === true,
      pageNumber: Number.isFinite(page) && page >= 1 && page <= 100 ? page : 1,
      details: str(raw.details, 2600),
      why: typeof finiteScore(raw.score) === 'number' ? sanitizeWhy(raw.why) : null,
    };
  }

  // Untrusted list -> at most MAX_RESULTS clean products, duplicates by ASIN dropped, order kept.
  function sanitizeResults(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list.slice(0, MAX_RESULTS * 2) : []) {
      const p = sanitizeProduct(raw);
      if (!p) continue;
      const key = p.asin || p.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }

  // The Amazon search the list came from, for the "Back to Amazon search" link.
  const sanitizeSourceUrl = raw => safeUrl(raw, AMAZON_HOST);

  // ---------------------------------------------------------------- priorities
  const FACTORS = ['health', 'unitPrice', 'price', 'rating', 'reviews'];
  const WEIGHT_MAX = 10;
  // One-click starting points. `health` and `unitPrice` are also what Amazon's two menu options open.
  const PRESETS = Object.freeze({
    health: Object.freeze({ health: 10, unitPrice: 0, price: 0, rating: 0, reviews: 0 }),
    unitPrice: Object.freeze({ health: 0, unitPrice: 10, price: 0, rating: 0, reviews: 0 }),
    balanced: Object.freeze({ health: 6, unitPrice: 4, price: 0, rating: 2, reviews: 1 }),
    price: Object.freeze({ health: 0, unitPrice: 0, price: 10, rating: 0, reviews: 0 }),
    rating: Object.freeze({ health: 0, unitPrice: 0, price: 0, rating: 7, reviews: 3 }),
  });

  // Weights, each a whole number 0-10. All zero (or nothing usable) falls back to health.
  // `unitEnabled: false` (price per ounce turned off) zeroes that factor.
  function sanitizeWeights(raw, { unitEnabled = true } = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const f of FACTORS) {
      const n = Math.round(Number(src[f]));
      out[f] = Number.isFinite(n) ? Math.min(WEIGHT_MAX, Math.max(0, n)) : 0;
    }
    if (!unitEnabled) out.unitPrice = 0;
    if (!FACTORS.some(f => out[f] > 0)) out.health = WEIGHT_MAX;
    return out;
  }
  // The priorities the reader last set in the sorted list, one set per way of opening it (Amazon's
  // two menu options), so each option reopens as it was tuned. Only known modes, each bounded.
  const PRIORITY_MODES = ['health', 'unitPrice'];
  function sanitizePriorities(raw) {
    const held = raw && typeof raw === 'object' ? raw.sortPriorities : null;
    const src = held && typeof held === 'object' ? held : {};
    const out = {};
    for (const mode of PRIORITY_MODES) if (src[mode] && typeof src[mode] === 'object') out[mode] = sanitizeWeights(src[mode]);
    return { sortPriorities: out };
  }
  const presetFor = mode => ({ ...(PRESETS[mode] || PRESETS.health) });

  // Each listing's value per factor, 0 (worst in this list) to 1 (best), or null when missing.
  // Prices compare on a log scale, so $0.10 vs $0.20 an ounce counts as much as $1 vs $2.
  // `family` ('weight', 'fluid' or 'count') says which of a listing's unit prices the price factor reads;
  // without one it reads the listing's main unit price, as lists saved before units did.
  function factorValues(items, family) {
    const unitOf = p => (family ? UP().priceIn(p, family) : p && p.unitPrice > 0 ? p.unitPrice : null);
    const logs = key => items.map(p => (key === 'unitPrice' ? unitOf(p) : p && p[key] > 0 ? p[key] : null))
      .map(v => (v > 0 ? Math.log(v) : null));
    const lowIsBetter = values => {
      const present = values.filter(v => v != null);
      const lo = Math.min(...present), hi = Math.max(...present);
      return values.map(v => (v == null ? null : hi === lo ? 1 : (hi - v) / (hi - lo)));
    };
    const unit = lowIsBetter(logs('unitPrice'));
    const price = lowIsBetter(logs('listingPrice'));
    const counts = items.map(p => (p && Number.isFinite(p.reviewCount) && p.reviewCount >= 0 ? Math.log10(p.reviewCount + 1) : null));
    const maxCount = Math.max(0, ...counts.filter(v => v != null));
    return items.map((p, i) => ({
      health: finiteScore(p && p.score) == null ? null : p.score / 100,
      unitPrice: unit[i],
      price: price[i],
      rating: p && Number.isFinite(p.ratingValue) ? Math.min(1, Math.max(0, p.ratingValue / 5)) : null,
      reviews: counts[i] == null ? null : maxCount ? counts[i] / maxCount : 1,
    }));
  }

  // -> [{ product, match (0-100), missing: [factor] }] best match first.
  function rank(products, weights, opts) {
    const list = Array.isArray(products) ? products.filter(p => p && typeof p === 'object') : [];
    const w = sanitizeWeights(weights, opts);
    const total = FACTORS.reduce((sum, f) => sum + w[f], 0);
    const values = factorValues(list, opts && opts.family);
    return list.map((product, index) => {
      let sum = 0, missingWeight = 0;
      const missing = [];
      for (const f of FACTORS) {
        if (!w[f]) continue;
        const v = values[index][f];
        if (v == null) { missing.push(f); missingWeight += w[f]; continue; }
        sum += w[f] * v;
      }
      return { product, index, match: Math.round((sum / total) * 100), exact: sum / total, missing, missingWeight };
    }).sort((a, b) => b.exact - a.exact || a.missingWeight - b.missingWeight || a.index - b.index)
      .map(({ product, match, missing }) => ({ product, match, missing }));
  }

  // The list's status line, as plain text.
  const sanitizeStatus = raw => str(raw, 300);

  const _exports = AIRmodule('sortedResults', {
    MAX_RESULTS, COUNT_MIN, COUNT_MAX, TIME_LIMITS, SORT_DEFAULTS, FACTORS, WEIGHT_MAX, PRESETS,
    sortByScore, parseMoney, sanitizeSort, sanitizeProduct, sanitizeResults, sanitizeSourceUrl,
    sanitizeWeights, sanitizePriorities, PRIORITY_MODES, presetFor, factorValues, rank, sanitizeStatus, sanitizeWhy,
    sanitizeUnitPrices, sanitizeUnitChoice, sanitizeUnitId,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
