// Appearance: colour scheme, score palette and accent (src/engine/db/theme.js).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');
const theme = require('../src/engine/db/theme.js');
const panel = require('../src/content/panel.js');

const AA = 4.5;
const SURFACES = { light: ['#ffffff', '#f7f8f8', '#eef0f0'], dark: ['#1b1c1c', '#232525', '#2d2f2f', '#3a3c3c'] };
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the appearance settings are sanitized: unknown values fall back, the accent is a lower-case #rrggbb', () => {
  const d = prefs.sanitizeDisplay({ theme: 'neon', palette: 3, accent: 'red' });
  assert.deepEqual([d.theme, d.palette, d.accent], ['system', 'standard', '#0f7b3f']);
  const ok = prefs.sanitizeDisplay({ theme: 'dark', palette: 'cvd', accent: '#7A3FA6' });
  assert.deepEqual([ok.theme, ok.palette, ok.accent], ['dark', 'cvd', '#7a3fa6']);
  for (const bad of ['#fff', '#12345g', '7a3fa6', '#7a3fa6ff', '', null, 12, '#7a3fa6; background:url(x)']) {
    assert.equal(prefs.sanitizeDisplay({ accent: bad }).accent, '#0f7b3f', String(bad));
  }
  assert.deepEqual(prefs.THEMES, ['system', 'light', 'dark']);
});

