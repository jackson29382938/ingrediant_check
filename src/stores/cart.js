// Cart identity and line-item discovery. Never inspect checkout/account data.
(function(root) {
  const A = root.AIR;
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
    if (s.id === 'amazon') return /^\/(?:gp\/cart\/view\.html|cart(?:\/view\.html)?)\/?$/.test(p);
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
        return { id: data.asin || id, title: data.title || '', ingredients: data.ok ? data.text || data.ingredients || '' : '',
          nutrition: data.nutrition, advisoryText: data.advisoryText, crumbs: [] };
      } };
  }
  function text(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(node.tagName) || node.classList?.contains('air-cart-badge') || /(?:^|\s)air-cart-badge(?:\s|$)/.test(node.className || '')) return '';
    return Array.from(node.childNodes || []).map(text).join(' ').replace(/\s+/g, ' ').trim();
  }
  function tiles(doc, loc) {
    const a = adapter(loc), out = [];
    if (!a || !allowed(loc)) return out;
    for (const row of doc.querySelectorAll(rows)) {
      if (row.closest('header, nav, footer, [hidden], [role="dialog"][aria-label="Checkout"]') || A.retailerLabels?.hiddenFromSight(row)) continue;
      if (!isCartPage(loc) && !row.closest('[aria-label="Shopping cart"], [aria-label="Cart"], [data-testid="cart"], [data-testid="cart-drawer"], [data-test="cartDrawer"], #sc-active-cart')) continue;
      let excluded = false;
      for (let n = row; n?.getAttribute; n = n.parentNode) {
        if (/recommend|upsell|sc-saved-cart|saved[-_ ]?(?:for[-_ ]?later|cart)|recently[-_ ]?viewed|sponsored/i.test(['id', 'class', 'data-testid', 'aria-label'].map(k => n.getAttribute(k) || '').join(' '))) excluded = true;
        const style = doc.defaultView?.getComputedStyle?.(n);
        if (style?.display === 'none' || style?.visibility === 'hidden') excluded = true;
      }
      if (excluded || out.some(t => t.row.contains?.(row))) continue;
      const links = Array.from(row.querySelectorAll('a[href]')).filter(l => {
        try { const u = new URL(l.getAttribute('href'), loc.href); return u.origin === new URL(loc.href).origin && !u.username && !u.password && !!a.productId(u.href); } catch { return false; }
      });
      const ids = new Set(links.map(l => a.productId(new URL(l.getAttribute('href'), loc.href).href)));
      if (ids.size !== 1) continue; // recycled/mixed identities must not borrow a label
      const link = links.find(l => text(l)) || links[0];
      const id = [...ids][0], declared = row.getAttribute('data-asin') || row.getAttribute('data-product-id') || '';
      if (/^[A-Z0-9]{5,15}$/i.test(declared) && declared.toUpperCase() !== id.toUpperCase()) continue;
      const titleNode = link?.querySelector('h2, h3, h4, .sc-product-title, [data-testid="product-title"], [data-test="product-title"]');
      const title = text(titleNode) || text(link) || link?.getAttribute('aria-label') || link?.querySelector('img')?.getAttribute('alt') || '';
      if (!title || title.length > 300) continue;
      const u = new URL(link.getAttribute('href'), loc.href);
      // Preserve public retailer context, but never forward cart/checkout query data.
      const product = new URL(a.productUrl(id, loc), loc.href);
      product.search = ''; product.hash = '';
      if (new URL(loc.href).hostname.includes('instacart.com') && u.searchParams.has('retailerSlug')) product.searchParams.set('retailerSlug', u.searchParams.get('retailerSlug'));
      if (product.origin !== u.origin || a.productId(product.href) !== id) continue;
      out.push({ id, title, row, anchor: titleNode || link, url: product.href, imageOnly: !text(link) });
    }
    return out;
  }
  A.cart = { store, isCartPage, allowed, adapter, tiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = A.cart;
})(typeof globalThis !== 'undefined' ? globalThis : self);
