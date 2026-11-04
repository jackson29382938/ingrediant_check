// Walmart and Target, end to end, with the REAL unpacked extension in Chromium and replica store pages
// (scripts/retailer-replicas.mjs) served over the real hostnames. No retailer traffic: every other host is
// unresolvable (--host-resolver-rules). It drives what a shopper does (open the home page, type a search,
// press Enter, which on both sites is a single-page navigation with no page load), then checks:
//   - the extension is injected for a search that starts from the home page (the manifest's entry routes),
//   - sponsored results are hidden whatever way they are marked, and never rated, even when they arrive late,
//   - "Price per unit: low to high" sorts correctly across units, with unpriced results last,
//   - the other sort orders, the unit picker, Escape, pause/resume, the product page, and a phone width.
// Screenshots go to SHOT_DIR (default: ./retailer-shots). SHOT_SCALE=2 for retina captures.
//
//   npm install --no-save --no-package-lock playwright@1.63.0
//   HARNESS_CHROME=/opt/pw-browsers/chromium npm run retailers:check
//
// EXT_DIR points at another unpacked copy of the extension (to compare a build against this one).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { imageSvg, targetPage, walmartLateAdHtml, walmartPage } from './retailer-replicas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.resolve(process.env.EXT_DIR || root);
const shots = path.resolve(process.env.SHOT_DIR || 'retailer-shots');
const scale = Number(process.env.SHOT_SCALE || 1);
fs.mkdirSync(shots, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-retailers-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale,
  ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--headless=new', '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND'],
});
const fetched = [], errors = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (/(?:^|\.)(?:walmartimages\.com|scene7\.com)$/.test(url.hostname)) {
    return route.fulfill({ contentType: 'image/svg+xml', body: imageSvg(url.pathname) });
  }
  if (/^(?:www\.)?walmart\.com$/.test(url.hostname)) {
    if (/^\/ip\//.test(url.pathname)) fetched.push(url.pathname.match(/(\d{5,15})\/?$/)?.[1]);
    return route.fulfill({ contentType: url.pathname === '/__fragment' ? 'text/html' : 'text/html; charset=utf-8', body: walmartPage(url.href) });
  }
  if (/^(?:www\.)?target\.com$/.test(url.hostname)) {
    if (/^\/p\//.test(url.pathname)) fetched.push(url.pathname.match(/A-(\d+)/)?.[1]);
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: targetPage(url.href) });
  }
  return route.abort();
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
for (const page of context.pages()) if (/^chrome-extension:/.test(page.url())) await page.close();   // the welcome tab
const setting = values => worker.evaluate(v => chrome.storage.local.set(v), values);

