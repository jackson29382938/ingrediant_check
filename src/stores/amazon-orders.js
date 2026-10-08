// Read only explicit order cards; never infer purchases from recommendations or cart contents.
(function(root) {
  function allowed(loc) {
    try { const u = new URL(loc.href); return u.protocol === 'https:' && /^(?:www\.)?amazon\.com$/.test(u.hostname) && /^\/(?:your-orders\/orders|gp\/(?:your-account\/order-history|css\/order-history))(?:\.html)?(?:\/ref=[A-Za-z0-9_-]+)?\/?$/.test(u.pathname); } catch { return false; }
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
    const out = [], seen = new Set(), origin = new URL(loc.href).origin;
    const tiles = '.order-item, .item-box, .product-box, .yohtmlc-item, .yohtmlc-product, .a-carousel-card, [data-testid="order-item"], [data-asin]';
    const excluded = node => {
      if (node.closest('header, footer, nav, .air-order-badge, #air-order-history, [hidden], [aria-hidden="true"], .aok-hidden, [class*="recommend"], [id*="recommend"], .order-header, .order-info, [data-testid="order-header"]')) return true;
      for (let n = node; n?.getAttribute; n = n.parentNode) if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style') || '')) return true;
      return false;
    };
    const identity = a => {
      try { const u = new URL(a.getAttribute('href'), loc.href); return u.origin === origin && !u.username && !u.password ? (u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i) || [])[1]?.toUpperCase() || '' : ''; } catch { return ''; }
    };
    const productLinks = node => [...node.querySelectorAll('a[href]')].filter(a => { const id = identity(a), declared = a.closest('[data-asin]')?.getAttribute('data-asin'); return id && !excluded(a) && (!declared || declared.toUpperCase() === id); });
    const visibleText = node => {
      if (node.nodeType === 3) return node.textContent || '';
      if (!node.tagName || /^(SCRIPT|STYLE)$/.test(node.tagName) || excluded(node)) return '';
      return [...node.childNodes].map(visibleText).join(' ').replace(/\s+/g, ' ').trim();
    };
    const nameOf = a => (visibleText(a) || a.getAttribute('aria-label') || a.querySelector('img')?.getAttribute('alt') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    for (const card of doc.querySelectorAll('.order-card, .order, [data-order-id]')) {
      if (excluded(card)) continue;
      const header = card.querySelector('.order-header, .order-info, [data-testid="order-header"]');
      const order = card.getAttribute('data-order-id') || (header?.textContent.match(/\b\d{3}-\d{7}-\d{7}\b/) || [])[0];
      if (!/^\d{3}-\d{7}-\d{7}$/.test(order || '')) continue;
      const dateNode = header?.querySelector('time, .order-date, [data-testid="order-date"]');
      const placed = date(dateNode?.getAttribute('datetime') || dateNode?.textContent || header?.textContent);
      if (!placed) continue;
      const candidates = [...card.querySelectorAll(tiles + ', .a-fixed-left-grid')];
      // Current compact grids sometimes have only an image link and no item class. Read its
      // immediate tile inside this verified order card; never split a mixed explicit item.
      for (const a of productLinks(card)) {
        const owner = a.closest(tiles);
        let tile = a.parentNode;
        if (tile === card || (owner && (tile === owner || !tile.querySelector('img') || new Set(productLinks(owner).map(identity)).size === 1))) continue;
        // A shipment wrapper may contain several products; only its separate image-bearing
        // children are tiles. A mixed row of bare title links remains ambiguous.
        while (tile.parentNode !== card && tile.parentNode !== owner && tile.parentNode?.querySelectorAll && new Set(productLinks(tile.parentNode).map(identity)).size === 1) tile = tile.parentNode;
        candidates.push(tile);
      }
      for (const line of candidates) {
        if (excluded(line)) continue;
        const links = productLinks(line), ids = new Set(links.map(identity));
        if (ids.size !== 1) continue;
        const asin = [...ids][0], key = `${order}:${asin}`, declared = line.getAttribute('data-asin');
        if (declared && declared.toUpperCase() !== asin) continue;
        if (seen.has(key)) continue;
        const anchor = links.find(a => visibleText(a)) || links.find(a => nameOf(a));
        if (!anchor) continue;
        const name = nameOf(anchor).slice(0, 250);
        if (!name || /^(?:opens? in (?:a )?new tab|product image|image)$/i.test(name)) continue;
        const statusSelector = '.delivery-status, .shipment-status, .shipment-top-row .a-size-medium, .delivery-box__primary-text, [data-testid="item-status"]';
        const status = line.querySelector(statusSelector) || line.closest('.shipment, .shipment-container, .delivery-box')?.querySelector(statusSelector);
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
