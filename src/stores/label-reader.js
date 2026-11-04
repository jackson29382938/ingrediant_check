// Shared, local-only label reading for retailer previews. No fetches or script execution.
(function(root) {
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const text = el => {
    let value = el && (el.innerText != null ? el.innerText : el.textContent) || '';
    for (const badge of el?.querySelectorAll?.('.air-badge') || []) value = value.replace(badge.textContent || '', '');
    return clean(value);
  };
  // Hidden from sight, not merely from screen readers. aria-hidden on an ancestor is how a signed-out
  // login or location modal marks the whole page behind it, so on a real page an element that is
  // rendered counts as visible whatever its ancestors say. With no layout (saved test pages) the
  // attribute still decides. [hidden] always hides.
  function hiddenFromSight(el) {
    if (!el || typeof el.closest !== 'function') return false;
    if (el.closest('[hidden]')) return true;
    if (!el.closest('[aria-hidden="true"]')) return false;
    const win = el.ownerDocument && el.ownerDocument.defaultView;
    return !(win && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
  }
  function excluded(el) {
    if (el && el.closest && (el.closest('aside, footer, nav, form') || hiddenFromSight(el))) return true;
    for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
      const scope = ['data-testid', 'data-test', 'data-automation-id', 'aria-label'].map(name => node.getAttribute(name) || '').join(' ');
      if (/recommend|related|sponsored|account preferences/i.test(scope)) return true;
    }
    return false;
  }
  const LABEL = /^(?:ingredients|nutritional facts|nutrition facts|nutrition information|label info)\s*:?$/i;
  const WARNING = /^(?:allergens?(?:\s*(?:&|and)\s*warnings?)?|warnings?)\s*:?$/i;
  function labelToggle(doc) {
    return Array.from(doc.querySelectorAll('button, summary, [role="button"]')).find(el => !excluded(el) && LABEL.test(text(el))) || null;
  }
  function afterHeading(heading) {
    const siblings = Array.from(heading.parentNode?.childNodes || []);
    const start = siblings.indexOf(heading);
    if (start < 0) return '';
    const parts = [];
    let stopped = false;
    function collect(node) {
      if (stopped || excluded(node.nodeType === 3 ? node.parentNode : node)) return;
      if (node.nodeType === 3) { parts.push(node.textContent || ''); return; }
      if (node.nodeType !== 1) return;
      const value = text(node);
      if (/^(?:H[1-6]|DT|TH|BUTTON|SUMMARY)$/i.test(node.tagName) ||
        (/^(?:B|STRONG)$/i.test(node.tagName) && (LABEL.test(value) || WARNING.test(value))) ||
        /^(?:serving size|directions(?: for use)?|nutrition facts)\s*:/i.test(value)) { stopped = true; return; }
      const block = /^(?:DIV|P|LI|DD|TD|SECTION|BR)$/i.test(node.tagName);
      if (block) parts.push(' ');
      const children = Array.from(node.childNodes || []);
      if (children.length) children.forEach(collect); else parts.push(value);
      if (block) parts.push(' ');
    }
    siblings.slice(start + 1).forEach(collect);
    return clean(parts.join(''));
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

  function supplementFacts(doc) {
    for (const heading of doc.querySelectorAll('h2, h3, h4, b, strong, caption')) {
      if (excluded(heading) || !/^supplement facts\s*:?$/i.test(text(heading))) continue;
      const value = text(heading.parentNode);
      if (value.length <= 4000 && /\bserving size\b/i.test(value) && /\d/.test(value)) return value;
    }
    return '';
  }
  function readLabel(doc) {
    let ingredients = '';
    const warnings = [];
    for (const heading of doc.querySelectorAll('h2, h3, h4, b, strong, dt, th')) {
      if (excluded(heading)) continue;
      const value = text(heading);
      if (WARNING.test(value)) {
        const marker = /\b(?:(?:this product )?(?:may|can) (?:also )?contain|contains?|(?:made|manufactured|processed|produced|packed) (?:in|on) (?:a |the )?(?:shared |same )?(?:facility|factory|plant|equipment))\b/gi;
        for (const sentence of afterHeading(heading).split(/[.!?;]+/)) {
          const matches = Array.from(sentence.matchAll(marker));
          for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            if (/\b(?:not|never|no)\s*$/i.test(sentence.slice(0, match.index))) continue;
            let end = i + 1 < matches.length ? matches[i + 1].index : sentence.length;
            const negation = /\s*(?:(?:and|but|however)\s+)?(?:(?:does|do|is|are)\s+)?(?:not|never|no)\s*$/i.exec(sentence.slice(match.index, end));
            if (negation) end = match.index + negation.index;
            const statement = clean(sentence.slice(match.index, end)).replace(/[,\s]+$/, '');
            if (/^(?:(?:may|can) (?:also )?)?contains?\s*:?\s*(?:no|none)\b/i.test(statement)) continue;
            if (statement) warnings.push(statement);
          }
        }
      }
      if (ingredients || !/^ingredients\s*:?$/i.test(value)) continue;
      const candidate = afterHeading(heading);
      if (candidate && !/^(?:nutrition|directions|warnings|allergens)\b/i.test(candidate)) {
        const declaration = candidate.split(/\b(?:nutrition facts|allergens and warnings|directions for use)\s*:/i)[0].trim();
        if (declaration.length <= 6000) ingredients = declaration;
      }
    }
    const toggle = labelToggle(doc);
    const nutritionSection = doc.querySelector('[data-testid="nutrition-facts"], [data-test="nutrition-facts"], #nutrition-facts');
    const nutrition = nutritionSection && !excluded(nutritionSection) && root.AIR.storeAdapters?.target?.nutritionFacts(nutritionSection);
    const open = toggle && (toggle.getAttribute('aria-expanded') === 'true' || toggle.closest('details')?.hasAttribute('open'));
    return { ingredients, supplementFacts: supplementFacts(doc), advisoryText: Array.from(new Set(warnings)).join('. '), labelText: ingredients, nutrition: nutrition || null,
      label: ingredients ? 'open' : toggle && !open ? 'collapsed' : 'missing' };
  }
  function department(crumbs) {
    if (!Array.isArray(crumbs)) return '';
    if (crumbs.some(c => /^(?:beauty|hair care|skin care|personal care|bath (?:&|and) body)$/i.test(clean(c)))) return 'Beauty & Personal Care';
    if (crumbs.some(c => /^(?:pets|pet supplies)$/i.test(clean(c)))) return 'Pet Supplies';
    return '';
  }
  function sameCanonical(doc, id, productId) {
    const canonicals = Array.from(doc.querySelectorAll('link[rel="canonical"]'));
    return canonicals.every(canonical => {
      const href = canonical.getAttribute('href');
      return !!id && !!href && productId(href) === id;
    });
  }
  function searchTiles(doc, productId) {
    const out = [], seen = new Set();
    for (const link of doc.querySelectorAll('a[href]')) {
      const id = productId(link.getAttribute('href'));
      if (!id || seen.has(id)) continue;
      const title = text(link.querySelector('h2, h3, [data-automation-id="product-title"]')) || text(link);
      if (!title || title.length > 300) continue;
      seen.add(id);
      out.push({ id, title, tile: link, anchor: link });
    }
    return out;
  }
  // ---------------------------------------------------------------- a result card's facts
  // What a search card says about its product, for the sort panel: the listing price, the text a unit
  // price can be read from, the star rating and review count, and the picture. Everything is read from
  // what the card already shows; nothing is fetched. A value the card does not state stays null, and
  // the panel ranks unknown values last rather than guessing.
  const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/;
  // "Was $4.50", "Reg $4.49", "Save $1" and "$0.18/oz" are not the price to pay for the package.
  const NOT_THE_PRICE = /\b(?:was|reg(?:ular)?\.?|list(?:\s+price)?|save|you\s+save|compare\s+at|msrp)\s*:?\s*\$\s*\d[\d,]*(?:\.\d+)?|\$\s*\d[\d,]*(?:\.\d+)?\s*(?:\/|per\s)\s*[a-z]/gi;
  const RANGE = /\$\s*\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*\$\s*\d/i;
  function firstPrice(value) {
    const shown = clean(value).replace(NOT_THE_PRICE, ' ');
    if (RANGE.test(shown)) return null;          // "$3.99 - $5.99" has no single price to sort on
    const match = shown.match(MONEY);
    const price = match ? Number(match[1].replace(/,/g, '')) : NaN;
    return Number.isFinite(price) && price > 0 && price < 1e5 ? price : null;
  }
  function countFrom(raw) {
    const m = String(raw || '').replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
    if (!m) return null;
    const n = Number(m[1]) * (/k/i.test(m[2] || '') ? 1e3 : /m/i.test(m[2] || '') ? 1e6 : 1);
    return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n) : null;
  }
  // "4.5 out of 5 Stars. 1,234 reviews", "4.5 out of 5 stars with 87 ratings", "(1.2K)".
  function ratingFrom(value) {
    const shown = clean(value);
    const stars = shown.match(/(?<![\d.])([0-5](?:\.\d+)?)\s*(?:out of 5|\/\s*5)\b/i);
    if (!stars) return { ratingValue: null, reviewCount: null };
    const around = shown.slice(stars.index + stars[0].length, stars.index + stars[0].length + 80);
    const reviews = around.match(/(\d[\d,]*(?:\.\d+)?\s*[km]?)\s*(?:reviews?|ratings?)\b/i);
    return { ratingValue: Number(stars[1]), reviewCount: reviews ? countFrom(reviews[1].replace(/\s+/g, '')) : null };
  }
  // The card's own picture, on the retailer's image host only, so nothing foreign is ever drawn.
  function pictureOf(card, host) {
    for (const img of card.querySelectorAll('img')) {
      const src = String(img.currentSrc || img.getAttribute('src') || '');
      try {
        const u = new URL(src);
        if (u.protocol === 'https:' && !u.username && !u.password && host.test(u.hostname)) return u.href;
      } catch (e) { /* data: placeholders and relative paths are not shown */ }
    }
    return '';
  }
  // opts.priceNode: the element that states the price, when the store has one (a screen-reader node
  // carries the exact decimals when the visible price is split into dollars and cents).
  // opts.imageHost: a RegExp the picture's host must satisfy.
  function listingFacts(card, opts = {}) {
    const body = text(card);
    const priced = opts.priceNode ? text(opts.priceNode) : '';
    const labels = Array.from(card.querySelectorAll('[aria-label]')).map(el => el.getAttribute('aria-label') || '').join(' ');
    const rating = ratingFrom(`${labels} ${body}`);
    return {
      listingPrice: firstPrice(priced) ?? firstPrice(body),
      // The unit price may sit in the price node or elsewhere on the card.
      unitText: clean(`${priced} ${body}`).slice(0, 800),
      ...rating,
      image: opts.imageHost ? pictureOf(card, opts.imageHost) : '',
    };
  }

  root.AIR = root.AIR || {};
  root.AIR.retailerLabels = { clean, text, warningText, readLabel, supplementFacts, labelToggle, sameCanonical, searchTiles, department, hiddenFromSight,
    listingFacts, firstPrice, ratingFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.retailerLabels;
})(typeof globalThis !== 'undefined' ? globalThis : self);
