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
// Background reading of search results is not offered. Target's server HTML does not carry the
// rendered list (only a JSON blob inside a script), and Target runs bot detection on its pages.

(function (root) {
  const LABEL = '[data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"]';
  const TILE = '[data-test="ListingPageProductListing"]';
  const CRUMB = '[data-test="@web/Breadcrumbs/BreadcrumbLink"]';
  const TCIN = /\/-\/A-(\d{6,12})(?=$|[/?#])/;

  const clean = t => String(t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const text = el => clean(el && (el.innerText != null ? el.innerText : el.textContent));
  const kids = el => Array.from((el && el.children) || []);

  function matchesHost(host) {
    return /^www\.target\.com$/i.test(String(host || ''));
  }

  function productId(url) {
    try {
      const u = new URL(String(url), 'https://www.target.com');
      if (!u.pathname.startsWith('/p/')) return '';
      return (u.pathname.match(TCIN) || [])[1] || '';
    } catch (e) { return ''; }
  }

  const isProductPage = loc => !!productId(loc.href);
  const isSearchPage = loc => loc.pathname === '/s' || loc.pathname.startsWith('/s/');

  function searchQuery(loc) {
    try {
      const u = new URL(loc.href);
      const q = u.searchParams.get('searchTerm');
      if (q) return clean(q);
      const words = u.pathname.startsWith('/s/') ? u.pathname.slice(3).split('/')[0] : '';
      return clean(decodeURIComponent(words).replace(/\+/g, ' '));
    } catch (e) { return ''; }
  }

  // The text right after the "Ingredients:" heading: the heading's next sibling, or loose text in
  // the same parent after it.
  function afterHeading(heading) {
    const parent = heading.parentNode;
    const siblings = kids(parent);
    const next = siblings[siblings.indexOf(heading) + 1];
    if (next) return text(next);
    return clean(text(parent).slice(text(heading).length));
  }

  function findHeading(section, re) {
    if (!section) return null;
    return Array.from(section.querySelectorAll('h4, h3, b, strong'))
      .find(el => re.test(text(el))) || null;
  }

  // Grams per serving and the few numbers the engine can use, read from the rows Target renders as
  // "<b>Sodium</b> 0mg". Missing numbers stay missing.
  const NUTRIENTS = [
    ['sodium', /^sodium$/i, 'mg'], ['saturatedFat', /^saturated fat$/i, 'g'],
    ['sugar', /^(?:total )?sugars$/i, 'g'], ['addedSugar', /^(?:includes )?added sugars?$/i, 'g'],
    ['fibre', /^dietary fiber$/i, 'g'], ['protein', /^protein$/i, 'g'],
  ];
  function nutritionFacts(section) {
    if (!section) return null;
    const out = {};
    for (const b of section.querySelectorAll('b')) {
      const name = text(b);
      const row = NUTRIENTS.find(([, re]) => re.test(name));
      if (!row) continue;
      const m = clean(text(b.parentNode).slice(name.length)).match(/^([\d.]+)\s*(mg|g|mcg)\b/i);
      if (!m) continue;
      const v = Number(m[1]);
      out[row[0]] = row[2] === 'mg' && m[2].toLowerCase() === 'g' ? v * 1000 : v;
    }
    const size = Array.from(section.querySelectorAll('p')).map(text).find(t => /^serving size:/i.test(t)) || '';
    const grams = size.match(/\((\d+(?:\.\d+)?)\s*g\)/i);
    if (grams) out.servingGrams = Number(grams[1]);
    return Object.keys(out).length ? out : null;
  }

  // -> { id, title, crumbs, label: 'open' | 'collapsed' | 'missing', ingredients, labelText, nutrition }
  function readProduct(doc, loc) {
    const title = text(doc.querySelector('h1[data-test="product-title"]'))
      || clean(String(doc.title || '').replace(/\s*:\s*Target\s*$/i, ''));
    const crumbs = Array.from(doc.querySelectorAll(CRUMB)).map(text).filter(c => c && !/^target$/i.test(c));
    const section = doc.querySelector(LABEL);
    const toggle = section && kids(section).find(el => el.tagName && el.tagName.toLowerCase() === 'button');
    const collapsed = !!toggle && toggle.getAttribute('aria-expanded') === 'false';
    const ingHead = findHeading(section, /^ingredients\s*:?$/i);
    const labelText = section ? text(section).slice(0, 4000) : '';
    return {
      id: productId(loc ? loc.href : doc.URL),
      title, crumbs,
      label: !section ? 'missing' : (collapsed && !labelText.replace(/^label info/i, '').trim()) ? 'collapsed' : 'open',
      ingredients: ingHead ? afterHeading(ingHead) : '',
      labelText,
      nutrition: nutritionFacts(section),
    };
  }

  // The accordion's own button, for the runner's "open Label info" prompt. Clicked only when the
  // visitor asks the panel to.
  function labelToggle(doc) {
    const section = doc.querySelector(LABEL);
    return section ? kids(section).find(el => el.tagName && el.tagName.toLowerCase() === 'button') || null : null;
  }

  // -> [{ tile, id, title, anchor }]; anchor is the element the score badge goes into.
  function searchTiles(doc) {
    const out = [];
    for (const tile of doc.querySelectorAll(TILE)) {
      const link = Array.from(tile.querySelectorAll('a')).find(a => productId(a.getAttribute('href')));
      const heading = tile.querySelector('h3');
      const id = link ? productId(link.getAttribute('href')) : '';
      if (!id || !heading) continue;
      out.push({ tile, id, title: text(heading), anchor: heading });
    }
    return out;
  }

  const adapter = {
    id: 'target', name: 'Target', matchesHost, productId, isProductPage, isSearchPage, searchQuery,
    readProduct, labelToggle, searchTiles, LABEL, TILE,
  };
  root.AIR = root.AIR || {};
  root.AIR.storeAdapters = root.AIR.storeAdapters || {};
  root.AIR.storeAdapters.target = adapter;
  if (typeof module !== 'undefined' && module.exports) module.exports = adapter;
})(typeof globalThis !== 'undefined' ? globalThis : self);
