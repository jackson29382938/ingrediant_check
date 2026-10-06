// Controlled cart DOM and public label fixtures; no authenticated retailer access.
import fs from 'node:fs';
import path from 'node:path';
export async function cartEndToEnd(context, worker, pageErrors, root) {
  const stores = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).content_scripts[3].matches
    .filter(m => m.endsWith('/cart') && m.includes('www.')).map(m => new URL(m).hostname);
  const cases = ['www.amazon.com', ...new Set(stores)];
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, badges: true, foodOnly: true, autoScoreSearch: true, speedMode: 'balanced' }));
  const ids = host => host.includes('amazon.') ? ['B000000001', 'B000000002', 'B000000003'] : host.includes('target.') ? ['79364857', '16600402', '11111111'] : host.includes('walmart.') ? ['10314926', '10314927', '10314928'] : host.includes('costco.') ? ['100423971', '100493931', '100493932'] : host.includes('instacart.') ? ['2695935', '22117950', '22117951'] : /safeway|albertsons/.test(host) ? ['111050071', '960543057', '960543058'] : ['0003000001020', '0002840051646', '0002840051647'];
  const route = (host, id) => host.includes('amazon.') ? `/dp/${id}` : host.includes('target.') ? `/p/oats/-/A-${id}` : host.includes('walmart.') ? `/ip/oats/${id}` : host.includes('costco.') ? `/p/-/oats/${id}` : host.includes('instacart.') ? `/products/${id}-oats` : /safeway|albertsons/.test(host) ? `/shop/pd/product/${id}` : `/p/oats/${id}`;
  for (const host of cases) {
    console.log(`  cart checking ${host}`);
    const origin = 'https://' + host, productIds = ids(host), requests = [];
    const card = (id, title = 'Whole grain oats') => `<article ${host.includes('amazon.') ? `class="sc-list-item" data-asin="${id}"` : 'data-testid="cart-item"'} data-product-id="${id}"><a href="${host.includes('amazon.') ? '/Organic-Oats' + route(host, id) + '/ref=cart_title' : route(host, id)}"><h3 style="max-width:260px;white-space:nowrap;overflow:hidden">${title}</h3></a><input aria-label="Quantity" type="number" value="2"><button>Remove</button><span>$5.00</span></article>`;
    const page = await context.newPage();
    page.on('pageerror', e => pageErrors.push(`cart ${host}: ${e.message}`));
    let missing = false;
    await page.route('**/*', r => {
      const req = r.request(), u = new URL(req.url()), product = productIds.find(id => u.pathname.includes(id));
      if (product) {
        if (req.resourceType() !== 'document') requests.push({ url: u.href, cookie: req.headers().cookie, referer: req.headers().referer });
        const title = product === productIds[2] ? 'Hair shampoo' : 'Whole grain oats';
        const label = product === productIds[1] ? 'whole grain oats, sugar, red 40, salt' : 'whole grain rolled oats';
        const declaration = host.includes('amazon.') ? `<input id="ASIN" value="${product}"><div id="nic-ingredients-content">${label}</div>` : host.includes('target.') ? `<section data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><button aria-expanded="true">Label info</button><h4>Ingredients:</h4><div>${label}</div></section>` : `<section><h3>Ingredients</h3><p>${label}</p></section>`;
        return r.fulfill({ contentType: 'text/html', body: `<h1 id="productTitle" data-test="product-title">${title}</h1>${missing ? '' : declaration}` });
      }
      return r.fulfill({ contentType: 'text/html', body: `<h1>Your cart</h1><main data-testid="cart">${card(productIds[0])}</main><aside id="recommendations">${card(productIds[1])}</aside><input aria-label="Delivery address" value="PRIVATE"><div id="total">$10.00</div>` });
    });
    await worker.evaluate(async ({ host, ids }) => chrome.storage.local.remove(ids.map(id => `s:${host.replace('www.', '')}:${id}`)), { host, ids: productIds });
    await context.addCookies([{ name: 'private_cart_test', value: 'do-not-send', domain: host, path: '/', secure: true }]);
    await page.goto(origin + '/cart?cartId=PRIVATE&k=oats');
    try {
      await page.waitForFunction(() => document.querySelector('.air-cart-badge')?.dataset.airStatus === 'scored', null, { timeout: 15000 });
    } catch (e) {
      const details = await page.evaluate(() => ({ badges: [...document.querySelectorAll('.air-cart-badge')].map(b => ({ text: b.textContent, status: b.dataset.airStatus })), title: document.title }));
      throw new Error(`cart cold rating ${host}: ${JSON.stringify({ details, requests, errors: pageErrors })}`, { cause: e });
    }
    if (await page.locator('#recommendations .air-cart-badge').count()) throw new Error(`cart rates recommendations: ${host}`);
    if (!requests.length || requests.some(r => r.cookie || r.referer || r.url.includes('PRIVATE'))) throw new Error(`cart private request data: ${host}`);
    await page.evaluate(html => document.querySelector('main').insertAdjacentHTML('beforeend', html), card(productIds[1]));
    await page.waitForFunction(id => document.querySelector(`[data-product-id="${id}"] .air-cart-badge`)?.dataset.airStatus === 'scored', productIds[1], { timeout: 15000 });
    await page.evaluate(() => { document.querySelector('main article').remove(); document.querySelector('input[aria-label="Quantity"]').value = '7'; });
    await page.waitForFunction(() => document.querySelectorAll('main .air-cart-badge').length === 1);
    const count = requests.length;
    await page.waitForTimeout(500);
    if (requests.length !== count || await page.locator('main input[aria-label="Quantity"]').inputValue() !== '7' || await page.locator('#total').innerText() !== '$10.00') throw new Error(`cart changed or repeated request: ${host}`);
    // Mixed carts must still rate food, while declining shampoo.
    await page.evaluate(html => document.querySelector('main').insertAdjacentHTML('beforeend', html), card(productIds[2], 'Hair shampoo'));
    await page.waitForFunction(id => document.querySelector(`[data-product-id="${id}"] .air-cart-badge`)?.dataset.airStatus === 'not-food', productIds[2], { timeout: 15000 });
    await worker.evaluate(() => chrome.storage.local.set({ autoScoreSearch: false }));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.air-cart-badge')?.dataset.airStatus === 'scored');
    if (requests.length !== count + 1) throw new Error(`cart did not reuse saved scores with automatic rating off: ${host}`);
    missing = true;
    await worker.evaluate(() => chrome.storage.local.set({ autoScoreSearch: true }));
    await worker.evaluate(({ host, id }) => chrome.storage.local.remove(`s:${host.replace('www.', '')}:${id}`), { host, id: productIds[0] });
    await page.waitForFunction(() => document.querySelector('.air-cart-badge')?.dataset.airStatus === 'unavailable', null, { timeout: 15000 });
    // Account/checkout SPA transitions remove ratings rather than extending cart reading.
    await page.evaluate(() => history.pushState({}, '', '/checkout'));
    await page.waitForFunction(() => !document.querySelector('.air-cart-badge'), null, { timeout: 5000 });
    if (host === 'www.target.com') {
      missing = false;
      await page.goto(origin + '/s?searchTerm=oats');
      await page.waitForFunction(() => document.querySelector('main .air-cart-badge')?.dataset.airStatus === 'scored', null, { timeout: 15000 });
      await page.evaluate(() => { document.querySelector('main').hidden = true; });
      await page.waitForFunction(() => !document.querySelector('.air-cart-badge'));
      await page.evaluate(() => { document.querySelector('main').hidden = false; });
      await page.waitForFunction(() => document.querySelector('main .air-cart-badge')?.dataset.airStatus === 'scored');
    }
    await worker.evaluate(() => chrome.storage.local.set({ autoScoreSearch: true }));
    await context.clearCookies({ name: 'private_cart_test' });
    await page.close();
  }
  console.log('  ok  carts → all 16 stores: cold/cached ratings, added/removed rows, mixed food/non-food carts, no quantity/total changes, no cookies/referrer, checkout boundaries');
}
