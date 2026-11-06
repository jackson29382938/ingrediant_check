// Amazon same-day grocery cards in layouts the first fixture does not have. Amazon refuses automated loads of its
// real pages, so these are synthetic (tests/pages/README.md): a card whose title is only a link with classes this
// code has never heard of, and a card that carries its ASIN only as data-csa-c-item-id. Each must get a visible
// score badge and a named row in the sorted list; a carousel card that merely links to a product must get neither.
export async function sameDayLayoutsEndToEnd(context, worker, errors) {
  const before = await worker.evaluate(() => chrome.storage.local.get(null));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`same-day layouts: ${e.message}`));
  const price = '<span class="a-price"><span class="a-offscreen">$7.00</span></span>';
  const shell = cards => `<!doctype html><html lang="en"><head><title>Amazon bacon</title></head><body>
<select id="searchDropdownBox"><option selected>Same-day Grocery</option></select>
<select id="s-result-sort-select"><option value="relevanceblender">Featured</option></select>
<main id="search"><div class="s-main-slot">${cards}</div></main></body></html>`;
  const names = ['Thick Cut Bacon, 12 oz', 'Smoked Bacon, 16 oz', 'Turkey Bacon, 12 oz'];
  const linkCards = names.map((n, i) => `<div class="grid-cell" data-asin="B0000000A${i + 1}"><a class="zz-9" href="/Some-Slug/dp/B0000000A${i + 1}?ref=sr_1_${i}"><span class="qq-1">${n}</span></a>${price}</div>`).join('')
    + '<div class="a-carousel-container"><div data-asin="B0000000C1"><a href="/dp/B0000000C1"><span>Sponsored carousel item name</span></a></div></div>';
  const idCards = names.map((n, i) => `<div class="grid-cell" data-csa-c-item-id="amzn1.asin.1.B0000000B${i + 1}"><a href="/dp/B0000000B${i + 1}"><span class="t">${n}</span></a>${price}</div>`).join('');
  const requested = new Set();
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/s' && u.searchParams.get('k') === 'links') return r.fulfill({ contentType: 'text/html', body: shell(linkCards) });
    if (u.pathname === '/s' && u.searchParams.get('k') === 'itemids') return r.fulfill({ contentType: 'text/html', body: shell(idCards) });
    const asin = (u.pathname.match(/\/dp\/(B0000000[A-C]\d)$/) || [])[1];
    if (asin) {
      requested.add(asin);
      return r.fulfill({ contentType: 'text/html', body: '<h1 id="productTitle">Bacon</h1><div id="wayfinding-breadcrumbs_feature_div">Grocery &amp; Gourmet Food</div><div id="nic-ingredients-content">Pork, water, salt, sugar, sodium phosphate</div>' });
    }
    return r.abort();
  });
  // The list as the worker holds it once it has stopped loading and every row has a score; after 20 s, whatever it holds.
  const sortedList = () => worker.evaluate(async () => {
    const until = Date.now() + 20000;
    let last = null;
    while (Date.now() < until) {
      const s = (await chrome.storage.session.get('sortedResults')).sortedResults;
      if (s && s.items.length) {
        last = { n: s.items.length, titles: s.items.map(i => i.title), asins: s.items.map(i => i.asin), scored: s.items.filter(i => Number.isFinite(i.score)).length, status: s.status, loading: s.loading };
        if (!s.loading && last.scored === last.n) return last;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (last) return last;
    throw new Error('the sorted list never filled');
  });
  try {
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ enabled: true, foodOnly: true, badges: true, unitPrice: true, autoScoreSearch: true, sharedCache: false, sharedProducts: false, ocrLabels: false, useOpenFoodFacts: false, sortLoadMore: false });
      await chrome.storage.local.remove(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1'].flatMap(s => [`s:amazon.com:B0000000${s[0]}${s[1]}`, `p:amazon.com:B0000000${s[0]}${s[1]}`]));
    });
    for (const [key, label, ids] of [['links', 'a title that is only a link with unfamiliar classes', ['B0000000A1', 'B0000000A2', 'B0000000A3']],
      ['itemids', 'an ASIN carried only as data-csa-c-item-id', ['B0000000B1', 'B0000000B2', 'B0000000B3']]]) {
      await page.goto(`https://www.amazon.com/s?k=${key}&i=same-day-grocery&srs=219444219011`);
      await page.waitForFunction(() => document.querySelectorAll('.air-badge[data-air]').length === 3
        && [...document.querySelectorAll('.air-badge')].every(b => /^\d+$/.test(b.textContent.trim())), null, { timeout: 20000 });
      const hidden = await page.evaluate(() => [...document.querySelectorAll('.air-badge')].filter(b => !b.getClientRects().length).length);
      if (hidden) throw new Error(`${label}: ${hidden} badge(s) painted where nobody can see them`);
      for (const id of ids) if (!requested.has(id)) throw new Error(`${label}: ${id} was never rated`);
      await page.selectOption('#s-result-sort-select', 'ingredient-check-score');
      const list = await sortedList();
      if (list.n !== 3 || list.scored !== 3) throw new Error(`${label}: the list held ${list.n} rows, ${list.scored} scored (${list.status})`);
      if (list.titles.some(t => !names.includes(t))) throw new Error(`${label}: rows are not named from the listing (${list.titles.join(' | ')})`);
      if (list.asins.slice().sort().join() !== ids.join()) throw new Error(`${label}: wrong listings ${list.asins}`);
      await worker.evaluate(() => chrome.storage.session.remove('sortedResults'));
      console.log(`  ok same-day layouts → ${label}: three visible score badges and three named, scored rows in the list`);
    }
    if (requested.has('B0000000C1')) throw new Error('A carousel card that only links to a product was rated');
    console.log('  ok same-day layouts → a carousel card that only links to a product is not a listing: no badge, no request');
  } finally {
    for (const view of context.pages()) if (/\/src\/options\/(?:sorted|sidepanel)\.html/.test(view.url())) await view.close();
    await page.close();
    await worker.evaluate(async old => { await chrome.storage.local.clear(); await chrome.storage.local.set(old); }, before);
  }
}
