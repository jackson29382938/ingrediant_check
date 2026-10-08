// Public fixture pages only: hold a label request to prove saved scores remain visible.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const cache = createRequire(import.meta.url)('../src/engine/db/score-cache.js');
export async function recallEndToEnd(context, worker, errors, root) {
  for (const [cart, store] of [[false, 'target'], [true, 'target'], [false, 'amazon'], [true, 'amazon']]) {
    const id = store === 'amazon' ? 'B000000001' : '79364857', key = `s:${store}.com:${id}`, origin = `https://www.${store}.com`;
    const productPath = store === 'amazon' ? `/dp/${id}` : `/p/oats/-/A-${id}`;
    const label = store === 'amazon' ? `<html><body><h1 id="productTitle">Whole grain oats</h1><div id="nic-ingredients-content">Ingredients: whole grain rolled oats</div></body></html>` : fs.readFileSync(path.join(root, 'tests/pages/target-p-oats.html'), 'utf8');
    const badge = cart ? '.air-cart-badge' : '.air-badge', url = origin + (cart ? store === 'amazon' ? '/gp/cart/view.html' : '/cart' : store === 'amazon' ? '/s?k=oats' : '/s?searchTerm=oats');
    const heading = store === 'amazon' ? 'h2' : 'h3';
    const card = `<article ${store === 'amazon' ? `class="sc-list-item" data-asin="${id}"` : cart ? 'data-testid="cart-item"' : ''}><a href="${productPath}"><${heading}>Whole grain oats</${heading}></a></article>`;
    const html = `<html><body><main ${cart && store === 'amazon' ? 'id="sc-active-cart"' : ''}><h1>${cart ? 'Shopping Cart' : 'Oats'}</h1>${card}${card}</main></body></html>`;
    const seed = async (refresh, automatic = true, grace = 7, first = true) => {
      const prefs = await worker.evaluate(() => chrome.storage.local.get(['sheetIndexRev', 'producerIndexRev']));
      const entry = { schema: cache.SCHEMA, store: `${store}.com`, asin: id, v: await worker.evaluate(() => chrome.runtime.getManifest().version),
        prefs: cache.fingerprint({ ...prefs, weights: {}, foodOnly: true }), source: 'page', score: 77, verdict: 'Good', name: 'Whole grain oats', t: Date.now() - 31 * 86400000 };
      await worker.evaluate(async ({ key, entry, refresh, automatic, grace, first }) => {
        await chrome.storage.local.remove(`p:${entry.store}:${entry.asin}`);
        await chrome.storage.local.set({ weights: {}, allergens: [], diets: [], avoidList: [], enabled: true, badges: true, foodOnly: true,
          autoScoreSearch: automatic, speedMode: 'balanced', cacheFirst: first, cacheMemory: true,
          cacheBackgroundRefresh: refresh, cacheGraceDays: grace, [key]: entry });
      }, { key, entry, refresh, automatic, grace, first });
    };
    for (const mode of ['hold', 'no-background', 'no-automatic', 'fresh-only', 'no-recall']) {
      console.log(`  recall checking ${store} ${cart ? 'cart' : 'search'} ${mode}`);
      await seed(mode !== 'no-background', mode !== 'no-automatic', mode === 'fresh-only' ? 0 : 7, mode !== 'no-recall');
      const page = await context.newPage(); page.on('pageerror', e => errors.push(`recall: ${e.message}`));
      let requests = 0, release, notifyStarted; const started = new Promise(resolve => { notifyStarted = resolve; }); const held = new Promise(resolve => { release = resolve; });
      await page.route('**/*', async route => {
        if (route.request().resourceType() !== 'document' && route.request().url().includes(id)) {
          requests++; notifyStarted(); await held; await route.fulfill({ status: 200, contentType: 'text/html', body: label });
        } else await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(sel => document.querySelectorAll(sel).length === 2, badge);
        if (!['fresh-only', 'no-recall'].includes(mode)) {
          const shown = await page.locator(badge).allTextContents();
          if (shown.some(s => !s.includes('77') || !s.includes('saved'))) throw new Error(`Older ratings disappeared: ${shown}`);
        }
        if (['hold', 'fresh-only', 'no-recall'].includes(mode)) {
          await page.waitForFunction(sel => [...document.querySelectorAll(sel)].every(n => n.textContent.includes('saved') || n.textContent.includes('Checking') || n.textContent === '…'), badge);
          let timeout; try { await Promise.race([started, new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('No refresh request started')), 5000); })]); } finally { clearTimeout(timeout); }
          if (requests !== 1) throw new Error(`Repeated product made ${requests} requests`);
          if (['fresh-only', 'no-recall'].includes(mode) && (await page.locator(badge).allTextContents()).some(s => s.includes('77'))) throw new Error('Fresh-only displayed an old score');
          release();
          await page.waitForFunction(sel => [...document.querySelectorAll(sel)].every(n => /^\d+$/.test(n.textContent) && n.textContent !== '77'), badge);
          await page.waitForTimeout(600); if (requests !== 1) throw new Error('Completed cache write triggered another lookup');
        } else { await page.waitForTimeout(600); if (requests) throw new Error('Disabled refresh made a product request'); }
      } finally { release(); await page.close(); }
    }
    await worker.evaluate(key => chrome.storage.local.remove(key), key);
  }
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ autoScoreSearch: true, cacheFirst: true, cacheMemory: true, cacheBackgroundRefresh: true, cacheGraceDays: 7 });
  });
  console.log('  ok  instant recall → search/cart saved scores during held refresh, one request for repeated products, refresh switches, fresh-only grace and updated scores');
}
