// The two API keys live where a store page cannot read them (src/worker/vault.js): IndexedDB in the extension's
// own origin, not chrome.storage.local, which every content script can read (docs/AUDIT-2026-11-16.md, finding 9).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/worker/vault.js'), 'utf8');

// The part of IndexedDB the vault uses: one database, one store, get / put / delete in a transaction that
// completes on a later turn. `broken` makes every transaction fail, as a private window that refuses storage does.
function fakeIndexedDB(kept = new Map(), { broken = false } = {}) {
  const later = fn => setTimeout(fn, 0);
  return {
    kept,
    open() {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      later(() => {
        const stores = new Set(['secrets']);
        req.result = {
          objectStoreNames: { contains: name => stores.has(name) }, createObjectStore() {}, close() {},
          transaction() {
            const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
            const request = value => ({ result: value });
            tx.objectStore = () => ({
              get: key => request(kept.get(key)),
              put: (value, key) => { if (!broken) kept.set(key, value); return request(undefined); },
              delete: key => { if (!broken) kept.delete(key); return request(undefined); },
            });
            later(() => { if (broken) { tx.error = new Error('refused'); tx.onerror?.(); } else tx.oncomplete?.(); });
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function load({ local = {}, indexedDB } = {}) {
  const storage = {
    async get(key) { return key in local ? { [key]: local[key] } : {}; },
    async set(values) { Object.assign(local, values); },
    async remove(key) { delete local[key]; },
  };
  const sandbox = { chrome: { storage: { local: storage } }, setTimeout, ...(indexedDB ? { indexedDB } : {}) };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return { vault: sandbox.AIR.vault, local, indexedDB };
}

test('a key is kept in the extension\'s own database and never in the storage a store page can read', async () => {
  const { vault, local, indexedDB } = load({ indexedDB: fakeIndexedDB() });
  assert.equal(await vault.get('openrouterKey'), '');
  assert.equal(await vault.set('openrouterKey', 'sk-or-v1-0123456789abcdef'), true);
  assert.equal(await vault.get('openrouterKey'), 'sk-or-v1-0123456789abcdef');
  assert.equal(indexedDB.kept.get('openrouterKey'), 'sk-or-v1-0123456789abcdef');
  assert.deepEqual(local, {}, 'nothing is written to chrome.storage.local');
  await vault.remove('openrouterKey');
  assert.equal(await vault.get('openrouterKey'), '');
  assert.equal(indexedDB.kept.size, 0);
});

test('a key an older build left in chrome.storage.local is moved on first read, and at worker start', async () => {
  const read = load({ local: { openrouterKey: 'sk-or-v1-old-key-0123456789', usdaKey: 'abcdef0123456789abcdef' }, indexedDB: fakeIndexedDB() });
  assert.equal(await read.vault.get('openrouterKey'), 'sk-or-v1-old-key-0123456789');
  assert.equal(read.indexedDB.kept.get('openrouterKey'), 'sk-or-v1-old-key-0123456789');
  assert.ok(!('openrouterKey' in read.local), 'the old copy is removed');
  assert.ok('usdaKey' in read.local, 'a key nobody asked for has not moved yet');
  await read.vault.migrate();
  assert.deepEqual(read.local, {}, 'worker start moves the rest');
  assert.equal(read.indexedDB.kept.get('usdaKey'), 'abcdef0123456789abcdef');
  // Saving a new key removes an old copy as well.
  const saved = load({ local: { usdaKey: 'oldoldoldoldoldold' }, indexedDB: fakeIndexedDB() });
  await saved.vault.set('usdaKey', 'newnewnewnewnewnew');
  assert.deepEqual(saved.local, {});
  assert.equal(await saved.vault.get('usdaKey'), 'newnewnewnewnewnew');
});

test('only the two keys are kept, and only as text', async () => {
  const { vault, indexedDB } = load({ indexedDB: fakeIndexedDB() });
  assert.deepEqual([...vault.NAMES], ['openrouterKey', 'usdaKey']);
  assert.equal(await vault.set('purchaseHistory', 'x'), false);
  assert.equal(await vault.set('openrouterKey', ''), false);
  assert.equal(await vault.set('openrouterKey', { key: 'x' }), false);
  assert.equal(await vault.get('googleProfile'), '');
  assert.equal(indexedDB.kept.size, 0);
});

test('without a working database the key is kept the old way, so a saved key can always be read back', async () => {
  const none = load({});
  await none.vault.set('usdaKey', 'abcdef0123456789abcdef');
  assert.equal(none.local.usdaKey, 'abcdef0123456789abcdef');
  assert.equal(await none.vault.get('usdaKey'), 'abcdef0123456789abcdef');
  await none.vault.remove('usdaKey');
  assert.equal(await none.vault.get('usdaKey'), '');
  const refused = load({ local: { openrouterKey: 'sk-or-v1-kept-the-old-way' }, indexedDB: fakeIndexedDB(new Map(), { broken: true }) });
  assert.equal(await refused.vault.get('openrouterKey'), 'sk-or-v1-kept-the-old-way');
  await refused.vault.set('openrouterKey', 'sk-or-v1-another-key-here');
  assert.equal(refused.local.openrouterKey, 'sk-or-v1-another-key-here');
});

test('the worker and the settings page load the vault, and neither reads a key from chrome.storage.local', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/background.js'), /importScripts\([^)]*'worker\/vault\.js'[^)]*'worker\/ai\.js'/, 'the vault loads before the scripts that use it');
  const page = read('src/options/options.html');
  assert.ok(page.indexOf('worker/vault.js') > 0 && page.indexOf('worker/vault.js') < page.indexOf('settings-database.js'));
  for (const file of ['src/worker/ai.js', 'src/worker/usda.js', 'src/options/settings-database.js']) {
    const code = read(file).split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
    assert.doesNotMatch(code, /storage\.local\.(?:get|set|remove)\(\s*(?:\[[^\]]*\bKEY\b|\{\s*\[KEY\]|KEY\b)/, `${file} still reaches a key through chrome.storage.local`);
    assert.match(code, /AIR\.vault\.get\(KEY\)/, `${file} reads its key from the vault`);
  }
  // No content script loads the vault or names a key.
  const manifest = JSON.parse(read('manifest.json'));
  for (const entry of manifest.content_scripts) {
    assert.ok(!entry.js.includes('src/worker/vault.js'));
    for (const file of entry.js) assert.doesNotMatch(read(file), /openrouterKey|usdaKey/, `${file} names an API key`);
  }
});
