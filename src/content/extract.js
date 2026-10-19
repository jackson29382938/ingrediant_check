// Ingredient extraction from an Amazon product page.
//
// Four tiers, first hit wins, each carrying a confidence. Every DOM path here was verified against
// live amazon.com. The traps that shaped this file:
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

  const NEXT_SECTION = /^(directions|legal disclaimer|safety information|allergen information|warnings?|storage|nutrition facts|product description|ingredientes?|informação nutricional|informaci[oó]n nutricional|n[äa]hrwert|valeurs nutritionnelles|valori nutrizionali|n[äa]ringsv[äa]rde|besin de[gğ]erleri)\b/i;
  // US pages print "Ingredients". EU/LatAm pages print the local heading, and a US-only match
  // used to walk past a perfectly readable list on amazon.de / .es / .fr / .it.
  // Swedish Ingredienser / Turkish İçindekiler were missing; JP 原材料 is already here. Polish labels
  // mostly print "Skład" (composition), not "Składniki".
  // JP/AR stores still decline scoring via coverage + skipped English OCR (see ocrReadyForHost).
  // English headings sellers write in their own description blocks: "Ingredient List", "Ingredients
  // List", "List of Ingredients", "Full Ingredients", "Ingredient Statement", "Ingredients (by weight)".
  const EN_HEADING = '(?:(?:full|complete)\\s+)?ingredients?(?:\\s+(?:list|statement))?(?:\\s*\\([^)\\n]{1,20}\\))?|list of ingredients';
  const INGREDIENT_HEADING = new RegExp('^\\s*(?:' + EN_HEADING + '|ingredientes?|ingredi[eë]nten|ingr[eé]dients?|zutaten|bestandteile|ingredienti|sk[łl]ad(?:niki)?|ingredienser|[iİ][çc]indekiler|原材料)\\s*:?\\s*$', 'i');
  const MIN_LEN = 4;
  // Rejecting rather than truncating is deliberate: the tail of a list is exactly where the
  // additives live, so a truncated list would score clean for the wrong reason. But 3000 was tight
  // enough to reject real products — a variety pack or a composed meal declares every component's
  // own sub-list — and rejecting a readable list is its own failure. Raised, with the recognition
  // coverage gate in score.js now catching the scraped-the-wrong-block case that this guarded.
  const MAX_LEN = 6000;

  const clean = t => (t || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const norm = t => clean(t).replace(/\s+/g, ' ');

  // Text that is not an ingredient list must be REJECTED, not scored. The engine's default for
  // unrecognised text is a high score (nothing matches, so nothing is penalised), which meant
  // "See label for ingredients." rendered as 94/100 Excellent and "Product of USA, Keep
  // refrigerated, Best by date on package" as 96/100 NOVA 1. Both were confidently wrong.
  const PLACEHOLDER = /\b(see (the |each |individual |product )?(label|package|packaging|product)s?|refer to (the )?(label|package)|listed on (the )?(label|package)|information (is )?unavailable|not available|var(?:y|ies) by|may vary|check (the )?(label|package)|see (the )?(nutrition|ingredients?) (panel|facts|label|information)|see (the )?(back|side|bottom) of|photo|image)\b/i;
  const NON_INGREDIENT = /\b(product of|distributed by|manufactured (by|for)|keep (refrigerated|frozen|cool)|best (by|before)|use by|sell by|store in|net wt|serving size|calories|made in|packaged? in|packed (in|by)|questions\??|call \d|www\.|http|may contain|contains traces?|not suitable for|facility that also processes)\b/i;
  const ADVISORY = /\b(may contain|contains traces?|not suitable for|facility that also processes|manufactured in a facility|made in a facility)\b/i;
  const splitAdvisory = text => {
    const lines = String(text || '').split(/(?<=[.!?])\s+(?=[A-Z(*])|;\s*(?=(?:may contain|contains traces?|not suitable for|facility that also processes|manufactured in a facility|made in a facility)\b)|\n+/i);
    return { ingredients: lines.filter(line => !ADVISORY.test(line)).join(' ').trim(), advisory: lines.filter(line => ADVISORY.test(line)).join(' ').trim() };
  };

  // Amazon's ingredients field is sometimes populated with the product NAME plus its pack specs.
  // Verified on live amazon.com: Lifeway Low Fat Kefir (B00LOAW7U6) publishes
  //   "Lifeway Lowfat Kefir, Strawberry, 32 Ounce, 11g Protein, 12 Live Active Cultures"
  // in #nic-ingredients-content. That is comma-dense, mentions a food, and passes every check
  // below, so it parsed as five ingredients and scored 86/100 Good — while the actual label
  // (cultured lowfat milk, strawberry, CANE SUGAR, natural flavor, pectin, vitamin A palmitate)
  // scores 31 Poor. A 55-point error, and the real list exists only in the label photo.
  //
  // Entries that state a size, a count, or a nutrition claim rather than naming an ingredient.
  const SPEC_ENTRY = new RegExp('^(?:'
    + '\\d+(?:\\.\\d+)?\\s*(?:g|mg|kg|oz|fl\\.?\\s*oz|ounces?|lbs?|pounds?|ml|l|liters?|litres?|ct|count|pk|packs?|servings?|pieces?|bars?|bags?|cans?|bottles?)\\b'
    + '|(?:pack|case|box|set) of\\b'
    + '|\\d+\\s*(?:live|active|billion|cfu)\\b'
    + '|\\d+(?:\\.\\d+)?\\s*g\\s+(?:protein|fib(?:er|re)|sugars?|carbs?|fat)\\b'
    + '|net\\s*wt\\b'
    + ')', 'i');

  // A published list is often followed by a sentence that is not ingredients — "Made in a facility
  // that also processes tree nuts.", "Product of Canada.", "Packed in the USA." Splitting on commas
  // alone glued that sentence to the last ingredient, and one logistics part in a two-part list is
  // 50%, over the rejection threshold, so "Peanuts, Salt. Made in a facility…" was refused and the
  // user got a paste box for a list Amazon had published. Logistics sentences are dropped; allergen
  // declarations ("Contains: milk", "May contain…") stay, because they parse as entries and the
  // allergen detector reads them. The first sentence is never dropped on its own.
  const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z(*])/;
  function stripBoilerplate(text) {
    const sentences = norm(text).split(SENTENCE_BREAK);
    if (sentences.length < 2) return norm(text);
    const kept = sentences.filter(s => !NON_INGREDIENT.test(s));
    return (kept.length ? kept : sentences).join(' ');
  }

  // How much of the candidate is just the product name repeated back.
  function echoesTitle(text, title) {
    if (!title) return 0;
    const words = v => String(v).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').split(' ')
      .filter(w => w.length > 2);
    const inTitle = new Set(words(title));
    const candidate = words(text);
    if (candidate.length < 3) return 0;
    return candidate.filter(w => inTitle.has(w)).length / candidate.length;
  }

  // `title` is optional. Without it the spec-density test still applies; with it, a list that is
  // largely the title AND carries spec noise is rejected. Both conditions are required together,
  // because a genuine single-ingredient food legitimately repeats its own title — "Organic Whole
  // Grain Rolled Oats" is both the name and the entire ingredient list, and must still be read.
  function looksLikeIngredients(text, title) {
    const t = stripBoilerplate(text);
    if (t.length < MIN_LEN || t.length > MAX_LEN) return false;
    if (INGREDIENT_HEADING.test(t) || /^(nutrition facts|directions|legal disclaimer)\s*:?\s*$/i.test(t)) return false;
    if (/\b(we believe|our story|customer|review|shipping|guarantee|click here)\b/i.test(t)) return false;

    const parts = t.split(/[,;]/).map(p => p.trim()).filter(Boolean);
    // "See label for ingredients" instead of a list is refused. The same words inside a real list —
    // "Vegetable oil (one or more of: canola, sunflower; may vary), potatoes, salt" — used to refuse
    // the whole list too; they count only when there is no list around them.
    if (PLACEHOLDER.test(t)) {
      const flagged = parts.filter(p => PLACEHOLDER.test(p)).length;
      if (parts.length < 3 || flagged / parts.length >= 0.34) return false;
    }
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

    // Product name and pack specs rather than a recipe.
    const specs = parts.filter(p => SPEC_ENTRY.test(p.trim())).length;
    if (specs / parts.length >= 0.34) return false;          // mostly specs, whatever the title says
    if (specs > 0 && echoesTitle(t, title) >= 0.6) return false;
    return true;
  }

  // ---- Tier 1: verified stable selectors -------------------------------------------------
  function tier1(doc, title) {
    const direct = doc.querySelector('#nic-ingredients-content');
    const visible = el => {
      if (!el || el.hidden || el.getAttribute?.('aria-hidden') === 'true') return false;
      const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
      return !style || (style.display !== 'none' && style.visibility !== 'hidden');
    };
    if (visible(direct)) {
      const split = splitAdvisory(direct.innerText);
      if (looksLikeIngredients(split.ingredients, title)) return { text: stripBoilerplate(split.ingredients), advisoryText: split.advisory, via: 'nic-ingredients-content', confidence: 0.98 };
    }
    // Scope anchors, used when the exact id is absent but the card is present.
    const scopes = ['#nutritionalInfoAndIngredients_feature_div', '[id^="nutritionalInfoAndIngredientsEU_feature_div"]', '.nicDesktop', '[class*="nicSection"]'];
    for (const sel of scopes) {
      const scope = doc.querySelector(sel);
      if (!visible(scope)) continue;
      const found = fromExpander(scope, title) || fromLabelledSection(scope, title);
      if (found) return { ...found, via: `scope:${sel}`, confidence: 0.9 };
    }
    return null;
  }

  // ---- Tier 2a: expander-aware heading scan ----------------------------------------------
  // The fix that Phase 0 forced: content is a sibling of the heading's header, inside the
  // shared .a-expander-container.
  function fromExpander(scope, title) {
    const heads = leafNodesMatching(scope, INGREDIENT_HEADING);
    for (const h of heads) {
      const container = h.closest('.a-expander-container');
      if (!container) continue;
      const content = container.querySelector('.a-expander-content');
      if (content) {
        const split = splitAdvisory(content.innerText);
        if (looksLikeIngredients(split.ingredients, title)) return { text: stripBoilerplate(split.ingredients), advisoryText: split.advisory };
      }
    }
    return null;
  }

  // ---- Tier 2b: #important-information labelled section -----------------------------------
  // That block is a series of .content sections, each opening with its own heading.
  function fromLabelledSection(scope, title) {
    const sections = scope.querySelectorAll('.content, .a-section');
    for (const sec of sections) {
      const head = sec.querySelector('h1,h2,h3,h4,h5,h6,.a-text-bold,b,strong');
      if (!head || !INGREDIENT_HEADING.test(head.textContent || '')) continue;
      // Join every block in the section, in document order. Taking only the longest node dropped
      // the tail of any list Amazon split across two <p> elements — and the tail is exactly where
      // the additives live, so a product could read 100/100 while its second paragraph held
      // sucralose, Red 40 and partially hydrogenated oil.
      const blocks = [];
      let afterHeading = false;
      for (const node of sec.querySelectorAll('h1,h2,h3,h4,h5,h6,.a-text-bold,b,strong,p,span,div')) {
        if (node === head) { afterHeading = true; continue; }
        if (!afterHeading) continue;
        const text = clean(node.innerText);
        // Stop at the next section rather than merely omitting its heading. Otherwise preparation
        // suggestions (e.g. adding sugar) become false ingredients of the product itself.
        if (NEXT_SECTION.test(text) && !INGREDIENT_HEADING.test(text)) break;
        if (!['P', 'SPAN', 'DIV'].includes(node.tagName)
            || !text || INGREDIENT_HEADING.test(text) || node.querySelector('p, span, div')) continue;
        blocks.push(text);
      }
      const seenBlocks = new Set();
      const text = norm(blocks.filter(b => !seenBlocks.has(b) && seenBlocks.add(b)).join(' '));
      const split = splitAdvisory(text);
      if (looksLikeIngredients(split.ingredients, title)) {
        return { text: stripBoilerplate(split.ingredients), advisoryText: split.advisory };
      }
    }
    return null;
  }

  function tier2(doc, title) {
    for (const sel of ['#important-information', '#importantInformation_feature_div', '#nutritionalInfoAndIngredients_feature_div', '[id^="nutritionalInfoAndIngredientsEU_feature_div"]', 'body']) {
      const scope = doc.querySelector(sel);
      if (!scope) continue;
      const found = fromExpander(scope, title) || fromLabelledSection(scope, title);
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
  const LINE_BLOCK = /(?:^|\n)[ \t]*(?:(?:(?:Full|Complete)\s+)?Ingredients?(?:\s+(?:List|Statement))?(?:\s*\([^)\n]{1,20}\))?|List of Ingredients|Ingredientes?|Ingrediënten|Ingrédients|Zutaten|Bestandteile|Ingredienti|Sk[łl]ad(?:niki)?|Ingredienser|[İI]çindekiler|Icindekiler|原材料)[ \t]*:?[ \t]*\n+([\s\S]{4,6000}?)(?=\n[ \t]*(?:Directions|Legal Disclaimer|Safety Information|Allergen Information|Warnings?|Storage|Nutrition Facts|Product Description|About this item|Información nutricional|Nährwert|Valeurs nutritionnelles|Valori nutrizionali|Voedingswaarde|Wartość odżywcza|Näringsvärde|Informação nutricional|Besin değerleri|栄養成分)(?:\b|$)|$)/i;
  // Same-line form used on a lot of detail-bullet pages: "Ingredients: water, sugar, salt".
  const LINE_INLINE = /(?:^|\n)[ \t]*(?:(?:(?:Full|Complete)\s+)?Ingredients?(?:\s+(?:List|Statement))?(?:\s*\([^)\n]{1,20}\))?|List of Ingredients|Ingredientes?|Ingrediënten|Ingrédients|Zutaten|Bestandteile|Ingredienti|Sk[łl]ad(?:niki)?|Ingredienser|[İI]çindekiler|Icindekiler|原材料)\s*:\s*([^\n]{8,6000})/i;

  function tier3(doc, title) {
    const regions = ['#important-information', '#productDetails_feature_div', '#detailBullets_feature_div', '#aplus'];
    for (const sel of regions) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const text = el.innerText || '';
      const m = text.match(LINE_BLOCK);
      if (m) {
        // Keep every line up to the first next-section heading, rather than filtering headings out
        // and silently splicing unrelated text together.
        const lines = m[1].split('\n');
        const stop = lines.findIndex(l => NEXT_SECTION.test(l.trim()));
        const body = (stop === -1 ? lines : lines.slice(0, stop)).join(' ');
        const split = splitAdvisory(body);
        if (looksLikeIngredients(split.ingredients, title)) {
          return { text: stripBoilerplate(split.ingredients), advisoryText: split.advisory, via: `line-sweep:${sel}`, confidence: 0.6 };
        }
      }
      const inline = text.match(LINE_INLINE);
      if (inline && looksLikeIngredients(inline[1], title)) {
        const split = splitAdvisory(inline[1]);
        return { text: stripBoilerplate(split.ingredients), advisoryText: split.advisory, via: `line-inline:${sel}`, confidence: 0.55 };
      }
    }
    // Some listings publish only a placeholder ("See nutrition panel") and name the ingredients in a
    // feature bullet instead: "…made with just three ingredients: potatoes, oil, and salt."
    // ponytail: English "ingredients:" only; add locale headings if other stores need it.
    const bullets = doc.querySelector('#feature-bullets');
    const b = ((bullets && bullets.innerText) || '').match(/\bingredients?\s*:\s*([^\n]{8,600}?)(?:\.(?!\d)|\n|$)/i);
    if (b && looksLikeIngredients(b[1], title)) {
      const split = splitAdvisory(b[1]);
      return { text: stripBoilerplate(split.ingredients), advisoryText: split.advisory, via: 'feature-bullets', confidence: 0.5 };
    }
    return null;
  }

  // ---- Nutrition facts --------------------------------------------------------------------
  // Only used by categories the user has switched on (sodium, saturated fat, total sugar, fibre,
  // protein) — all of which default to off. Returns null rather than zeros when the page publishes
  // no panel, so "no data" is never mistaken for "zero grams".
  // `NUM` accepts a decimal comma as well as a point: every EU store prints "12,5 g", and a
  // point-only pattern silently read nothing there, so the nutrition categories were inert on
  // fifteen of the twenty-one stores. Values go through toNumber(), never parseFloat() directly.
  const NUM = '(\\d+(?:[.,]\\d+)?)';
  // A group of exactly three digits after the separator is thousands, whichever mark: "1,200mg" of
  // sodium on a US label is 1200, not 1.2, and "1.580 kJ" is 1580. Otherwise a comma is a decimal
  // mark ("12,5 g").
  const toNumber = (v, unit = '') => {
    const s = String(v == null ? '' : v);
    // Tiny nutrient amounts such as 0.125g are decimals, not 125g. Treat grouped triples as
    // thousands only for energy or mg, where label conventions use them; grams stay decimal.
    if (!/^0[.,]/.test(s) && /^(?:mg|kcal|kj)$/i.test(unit) && /^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
    return parseFloat(s.replace(',', '.'));
  };
  const NUTRIENTS = [
    ['sodium',       new RegExp('\\b(?:sodium|natrium|sodio|s[oó]dio|s[oó]d|sodyum)\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*mg', 'i')],
    ['saturatedFat', new RegExp('\\b(?:saturated fat|ges[äa]ttigte fetts[äa]uren|acides gras satur[eé]s|grasas saturadas|grassi saturi|gorduras saturadas|verzadigde vetzuren|m[äa]ttat fett|m[äa]ttade fettsyror|nasycone kwasy t[łl]uszczowe|kwasy t[łl]uszczowe nasycone|doymu[şs] ya[ğg])[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g', 'i')],
    ['transFat',     new RegExp('\\btrans fat\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g', 'i')],
    ['sugar',        new RegExp('(?<!added )\\b(?:total sugars?|sugars?|zucker|az[uú]cares?|a[çc][uú]cares|sucres?|zuccheri|suikers?|socker(?:arter)?|cukry)\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g', 'i')],
    // Turkish "Şekerler" starts with a letter `\b` cannot see.
    ['sugar',        new RegExp('(?<![a-zà-ÿ\\u0100-\\u017f])[şs]ekerler?[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g', 'i')],
    // "Includes 10g Added Sugars" puts the number first; the label-first form must not run past the
    // end of the line, or it reads the next row's protein grams as added sugar.
    ['addedSugar',   new RegExp('\\badded sugars?\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g|\\bincludes\\s+' + NUM + '\\s*g\\s+added sugars?', 'i')],
    ['fibre',        new RegExp('\\b(?:dietary fib(?:er|re)|fib(?:er|re)|ballaststoffe|fibra(?:s)?(?: alimentaria| alimentar)?|fibres? alimentaires?|(?:voedings)?vezels?|kostfiber|b[łl]onnik|lif)\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g', 'i')],
    ['carbs', new RegExp('\\b(?:total carbohydrate|carbohydrates?|kohlenhydrate|glucides|hidratos de carbono|carboidrati|koolhydraten|kolhydrater|w[ęe]glowodany|karbonhidrat)\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g', 'i')],
    ['protein',      new RegExp('\\b(?:protein|eiweiss|prot[eé]ines?|prote[ií]nas?|eiwitten|bia[łl]ko)\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM + '\\s*g|eiwei[sß][^0-9a-z]{0,20}' + NUM + '\\s*g', 'i')],
    ['calories',     new RegExp('\\b(?:calories|energie|energ[ií]a|énergie)\\b[^0-9a-zà-ÿ\\u0100-\\u017f\\n]{0,20}' + NUM, 'i')],
  ];

  // Amazon's grocery card renders its nutrition summary as a table with the VALUES row above the
  // LABELS row:
  //     <tr><td>180</td><td>0mg</td><td>3g</td> ...
  //     <tr><td>Calories</td><td>Sodium</td><td>Dietary Fiber</td> ...
  // Every regex below reads label-then-number, so none of them matched and the whole nutrition
  // feature was silently inert on real grocery pages. Verified against live amazon.com.
  const SUMMARY_LABELS = [
    [/^calories$/i, 'calories'], [/^sodium$/i, 'sodium'],
    [/^(dietary )?fib(er|re)$/i, 'fibre'], [/^protein$/i, 'protein'],
    [/^(total )?sugars?$/i, 'sugar'], [/^added sugars?$/i, 'addedSugar'],
    [/^(total )?fat$/i, 'fat'], [/^saturated( fat)?$/i, 'saturatedFat'],
    [/^trans( fat)?$/i, 'transFat'], [/^(total )?carb(ohydrate)?s?$/i, 'carbs'],
  ];
  const PER_100 = /\b(?:per|je|pro|pour|por|para|ogni|in|w)\s+100\s*(?:g|ml)\b|\b100\s*(?:g|ml)['’]?d[ae]\b/i;
  const VALUE_CELL = /^(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|kcal)?$/i;

  function nutritionSummaryTable(doc) {
    let tables;
    try { tables = [...doc.querySelectorAll('#nutritionalInfoAndIngredients_feature_div table, .nicDesktop table')]; }
    catch (e) { return null; }
    // Read each table on its own basis. A per-serving summary cannot fill missing fields in a
    // per-100g Facts table: mixing those amounts invents a nutritional composition.
    const readValue = (key, match) => {
      const value = match && toNumber(match[1], match[2] || (key === 'calories' ? 'kcal' : ''));
      if (!Number.isFinite(value)) return null;
      const unit = (match[2] || '').toLowerCase();
      if (key === 'calories') return !unit || unit === 'kcal' ? value : null;
      if (!['g', 'mg', 'mcg'].includes(unit)) return null;
      return key === 'sodium'
        ? value * (unit === 'g' ? 1000 : unit === 'mcg' ? 0.001 : 1)
        : value * (unit === 'mg' ? 0.001 : unit === 'mcg' ? 0.000001 : 1);
    };
    const readings = [];
    for (const table of tables) {
      const tableText = norm(table.innerText);
      const declaredBasis = tableText.match(PER_100);
      // Two differently based amount columns need column-aware parsing. Decline this table until
      // it is available rather than treating a portion amount as 100g or mixing both columns.
      if (declaredBasis && /\bper (?:serving|portion)\b|amount per serving/i.test(tableText)) continue;
      const basis = declaredBasis ? (/ml/i.test(declaredBasis[0]) ? 'servingMl' : 'servingGrams') : '';
      const detailed = {}, summary = {};
      const rows = [...table.querySelectorAll('tr')];
      for (const row of rows) {
        const cells = [...row.querySelectorAll('td, th')].map(c => clean(c.innerText));
        cells.forEach((cell, index) => {
          // Amazon puts the label and amount in adjacent spans: "Saturated Fat1.5g".
          // Anchoring excludes percent Daily Value cells and the outer nested-table wrapper.
          const combined = cell.match(/^(.+?)(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|kcal)?)$/i);
          const label = combined ? clean(combined[1]) : cell;
          const hit = SUMMARY_LABELS.find(([re]) => re.test(label));
          if (!hit) return;
          const amount = (combined ? combined[2] : cells[index + 1] || '').match(VALUE_CELL);
          const value = readValue(hit[1], amount);
          if (value != null) detailed[hit[1]] = value;
        });
      }
      for (let i = 0; i < rows.length - 1; i++) {
        const values = [...rows[i].querySelectorAll('td, th')].map(c => clean(c.innerText));
        const labels = [...rows[i + 1].querySelectorAll('td, th')].map(c => clean(c.innerText));
        if (values.length < 2 || values.length !== labels.length) continue;
        if (values.filter(v => VALUE_CELL.test(v)).length < 2) continue;
        labels.forEach((label, col) => {
          const hit = SUMMARY_LABELS.find(([re]) => re.test(label));
          if (!hit) return;
          const value = readValue(hit[1], values[col].match(VALUE_CELL));
          if (value != null) summary[hit[1]] = value;
        });
      }
      const nutrients = { ...summary, ...detailed };
      if (Object.keys(nutrients).length >= 2) readings.push({ nutrients, basis, detailed: Object.keys(detailed).length });
    }
    if (!readings.length) return null;
    // Prefer the complete Facts table, then supplement only with tables declaring the same basis.
    const chosen = readings.find(reading => reading.detailed >= 2) || readings[0];
    const combined = {};
    for (const reading of readings) if (reading.basis === chosen.basis) Object.assign(combined, reading.nutrients);
    Object.assign(combined, chosen.nutrients);
    if (chosen.basis) {
      combined[chosen.basis] = 100;
      combined.servingSize = chosen.basis === 'servingMl' ? 'per 100 ml' : 'per 100 g';
    }
    return combined;
  }

  // "19.0 servings per container | 0.5 cup" — Amazon's own serving line, which sits outside the
  // Nutrition Facts prose the regex path reads.
  function servingFromCard(doc) {
    let el;
    try { el = doc.querySelector('#nic-nutrition-summary-serving'); } catch (e) { return null; }
    if (el) return norm(el.innerText);
    // Expanded Facts can contain the only serving declaration, outside Amazon's summary widget.
    try {
      for (const row of doc.querySelectorAll('#nutritionalInfoAndIngredients_feature_div table tr, .nicDesktop table tr')) {
        const cells = [...row.querySelectorAll('td, th')].map(cell => norm(cell.innerText));
        if (/^serving size\s*:?$/i.test(cells[0] || '') && cells[1] && cells[1].length <= 120) return cells[1];
      }
    } catch (e) { /* not every lightweight document implements table selectors */ }
    return null;
  }

  function nutritionFacts(doc) {
    const fromTable = nutritionSummaryTable(doc);
    if (fromTable) {
      if (fromTable.servingGrams === 100 || fromTable.servingMl === 100) return fromTable;
      const serving = servingFromCard(doc);
      if (serving) {
        fromTable.servingSize = serving;
        const measure = serving.match(/\(?\s*(\d+(?:[.,]\d+)?)\s*(?:g|grams?)\b/i)
          || serving.match(/\(?\s*(\d+(?:[.,]\d+)?)\s*(?:ml|milliliters?|millilitres?)\b/i);
        if (measure) { const v = toNumber(measure[1]); if (Number.isFinite(v) && v > 0) fromTable[/(?:ml|millilit)/i.test(measure[0]) ? 'servingMl' : 'servingGrams'] = v; }
      }
      return fromTable;
    }
    const scopes = ['#nic-nutrition-facts-content', '#nutritionalInfoAndIngredients_feature_div',
                    '#important-information'];
    for (const sel of scopes) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const text = clean(el.innerText);
      if (PER_100.test(text) && /\bper (?:serving|portion)\b|amount per serving/i.test(text)) continue;
      if (!/\bcalories\b|\bnutrition facts\b|\bserving size\b|\bn[äa]hrwert|\benergie\b|\bvaleurs nutritionnelles\b|\binformaci[oó]n nutricional\b|\bvalori nutrizionali\b|\bvoedingswaarde|\bn[äa]ringsv[äa]rde|\binforma[çc][ãa]o nutricional\b|\bwarto[śs][ćc] od[żz]ywcza|\bbesin de[ğg]erleri|\bkcal\b/i.test(text)) continue;
      const out = {};
      for (const [key, re] of NUTRIENTS) {
        const m = text.match(re);
        if (!m) continue;
        const v = toNumber(m.slice(1).find(g => g != null && g !== ''), key === 'sodium' ? 'mg' : key === 'calories' ? 'kcal' : 'g');
        if (Number.isFinite(v)) out[key] = v;
      }
      // EU panels give energy as "1580 kJ / 377 kcal": the kilocalories are the calories, not the
      // first number after "Energie".
      const kcal = text.match(new RegExp('(?<![\\d.,])' + NUM + '\\s*kcal\\b', 'i'));
      if (kcal && Number.isFinite(toNumber(kcal[1]))) out.calories = toNumber(kcal[1]);
      // EU panels declare salt, not sodium; by EU definition salt = sodium × 2.5, so 1 g of salt is
      // 400 mg of sodium. Without this the sodium dial never applied on an EU label.
      if (out.sodium == null) {
        const salt = text.match(new RegExp('\\b(?:salt|salz|sel|sale|sal|zout|s[óo]l|tuz)\\b[^0-9\\n]{0,20}' + NUM + '\\s*g\\b', 'i'));
        const grams = salt && toNumber(salt[1]);
        if (Number.isFinite(grams)) out.sodium = Math.round(grams * 400);
      }
      // Stop at the next panel field. An unbounded 40-character window ran straight past the end
      // of the size declaration and into the rows below it, so "Serving size 1 slice Calories 80
      // Total Fat 1g" yielded a ONE GRAM serving — read off the fat line — and every per-100g
      // figure was then multiplied by a hundred.
      const serving = text.match(
        /serving size[^0-9a-z]{0,10}([^\n]{1,60}?)(?=\s*(?:calories|servings?\s+per|amount per|total fat|saturated|trans fat|cholesterol|sodium|total carb|dietary fib|total sugars|protein|nutrition facts|%|$))/i)
        || text.match(/serving size[^0-9a-z]{0,10}([^\n]{1,24})/i);
      if (serving) {
        out.servingSize = norm(serving[1]);
        // Serving size is the most gameable number on a label: declare 28g where a competitor
        // declares 55g and every per-serving figure looks better on identical food. Pull the grams
        // out so the engine can compare per 100g instead.
        const grams = out.servingSize.match(/\(?\s*(\d+(?:[.,]\d+)?)\s*g\b/i)
          || out.servingSize.match(/(\d+(?:[.,]\d+)?)\s*(?:grams?)\b/i);
        // Drinks declare millilitres. Keep volume distinct from mass so the score compares
        // per 100ml without assuming a density of 1 g/ml.
        const millilitres = out.servingSize.match(/\(?\s*(\d+(?:[.,]\d+)?)\s*(?:ml|milliliters?|millilitres?)\b/i);
        const measure = grams || millilitres;
        if (measure) { const v = toNumber(measure[1]); if (Number.isFinite(v) && v > 0) out[grams ? 'servingGrams' : 'servingMl'] = v; }
      }
      // EU and UK panels declare "per 100 g" / "je 100 g" / "pour 100 g" instead of a serving, and
      // their first column is that basis. Saying so lets the engine label the rows per 100g rather
      // than per serving; the numbers are the same either way.
      const basis = text.match(PER_100);
      if (basis) {
        delete out.servingGrams; delete out.servingMl;
        out[/ml/i.test(basis[0]) ? 'servingMl' : 'servingGrams'] = 100;
      }
      if (Object.keys(out).length >= 2) return out;
    }
    return null;
  }

  // ---- Tier 4 inputs: barcode + identity --------------------------------------------------
  function declaredAsin(doc) {
    // A selected variant's own ASIN takes precedence over the parent canonical link.
    const field = doc.querySelector('input#ASIN, input[name="ASIN"]');
    const value = String(field?.value || field?.getAttribute?.('value') || '').trim();
    if (/^[A-Z0-9]{10}$/.test(value)) return value;
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute?.('href') || '';
    return (canonical.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/) || [])[1] || null;
  }

  function publishedAdvisory(doc) {
    const selectors = '#nutritionalInfoAndIngredients_feature_div [id^="nic-allergens-"], '
      + '[id^="nutritionalInfoAndIngredientsEU_feature_div"] [id^="nic-allergens-"], '
      + '.nicDesktop [id^="nic-allergens-"]';
    const warnings = [];
    for (const node of doc.querySelectorAll(selectors)) {
      const text = norm(node.innerText);
      if (text && text.length <= 2000 && ADVISORY.test(text)) warnings.push(text);
    }
    return [...new Set(warnings)].join(' ');
  }

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
    // Verified against live amazon.com: the id that used to be scraped, #dietary-shopping-title,
    // holds only the words "Diet type" — the heading. The certification pills themselves live in a
    // sibling, #nic-diet-type-logos-wrapper, and [data-feature-name="dietaryShoppingWidget"] no
    // longer exists at all. So `certifications` was literally the string "Diet type", and USDA
    // Organic on a certified product was never seen as structured data — only as an unverified
    // title claim, which is the exact distinction the provenance block exists to draw.
    //
    // The pills are read span by span rather than off the wrapper, whose innerText concatenates
    // them ("USDA OrganicKosher").
    const certifications = [...doc.querySelectorAll(
      '#nic-diet-type-logos-wrapper span, .cpf-dpx-attribute-pil span, '
      + '[data-feature-name="dietaryShoppingWidget"] span')]
      .map(e => clean(e.innerText)).filter(Boolean).join(', ');
    const bulletClaims = [...doc.querySelectorAll('#feature-bullets li')]
      .map(e => clean(e.innerText)).join(' ');
    return { asin, upc, title, brand, certifications, labels: bulletClaims, nutrition: nutritionFacts(doc),
      advisoryText: publishedAdvisory(doc) };
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

  // ---- store locale ------------------------------------------------------------------------
  // Headings can be added per store. Scoring + OCR stay English-first. Japanese and Arabic
  // stores are decline-until-ready: English Tesseract will invent a confident wrong list.
  const OCR_NOT_READY = /(?:^|\.)amazon\.(?:co\.jp|ae|sa|pl)$/i;
  function hostOf(hostname) {
    return String(hostname || '').replace(/^www\./i, '').toLowerCase();
  }
  function ocrReadyForHost(hostname) {
    return !OCR_NOT_READY.test(hostOf(hostname));
  }
  function localeStatus(hostname) {
    const host = hostOf(hostname);
    if (/(?:^|\.)amazon\.co\.jp$/.test(host)) {
      return { host, locale: 'ja', ocrReady: false, reason: 'jp-ocr-not-ready' };
    }
    if (/(?:^|\.)amazon\.(?:ae|sa)$/.test(host)) {
      return { host, locale: 'ar', ocrReady: false, reason: 'ar-ocr-not-ready' };
    }
    if (/(?:^|\.)amazon\.pl$/.test(host)) return { host, locale: 'pl', ocrReady: false, reason: 'pl-ocr-not-ready' };
    if (/(?:^|\.)amazon\.com\.mx$/.test(host)) return { host, locale: 'es', ocrReady: true };
    if (/(?:^|\.)amazon\.com\.br$/.test(host)) return { host, locale: 'pt', ocrReady: true };
    if (/(?:^|\.)amazon\.de$/.test(host)) return { host, locale: 'de', ocrReady: true };
    if (/(?:^|\.)amazon\.fr$/.test(host)) return { host, locale: 'fr', ocrReady: true };
    if (/(?:^|\.)amazon\.se$/.test(host)) return { host, locale: 'sv', ocrReady: true };
    if (/(?:^|\.)amazon\.com\.tr$/.test(host)) return { host, locale: 'tr', ocrReady: true };
    return { host, locale: 'en', ocrReady: true };
  }

  // ---- public ------------------------------------------------------------------------------
  // Second argument is an ASIN string (search-tile fetches) or `{ asin, foodOnly }`.
  // `foodOnly` defaults on: the settings toggle is what turns the gate off, not extract itself.
  function extract(doc = document, asinOrOpts = null) {
    const opts = (asinOrOpts && typeof asinOrOpts === 'object')
      ? asinOrOpts
      : { asin: asinOrOpts };
    const declared = declaredAsin(doc);
    if (opts.asin && declared && opts.asin !== declared) {
      // Amazon can redirect to a substitute, or leave the previous product's DOM during soft nav.
      // Never attach its label, barcode or title to the requested product's cache key.
      return { ok: false, asin: opts.asin, reason: 'product-identity-mismatch' };
    }
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
      // The title is passed in so a tier can tell a real list from the product name echoed back.
      try { hit = tier(doc, identity.title); } catch (e) { /* a broken tier must never break the page */ }
      if (hit) return { ok: true, ...identity, ...hit,
        advisoryText: [...new Set([identity.advisoryText, hit.advisoryText].filter(Boolean))].join(' ') };
    }
    // Honest failure. A wrong score is worse than no score.
    return { ok: false, ...identity, reason: identity.upc ? 'no-dom-match-barcode-available' : 'no-dom-match' };
  }

  root.AIR.extract = { extract, looksLikeIngredients, splitAdvisory, stripBoilerplate, echoesTitle, LINE_BLOCK, LINE_INLINE, INGREDIENT_HEADING, productIdentity, declaredAsin, publishedAdvisory, nutritionFacts, nutritionSummaryTable, ocrReadyForHost, localeStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.extract;
})(typeof globalThis !== 'undefined' ? globalThis : self);
