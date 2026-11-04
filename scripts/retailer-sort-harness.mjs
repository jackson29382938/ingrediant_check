// Walmart and Target, end to end, with the REAL unpacked extension in Chromium and replica store pages
// (scripts/retailer-replicas.mjs) served over the real hostnames. No retailer traffic: every other host is
// unresolvable (--host-resolver-rules). It drives what a shopper does (open the home page, type a search,
// press Enter, which on both sites is a single-page navigation with no page load), then checks:
//   - the extension is injected for a search that starts from the home page (the manifest's entry routes),
//   - sponsored results are hidden whatever way they are marked, and never rated, even when they arrive late,
//   - the "Ingredient Check sort" menu offers Amazon's two entries and opens the SAME list page Amazon uses
//     (src/options/sorted.html; headless Chromium refuses sidePanel.open, so the worker's fallback tab is used),
//   - the list is ranked by price per unit across units, with unpriced results last, and by score,
//   - "Load more results" and the reader's count: further pages are read (Walmart from its HTML, Target, whose HTML
//     holds no products, through a rendered frame) and the list stops at the count,
//   - hovering a score shows why it scored that way; Target's ads are tagged; the product page, the cart, a phone.
// Screenshots go to SHOT_DIR (default: ./retailer-shots). SHOT_SCALE=2 for retina captures.
//
//   npm install --no-save --no-package-lock playwright@1.63.0
//   HARNESS_CHROME=/opt/pw-browsers/chromium npm run retailers:check
//
// EXT_DIR points at another unpacked copy of the extension (to compare a build against this one); with REPRO=1 the run
// only observes what a search typed on the Walmart home page gets from that build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { imageSvg, targetPage, walmartLateAdHtml, walmartPage } from './retailer-replicas.mjs';
import { krogerPage } from './retailer-replica-kroger.mjs';

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
const fetched = [], pagesFetched = [], errors = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.protocol === 'chrome-extension:') return route.continue();   // the extension's own pages and scripts
  if (/(?:^|\.)(?:walmartimages\.com|scene7\.com)$/.test(url.hostname)) {
    return route.fulfill({ contentType: 'image/svg+xml', body: imageSvg(url.pathname) });
  }
  if (/^(?:www\.)?walmart\.com$/.test(url.hostname)) {
    if (/^\/ip\//.test(url.pathname)) fetched.push(url.pathname.match(/(\d{5,15})\/?$/)?.[1]);
    if (url.pathname === '/search' && url.searchParams.has('page')) pagesFetched.push(`walmart:${url.searchParams.get('page')}`);
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: walmartPage(url.href) });
  }
  if (/^(?:www\.)?target\.com$/.test(url.hostname)) {
    if (/^\/p\//.test(url.pathname)) fetched.push(url.pathname.match(/A-(\d+)/)?.[1]);
    if (url.pathname === '/s' && url.searchParams.has('Nao')) pagesFetched.push(`target:${url.searchParams.get('Nao')}`);
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: targetPage(url.href) });
  }
  if (/^(?:www\.)?kroger\.com$/.test(url.hostname)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: krogerPage(url.href) });
  return route.abort();
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
const extensionId = new URL(worker.url()).host;
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
const money = text => Number(text.match(/\$([\d.]+)/)[1]);
const nonDecreasing = list => list.every((v, i) => i === 0 || v >= list[i - 1] - 1e-9);
const visible = (page, selector) => page.locator(selector).first().isVisible();
let step = 0;
const ok = message => console.log(`ok ${++step} ${message}`);

// ---- the sort menu and the list page it opens
const sortMenu = page => page.locator('#air-retailer-sort');
// Choose an entry in the page's "Ingredient Check sort" menu and return the list page the worker opens for it: the
// side panel when Chrome allows it, else a tab (headless Chromium refuses sidePanel.open, as an older Chrome does).
async function chooseSort(page, entry) {
  const opened = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await sortMenu(page).getByRole('button', { name: 'Ingredient Check sort' }).click();
  await sortMenu(page).getByRole('menuitem', { name: entry }).click();
  let list = await opened;
  if (!list) { list = await context.newPage(); await list.goto(`chrome-extension://${extensionId}/src/options/sidepanel.html`); }
  list.on('pageerror', e => errors.push(`list: ${e.message}`));
  await settled(list);
  return list;
}
const settled = list => list.waitForFunction(() => document.getElementById('results-root').getAttribute('aria-busy') === 'false'
  && document.querySelectorAll('article.product').length > 0 && !document.querySelector('.results-status')?.textContent.match(/Rating listings|Loading .* results page/), null, { timeout: 120000 });
