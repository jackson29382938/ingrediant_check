// Target (www.target.com) store adapter: which pages it handles, the product id, what the product
// page says, and where the search results are. Nothing else. It reads the page the visitor already
// has open and makes no requests.
//
// Layout, as rendered for a signed-out visitor on 2026-09-25 (tests/pages/target-*.html):
//   product  /p/<name>/-/A-<TCIN>. Title in h1[data-test="product-title"]; breadcrumbs are
//            [data-test="@web/Breadcrumbs/BreadcrumbLink"]; the list sits in the "Label info"
//            accordion as <h4>Ingredients:</h4> followed by a <div> of text.
//   search   /s?searchTerm=… or /s/<words>. Each result is [data-test="ListingPageProductListing"]
//            with a link to /p/…/-/A-<TCIN> and the title in an h3.
// The "Label info" accordion renders nothing until it is open. Grocery pages opened it by default;
// a shampoo and a supplement page did not. This adapter never opens it: the runner asks the
// visitor to, and reads it once it is there.
// Public product HTML can also carry a declared nutrition_facts object in its hydration data.
// Read only the core product module tied to the requested TCIN, including the matching child
// variant. Search cards still require the rendered page; the adapter itself makes no requests.

(function (root) {
  const LABEL = '[data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"]';
  const TILE = '[data-test="ListingPageProductListing"]';
  const CRUMB = '[data-test="@web/Breadcrumbs/BreadcrumbLink"]';
  const TCIN = /\/-\/A-(\d{6,12})(?=$|[/?#])/;

  const clean = t => String(t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const text = el => {
    let value = el && (el.innerText != null ? el.innerText : el.textContent) || '';
    for (const badge of el?.querySelectorAll?.('.air-badge') || []) value = value.replace(badge.textContent || '', '');
    return clean(value);
  };
  const kids = el => Array.from((el && el.children) || []);
  const hidden = el => !!(el && typeof el.closest === 'function' && el.closest('[hidden], [aria-hidden="true"]'));

  function matchesHost(host) {
    return /^(?:www\.)?target\.com$/i.test(String(host || ''));
  }

  function productId(url) {
    try {
      const u = new URL(String(url), 'https://www.target.com');
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || !matchesHost(u.hostname) || !u.pathname.startsWith('/p/')) return '';
      return (u.pathname.match(TCIN) || [])[1] || '';
    } catch (e) { return ''; }
  }

  const isProductPage = loc => !!productId(loc.href);
  const isSearchPage = loc => matchesHost(loc.hostname) && (loc.pathname === '/s' || loc.pathname.startsWith('/s/'));

  function searchQuery(loc) {
    try {
      const u = new URL(loc.href);
      const q = u.searchParams.get('searchTerm');
      if (q) return clean(q);
      const words = u.pathname.startsWith('/s/') ? u.pathname.slice(3).split('/')[0] : '';
      return clean(decodeURIComponent(words).replace(/\+/g, ' '));
    } catch (e) { return ''; }
  }

  // Read the declaration up to the next label heading. Target can split ingredients across
  // paragraphs or put loose text directly after the heading; neither may drop later ingredients.
  function afterHeading(heading) {
    const parent = heading.parentNode;
    const siblings = Array.from((parent && parent.childNodes) || kids(parent));
    const start = siblings.indexOf(heading);
    if (start < 0) return '';
    const parts = [];
    let stopped = false;
    const boundary = /^(?:ingredients|allergens?(?:\s*(?:&(?:amp;)?|and)\s*warnings?)?|warnings?|nutrition(?:al)? facts|directions(?: for use)?)\s*:?$/i;
    function collect(node) {
      if (stopped || hidden(node)) return;
      if (node.nodeType === 3) { parts.push(node.textContent || ''); return; }
      if (node.nodeType !== 1) return;
      const value = text(node);
      const nutritionName = NUTRIENTS.some(([, re]) => re.test(value));
      if (/^H[1-6]$/.test(node.tagName || '') || /^serving size\s*:/i.test(value) ||
        (/^(?:B|STRONG)$/.test(node.tagName || '') && (boundary.test(value) || nutritionName))) {
        stopped = true;
        return;
      }
      const children = Array.from(node.childNodes || []);
      const block = /^(?:DIV|P|LI|UL|OL|BR|SECTION)$/.test(node.tagName || '');
      if (block) parts.push(' ');
      if (children.length) children.forEach(collect);
      else parts.push(text(node));
      if (block) parts.push(' ');
    }
    siblings.slice(start + 1).forEach(collect);
    const declaration = clean(parts.join('')).split(/(?:allergens?\s*(?:&(?:amp;)?|and)\s*warnings?|nutrition(?:al)? facts|directions(?: for use)?)\s*:/i)[0].trim();
    return declaration.length <= 6000 ? declaration : '';
  }

  function findHeading(section, re) {
    if (!section) return null;
    return Array.from(section.querySelectorAll('h4, h3, b, strong'))
      .find(el => !hidden(el) && re.test(text(el))) || null;
  }

  // Grams per serving and the few numbers the engine can use, read from the rows Target renders as
  // "<b>Sodium</b> 0mg". Missing numbers stay missing.
  const NUTRIENTS = [
    ['sodium', /^sodium$/i, 'mg'], ['saturatedFat', /^saturated fat$/i, 'g'],
    ['sugar', /^(?:total )?sugars$/i, 'g'], ['addedSugar', /^(?:includes )?added sugars?$/i, 'g'],
    ['carbs', /^(?:total )?carbohydrates?$/i, 'g'],
    ['transFat', /^trans fat$/i, 'g'],
    ['fibre', /^dietary fiber$/i, 'g'], ['protein', /^protein$/i, 'g'],
  ];
  function nutritionFacts(section) {
    if (!section || hidden(section)) return null;
    const out = {};
    const conflicts = new Set();
    for (const b of section.querySelectorAll('b')) {
      if (hidden(b)) continue;
      const name = text(b);
      const row = NUTRIENTS.find(([, re]) => re.test(name));
      if (!row) continue;
      // "1,200mg": a thousands comma, which "[\d.]+" stopped at, reading 1 mg of sodium.
      const amount = clean(text(b.parentNode).slice(name.length));
      const m = amount.match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*(mg|g|mcg)\b/i);
      if (!m) continue;
      // A row with more than one quantity may be a per-serving/per-container comparison.
      // Neither column is identified here, so keep this nutrient unknown.
      if (/(?:\d|\.)\d*\s*(?:mg|g|mcg)\b/i.test(amount.slice(m[0].length))) { conflicts.add(row[0]); continue; }
      const v = Number(m[1].replace(/,/g, ''));
      if (!Number.isFinite(v)) continue;
      const units = {g:1000, mg:1, mcg:0.001};
      const value = v * units[m[2].toLowerCase()] / units[row[2]];
      if (out[row[0]] != null && out[row[0]] !== value) conflicts.add(row[0]);
      out[row[0]] = value;
    }
    for (const field of conflicts) delete out[field];
    const sizes = Array.from(section.querySelectorAll('p')).filter(el => !hidden(el)).map(text).filter(t => /^serving size:/i.test(t));
    const measures = sizes.map(size => {
      // Prefer the explicitly printed metric amount. Never infer grams from cups or pieces.
      const metric = size.match(/(?:^|[\s(])(\d+(?:\.\d+)?|\.\d+)\s*(g|grams?|ml|millilit(?:er|re)s?)\b/i);
      if (metric) return { field: /^(?:g|gram)/i.test(metric[2]) ? 'servingGrams' : 'servingMl', value: Number(metric[1]) };
      const ounce = size.match(/(?:^|[\s(])(\d+(?:\.\d+)?|\.\d+)\s*(fl\.?\s*oz|oz|ounces?)\b/i);
      if (ounce) return { field: /^fl/i.test(ounce[2]) ? 'servingMl' : 'servingGrams', value: Number(ounce[1]) * (/^fl/i.test(ounce[2]) ? 29.5735295625 : 28.349523125) };
      return null;
    }).filter(Boolean);
    if (new Set(sizes).size > 1 && measures.length < sizes.length) return null;
    if (measures.length) {
      const first = measures[0];
      // Different serving panels cannot be combined into one reliable nutrition profile.
      if (measures.some(m => m.field !== first.field || Math.abs(m.value - first.value) > 0.001)) return null;
      out[first.field] = first.value;
    }
    return Object.keys(out).length ? out : null;
  }

  // Published allergen declarations and cross-contact statements are warnings, not scored ingredients.
  function advisoryText(section) {
    const heading = findHeading(section, /^(?:allergens?(?:\s*(?:&(?:amp;)?|and)\s*warnings?)?|warnings?)\s*:?$/i);
    if (!heading) return '';
    return warningText(afterHeading(heading));
  }

  function warningText(warning) {
    if (typeof warning !== 'string' || warning.length > 6000) return '';
    const marker = /\b(?:(?:this product )?(?:may|can) (?:also )?contain|(?:may )?contains? traces?|contains?|traces? of|(?:produced|made|manufactured|packed|packaged|processed|prepared|bottled|roasted) (?:in|on|at) (?:a |the |our )?(?:shared |same )?(?:factory|facility|plant|site|premises|equipment|(?:production )?line))\b/gi;
    const statements = [];
    for (const sentence of warning.split(/[.!?;]+/)) {
      const matches = Array.from(sentence.matchAll(marker));
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        if (/\b(?:not|never|no)\s*$/i.test(sentence.slice(0, match.index))) continue;
        let end = i + 1 < matches.length ? matches[i + 1].index : sentence.length;
        // Keep a following negated claim out of this positive warning, too.
        const preceding = sentence.slice(match.index, end);
        const negation = /\s*(?:(?:and|but|however)\s+)?(?:(?:does|do|is|are)\s+)?(?:not|never|no)\s*$/i.exec(preceding);
        if (negation) end = match.index + negation.index;
        const statement = clean(sentence.slice(match.index, end)).replace(/[,\s]+$/, '');
        if (/^(?:(?:may|can) (?:also )?)?contains?\s*:?\s*(?:no|none)\b/i.test(statement)) continue;
        if (statement) statements.push(statement);
      }
    }
    return Array.from(new Set(statements)).join('. ');
  }

  function department(crumbs) {
    if (crumbs.some(c => /^(?:beauty|hair care|skin care|personal care|bath (?:&(?:amp;)?|and) body)$/i.test(c))) return 'Beauty & Personal Care';
    if (crumbs.some(c => /^(?:pets|pet supplies)$/i.test(c))) return 'Pet Supplies';
    return '';
  }

  const models = new WeakMap();
  function pageProduct(doc, id) {
    const node = doc.querySelector('#__NEXT_DATA__');
    const raw = node && node.textContent;
    if (!raw || raw.length > 8 * 1024 * 1024) return null;
    let cached = models.get(doc);
    if (!cached || cached.raw !== raw) {
      try { cached = { raw, data: JSON.parse(raw) }; }
      catch (e) { cached = { raw, data: null }; }
      models.set(doc, cached);
    }
    const queries = cached.data?.props?.dehydratedState?.queries;
    if (!Array.isArray(queries) || queries.length > 256) return null;
    const candidates = [];
    for (const query of queries) {
      if (query.queryKey?.[0] !== 'platform/domain-cdui-orchestrations/fetch-cdui-layout-v1' || String(query.queryKey?.[1]?.tcin) !== id) continue;
      const modules = query.state?.data?.data?.data_source_modules;
      if (!Array.isArray(modules) || modules.length > 256) continue;
      for (const module of modules) {
        if (module.module_type !== 'ProductDetailWebDatasourceCore') continue;
        const product = module.module_data?.data?.product;
        if (!product) continue;
        const variants = [product, ...(Array.isArray(product.children) ? product.children.slice(0, 256) : [])];
        for (const variant of variants) {
          if (String(variant.tcin) !== id) continue;
          const buyUrl = variant.item?.enrichment?.buy_url;
          if (buyUrl && productId(buyUrl) !== id) continue;
          candidates.push(variant);
        }
      }
    }
    if (!candidates.length) return null;
    const facts = candidates.map(p => p.item?.enrichment?.nutrition_facts);
    if (facts.some(f => JSON.stringify(f) !== JSON.stringify(facts[0]))) return null;
    return candidates[0];
  }

  function modelNutrition(facts) {
    const panels = facts?.value_prepared_list;
    if (!Array.isArray(panels) || panels.length !== 1) return null;
    const panel = panels[0];
    if (!Array.isArray(panel.nutrients) || panel.nutrients.length > 100) return null;
    const bold = [];
    for (const nutrient of panel.nutrients) {
      const unit = { g: 'g', grm: 'g', mg: 'mg', mcg: 'mcg' }[nutrient.unit_of_measurement];
      if (!unit || typeof nutrient.quantity !== 'number' || !Number.isFinite(nutrient.quantity) || nutrient.quantity < 0 || typeof nutrient.name !== 'string') continue;
      bold.push({ innerText: nutrient.name, parentNode: { innerText: `${nutrient.name} ${nutrient.quantity}${unit}` } });
    }
    const size = typeof panel.description === 'string' ? panel.description : `${panel.serving_size || ''} ${panel.serving_size_unit_of_measurement || ''}`;
    return nutritionFacts({ querySelectorAll: tag => tag === 'b' ? bold : tag === 'p' ? [{ innerText: `Serving Size: ${size}` }] : [] });
  }

  function productUrl(id, loc) {
    if (!/^\d{6,12}$/.test(String(id))) return '';
    try {
      const url = new URL(loc.href);
      if (url.protocol !== 'https:' || !matchesHost(url.hostname) || url.username || url.password || url.port) return '';
      return `${url.origin}/p/-/A-${id}`;
    } catch (e) { return ''; }
  }

  // -> { id, title, crumbs, label: 'open' | 'collapsed' | 'missing', ingredients, labelText, nutrition }
  function readProduct(doc, loc) {
    const title = text(doc.querySelector('h1[data-test="product-title"]'))
      || clean(String(doc.title || '').replace(/\s*:\s*Target\s*$/i, ''));
    const crumbs = Array.from(doc.querySelectorAll(CRUMB)).map(text).filter(c => c && !/^target$/i.test(c));
    const canonicals = Array.from(doc.querySelectorAll('link[rel="canonical"]'));
    const id = productId(loc ? loc.href : doc.URL);
    if (!id || canonicals.some(c => productId(c.getAttribute('href')) !== id)) return { id, title, crumbs, department: department(crumbs), ingredients: '', advisoryText: '', labelText: '', nutrition: null, label: 'missing' };
    const section = doc.querySelector(LABEL);
    const toggle = section && kids(section).find(el => el.tagName && el.tagName.toLowerCase() === 'button');
    const collapsed = !!toggle && toggle.getAttribute('aria-expanded') === 'false';
    const ingHead = findHeading(section, /^ingredients\s*:?$/i);
    const labelText = section && !hidden(section) ? text(section).slice(0, 4000) : '';
    const model = pageProduct(doc, id);
    const facts = model?.item?.enrichment?.nutrition_facts;
    const declared = typeof facts?.ingredients === 'string' && facts.ingredients.length <= 6000 ? clean(facts.ingredients.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<\/?[a-z][^>]*>/gi, ' ')) : '';
    const visibleIngredients = ingHead ? afterHeading(ingHead) : '';
    const fromModel = !visibleIngredients && !!declared;
    const ingredients = visibleIngredients || declared;
    const nutrition = fromModel ? modelNutrition(facts) : nutritionFacts(section);
    return {
      id: productId(loc ? loc.href : doc.URL),
      title, crumbs, department: department(crumbs), advisoryText: fromModel ? warningText(facts?.warning) : advisoryText(section),
      label: !section || hidden(section) ? 'missing' : collapsed && !ingredients ? 'collapsed' : 'open',
      ingredients, labelText, nutrition,
    };
  }

  // The accordion's own button, for the runner's "open Label info" prompt. Clicked only when the
  // visitor asks the panel to.
  function labelToggle(doc) {
    const section = doc.querySelector(LABEL);
    return section ? kids(section).find(el => el.tagName && el.tagName.toLowerCase() === 'button') || null : null;
  }

  // Detect rendered product titles, including cards whose outer wrapper was renamed. A fallback
  // container must contain only this product; it must never become a search grid or recommendation rail.
  function searchTiles(doc) {
    const out = [];
    const anchors = new Set();
    function productIds(container) {
      return Array.from(new Set(Array.from(container.querySelectorAll('a[href]'))
        .map(a => productId(a.getAttribute('href'))).filter(Boolean)));
    }
    function add(tile, heading) {
      if (!heading || hidden(tile) || hidden(heading) || !text(heading) || anchors.has(heading)) return;
      const titleLink = heading.closest('a');
      const ids = productIds(tile);
      const id = titleLink ? productId(titleLink.getAttribute('href')) : ids.length === 1 ? ids[0] : '';
      if (!id) return;
      anchors.add(heading);
      out.push({ tile, el: tile, id, title: text(heading), anchor: heading });
    }
    for (const tile of doc.querySelectorAll(TILE)) {
      const headings = Array.from(tile.querySelectorAll('h3, h2'));
      const heading = headings.find(h => !hidden(h) && productId(h.closest('a')?.getAttribute('href'))) || headings[0];
      add(tile, heading);
    }
    for (const link of doc.querySelectorAll('a[href]')) {
      const id = productId(link.getAttribute('href'));
      if (!id || hidden(link) || link.closest(TILE)) continue;
      const heading = link.querySelector('h3, h2, [data-test="product-title"]') ||
        (link.getAttribute('data-test') === 'product-title' ? link : null);
      if (!heading || hidden(heading)) continue;
      let tile = link;
      let ancestor = link.parentNode;
      for (let depth = 0; ancestor && ancestor.nodeType === 1 && depth < 3; depth++, ancestor = ancestor.parentNode) {
        if (/^(?:BODY|HTML|MAIN|NAV)$/.test(ancestor.tagName)) break;
        const ids = productIds(ancestor);
        if (ids.length !== 1 || ids[0] !== id) break;
        tile = ancestor;
      }
      add(tile, heading);
    }
    return out;
  }

  const adapter = {
    id: 'target', name: 'Target', matchesHost, productId, isProductPage, isSearchPage, searchQuery,
    readProduct, labelToggle, searchTiles, nutritionFacts, productUrl, LABEL, TILE,
  };
  root.AIR = root.AIR || {};
  root.AIR.storeAdapters = root.AIR.storeAdapters || {};
  root.AIR.storeAdapters.target = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
