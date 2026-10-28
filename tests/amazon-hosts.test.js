// The Amazon storefronts are listed in five places. scripts/content-matches.mjs is the source of truth for the
// manifest (preflight checks the manifest against it); the worker's sender check, the sorted-list sanitiser and
// the storefront table each carry their own copy, and nothing tied them together. Adding a storefront to the
// manifest alone would score its pages while the worker refused their messages and the sort ignored them.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const suffixes = hosts => hosts.map(host => host.replace(/^amazon\./, '')).sort();
// The alternation of a `amazon\.(com|co\.uk|...)` pattern written in a source file.
const alternation = source => {
  const match = source.match(/amazon\\\.\(([^)]*)\)/);
  assert.ok(match, 'the source has no amazon\\.(...) host pattern');
  return match[1].split('|').map(part => part.replace(/\\\./g, '.')).sort();
};

test('every place that lists the Amazon storefronts lists the same ones', async () => {
  const { AMAZON_HOSTS } = await import('../scripts/content-matches.mjs');
  const expected = suffixes(AMAZON_HOSTS);
  assert.equal(expected.length, 21);

  assert.deepEqual(alternation(read('src', 'worker', 'messages.js')), expected, 'worker/messages.js (who may message the worker)');
  assert.deepEqual(alternation(read('src', 'engine', 'db', 'sorted-results.js')), expected, 'db/sorted-results.js (which source URLs a sorted list keeps)');

  const table = [...read('src', 'engine', 'db', 'storefronts.js').matchAll(/^\s+'([a-z.]+)': S\(/gm)].map(m => m[1]).sort();
  assert.deepEqual(table, expected, 'db/storefronts.js (currency, decimal mark and units per store)');

  const manifest = JSON.parse(read('manifest.json'));
  const granted = manifest.host_permissions.map(p => p.match(/^\*:\/\/\*\.(amazon\.[a-z.]+)\/\*$/)?.[1]);
  assert.ok(granted.every(Boolean), 'every host permission is an *.amazon.<tld> pattern');
  assert.deepEqual(suffixes(granted), expected, 'manifest host_permissions');
});

test('the worker accepts a page on each listed storefront and nothing that only looks like one', () => {
  const vm = require('node:vm');
  const context = vm.createContext({ chrome: { runtime: { id: 'ext' } }, URL });
  vm.runInContext(read('src', 'worker', 'messages.js'), context);
  const sender = host => ({ id: 'ext', tab: { url: `https://${host}/dp/B00LOAW7U6` } });
  const allowed = host => context.allowMessage({ type: 'lookupBarcode', code: '0012345678905' }, sender(host));
  for (const suffix of ['com', 'co.uk', 'de', 'co.jp', 'com.br']) assert.equal(allowed(`www.amazon.${suffix}`), true, suffix);
  for (const host of ['www.amazon.com.evil.example', 'amazon.example', 'notamazon.com', 'www.amazon.xyz', 'amazon.com.example']) assert.equal(allowed(host), false, host);
});
