// Local HTTPS fixtures for real Firefox content scripts. All proxy traffic stays on loopback.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export async function fixtures(root, folder) {
  const common = '<h1>Whole grain rolled oats</h1><section><h3>Ingredients</h3><p>whole grain rolled oats</p></section>';
  const walmart = fs.readFileSync(root + '/tests/pages/walmart-product.json', 'utf8');
  const cases = [
    { host: 'www.amazon.com', product: '/dp/B000000001', search: '/s?k=oats', id: 'B000000001', html: '<div id="centerCol"><h1 id="productTitle">Whole grain rolled oats</h1><input id="ASIN" value="B000000001"><div id="nic-ingredients-content">whole grain rolled oats</div></div>', tile: '<div data-component-type="s-search-result" data-asin="B000000001"><h2><a href="/dp/B000000001">Whole grain oats</a></h2></div>' },
    { host: 'www.target.com', product: '/p/oats/-/A-79364857', search: '/s?searchTerm=oats', id: '79364857', html: fs.readFileSync(root + '/tests/pages/target-p-oats.html', 'utf8'), tile: '<div data-test="ListingPageProductListing"><a href="/p/oats/-/A-79364857"><h3>Organic oats</h3></a></div>' },
    { host: 'www.walmart.com', product: '/ip/oats/10314926', search: '/search?q=oats', id: '10314926', html: `<h1>Whole Grain Oats</h1><script id="__NEXT_DATA__" type="application/json">${walmart}</script>` },
    { host: 'www.costco.com', product: '/p/-/oats/100423971', search: '/s?keyword=oats', id: '100423971', html: common },
  ];
  for (const domain of ['instacart.com','kroger.com','frysfood.com','ralphs.com','kingsoopers.com','smithsfoodanddrug.com','fredmeyer.com','qfc.com','harristeeter.com','dillons.com','safeway.com','albertsons.com']) {
    const instacart = domain === 'instacart.com', albertsons = /safeway|albertsons/.test(domain), id = instacart ? '169289' : albertsons ? '184710125' : '0003000001020';
    cases.push({ host: 'www.' + domain, id, product: instacart ? '/store/products/169289-oats' : albertsons ? '/shop/pd/product/' + id : '/p/oats/' + id, search: instacart ? '/store/s?query=oats' : albertsons ? '/shop/search-results.html?q=oats' : '/search?query=oats', html: common });
  }
  for (const c of cases) c.tile ||= `<article data-testid="product-card"><a href="${c.product}"><h3>Whole grain oats</h3></a></article>`;
  const key = path.join(folder, 'fixture.key'), cert = path.join(folder, 'fixture.crt');
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',key,'-out',cert], { stdio: 'ignore' });
  const requests = [], sockets = new Set();
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req,res) => {
    const c = cases.find(c => c.host === req.headers.host?.split(':')[0]);
    if (!c) { res.writeHead(404); res.end('Fixture-only proxy'); return; }
    const u = new URL(req.url, 'https://' + c.host); requests.push({ host: c.host, path: u.pathname, cookie: req.headers.cookie, referer: req.headers.referer });
    let body;
    if (u.pathname === c.product || u.pathname.includes(c.id)) body = c.html;
    else if (u.pathname === new URL(c.search, u).pathname) body = c.tile;
    else if (/cart/.test(u.pathname)) body = `<h1>Your cart</h1><main id="sc-active-cart" data-testid="cart"><article data-itemtype="active" class="sc-list-item" data-asin="${c.id}" data-testid="cart-item" data-product-id="${c.id}"><a href="${c.product}"><h3>Whole grain oats</h3></a><input aria-label="Quantity" value="2"><button>Remove</button></article></main>`;
    else { res.writeHead(404); res.end('Fixture-only proxy'); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><html lang="en"><head><title>Grocery fixture</title></head><body>${body}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = http.createServer((_req,res) => { res.writeHead(404); res.end('Fixture-only proxy'); });
  proxy.on('connect', (_req, client, head) => {
    const upstream = net.connect(server.address().port, '127.0.0.1', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
    sockets.add(client); sockets.add(upstream); client.on('close', () => { sockets.delete(client); upstream.destroy(); }); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  return { cases, requests, address: '127.0.0.1:' + proxy.address().port, close() { for (const socket of sockets) socket.destroy(); proxy.close(); server.close(); } };
}
