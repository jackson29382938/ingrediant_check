// Does the content script actually stand down? Run: node tests/search-gate-integration.test.js
//
// tests/search-gate.test.js proves the gate DECIDES correctly. This one proves main.js is WIRED to
// it, by loading the real content script against a fake Amazon search page and watching what it
// touches: cache lookups, badges painted, hover listeners armed, tiles handed to the
// IntersectionObserver. A gate that nothing consults is the failure mode worth testing for.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

function makeEl(tag, attrs = {}, text = '') {
  const el = {
    tagName: tag, _attrs: { ...attrs }, _kids: [], innerText: text, textContent: text,
    isConnected: true, style: {}, classList: { add() {}, toggle() { return true; }, remove() {} },
    getAttribute: k => (k in el._attrs ? el._attrs[k] : null),
    setAttribute: (k, v) => { el._attrs[k] = String(v); },
    hasAttribute: k => k in el._attrs,
    removeAttribute: k => { delete el._attrs[k]; },
    addEventListener() {}, remove() { el.isConnected = false; },
    insertBefore(n) { el._kids.push(n); return n; },
    appendChild(n) { el._kids.push(n); return n; },
    get firstChild() { return el._kids[0] || null; },
    querySelector: sel => (/h2/.test(sel) ? { innerText: text } : null),
    querySelectorAll: () => [], closest: () => null, ownerDocument: null,
  };
  return el;
}

// Loads the real content script in a fake page and reports every surface it touched.
function run({ href, pathname, search, titles }) {
  const tiles = titles.map((t, i) => makeEl('div', { 'data-asin': 'B0' + String(i).padStart(8, '0') }, t));
  const lookups = [];
  const has = (sel, name) => sel.includes(name);
  global.document = {
    documentElement: makeEl('html'),
    title: 'Amazon.com',
    getElementById: () => null,
    createElement: t => makeEl(t),
    querySelector: () => null,
    querySelectorAll: sel => {
      if (!sel.startsWith('[data-asin]')) return [];
      if (has(sel, 'data-air-badge')) return tiles.filter(t => !t.hasAttribute('data-air-badge'));
      if (has(sel, 'data-air-hover')) return tiles.filter(t => !t.hasAttribute('data-air-hover'));
      if (has(sel, 'data-air-auto')) return tiles.filter(t => !t.hasAttribute('data-air-auto'));
      return tiles;
    },
  };
  global.self = global;
  global.location = { href, pathname, search };
  global.MutationObserver = class { observe() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.setInterval = () => 0;
  global.addEventListener = () => {};
  global.chrome = {
    runtime: { getManifest: () => ({ version: '0.9.0' }), sendMessage: () => {}, lastError: null },
    storage: {
      local: {
        get: (keys, cb) => {
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (typeof k === 'string' && k.startsWith('s:')) lookups.push(k);
          }
          if (cb) cb({ enabled: true, badges: true, foodOnly: true, hoverScore: true, autoScoreSearch: true });
        },
        set: () => {}, remove: () => {},
      },
      onChanged: { addListener: () => {} },
    },
  };

  for (const k of Object.keys(require.cache)) delete require.cache[k];
  delete global.AIR; delete global.AIRmodule;
  for (const f of ['engine/db/_module.js', 'engine/db/oils.js', 'engine/db/sugars.js',
                   'engine/db/additives.js', 'engine/db/labels.js', 'engine/db/allergens.js',
                   'engine/db/ingestible.js', 'engine/db/provenance.js', 'engine/categories.js',
                   'engine/db/prefs.js',
                   'engine/score.js', 'content/extract.js', 'content/panel.js']) {
    require(src(f));
  }
  // main.js is an IIFE with no exports, so it is evaluated rather than required.
  new Function(fs.readFileSync(src('content/main.js'), 'utf8'))();

  return {
    lookups: lookups.length,
    badged: tiles.filter(t => t.hasAttribute('data-air-badge')).length,
    hover: tiles.filter(t => t.hasAttribute('data-air-hover')).length,
    auto: tiles.filter(t => t.hasAttribute('data-air-auto')).length,
  };
}

const SHOES = ['Nike Air Max 270 Mens Running Shoes', 'adidas Ultraboost Sneakers',
               'ASICS Gel-Kayano Running Shoe', 'New Balance 990v5 Sneaker',
               'Brooks Ghost 15 Running Shoes', 'Hoka Clifton 9 Shoes'];
const FOOD = ['365 Organic Rolled Oats 42oz', 'Kirkland Signature Almond Butter',
              'Bobs Red Mill Steel Cut Oats', 'Quaker Old Fashioned Oats',
              'Nature Valley Granola', 'Store Brand Whole Milk'];
const page = (q, extra, titles) => ({
  href: `https://www.amazon.com/s?k=${encodeURIComponent(q)}${extra}`,
  pathname: '/s', search: `?k=${encodeURIComponent(q)}${extra}`, titles,
});

const CASES = [
  ['a search for running shoes', page('running shoes', '', SHOES), false],
  ['a search inside i=fashion', page('socks', '&i=fashion', SHOES), false],
  ['a brand search returning shoes', page('nike air max', '', SHOES), false],
  ['a search for organic oats', page('organic oats', '', FOOD), true],
  ['a cookware word inside i=grocery', page('skillet', '&i=grocery', FOOD), true],
];

let failed = 0;
console.log('  active?  lookups  badged  hover  auto   case');
for (const [name, ctx, shouldRun] of CASES) {
  const r = run(ctx);
  const active = r.lookups > 0 || r.badged > 0 || r.hover > 0 || r.auto > 0;
  const ok = active === shouldRun;
  if (!ok) failed++;
  console.log('  ' + (active ? 'RUNS ' : 'QUIET').padEnd(8) + String(r.lookups).padStart(7)
    + String(r.badged).padStart(8) + String(r.hover).padStart(7) + String(r.auto).padStart(6)
    + '   ' + (ok ? '  ' : '**') + name);
  try {
    assert.strictEqual(active, shouldRun,
      `${name}: expected the extension to be ${shouldRun ? 'active' : 'inert'}, but it was not`);
  } catch (e) { console.error('       ' + e.message); }
}

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
