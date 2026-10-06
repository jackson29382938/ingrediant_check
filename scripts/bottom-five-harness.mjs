// Actual unpacked extension pipeline, with sanitized public page declarations and controlled
// navigation/hydration. Network interception keeps this reproducible; it is not a live-site claim.
import fs from 'node:fs';
import path from 'node:path';

export async function bottomFiveEndToEnd(context, worker, pageErrors, root, selected = ['qfc', 'harristeeter', 'dillons', 'safeway', 'albertsons']) {
  const dir = path.join(root, 'tests/pages/bottom-five');
  const flight = response => `<script type="application/x-fixture">self.__next_f.push(${JSON.stringify([1, '14:' + JSON.stringify(['$', '$L2f', null, { isSSR: true, initialPdpResponse: response }]) + '\n']).replace(/</g, '\\u003c')})</script>`;
  const oatLabel = fs.readFileSync(path.join(root, 'tests/pages/kroger-public-oats.html'), 'utf8');
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoScoreSearch: true, badges: true, foodOnly: true }));
  const pages = [];
  try {
    for (const id of selected) {
      const host = `${{ frys: 'frysfood', smiths: 'smithsfoodanddrug' }[id] || id}.com`, origin = `https://www.${host}`, albertsons = ['safeway', 'albertsons'].includes(id);
      const ids = albertsons ? ['111050071', '960543057'] : ['0003000001020', '0002840051646'];
      const productPaths = albertsons ? ['/shop/pd/rolled-oats/111050071', '/shop/pd/doritos-chips/960543057'] : ['/p/whole-grain-oats/0003000001020', '/p/doritos-nacho-cheese-tortilla-chips/0002840051646'];
      const searchPath = albertsons ? '/shop/search-results.html?q=chips&page=2' : '/search/?query=chips&page=2';
      const declared = albertsons ? ['oats', 'chips'].map(kind => JSON.parse(fs.readFileSync(path.join(dir, `${id}-${kind}.json`), 'utf8'))) : null;
      const productHtml = index => albertsons
        ? `<main><div data-bpn="${ids[index]}"><div class="product-info" style="display:flex"><img alt="Product" width="100" height="100"></div></div></main>${flight(declared[index])}`
        : oatLabel.replace(/Whole Grain Rolled Oats\./g, index ? 'Whole grain rolled oats, sugar, red 40, salt.' : 'Whole Grain Rolled Oats.');
      const card = index => `<div class="ProductCard product-card" data-testid="product-card-${index}" style="display:flex;flex-direction:column;overflow:hidden;width:260px"><a href="${productPaths[index]}?fulfillment=PICKUP" aria-hidden="true"><img alt="" width="120" height="100"></a><div class="product-description"><a style="display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden" href="${productPaths[index]}?fulfillment=PICKUP"><h3>${index ? 'Doritos chips' : 'Whole grain oats'}</h3></a></div><button>Add to cart</button></div>`;
      const initial = `<main id="results" style="display:flex;gap:12px">${card(0)}</main>`;
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => pageErrors.push(`bottom-five ${id}: ${error.message}`));
      let productFetches = 0;
      const requested = [];
      await page.route('**/*', async route => {
        const request = route.request(), u = new URL(request.url());
        const index = productPaths.findIndex((p, i) => u.pathname === p || u.pathname.endsWith('/' + ids[i]));
        let body = initial;
        if (index >= 0) {
          if (request.resourceType() !== 'document') { productFetches++; requested.push(u.href); }
          body = productHtml(index);
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Food product</title></head><body>${body}</body></html>` });
      });
      await worker.evaluate(({ host, ids }) => chrome.storage.local.remove(ids.map(id => `s:${host}:${id}`)), { host, ids });
      await page.goto(origin + searchPath);
      await page.waitForFunction(() => document.querySelector('.air-badge')?.dataset.airStatus === 'scored', null, { timeout: 20000 });
      const geometry = await page.evaluate(() => {
        const badge = document.querySelector('.air-badge'), rect = badge.getBoundingClientRect(), card = badge.closest('.product-card').getBoundingClientRect();
        return { outsideLink: !badge.closest('a,button'), inside: rect.left >= card.left && rect.right <= card.right && rect.bottom <= card.bottom, shadow: !!badge.shadowRoot };
      });
      if (!geometry.outsideLink || !geometry.inside || !geometry.shadow) throw new Error(`${id}: clipped badge or control nesting ${JSON.stringify(geometry)}`);
      if (productFetches !== 1 || !requested[0].includes(productPaths[0] + '?fulfillment=PICKUP')) throw new Error(`${id}: did not fetch the result's actual public URL ${JSON.stringify(requested)}`);
      // Pagination/infinite loading must rate newly inserted cards without a page reload.
      await page.evaluate(html => document.getElementById('results').insertAdjacentHTML('beforeend', html), card(1));
      await page.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length === 2, null, { timeout: 20000 });
      if (productFetches !== 2) throw new Error(`${id}: repeated or missing cold-cache product request (${productFetches})`);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.air-badge')?.dataset.airStatus === 'scored', null, { timeout: 10000 });
      if (productFetches !== 2) throw new Error(`${id}: cached search score unexpectedly refetched`);
      // Change routes within the same document, as the stores' client routers do.
      await page.evaluate(({ url, html }) => { history.pushState({}, '', url); document.body.innerHTML = html; }, { url: origin + productPaths[0], html: productHtml(0) });
      await page.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored', null, { timeout: 20000 });
      const placement = await page.evaluate(() => !document.getElementById('air-score-panel').closest('.product-info, a, button, h1'));
      if (!placement) throw new Error(`${id}: score panel inserted into a title/control/image flex row`);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored', null, { timeout: 10000 });
      // React/hydration can discard an injected sibling while the product declaration is unchanged.
      await page.evaluate(() => document.getElementById('air-score-panel').remove());
      await page.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored', null, { timeout: 4000 });
      // A changed visible label replaces its old score and the product's saved search reading.
      const before = await worker.evaluate(async ({ host, id }) => (await chrome.storage.local.get(`s:${host}:${id}`))[`s:${host}:${id}`]?.score, { host, id: ids[0] });
      await page.evaluate(() => {
        const info = document.querySelector('.product-info');
        if (info) info.insertAdjacentHTML('beforeend', '<section><h3>Ingredients</h3><p>whole grain rolled oats, sugar, red 40, salt</p></section>');
        else [...document.querySelectorAll('h2,h3,h4')].find(el => /^Ingredients:?$/i.test(el.textContent.trim())).nextElementSibling.textContent = 'whole grain rolled oats, sugar, red 40, salt';
      });
      await worker.evaluate(async ({ host, id, before }) => {
        const key = `s:${host}:${id}`;
        for (let n = 0; n < 100; n++) {
          const hit = (await chrome.storage.local.get(key))[key];
          if (hit && hit.score !== before) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`${host}: changed product declaration kept its old score`);
      }, { host, id: ids[0], before });
      await page.evaluate(({ url, html }) => { history.pushState({}, '', url); document.body.innerHTML = html; }, { url: origin + searchPath, html: initial });
      await page.waitForFunction(() => !document.getElementById('air-score-panel') && document.querySelector('.air-badge')?.dataset.airStatus === 'scored', null, { timeout: 10000 });
      // Recycled result nodes must lose the old identity's numeric badge when the new label is absent.
      await worker.evaluate(({ host, id }) => chrome.storage.local.remove(`s:${host}:${id}`), { host, id: '9999999999999' });
      await page.evaluate(pathname => {
        const card = document.querySelector('.product-card');
        for (const link of card.querySelectorAll('a')) link.href = pathname;
        card.querySelector('h3').textContent = 'Fresh food without a published label';
      }, albertsons ? '/shop/pd/fresh-food/9999999999999' : '/p/fresh-food/9999999999999');
      await page.waitForFunction(() => document.querySelector('.air-badge')?.dataset.airStatus === 'unavailable', null, { timeout: 20000 });
      if ((await page.locator('.air-badge').innerText()) !== 'Label unavailable') throw new Error(`${id}: missing label received a numeric score`);
      await page.close();
    }
    console.log(`  ok  ${selected.join(', ')} → product routes, public labels, cold/cached searches, pagination, SPA navigation, changed labels, recycled cards and unclipped badges`);
  } finally {
    await Promise.all(pages.filter(page => !page.isClosed()).map(page => page.close()));
  }
}
