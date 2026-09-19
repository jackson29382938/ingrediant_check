#!/usr/bin/env node
// Drive tests/harness.html + tests/harness-lifecycle.html in Chromium.
// No Amazon network, no login. Used by CI (`npm run harness:ci`).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HARNESS_PORT || 8731);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };

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
  const require = createRequire(import.meta.url);
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
        const score = host?.shadowRoot?.querySelector('.score')?.textContent || '';
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
