// The store registry must describe what the extension actually does. Run: node --test tests/stores.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stores = require('../src/stores/registry.js');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const granted = [...manifest.host_permissions, ...(manifest.optional_host_permissions || [])];
const covers = (domain) => granted.some(p => p === `*://*.${domain}/*`);
const scripted = (domain) => manifest.content_scripts.some(cs => cs.matches.some(m => {
  const host = (m.match(/^[*a-z]+:\/\/([^/]+)\//) || [])[1] || '';
  return host === domain || host.endsWith('.' + domain);
}));

test('a supported store is exactly the hosts the manifest grants', () => {
  const amazon = stores.STORES.find(s => s.id === 'amazon');
  assert.deepEqual(amazon.domains.map(d => `*://*.${d}/*`), manifest.host_permissions);
});

test('a preview store runs through a content script only, with no host permission', () => {
  for (const s of stores.STORES.filter(x => x.status === 'preview')) {
    for (const d of s.domains) {
      assert.ok(scripted(d), `${s.name} is preview but no content script runs on ${d}`);
      assert.ok(!covers(d), `${s.name} is preview but the manifest grants host permission for ${d}`);
    }
  }
  // Target's script is scoped directly to product and search routes. Private routes are out of
  // scope by construction, rather than protected by an ever-growing exclusion list.
  const target = manifest.content_scripts.find(cs => cs.matches.includes('https://www.target.com/p/*'));
  assert.deepEqual(target.matches, [
    'https://www.target.com/p/*', 'https://www.target.com/s',
    'https://www.target.com/s?*', 'https://www.target.com/s/*',
  ]);
  assert.equal(target.exclude_globs, undefined);
  // And it loads none of Amazon's pipeline: no page fetches, no shared database, no OCR.
  for (const f of ['src/content/main.js', 'src/content/search.js', 'src/content/product.js', 'src/engine/db/product-cache.js', 'src/engine/db/ocr-text.js']) {
    assert.ok(!target.js.includes(f), `Target loads ${f}`);
  }
});

test('a planned store has no permission and no content script', () => {
  const scripts = JSON.stringify(manifest.content_scripts);
  for (const s of stores.STORES.filter(x => x.status === 'planned')) {
    for (const d of s.domains) {
      assert.ok(!covers(d), `${s.name} is planned but the manifest grants ${d}`);
      assert.ok(!scripts.includes(d), `${s.name} is planned but a content script matches ${d}`);
    }
  }
});

test('statuses are known and docs/STORES.md agrees with the registry', () => {
  const doc = fs.readFileSync(path.join(root, 'docs', 'STORES.md'), 'utf8');
  for (const s of stores.STORES) {
    assert.ok(['supported', 'preview', 'planned'].includes(s.status), `${s.id}: ${s.status}`);
    assert.match(doc, new RegExp(`\\|\\s*${s.name}\\s*\\|\\s*${s.status}\\s*\\|`, 'i'),
      `docs/STORES.md needs a row | ${s.name} | ${s.status} |`);
  }
});

test('host lookup matches subdomains, not look-alikes', () => {
  assert.equal(stores.storeForHost('www.amazon.co.uk').id, 'amazon');
  assert.equal(stores.storeForHost('smile.amazon.com').id, 'amazon');
  assert.equal(stores.storeForHost('notamazon.com'), null);
  assert.equal(stores.storeForHost('amazon.com.evil.example'), null);
  assert.equal(stores.storeForHost('www.target.com').id, 'target');
  assert.equal(stores.storeForName(' walmart ').id, 'walmart');
  assert.equal(stores.storeForName('Walmart Grocery'), null);
});
