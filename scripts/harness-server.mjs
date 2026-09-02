#!/usr/bin/env node
// Serves tests/harness.html plus the live src/ tree, so the real panel can be exercised in a
// browser without loading the extension into Chrome. Selectors are verified separately against
// live amazon.com; this covers the rendering and interaction the DOM tests cannot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HARNESS_PORT || 8731);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/tests/harness.html';
  if (p === '/fixtures.js') p = '/tests/harness-fixtures.js';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`harness on http://127.0.0.1:${PORT}`));