test('contrast maths matches the WCAG definition', () => {
  assert.ok(Math.abs(theme.contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(theme.contrast('#767676', '#ffffff') - 4.54) < 0.02, 'the well-known AA grey');
  assert.equal(theme.contrast('#123456', '#123456'), 1);
});

test('every score palette reads: text on its fill and on white (light), and on the dark surfaces (dark)', () => {
  for (const [name, table] of Object.entries(theme.PALETTES)) {
    table.light.forEach(([fg, bg], i) => {
      assert.ok(theme.contrast(fg, bg) >= AA, `${name} light band ${i}: ${fg} on ${bg} = ${theme.contrast(fg, bg).toFixed(2)}`);
      assert.ok(theme.contrast(fg, '#ffffff') >= AA, `${name} light band ${i}: ${fg} on white`);
    });
    table.dark.forEach(([dfg], i) => {
      for (const surface of SURFACES.dark.slice(0, 2)) {
        assert.ok(theme.contrast(dfg, surface) >= AA, `${name} dark band ${i}: ${dfg} on ${surface} = ${theme.contrast(dfg, surface).toFixed(2)}`);
      }
    });
  }
});

test('the colour-blind palette has no red-green axis: best and worst never sit on a hue the common deficiencies merge', () => {
  const hue = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const rings = theme.PALETTES.cvd.light.map(p => p[2]);
  const inGreen = h => h > 70 && h < 170;
  for (const ring of rings) assert.ok(!inGreen(hue(ring)), `${ring} is not green`);
  assert.ok(Math.abs(hue(rings[0]) - hue(rings[4])) > 40, 'best and worst differ in hue, not only lightness');
});

test('band() picks the right step at each threshold and follows the palette', () => {
  const steps = [[100, 0], [90, 0], [89, 1], [75, 1], [74, 2], [50, 2], [49, 3], [25, 3], [24, 4], [0, 4]];
  for (const [score, i] of steps) {
    const c = theme.band(score, 'standard');
    assert.equal(c.fg, theme.PALETTES.standard.light[i][0], `score ${score}`);
    assert.equal(c.dfg, theme.PALETTES.standard.dark[i][0], `score ${score} dark`);
  }
  assert.notEqual(theme.band(95, 'standard').ring, theme.band(95, 'cvd').ring);
  assert.deepEqual(Object.keys(theme.band(50)).sort(), ['bg', 'dfg', 'dring', 'fg', 'ring']);
  assert.equal(theme.band(50, 'nonsense').fg, theme.band(50, 'standard').fg, 'an unknown palette is Standard');
});

test('the panel and every score paint site read the reader\'s palette through BAND_COLOR', () => {
  theme.use({ palette: 'standard' });
  assert.deepEqual(panel.BAND_COLOR(80), theme.band(80, 'standard'));
  theme.use({ palette: 'cvd' });
  assert.deepEqual(panel.BAND_COLOR(80), theme.band(80, 'cvd'));
  assert.match(panel.render({ score: 80, verdict: 'Good', nova: 3, good: [], bad: [], flags: [], coverage: 1 }, { title: 'x' }), /--dfg:#8cc8f0/);
  theme.use({ palette: 'standard' });
  const html = panel.render({ score: 80, verdict: 'Good', nova: 3, good: [], bad: [], flags: [], coverage: 1 }, { title: 'x' });
  assert.match(html, /--fg:#4a7c1f;--bg:#eef6e4;--ring:#66bd63;--dfg:#a6d96a;--dring:#66bd63/);
});

test('whatever accent is picked, text in it reads on every surface, on its own tint, and the fill text reads on the fill', () => {
  let tried = 0, adjusted = 0;
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const picked = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    for (const scheme of ['light', 'dark']) {
      const a = theme.accentFor(picked, scheme);
      tried++;
      if (a.accent !== picked) adjusted++;
      for (const surface of [...SURFACES[scheme], a.bg]) assert.ok(theme.contrast(a.accent, surface) >= AA, `${picked} ${scheme}: ${a.accent} on ${surface}`);
      assert.ok(theme.contrast(a.on, a.accent) >= AA, `${picked} ${scheme}: ${a.on} on the fill ${a.accent} = ${theme.contrast(a.on, a.accent).toFixed(2)}`);
      assert.match(a.bg, /^#[0-9a-f]{6}$/);
      assert.match(a.line, /^#[0-9a-f]{6}$/);
    }
  }
  assert.ok(tried > 8000 && adjusted > 0 && adjusted < tried, 'the grid covers the cube and some picks needed no change');
});

test('the default accent sets nothing, so the stylesheets\' own fallbacks give today\'s colours', () => {
  assert.deepEqual(theme.vars('#0f7b3f'), {});
  assert.deepEqual(theme.vars('#0F7B3F'), {});
  const custom = theme.vars('#7a3fa6');
  assert.deepEqual(Object.keys(custom).sort(), ['--u-accent', '--u-accent-bg', '--u-accent-bg-d', '--u-accent-d', '--u-accent-line',
    '--u-accent-line-d', '--u-link', '--u-link-d', '--u-on-accent', '--u-on-accent-d']);
  assert.equal(custom['--u-accent'], '#7a3fa6', 'an already readable colour is kept as picked');
  assert.notEqual(custom['--u-accent-d'], '#7a3fa6', 'the dark scheme lightens it to read on dark surfaces');
});

test('applyVars sets and removes the properties on an element', () => {
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } };
  theme.applyVars({ style }, theme.vars('#7a3fa6'));
  assert.equal(Object.keys(style.props).length, 10);
  theme.applyVars({ style }, {});
  assert.deepEqual(style.props, {}, 'back to the default leaves nothing behind');
});

test('force() switches only the dark rules, and puts them back for "match my system"', () => {
  const dark = { media: { mediaText: '(prefers-color-scheme: dark)' } };
  const motion = { media: { mediaText: '(prefers-reduced-motion: reduce)' } };
  const plain = {};
  const scope = { styleSheets: [{ cssRules: [dark, motion, plain] }, { get cssRules() { throw new Error('cross-origin'); } }] };
  theme.force(scope, 'dark');
  assert.equal(dark.media.mediaText, 'all');
  theme.force(scope, 'light');
  assert.equal(dark.media.mediaText, 'not all');
  theme.force(scope, 'system');
  assert.equal(dark.media.mediaText, '(prefers-color-scheme: dark)', 'the original condition is restored');
  assert.equal(motion.media.mediaText, '(prefers-reduced-motion: reduce)', 'other media rules are never touched');
  assert.doesNotThrow(() => theme.force(null, 'dark'));
  assert.doesNotThrow(() => theme.force({}, 'dark'));
});

test('every dark rule in the extension is spelled the way force() recognises, and no CSS uses color-mix', () => {
  const files = ['src/options/options.html', 'src/options/popup.html', 'src/options/ui.css', 'src/options/welcome.html', 'src/options/report.html',
    'src/options/sorted.css', 'src/content/panel.js'];
  let rules = 0;
  for (const f of files) {
    const text = read(f);
    rules += (text.match(/@media\s*\(prefers-color-scheme:\s*dark\)/g) || []).length;
    for (const m of text.matchAll(/prefers-color-scheme[^)]*\)/g)) {
      assert.match(m[0], /^prefers-color-scheme:\s*dark\)$/, `${f}: "${m[0]}" is not a plain dark rule force() can switch`);
    }
    assert.ok(!/color-mix\(/.test(text), `${f}: a computed colour-mix() would break the contrast checks`);
    assert.ok(!/light-dark\(/.test(text), `${f}: light-dark() is not in every Chrome the extension supports`);
  }
  assert.ok(rules >= 6, 'the scan found the dark rules');
});

test('every theme variable in a stylesheet carries today\'s colour as its fallback', () => {
  const files = ['src/options/options.html', 'src/options/popup.html', 'src/options/ui.css', 'src/options/welcome.html', 'src/options/report.html', 'src/options/sorted.css'];
  let seen = 0;
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/var\(--u-([\w-]+)([^)]*)\)/g)) {
      seen++;
      assert.match(m[2], /^,\s*#[0-9a-f]{3,6}$/i, `${f}: var(--u-${m[1]}${m[2]}) has no hex fallback`);
    }
  }
  assert.ok(seen > 40, `found ${seen} theme variables`);
});

