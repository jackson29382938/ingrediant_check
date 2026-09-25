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

      // Goals combine across tabs: picking one on another tab keeps that tab open with it selected,
      // and each tab counts its picks. (It used to jump back to the first goal's tab.)
      const pickGoal = async (category, n) => {
        await comparePage.click(`.preset-cat[data-category="${category}"]`);
        const id = await comparePage.evaluate(i => [...document.querySelectorAll('.preset')][i].dataset.preset, n);
        await comparePage.click(`.preset[data-preset="${id}"]`);
        await comparePage.waitForFunction(g => document.querySelector(`.preset[data-preset="${g}"]`)?.getAttribute('aria-pressed') === 'true', id, { timeout: 3000 });
        return id;
      };
      const g1 = await pickGoal('everyday', 1);
      const g2 = await pickGoal('goals', 0);
      const multi = await comparePage.evaluate(() => ({
        tab: document.querySelector('.preset-cat[aria-selected="true"]').dataset.category,
        labels: [...document.querySelectorAll('.preset-cat')].map(t => t.textContent),
        active: document.getElementById('presetActiveName').textContent,
      }));
      const stored = await comparePage.evaluate(() => new Promise(r => chrome.storage.local.get('goals', o => r(o.goals))));
      if (multi.tab !== 'goals' || JSON.stringify(stored) !== JSON.stringify([g1, g2]) || !/ \+ /.test(multi.active)
        || !multi.labels.some(l => / · 1$/.test(l)) || multi.labels.filter(l => / · 1$/.test(l)).length !== 2) {
        throw new Error(`popup goals: ${JSON.stringify({ ...multi, stored })}`);
      }
      console.log('  ok  popup goals → two goals on two tabs combine; the clicked tab stays open; tabs count their picks');

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

    // Amazon's Sort by menu (src/content/sort.js): two options join it; picking one is caught before
    // Amazon's own menu code, opens the side panel and sends the list; Amazon's page is not reordered.
    let sentResults = null;
    await withPage(browser, `${base}/tests/harness-sort.html`, async sortPage => {
      const unitText = 'Price per ounce: Low to High';
      const scoreText = 'Ingredient Check score: High to Low';
      await sortPage.waitForFunction(t => window.__options().includes(t), scoreText, { timeout: 10000 });
      const options = await sortPage.evaluate(() => window.__options());
      if (options.join('|') !== ['Featured', 'Price: Low to High', unitText, 'Price: High to Low', 'Avg. Customer Review',
        'Newest Arrivals', 'Best Sellers', scoreText].join('|')) throw new Error(`menu options: ${options}`);
      const original = await sortPage.evaluate(() => window.__order());
      await sortPage.click('#a-autoid-0');
      const rows = await sortPage.evaluate(() => window.__rows());
      if (!rows || !rows.includes(unitText) || !rows.includes(scoreText)) throw new Error(`menu rows: ${rows}`);
      await sortPage.click(`.a-popover a:text-is("${unitText}")`);
      await sortPage.waitForFunction(() => window.__final(), { timeout: 10000 });
      const run = await sortPage.evaluate(() => ({
        picks: window.__amazonPicks, open: window.__messages.filter(m => m.type === 'openSortedPanel'),
        menuOpen: !!window.__rows(), order: window.__order(), final: window.__final(),
        select: document.getElementById('s-result-sort-select').value,
        updates: window.__messages.filter(m => m.type === 'updateSortedResults').length,
        types: [...new Set(window.__messages.map(m => m.type))],
      }));
      if (run.picks.length || run.open.length !== 1 || run.open[0].mode !== 'unitPrice' || run.open[0].sourceUrl.indexOf('/s?k=organic+oats') < 0
        || run.menuOpen || run.select !== 'relevanceblender' || JSON.stringify(run.order) !== JSON.stringify(original)) {
        throw new Error(`menu pick: ${JSON.stringify({ ...run, final: undefined })}`);
      }
      const items = run.final.items;
      const by = Object.fromEntries(items.map(r => [r.asin, r]));
      const near = (a, b) => a != null && Math.abs(a - b) < 0.001;
      if (items.length !== 8 || by.B0SORT0003.title !== 'Organic rolled oats, 32 oz' || by.B0SORT0003.score !== 90
        || !near(by.B0SORT0003.unitPrice, 0.18) || by.B0SORT0003.unitSource !== 'amazon' || by.B0SORT0003.ratingValue !== 4.7
        || by.B0SORT0003.reviewCount !== 12345 || !/1K\+ bought/.test(by.B0SORT0003.bought) || by.B0SORT0003.listingPrice !== 6.29
        || !near(by.B0SORT0008.unitPrice, 7.99 / 88) || !near(by.B0SORT0006.unitPrice, 5.49 / 32) || by.B0SORT0004.unitPrice !== null
        || by.B0SORT0006.title !== 'Steel cut oats, 2 lb' || items.some(r => /^\d+$/.test(r.title))
        // Current and grocery card markup (no `h2 a`, no image link class): found, titled, linked.
        || by.B0SORT0002.title !== 'Oats, never opened, 18 oz' || !/\/dp\/B0SORT0002\//.test(by.B0SORT0002.url) || by.B0SORT0002.reviewCount !== 2310
        || by.B0SORT0005.title !== 'Oat bar, never opened' || !/\/dp\/B0SORT0005/.test(by.B0SORT0005.url)
        || by.B0SORT0007.title !== 'Oat milk, never opened' || !/\/dp\/B0SORT0007$/.test(by.B0SORT0007.url)
        || !/3 without a score are at the end/.test(run.final.status)) {
        throw new Error(`list sent: ${JSON.stringify({ items, status: run.final.status })}`);
      }
      // productsLookup is the badge pass asking the worker (it answers from the shared database only when that is
      // on); logAction is a line for "Report a problem"'s recent actions.
      if (run.types.some(t => !['openSortedPanel', 'updateSortedResults', 'productsLookup', 'logAction'].includes(t))) throw new Error(`messages: ${run.types}`);
      sentResults = items;

      // The score option, from the keyboard (a change on the <select> itself).
      await sortPage.evaluate(v => {
        const select = document.getElementById('s-result-sort-select');
        select.value = v;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, 'ingredient-check-score');
      await sortPage.waitForFunction(() => window.__messages.filter(m => m.type === 'openSortedPanel').length === 2, { timeout: 5000 });
      const keyboard = await sortPage.evaluate(() => ({ mode: window.__messages.filter(m => m.type === 'openSortedPanel')[1].mode,
        select: document.getElementById('s-result-sort-select').value }));
      if (keyboard.mode !== 'health' || keyboard.select !== 'relevanceblender') throw new Error(`keyboard pick: ${JSON.stringify(keyboard)}`);

      // Price per ounce off: its option leaves the menu, including a list Amazon already built.
      await sortPage.click('#a-autoid-0');
      await sortPage.evaluate(() => window.__set('unitPrice', false));
      await sortPage.waitForFunction(t => !window.__options().includes(t) && !(window.__rows() || []).includes(t), unitText, { timeout: 5000 });
      const after = await sortPage.evaluate(() => ({ options: window.__options(), rows: window.__rows() }));
      if (!after.options.includes(scoreText) || !(after.rows || []).includes(scoreText)) throw new Error(`unit off: ${JSON.stringify(after)}`);
      // Amazon's own options still work as before.
      await sortPage.click('.a-popover a:text-is("Price: High to Low")');
      const picks = await sortPage.evaluate(() => window.__amazonPicks);
      if (picks.join() !== 'price-desc-rank') throw new Error(`Amazon's own option: ${picks}`);
      console.log(`  ok  sort menu → 2 options in Amazon's list; a pick opens the panel (Amazon's page untouched), sends ${items.length} listings with price per ounce; keyboard works; off removes it`);
    });

    // The list page: side panel and tab, ranked by the priority bar, unsafe input dropped.
    const listStub = ({ items, view }) => {
      window.__calls = [];
      const sessionData = { sortedResults: { runId: 'r1', mode: 'health', unitEnabled: true, loading: false, status: 'Collected 9 products.',
        items, sourceUrl: 'https://www.amazon.com/s?k=organic+oats', sourceTabId: 3, sourceWindowId: 1 } };
      window.chrome = {
        runtime: { lastError: null, getURL: p => `chrome-extension://ext/${p}`, sendMessage: () => {} },
        i18n: { getMessage: () => '' },
        windows: { getCurrent: cb => cb({ id: 1 }), update: () => Promise.resolve() },
        tabs: {
          create: o => { window.__calls.push(['tabs.create', o.url]); return Promise.resolve({}); },
          get: id => Promise.resolve({ id, windowId: 1, url: 'https://www.amazon.com/dp/B0SORT0003' }),
          update: (id, o) => { window.__calls.push(['tabs.update', id, o.url || '', o.active]); return Promise.resolve({}); },
          sendMessage: (id, m) => { window.__calls.push(['tabs.sendMessage', id, m.type]); },
        },
        sidePanel: { open: o => { window.__calls.push(['sidePanel.open', o.windowId]); return Promise.resolve(); } },
        storage: { onChanged: { addListener() {} }, session: {
          get: () => Promise.resolve(JSON.parse(JSON.stringify(sessionData))),
          set: v => { window.__calls.push(['session.set', Object.keys(v).join()]); return Promise.resolve(); },
        } },
      };
      void view;
    };
    const items = sentResults.map(r => ({ ...r, url: `https://www.amazon.com/dp/${r.asin}` }))
      .concat([{ asin: 'B0SORT0099', url: 'javascript:alert(1)', title: 'Unsafe link', score: 99, image: 'https://evil.example/x.png' }]);
    const listPage = await browser.newPage();
    try {
      await listPage.addInitScript(listStub, { items, view: 'tab' });
      await listPage.goto(`${base}/src/options/sorted.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await listPage.waitForFunction(() => document.querySelectorAll('.product').length > 0, { timeout: 8000 });
      const read = () => listPage.evaluate(() => ({
        asins: [...document.querySelectorAll('.product h2 a')].map(a => a.href.slice(-10)),
        chips: [...document.querySelectorAll('.score-chip')].map(c => c.textContent),
        units: [...document.querySelectorAll('.fact.unit')].map(c => c.textContent),
        title: document.querySelector('h1').textContent,
        unsafe: [...document.querySelectorAll('a')].filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length,
        evilImg: [...document.querySelectorAll('img')].filter(i => /evil/.test(i.src)).length,
        buttons: [...document.querySelectorAll('.header-actions button:not([hidden])')].map(b => b.textContent),
      }));
      const health = await read();
      if (health.chips.join() !== '99,95,90,72,40,40,–,–,–' || health.unsafe || health.evilImg || health.title !== 'Healthiest first'
        || health.buttons.join('|') !== 'Back to Amazon search|Open side panel|Settings') {
        throw new Error(`list (health): ${JSON.stringify(health)}`);
      }
      await listPage.click('.chip[data-preset="unitPrice"]');
      const unit = await read();
      if (unit.asins.slice(0, 5).join() !== 'B0SORT0008,B0SORT0006,B0SORT0003,B0SORT0002,B0SORT0001'
        || unit.title !== 'Lowest price per ounce first' || unit.units[0] !== '$0.09/oz') throw new Error(`list (price per ounce): ${JSON.stringify(unit)}`);
      // A slider: health back up to 10 with price per ounce still at 10 is a mix, not a preset.
      await listPage.evaluate(() => {
        const input = document.querySelector('.slider[data-factor="health"] input');
        input.value = '10';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const mixed = await read();
      if (mixed.title !== 'Ranked by your priorities' || !(await listPage.$('.fact.match'))) throw new Error(`list (mixed): ${JSON.stringify(mixed)}`);
      await listPage.click('text=Open side panel');
      await listPage.waitForFunction(() => window.__calls.some(c => c[0] === 'session.set'), { timeout: 3000 });
      const tabCalls = await listPage.evaluate(() => window.__calls);
      if (!tabCalls.some(c => c[0] === 'sidePanel.open' && c[1] === 1)) throw new Error(`open side panel: ${JSON.stringify(tabCalls)}`);
    } finally {
      await listPage.close();
    }
    const panelPage = await browser.newPage();
    try {
      await panelPage.addInitScript(listStub, { items, view: 'panel' });
      await panelPage.goto(`${base}/src/options/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await panelPage.waitForFunction(() => document.querySelectorAll('.product').length > 0, { timeout: 8000 });
      const buttons = await panelPage.evaluate(() => [...document.querySelectorAll('.header-actions button:not([hidden])')].map(b => b.textContent));
      if (buttons.join('|') !== 'Back to Amazon search|Open in new tab|Settings') throw new Error(`panel buttons: ${buttons}`);
      await panelPage.click('text=Open in new tab');
      await panelPage.click('text=Back to Amazon search');
      await panelPage.waitForFunction(() => window.__calls.some(c => c[0] === 'tabs.update'), { timeout: 3000 });
      const calls = await panelPage.evaluate(() => window.__calls);
      if (!calls.some(c => c[0] === 'tabs.create' && /src\/options\/sorted\.html$/.test(c[1]))
        || !calls.some(c => c[0] === 'tabs.update' && c[1] === 3 && c[2] === 'https://www.amazon.com/s?k=organic+oats' && c[3] === true)) {
        throw new Error(`panel calls: ${JSON.stringify(calls)}`);
      }
      console.log('  ok  sorted list → priority bar re-ranks (health, price per ounce, a mix); panel has Open in new tab beside Back to Amazon search; unsafe link and image dropped');
    } finally {
      await panelPage.close();
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

      // Price per ounce and speed: on / "clear weight" / Balanced by default, each saved on change.
      const more = await settingsPage.evaluate(() => ({
        unit: document.getElementById('unitPrice').checked,
        missing: document.querySelector('input[name="unitMissing"]:checked')?.value,
        speed: document.querySelector('input[name="speedMode"]:checked')?.value,
        nav: !!document.querySelector('nav a[href="#sec-speed"], a[href="#sec-speed"]'),
      }));
      if (!more.unit || more.missing !== 'calculate-clear' || more.speed !== 'balanced' || !more.nav) {
        throw new Error(`unit/speed defaults: ${JSON.stringify(more)}`);
      }
      await settingsPage.click('input[name="unitMissing"][value="displayed-only"]');
      await settingsPage.click('input[name="speedMode"][value="freshest"]');
      await settingsPage.click('#unitPrice');
      await settingsPage.waitForFunction(() => window.__stored.unitMissing === 'displayed-only' && window.__stored.speedMode === 'freshest'
        && window.__stored.unitPrice === false, { timeout: 5000 });
      const disabled = await settingsPage.evaluate(() => [...document.querySelectorAll('input[name="unitMissing"]')].every(r => r.disabled));
      if (!disabled) throw new Error('unit price off should disable its choices');
      console.log('  ok  settings → price per ounce on, "clear weight", speed Balanced by default; each saves; off disables its choices');
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
