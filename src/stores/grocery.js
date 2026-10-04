// Local-only grocery previews. Kroger/Fry's declarations and nutrition markup were observed
// on public product pages on October 4, 2026. Other banners share route support, not live validation.
// No account APIs, boot script execution, or inferred missing nutrient quantities.
(function(root) {
  const L = root.AIR.retailerLabels;
  const configs = [
    ['instacart', 'Instacart', 'instacart.com', 'instacart'],
    ['kroger', 'Kroger', 'kroger.com', 'kroger'], ['frys', "Fry’s", 'frysfood.com', 'kroger'],
    ['ralphs', 'Ralphs', 'ralphs.com', 'kroger'], ['kingsoopers', 'King Soopers', 'kingsoopers.com', 'kroger'],
    ['smiths', "Smith’s", 'smithsfoodanddrug.com', 'kroger'], ['fredmeyer', 'Fred Meyer', 'fredmeyer.com', 'kroger'],
    ['qfc', 'QFC', 'qfc.com', 'kroger'], ['harristeeter', 'Harris Teeter', 'harristeeter.com', 'kroger'],
    ['dillons', 'Dillons', 'dillons.com', 'kroger'],
    ['safeway', 'Safeway', 'safeway.com', 'albertsons'], ['albertsons', 'Albertsons', 'albertsons.com', 'albertsons'],
  ];
  function excluded(el) {
    if (el?.closest('header, nav, footer, aside, form, [hidden], [aria-hidden="true"]')) return true;
    for (let node = el; node?.getAttribute; node = node.parentNode) {
      const scope = ['id', 'class', 'data-testid', 'data-test', 'aria-label'].map(key => node.getAttribute(key) || '').join(' ');
      if (/recommend|related[-_ ]*(?:products|items)|sponsored|recently[-_ ]?viewed|you[-_ ]may[-_ ]also|account[-_ ]modal/i.test(scope)) return true;
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) return true;
    }
    return false;
  }
  function firstVisible(doc, selector) {
    return Array.from(doc.querySelectorAll(selector)).find(node => !excluded(node)) || null;
  }
  const nutrients = [
    ['sodium', /^sodium$/i, 'mg'], ['saturatedFat', /^saturated fat$/i, 'g'], ['transFat', /^trans fat$/i, 'g'],
    ['sugar', /^(?:total )?sugars?$/i, 'g'], ['addedSugar', /^added sugars?$/i, 'g'],
    ['carbs', /^(?:total )?carbohydrates?$/i, 'g'], ['fibre', /^dietary fib(?:er|re)$/i, 'g'], ['protein', /^protein$/i, 'g'],
  ];
  function krogerNutrition(doc) {
    const panels = Array.from(doc.querySelectorAll('[data-testid="nutrition-facts-container"] .NutritionLabel')).filter(node => !excluded(node));
    if (panels.length !== 1) return null;
    const panel = panels[0], out = {}, conflicts = new Set();
    for (const row of panel.querySelectorAll('.NutrientDetail-TitleAndAmount')) {
      if (excluded(row)) continue;
      const name = L.text(firstVisible(row, '.NutrientDetail-Title'));
      const definition = nutrients.find(([, pattern]) => pattern.test(name));
      if (!definition) continue;
      const amounts = Array.from(row.querySelectorAll('.NutrientDetail-Amount')).filter(node => !excluded(node));
      const amount = amounts.length === 1 && L.text(amounts[0]).match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*(mg|g|mcg)$/i);
      if (!amount) { conflicts.add(definition[0]); continue; }
      const units = { g: 1000, mg: 1, mcg: 0.001 };
      const value = Number(amount[1].replace(/,/g, '')) * units[amount[2].toLowerCase()] / units[definition[2]];
      if (!Number.isFinite(value) || (out[definition[0]] != null && out[definition[0]] !== value)) conflicts.add(definition[0]);
      else out[definition[0]] = value;
    }
    for (const key of conflicts) delete out[key];
    const sizes = Array.from(panel.querySelectorAll('.NutritionLabel-ServingSize')).filter(node => !excluded(node));
    if (sizes.length > 1) return null;
    const metric = sizes.length === 1 && L.clean(Array.from(sizes[0].children || []).map(L.text).join(' ') || L.text(sizes[0])).match(/(?:^|[\s(])(\d+(?:\.\d+)?|\.\d+)\s*(g|grams?|ml|millilit(?:er|re)s?)\b/i);
    if (metric && Number(metric[1]) > 0 && Number.isFinite(Number(metric[1]))) out[/^(?:g|gram)/i.test(metric[2]) ? 'servingGrams' : 'servingMl'] = Number(metric[1]);
    return Object.keys(out).length ? out : null;
  }
  function krogerWarnings(doc) {
    const statements = [];
    for (const heading of doc.querySelectorAll('h2, h3, h4')) {
      if (excluded(heading) || !/^allergen info(?:rmation)?\s*:?$/i.test(L.text(heading))) continue;
      // The public declaration is its next paragraph, never the following disclaimer.
      const siblings = Array.from(heading.parentNode?.children || []);
      const paragraph = heading.nextElementSibling || siblings[siblings.indexOf(heading) + 1];
      if (!paragraph || paragraph.tagName !== 'P' || excluded(paragraph)) continue;
      const value = L.text(paragraph);
      if (value.length <= 2000 && /^(?:contains?\s*:?|may contain|(?:made|manufactured|processed) (?:in|on))\b/i.test(value) &&
        !/^contains?\s*:?\s*(?:no|none)\b/i.test(value)) statements.push(L.warningText(value));
    }
    return Array.from(new Set(statements)).join('. ');
  }
  function make([id, name, host, family]) {
    const matchesHost = value => [host, `www.${host}`].includes(String(value || '').toLowerCase());
    function url(raw) {
      try {
        const value = new URL(String(raw), `https://www.${host}`);
        return /^https?:$/.test(value.protocol) && !value.username && !value.password && matchesHost(value.hostname) ? value : null;
      } catch { return null; }
    }
    function productId(raw) {
      const u = url(raw);
      if (!u) return '';
      if (family === 'kroger') return (u.pathname.match(/^\/p\/[^/]+\/(\d{10,14})\/?$/) || [])[1] || '';
      if (family === 'albertsons') return (u.pathname.match(/^\/shop\/product-details\.(\d{5,15})\.html$/) || u.pathname.match(/^\/shop\/pd\/product\/(\d{5,15})\/?$/) || [])[1] || '';
      return (u.pathname.match(/^\/(?:store\/)?products\/(\d{5,15})(?:-[^/]+)?\/?$/) || u.pathname.match(/^\/store\/(?:[^/]+\/)?items\/(\d{5,15})(?:-[^/]+)?\/?$/) || [])[1] || '';
    }
    function isSearchPage(loc) {
      const u = url(loc?.href);
      if (!u) return false;
      if (family === 'kroger') return /^\/search\/?$/.test(u.pathname);
      if (family === 'albertsons') return u.pathname === '/shop/search-results.html';
      return /^\/store\/(?:[^/]+\/)?s\/?$/.test(u.pathname);
    }
    function structuredIdentityMatches(doc, currentId) {
      for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
        if (excluded(node) || !node.textContent || node.textContent.length > 256 * 1024) continue;
        let data;
        try { data = JSON.parse(node.textContent); } catch { continue; }
        const entries = Array.isArray(data) ? data : Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue;
          const types = Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']];
          if (!types.includes('Product') || entry.url == null) continue;
          if (typeof entry.url !== 'string' || productId(entry.url) !== currentId) return false;
        }
      }
      return true;
    }
    function readProduct(doc, loc) {
      const currentId = productId(loc?.href);
      const heading = firstVisible(doc, '[data-testid="product-details-name"], h1');
      const title = L.text(heading);
      const crumbs = Array.from(doc.querySelectorAll('[aria-label="Breadcrumbs"] a, [aria-label="breadcrumb"] a, [data-testid="breadcrumb"] a')).filter(node => !node.closest('[hidden], [aria-hidden="true"]')).map(L.text);
      const base = { id: currentId, title, crumbs, ingredients: '', labelText: '', advisoryText: '', nutrition: null, label: 'missing' };
      if (!currentId || !title || title.length > 300 || !L.sameCanonical(doc, currentId, productId) || !structuredIdentityMatches(doc, currentId)) return base;
      const label = L.readLabel(doc);
      const advisoryText = [label.advisoryText, family === 'kroger' ? krogerWarnings(doc) : ''].filter(Boolean).join('. ');
      return { ...base, ...label, advisoryText, nutrition: family === 'kroger' ? krogerNutrition(doc) || label.nutrition : label.nutrition };
    }
    function searchTiles(doc) {
      const tiles = [], seen = new Set();
      for (const link of doc.querySelectorAll('a[href]')) {
        const currentId = productId(link.getAttribute('href'));
        if (!currentId || seen.has(currentId) || excluded(link)) continue;
        const candidate = link.closest('[data-testid="product-card"], [data-testid="product-card-container"], [data-testid="product-grid-item"], [data-testid="product-tile"]') || link;
        if (excluded(candidate)) continue;
        if (Array.from(candidate.querySelectorAll('a[href]')).some(other => { const otherId = productId(other.getAttribute('href')); return otherId && otherId !== currentId; })) continue;
        const ownLinks = candidate === link ? [link] : Array.from(candidate.querySelectorAll('a[href]')).filter(other => !excluded(other) && productId(other.getAttribute('href')) === currentId);
        const title = ownLinks.map(other => L.text(firstVisible(other, 'h2, h3, [data-testid="product-title"]'))).find(Boolean)
          || ownLinks.map(L.text).find(Boolean) || ownLinks.map(other => L.clean(other.getAttribute('aria-label'))).find(Boolean)
          || ownLinks.map(other => L.clean(firstVisible(other, 'img[alt]')?.getAttribute('alt'))).find(Boolean);
        if (!title || title.length > 300) continue;
        seen.add(currentId);
        const titleLink = ownLinks.find(other => firstVisible(other, 'h2, h3, [data-testid="product-title"]'))
          || ownLinks.find(other => L.text(other));
        const anchor = titleLink && (firstVisible(titleLink, 'h2, h3, [data-testid="product-title"]') || titleLink) || candidate;
        tiles.push({ id: currentId, title, el: candidate, tile: candidate, anchor,
          badgePlacement: titleLink ? 'inline' : 'corner' });
      }
      return tiles;
    }
    function productUrl(value, loc) {
      const origin = url(loc?.href)?.origin || `https://www.${host}`;
      const path = family === 'kroger' ? `/p/item/${value}` : family === 'albertsons' ? `/shop/pd/product/${value}` : `/store/products/${value}`;
      const result = `${origin}${path}`;
      return productId(result) === String(value) ? result : '';
    }
    return { id, name, matchesHost, productId, productUrl, isProductPage: loc => !!productId(loc?.href), isSearchPage,
      searchQuery: loc => { if (!isSearchPage(loc)) return ''; const u = url(loc.href); return u.searchParams.get('query') || u.searchParams.get('q') || u.searchParams.get('search') || ''; },
      readProduct, labelToggle: L.labelToggle, labelName: family === 'kroger' ? 'Nutrition Information' : 'Ingredients', searchTiles };
  }
  const adapters = Object.fromEntries(configs.map(config => { const adapter = make(config); return [adapter.id, adapter]; }));
  root.AIR.storeAdapters = root.AIR.storeAdapters || {};
  Object.assign(root.AIR.storeAdapters, adapters);
  if (typeof module !== 'undefined' && module.exports) module.exports = adapters;
})(typeof globalThis !== 'undefined' ? globalThis : self);
