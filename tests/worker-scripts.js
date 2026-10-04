// The scripts the service worker loads, read from its own importScripts call, so the test VMs load
// exactly what Chrome loads. Hand-kept lists drifted: the background tests ran without
// storefronts.js, sorted-results.js and activity.js, and the sort tests without speed.js and
// activity.js, so a worker path that used them could pass here and fail in the browser.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

function workerScripts() {
  const source = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
  const call = source.match(/importScripts\(([^)]*)\)/);
  if (!call) throw new Error('background.js has no importScripts call');
  const files = [...call[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (!files.length) throw new Error('importScripts lists no files');
  return files;
}

// Runs each worker script in the context, calling `before(file)` first so a test can set a constant
// (a build endpoint) before the script that reads it.
function loadWorker(vm, context, { before } = {}) {
  if (!context.crypto) context.crypto = require('node:crypto').webcrypto;
  for (const file of workerScripts()) {
    if (before) before(file);
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
  }
  vm.runInContext(fs.readFileSync(path.join(SRC, 'background.js'), 'utf8'), context, { filename: 'background.js' });
}

module.exports = { workerScripts, loadWorker };
