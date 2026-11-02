// Real DOM and real scoring, with public Walmart pages intercepted locally. No retailer traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const scripts = manifest.content_scripts.find(entry => entry.js.includes('src/content/retailer.js')).js;
const card = (id, sponsored = false) => `<div data-item-id="${id}" style="display:block"><a href="/ip/beef/${id}"><img alt="Beef"></a>
  <span data-automation-id="product-title">Ground beef ${id}</span><button>Add to cart</button>${sponsored ? '<span>Sponsored</span>' : ''}</div>`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.HARNESS_CHROME || undefined });
try {
  const context = await browser.newContext();
  const page = await context.newPage(), errors = [], fetched = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/ip/')) {
      const id = url.pathname.split('/').pop(); fetched.push(id);
      return route.fulfill({ contentType: 'text/html', body: `<h1>Ground beef ${id}</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { data: {
        product: { usItemId: id, name: `Ground beef ${id}`, category: { path: [{ name: 'Food' }] } },
        idml: { ingredients: { ingredients: { value: id === '40000000' ? '' : 'Beef.' } } },
      } } } } })}</script>` });
    }
    return route.fulfill({ contentType: 'text/html', body: `<html><body><form><main data-testid="item-stack" role="group">
      ${card('10000000', true)}${Array.from({ length: 65 }, (_, i) => card(String(10000001 + i))).join('')}
      <section data-testid="sp-search-brand-carousel">${card('20000000')}</section>
      </main></form></body></html>` });
  });
  await page.goto('https://www.walmart.com/search?q=beef');
  await page.evaluate(() => {
    const data = { enabled: true, badges: false, autoScoreSearch: false, speedMode: 'fastest' }, listeners = [], pending = [];
    let booted = false;
    window.__boot = () => { booted = true; for (const cb of pending) cb(); };
    window.__settings = values => {
      Object.assign(data, values);
      for (const listener of listeners) listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local');
    };
    window.chrome = { i18n: { getMessage: () => '' },
      runtime: { getManifest: () => ({ version: '1.20.1' }), sendMessage: (_msg, cb) => cb?.(), onMessage: { addListener() {} } },
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
  console.log('ok Walmart beef: 65 real scores with global badges/auto-rate off; sponsored cards and modules hidden, never fetched');

  // Late cards, late sponsorship markers, and recycled React nodes.
  await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), card('30000000', true) + card('30000001'));
  await page.waitForFunction(() => document.querySelector('[data-item-id="30000001"] .air-badge')?.dataset.airStatus === 'scored');
  assert.equal(await page.locator('[data-item-id="30000000"]').isVisible(), false);
  await page.locator('[data-item-id="30000000"] span:last-child').evaluate(el => el.remove());
  await page.waitForFunction(() => document.querySelector('[data-item-id="30000000"] .air-badge')?.dataset.airStatus === 'scored');
  assert.equal(await page.locator('[data-item-id="30000000"]').isVisible(), true);
  await page.locator('[data-item-id="30000001"]').evaluate(el => el.setAttribute('data-sponsored', 'true'));
  await page.waitForFunction(() => document.querySelector('[data-item-id="30000001"]').style.display === 'none');
  console.log('ok Walmart hydration: new cards rated, late ads hidden, recycled organic cards restored and rated');

  await page.evaluate(() => window.__settings({ enabled: false }));
  await page.waitForFunction(() => !document.querySelector('.air-badge') && !document.querySelector('[data-air-sponsored-hidden]'));
  assert.equal(await page.locator('[data-item-id="10000000"]').evaluate(el => el.style.display), 'block');
  await page.evaluate(() => window.__settings({ enabled: true }));
  await page.waitForFunction(() => document.querySelector('.air-badge[data-air-status="scored"]') && document.querySelector('[data-air-sponsored-hidden]'));
  await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), card('40000000'));
  await page.waitForFunction(() => document.querySelector('[data-item-id="40000000"] .air-badge')?.dataset.airStatus === 'unavailable');
  assert.equal(await page.locator('[data-item-id="40000000"] .air-badge').textContent(), 'Label unavailable');
  assert.deepEqual(errors, []);
  console.log('ok Walmart pause/resume and missing labels: original display restored, behavior resumes, no invented score or page errors');
  await context.close();
} finally { await browser.close(); }
