// Read only explicit order cards; never infer purchases from recommendations or cart contents.
(function(root) {
  function allowed(loc) {
    try { const u = new URL(loc.href); return u.protocol === 'https:' && /^(?:www\.)?amazon\.com$/.test(u.hostname) && /^\/(?:your-orders\/orders|gp\/(?:your-account\/order-history|css\/order-history))(?:\.html)?\/?$/.test(u.pathname); } catch { return false; }
  }
  function date(raw) {
    const text = String(raw || '').trim();
    const valid = value => { const d = new Date(value); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : ''; };
    let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) { const value = `${m[1]}-${m[2]}-${m[3]}`; return valid(value); }
    m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (!m) return '';
    const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(m[1].toLowerCase()) + 1;
    const value = `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return valid(value);
  }
  function read(doc, loc) {
    if (!allowed(loc)) return [];
    const out = [], seen = new Set();
    for (const card of doc.querySelectorAll('.order-card, .order, [data-order-id]')) {
      if (card.closest('header, footer, nav, [hidden], [class*="recommend"], [class*="carousel"]')) continue;
      const header = card.querySelector('.order-header, .order-info, [data-testid="order-header"]');
      const order = card.getAttribute('data-order-id') || (header?.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/) || [])[0];
      if (!/^\d{3}-\d{7}-\d{7}$/.test(order || '')) continue;
      const dateNode = header?.querySelector('time, .order-date, [data-testid="order-date"]');
      const placed = date(dateNode?.getAttribute('datetime') || dateNode?.textContent || header?.textContent);
      if (!placed) continue;
      for (const line of card.querySelectorAll('.order-item, .item-box, .yohtmlc-item, .a-fixed-left-grid, [data-testid="order-item"]')) {
        if (line.closest('[hidden], [class*="recommend"], [class*="carousel"]')) continue;
        const links = [...line.querySelectorAll('a[href]')].filter(a => {
          try { const u = new URL(a.getAttribute('href'), loc.href); return u.origin === new URL(loc.href).origin && !u.username && !u.password && /\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i.test(u.pathname); } catch { return false; }
        });
        const ids = new Set(links.map(a => new URL(a.getAttribute('href'), loc.href).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)[1].toUpperCase()));
        if (ids.size !== 1) continue;
        const asin = [...ids][0], key = `${order}:${asin}`;
        if (seen.has(key)) continue;
        const anchor = links.find(a => a.textContent.trim() && !a.closest('[hidden], .aok-hidden'));
        if (!anchor) continue;
        const name = anchor.textContent.replace(/\s+/g, ' ').trim().slice(0, 250);
        const status = line.querySelector('.delivery-status, .shipment-status, .shipment-top-row .a-size-medium, .delivery-box__primary-text, [data-testid="item-status"]') || line.closest('.shipment, .shipment-container')?.querySelector('.delivery-status, .shipment-status');
        const words = [status?.textContent, card.querySelector('.order-status, [data-testid="order-status"]')?.textContent].join(' ');
        // Ignore action links such as "Return items"; only explicit status counts.
        const state = /cancelled|canceled/i.test(words) ? 'cancelled' : /returned|refunded|refund issued|return complete/i.test(words) ? 'returned' : /return requested|partial return|pending|not yet confirmed/i.test(words) ? 'unknown' : 'purchased';
        seen.add(key); out.push({ order, asin, name, date: placed, state, anchor });
        if (out.length >= 100) return out;
      }
    }
    return out;
  }
  const value = { allowed, date, read }; root.AIR = root.AIR || {}; root.AIR.amazonOrders = value;
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
})(typeof globalThis !== 'undefined' ? globalThis : self);
