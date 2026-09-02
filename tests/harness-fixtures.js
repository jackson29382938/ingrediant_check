// Reproduces the exact Amazon grocery-card structure captured from live amazon.com on 2026-09-02:
// #dietary-shopping-title holds only the heading, the certification pills live in
// #nic-diet-type-logos-wrapper, and the nutrition summary is a table with the VALUES row above
// the LABELS row. Drives the real extract.js / score.js / panel.js against it.
(function () {
  const FIXTURES = {
    oats: { title: "Bob's Red Mill Organic Old Fashioned Rolled Oats, 32oz",
      crumbs: 'Grocery & Gourmet Food › Breakfast Cereal › Oatmeal',
      pills: ['USDA Organic', 'Kosher'], serving: '19.0 servings per container | 0.5 cup',
      nutrition: [['180','0mg','3g','1g','5g'], ['Calories','Sodium','Dietary Fiber','Sugars','Protein']],
      ingredients: 'Organic Whole Grain Oats',
      bullets: ['Organic whole grain rolled oats', 'Non-GMO Project Verified'] },
    flakes: { title: "Kellogg's Frosted Flakes Original Cold Breakfast Cereal 25.2oz",
      crumbs: 'Grocery & Gourmet Food › Breakfast Foods › Cold Cereals',
      pills: ['Kosher'], serving: '1.0 servings per container | 1 container (60g)',
      nutrition: [['220','290mg','1g','21g','3g'], ['Calories','Sodium','Dietary Fiber','Sugars','Protein']],
      ingredients: 'Milled Corn, Sugar, Malt Flavor, Contains 2% Or Less Of Salt. Vitamins And Minerals: Iron (Ferric Phosphate), Niacinamide, Vitamin B6 (Pyridoxine Hydrochloride), Vitamin B2 (Riboflavin), Vitamin B1 (Thiamin Hydrochloride), Folic Acid, Vitamin D3, Vitamin B12.',
      bullets: ['8 vitamins and minerals', 'Fat free'] },
    chips: { title: 'Kettle Brand Sea Salt Potato Chips, 13oz',
      crumbs: 'Grocery & Gourmet Food › Snack Foods › Potato Chips',
      pills: ['Gluten Free'], serving: '13.0 servings per container | 1 oz (28g)',
      nutrition: [['150','110mg','1g','0g','2g'], ['Calories','Sodium','Dietary Fiber','Sugars','Protein']],
      ingredients: 'Potatoes, Safflower Oil, Sea Salt',
      bullets: ['No artificial colors or preservatives'] },
    beef: { title: 'Force of Nature Grass Fed Grass Finished Ground Beef, 14oz',
      crumbs: 'Grocery & Gourmet Food › Meat & Seafood › Beef',
      pills: ['American Grassfed Association Certified', 'USDA Organic'],
      serving: '4.0 servings per container | 4 oz (112g)',
      nutrition: [['200','75mg','0g','0g','19g'], ['Calories','Sodium','Dietary Fiber','Sugars','Protein']],
      ingredients: '100% Grass-Fed Grass-Finished Beef',
      bullets: ['Regeneratively raised', 'No hormones added'] },
    shampoo: { title: 'Head & Shoulders Classic Clean Anti-Dandruff Shampoo, 32.1oz',
      crumbs: 'Beauty & Personal Care › Hair Care › Shampoo', pills: [], serving: '',
      nutrition: null,
      ingredients: 'Water, Sodium Laureth Sulfate, Sodium Lauryl Sulfate, Cocamidopropyl Betaine, Zinc Pyrithione, Fragrance',
      bullets: ['For external use only'] },
    spanish: { title: 'Refresco de Naranja Import 1.5L',
      crumbs: 'Grocery & Gourmet Food › Beverages › Soda',
      pills: [], serving: '6.0 porciones por envase | 250ml', nutrition: null,
      ingredients: 'Agua carbonatada, azucar, acidulante, conservador, saborizante idantico al natural, colorante',
      bullets: ['Producto importado'] },
    none: { title: 'Store Brand Trail Mix, 26oz',
      crumbs: 'Grocery & Gourmet Food › Snack Foods › Trail Mix',
      pills: [], serving: '', nutrition: null,
      ingredients: 'See label for ingredients.', bullets: ['Great for hiking'] },
  };

  const nic = document.getElementById('nic');
  const HOST_ID = 'air-score-panel';

  function paint(key) {
    const f = FIXTURES[key];
    document.getElementById('productTitle').textContent = f.title;
    document.getElementById('wayfinding-breadcrumbs_feature_div').textContent = f.crumbs;
    document.getElementById('feature-bullets').innerHTML =
      '<ul>' + f.bullets.map(b => '<li><span>' + b + '</span></li>').join('') + '</ul>';
    document.getElementById('detailBullets_feature_div').innerHTML =
      '<ul><li><span>UPC ‏ : ‎ 039978049520</span></li><li><span>ASIN ‏ : ‎ B07C9KT113</span></li></ul>';

    let html = '<div id="dietary-shopping-title" class="a-section"><span>Diet type</span></div>';
    html += '<div id="nic-diet-type-logos-wrapper" class="a-section">'
      + f.pills.map(p => '<span class="a-size-base"> ' + p + ' </span>').join('') + '</div><hr>';
    if (f.nutrition) {
      html += '<div id="nic-nutrition-summary-title"><span>Nutrition summary</span></div>'
        + '<div id="nic-nutrition-summary-serving"><span>' + f.serving + '</span></div>'
        + '<table><tbody><tr>' + f.nutrition[0].map(v => '<td><span>' + v + '</span></td>').join('') + '</tr>'
        + '<tr>' + f.nutrition[1].map(v => '<td><span>' + v + '</span></td>').join('') + '</tr></tbody></table>';
    }
    html += '<h3>Ingredients</h3><div id="nic-ingredients-content"><span>' + f.ingredients + '</span></div>';
    nic.innerHTML = html;

    const old = document.getElementById(HOST_ID);
    if (old) old.remove();
    run();
  }

  // Mirrors what content/main.js does on a product page, without the chrome.* plumbing.
  function run() {
    const anchor = document.getElementById('nutritionalInfoAndIngredients_feature_div');
    const host = document.createElement('div');
    host.id = HOST_ID;
    anchor.parentNode.insertBefore(host, anchor);
    const verdict = document.getElementById('verdict');

    const data = AIR.extract.extract(document, { asin: 'B07C9KT113', foodOnly: true });
    if (data.ingestible && !data.ingestible.ok) {
      AIR.panel.mount(host, AIR.panel.renderNotFood(data));
      verdict.textContent = 'gate: NOT FOOD — ' + data.ingestible.reason;
      return;
    }
    if (!data.ok) {
      AIR.panel.mount(host, AIR.panel.renderFailure(data), null,
        text => { const r = AIR.engine.score({ ...data, ingredients_text: text }, {});
          AIR.panel.mount(host, AIR.panel.render(r, { title: data.title, confidence: 1, via: 'manual-paste' })); });
      verdict.textContent = 'extract failed: ' + data.reason;
      return;
    }
    const result = AIR.engine.score({
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: data.text,
    }, {});
    if (typeof result.coverage === 'number' && data.text && result.parsed > 0 && result.coverage < 0.34) {
      AIR.panel.mount(host, AIR.panel.renderFailure({ ...data, lowCoverage: true }), null, () => {});
      verdict.textContent = 'declined: only ' + Math.round(result.coverage * 100) + '% of the list recognised';
      return;
    }
    AIR.panel.mount(host, AIR.panel.render(result, {
      title: data.title, confidence: data.confidence, via: data.via,
    }), done => done(false));
    verdict.textContent = 'via ' + data.via + ' · certifications "' + data.certifications
      + '" · nutrition ' + JSON.stringify(data.nutrition) + ' · coverage '
      + Math.round(result.coverage * 100) + '%';
  }

  document.querySelector('.bar').addEventListener('click', e => {
    const b = e.target.closest('button[data-fx]');
    if (!b) return;
    document.querySelectorAll('.bar button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    paint(b.dataset.fx);
  });
  paint('oats');
})();
