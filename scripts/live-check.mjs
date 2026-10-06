#!/usr/bin/env node
// Live check of the unpacked extension on real store pages (signed out, public pages only).
//
//   NODE_PATH=<dir with playwright> HARNESS_CHROME=<Chrome for Testing> node scripts/live-check.mjs amazon target
//   options: --out <dir> (screenshots + report.json), --headed, --wait <seconds for search scoring>
//
// For each store it opens a search results page and a food product page (the first product link found on
// the search page, or a known product), waits for the extension, and records what it did: the product
// panel's state, how many score badges are on the results, and whether the store answered with a bot
// check instead of the page. It touches nothing but public pages and never signs in or solves a check.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const stores = args.filter((a, i) => !a.startsWith('--') && !['--out', '--wait'].includes(args[i - 1]));
const out = flag('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'ic-live-')));
const wait = Number(flag('--wait', 30)) * 1000;
fs.mkdirSync(out, { recursive: true });

// Where each store's search and a food product are. `link` finds a product on the search page.
const SITES = {
  amazon: { search: 'https://www.amazon.com/s?k=organic+rolled+oats&i=grocery', link: 'a[href*="/dp/"]', product: /\/dp\/[A-Z0-9]{10}/, known: 'https://www.amazon.com/dp/B0DX45213W' },
  target: { search: 'https://www.target.com/s?searchTerm=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/.*A-\d+/, known: 'https://www.target.com/p/-/A-79364857' },
  walmart: { search: 'https://www.walmart.com/search?q=organic+rolled+oats', link: 'a[href*="/ip/"]', product: /\/ip\//, known: 'https://www.walmart.com/ip/10314926' },
  costco: { search: 'https://www.costco.com/s?keyword=organic+oats', link: 'a[href*=".product."], a[href*="/p/"]', product: /\.product\.\d+\.html|\/p\/(?:[^/]+\/)+\d+/, known: 'https://www.costco.com/product.product.100423971.html' },
  kroger: { search: 'https://www.kroger.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/, known: 'https://www.kroger.com/p/quaker-old-fashioned-oats/0003000001020' },
  frys: { search: 'https://www.frysfood.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/, known: 'https://www.frysfood.com/p/quaker-old-fashioned-oats/0003000001020' },
  ralphs: { search: 'https://www.ralphs.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/, known: 'https://www.ralphs.com/p/quaker-old-fashioned-oats/0003000001020' },
  kingsoopers: { search: 'https://www.kingsoopers.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/, known: 'https://www.kingsoopers.com/p/quaker-old-fashioned-oats/0003000001020' },
  smiths: { search: 'https://www.smithsfoodanddrug.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/, known: 'https://www.smithsfoodanddrug.com/p/quaker-old-fashioned-oats/0003000001020' },
  fredmeyer: { search: 'https://www.fredmeyer.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/, known: 'https://www.fredmeyer.com/p/quaker-old-fashioned-oats/0003000001020' },
  qfc: { search: 'https://www.qfc.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/ , known: 'https://www.qfc.com/p/doritos-nacho-cheese-tortilla-chips/0002840051646' },
  harristeeter: { search: 'https://www.harristeeter.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/ , known: 'https://www.harristeeter.com/p/doritos-nacho-cheese-tortilla-chips/0002840051646' },
  dillons: { search: 'https://www.dillons.com/search?query=organic+rolled+oats', link: 'a[href*="/p/"]', product: /\/p\/[^/]+\/\d{10,14}/ , known: 'https://www.dillons.com/p/doritos-nacho-cheese-tortilla-chips/0002840051646' },
  safeway: { search: 'https://www.safeway.com/shop/search-results.html?q=organic+rolled+oats', link: 'a[href*="/shop/"]', product: /\/shop\/(?:pd\/product\/\d+|product-details\.\d+\.html)/ , known: 'https://www.safeway.com/shop/pd/product/111050071' },
  albertsons: { search: 'https://www.albertsons.com/shop/search-results.html?q=organic+rolled+oats', link: 'a[href*="/shop/"]', product: /\/shop\/(?:pd\/product\/\d+|product-details\.\d+\.html)/ , known: 'https://www.albertsons.com/shop/pd/product/111050071' },
  instacart: { search: 'https://www.instacart.com/store/s?k=organic+rolled+oats', link: 'a[href*="/products/"]', product: /\/products\/\d+/ },
};
const CHALLENGE = /press\s*&\s*hold|robot or human|verify you are human|access denied|are you a robot|unusual traffic|captcha|temporarily blocked|just a moment/i;

const pw = require('playwright');
const executablePath = process.env.HARNESS_CHROME || undefined;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-live-profile-'));
const context = await pw.chromium.launchPersistentContext(profile, {
  headless: !args.includes('--headed'), ...(executablePath ? { executablePath } : { channel: 'chromium' }),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  viewport: { width: 1360, height: 900 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, ...(args.includes('--headed') ? [] : ['--headless=new']), ...(process.env.HTTPS_PROXY ? ['--disable-http2'] : [])],
});
const report = {};

async function snapshot(page) {
  return page.evaluate(() => {
    const host = document.getElementById('air-score-panel');
    const badges = [...document.querySelectorAll('.air-badge')];
    return {
      title: document.title.slice(0, 90),
      text: (document.body && document.body.innerText || '').slice(0, 4000),
      panel: host ? { state: host.dataset.airState || '', connected: host.isConnected } : null,
      badges: badges.length,
      numericBadges: badges.filter(b => /^\d+$/.test((b.textContent || '').trim())).length,
      badgeValues: badges.slice(0, 12).map(b => (b.textContent || '').trim()),
      hasTiles: document.querySelectorAll('[data-asin], [data-test*="ProductCard"], [data-testid*="product"], [data-item-id], [class*="product-tile"], [data-automation-id*="product"]').length,
    };
  });
}

async function visit(name, label, url) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && /Ingredient|air-|AIR/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const entry = { url, ok: false };
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    entry.status = res && res.status();
    await page.waitForTimeout(6000);
    if (label === 'search') {
      // Scroll the way a reader does, so results below the fold are seen and scored.
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1200); }
      const until = wait;
      let seen = 0;
      for (let t = 0; t < until; t += 3000) {
        await page.waitForTimeout(3000);
        const s = await snapshot(page);
        if (s.badges !== seen) seen = s.badges;
        if (t > 9000 && s.badges >= 6) break;
      }
    } else {
      await page.waitForTimeout(16000);
    }
    const snap = await snapshot(page);
    entry.finalUrl = page.url();
    entry.title = snap.title;
    entry.challenge = CHALLENGE.test(snap.title + ' ' + snap.text.slice(0, 1500));
    entry.panel = snap.panel;
    entry.badges = snap.badges;
    entry.numericBadges = snap.numericBadges;
    entry.badgeValues = snap.badgeValues;
    entry.tilesGuess = snap.hasTiles;
    entry.errors = errors;
    entry.transportFailure = /upstream connect error|remote address:envoy:\/\/|transport failure reason/i.test(snap.text);
    entry.ok = !!res?.ok() && !entry.challenge && !entry.transportFailure;
    await page.screenshot({ path: path.join(out, `${name}-${label}.png`), fullPage: false }).catch(() => {});
  } catch (e) {
    entry.error = String(e.message || e).slice(0, 200);
  }
  report[name] = report[name] || {};
  report[name][label] = entry;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.error(`${name}/${label}: HTTP ${entry.status || 'unavailable'}, ${entry.numericBadges || 0} numeric scores, panel ${entry.panel?.state || 'none'}${entry.error ? `; ${entry.error}` : ''}`);
  const firstLink = label === 'search' && !entry.error ? await page.evaluate(({ sel, rx }) => {
    const re = new RegExp(rx);
    // Header promotions can link to unrelated products (Costco's gift cards, for
    // example). Prefer an actual scored result when selecting a food product.
    for (const badge of document.querySelectorAll('.air-badge')) {
      if (!/^\d+$/.test((badge.textContent || '').trim())) continue;
      for (let node = badge.parentElement; node && !/^(?:BODY|MAIN)$/.test(node.tagName); node = node.parentElement) {
        const links = node.matches('a[href]') ? [node] : [...node.querySelectorAll(sel)];
        const own = links.find(a => re.test(a.href));
        if (own) return own.href;
      }
    }
    const a = [...document.querySelectorAll(sel)].map(x => x.href).find(h => re.test(h));
    return a || '';
  }, { sel: SITES[name].link, rx: SITES[name].product.source }).catch(() => '') : '';
  await page.close();
  return firstLink;
}

for (const name of stores.length ? stores : Object.keys(SITES)) {
  const site = SITES[name];
  if (!site) { console.error(`unknown store ${name}`); continue; }
  console.error(`-- ${name}`);
  const link = await visit(name, 'search', site.search);
  const target = link || site.known;
  report[name].productUrl = target || '';
  if (target) await visit(name, 'product', target);
  else report[name].product = { ok: false, error: 'no product link found on the search page and none known' };
}
await context.close();
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error(`report and screenshots in ${out}`);
