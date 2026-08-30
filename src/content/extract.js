// Ingredient extraction from an Amazon product page.
//
// Four tiers, first hit wins, each carrying a confidence. Every DOM path here was verified against
// live amazon.com in Phase 0 — see PHASE0-FINDINGS.md. The traps that shaped this file:
//
//   * The "Ingredients" heading sits in a COLLAPSED expander. Its content is a SIBLING
//     (.a-expander-content), not an ancestor. Reading the parent returns the literal word
//     "Ingredients" and nothing else.
//   * Card container ids are regenerated per render (CardInstance...) and CSS-module class names
//     carry build hashes (__1KRrO). Neither can be matched exactly.
//   * The live heading has NO colon, and page prose elsewhere contains the word "ingredients", so a
//     naive /Ingredients:/ sweep both misses the real block and matches the wrong one.

(function (root) {
  root.AIR = root.AIR || {};

  const NEXT_SECTION = /^(directions|legal disclaimer|safety information|allergen information|warnings?|storage|nutrition facts|product description)\b/i;
  const MIN_LEN = 4;
  const MAX_LEN = 3000;

  const clean = t => (t || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  const norm = t => clean(t).replace(/\s+/g, ' ');

  // Text that is not an ingredient list must be REJECTED, not scored. The engine's default for
  // unrecognised text is a high score (nothing matches, so nothing is penalised), which meant
  // "See label for ingredients." rendered as 94/100 Excellent and "Product of USA, Keep
  // refrigerated, Best by date on package" as 96/100 NOVA 1. Both were confidently wrong.
  const PLACEHOLDER = /\b(see (the )?(label|package|packaging|product)|refer to (the )?(label|package)|listed on (the )?(label|package)|information (is )?unavailable|not available|varies by|may vary|check (the )?(label|package)|photo|image)\b/i;
  const NON_INGREDIENT = /\b(product of|distributed by|manufactured (by|for)|keep (refrigerated|frozen|cool)|best (by|before)|use by|sell by|store in|net wt|serving size|calories|made in|packed (in|by)|questions\??|call \d|www\.|http)/i;

  function looksLikeIngredients(text) {
    const t = norm(text);
    if (t.length < MIN_LEN || t.length > MAX_LEN) return false;
    if (PLACEHOLDER.test(t)) return false;
    if (/^(ingredients|nutrition facts|directions|legal disclaimer)\s*:?\s*$/i.test(t)) return false;
    if (/\b(we believe|our story|customer|review|shipping|guarantee|click here)\b/i.test(t)) return false;

    const parts = t.split(/[,;]/).map(p => p.trim()).filter(Boolean);
    const commas = parts.length - 1;
    if (commas === 0) {
      // Whole foods are often a single phrase: "Whole Milk", "Organic extra virgin olive oil".
      // Amazon frequently appends a trailing period. Only treat leftover punctuation as prose.
      const core = t.replace(/[.!?]+$/g, '').trim();
      if (!core || /[.!?]/.test(core)) return false;
      const words = core.split(/\s+/).filter(Boolean);
      if (words.length > 12) return false;
      if (NON_INGREDIENT.test(core)) return false;
      if (/\b(this|these|please|available|information|directions|warning|about)\b/i.test(core) && words.length >= 3) {
        return false;
      }
      return true;
    }

    // Comma-density alone is not enough: shipping and storage boilerplate is also comma-dense.
    // Reject when a meaningful share of the entries are logistics rather than food.
    const nonFood = parts.filter(p => NON_INGREDIENT.test(p)).length;
    if (nonFood > 0 && nonFood / parts.length >= 0.34) return false;
    if (parts.every(p => NON_INGREDIENT.test(p) || PLACEHOLDER.test(p))) return false;
    return true;
  }

  // ---- Tier 1: verified stable selectors -------------------------------------------------
  function tier1(doc) {
    const direct = doc.querySelector('#nic-ingredients-content');
    if (direct && looksLikeIngredients(direct.innerText)) {
      return { text: clean(direct.innerText), via: 'nic-ingredients-content', confidence: 0.98 };
    }
    // Scope anchors, used when the exact id is absent but the card is present.
    const scopes = ['#nutritionalInfoAndIngredients_feature_div', '.nicDesktop', '[class*="nicSection"]'];
    for (const sel of scopes) {
      const scope = doc.querySelector(sel);
      if (!scope) continue;
      const found = fromExpander(scope) || fromLabelledSection(scope);
      if (found) return { ...found, via: `scope:${sel}`, confidence: 0.9 };
    }
    return null;
  }

  // ---- Tier 2a: expander-aware heading scan ----------------------------------------------
  // The fix that Phase 0 forced: content is a sibling of the heading's header, inside the
  // shared .a-expander-container.
  function fromExpander(scope) {
    const heads = leafNodesMatching(scope, /^\s*ingredients\s*:?\s*$/i);
    for (const h of heads) {
      const container = h.closest('.a-expander-container');
      if (!container) continue;
      const content = container.querySelector('.a-expander-content');
      if (content && looksLikeIngredients(content.innerText)) {
        return { text: clean(content.innerText) };
      }
    }
    return null;
  }

  // ---- Tier 2b: #important-information labelled section -----------------------------------
  // That block is a series of .content sections, each opening with its own heading.
  function fromLabelledSection(scope) {
    const sections = scope.querySelectorAll('.content, .a-section');
    for (const sec of sections) {
      const head = sec.querySelector('h1,h2,h3,h4,h5,h6,.a-text-bold,b,strong');
      if (!head || !/^\s*ingredients\s*:?\s*$/i.test(head.textContent || '')) continue;
      // Join every block in the section, in document order. Taking only the longest node dropped
      // the tail of any list Amazon split across two <p> elements — and the tail is exactly where
      // the additives live, so a product could read 100/100 while its second paragraph held
      // sucralose, Red 40 and partially hydrogenated oil.
      const blocks = [...sec.querySelectorAll('p, span, div')]
        .filter(el => !el.querySelector('p, span, div'))          // leaf blocks only, no double-count
        .map(p => clean(p.innerText))
        .filter(t => t && !/^\s*ingredients\s*:?\s*$/i.test(t) && !NEXT_SECTION.test(t));
      const seenBlocks = new Set();
      const text = norm(blocks.filter(b => !seenBlocks.has(b) && seenBlocks.add(b)).join(' '));
      if (looksLikeIngredients(text)) return { text };
    }
    return null;
  }

  function tier2(doc) {
    for (const sel of ['#important-information', '#nutritionalInfoAndIngredients_feature_div', 'body']) {
      const scope = doc.querySelector(sel);
      if (!scope) continue;
      const found = fromExpander(scope) || fromLabelledSection(scope);
      if (found) return { ...found, via: `heading-scan:${sel}`, confidence: 0.85 };
    }
    return null;
  }

  // ---- Tier 3: line-aware text sweep ------------------------------------------------------
  // Line breaks are preserved deliberately: "Ingredients" is its own line and carries no colon on
  // the live page, so anchoring on the line boundary is what makes this work at all.
  // Stop at a known next-section heading or end of text — NOT at the first blank line. Consecutive
  // <p> elements render as a blank line in innerText, so the old blank-line terminator cut lists in
  // half whenever Amazon split them across paragraphs.
  const LINE_BLOCK = /(?:^|\n)[ \t]*Ingredients[ \t]*:?[ \t]*\n+([\s\S]{4,2000}?)(?=\n[ \t]*(?:Directions|Legal Disclaimer|Safety Information|Allergen Information|Warnings?|Storage|Nutrition Facts|Product Description|About this item)\b|$)/i;

  function tier3(doc) {
    const regions = ['#important-information', '#productDetails_feature_div', '#detailBullets_feature_div', '#aplus'];
    for (const sel of regions) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const m = (el.innerText || '').match(LINE_BLOCK);
      if (!m) continue;
      // Keep every line up to the first next-section heading, rather than filtering headings out
      // and silently splicing unrelated text together.
      const lines = m[1].split('\n');
      const stop = lines.findIndex(l => NEXT_SECTION.test(l.trim()));
      const body = (stop === -1 ? lines : lines.slice(0, stop)).join(' ');
      if (looksLikeIngredients(body)) {
        return { text: norm(body), via: `line-sweep:${sel}`, confidence: 0.6 };
      }
    }
    return null;
  }

  // ---- Nutrition facts --------------------------------------------------------------------
  // Only used by categories the user has switched on (sodium, saturated fat, total sugar, fibre,
  // protein) — all of which default to off. Returns null rather than zeros when the page publishes
  // no panel, so "no data" is never mistaken for "zero grams".
  const NUTRIENTS = [
    ['sodium',       /\bsodium\b[^0-9]{0,20}([\d.]+)\s*mg/i],
    ['saturatedFat', /\bsaturated fat\b[^0-9]{0,20}([\d.]+)\s*g/i],
    ['transFat',     /\btrans fat\b[^0-9]{0,20}([\d.]+)\s*g/i],
    ['sugar',        /\b(?:total sugars?|sugars?)\b[^0-9]{0,20}([\d.]+)\s*g/i],
    ['addedSugar',   /\badded sugars?\b[^0-9]{0,20}([\d.]+)\s*g/i],
    ['fibre',        /\bdietary fibre?r?\b[^0-9]{0,20}([\d.]+)\s*g/i],
    ['protein',      /\bprotein\b[^0-9]{0,20}([\d.]+)\s*g/i],
    ['calories',     /\bcalories\b[^0-9]{0,20}([\d.]+)/i],
  ];

  function nutritionFacts(doc) {
    const scopes = ['#nic-nutrition-facts-content', '#nutritionalInfoAndIngredients_feature_div',
                    '#important-information'];
    for (const sel of scopes) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const text = clean(el.innerText);
      if (!/\bcalories\b|\bnutrition facts\b|\bserving size\b/i.test(text)) continue;
      const out = {};
      for (const [key, re] of NUTRIENTS) {
        const m = text.match(re);
        if (m) { const v = parseFloat(m[1]); if (isFinite(v)) out[key] = v; }
      }
      const serving = text.match(/serving size[^0-9a-z]{0,10}([^\n]{1,40})/i);
      if (serving) {
        out.servingSize = norm(serving[1]);
        // Serving size is the most gameable number on a label: declare 28g where a competitor
        // declares 55g and every per-serving figure looks better on identical food. Pull the grams
        // out so the engine can compare per 100g instead.
        const grams = out.servingSize.match(/\(?\s*([\d.]+)\s*g\b/i)
          || out.servingSize.match(/([\d.]+)\s*(?:grams?)\b/i);
        if (grams) { const v = parseFloat(grams[1]); if (isFinite(v) && v > 0) out.servingGrams = v; }
      }
      if (Object.keys(out).length >= 2) return out;
    }
    return null;
  }

  // ---- Tier 4 inputs: barcode + identity --------------------------------------------------
  function productIdentity(doc, asinHint) {
    const bullets = doc.querySelector('#detailBullets_feature_div, #productDetails_detailBullets_sections1');
    const bulletText = bullets ? bullets.innerText : '';
    const upc = (bulletText.match(/\b(?:UPC|EAN|GTIN)\b[^\d]{0,12}(\d{8,14})/i) || [])[1] || null;
    // A document fetched for a search tile is NOT this page. Without the hint every hover-scored
    // tile would inherit the ASIN of whatever page the user is currently standing on, and the
    // cache would fill with confidently wrong entries.
    const asin = asinHint
      || (bulletText.match(/\bASIN\b[^A-Z0-9]{0,12}([A-Z0-9]{10})/) || [])[1]
      || (typeof document !== 'undefined' && doc === document
        ? (location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1] : null)
      || null;
    const title = clean(doc.querySelector('#productTitle')?.innerText) || clean(doc.title);
    const brand = clean(doc.querySelector('#bylineInfo')?.innerText).replace(/^(Visit the |Brand: )/, '').replace(/ Store$/, '');
    // Two different qualities of evidence, kept apart on purpose.
    // `certifications` come from Amazon's own dietary/certification widget — structured data.
    // `labels` are seller-written feature bullets, i.e. marketing, and are scored at half weight
    // and labelled unverified. Merging them let "100% GRASS-FED" ad copy bank full points.
    const certifications = [...doc.querySelectorAll('[data-feature-name="dietaryShoppingWidget"] span, #dietary-shopping-title')]
      .map(e => clean(e.innerText)).join(' ');
    const bulletClaims = [...doc.querySelectorAll('#feature-bullets li')]
      .map(e => clean(e.innerText)).join(' ');
    return { asin, upc, title, brand, certifications, labels: bulletClaims, nutrition: nutritionFacts(doc) };
  }

  // ---- helpers ----------------------------------------------------------------------------
  function leafNodesMatching(scope, re) {
    const out = [];
    const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.children.length === 0 && re.test(n.textContent || '')) out.push(n);
      if (out.length > 12) break;
    }
    return out;
  }

  // ---- public ------------------------------------------------------------------------------
  // Second argument is an ASIN string (search-tile fetches) or `{ asin, foodOnly }`.
  // `foodOnly` defaults on: the settings toggle is what turns the gate off, not extract itself.
  function extract(doc = document, asinOrOpts = null) {
    const opts = (asinOrOpts && typeof asinOrOpts === 'object')
      ? asinOrOpts
      : { asin: asinOrOpts };
    const identity = productIdentity(doc, opts.asin || null);
    // Decided before any ingredient parsing: shampoo has an ingredient list and parses cleanly,
    // and a score on a bottle of shampoo implies it was assessed as something you could eat.
    // When the user turns "Only rate food & supplements" off, we still assess so the panel can
    // say why, but we go on to parse and score.
    const gate = (root.AIR.db && root.AIR.db.ingestible)
      ? root.AIR.db.ingestible.assess(doc, { title: identity.title })
      : { ok: true, reason: 'gate unavailable' };
    identity.ingestible = gate;
    if (!gate.ok && opts.foodOnly !== false) return { ok: false, ...identity, reason: 'not-ingestible' };
    for (const tier of [tier1, tier2, tier3]) {
      let hit = null;
      try { hit = tier(doc); } catch (e) { /* a broken tier must never break the page */ }
      if (hit) return { ok: true, ...identity, ...hit };
    }
    // Honest failure. A wrong score is worse than no score.
    return { ok: false, ...identity, reason: identity.upc ? 'no-dom-match-barcode-available' : 'no-dom-match' };
  }

  root.AIR.extract = { extract, looksLikeIngredients, LINE_BLOCK, productIdentity, nutritionFacts };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.extract;
})(typeof globalThis !== 'undefined' ? globalThis : self);
