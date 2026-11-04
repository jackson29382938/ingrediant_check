// Real DOM and real scoring, with public Walmart pages intercepted locally. No retailer traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const scripts = manifest.content_scripts.find(entry => entry.js.includes('src/content/retailer.js')).js;
const searchOrigin = process.env.WALMART_TEST_ORIGIN || 'https://www.walmart.com';
assert(['https://walmart.com', 'https://www.walmart.com'].includes(searchOrigin));
const card = (id, sponsored = false) => { const price = 10 - Number(id) % 5; return `<div data-item-id="${id}" style="display:block"><a href="/ip/beef/${id}"><img alt="Beef"><span style="position:absolute;width:1px;height:1px;overflow:hidden"><h3>Ground beef ${id}</h3></span></a>
  <span data-automation-id="product-title">Ground beef ${id}, 1 lb</span><span data-testid="unified-global-product-price-a11y-text">Price $${price.toFixed(2)} $${price.toFixed(2)}/lb</span><button>Add to cart</button>${sponsored ? '<span>Sponsored</span>' : ''}</div>`; };
const browser = await chromium.launch({ headless: true, executablePath: process.env.HARNESS_CHROME || undefined });
try {
  const context = await browser.newContext();
  if (searchOrigin === 'https://walmart.com') await context.addInitScript(() => {
    // Model the final URL metadata of Walmart's canonical redirect without allowing
    // Playwright's redirect follow-up to escape our intercepted fixture responses.
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = new URL(response.url);
      if (url.hostname === 'walmart.com' && url.pathname.startsWith('/ip/')) {
        url.hostname = 'www.walmart.com';
        Object.defineProperty(response, 'url', { value: url.href });
      }
      return response;
    };
  });
  const page = await context.newPage(), errors = [], fetched = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/ip/')) {
      const id = url.pathname.split('/').pop(); fetched.push(id);
      return route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': searchOrigin }, body: `<h1>Ground beef ${id}</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { data: {
        product: { usItemId: id, name: `Ground beef ${id}`, category: { path: [{ name: 'Food' }] } },
        idml: { ingredients: { ingredients: { value: id === '40000000' ? '' : id === '10000002' ? 'Beef, sugar, red 40, salt.' : 'Beef.' } } },
      } } } } })}</script>` });
    }
    return route.fulfill({ contentType: 'text/html', body: `<html><body><form><main data-testid="item-stack" role="group">
      <div id="empty-ad-slot" style="height:600px"></div>${card('10000000', true)}${Array.from({ length: 65 }, (_, i) => card(String(10000001 + i))).join('')}
      <section data-testid="sp-search-brand-carousel">${card('20000000')}</section>
      </main></form></body></html>` });
  });
  await page.goto(searchOrigin + '/search?q=ground+beef&facet=fulfillment_method%3ADelivery');
  await page.evaluate(() => {
    const data = { enabled: true, badges: false, autoScoreSearch: false, speedMode: 'fastest' }, listeners = [], pending = [];
    let booted = false;
    window.__boot = () => { booted = true; for (const cb of pending) cb(); };
    window.__settings = values => {
      Object.assign(data, values);
      for (const listener of listeners) listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local');
    };
    window.chrome = { i18n: { getMessage: () => '' },
      runtime: { getManifest: () => ({ version: '1.21.0' }), sendMessage: (_msg, cb) => cb?.(), onMessage: { addListener() {} } },
      storage: { local: {
        get: (keys, cb) => { const result = Object.fromEntries([].concat(keys).map(key => [key, data[key]])); if (cb) { if (booted) cb(result); else pending.push(() => cb(result)); } return Promise.resolve(result); },
        set: values => { Object.assign(data, values); return Promise.resolve(); },
        remove: key => { delete data[key]; return Promise.resolve(); },
      }, onChanged: { addListener: cb => listeners.push(cb) } },
    };
  });
  for (const script of scripts) await page.addScriptTag({ path: path.join(root, script) });
  await page.evaluate(() => window.__boot());
  await page.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length === 65, null, { timeout: 60000 }).catch(async error => {
    console.error({ errors, fetched: fetched.length, badges: await page.locator('.air-badge').allTextContents() });
    throw error;
  });
  assert.equal(await page.locator('[data-item-id="10000000"]').isVisible(), false);
  assert.equal(await page.locator('[data-testid="sp-search-brand-carousel"]').isVisible(), false);
  assert(!fetched.includes('10000000') && !fetched.includes('20000000'), 'sponsored products must not be fetched');
  assert.equal(new Set(fetched).size, 65);
  assert.equal(fetched.length, 65, 'one public read per organic product');
  const score = await page.locator('.air-badge').first().textContent();
  assert(/^\d+$/.test(score));
  assert(await page.locator('.air-badge').first().getAttribute('aria-label'));
  const badgeBox = await page.locator('.air-badge').first().boundingBox();
  assert(badgeBox?.width >= 20 && badgeBox.height >= 20, 'rating must not inherit the overlay heading clipping');
  assert.equal(await page.locator('.air-badge').first().locator('..').getAttribute('data-automation-id'), 'product-title');
  console.log('ok Walmart beef: 65 real scores with global badges/auto-rate off; sponsored cards and modules hidden, never fetched');
  assert.equal(new URL(page.url()).searchParams.get('facet'), 'fulfillment_method:Delivery');
  await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), card('10000001'));
  await page.waitForFunction(() => document.querySelectorAll('[data-item-id="10000001"] .air-badge[data-air-status="scored"]').length === 2);
  assert.equal(fetched.filter(id => id === '10000001').length, 1, 'duplicate result cards share one label read');
  await page.locator('.air-badge').first().focus();
  await page.waitForSelector('#air-retailer-details');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#air-retailer-details', { state: 'detached' });
  console.log('ok delivery filter retained, duplicate cards both rated, keyboard score breakdown opens and closes');
  assert.equal(await page.locator('#empty-ad-slot').isVisible(), false, 'empty ad slot collapses');
  const drawer = page.locator('#air-retailer-sort');
  await drawer.getByRole('button', { name: 'Sort results', exact: true }).click();
  const docked = await page.locator('body').boundingBox(), drawerBox = await drawer.locator('.drawer').boundingBox();
  assert(docked.x + docked.width <= drawerBox.x, 'drawer reserves space; it must not cover the page');
  await drawer.getByRole('button', { name: 'Lowest price', exact: true }).click();
  let prices = await drawer.locator('.item .facts strong').allTextContents();
  let amounts = prices.map(p => Number(p.replace(/[^0-9.]/g, '')));
  assert.deepEqual(amounts, amounts.slice().sort((a, b) => a - b));
  await drawer.getByRole('button', { name: 'Healthiest', exact: true }).click();
  const scores = (await drawer.locator('.item .score').allTextContents()).map(Number);
  assert.deepEqual(scores, scores.slice().sort((a, b) => b - a));
  await drawer.getByRole('button', { name: 'Price per unit: low to high', exact: true }).click();
  // Auto follows the unit the listings state (ground beef is priced per pound); the picker can change it.
  assert((await drawer.locator('.item .facts').first().textContent()).includes('/lb'));
  await drawer.locator('select[data-control="unit"]').selectOption('oz');
  assert((await drawer.locator('.item .facts').first().textContent()).includes('/oz'));
  await drawer.locator('select[data-control="unit"]').selectOption('auto');
  await drawer.locator('input[data-factor="health"]').fill('4');
  await page.keyboard.press('Escape');
  assert.equal(await drawer.locator('.drawer').isVisible(), false);
  assert.equal(await drawer.evaluate(el => el.shadowRoot.activeElement?.className), 'toggle', 'Escape returns focus to the tab');
  assert.equal(await page.locator('html').getAttribute('data-air-sort-docked'), null, 'closing restores full page width');
  console.log('ok right-hand drawer: price, health, normalized unit-price ranking, sliders, Escape; empty ad slot collapsed');


  // Late cards, late sponsorship markers, and recycled React nodes.
  await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), card('30000000', true) + card('30000001'));
  await page.waitForFunction(() => document.querySelector('[data-item-id="30000001"] .air-badge')?.dataset.airStatus === 'scored');
  assert.equal(await page.locator('[data-item-id="30000000"]').isVisible(), false);
  await page.locator('[data-item-id="30000000"] > span:last-child').evaluate(el => el.remove());
  await page.waitForFunction(() => document.querySelector('[data-item-id="30000000"] .air-badge')?.dataset.airStatus === 'scored');
  assert.equal(await page.locator('[data-item-id="30000000"]').isVisible(), true);
  await page.locator('[data-item-id="30000001"]').evaluate(el => el.setAttribute('data-sponsored', 'true'));
  await page.waitForFunction(() => document.querySelector('[data-item-id="30000001"]').style.display === 'none');
  console.log('ok Walmart hydration: new cards rated, late ads hidden, recycled organic cards restored and rated');

  await page.evaluate(() => window.__settings({ enabled: false }));
  await page.waitForFunction(() => !document.querySelector('.air-badge') && !document.querySelector('[data-air-sponsored-hidden]'));
  assert.equal(await page.locator('#air-retailer-sort').count(), 0, 'pause removes the comparison drawer');
  assert.equal(await page.locator('[data-air-compact-grid]').count(), 0, 'pause restores retailer grid styling');
  assert.equal(await page.locator('#empty-ad-slot').isVisible(), true, 'pause restores the original empty slot');
  assert.equal(await page.locator('[data-item-id="10000000"]').evaluate(el => el.style.display), 'block');
  await page.evaluate(() => window.__settings({ enabled: true }));
  await page.waitForFunction(() => document.querySelector('.air-badge[data-air-status="scored"]') && document.querySelector('[data-air-sponsored-hidden]'));
  await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), card('40000000'));
  await page.waitForFunction(() => document.querySelector('[data-item-id="40000000"] .air-badge')?.dataset.airStatus === 'unavailable');
  assert.equal(await page.locator('[data-item-id="40000000"] .air-badge').textContent(), 'Label unavailable');
  assert.deepEqual(errors, []);
  console.log('ok Walmart pause/resume and missing labels: original display restored, behavior resumes, no invented score or page errors');
  await page.evaluate(() => {
    history.pushState({}, '', '/search/?q=ground+beef&facet=fulfillment_method%3APickup');
    document.querySelectorAll('[data-item-id="40000000"]').forEach(el => el.remove());
  });
  await page.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length === 67);
  assert.equal(new URL(page.url()).searchParams.get('facet'), 'fulfillment_method:Pickup');
  await page.evaluate(() => {
    history.pushState({}, '', '/ip/ground-beef/10000001');
    document.body.innerHTML = '<h1>Ground beef</h1><section><h3>Ingredients</h3><p>Beef.</p></section>';
  });
  await page.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored');
  assert.deepEqual(errors, []);
  console.log('ok SPA filter changes and product navigation: badges refresh and real product score panel renders on ' + searchOrigin);
  // A real Walmart layout can leave one organic card in a separate four-column
  // result group. Do not move React nodes across groups: fill the residual slots.
  await page.evaluate(html => {
    history.pushState({}, '', '/search?q=ground+beef');
    document.body.innerHTML = `<main id="residual-stack" data-testid="item-stack" style="width:1100px">${html}</main>`;
  }, card('10000001').replace('display:block', 'display:block;height:560px')
    + card('50000001', true) + card('50000002', true) + card('50000003', true));
  await page.waitForFunction(() => document.querySelectorAll('[data-air-space-filler]').length === 3);
  const fillers = page.locator('[data-air-space-filler]');
  assert.equal(await fillers.locator('.stat').count(), 10, 'ten predefined summaries occupy the residual columns');
  const headings = await fillers.locator('.title').allTextContents();
  assert.equal(new Set(headings).size, 10);
  assert.equal(await fillers.locator('[data-stat="0"] .value').textContent(), '1', 'count only the loaded organic product');
  assert.equal(await fillers.locator('[data-stat="1"] .value').textContent(), '1', 'ratings update from the validated cache');
  assert.equal(await fillers.locator('[data-stat="2"] .value').textContent(), '86/100');
  const row = await page.locator('#residual-stack > [data-item-id="10000001"]').boundingBox();
  for (const filler of await fillers.all()) {
    const box = await filler.boundingBox();
    assert(Math.abs(box.y - row.y) < 2 && box.x >= row.x + row.width, 'summaries fill empty columns without covering the product');
    assert(box.height >= 500, 'summaries occupy the tall residual gap');
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await page.waitForFunction(() => document.querySelectorAll('[data-air-space-filler]').length === 1);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => document.querySelectorAll('[data-air-space-filler]').length === 3);
  await page.locator('#residual-stack').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), card('10000002').replace('display:block', 'display:block;height:560px'));
  await page.waitForFunction(() => document.querySelectorAll('[data-air-space-filler]').length === 2);
  await page.locator('#residual-stack').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html),
    card('10000003').replace('display:block', 'display:block;height:560px') + card('10000004').replace('display:block', 'display:block;height:560px'));
  await page.waitForFunction(() => !document.querySelector('[data-air-space-filler]'));
  await page.evaluate(() => window.__settings({ enabled: false }));
  await page.waitForFunction(() => !document.querySelector('[data-air-space-filler]'));
  assert.equal(await page.locator('[data-item-id="50000001"]').isVisible(), true);
  console.log('ok residual whitespace: three empty columns filled with ten live summaries, product unobstructed, pause restores original page');
  await context.close();
} finally { await browser.close(); }
