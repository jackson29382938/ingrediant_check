// Test helper (not a test file): load the Amazon content scripts the way Chrome does, and catch the
// errors they swallow.
//
// Fixtures used to list the modules by hand, and the lists drifted: one loaded search.js without
// product-cache.js, so every run printed "[AIR] TypeError … reading 'localKey'" while its assertions
// still passed on what the setup had already done. The list now comes from manifest.json, and the
// content scripts' own catch-all logging (console.debug('[AIR]', e) in main.js) fails the test.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// The Amazon content scripts in manifest order, as absolute paths.
function amazonContentScripts() {
  const entry = manifest.content_scripts.find(c => c.matches.some(m => /amazon\./.test(m)));
  return entry.js.map(f => path.join(root, f));
}

// Record every console line the content scripts mark with [AIR] until stop() is called.
function watchAirErrors() {
  const errors = [];
  const saved = {};
  for (const level of ['debug', 'error', 'warn']) {
    saved[level] = console[level];
    console[level] = (...args) => {
      if (String(args[0]).includes('[AIR]')) errors.push(args.map(a => (a && a.stack) || String(a)).join(' '));
      else saved[level](...args);
    };
  }
  return { errors, stop() { Object.assign(console, saved); return errors; } };
}

// Errors can also come later, from a debounce or a storage callback after the test body returned.
// Once any fixture has loaded the content scripts, an [AIR] line at any time fails the whole file.
let late = null;
function watchUntilExit() {
  if (late) return;
  late = watchAirErrors();
  process.on('exit', () => {
    const errors = late.stop();
    if (!errors.length) return;
    process.stderr.write(`content scripts logged errors after their test finished:\n${errors.join('\n')}\n`);
    process.exitCode = 1;
  });
}

// Load every Amazon content script into the current global (the fixture has set up document,
// window, location and chrome): the rest with require(), main.js evaluated, since it exports
// nothing. Throws if any of them logged an [AIR] error while loading or running its first pass.
function loadAmazonContentScripts() {
  watchUntilExit();
  const before = late.errors.length;
  for (const file of amazonContentScripts()) {
    if (file.endsWith(path.join('content', 'main.js'))) new Function(fs.readFileSync(file, 'utf8'))();
    else require(file);
  }
  const errors = late.errors.slice(before);
  if (errors.length) {
    late.errors.length = before;   // reported here, not again at exit
    throw new Error(`content scripts logged errors:\n${errors.join('\n')}`);
  }
}

module.exports = { amazonContentScripts, watchAirErrors, loadAmazonContentScripts };
