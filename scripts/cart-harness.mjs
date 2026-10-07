// Controlled cart DOM and public label fixtures; no authenticated retailer access.
import fs from 'node:fs';
import path from 'node:path';
export async function cartEndToEnd(context, worker, pageErrors, root) {
  const stores = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).content_scripts[3].matches
    .filter(m => m.endsWith('/cart') && m.includes('www.')).map(m => new URL(m).hostname);
  const cases = [...new Set(stores)];   // Amazon's cart has its own markup and its own check (amazonCartEndToEnd)
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
    // The rating sits in the title's link, so a click on it goes where the title goes.
    const product = await page.evaluate(() => document.querySelector('main .air-cart-badge').closest('article').querySelector('a').href);
    await page.locator('main .air-cart-badge').first().click();
    await page.waitForURL(product, { timeout: 10000 });
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('main .air-cart-badge')?.dataset.airStatus === 'scored', null, { timeout: 15000 });
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
  console.log('  ok  carts → 15 retailer stores: cold/cached ratings, a click on a rating opens the product, added/removed rows, mixed food/non-food carts, no quantity/total changes, no cookies/referrer, checkout boundaries');
}

// Amazon's cart, in its real structure (tests/pages/amazon-cart.html and amazon-smart-wagon.html, read from a live cart):
// the active lines are rated on their visible title, the average and points are shown, and nothing else on the page
// (saved for later, the recommendation rail, the carousel, the footer, hidden "was removed" messages) is touched.
export async function amazonCartEndToEnd(context, worker, pageErrors, root) {
  const read = f => fs.readFileSync(path.join(root, 'tests/pages', f), 'utf8');
  const cartHtml = read('amazon-cart.html'), wagonHtml = read('amazon-smart-wagon.html');
  const labels = { B0CARTOAT1: 'organic whole grain rolled oats', B0CARTLONG: 'whole grain oats, sugar, red 40, salt' };
  const requests = [];
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, badges: true, foodOnly: true, autoScoreSearch: true, speedMode: 'balanced', pointsEnabled: true, hoverBreakdown: true }));
  await worker.evaluate(() => chrome.storage.local.remove(['xp', 's:amazon.com:B0CARTOAT1', 's:amazon.com:B0CARTLONG']));
  await context.addCookies([{ name: 'private_cart_test', value: 'do-not-send', domain: 'www.amazon.com', path: '/', secure: true }]);
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(`amazon cart: ${e.message}`));
  await page.route('**/*', r => {
    const req = r.request(), u = new URL(req.url()), id = (u.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
    if (id && req.resourceType() !== 'document') {
      requests.push({ id, cookie: req.headers().cookie, referer: req.headers().referer });
      const title = id === 'B0CARTLONG' ? 'Example Brand Instant Oatmeal Variety Pack' : 'Organic Rolled Oats 42 oz Canister';
      return r.fulfill({ contentType: 'text/html', body: `<h1 id="productTitle">${title}</h1><input id="ASIN" value="${id}"><div id="nic-ingredients-content">${labels[id] || 'whole grain oats'}</div>` });
    }
    if (u.pathname === '/cart/smart-wagon') return r.fulfill({ contentType: 'text/html', body: wagonHtml });
    return r.fulfill({ contentType: 'text/html', body: cartHtml });
  });
  try {
    await page.goto('https://www.amazon.com/gp/cart/view.html?ref_=nav_cart');
    await page.waitForFunction(() => document.querySelectorAll('#sc-active-cart .air-cart-badge[data-air-status="scored"]').length === 2, null, { timeout: 20000 });
    const seen = await page.evaluate(() => {
      const visible = el => el.getClientRects().length > 0;
      return {
        badges: [...document.querySelectorAll('.air-cart-badge')].map(b => ({ product: b.dataset.airProduct, text: b.textContent, shown: visible(b), inHiddenMessage: !!b.closest('.sc-list-item-removed-msg'), inTitle: !!b.closest('.sc-item-product-title-cont') })),
        summary: document.querySelector('.air-cart-summary') && {
          num: document.querySelector('.air-cart-summary').shadowRoot.querySelector('.num').textContent,
          text: document.querySelector('.air-cart-summary').shadowRoot.querySelector('.box').textContent.replace(/\s+/g, ' '),
          afterHeading: document.querySelector('#sc-active-items-header').nextElementSibling === document.querySelector('.air-cart-summary'),
        },
        quantity: document.querySelector('#sc-active-11111111-aaaa').getAttribute('data-quantity'),
      };
    });
    if (seen.badges.length !== 2 || seen.badges.some(b => !b.shown || b.inHiddenMessage || !b.inTitle)) throw new Error(`badges must be two, visible, on the titles: ${JSON.stringify(seen.badges)}`);
    const scores = seen.badges.map(b => Number(b.text));
    const average = Math.round((scores[0] + scores[1]) / 2);
    if (!seen.summary || Number(seen.summary.num) !== average || !/2 of 2 items rated/.test(seen.summary.text) || !seen.summary.afterHeading) {
      throw new Error(`cart average: ${JSON.stringify({ scores, average, summary: seen.summary })}`);
    }
    const badge = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: '*://www.amazon.com/gp/cart/view.html*' });
      return chrome.action.getBadgeText({ tabId: tab.id });
    });
    if (badge !== String(average)) throw new Error(`the toolbar icon should show the cart average ${average}, not "${badge}"`);
    const fetched = [...new Set(requests.map(r => r.id))].sort();
    if (fetched.join() !== 'B0CARTLONG,B0CARTOAT1' || requests.some(r => r.cookie || r.referer)) throw new Error(`cart requests must be the two lines only, with no cookie or referrer: ${JSON.stringify(requests)}`);
    // Points: 20 XP for a score of 90 or more, 10 for 75 or more, once per product.
    const earned = scores.reduce((sum, n) => sum + (n >= 90 ? 20 : n >= 75 ? 10 : 0), 0);
    await page.waitForFunction(() => /Level 1/.test(document.querySelector('.air-cart-summary')?.shadowRoot.querySelector('.box').textContent || ''), null, { timeout: 8000 });
    const stored = await worker.evaluate(() => chrome.storage.local.get('xp'));
    if (stored.xp.total !== earned) throw new Error(`points: expected ${earned}, stored ${JSON.stringify(stored.xp)}`);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#sc-active-cart .air-cart-badge[data-air-status="scored"]').length === 2, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    if ((await worker.evaluate(() => chrome.storage.local.get('xp'))).xp.total !== earned) throw new Error('reopening the cart must not earn the same points again');
    // Untouched: the saved line, the rail, the carousel, the footer.
    const untouched = await page.evaluate(() => ['#sc-saved-cart', '#CardInstanceRAIL', '#anonCarousel1', '#navFooter'].map(sel => document.querySelectorAll(`${sel} .air-cart-badge`).length));
    if (untouched.some(Boolean)) throw new Error(`badges outside the active cart: ${JSON.stringify(untouched)}`);
    await numberBehavesLikeSearch(context, worker, page);
    // Points off: the average stays, the level goes.
    await worker.evaluate(() => chrome.storage.local.set({ pointsEnabled: false }));
    await page.waitForFunction(() => !/Level|XP/.test(document.querySelector('.air-cart-summary')?.shadowRoot.querySelector('.box').textContent || 'x'), null, { timeout: 8000 });
    // The page Amazon opens right after Add to Cart: the mini cart's line is rated on its image; no average there.
    await page.goto('https://www.amazon.com/cart/smart-wagon?newItems=B0CARTOAT1,1&ref_=ewc_gtc');
    await page.waitForFunction(() => document.querySelector('#ewc-content .air-cart-badge')?.dataset.airStatus === 'scored', null, { timeout: 15000 });
    const wagon = await page.evaluate(() => ({ lines: document.querySelectorAll('.air-cart-badge').length, summary: !!document.querySelector('.air-cart-summary'),
      overImage: !!document.querySelector('.ewc-item-image .air-cart-badge') }));
    if (wagon.lines !== 1 || wagon.summary || !wagon.overImage) throw new Error(`mini cart: ${JSON.stringify(wagon)}`);
    // On the mini cart the number sits inside the picture's link, so a click on it is the link's own.
    await page.goto('https://www.amazon.com/cart/smart-wagon?newItems=B0CARTOAT1,1&ref_=ewc_gtc');
    await page.waitForFunction(() => document.querySelector('#ewc-content .air-cart-badge')?.dataset.airStatus === 'scored', null, { timeout: 15000 });
    const picture = await page.evaluate(() => document.querySelector('.ewc-item-image a').href);
    await page.locator('#ewc-content .air-cart-badge').hover();
    await page.waitForSelector('#air-breakdown', { timeout: 5000 });
    await page.locator('#ewc-content .air-cart-badge').click();
    await page.waitForURL(picture, { timeout: 10000 });
    await page.goto('https://www.amazon.com/cart/smart-wagon?newItems=B0CARTOAT1,1&ref_=ewc_gtc');
    await page.waitForFunction(() => document.querySelector('#ewc-content .air-cart-badge')?.dataset.airStatus === 'scored', null, { timeout: 15000 });
    // Checkout is not read.
    await page.evaluate(() => history.pushState({}, '', '/gp/buy/spc/handlers/display.html'));
    await page.waitForFunction(() => !document.querySelector('.air-cart-badge, .air-cart-summary'), null, { timeout: 5000 });
  } catch (e) {
    const details = await page.evaluate(() => ({ url: location.href, badges: [...document.querySelectorAll('.air-cart-badge')].map(b => ({ product: b.dataset.airProduct, status: b.dataset.airStatus, text: b.textContent })) })).catch(() => ({}));
    throw new Error(`Amazon cart: ${e.message} ${JSON.stringify({ details, requests, errors: pageErrors })}`, { cause: e });
  } finally {
    await worker.evaluate(() => chrome.storage.local.set({ pointsEnabled: false }));
    await context.clearCookies({ name: 'private_cart_test' });
    await page.close();
  }
  console.log('  ok  Amazon cart (real markup) → a number shows why on hover and opens the product on click, as on a results page; active lines rated on their titles, average and points shown, saved/rail/carousel/footer untouched, mini cart on the post-Add-to-Cart page, checkout not read');
}

