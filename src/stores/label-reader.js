// Shared, local-only label reading for retailer previews. No fetches or script execution.
(function(root) {
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const text = el => {
    let value = el && (el.innerText != null ? el.innerText : el.textContent) || '';
    for (const badge of el?.querySelectorAll?.('.air-badge') || []) value = value.replace(badge.textContent || '', '');
    return clean(value);
  };
  const EXCLUDED = 'aside, footer, nav, form, [hidden], [aria-hidden="true"]';
  function excluded(el) {
    if (el && el.closest && el.closest(EXCLUDED)) return true;
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
    return { ingredients, advisoryText: Array.from(new Set(warnings)).join('. '), labelText: ingredients, nutrition: nutrition || null,
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
  root.AIR = root.AIR || {};
  root.AIR.retailerLabels = { clean, text, warningText, readLabel, labelToggle, sameCanonical, searchTiles, department };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.retailerLabels;
})(typeof globalThis !== 'undefined' ? globalThis : self);
