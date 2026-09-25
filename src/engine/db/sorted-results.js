// Sorting search results by score, and the list that leaves the page (sort.js -> worker -> sorted.html).
//
// Ported from the Amazon Cost per Ounce Sorter, with the Ingredient Check score as the key instead of
// cost per ounce: best score first, listings without a score at the end, ties in Amazon's order.
// Pure functions only, so the content script, the worker and the results page share one definition
// and Node can test it.
//
// sanitizeResults is the gate for data a web page's content script hands the worker: every field is
// typed and bounded, links must be https Amazon store pages, and images must come from Amazon's image
// hosts. The results page renders with textContent only, so this is defence in depth, not the only
// line.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const MAX_RESULTS = 500;
  const COUNT_MIN = 1;
  const COUNT_MAX = 500;
  const AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|ca|com\.au|ie|in|sg|ae|sa|de|fr|es|it|nl|se|pl|com\.be|com\.tr|com\.mx|com\.br|co\.jp)$/i;
  const IMAGE_HOST = /^(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-eu\.ssl-images-amazon\.com|images-fe\.ssl-images-amazon\.com)$/i;
  const SOURCES = new Set(['scored', 'unreadable', 'not-food', 'unrated']);

  const finiteScore = s => (typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= 100 ? s : null);

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

  // "$1,234.56" -> 1234.56. Only the first amount; null when there is none.
  function parseMoney(text) {
    const normalized = String(text || '').replace(/\u00a0/g, ' ');
    const match = normalized.match(/\$\s*([0-9]+(?:,[0-9]{3})*(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  // The sort settings, bounded. `sortMissing`: 'rate-first' rates listings without a score before
  // sorting (only when "Rate every search result" is on); 'end' puts them last with no requests.
  const SORT_DEFAULTS = { sortMissing: 'rate-first', sortLoadMore: false, sortCount: 100 };
  function sanitizeSort(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const count = Math.round(Number(src.sortCount));
    return {
      sortMissing: src.sortMissing === 'end' ? 'end' : 'rate-first',
      sortLoadMore: src.sortLoadMore === true,
      sortCount: Number.isFinite(count) ? Math.min(COUNT_MAX, Math.max(COUNT_MIN, count)) : SORT_DEFAULTS.sortCount,
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

  function sanitizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const asin = /^[A-Z0-9]{10}$/.test(String(raw.asin || '')) ? raw.asin : '';
    const url = safeUrl(raw.url, AMAZON_HOST);
    if (!asin && !url) return null;
    const price = Number(raw.listingPrice);
    const page = Math.round(Number(raw.pageNumber));
    return {
      asin,
      title: str(raw.title, 400) || 'Amazon listing',
      url,
      image: safeUrl(raw.image, IMAGE_HOST),
      listingPrice: Number.isFinite(price) && price > 0 && price < 1e6 ? Math.round(price * 100) / 100 : null,
      score: finiteScore(raw.score),
      verdict: str(raw.verdict, 20),
      source: SOURCES.has(raw.source) ? raw.source : 'unrated',
      rating: str(raw.rating, 80),
      reviews: str(raw.reviews, 40),
      bought: str(raw.bought, 60),
      sponsored: raw.sponsored === true,
      pageNumber: Number.isFinite(page) && page >= 1 && page <= 100 ? page : 1,
      details: str(raw.details, 2600),
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

  const _exports = AIRmodule('sortedResults', {
    MAX_RESULTS, COUNT_MIN, COUNT_MAX, SORT_DEFAULTS,
    sortByScore, parseMoney, sanitizeSort, sanitizeProduct, sanitizeResults, sanitizeSourceUrl,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