test('no script that reads the theme is missing from a page that loads the panel', () => {
  for (const f of ['popup', 'sorted', 'sidepanel']) {
    const html = read(`src/options/${f}.html`);
    assert.ok(html.indexOf('engine/db/theme.js') > html.indexOf('engine/db/prefs.js'), `${f}: theme after prefs`);
    assert.ok(html.indexOf('engine/db/theme.js') < html.indexOf('content/panel.js'), `${f}: theme before the panel`);
  }
  const manifest = JSON.parse(read('manifest.json'));
  for (const cs of manifest.content_scripts) {
    assert.ok(cs.js.indexOf('src/engine/db/theme.js') > cs.js.indexOf('src/engine/db/prefs.js'));
    if (cs.js.includes('src/content/panel.js')) assert.ok(cs.js.indexOf('src/engine/db/theme.js') < cs.js.indexOf('src/content/panel.js'));
    if (cs.js.includes('src/content/orders.js')) assert.ok(cs.js.indexOf('src/engine/db/theme.js') < cs.js.indexOf('src/content/orders.js'));
  }
});

// A tiny page to boot the real module against.
test('an extension page boots from the last colours it saw, then from storage, and a content script never restyles the store page', () => {
  const vm = require('node:vm');
  const run = (protocol, cache, stored) => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; }, colorScheme: '' };
    const dark = { media: { mediaText: '(prefers-color-scheme: dark)' } };
    const store = { ...(cache ? { icTheme: JSON.stringify(cache) } : {}) };
    const listeners = [];
    const ctx = vm.createContext({
      console, location: { protocol }, document: { documentElement: { style }, styleSheets: [{ cssRules: [dark] }], readyState: 'complete' },
      window: { addEventListener() {} },
      localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      chrome: { storage: { local: { get: (_k, cb) => cb(stored || {}) }, onChanged: { addListener: f => listeners.push(f) } } },
      require: undefined, module: undefined,
    });
    // The module's own dependencies, as the page would have loaded them.
    for (const f of ['src/engine/db/_module.js', 'src/engine/db/allergens.js', 'src/engine/categories.js', 'src/engine/db/prefs.js', 'src/engine/db/theme.js']) {
      vm.runInContext(read(f), ctx, { filename: f });
    }
    return { style, dark, store, listeners };
  };
  const page = run('chrome-extension:', { theme: 'dark', palette: 'standard', accent: '#7a3fa6' }, { theme: 'light', accent: '#7a3fa6' });
  assert.equal(page.style.colorScheme, 'light', 'storage wins over the cache once it answers');
  assert.equal(page.dark.media.mediaText, 'not all');
  assert.ok(page.style.props['--u-accent'], 'the custom accent is applied');
  assert.deepEqual(JSON.parse(page.store.icTheme).theme, 'light', 'the cache is refreshed for the next page');
  assert.equal(page.listeners.length, 1, 'and it follows later changes');
  const store = run('https://www.amazon.com:', { theme: 'dark', accent: '#7a3fa6' }, { theme: 'dark' });
  assert.equal(store.style.colorScheme, '', 'a content script never restyles the store page');
  assert.equal(store.dark.media.mediaText, '(prefers-color-scheme: dark)');
  assert.deepEqual(store.style.props, {});
  assert.equal(store.listeners.length, 0);
});
