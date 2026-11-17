// Every piece of text an extension page shows has a localisation key. Run: node --test tests/page-text.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// docs/AUDIT-2026-11-16.md, finding 8. Preflight proves every key has a German string; it cannot see text that
// has no key. The purchase-history page had none at all (153 pieces of text) and the settings page lacked 117,
// so a German reader got those in English while every check passed. Any text a page shows must sit in an
// element that carries a key.
test('every piece of text on an extension page has a localisation key', () => {
  const dir = path.join(__dirname, '../src/options');
  const VOID = new Set(['br', 'input', 'img', 'meta', 'link', 'hr', 'source', 'wbr', 'col']);
  // Not language: key caps, code, and addresses.
  const exempt = stack => stack.some(el => el.tag === 'kbd' || el.tag === 'code');
  const problems = [];
  let pages = 0, runs = 0;
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.html'))) {
    pages++;
    const tokens = fs.readFileSync(path.join(dir, file), 'utf8').split(/(<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>)/);
    const stack = [];
    for (const token of tokens) {
      if (!token) continue;
      const tag = /^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/.exec(token);
      if (tag) {
        const name = tag[2].toLowerCase();
        if (tag[1]) { while (stack.length && stack.pop().tag !== name) { /* close to the matching element */ } continue; }
        for (const [attr, key] of [['placeholder', 'data-i18n-placeholder'], ['aria-label', 'data-i18n-aria']]) {
          const value = new RegExp(`\\b${attr}="([^"]*[A-Za-z]{3}[^"]*)"`).exec(tag[3]);
          if (value && !/^[a-z]+:\/\//.test(value[1]) && !tag[3].includes(key + '=')) problems.push(`${file}: ${attr}="${value[1].slice(0, 50)}" has no ${key}`);
        }
        if (!VOID.has(name) && !token.endsWith('/>')) stack.push({ tag: name, keyed: /\bdata-i18n=/.test(tag[3]) || stack.some(el => el.keyed) });
        continue;
      }
      if (token.startsWith('<')) continue;
      const text = token.trim();
      if (text.length < 2 || !/[A-Za-z]{2}/.test(text) || /^[a-z]+:\/\//.test(text) || exempt(stack)) continue;
      runs++;
      if (!stack.some(el => el.keyed)) problems.push(`${file}: "${text.slice(0, 60)}"`);
    }
  }
  assert.ok(pages >= 8 && runs > 500, `the scan found ${runs} pieces of text on ${pages} pages: it no longer reaches them`);
  assert.deepEqual(problems, []);
});

// The scripts of the two pages that build most of their text: nothing a reader sees is written as a bare string.
test('the purchase-history scripts show no text that bypasses the message lookup', () => {
  for (const file of ['history.js', 'history-dashboard.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../src/options', file), 'utf8').replace(/\bt\(\s*'[A-Za-z0-9_]+'\s*(?:\+[^,]+)?,\s*'(?:[^'\\]|\\.)*'/g, 't()');
    // A sentence in quotes or backticks: a capital letter, then at least two more words.
    const bare = [...source.matchAll(/['`]([A-Z][a-z]+(?: [a-z${}().,;:'-]+){2,}[^'`]*)['`]/g)].map(m => m[1].slice(0, 60))
      .filter(text => !/^Could not establish|^[A-Z][a-z]+ [a-z]+ \$\{/.test(text));
    assert.deepEqual(bare, [], file);
  }
});
