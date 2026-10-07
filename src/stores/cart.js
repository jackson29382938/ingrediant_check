// Cart identity and line-item discovery. Never inspect checkout/account data.
(function(root) {
  const A = root.AIR;
  // Amazon's own cart markup, read from a live cart (tests/pages/amazon-cart.html). Only the active lines are the
  // cart: the cart page keeps them in #sc-active-cart, and the slide-out "everywhere" cart (what Amazon opens right
  // after Add to Cart, at /cart/smart-wagon, and from the cart icon on product and search pages) lists them as
  // .ewc-item. Every other product link on those pages is a recommendation rail, a saved-for-later line or the page
  // footer, and none of those is in the cart.
  const AMAZON_ROWS = '#sc-active-cart .sc-list-item[data-asin], #ewc-content .ewc-item[data-asin]';
  const rows = '.sc-list-item[data-asin], [data-testid*="cart-item"], [data-testid*="cartItem"], [data-testid*="CartItem"], [data-testid*="cart-product"], [data-testid*="cartProduct"], [data-testid*="line-item"], [data-test*="cartItem"], [data-test*="CartItem"], [data-test*="cart-item"], [data-automation-id*="cart-item"], [data-qa*="cartItem"], [data-qa*="cart-item"], .CartItem, .cart-item, .cartItem, li, article, [role="listitem"]';
  function store(loc) {
    const s = A.stores.storeForHost(loc.hostname);
    if (!s || !/^https:$/.test(loc.protocol || new URL(loc.href).protocol)) return null;
    return s.domains.some(h => loc.hostname === h || loc.hostname === 'www.' + h) ? s : null;
  }
  function isCartPage(loc) {
    const s = store(loc);
    if (!s) return false;
    const p = new URL(loc.href).pathname;
    if (s.id === 'amazon') return /^\/(?:gp\/cart\/view\.html|cart(?:\/(?:view\.html|smart-wagon))?)\/?$/.test(p);
    if (s.id === 'costco') return /^\/(?:cart|CartView)(?:\.html)?\/?$/.test(p);
    if (['safeway', 'albertsons'].includes(s.id)) return /^\/(?:cart|shop\/cart)(?:\.html)?\/?$/.test(p);
    if (s.id === 'instacart') return /^\/(?:cart|store\/(?:[^/]+\/)?cart)\/?$/.test(p);
    return /^\/cart\/?$/.test(p);
  }
  function allowed(loc) {
    const s = store(loc);
    if (!s || /\/(?:checkout|account|orders|login|ap|buy)(?:\/|\.|$)/i.test(new URL(loc.href).pathname)) return false;
    if (isCartPage(loc)) return true;
    const a = A.storeAdapters?.[s.id];
    return s.id === 'amazon' ? /^\/(?:dp\/|gp\/product\/|s(?:\/|$))/.test(new URL(loc.href).pathname)
      : !!a && (a.isProductPage(loc) || a.isSearchPage(loc));
  }
  function adapter(loc) {
    const s = store(loc);
    if (!s) return null;
    if (s.id !== 'amazon') return A.storeAdapters?.[s.id] || null;
    function productId(raw) {
      try {
        const u = new URL(raw, loc.href);
        if (u.origin !== new URL(loc.href).origin || u.username || u.password) return '';
        return (u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i) || [])[1]?.toUpperCase() || '';
      } catch { return ''; }
    }
    return { productId, productUrl: id => `${new URL(loc.href).origin}/dp/${id}`,
      readProduct: (doc, url) => {
        const id = productId(url.href), data = A.extract.extract(doc, { asin: id, foodOnly: false });
        // The same evidence a product page or search tile scores from (search.js readProductHtml): its labels and
        // certifications, and the page's own food check (department and breadcrumbs, not just the title). `real`
        // is false for a robot-check page, which has no product title and is not an answer about the product.
        return { id: data.asin || id, title: data.title || '', ingredients: data.ok ? data.text || data.ingredients || '' : '',
          nutrition: data.nutrition, advisoryText: data.advisoryText, labels: data.labels, certifications: data.certifications,
          via: data.via, confidence: data.confidence, food: data.ingestible, real: !!doc.querySelector('#productTitle'), crumbs: [] };
      } };
  }
  // On screen? A real page has layout, so ask the browser; a saved page has none, so read the inline style.
  function rendered(el) {
    if (typeof el.getClientRects === 'function' && el.ownerDocument?.defaultView) return el.getClientRects().length > 0;
    for (let n = el; n?.getAttribute; n = n.parentNode) {
      if (n.hasAttribute?.('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style') || '')) return false;
    }
    return true;
  }
  // The words a reader sees: not scripts, our own badge, or text the page hides (Amazon's image link holds a hidden
  // "Opens in a new tab", which made it look like the title link).
  function text(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(node.tagName) || node.classList?.contains('air-cart-badge') || /(?:^|\s)(?:air-cart-badge|aok-hidden|a-hidden)(?:\s|$)/.test(node.className || '')) return '';
    const win = node.ownerDocument?.defaultView;
    if (win?.getComputedStyle && win.getComputedStyle(node).display === 'none') return '';
    return Array.from(node.childNodes || []).map(text).join(' ').replace(/\s+/g, ' ').trim();
  }
  function tiles(doc, loc) {
    const a = adapter(loc), out = [], amazon = store(loc)?.id === 'amazon';
    if (!a || !allowed(loc)) return out;
    for (const row of doc.querySelectorAll(amazon ? AMAZON_ROWS : rows)) {
      // Amazon's own navigation holds the slide-out cart, so only a hidden ancestor rules its lines out.
      if (row.closest(amazon ? '[hidden]' : 'header, nav, footer, [hidden], [role="dialog"][aria-label="Checkout"]') || A.retailerLabels?.hiddenFromSight(row)) continue;
      if (amazon && !/^(?:active)?$/.test(row.getAttribute('data-itemtype') || '')) continue;
      if (!isCartPage(loc) && !row.closest('[aria-label="Shopping cart"], [aria-label="Cart"], [data-testid="cart"], [data-testid="cart-drawer"], [data-test="cartDrawer"], #sc-active-cart, #ewc-content')) continue;
      let excluded = false;
      for (let n = row; n?.getAttribute; n = n.parentNode) {
        if (/recommend|upsell|suggest|carousel|swiper|footer|also[-_ ]?bought|buy[-_ ]?(?:it[-_ ]?)?again|sc-saved-cart|saved[-_ ]?(?:for[-_ ]?later|cart)|recently[-_ ]?viewed|sponsored/i.test(['id', 'class', 'data-testid', 'aria-label'].map(k => n.getAttribute(k) || '').join(' '))) excluded = true;
        const style = doc.defaultView?.getComputedStyle?.(n);
        if (style?.display === 'none' || style?.visibility === 'hidden') excluded = true;
      }
      if (excluded || out.some(t => t.row.contains?.(row))) continue;
      // Visible links only: a line can hold hidden copies of its title link (Amazon's "was removed" messages).
      const links = Array.from(row.querySelectorAll('a[href]')).filter(l => rendered(l)).filter(l => {
        try { const u = new URL(l.getAttribute('href'), loc.href); return u.origin === new URL(loc.href).origin && !u.username && !u.password && !!a.productId(u.href); } catch { return false; }
      });
      const ids = new Set(links.map(l => a.productId(new URL(l.getAttribute('href'), loc.href).href)));
      if (ids.size !== 1) continue; // recycled/mixed identities must not borrow a label
      const link = links.find(l => text(l)) || links[0];
      const id = [...ids][0], declared = row.getAttribute('data-asin') || row.getAttribute('data-product-id') || '';
      if (/^[A-Z0-9]{5,15}$/i.test(declared) && declared.toUpperCase() !== id.toUpperCase()) continue;
      const titleNode = link?.querySelector('h2, h3, h4, .sc-product-title, [data-testid="product-title"], [data-test="product-title"]');
      // Amazon names every line in data-producttitle; reading its link instead gives the full title and the cut-off copy.
      const title = (amazon && row.getAttribute('data-producttitle')) || text(titleNode) || text(link) || link?.getAttribute('aria-label') || link?.querySelector('img')?.getAttribute('alt') || '';
      if (!title || title.length > 400) continue;
      const u = new URL(link.getAttribute('href'), loc.href);
      // Preserve public retailer context, but never forward cart/checkout query data.
      const product = new URL(a.productUrl(id, loc), loc.href);
      product.search = ''; product.hash = '';
      if (new URL(loc.href).hostname.includes('instacart.com') && u.searchParams.has('retailerSlug')) product.searchParams.set('retailerSlug', u.searchParams.get('retailerSlug'));
      if (product.origin !== u.origin || a.productId(product.href) !== id) continue;
      // Amazon's title link is a block inside a truncating box: the badge goes in front of the link, outside it.
      out.push({ id, title, row, anchor: amazon && text(link) ? link.parentNode : titleNode || link, url: product.href, imageOnly: !text(link) });
    }
    return out;
  }
  // The cart as a whole: the plain mean of the lines that have a score (quantities are never read).
  function summarize(items) {
    const scores = items.filter(i => Number.isFinite(i.score)).map(i => i.score);
    const average = scores.length ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length) : null;
    const band = average == null ? null : (A.engine?.BANDS || []).find(b => average >= b[0]);
    return { total: items.length, rated: scores.length, average, verdict: band ? band[1] : '', pending: items.filter(i => i.status === 'checking').length };
  }
  // Where the summary goes: under Amazon's "Shopping Cart" heading; elsewhere in front of the list the first line sits in.
  function summaryPlace(doc, loc, first) {
    if (!isCartPage(loc)) return null;
    if (store(loc)?.id === 'amazon') {
      const h = doc.querySelector('#sc-active-items-header');
      return h?.parentNode ? { parent: h.parentNode, before: h.nextSibling } : null;
    }
    const list = first && (first.row.closest('ul, ol') || first.row);
    return list?.parentNode ? { parent: list.parentNode, before: list } : null;
  }
  A.cart = { store, isCartPage, allowed, adapter, tiles, summarize, summaryPlace };
  if (typeof module !== 'undefined' && module.exports) module.exports = A.cart;
})(typeof globalThis !== 'undefined' ? globalThis : self);
