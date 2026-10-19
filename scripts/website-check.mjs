// Check the static site under its production headers, or a deployed HTTPS site with --url.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../website');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
const PAGES = ['/privacy', '/features', '/scoring', '/stores', '/install', '/faq'];
const arg = process.argv.indexOf('--url');
let server, base;
if (arg >= 0) {
  const url = new URL(process.argv[arg + 1]);
  assert(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'Use the public production HTTPS origin, without a path, query, or credentials');
  base = url.origin;
} else {
  assert.equal(config.outputDirectory, '.'); assert.equal(config.buildCommand, null);
  server = createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (PAGES.some(r => route === r + '.html')) { res.writeHead(308, { location: route.slice(0, -5) }); res.end(); return; }
    const file = route === '/' ? 'index.html' : PAGES.includes(route) ? route.slice(1) + '.html' : route.slice(1);
    if (!(['index.html', ...PAGES.map(r => r.slice(1) + '.html'), 'styles.css', 'robots.txt'].includes(file) || /^img\/[\w-]+\.webp$/.test(file)) || !fs.existsSync(path.join(root, file))) {
      res.writeHead(404); res.end('Not found'); return;
    }
    for (const header of config.headers[0].headers) res.setHeader(header.key, header.value);
    res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.webp') ? 'image/webp' : 'text/plain');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
}
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.HARNESS_CHROME || undefined });
  const page = await browser.newPage(), errors = [], pages = new Map();
  page.on('pageerror', error => errors.push(error.message));
  for (const scheme of ['light', 'dark']) for (const width of [390, 1280]) for (const route of ['/', ...PAGES]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 20000 });
    assert.equal(response.status(), 200, route + ' must be public, without deployment protection');
    const headers = response.headers();
    assert(headers['content-security-policy']?.includes("script-src 'none'"), 'Static-site script policy missing');
    assert.equal(headers['x-content-type-options'], 'nosniff');
    if (route === '/') { await page.evaluate(() => Promise.all([...document.images].map(i => i.loading === 'lazy' ? (i.loading = 'eager', i.decode().catch(() => {})) : 0))); }
    const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      theme: getComputedStyle(document.documentElement).colorScheme, h1: document.querySelector('h1')?.textContent,
      scripts: document.scripts.length, brokenImages: [...document.images].filter(i => i.complete && !i.naturalWidth).length, noAlt: [...document.images].filter(i => !i.alt.trim()).length, missingAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(a => !document.getElementById(a.hash.slice(1))).length }));
    assert(state.h1 && !state.overflow && !state.scripts && !state.missingAnchors && !state.brokenImages && !state.noAlt, JSON.stringify(state));
    assert.equal(state.theme, scheme, 'Stylesheet/theme did not load');
    if (route === '/' || route === '/install') {
      await page.getByRole('heading', { name: 'Chrome', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Firefox', exact: true }).waitFor();
    }
    if (route === '/privacy') assert((await page.textContent('main')).includes('openid email profile'), 'OAuth scope disclosure missing');
    const seen = await page.evaluate(() => ({ current: document.querySelector('nav a[aria-current="page"]')?.getAttribute('href'),
      ids: [...document.querySelectorAll('[id]')].map(e => e.id),
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h.startsWith('/')) }));
    assert.equal(seen.current, route, route + ' must mark itself in the navigation');
    pages.set(route, seen);
    console.log(`  ok website ${route} ${scheme} ${width}px`);
  }
  // Every on-site link, and every #section it points at on another page, must exist.
  for (const [route, { links }] of pages) for (const href of links) {
    const [target, hash] = href.split('#'), known = pages.get(target || '/');
    assert(known, `${route} links to ${href}, which is not a page of this site`);
    if (hash) assert(known.ids.includes(hash), `${route} links to ${href}, but ${target || '/'} has no #${hash}`);
  }
  await page.goto(base); await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
  assert.equal(new URL(page.url()).pathname, '/privacy');
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
  assert.equal(new URL(page.url()).pathname, '/'); assert.deepEqual(errors, []);
  console.log('Website checks passed (pages, navigation, privacy, responsive themes, production headers).');
} finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
}