// The number on a cart line does what the number on a search result does: it is a link that shows why it scored on
// hover or focus (card), and a click, Enter or middle click goes where a click on the title goes. Runs on the real
// cart fixture, so the badge is beside the title link, not in it, and the title link opens a new tab (target=_blank).
async function numberBehavesLikeSearch(context, worker, page) {
  const badge = page.locator('#sc-active-11111111-aaaa .air-cart-badge');
  const traits = () => badge.evaluate(b => ({ role: b.getAttribute('role'), tab: b.getAttribute('tabindex'), popup: b.getAttribute('aria-haspopup'),
    air: b.dataset.air, title: b.getAttribute('title'), named: b.getAttribute('aria-label'), cursor: getComputedStyle(b).cursor }));
  const on = await traits();
  if (on.role !== 'link' || on.tab !== '0' || on.popup !== 'dialog' || !/^\d+:\w+$/.test(on.air || '') || on.title !== null || !/^Ingredient Check: \d+\/100/.test(on.named || '') || on.cursor !== 'pointer') {
    throw new Error(`the cart number should be a named, focusable link like a search number: ${JSON.stringify(on)}`);
  }
  // What the card explains from was read and kept on this computer, as for a search tile.
  const kept = (await worker.evaluate(() => chrome.storage.local.get('p:amazon.com:B0CARTOAT1')))['p:amazon.com:B0CARTOAT1'];
  if (!kept || kept.status !== 'ok' || !/rolled oats/i.test(kept.data.text) || !kept.data.via) throw new Error(`the cart kept no reading for the card: ${JSON.stringify(kept)}`);
  // Hover: the card, below the number.
  await badge.hover();
  await page.waitForSelector('#air-breakdown', { timeout: 5000 });
  const where = await page.evaluate(() => ({ badge: document.querySelector('#sc-active-11111111-aaaa .air-cart-badge').getBoundingClientRect().toJSON(), card: document.getElementById('air-breakdown').getBoundingClientRect().toJSON(),
    expanded: document.querySelector('#sc-active-11111111-aaaa .air-cart-badge').getAttribute('aria-expanded') }));
  if (where.expanded !== 'true' || where.card.width < 200 || Math.abs(where.card.top - where.badge.bottom) > 40) throw new Error(`the card should open beside the number: ${JSON.stringify(where)}`);
  // Click: the title link's own address, in the new tab the title opens (its target).
  const href = await page.evaluate(() => document.querySelector('#sc-active-11111111-aaaa a.sc-product-title').href);
  // The new tab is asked for that address. (What the address then answers is not the point: the test server has no such page.)
  const opened = async act => {
    const asked = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { context.off('request', on); reject(new Error(`no new tab asked for ${href}`)); }, 10000);
      const on = r => { if (r.isNavigationRequest() && r.url() === href) { clearTimeout(timer); context.off('request', on); resolve(); } };
      context.on('request', on);
    });
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 10000 }), act()]);
    await asked;
    await popup.close();
    await page.bringToFront();   // a page that is not the focused tab gets no focus events
  };
  await opened(() => badge.click());
  await page.waitForFunction(() => !document.getElementById('air-breakdown'), null, { timeout: 5000 });
  // Keyboard: Tab to the number shows the card; Enter opens the product.
  await badge.evaluate(b => b.blur());   // the click above left it focused
  await badge.focus();
  await page.waitForSelector('#air-breakdown', { timeout: 5000 });
  await opened(() => page.keyboard.press('Enter'));
  await page.keyboard.press('Escape');
  // The same, with "show why on hover" off: a plain named image with the tooltip, and a click still opens the product.
  await worker.evaluate(() => chrome.storage.local.set({ hoverBreakdown: false }));
  try {
    await page.waitForFunction(() => document.querySelector('#sc-active-11111111-aaaa .air-cart-badge')?.getAttribute('role') === 'img', null, { timeout: 8000 });
    const off = await traits();
    if (off.tab !== null || off.popup !== null || !/^Ingredient Check: \d+\/100/.test(off.title || '') || off.cursor !== 'pointer') throw new Error(`with the card off the number is a named image with a tooltip: ${JSON.stringify(off)}`);
    await badge.hover();
    await page.waitForTimeout(500);
    if (await page.locator('#air-breakdown').count()) throw new Error('the card opened with "show why on hover" off');
    await opened(() => badge.click());
  } finally {
    await worker.evaluate(() => chrome.storage.local.set({ hoverBreakdown: true }));
  }
  await page.waitForFunction(() => document.querySelector('#sc-active-11111111-aaaa .air-cart-badge')?.getAttribute('role') === 'link', null, { timeout: 8000 });
}
