// Reproduces the exact Amazon grocery-card structure captured from live amazon.com on 2026-09-02:
// #dietary-shopping-title holds only the heading, the certification pills live in
// #nic-diet-type-logos-wrapper, and the nutrition summary is a table with the VALUES row above
// the LABELS row. Drives the real extract.js / score.js / panel.js against it.
(function () {
  // Fixture data lives in harness-fixtures.json so tests/harness.test.js asserts against exactly
  // what this page renders. Loaded async; paint() runs once it arrives.
  let FIXTURES = {};

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
    // Pasted text is scored as-is: the user typed it, so it is the best evidence there is.
    const rescore = text => {
      const r = AIR.engine.score({
        name: data.title, labels: data.labels, certifications: data.certifications,
        nutrition: data.nutrition, ingredients_text: text,
      }, {});
      AIR.panel.mount(host, AIR.panel.render(r, { title: data.title, confidence: 1, via: 'manual-paste' }),
        done => done(false));
      verdict.textContent = 'rescored from pasted text: ' + r.score + ' ' + r.verdict;
    };

    if (!data.ok) {
      AIR.panel.mount(host, AIR.panel.renderFailure(data), null, rescore);
      verdict.textContent = 'extract failed: ' + data.reason;
      return;
    }
    const result = AIR.engine.score({
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: data.text,
    }, {});
    if (typeof result.coverage === 'number' && data.text && result.parsed > 0 && result.coverage < 0.34) {
      // main.js wires the same rescore here, so the harness must too.
      AIR.panel.mount(host, AIR.panel.renderFailure({ ...data, lowCoverage: true }), null, rescore);
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
  fetch('/tests/harness-fixtures.json')
    .then(r => r.json())
    .then(data => { FIXTURES = data; paint('oats'); })
    .catch(e => { document.getElementById('verdict').textContent = 'could not load fixtures: ' + e.message; });
})();
