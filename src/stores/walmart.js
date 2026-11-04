// Walmart preview: read the current product's embedded ingredient declaration or visible label.
// The captured __NEXT_DATA__ schema was observed on October 4, 2026. Identity must match the URL.
(function(root) {
  const L = root.AIR.retailerLabels;
  const matchesHost = host => /^(?:www\.)?walmart\.com$/i.test(String(host || ''));
  function productId(raw) {
    try {
      const u = new URL(String(raw), 'https://www.walmart.com');
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !matchesHost(u.hostname)) return '';
      return (u.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d{5,15})\/?$/) || [])[1] || '';
    } catch { return ''; }
  }
  function productUrl(id, loc) {
    try {
      const u = new URL(loc.href);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !matchesHost(u.hostname) || !/^\d{5,15}$/.test(String(id))) return '';
      // Use the public item route on the currently open origin, without ad/tracking parameters.
      return new URL(`/ip/${id}`, u.origin).href;
    } catch { return ''; }
  }
  function acceptsProductRedirect(from, to, id) {
    // Walmart canonicalizes the apex host to www. Accept only that retailer's
    // public product for the same ID, never a challenge, account or foreign URL.
    return matchesHost(from.hostname) && matchesHost(to.hostname)
      && /^https?:$/.test(from.protocol) && to.protocol === 'https:'
      && !to.username && !to.password && productId(from.href) === id && productId(to.href) === id;
  }
  let lastNode, lastText, lastData;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  // Decode text without inserting retailer HTML into the page or executing its scripts.
  function declaration(value) {
    if (typeof value !== 'string' || value.length > 6000) return '';
    const entities = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>' };
    const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()];
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : match;
    });
    return L.clean(decoded.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, ' '));
  }
  function embedded(doc) {
    const node = doc.querySelector('#__NEXT_DATA__');
    if (!node) return null;
    const raw = node.textContent;
    if (node === lastNode && raw === lastText) return lastData;
    lastNode = node; lastText = raw; lastData = null;
    if (!raw || raw.length > 8 * 1024 * 1024) return null;
    try {
      const data = JSON.parse(raw)?.props?.pageProps?.initialData?.data;
      lastData = record(data) ? data : null;
    } catch { /* incomplete page */ }
    return lastData;
  }
  function readProduct(doc, loc) {
    const id = productId(loc.href);
    const model = embedded(doc);
    const product = record(model?.product) ? model.product : null;
    const heading = L.text(doc.querySelector('h1'));
    const modelTitle = typeof product?.name === 'string' ? L.clean(product.name) : '';
    const title = modelTitle || heading;
    const base = { id, title, crumbs: [], ingredients: '', labelText: '', nutrition: null, label: 'missing' };
    const declaredId = product?.usItemId;
    if (!id || !L.sameCanonical(doc, id, productId) || (model && !product) || (product &&
      !((typeof declaredId === 'string' || typeof declaredId === 'number') && String(declaredId) === id))) return base;
    // SPA navigation can update the matching boot model before the previous product's DOM.
    // Do not combine the new product's declaration with the previous title or nutrient table.
    const aligned = !heading || !modelTitle || heading.toLowerCase() === modelTitle.toLowerCase();
    const visible = aligned ? L.readLabel(doc) : { ingredients: '', labelText: '', nutrition: null, label: 'missing' };
    const declared = product && model.idml?.ingredients?.ingredients?.value;
    const ingredients = declaration(declared) || visible.ingredients;
    return { ...base, ...visible, ingredients, labelText: ingredients, label: ingredients ? 'open' : visible.label,
      crumbs: (Array.isArray(product?.category?.path) ? product.category.path : []).map(item => typeof item?.name === 'string' ? L.clean(item.name) : '').filter(Boolean) };
  }
  const ITEM_CARD = '[data-item-id], [data-dca-card-id], [data-testid="product-card"], [data-testid="list-view"]';
  const CARD = ITEM_CARD + ', [role="group"]';
  const GRID = '[data-testid="item-stack"]';
  // ---------------------------------------------------------------- sponsored placements
  // An ad is recognised by any one of several independent signals, because Walmart's markup is built from
  // generated class names and has changed under this extension before. The signals, strongest first:
  //   1. a link through Walmart's ad tracker (/sp/track?...&plmt=sp-search-middle...&rd=<product>), which
  //      an organic result never uses;
  //   2. an attribute that names the placement (data-sponsored, data-testid="sp-search-...", aria-label);
  //   3. an accessible name that ends in the disclosure ("Great Value oats, 42 oz, Sponsored");
  //   4. the visible label itself, as its own element ("Sponsored", "Advertisement", "Ad").
  // Nothing here reads a class name. A signal anywhere inside a result card marks that whole card.
  const AD_ATTRS = ['data-testid', 'data-test', 'data-automation-id', 'aria-label'];
  const AD_ATTR = /sponsored|advertisement|(?:^|[-_])ad(?:[-_]|$)|^sp-(?:search|carousel|brand)(?:-|$)/i;
  const AD_NAME = /(?:^|[\s,.;:|·•–—-])(?:sponsored|advertisement)(?:\s+(?:ad|product|result|listing))?\s*$/i;
  const AD_LABEL = /^(?:sponsored(?:\s+(?:ad|product|result|listing|item|content))?|advertisement|ad)$/i;
  const AD_LINK = /\/sp\/track\b|[?&](?:adsRedirect=true|adUid=|plmt=sp-|mloc=sp-)/i;
  const LABEL_NODES = 'span, p, div, small, strong, b, em, a, button, label, li, h4, h5, h6';
  const MARK_NODES = '[data-sponsored], [data-testid], [data-test], [data-automation-id], [aria-label], [title], img[alt]';
  // Never hide, or climb through, the page chrome or the results grid itself.
  const STOP = 'main, form, nav, header, footer, aside, body, html, [role="main"], [data-testid="item-stack"]';
  const CHROME = 'h1, input, select, nav, [role="search"]';
  const clean = L.clean;
  function marked(node) {
    if (node.getAttribute('data-sponsored') === 'true') return true;
    if (AD_ATTRS.some(attr => AD_ATTR.test(node.getAttribute(attr) || ''))) return true;
    return ['aria-label', 'title', 'alt'].some(attr => AD_NAME.test(node.getAttribute(attr) || ''));
  }
  // A label has a tiny subtree, so large containers are rejected before their text is ever built. It is the bare
  // word ("Sponsored"), or a short screen-reader sentence that ends in it ("Oats, current price $3.97, Sponsored").
  const labelled = node => {
    if (node.children.length > 3) return false;
    const t = node.textContent;
    if (!t || t.length > 300) return false;
    const text = clean(t);
    return (text.length <= 60 && AD_LABEL.test(text)) || AD_NAME.test(text);
  };
  const adHref = node => AD_LINK.test(node.getAttribute('href') || '');
  // The product a tracked ad link leads to, so a sponsored card still knows which product it holds.
  function trackedId(href) {
    try { return productId(new URL(href, 'https://www.walmart.com').searchParams.get('rd') || ''); } catch { return ''; }
  }
  // Hrefs repeat on every pass and URL parsing is the dearest step, so each is parsed once.
  const idMemo = new Map();
  function idOf(href) {
    let id = idMemo.get(href);
    if (id === undefined) {
      id = productId(href) || (AD_LINK.test(href) ? trackedId(href) : '');
      if (idMemo.size > 4000) idMemo.clear();
      idMemo.set(href, id);
    }
    return id;
  }
  const idsIn = node => new Set(Array.from(node.querySelectorAll('a[href]')).map(a => idOf(a.getAttribute('href') || '')).filter(Boolean));
  const within = (outer, node) => { for (let n = node; n; n = n.parentNode) if (n === outer) return true; return false; };
  // One product's card: an item card, or a role=group wrapper that holds exactly one product.
  const isTile = node => node.matches(ITEM_CARD) || (node.getAttribute('role') === 'group' && idsIn(node).size === 1);
  function ancestors(node, limit = 8) {
    const out = [];
    for (let p = node.parentNode; p && p.nodeType === 1 && out.length < limit && !p.matches('body, html'); p = p.parentNode) out.push(p);
    return out;
  }
  const SIGNAL_NODES = `a[href], ${MARK_NODES}, ${LABEL_NODES}`;
  const isSignal = node => (node.hasAttribute('href') && adHref(node)) || marked(node) || labelled(node);
  // One card, asked on its own (searchTiles). A whole page is answered by sponsoredSlots in one pass instead.
  const cardIsSponsored = card => marked(card) || Array.from(card.querySelectorAll(SIGNAL_NODES)).some(isSignal);
  // A card inside a marked module (a sponsored brand carousel) is an ad too, though it carries no label itself.
  const insideAdModule = card => ancestors(card).some(p => !p.matches(STOP) && marked(p));
  const sponsoredTile = card => cardIsSponsored(card) || insideAdModule(card);
  function sponsoredSlots(doc) {
    const tiles = Array.from(doc.querySelectorAll(CARD)).filter(isTile);
    const tileSet = new Set(tiles);
    // One scan of the document finds every node that says "ad" in any of the ways above; most pages have a
    // handful. Each is then walked up to the card that holds it, so a card is never searched on its own.
    const signals = [];
    for (const node of doc.querySelectorAll(`${SIGNAL_NODES}, ${CARD}`)) if (isSignal(node)) signals.push(node);
    const ads = new Set();
    const cardOf = node => { for (let n = node; n && n.nodeType === 1; n = n.parentNode) if (tileSet.has(n)) return n; return null; };
    const outside = [];
    for (const signal of signals) {
      const card = cardOf(signal);
      if (card) {
        // Cards nest (an outer role=group around an inner list-view): every enclosing card of the same single
        // product is the same ad, so the outermost is hidden and nothing is left behind as an empty cell.
        ads.add(card);
        const own = idsIn(card);
        for (let n = card.parentNode; n && n.nodeType === 1 && !n.matches(STOP); n = n.parentNode) {
          if (!tileSet.has(n)) continue;
          if (!Array.from(idsIn(n)).every(id => own.has(id))) break;
          ads.add(n);
        }
      } else outside.push(signal);
      // A marked module that holds cards (a sponsored brand carousel) makes each of them an ad.
      if (marked(signal) && !signal.matches(STOP) && !tileSet.has(signal)) for (const inner of signal.querySelectorAll(CARD)) if (tileSet.has(inner)) ads.add(inner);
    }
    // Every node that holds an organic card, from one walk up from each card; shared ancestors are added once.
    const holding = new Set();
    for (const tile of tiles) {
      let inAd = false;
      for (let n = tile; n && n.nodeType === 1; n = n.parentNode) if (ads.has(n)) { inAd = true; break; }
      if (inAd) continue;
      for (let n = tile; n && n.nodeType === 1 && !holding.has(n); n = n.parentNode) holding.add(n);
    }
    const slots = new Set();
    // The widest wrapper that holds nothing but this ad, so the grid closes up around it.
    function slotFor(node, ids) {
      let slot = node;
      for (const p of ancestors(node, 6)) {
        if (p.matches(STOP) || holding.has(p) || p.querySelector(CHROME)) break;
        if (ids && !Array.from(idsIn(p)).every(id => ids.has(id))) break;
        slot = p;
      }
      return slot;
    }
    for (const ad of ads) slots.add(slotFor(ad, idsIn(ad)));
    // Ad modules that are not one product's card: banners, brand carousels, video and display ads.
    for (const signal of outside) {
      if (signal.matches(STOP) || holding.has(signal)) continue;
      if (Array.from(slots).some(slot => within(slot, signal))) continue;
      const slot = slotFor(signal, null);
      if (slot !== signal || !slot.matches(STOP)) slots.add(slot);
    }
    // Slots nested in one another collapse to the outermost, one hidden node per ad.
    for (const slot of Array.from(slots)) if (Array.from(slots).some(other => other !== slot && within(other, slot))) slots.delete(slot);
    return slots;
  }
  // Hide instead of deleting React-owned nodes. Recheck recycled cards before each pass,
  // and restore only our own changes when paused or navigating away from search.
  function showSlot(node) {
    node.style.removeProperty('display');
    const display = node.getAttribute('data-air-sponsored-display');
    if (display) node.style.setProperty('display', display, node.getAttribute('data-air-sponsored-priority') || '');
    node.removeAttribute('data-air-sponsored-hidden');
    node.removeAttribute('data-air-sponsored-display');
    node.removeAttribute('data-air-sponsored-priority');
  }
  function restoreSponsored(doc) {
    for (const stack of doc.querySelectorAll('[data-air-compact-grid]')) stack.removeAttribute('data-air-compact-grid');
    for (const cell of doc.querySelectorAll('[data-air-result-cell]')) cell.removeAttribute('data-air-result-cell');
    for (const node of doc.querySelectorAll('[data-air-sponsored-hidden]')) showSlot(node);
  }
  function hideSlot(node) {
    if (node.hasAttribute('data-air-sponsored-hidden')) return;
    node.setAttribute('data-air-sponsored-hidden', 'true');
    node.setAttribute('data-air-sponsored-display', node.style.getPropertyValue('display'));
    node.setAttribute('data-air-sponsored-priority', node.style.getPropertyPriority('display'));
    node.style.setProperty('display', 'none', 'important');
  }
  function compactResults(doc) {
    if (!doc.getElementById('air-walmart-compact-style')) {
      const style = doc.createElement('style'); style.id = 'air-walmart-compact-style';
      style.textContent = '[data-air-compact-grid]{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))!important;align-items:start!important;gap:0!important}[data-air-compact-grid]>[data-air-result-cell]{width:auto!important;min-width:0!important;max-width:none!important}[data-air-compact-grid]>:not([data-air-result-cell]){grid-column:1/-1}@media(max-width:600px){[data-air-compact-grid]{grid-template-columns:repeat(2,minmax(0,1fr))!important}}';
      (doc.head || doc.documentElement).append(style);
    }
    const stacks = new Set(), cells = new Set();
    for (const stack of doc.querySelectorAll(GRID)) {
      if (!stack.querySelector(ITEM_CARD)) continue;
      stacks.add(stack); stack.setAttribute('data-air-compact-grid', '');
      for (const cell of stack.children) {
        if (cell.hasAttribute('data-air-space-filler')) { cells.add(cell); cell.setAttribute('data-air-result-cell', ''); continue; }
        if (cell.matches(ITEM_CARD) || cell.querySelector(ITEM_CARD)) { cells.add(cell); cell.setAttribute('data-air-result-cell', ''); }
        // Retail ad slots may become completely empty after hydration. Preserve
        // interactive/media/announced content, and recheck when anything arrives.
        else if (!L.text(cell) && !cell.querySelector('a, button, input, select, img, picture, video, canvas, iframe, [aria-live], [role="status"]')) hideSlot(cell);
      }
    }
    for (const stack of doc.querySelectorAll('[data-air-compact-grid]')) if (!stacks.has(stack)) stack.removeAttribute('data-air-compact-grid');
    for (const cell of doc.querySelectorAll('[data-air-result-cell]')) if (!cells.has(cell)) cell.removeAttribute('data-air-result-cell');
  }
  // Runs on every pass and, between passes, on the next frame after the page changes, so an ad that
  // arrives with a late result never paints. Only our own slots are ever touched.
  function hideSponsored(doc) {
    const wanted = sponsoredSlots(doc);
    for (const node of doc.querySelectorAll('[data-air-sponsored-hidden]')) if (!wanted.has(node)) showSlot(node);
    for (const node of wanted) hideSlot(node);
    compactResults(doc);
  }
  function searchTiles(doc) {
    const out = [], seen = new Set();
    for (const link of doc.querySelectorAll('a[href]')) {
      const id = productId(link.getAttribute('href'));
      if (!id || adHref(link) || link.closest('nav, aside, footer, [data-air-sponsored-hidden]') || L.hiddenFromSight(link)) continue;
      let excluded = false;
      for (let parent = link; parent && parent.getAttribute; parent = parent.parentNode) {
        if (['data-testid', 'data-test', 'data-automation-id', 'aria-label'].some(attr => /recommend|promot|sponsored|advertis/i.test(parent.getAttribute(attr) || ''))) {
          excluded = true; break;
        }
      }
      if (excluded) continue;
      // The public grid uses role=group cards with an overlay link and a separate title span.
      // item-stack is the entire grid. Never borrow that grid's first product title.
      const card = link.closest(ITEM_CARD) || link.closest('[role="group"]');
      const identity = card || id;
      if (seen.has(identity)) continue;
      if (card && sponsoredTile(card)) continue;
      if (card && Array.from(card.querySelectorAll('a[href]')).some(other => {
        const otherId = productId(other.getAttribute('href'));
        return otherId && otherId !== id;
      })) continue;
      // Walmart's overlay link comes first and contains a screen-reader-only h3.
      // Prefer the separate visible title, otherwise badges inherit that 1px clipping.
      const scope = card || link;
      const titleNode = scope.querySelector('[data-automation-id="product-title"]') || scope.querySelector('h2, h3');
      const titleOwner = titleNode && titleNode.closest('a[href]');
      const heading = !titleOwner || productId(titleOwner.getAttribute('href')) === id ? titleNode : null;
      // Accessible names cover image-only links without borrowing another product's image.
      const image = link.querySelector('img[alt]');
      const title = L.text(heading)
        || L.clean(link.getAttribute('aria-label')) || L.text(link)
        || L.clean(image && image.getAttribute('alt'));
      if (!title || title.length > 300) continue;
      seen.add(identity);
      out.push({ id, title, tile: card || link, el: card || undefined, anchor: heading || link, badgePlacement: 'title' });
    }
    return out;
  }
  // The facts the sort panel ranks on, read from the card as Walmart renders it. Walmart splits the visible price
  // into dollars and cents; its screen-reader price node carries the exact decimals, so it is read first.
  function readListing(tile) {
    const card = tile.el || tile.tile || tile.anchor;
    const priceNode = card.querySelector('[data-testid="unified-global-product-price-a11y-text"]') || card.querySelector('[data-automation-id="product-price"]');
    return { ...L.listingFacts(card, { priceNode, imageHost: /(?:^|\.)walmartimages\.com$/i }), sponsored: false };
  }
  const adapter = { id: 'walmart', name: 'Walmart', matchesHost, productId, productUrl, remountPanel: true,
    alwaysRateSearch: true, hideSponsored, restoreSponsored, sponsoredSlots, readListing,
    storeHost: 'walmart.com', paging: { param: 'page', first: 1 },
    acceptsProductRedirect, publicCredentials: 'same-origin',
    isProductPage: loc => !!productId(loc.href), isSearchPage: loc => matchesHost(loc.hostname) && /^\/search\/?$/.test(loc.pathname),
    searchQuery: loc => { try { return new URL(loc.href).searchParams.get('q') || ''; } catch { return ''; } },
    readProduct, labelToggle: L.labelToggle, labelName: 'Ingredients', searchTiles };
  root.AIR.storeAdapters = root.AIR.storeAdapters || {}; root.AIR.storeAdapters.walmart = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