const open = async (url, size) => {
  const page = await context.newPage();
  if (size) await page.setViewportSize(size);
  page.on('pageerror', e => errors.push(`${url}: ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  return page;
};
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const frames = (page, n = 2) => page.evaluate(count => new Promise(done => { const tick = left => requestAnimationFrame(() => (left ? tick(left - 1) : done())); tick(count); }), n);
const rows = page => page.evaluate(() => Array.from(document.querySelector('#air-retailer-sort').shadowRoot.querySelectorAll('.item')).map(li => ({
  id: li.dataset.product, title: li.querySelector('.copy a').textContent, facts: li.querySelector('.facts').textContent,
  unit: li.querySelector('.unit')?.textContent || '', score: li.querySelector('.score').textContent, tag: !!li.querySelector('.tag'),
})));
const sortHost = page => page.locator('#air-retailer-sort');
const money = text => Number(text.match(/\$([\d.]+)/)[1]);
const nonDecreasing = list => list.every((v, i) => i === 0 || v >= list[i - 1] - 1e-9);
const visible = (page, selector) => page.locator(selector).first().isVisible();
let step = 0;
const ok = message => console.log(`ok ${++step} ${message}`);

try {
  // ============================================================ Walmart
  const wm = await open('https://www.walmart.com/');
  await shot(wm, '01-walmart-home');
  assert.equal(await wm.locator('#air-retailer-sort').count(), 0, 'nothing is added to a page with no results');
  // A search typed on the home page is a single-page navigation. This is the path a shopper actually takes.
  await wm.getByRole('searchbox', { name: 'Search' }).fill('oats');
  await wm.keyboard.press('Enter');
  await wm.waitForURL(/\/search\?q=oats/);
  assert.equal(await wm.evaluate(() => performance.getEntriesByType('navigation').length), 1, 'no page load happened');
  if (process.env.REPRO === '1') {
    // Observe only, for comparing another build: what does a search typed on the home page get?
    await wm.waitForSelector('[data-item-id="20000001"]'); await wm.waitForTimeout(8000);
    const seen = await wm.evaluate(() => ({
      badges: document.querySelectorAll('.air-badge').length, hiddenSlots: document.querySelectorAll('[data-air-sponsored-hidden]').length,
      sortPanel: !!document.getElementById('air-retailer-sort') || !!document.getElementById('air-walmart-sort'),
      adsShown: ['20000001', '20000002', '20000003'].filter(id => { const n = document.querySelector(`[data-item-id="${id}"]`); return n && n.getClientRects().length > 0; }).length,
    }));
    await shot(wm, 'repro-walmart-search-from-home');
    console.log('REPRO walmart search typed on the home page:', JSON.stringify(seen));
    await wm.reload({ waitUntil: 'load' }); await wm.waitForSelector('[data-item-id="20000001"]'); await wm.waitForTimeout(8000);
    const reloaded = await wm.evaluate(() => ({
      badges: document.querySelectorAll('.air-badge').length, hiddenSlots: document.querySelectorAll('[data-air-sponsored-hidden]').length,
      adsShown: ['20000001', '20000002', '20000003'].filter(id => { const n = document.querySelector(`[data-item-id="${id}"]`); return n && n.getClientRects().length > 0; }).length,
    }));
    await shot(wm, 'repro-walmart-search-after-reload');
    console.log('REPRO same page after a reload (a direct load of the search URL):', JSON.stringify(reloaded));
    process.exitCode = 0; throw new Error('repro-done');
  }
  await wm.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length >= 11, null, { timeout: 60000 })
    .catch(async error => { console.error({ errors, fetched, badges: await wm.locator('.air-badge').allTextContents(), hidden: await wm.locator('[data-air-sponsored-hidden]').count() }); throw error; });
  await frames(wm);
  const adIds = ['20000001', '20000002', '20000003', '20000004', '20000005'];
  for (const id of adIds) assert.equal(await visible(wm, `[data-item-id="${id}"]`), false, `sponsored ${id} is hidden`);
  assert.equal(await visible(wm, '.banner-ad'), false, 'the label-only banner ad is hidden');
  assert.equal(await visible(wm, '[data-testid="sp-search-brand-carousel"]'), false, 'the sponsored carousel is hidden');
  for (const id of ['10314926', '10315264', '10450112', '10450115']) assert.equal(await visible(wm, `[data-item-id="${id}"]`), true, `organic ${id} stays`);
  assert(!fetched.some(id => adIds.includes(id)), 'a sponsored product page is never fetched or rated');
  assert.equal(await wm.locator('[data-item-id^="2000"] .air-badge').count(), 0, 'no rating on an ad');
  assert.equal(await wm.locator('#empty-ad-slot').isVisible(), false, 'the empty ad slot collapses');
  await shot(wm, '02-walmart-search-from-home-ads-hidden');
  ok(`Walmart: search typed on the home page (no page load) -> extension active, ${adIds.length} ads of 5 different markups hidden and never rated, organic results badged`);

  // The same page with the extension paused: the ads the next screenshot proves were really there.
  await setting({ enabled: false });
  await wm.waitForFunction(() => !document.querySelector('[data-air-sponsored-hidden]') && !document.querySelector('.air-badge'));
  assert.equal(await visible(wm, '[data-item-id="20000001"]'), true);
  assert.equal(await visible(wm, '.banner-ad'), true);
  await shot(wm, '03-walmart-search-paused-ads-visible');
  await setting({ enabled: true });
  await wm.waitForFunction(() => document.querySelectorAll('[data-air-sponsored-hidden]').length >= 5 && document.querySelectorAll('.air-badge[data-air-status="scored"]').length >= 11, null, { timeout: 60000 });
  assert.equal(await visible(wm, '[data-item-id="20000001"]'), false);
  ok('Walmart: pausing shows every ad again exactly as the page rendered it; resuming hides them and re-rates');

  // An ad that arrives after hydration. After a quiet moment it is hidden by the next frame, before it can paint;
  // while the page is busy (our own badges arriving count) hiding is paced, and still lands within a few frames.
  await frames(wm, 20);
  const insertLate = () => wm.evaluate(html => {
    const stack = document.querySelector('[data-testid="item-stack"]'); stack.insertAdjacentHTML('beforeend', html);
    const ad = stack.lastElementChild;
    return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(getComputedStyle(ad).display))));
  }, walmartLateAdHtml());
  assert.equal(await insertLate(), 'none', 'a late ad is hidden within two frames when the page is quiet');
  // Counted in rendered frames, not milliseconds: a software-rendered headless browser can take hundreds of ms per frame.
  const burst = await wm.evaluate(html => new Promise(done => {
    const stack = document.querySelector('[data-testid="item-stack"]');
    // A burst of unrelated changes, then the ad: the worst case for pacing.
    for (let i = 0; i < 40; i++) stack.insertAdjacentHTML('beforeend', '<div class="noise"></div>');
    stack.insertAdjacentHTML('beforeend', html);
    const ad = stack.lastElementChild;
    let frame = 0;
    const look = () => { frame++; if (getComputedStyle(ad).display === 'none') done(frame); else if (frame > 30) done(-1); else requestAnimationFrame(look); };
    requestAnimationFrame(look);
  }), walmartLateAdHtml().replace('20000006', '20000009'));
  assert(burst >= 1 && burst <= 4, `an ad that arrives during a burst of changes is hidden within 4 frames (took ${burst})`);
  // The noise was only there to keep the page busy (empty cells in the grid are collapsed and counted as hidden slots).
  await wm.evaluate(() => document.querySelectorAll('.noise').forEach(node => node.remove()));
  ok(`Walmart: an ad inserted after load is hidden within two frames when quiet, and within ${burst} frame(s) during a burst of page changes`);

  // ---- the sort panel
  await sortHost(wm).getByRole('button', { name: 'Sort results', exact: true }).click();
  const drawer = sortHost(wm).locator('.drawer');
  assert.equal(await drawer.isVisible(), true);
  const body = await wm.locator('body').boundingBox(), panelBox = await drawer.boundingBox();
  assert(body.x + body.width <= panelBox.x + 1, 'the panel reserves its own space and does not cover the results');
  assert.equal(await sortHost(wm).getByRole('button', { name: 'Price per unit: low to high' }).getAttribute('aria-pressed'), 'true', 'unit price is the default sort');
  let list = await rows(wm);
  assert.equal(list.length, 13, 'every loaded organic result, no ad');
  assert(!list.some(r => r.id.startsWith('2000')), 'ads are not in the sorted list');
  const priced = list.filter(r => r.unit);
  assert(priced.length >= 9, 'oz-priced results come first');
  assert(nonDecreasing(priced.map(r => money(r.unit))), `unit prices ascend: ${priced.map(r => r.unit).join(' ')}`);
  assert.equal(list.slice(0, priced.length).every(r => r.unit), true, 'unpriced results come after every priced one');
  assert.equal(list[0].id, '10314926', 'cheapest per ounce first');
  assert.equal(list[1].id, '10450119', '$1.66/lb is $0.104/oz, correctly converted, second');
  assert(list.slice(priced.length).every(r => /No unit price/.test(r.facts)), 'the rest are marked, in the store order');
  assert.deepEqual(list.slice(priced.length).map(r => r.id), ['10450114', '10450117', '10450118', '10450120'], 'incomparable units keep the store order');
  assert(list.every(r => r.facts.startsWith('$')), 'prices shown');
  assert(await sortHost(wm).locator('.thumb[src^="https://i5.walmartimages.com/"]').count() >= 9, 'thumbnails come from the store');
  await shot(wm, '04-walmart-sort-price-per-unit-low-to-high');
  ok(`Walmart: Price per unit, low to high -> ${priced.map(r => r.unit).join(' < ')}; unpriced/other-unit results last`);

  // The score breakdown a shopper gets by hovering a badge (Walmart's own cards are left alone).
  // Scroll first and let it settle: the page closes this card on any scroll, as it should.
  await wm.locator('[data-item-id="10450116"] .air-badge').scrollIntoViewIfNeeded();
  await frames(wm, 4);
  await wm.locator('[data-item-id="10450116"] .air-badge').hover();
  await wm.waitForSelector('#air-retailer-details', { timeout: 10000 });
  await shot(wm, '04b-walmart-hover-score-breakdown');
  await wm.mouse.move(5, 5);
  await wm.waitForSelector('#air-retailer-details', { state: 'detached', timeout: 10000 });
  ok('Walmart: hovering a rating shows why it scored that way, and it goes away again');

  // Another unit: every price re-expressed per pound, order unchanged within the weight family.
  await sortHost(wm).locator('select[data-control="unit"]').selectOption('lb');
  list = await rows(wm);
  const perLb = list.filter(r => /\/lb$/.test(r.unit));
  assert(perLb.length >= 9 && nonDecreasing(perLb.map(r => money(r.unit))), 'per pound ascends');
  assert(Math.abs(money(perLb[0].unit) - 1.52) < 0.02, `Great Value is about $1.52/lb, got ${perLb[0].unit}`);
  await shot(wm, '05-walmart-sort-per-pound');
  // Per item: only listings that state or give an item count are comparable; the rest go last.
  await sortHost(wm).locator('select[data-control="unit"]').selectOption('ct');
  list = await rows(wm);
  const perItem = list.filter(r => /\/item$/.test(r.unit));
  assert(perItem.length >= 3, `per-item prices: ${perItem.map(r => r.unit)}`);
  assert(nonDecreasing(perItem.map(r => money(r.unit))) && list.slice(0, perItem.length).every(r => /\/item$/.test(r.unit)));
  assert.equal(perItem[0].id, '10450114', 'Quaker instant is the cheapest per item');
  await shot(wm, '06-walmart-sort-price-per-item');
  ok(`Walmart: unit picker re-ranks per pound and per item (${perItem.map(r => r.unit).join(' < ')})`);
  await sortHost(wm).locator('select[data-control="unit"]').selectOption('auto');

  await sortHost(wm).getByRole('button', { name: 'Healthiest', exact: true }).click();
  const scores = (await rows(wm)).map(r => r.score).filter(s => /\d/.test(s)).map(Number);
  assert(scores.length >= 11 && scores.every((v, i) => i === 0 || v <= scores[i - 1]), `health descends: ${scores}`);
  await shot(wm, '07-walmart-sort-healthiest');
  await sortHost(wm).getByRole('button', { name: 'Lowest price', exact: true }).click();
  const prices = (await rows(wm)).map(r => money(r.facts));
  assert(nonDecreasing(prices), `price ascends: ${prices}`);
  await sortHost(wm).getByRole('button', { name: 'Balanced', exact: true }).click();
  assert.equal(await sortHost(wm).getByRole('button', { name: 'Balanced', exact: true }).getAttribute('aria-pressed'), 'true');
  ok('Walmart: Healthiest, Lowest price and Balanced orders');
  await sortHost(wm).getByRole('button', { name: 'Price per unit: low to high' }).click();
  // A new search with the panel open: the page changes without loading, ads stay hidden, the choice survives.
  await sortHost(wm).locator('select[data-control="unit"]').selectOption('lb');
  await wm.getByRole('searchbox', { name: 'Search' }).fill('cereal');
  await wm.keyboard.press('Enter');
  await wm.waitForURL(/\/search\?q=cereal/);
  await wm.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length >= 11, null, { timeout: 60000 });
  await frames(wm);
  assert.equal(await visible(wm, '[data-item-id="20000001"]'), false, 'ads are hidden on the second search too');
  assert.equal(await sortHost(wm).locator('.drawer').isVisible(), true, 'the panel stays open across searches');
  assert.equal(await sortHost(wm).locator('select[data-control="unit"]').inputValue(), 'lb', 'and keeps the unit');
  assert((await rows(wm)).length >= 13);
  ok('Walmart: a second search keeps the panel open with its unit; ads hidden again');
  await sortHost(wm).locator('select[data-control="unit"]').selectOption('auto');
  // Escape closes the panel when focus is in it (it is not a modal, so a key typed in the page's own search box is left alone).
  await wm.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), true, 'Escape pressed on the page does not close the panel');
  await sortHost(wm).getByRole('button', { name: 'Price per unit: low to high' }).click();
  await wm.keyboard.press('Escape');
  assert.equal(await drawer.isVisible(), false);
  assert.equal(await wm.locator('html').getAttribute('data-air-sort-docked'), null, 'closing restores full page width');
  ok('Walmart: Escape closes the panel and restores the page width');

  // ---- a product page, reached by clicking a result (SPA navigation again)
  await wm.locator('[data-item-id="10314926"] a[link-identifier]').click({ force: true });
  await wm.waitForURL(/\/ip\/.*10314926/);
  await wm.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored', null, { timeout: 30000 });
  await shot(wm, '08-walmart-product-score-panel');
  // The extension holds no host permission for walmart.com, so a tab's address is not readable here; ask every tab.
  const toolbar = await worker.evaluate(async () => {
    const texts = await Promise.all((await chrome.tabs.query({})).map(tab => chrome.action.getBadgeText({ tabId: tab.id })));
    return texts.find(text => /^\d+$/.test(text)) || texts.join('|');
  });
  assert.match(toolbar, /^\d+$/, `the toolbar icon shows the product's score, got "${toolbar}"`);
  ok(`Walmart: product page reached from results shows its score panel, and the toolbar icon reads ${toolbar}`);

  // The cart, reached through the header link (single-page navigation again).
  await wm.getByRole('link', { name: 'Cart' }).click();
  await wm.waitForURL(/\/cart/);
  await wm.waitForFunction(() => document.querySelectorAll('.air-cart-badge').length >= 3, null, { timeout: 60000 });
  await wm.waitForFunction(() => document.querySelector('.air-cart-summary'), null, { timeout: 30000 });
  await shot(wm, '08b-walmart-cart-ratings');
  ok('Walmart: cart lines are rated and the cart gets its average');
  await wm.close();

  // ---- a phone
  const phone = await open('https://www.walmart.com/search?q=oats', { width: 390, height: 844 });
  await phone.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length >= 11, null, { timeout: 60000 });
  await frames(phone);
  assert.equal(await visible(phone, '[data-item-id="20000001"]'), false);
  await shot(phone, '09-walmart-phone-results');
  await sortHost(phone).getByRole('button', { name: 'Sort results', exact: true }).click();
  await frames(phone, 3);
  const phoneRows = await rows(phone);
  assert(nonDecreasing(phoneRows.filter(r => r.unit).map(r => money(r.unit))));
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow on a phone');
  await shot(phone, '10-walmart-phone-sort-panel');
  ok('Walmart: phone width, ads hidden, sort panel usable, no horizontal overflow');
  await phone.close();

  // ============================================================ Target
  const tg = await open('https://www.target.com/');
  assert.equal(await tg.locator('#air-retailer-sort').count(), 0);
  await tg.getByRole('searchbox', { name: /help you find/ }).fill('oats');
  await tg.keyboard.press('Enter');
  await tg.waitForURL(/\/s\?searchTerm=oats/);
  await tg.waitForFunction(() => document.querySelectorAll('.air-badge[data-air-status="scored"]').length >= 9, null, { timeout: 60000 })
    .catch(async error => { console.error({ errors, fetched, badges: await tg.locator('.air-badge').allTextContents() }); throw error; });
  await frames(tg);
  assert.equal(await visible(tg, '[data-test="ListingPageProductListing"]'), true);
  await shot(tg, '11-target-search-from-home-badges');
  ok('Target: search typed on the home page (no page load) -> extension active, results rated');

  await sortHost(tg).getByRole('button', { name: 'Sort results', exact: true }).click();
  assert.equal(await sortHost(tg).getByRole('button', { name: 'Price per unit: low to high' }).getAttribute('aria-pressed'), 'true');
  let target = await rows(tg);
  assert.equal(target.length, 12);
  const tPriced = target.filter(r => r.unit);
  assert(tPriced.length >= 8 && nonDecreasing(tPriced.map(r => money(r.unit))), `unit prices ascend: ${tPriced.map(r => r.unit).join(' ')}`);
  assert.equal(target[0].id, '79364857', 'cheapest per ounce first');
  assert.equal(target.slice(0, tPriced.length).every(r => r.unit), true);
  assert.equal(target.filter(r => r.tag).length, 2, 'Target ads are tagged Sponsored in the list');
  assert.deepEqual(target.filter(r => r.tag).map(r => r.id).sort(), ['94340519', '94370670']);
  assert(target.slice(tPriced.length).every(r => /No unit price/.test(r.facts)));
  await shot(tg, '12-target-sort-price-per-unit-low-to-high');
  ok(`Target: Price per unit, low to high -> ${tPriced.map(r => r.unit).join(' < ')}; ads tagged, unpriced last`);
  await sortHost(tg).locator('select[data-control="unit"]').selectOption('ct');
  target = await rows(tg);
  assert(/\/item$/.test(target[0].unit), 'per item is available on Target too');
  await shot(tg, '13-target-sort-price-per-item');
  await sortHost(tg).locator('select[data-control="unit"]').selectOption('auto');
  await sortHost(tg).getByRole('button', { name: 'Healthiest', exact: true }).click();
  const tScores = (await rows(tg)).map(r => r.score).filter(s => /\d/.test(s)).map(Number);
  assert(tScores.every((v, i) => i === 0 || v <= tScores[i - 1]), `health descends: ${tScores}`);
  ok('Target: per-item unit, Healthiest order');
  await tg.keyboard.press('Escape');
  await tg.locator('[data-test="ListingPageProductListing"] a[data-test="content"]').first().click();
  await tg.waitForURL(/\/p\//);
  await tg.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored', null, { timeout: 30000 });
  await shot(tg, '14-target-product-score-panel');
  ok('Target: product page reached from results shows its score panel');
  await tg.close();

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log(`\nretailer harness passed. Screenshots: ${shots}`);
} catch (error) {
  if (error.message !== 'repro-done') throw error;
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
