// Shared, local-only label reading for retailer previews. No fetches or script execution.
(function(root) {
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const text = el => clean(el && (el.innerText != null ? el.innerText : el.textContent));
  const LABEL = /^(?:ingredients|nutritional facts|nutrition facts|nutrition information|label info)\s*:?$/i;
  function labelToggle(doc) {
    return Array.from(doc.querySelectorAll('button')).find(el => LABEL.test(text(el))) || null;
  }
  function readLabel(doc) {
    let ingredients = '';
    for (const heading of doc.querySelectorAll('h2, h3, h4, b, strong')) {
      if (!/^ingredients\s*:?$/i.test(text(heading))) continue;
      if (heading.closest && heading.closest('aside, [data-testid="product-recommendations"]')) continue;
      const siblings = Array.from(heading.parentNode && heading.parentNode.children || []);
      const next = siblings[siblings.indexOf(heading) + 1];
      const candidate = next ? text(next) : clean(text(heading.parentNode).slice(text(heading).length));
      if (candidate && !/^(?:nutrition|directions|warnings|allergens|contains)\b/i.test(candidate)) {
        ingredients = candidate.split(/\b(?:nutrition facts|allergens and warnings|directions for use)\s*:/i)[0].trim().slice(0, 6000);
        break;
      }
    }
    const toggle = labelToggle(doc);
    const nutritionSection = doc.querySelector('[data-testid="nutrition-facts"], [data-test="nutrition-facts"], #nutrition-facts');
    const nutrition = nutritionSection && root.AIR.storeAdapters.target.nutritionFacts(nutritionSection);
    return { ingredients, labelText: ingredients, nutrition: nutrition || null,
      label: ingredients ? 'open' : toggle && toggle.getAttribute('aria-expanded') !== 'true' ? 'collapsed' : 'missing' };
  }
  function sameCanonical(doc, id, productId) {
    const canonical = doc.querySelector('link[rel="canonical"]');
    const declared = canonical && productId(canonical.getAttribute('href'));
    return !declared || declared === id;
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
  root.AIR.retailerLabels = { clean, text, readLabel, labelToggle, sameCanonical, searchTiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.retailerLabels;
})(typeof globalThis !== 'undefined' ? globalThis : self);
