#!/usr/bin/env node
// Drive tests/harness.html + lifecycle + OCR smoke + popup compare in Chromium.
// No Amazon network, no login. Used by CI (`npm run harness:ci`).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HARNESS_PORT || 8731);
const TYPES = {
  '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json',
  '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let p;
      try {
        p = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
      } catch {
        res.writeHead(400); return res.end('bad request');
      }
      if (p === '/') p = '/tests/harness.html';
      if (p === '/fixtures.js') p = '/tests/harness-fixtures.js';
      const file = path.resolve(root, p.replace(/^[/\\]+/, ''));
      const insideRoot = file === root || file.startsWith(root + path.sep);
      if (!insideRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function loadPlaywright() {
  const candidates = [
    'playwright',
    'playwright-core',
    path.join(root, 'node_modules', 'playwright'),
    path.join(root, 'node_modules', 'playwright-core'),
  ];
  for (const spec of candidates) {
    try { return require(spec); } catch { /* try next */ }
  }
  return null;
}

async function withPage(browser, url, fn) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function run() {
  const pw = loadPlaywright();
  if (!pw || !pw.chromium) {
    console.error('harness-ci: Playwright is not installed. CI installs it for this job only.');
    process.exit(1);
  }
  const server = await startServer();
  const browser = await pw.chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await withPage(browser, `${base}/`, async page => {
      await page.waitForFunction(() => {
        const v = document.getElementById('verdict');
        return v && /via nic-ingredients-content/.test(v.textContent || '');
      }, { timeout: 15000 });
      const oats = await page.evaluate(() => {
        const host = document.getElementById('air-score-panel');
        const verdict = document.getElementById('verdict')?.textContent || '';
        const shadow = (window.AIR && AIR.panel && AIR.panel.shadowOf && AIR.panel.shadowOf(host))
          || host?.shadowRoot;
        const score = shadow?.querySelector('.score')?.textContent || '';
        return { verdict, score, hasPanel: !!host };
      });
      if (!oats.hasPanel) throw new Error('panel harness: oats fixture did not mount a panel');
      if (Number(oats.score) < 85) throw new Error(`panel harness: oats scored ${oats.score}`);
      console.log('  ok  panel oats →', oats.score, oats.verdict.replace(/\s+/g, ' ').slice(0, 80));

      await page.click('button[data-fx="shampoo"]');
      await page.waitForFunction(() => /NOT FOOD/i.test(document.getElementById('verdict')?.textContent || ''), { timeout: 8000 });
      console.log('  ok  panel shampoo → not food');

      await page.click('button[data-fx="none"]');
      await page.waitForFunction(() => /extract failed/i.test(document.getElementById('verdict')?.textContent || ''), { timeout: 8000 });
      console.log('  ok  panel none → paste / failure');
    });

    await withPage(browser, `${base}/tests/harness-lifecycle.html`, async page => {
      await page.waitForFunction(() => window.__lifecycle && window.__lifecycle.phase === 'done', { timeout: 20000 });
      const life = await page.evaluate(() => window.__lifecycle);
      if (life.panelState !== 'scored') throw new Error(`lifecycle: expected scored, got ${life.panelState}`);
      if (life.extractCalls !== 1) throw new Error(`lifecycle: extractCalls ${life.extractCalls}, expected 1`);
      if ((life.extractsDuringChurn || 0) !== 0) {
        throw new Error(`lifecycle: extractsDuringChurn ${life.extractsDuringChurn}, expected 0`);
      }
      console.log('  ok  lifecycle food →', JSON.stringify({
        panelState: life.panelState, extractCalls: life.extractCalls, extractsDuringChurn: life.extractsDuringChurn,
      }));
    });

    await withPage(browser, `${base}/tests/harness-lifecycle.html?kind=nonfood`, async page => {
      await page.waitForFunction(() => window.__lifecycle && window.__lifecycle.phase === 'done', { timeout: 20000 });
      const life = await page.evaluate(() => window.__lifecycle);
      if (life.panelState !== 'not-food') throw new Error(`lifecycle nonfood: expected not-food, got ${life.panelState}`);
      if (life.extractCalls !== 0) throw new Error(`lifecycle nonfood: extractCalls ${life.extractCalls}, expected 0`);
      console.log('  ok  lifecycle shampoo → not-food, extractCalls 0');
    });

    await withPage(browser, `${base}/tests/harness-ocr.html`, async page => {
      await page.waitForFunction(() => window.__ocrSmoke && (window.__ocrSmoke.ok || window.__ocrSmoke.error), { timeout: 90000 });
      const smoke = await page.evaluate(() => window.__ocrSmoke);
      if (!smoke || !smoke.ok) throw new Error(`ocr harness: worker did not start (${smoke && smoke.error})`);
      if (!smoke.workerReady) throw new Error('ocr harness: workerReady is false');
      console.log('  ok  ocr smoke → vendored Tesseract worker started (no Amazon)');
    });

    const cache = require(path.join(root, 'src/engine/db/score-cache.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const version = manifest.version;
    const fp = cache.fingerprint({});
    const now = Date.now();
    const store = 'www.amazon.com';
    const oatsKey = cache.key(store, 'B08KQM8K62');
    const barKey = cache.key(store, 'B00LOAW7U6');
    const milkKey = cache.key(store, 'B000000003');
    const seed = {
      enabled: true, badges: true, foodOnly: true,
      [oatsKey]: {
        schema: cache.SCHEMA, t: now - 1000, v: version, store, asin: 'B08KQM8K62',
        prefs: fp, source: 'page', score: 96, name: 'Organic Rolled Oats', verdict: 'Excellent', nova: 1,
      },
      [barKey]: {
        schema: cache.SCHEMA, t: now, v: version, store, asin: 'B00LOAW7U6',
        prefs: fp, source: 'page', score: 28, name: 'Kefir', verdict: 'Poor', nova: 4,
      },
      [milkKey]: {
        schema: cache.SCHEMA, t: now - 2000, v: version, store, asin: 'B000000003',
        prefs: fp, source: 'page', score: 74, name: 'Whole Milk', verdict: 'Good', nova: 1,
      },
    };
    const comparePage = await browser.newPage();
    try {
      await comparePage.addInitScript(({ version: v, seed: data }) => {
        window.chrome = {
          runtime: { lastError: null, getManifest: () => ({ version: v }), openOptionsPage() {} },
          i18n: { getMessage: () => '' },
          tabs: { query: (q, cb) => cb([]) },
          permissions: {
            contains: (p, cb) => cb(false),
            request: (p, cb) => cb(false),
            remove: (p, cb) => cb(true),
          },
          storage: {
            onChanged: { addListener() {} },
            local: {
              get(keys, cb) {
                const result = keys == null ? { ...data }
                  : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]));
                if (typeof cb === 'function') cb(result);
                return Promise.resolve(result);
              },
              set(values, cb) {
                Object.assign(data, values);
                if (typeof cb === 'function') cb();
                return Promise.resolve();
              },
              remove(keys, cb) {
                for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k];
                if (typeof cb === 'function') cb();
                return Promise.resolve();
              },
            },
          },
        };
      }, { version, seed });
      await comparePage.goto(`${base}/src/options/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await comparePage.waitForFunction(() => {
        const pick = document.getElementById('comparePick');
        const grid = document.getElementById('compareGrid');
        return pick && !pick.hidden && grid && grid.querySelectorAll('.compare-card').length === 2;
      }, { timeout: 8000 });
      const cmp = await comparePage.evaluate(() => {
        const nums = [...document.querySelectorAll('.compare-card .ps-num')].map(el => el.textContent);
        const empty = document.getElementById('compareEmpty');
        return { nums, emptyHidden: !!(empty && empty.hidden), options: document.getElementById('compareA').options.length };
      });
      if (cmp.options < 2) throw new Error(`compare: expected 2+ options, got ${cmp.options}`);
      if (!cmp.emptyHidden) throw new Error('compare: empty copy still visible with two cache hits');
      if (!cmp.nums.includes('96') || !cmp.nums.includes('28')) {
        throw new Error(`compare: cards ${JSON.stringify(cmp.nums)}, expected 96 and 28`);
      }
      await comparePage.selectOption('#compareB', milkKey);
      await comparePage.waitForFunction(() => {
        const nums = [...document.querySelectorAll('.compare-card .ps-num')].map(el => el.textContent);
        return nums.includes('74');
      }, { timeout: 5000 });
      console.log('  ok  popup compare →', cmp.nums.join(' vs '), `(${cmp.options} cached, B→74)`);

      // The Amazon-request options must say so without "Why these matter" being opened.
      const net = await comparePage.evaluate(() => {
        const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
        const line = id => document.getElementById(id).closest('label').querySelector('.net');
        return {
          auto: shown(line('autoScoreSearch')), hover: shown(line('hoverScore')),
          link: shown(document.getElementById('openNetwork')),
          longHidden: !shown(document.getElementById('autoScoreSearch').closest('label').querySelector('.d')),
        };
      });
      if (!net.auto || !net.hover || !net.link || !net.longHidden) {
        throw new Error(`popup network disclosure: ${JSON.stringify(net)}`);
      }
      console.log('  ok  popup names Amazon requests up front (auto-rate, hover, access link)');
    } finally {
      await comparePage.close();
    }

    // Popup on a Target tab: Chrome hides the address (no host permission), so the card comes from
    // the content script's own reply, validated like a cached score.
    const targetPopup = await browser.newPage();
    try {
      await targetPopup.addInitScript(({ v }) => {
        const data = {};
        window.chrome = {
          runtime: { lastError: null, getManifest: () => ({ version: v }), openOptionsPage() {} },
          i18n: { getMessage: () => '' },
          tabs: {
            query: (q, cb) => cb([{ id: 7 }]),
            // Built in the page, where AIR.db.scoreCache exists, so the fingerprint is the real one.
            sendMessage: async () => ({
              schema: AIR.db.scoreCache.SCHEMA, v, t: Date.now() - 1000, store: 'target.com', asin: '16600402',
              prefs: AIR.db.scoreCache.fingerprint({}, 'page'), score: 96, verdict: 'Excellent', nova: 3,
              source: 'page', provenanceSource: '', name: 'Boulder Canyon Avocado Oil Chips' }),
          },
          permissions: { contains: (p, cb) => cb(false) },
          storage: { onChanged: { addListener() {} }, local: {
            get(keys, cb) { const r = {}; if (typeof cb === 'function') cb(r); return Promise.resolve(r); },
            set(values, cb) { Object.assign(data, values); if (typeof cb === 'function') cb(); return Promise.resolve(); },
          } },
        };
      }, { v: version });
      await targetPopup.goto(`${base}/src/options/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await targetPopup.waitForFunction(() => !document.getElementById('pageScore').hidden, { timeout: 8000 });
      const card = await targetPopup.evaluate(() => document.getElementById('pageScore').innerText.replace(/\s+/g, ' '));
      if (!/This page · Target/i.test(card) || !/96/.test(card)) throw new Error(`target popup card: ${card}`);
      console.log('  ok  popup → Target tab card from the content script\'s reply:', card.trim());
    } finally {
      await targetPopup.close();
    }

    // Sort by score (src/content/sort.js) on an Amazon-shaped page with seeded scores and no fetching.
    let sentResults = null;
    await withPage(browser, `${base}/tests/harness-sort.html`, async sortPage => {
      await sortPage.waitForFunction(() => window.__toolbar && window.__toolbar(), { timeout: 10000 });
      const original = await sortPage.evaluate(() => window.__order());
      await sortPage.evaluate(() => window.__toolbar().querySelector('.sort').click());
      await sortPage.waitForFunction(() => /Sorted/.test(window.__toolbar().querySelector('.status').textContent), { timeout: 10000 });
      const sortedOrder = await sortPage.evaluate(() => window.__order());
      const expected = ['B0SORT0006', 'B0SORT0003', 'B0SORT0008', 'B0SORT0001', 'B0SORT0004', 'B0SORT0002', 'B0SORT0005', 'B0SORT0007'];
      if (JSON.stringify(sortedOrder) !== JSON.stringify(expected)) throw new Error(`sort order: ${sortedOrder}`);
      const status = await sortPage.evaluate(() => window.__toolbar().querySelector('.status').textContent);
      if (!/3 without a score are at the end/.test(status)) throw new Error(`sort status: ${status}`);
      await sortPage.evaluate(() => window.__toolbar().querySelector('.restore').click());
      const restored = await sortPage.evaluate(() => window.__order());
      if (JSON.stringify(restored) !== JSON.stringify(original)) throw new Error(`restore: ${restored}`);
      await sortPage.evaluate(() => window.__toolbar().querySelector('.open').click());
      await sortPage.waitForFunction(() => window.__messages.some(m => m.type === 'openSortedResults'), { timeout: 5000 });
      const msg = await sortPage.evaluate(() => window.__messages.find(m => m.type === 'openSortedResults'));
      if (msg.results.map(r => r.asin).join() !== expected.join()) throw new Error(`sent list: ${msg.results.map(r => r.asin)}`);
      // Every card already shows its cached badge inside the title; the badge must not become the title.
      const badges = await sortPage.evaluate(() => document.querySelectorAll('.s-main-slot .air-badge').length);
      const titles = Object.fromEntries(msg.results.map(r => [r.asin, r.title]));
      if (badges < 5 || titles.B0SORT0003 !== 'Organic rolled oats' || titles.B0SORT0006 !== 'Steel cut oats'
        || msg.results.some(r => /^\d+$/.test(r.title) || /^\d{2}\n/.test(r.details))) {
        throw new Error(`titles: ${JSON.stringify(titles)} (${badges} badges)`);
      }
      const oats = msg.results.find(r => r.asin === 'B0SORT0003');
      if (oats.listingPrice !== 6.29 || !/1K\+ bought/.test(oats.bought) || oats.score !== 90) throw new Error(`listing: ${JSON.stringify(oats)}`);
      const fetches = await sortPage.evaluate(() => window.__messages.filter(m => m.type !== 'openSortedResults').map(m => m.type));
      sentResults = msg.results;
      console.log(`  ok  sort → ${expected.length} cards by score, restore puts Amazon's order back, list sent (${fetches.length} worker messages, no fetch)`);
    });

    // The sorted list page renders what the worker stored, and drops anything unsafe on the way in.
    const listPage = await browser.newPage();
    try {
      const items = sentResults.map(r => ({ ...r, url: `https://www.amazon.com/dp/${r.asin}` }))
        .concat([{ asin: 'B0SORT0099', url: 'javascript:alert(1)', title: 'Unsafe link', score: 99, image: 'https://evil.example/x.png' }]);
      await listPage.addInitScript(({ items }) => {
        window.chrome = {
          runtime: { lastError: null, sendMessage: (m, cb) => cb && cb({ ok: true }) },
          i18n: { getMessage: () => '' },
          storage: { onChanged: { addListener() {} }, session: {
            get: () => Promise.resolve({ sortedResults: { items, sourceUrl: 'https://www.amazon.com/s?k=organic+oats' } }),
          } },
        };
      }, { items });
      await listPage.goto(`${base}/src/options/sorted.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await listPage.waitForFunction(() => document.querySelectorAll('.product').length > 0, { timeout: 8000 });
      const view = await listPage.evaluate(() => ({
        titles: [...document.querySelectorAll('.product h2')].map(h => h.textContent),
        chips: [...document.querySelectorAll('.score-chip')].map(c => c.textContent),
        unsafe: [...document.querySelectorAll('a')].filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length,
        evilImg: [...document.querySelectorAll('img')].filter(i => /evil/.test(i.src)).length,
        back: document.querySelector('a.button')?.getAttribute('href'),
        panelButton: !!document.querySelector('button.button'),
      }));
      if (view.chips.join() !== '99,95,90,72,40,40,–,–,–' || view.unsafe || view.evilImg
        || view.back !== 'https://www.amazon.com/s?k=organic+oats' || !view.panelButton) {
        throw new Error(`sorted list: ${JSON.stringify(view)}`);
      }
      console.log('  ok  sorted list → best first, unscored last, unsafe link and foreign image dropped, back link kept');
    } finally {
      await listPage.close();
    }

    // Settings: the same two switches, their explanation, and the stores named from the manifest.
    const settingsPage = await browser.newPage();
    try {
      await settingsPage.addInitScript(({ hosts }) => {
        const data = {};
        window.__stored = data;
        window.chrome = {
          runtime: { lastError: null, getManifest: () => ({ version: '0', host_permissions: hosts }),
            sendMessage: (m, cb) => { if (typeof cb === 'function') cb(undefined); } },
          i18n: { getMessage: () => '' },
          storage: {
            onChanged: { addListener() {} },
            local: {
              get(keys, cb) {
                const result = keys == null ? { ...data }
                  : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]));
                if (typeof cb === 'function') cb(result);
                return Promise.resolve(result);
              },
              set(values, cb) { Object.assign(data, values); if (typeof cb === 'function') cb(); return Promise.resolve(); },
            },
          },
        };
      }, { hosts: manifest.host_permissions });
      await settingsPage.goto(`${base}/src/options/options.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settingsPage.waitForFunction(() => /amazon\.co\.jp/.test(document.getElementById('amazonStores').textContent),
        { timeout: 8000 });
      const before = await settingsPage.evaluate(() => ({
        stores: document.getElementById('amazonStores').textContent.split(', ').length,
        auto: document.getElementById('autoScoreSearch').checked,
        hover: document.getElementById('hoverScore').checked,
      }));
      if (before.stores !== manifest.host_permissions.length || !before.auto || before.hover) {
        throw new Error(`settings search scoring: ${JSON.stringify(before)}`);
      }
      await settingsPage.click('#autoScoreSearch');
      await settingsPage.waitForFunction(() => window.__stored.autoScoreSearch === false, { timeout: 5000 });
      console.log(`  ok  settings → auto-rate and hover switches, ${before.stores} stores from the manifest, saves off`);

      // Store wishlist: the list comes from the registry, and the draft link only exists once valid.
      const idle = await settingsPage.evaluate(() => ({
        rows: [...document.querySelectorAll('#storeList li')].map(li => li.querySelector('strong').textContent
          + ':' + li.querySelector('.store-badge').className.replace('store-badge ', '')),
        href: document.getElementById('reqSend').getAttribute('href'),
        disabled: document.getElementById('reqSend').getAttribute('aria-disabled'),
      }));
      if (idle.rows.join() !== 'Amazon:supported,Target:preview,Walmart:planned,Costco:planned'
        || idle.href !== '#' || idle.disabled !== 'true') throw new Error(`stores idle: ${JSON.stringify(idle)}`);
      await settingsPage.fill('#reqName', 'Marks & Spencer');
      await settingsPage.fill('#reqUrl', 'https://www.marksandspencer.com/food/p/12345?utm_source=x');
      const ready = await settingsPage.evaluate(() => ({
        href: document.getElementById('reqSend').getAttribute('href'),
        disabled: document.getElementById('reqSend').getAttribute('aria-disabled'),
        preview: document.getElementById('reqPreview').textContent,
        notes: document.getElementById('reqNotes').textContent,
      }));
      if (!ready.href.startsWith('mailto:jackson29382938@gmail.com?subject=Store%20request%3A%20Marks%20%26%20Spencer&body=')
        || ready.disabled !== 'false' || /12345|utm/.test(ready.href + ready.preview)
        || !/Website: https:\/\/www\.marksandspencer\.com\n/.test(ready.preview) || !/removed/.test(ready.notes)) {
        throw new Error(`stores ready: ${JSON.stringify(ready)}`);
      }
      await settingsPage.fill('#reqUrl', 'javascript:alert(1)');
      const bad = await settingsPage.evaluate(() => ({
        href: document.getElementById('reqSend').getAttribute('href'),
        error: document.getElementById('reqUrlError').textContent,
      }));
      if (bad.href !== '#' || !bad.error) throw new Error(`stores invalid: ${JSON.stringify(bad)}`);
      await settingsPage.fill('#reqName', 'Amazon');
      await settingsPage.fill('#reqUrl', '');
      const dup = await settingsPage.evaluate(() => document.getElementById('reqNameError').textContent);
      if (!/already works/.test(dup)) throw new Error(`stores duplicate: ${dup}`);
      console.log('  ok  settings → store list from the registry; request draft previewed, trimmed to the site, refused when invalid');

      // Sort settings: defaults, bounded count, saved on change.
      const sortDefaults = await settingsPage.evaluate(() => ({
        missing: document.querySelector('input[name="sortMissing"]:checked')?.value,
        more: document.getElementById('sortLoadMore').checked,
        countDisabled: document.getElementById('sortCount').disabled,
        count: document.getElementById('sortCount').value,
      }));
      if (sortDefaults.missing !== 'rate-first' || sortDefaults.more || !sortDefaults.countDisabled || sortDefaults.count !== '100') {
        throw new Error(`sort defaults: ${JSON.stringify(sortDefaults)}`);
      }
      await settingsPage.click('#sortLoadMore');
      await settingsPage.fill('#sortCount', '9999');
      await settingsPage.dispatchEvent('#sortCount', 'change');
      await settingsPage.click('input[name="sortMissing"][value="end"]');
      await settingsPage.waitForFunction(() => window.__stored.sortLoadMore === true && window.__stored.sortCount === 500
        && window.__stored.sortMissing === 'end', { timeout: 5000 });
      console.log('  ok  settings → sort: rate first / off / 100 by default; saves load more, count clamped to 500, missing → end');
    } finally {
      await settingsPage.close();
    }
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
  console.log('\nharness CI passed (no Amazon network)');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
