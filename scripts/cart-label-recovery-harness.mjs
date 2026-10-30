// Four exact public Amazon label captures plus controlled recovery/fallback cases. No real cart.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), PC = require('../src/engine/db/product-cache.js'), SC = require('../src/engine/db/score-cache.js');
const records = JSON.parse(fs.readFileSync(new URL('../tests/amazon-cart-label-evidence.json', import.meta.url))).records;
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export async function cartLabelRecoveryEndToEnd(context, worker, errors) {
  const synthetic = ['B0FIXBAR01', 'B0FIXOCR01', 'B0FIXBAD01'], ids = [...records.map(r => r.asin), ...synthetic];
  const keys = ['enabled', 'badges', 'autoScoreSearch', 'cacheFirst', 'cacheGraceDays', 'ocrLabels', 'useOpenFoodFacts', 'weights', 'allergens', 'diets', 'avoidList', 'pointsEnabled', ...ids.flatMap(id => [SC.key('amazon.com', id), PC.localKey('amazon.com', id)])];
  const before = await worker.evaluate(keys => chrome.storage.local.get(keys), keys);
  const page = await context.newPage(), requests = []; page.on('pageerror', error => errors.push('cart label recovery: ' + error.message));
  let items = records, emptyCookies = false, mismatched = false;
  const card = record => `<div class="sc-list-item" data-asin="${record.asin}" data-producttitle="${escapeHtml(record.title)}"><div><a href="/dp/${record.asin}"><span class="sc-product-title">${escapeHtml(record.title)}</span></a></div><input aria-label="Quantity" value="1"><button>Delete</button></div>`;
  const product = record => `<h1 id="productTitle">${escapeHtml(record.title)}</h1><input id="ASIN" value="${record.asin}"><div id="nutritionalInfoAndIngredients_feature_div"><div id="nic-ingredients-content"><span>${escapeHtml(record.ingredients)}</span></div></div>`;
  await page.route('https://www.amazon.com/**', route => {
    const request = route.request(), url = new URL(request.url()), id = url.pathname.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
    if (id) {
      requests.push({ id, cookie: request.headers().cookie, referer: request.headers().referer });
      const record = records.find(r => r.asin === id);
      const body = record ? emptyCookies && id === 'B07X2643L7' ? `<h1 id="productTitle">${escapeHtml(record.title)}</h1><input id="ASIN" value="${id}">` : product(record)
        : `<h1 id="productTitle">Whole grain oats</h1><input id="ASIN" value="${mismatched && id === synthetic[2] ? 'B0WRONG001' : id}">${id === synthetic[0] ? '<div id="detailBullets_feature_div">UPC: 9999999900050</div>' : '<div id="altImages"><img src="https://m.media-amazon.com/images/I/51CartLabelTest._SX38_.jpg"></div>'}`;
      return route.fulfill({ contentType: 'text/html', body });
    }
    return route.fulfill({ contentType: 'text/html', body: `<main><h1 id="sc-active-items-header">Shopping Cart</h1><div id="sc-active-cart">${items.map(card).join('')}</div></main>` });
  });
  try {
    await worker.evaluate(async keys => { await chrome.storage.local.remove(keys.filter(k => /^(s|p):/.test(k))); await chrome.storage.local.set({ enabled: true, badges: true, autoScoreSearch: true, cacheFirst: true, cacheGraceDays: 0, ocrLabels: false, useOpenFoodFacts: false, weights: {}, allergens: ['wheat', 'soy', 'peanut'], diets: [], avoidList: [], pointsEnabled: false }); }, keys);
    await context.addCookies([{ name: 'cart_label_private_test', value: 'do-not-send', domain: 'www.amazon.com', path: '/', secure: true }]);
    await page.goto('https://www.amazon.com/gp/cart/view.html');
    await page.waitForFunction(() => document.querySelectorAll('.air-cart-badge[data-air-status="scored"]').length === 4, null, { timeout: 20000 });
    const scores = await page.locator('.air-cart-badge').allTextContents();
    if (scores.some(s => !/^\d+$/.test(s))) throw new Error('One of the four captured labels has no numeric score: ' + scores);
    const cookieKey = PC.localKey('amazon.com', 'B07X2643L7'), cookieLabel = await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], cookieKey);
    if (!cookieLabel?.data.text.includes('ARTIFICIAL FLAVOR') || !cookieLabel.data.advisory_text.includes('PEANUTS')) throw new Error('Cookie recipe or cross-contact warning was dropped');
    const count = requests.length;
    await worker.evaluate(async ids => { await chrome.storage.local.set({ autoScoreSearch: false }); await chrome.storage.local.remove(ids.map(id => 's:amazon.com:' + id)); }, ids);
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.air-cart-badge[data-air-status="scored"]').length === 4);
    if (requests.length !== count) throw new Error('Saved public ingredient readings were not reused with automatic rating off');
    // A temporarily unavailable item can heal when another tab saves its real reading, without reload.
    emptyCookies = true;
    await worker.evaluate(async key => { await chrome.storage.local.remove(['s:amazon.com:B07X2643L7', key]); await chrome.storage.local.set({ autoScoreSearch: true }); }, cookieKey);
    await page.reload(); await page.waitForFunction(() => document.querySelector('[data-air-product="B07X2643L7"]')?.dataset.airStatus === 'unavailable');
    const failedCount = requests.length;
    await worker.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), { key: cookieKey, value: cookieLabel });
    await page.waitForFunction(() => document.querySelector('[data-air-product="B07X2643L7"]')?.dataset.airStatus === 'scored');
    if (requests.length !== failedCount) throw new Error('A saved-label recovery made another public request');
    await worker.evaluate(() => {
      self.__cartLabelBarcode = self.lookupBarcode; self.__cartLabelOcr = self.ocrLabels; self.__cartLabelCalls = [];
      self.lookupBarcode = async code => { self.__cartLabelCalls.push({ type: 'barcode', code }); return { name: 'Oats', ingredients_text: 'whole grain oats, salt' }; };
      self.ocrLabels = async urls => { self.__cartLabelCalls.push({ type: 'ocr', urls }); return { ok: true, results: [{ text: 'INGREDIENTS: whole grain oats, honey, almonds. CONTAINS: almonds.', confidence: 90 }] }; };
    });
    items = synthetic.slice(0, 2).map(asin => ({ asin, title: 'Whole grain oats' }));
    await worker.evaluate(() => chrome.storage.local.set({ ocrLabels: true, useOpenFoodFacts: true }));
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.air-cart-badge[data-air-status="scored"]').length === 2);
    const saved = await worker.evaluate(ids => chrome.storage.local.get(ids.map(id => 's:amazon.com:' + id)), synthetic);
    if (saved['s:amazon.com:' + synthetic[0]]?.source !== 'open-food-facts' || saved['s:amazon.com:' + synthetic[1]]?.source !== 'label-ocr') throw new Error('Cart fallbacks lost their source identity');
    const called = await worker.evaluate(() => self.__cartLabelCalls.length);
    mismatched = true; items = [{ asin: synthetic[2], title: 'Whole grain oats' }];
    await page.reload(); await page.waitForFunction(() => document.querySelector('.air-cart-badge')?.dataset.airStatus === 'unavailable');
    if (await worker.evaluate(() => self.__cartLabelCalls.length) !== called) throw new Error('Mismatched product evidence reached OCR/barcode fallback');
    await worker.evaluate(async ids => { await chrome.storage.local.remove(ids.flatMap(id => ['s:amazon.com:' + id, 'p:amazon.com:' + id])); await chrome.storage.local.set({ ocrLabels: false, useOpenFoodFacts: false }); }, synthetic);
    mismatched = false; items = synthetic.slice(0, 2).map(asin => ({ asin, title: 'Whole grain oats' }));
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.air-cart-badge[data-air-status="unavailable"]').length === 2);
    if (await worker.evaluate(() => self.__cartLabelCalls.length) !== called) throw new Error('Cart fallbacks ran with their settings off');
    if (requests.some(r => r.cookie || r.referer)) throw new Error('Cart label requests sent private cookies or the cart referrer');
    console.log('  ok cart label recovery → four exact public label captures score, cookie warnings survive, saved inputs replay/heal without requests, barcode/photo fallbacks respect toggles and product identity');
  } catch (error) {
    console.error('Cart label recovery state:', await page.locator('.air-cart-badge').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.airProduct, state: n.dataset.airStatus, reason: n.dataset.airReason, text: n.textContent })))); throw error;
  } finally {
    await page.close(); await context.clearCookies({ name: 'cart_label_private_test' });
    await worker.evaluate(async ({ keys, before }) => { if (self.__cartLabelBarcode) { self.lookupBarcode = self.__cartLabelBarcode; self.ocrLabels = self.__cartLabelOcr; delete self.__cartLabelBarcode; delete self.__cartLabelOcr; delete self.__cartLabelCalls; } await chrome.storage.local.remove(keys.filter(k => !(k in before))); await chrome.storage.local.set(before); }, { keys, before });
  }
}
