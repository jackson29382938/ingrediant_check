// Public navigation metadata only; no raw order content or account identifiers.
(function (root) {
  const MAX_PAGES = 2000;
  function url(raw) {
    try {
      const u = new URL(raw);
      if (
        u.protocol !== 'https:' ||
        !/^(?:www\.)?amazon\.com$/.test(u.hostname) ||
        u.username ||
        u.password ||
        !/^\/(?:your-orders\/orders|gp\/(?:your-account\/order-history|css\/order-history))(?:\.html)?(?:\/ref=[A-Za-z0-9_-]+)?\/?$/.test(
          u.pathname
        )
      )
        return '';
      const out = new URL('https://www.amazon.com' + u.pathname.replace(/\/ref=[A-Za-z0-9_-]+\/?$/, ''));
      for (const key of ['timeFilter', 'orderFilter', 'startIndex', 'page']) {
        const value = u.searchParams.get(key);
        if (value === null) continue;
        if (
          key === 'timeFilter' || key === 'orderFilter'
            ? !/^(?:year-(?:19|20)\d{2}|(?:19|20)\d{2}|past3months|last30|months-[136])$/.test(value)
            : !/^\d{1,6}$/.test(value)
        )
          return '';
        out.searchParams.set(key, value);
      }
      out.searchParams.sort();
      return out.href;
    } catch {
      return '';
    }
  }
  function plan(doc, loc) {
    const current = url(loc.href);
    if (!current) return null;
    const years = new Set();
    for (const select of doc.querySelectorAll('select')) {
      const options = [...select.querySelectorAll('option')].filter(o =>
        /^(?:year-)?(?:19|20)\d{2}$/.test(o.value || o.getAttribute('value') || '')
      );
      if (!options.length) continue;
      const key = ['timeFilter', 'orderFilter'].includes(select.name || select.getAttribute('name'))
        ? select.name || select.getAttribute('name')
        : 'timeFilter';
      for (const option of options) {
        const u = new URL(current);
        u.searchParams.delete('startIndex');
        u.searchParams.delete('page');
        u.searchParams.delete('timeFilter');
        u.searchParams.delete('orderFilter');
        u.searchParams.set(key, option.value || option.getAttribute('value'));
        years.add(url(u.href));
      }
    }
    const nextNode = [
      ...doc.querySelectorAll(
        '.a-pagination .a-last a[href], a[rel="next"][href], a[aria-label="Next page"][href], .a-pagination a[aria-label="Next"][href]'
      ),
    ].find(node => !node.closest('.a-disabled, [aria-disabled="true"]'));
    let next = '';
    if (nextNode) {
      try {
        next = url(new URL(nextNode.getAttribute('href'), current).href);
      } catch {
        /* malformed pagination is reported as unsupported */
      }
    }
    if (next === current) next = '';
    const unsupportedNext =
      (!next && !!nextNode) ||
      (!next &&
        [...doc.querySelectorAll('.a-pagination .a-last, button[aria-label="Next page"]')].some(
          node => !node.closest('.a-disabled, [aria-disabled="true"]') && !node.hasAttribute('disabled')
        ));
    const text = doc.body?.innerText || doc.body?.textContent || '';
    const countText = doc.querySelector('.num-orders, .orders-count, [data-testid="order-count"]')?.textContent || text;
    const total = Number((countText.match(/\b([\d,]+)\s+orders?\s+placed\b/i) || [])[1]?.replace(/,/g, '')) || 0;
    return {
      years: [...years].filter(Boolean),
      next,
      unsupportedNext,
      orders: Math.min(total, 100000),
      empty: /(?:no orders|haven.t placed any orders|\b0 orders placed)/i.test(text),
    };
  }
  function estimate(state) {
    const remaining = Math.max(state.queue?.length || 0, Math.ceil((state.orders || 0) / 10) - (state.pages || 0));
    const seconds = Math.max(5, (state.averageMs || 30000) / 1000);
    return {
      pages: remaining,
      lowSeconds: Math.round(remaining * seconds * 0.5),
      highSeconds: Math.round(remaining * seconds * 2),
      provisional: !(state.pages > 1),
    };
  }
  const api = { MAX_PAGES, url, plan, estimate };
  root.AIR = root.AIR || {};
  root.AIR.db = root.AIR.db || {};
  root.AIR.db.historyScan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