const listRows = list => list.evaluate(() => Array.from(document.querySelectorAll('article.product')).map(article => ({
  title: (article.querySelector('h2 a') || article.querySelector('h2')).textContent.replace(/^\s*\d+\s*/, '').trim(),
  url: article.querySelector('h2 a')?.href || '', score: article.querySelector('.score-chip')?.textContent || '',
  unit: article.querySelector('.fact.unit')?.textContent || '', price: [...article.querySelectorAll('.fact')].map(f => f.textContent).find(t => /^\$\d/.test(t) && !/\//.test(t)) || '',
  meta: article.querySelector('.product-meta')?.textContent || '', image: article.querySelector('img.product-image')?.src || '',
})));
const statusOf = list => list.locator('.results-status').textContent();

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
      sortMenu: !!document.getElementById('air-retailer-sort') || !!document.getElementById('air-walmart-sort'),
      adsShown: ['20000001', '20000002', '20000003'].filter(id => { const n = document.querySelector(`[data-item-id="${id}"]`); return n && n.getClientRects().length > 0; }).length,
    }));
    await shot(wm, 'repro-walmart-search-from-home');
    console.log('REPRO walmart search typed on the home page:', JSON.stringify(seen));
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
  await wm.waitForFunction(() => !document.querySelector('[data-air-sponsored-hidden]') && !document.querySelector('.air-badge') && !document.getElementById('air-retailer-sort'));
  assert.equal(await visible(wm, '[data-item-id="20000001"]'), true);
  assert.equal(await visible(wm, '.banner-ad'), true);
  await shot(wm, '03-walmart-search-paused-ads-visible');
  await setting({ enabled: true });
  await wm.waitForFunction(() => document.querySelectorAll('[data-air-sponsored-hidden]').length >= 5 && document.querySelectorAll('.air-badge[data-air-status="scored"]').length >= 11, null, { timeout: 60000 });
  assert.equal(await visible(wm, '[data-item-id="20000001"]'), false);
  ok('Walmart: pausing shows every ad again exactly as the page rendered it (and removes the sort button); resuming hides them and re-rates');

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
    for (let i = 0; i < 40; i++) stack.insertAdjacentHTML('beforeend', '<div class="noise"></div>');
    stack.insertAdjacentHTML('beforeend', html);
    const ad = stack.lastElementChild;
    let frame = 0;
    const look = () => { frame++; if (getComputedStyle(ad).display === 'none') done(frame); else if (frame > 30) done(-1); else requestAnimationFrame(look); };
    requestAnimationFrame(look);
  }), walmartLateAdHtml().replace('20000006', '20000009'));
  assert(burst >= 1 && burst <= 4, `an ad that arrives during a burst of changes is hidden within 4 frames (took ${burst})`);
  await wm.evaluate(() => document.querySelectorAll('.noise').forEach(node => node.remove()));
  ok(`Walmart: an ad inserted after load is hidden within two frames when quiet, and within ${burst} frame(s) during a burst of page changes`);

  // The score breakdown a shopper gets by hovering a badge on the page.
  await wm.locator('[data-item-id="10450116"] .air-badge').scrollIntoViewIfNeeded();
  await frames(wm, 4);
  await wm.locator('[data-item-id="10450116"] .air-badge').hover();
  await wm.waitForSelector('#air-retailer-details', { timeout: 10000 });
  await shot(wm, '04b-walmart-hover-score-breakdown');
  await wm.mouse.move(5, 5);
  await wm.waitForSelector('#air-retailer-details', { state: 'detached', timeout: 10000 });
  ok('Walmart: hovering a rating on the page shows why it scored that way, and it goes away again');

  // ---- the sort menu: Amazon's two entries, the same wording
  await sortMenu(wm).getByRole('button', { name: 'Ingredient Check sort' }).click();
  const entries = await sortMenu(wm).getByRole('menuitem').allTextContents();
  assert.deepEqual(entries, ['Price per ounce: Low to High', 'Ingredient Check score: High to Low'], 'the menu carries Amazon\'s two entries; the unit is the one most results show');
  await shot(wm, '04c-walmart-sort-menu');
  await wm.keyboard.press('Escape');
  assert.equal(await sortMenu(wm).getByRole('menuitem').first().isVisible(), false, 'Escape closes the menu');
  ok('Walmart: the page gets an "Ingredient Check sort" menu with Amazon\'s two entries and wording');

  // ---- price per unit, with "Load more results" on and a count of 30: pages 2 and 3 are read as well
  await setting({ sortLoadMore: true, sortCount: 30, sortMissing: 'rate-first', sortTimeLimit: 120 });
  const wmList = await chooseSort(wm, 'Price per ounce: Low to High');
  let list = await listRows(wmList);
  const status = await statusOf(wmList);
  assert.deepEqual(pagesFetched.filter(p => p.startsWith('walmart')).slice(0, 3), ['walmart:2', 'walmart:3', 'walmart:4'], 'pages 2 and 3 were read; page 4 was empty, so it stopped');
  assert.equal(list.length, 22, `13 results on page 1 + 6 on page 2 + 3 on page 3, no ad (got ${list.length}: ${status})`);
  assert(/Collected 22 products/.test(status) && /Walmart has no more results/.test(status), status);
  assert(list.some(r => /Walmart page 2/.test(r.meta)) && list.some(r => /Walmart page 3/.test(r.meta)), 'each result says which page it came from');
  assert(!list.some(r => /Sponsored|20000010/.test(r.meta + r.url)), 'a later page\'s ad is left out as well');
  assert(!fetched.some(id => /^2000/.test(id)), 'no sponsored product page was fetched on any page');
  const unitsOf = rows => rows.filter(r => /\/oz$/.test(r.unit)).map(r => money(r.unit));
  assert(nonDecreasing(unitsOf(list)) && unitsOf(list).length === 16, `price per ounce ascends across all pages: ${unitsOf(list).join(' ')}`);
  assert.equal(list[0].title.startsWith('Great Value Old Fashioned Oats'), true, 'cheapest per ounce first');
  assert(/Fresh Gala Apples/.test(list[1].title), '$1.66/lb is $0.104/oz, correctly converted, second');
  assert(/Rolled Oats Canister/.test(list[2].title) && /Walmart page 3/.test(list[2].meta), 'page 3\'s $0.125/oz canister ranks third, among page 1\'s results');
  assert(list.slice(unitsOf(list).length).every(r => /No price per ounce/.test(r.unit)), 'results with no price per ounce come last');
  assert(list.filter(r => r.image.startsWith('https://i5.walmartimages.com/')).length >= 18, 'pictures come from the store');
  await shot(wmList, '05-walmart-list-price-per-ounce-all-pages');
  ok(`Walmart: Price per ounce, 3 results pages read (22 results, no ads) -> ${unitsOf(list).slice(0, 5).join(' < ')} ...; page 4 empty -> "has no more results"`);

  // Hovering a score on the list page: the notes, as on Amazon.
  const chip = wmList.locator('article.product .score-chip').nth(1);
  await chip.hover();
  await wmList.waitForSelector('.why-pop', { timeout: 5000 });
  const why = await wmList.locator('.why-pop').textContent();
  assert(/Why it scored 96/.test(why), why);
  await shot(wmList, '05b-walmart-list-hover-notes');
  await wmList.mouse.move(2, 2);
  ok(`Walmart: hovering a score on the list shows why it scored that way ("${why.replace(/\s+/g, ' ').slice(0, 60)}…")`);

  // The unit picker re-ranks what was gathered; per pound keeps the order within the weight family.
  await wmList.locator('#unit-select').selectOption('lb');
  list = await listRows(wmList);
  const perLb = list.filter(r => /\/lb$/.test(r.unit));
  assert(perLb.length === 16 && nonDecreasing(perLb.map(r => money(r.unit))), 'per pound ascends');
  assert(Math.abs(money(perLb[0].unit) - 1.52) < 0.02, `Great Value is about $1.52/lb, got ${perLb[0].unit}`);
  await wmList.locator('#unit-select').selectOption('auto');
  ok('Walmart: the list page\'s unit picker re-ranks per pound');

  // With the list open, a new search in the page fills it again ("Follow new searches in the side panel", on by default).
  const sortedState = () => worker.evaluate(() => chrome.storage.session.get('sortedResults').then(r => r.sortedResults || null));
  const until = async (check, what, ms = 90000) => {
    const end = Date.now() + ms;
    for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 400)); }
  };
  const firstRun = (await sortedState()).runId;
  await wm.bringToFront();
  await wm.getByRole('searchbox', { name: 'Search' }).fill('cereal');
  await wm.keyboard.press('Enter');
  await wm.waitForURL(/\/search\?q=cereal/);
  const followed = await until(async () => { const s = await sortedState(); return s && s.runId !== firstRun && /q=cereal/.test(s.sourceUrl) && !s.loading && s.items.length >= 13 ? s : null; }, 'the list to follow the new search');
  assert.match(followed.status, /Collected \d+ products/);
  assert.equal(followed.mode, 'unitPrice', 'and keeps the choice that was made');
  ok(`Walmart: with the list open, a new search ("cereal") fills it again by itself (${followed.items.length} results)`);

  // The keyboard shortcut: the worker opens the list, then tells this tab to start gathering (no menu click).
  const shortcutRun = followed.runId;
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  await worker.evaluate(({ id, url }) => globalThis.sortFromCommand('sort-health', { id, url, windowId: 1 }), { id: tabId, url: wm.url() });
  const byKey = await until(async () => { const s = await sortedState(); return s && s.runId !== shortcutRun && s.mode === 'health' && !s.loading && s.items.length >= 13 ? s : null; }, 'the shortcut\'s list');
  assert.match(byKey.status, /Collected \d+ products/);
  ok(`Walmart: the keyboard shortcut opens the list and the page gathers it (${byKey.items.length} results, score order)`);
  await wm.keyboard.press('Escape');

  // The reader's count caps the list: 15 of the 22.
  await setting({ sortCount: 15 });
  const capped = await chooseSort(wm, 'Price per ounce: Low to High');
  assert.equal((await listRows(capped)).length, 15);
  assert(/Collected 15 products/.test(await statusOf(capped)), await statusOf(capped));
  ok('Walmart: a count of 15 stops the list at 15 results');
  await capped.close();
  await setting({ sortCount: 30 });

  // The other entry: ranked by the Ingredient Check score.
  const health = await chooseSort(wm, 'Ingredient Check score: High to Low');
  const scores = (await listRows(health)).map(r => Number(r.score)).filter(Number.isFinite);
  assert(scores.length >= 17 && scores.every((v, i) => i === 0 || v <= scores[i - 1]), `score descends: ${scores}`);
  await shot(health, '06-walmart-list-score-high-to-low');
  ok('Walmart: Ingredient Check score: High to Low');
  await health.close();

  // Without "Load more results" only this page is listed, as on Amazon.
  await setting({ sortLoadMore: false });
  const first = await chooseSort(wm, 'Price per ounce: Low to High');
  assert.equal((await listRows(first)).length, 13, 'with Load more results off, this page\'s 13 results');
  await first.close();
  await setting({ sortLoadMore: true });
  ok('Walmart: with "Load more results" off, only this page is listed');

  // The side panel: the same list in the narrow column Chrome gives it.
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/src/options/sidepanel.html`);
  await settled(panel);
  await shot(panel, '06b-walmart-side-panel');
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'the side panel does not scroll sideways');
  await panel.close(); await wmList.close();
  ok('Walmart: the same list in the side panel\'s narrow column, no horizontal scrolling');

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
  await sortMenu(phone).getByRole('button', { name: 'Ingredient Check sort' }).click();
  assert.equal(await sortMenu(phone).getByRole('menuitem').first().isVisible(), true);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow on a phone');
  await shot(phone, '09-walmart-phone-sort-menu');
  ok('Walmart: phone width, ads hidden, the sort menu usable, no horizontal overflow');
  await phone.close();

  // ============================================================ Target
  await setting({ sortCount: 30 });
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
  ok('Target: search typed on the home page (no page load) -> extension active, results rated (the page\'s HTML holds no products; scripts draw them)');

  const tgList = await chooseSort(tg, 'Price per ounce: Low to High');
  const target = await listRows(tgList);
  const tStatus = await statusOf(tgList);
  assert.deepEqual([...new Set(pagesFetched.filter(p => p.startsWith('target')))].sort(), ['target:24', 'target:48', 'target:72'], 'pages 2 and 3 were rendered; the offset past the end stopped it');
  assert.equal(target.length, 20, `12 + 6 + 2 results (got ${target.length}: ${tStatus})`);
  assert(/Collected 20 products/.test(tStatus) && /Target has no more results/.test(tStatus), tStatus);
  assert(target.some(r => /Target page 2/.test(r.meta)) && target.some(r => /Target page 3/.test(r.meta)), 'results say which page they came from');
  const perOz = target.filter(r => /\/oz$/.test(r.unit)).map(r => money(r.unit));
  assert(perOz.length >= 14 && nonDecreasing(perOz), `price per ounce ascends across the pages: ${perOz.join(' ')}`);
  assert(/Rolled Oats Canister/.test(target[0].title) && /Target page 3/.test(target[0].meta), 'page 3\'s $0.12/oz is the cheapest');
  assert.equal(target.filter(r => /Sponsored/.test(r.meta)).length, 3, 'Target\'s three ads (one per page 1 and 2) are listed and marked Sponsored');
  await shot(tgList, '12-target-list-price-per-ounce-all-pages');
  ok(`Target: Price per ounce, results pages read through a rendered frame (20 results) -> ${perOz.slice(0, 5).join(' < ')} ...; ads marked Sponsored`);
  await tgList.locator('article.product .score-chip').first().hover();
  await tgList.waitForSelector('.why-pop', { timeout: 5000 });
  await shot(tgList, '12b-target-list-hover-notes');
  ok('Target: hovering a score on the list shows why it scored that way');
  await tgList.close();

  const tHealth = await chooseSort(tg, 'Ingredient Check score: High to Low');
  const tScores = (await listRows(tHealth)).map(r => Number(r.score)).filter(Number.isFinite);
  assert(tScores.length >= 16 && tScores.every((v, i) => i === 0 || v <= tScores[i - 1]), `score descends: ${tScores}`);
  ok('Target: Ingredient Check score: High to Low');
  await tHealth.close();
  await tg.locator('[data-test="ListingPageProductListing"] a[data-test="content"]').first().click();
  await tg.waitForURL(/\/p\//);
  await tg.waitForFunction(() => document.getElementById('air-score-panel')?.dataset.airState === 'scored', null, { timeout: 30000 });
  await shot(tg, '14-target-product-score-panel');
  ok('Target: product page reached from results shows its score panel');
  await tg.close();

  // ============================================================ Kroger (the other grocery banners share this adapter)
  // No next-page link and no page number: the store loads more as the page is scrolled, so the list does the same.
  await setting({ sortCount: 20, sortLoadMore: true });
  const kr = await open('https://www.kroger.com/search?query=oats');
  await kr.waitForFunction(() => document.querySelectorAll('[data-testid="product-card"]').length >= 8 && !!document.getElementById('air-retailer-sort'), null, { timeout: 60000 });
  const krList = await chooseSort(kr, 'Price per ounce: Low to High');
  const grocery = await listRows(krList);
  assert.equal(grocery.length, 20, `the count of 20 is reached by scrolling the page (got ${grocery.length}: ${await statusOf(krList)})`);
  const groceryUnits = grocery.map(r => money(r.unit));
  assert(grocery.every(r => /\/oz$/.test(r.unit)) && nonDecreasing(groceryUnits), `price per ounce ascends: ${groceryUnits.join(' ')}`);
  assert.equal(await kr.evaluate(() => scrollY), 0, 'the page is scrolled back to where it was');
  assert(/Collected 20 products/.test(await statusOf(krList)));
  await shot(krList, '13-kroger-list-price-per-ounce-by-scrolling');
  ok(`Kroger: no next-page address, so the page is scrolled to load more -> 20 results, ${groceryUnits.slice(0, 4).join(' < ')} ...; scroll position restored`);
  await krList.close(); await kr.close();

  assert.deepEqual(errors, [], 'no uncaught page errors');
  console.log(`\nretailer harness passed. Screenshots: ${shots}`);
} catch (error) {
  if (error.message !== 'repro-done') throw error;
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
