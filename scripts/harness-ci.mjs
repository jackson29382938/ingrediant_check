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
