// Appearance: the colour scheme the reader chose.
//
// Three settings (prefs.js sanitizeDisplay): `theme` (system, light or dark), `palette` (standard or
// colour-blind safe score colours) and `accent` (one colour for fills, selected states, links and the
// focus ring). This module owns what is not plain CSS: the score palettes, the accent maths and the
// light/dark override. Extension pages boot themselves from it; the content scripts call use() and
// force() (panel.js mount) and read band() through BAND_COLOR.
//
// The light/dark override needs no second stylesheet: every `@media (prefers-color-scheme: dark)` rule
// is switched to `all` (always dark), `not all` (never dark) or put back (follow the system).
//
// The accent is adjusted, never trusted: whatever colour is picked, the one used is nudged until text
// in it reaches 4.5:1 (WCAG AA) on every surface it can sit on, and the text colour on a fill is
// whichever of white and near-black reads better. A reader cannot pick an unreadable accent.

if (typeof require !== 'undefined' && typeof module !== 'undefined') { require('./_module.js'); require('./prefs.js'); }

(function () {
  const DEFAULT_ACCENT = '#0f7b3f';

  // Score bands, best first: 90+, 75+, 50+, 25+, below. Light: text, background, ring. Dark: text, ring
  // (text on the dark card surfaces #1b1c1c / #232525 is >= 4.5:1; the light text colours were not).
  const PALETTES = {
    standard: {
      light: [['#0f7b3f', '#e8f5ec', '#1a9850'], ['#4a7c1f', '#eef6e4', '#66bd63'], ['#9a6206', '#fdf3e2', '#f0a02a'],
        ['#a8480f', '#fdeee5', '#f46d43'], ['#a4161a', '#fdecec', '#d73027']],
      dark: [['#6fdf9a', '#1a9850'], ['#a6d96a', '#66bd63'], ['#e0b25a', '#f0a02a'], ['#ff8f70', '#f46d43'], ['#ff8a8a', '#d73027']],
    },
    // Blue to yellow to maroon: no red-green axis, so the bands stay apart for the common colour-vision types.
    cvd: {
      light: [['#1e6db9', '#e9f1f8', '#1f6fbd'], ['#3b7394', '#eff7fc', '#5aaee0'], ['#886d03', '#fcf8e6', '#e3b505'],
        ['#b34e15', '#fcefe8', '#e0621a'], ['#9e3a5c', '#f5ebef', '#9e3a5c']],
      dark: [['#4a8fe0', '#4a8fe0'], ['#8cc8f0', '#8cc8f0'], ['#e3b505', '#e3b505'], ['#e8742f', '#e8742f'], ['#d68aa4', '#d68aa4']],
    },
  };

  const state = { theme: 'system', palette: 'standard', accent: DEFAULT_ACCENT };
  const P = () => AIR.db.prefs;

  // The reader's three settings, sanitized (prefs.js is the one place that knows what is valid).
  function use(raw) {
    const { theme, palette, accent } = P().sanitizeDisplay(raw);
    Object.assign(state, { theme, palette, accent });
    return { ...state };
  }

  const BANDS = [90, 75, 50, 25];
  const bandIndex = score => { const i = BANDS.findIndex(min => score >= min); return i < 0 ? 4 : i; };
  function band(score, palette = state.palette) {
    const table = PALETTES[palette] || PALETTES.standard;
    const i = bandIndex(score);
    const [fg, bg, ring] = table.light[i];
    const [dfg, dring] = table.dark[i];
    return { fg, bg, ring, dfg, dring };
  }

  // Chrome owns the toolbar badge surface, so use the band's readable solid colour as its fill.
  // Numeric labels remain available in every palette; choose the strongest text contrast.
  function toolbar(score, palette = state.palette) {
    const colors = band(score, palette);
    const bg = palette === 'cvd' ? colors.ring : colors.fg;
    const fg = contrast(bg, '#ffffff') >= contrast(bg, '#0f1111') ? '#ffffff' : '#0f1111';
    return { bg, fg };
  }

  // ---------------------------------------------------------------- colour maths
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function contrast(a, b) {
    const [x, y] = [lum(rgb(a)), lum(rgb(b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  const mix = (a, b, t) => { const [p, q] = [rgb(a), rgb(b)]; return hex(p.map((v, i) => v + (q[i] - v) * t)); };

  // The surfaces text in the accent can sit on, worst first.
  const SURFACES = { light: ['#eef0f0', '#f7f8f8', '#ffffff'], dark: ['#3a3c3c', '#2d2f2f', '#232525', '#1b1c1c'] };
  const CARD = { light: '#ffffff', dark: '#232525' };

  // The accent as used in one scheme: nudged toward black (light) or white (dark) until it reads on
  // every surface and on its own selected-state tint (text in the accent sits on that tint too), then the
  // text colour for a fill, the tint, a tint border, and the link.
  const TINT = 0.12;
  function accentFor(picked, scheme) {
    let c = picked;
    const reads = x => [...SURFACES[scheme], mix(CARD[scheme], x, TINT)].every(s => contrast(x, s) >= 4.5);
    for (let i = 0; i < 80 && !reads(c); i++) c = mix(c, scheme === 'dark' ? '#ffffff' : '#000000', 0.02);
    return {
      accent: c,
      on: contrast(c, '#ffffff') >= contrast(c, '#0f1111') ? '#ffffff' : '#0f1111',
      bg: mix(CARD[scheme], c, TINT),
      line: mix(CARD[scheme], c, 0.35),
      link: c,
    };
  }

  // The custom properties the pages read, as var(--u-accent, <today's colour>): nothing is set for the
  // default accent, so the stylesheet's own fallbacks give today's pixels. `-d` is the dark scheme.
  function vars(picked = state.accent) {
    if (!picked || picked.toLowerCase() === DEFAULT_ACCENT) return {};
    const out = {};
    for (const [suffix, scheme] of [['', 'light'], ['-d', 'dark']]) {
      const a = accentFor(picked, scheme);
      out[`--u-accent${suffix}`] = a.accent;
      out[`--u-on-accent${suffix}`] = a.on;
      out[`--u-accent-bg${suffix}`] = a.bg;
      out[`--u-accent-line${suffix}`] = a.line;
      out[`--u-link${suffix}`] = a.link;
    }
    return out;
  }

  // ---------------------------------------------------------------- light / dark override
  const original = new WeakMap();
  const isDark = text => /prefers-color-scheme:\s*dark/.test(text);

  // Put every dark rule in `scope` (a document or a shadow root) in line with the theme.
  function force(scope, theme = state.theme) {
    if (!scope || !scope.styleSheets) return;
    for (const sheet of [...scope.styleSheets]) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }       // a cross-origin sheet: not ours
      for (const rule of rules) {
        if (!rule.media) continue;
        if (!original.has(rule)) original.set(rule, rule.media.mediaText);
        const was = original.get(rule);
        if (isDark(was)) rule.media.mediaText = theme === 'dark' ? 'all' : theme === 'light' ? 'not all' : was;
      }
    }
  }

  function applyVars(el, map = vars()) {
    for (const name of ['', '-d']) {
      for (const k of ['accent', 'on-accent', 'accent-bg', 'accent-line', 'link']) el.style.removeProperty(`--u-${k}${name}`);
    }
    for (const [k, v] of Object.entries(map)) el.style.setProperty(k, v);
  }

  // ---------------------------------------------------------------- extension pages
  const CACHE_KEY = 'icTheme';
  function page(doc = document) {
    const root = doc.documentElement;
    applyVars(root);
    root.style.colorScheme = state.theme === 'system' ? '' : state.theme;
    force(doc);
  }

  // The first paint uses what the last page left in localStorage (read synchronously, so there is no
  // flash of the default colours); then the stored settings take over and the cache is refreshed.
  function boot(doc = document) {
    try { const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (cached) { use(cached); page(doc); } } catch (e) { /* no cache */ }
    const keys = ['theme', 'palette', 'accent'];
    const sync = o => {
      use(o || {});
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ theme: state.theme, palette: state.palette, accent: state.accent })); } catch (e) { /* private window */ }
      page(doc);
    };
    chrome.storage.local.get(keys, sync);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      if (keys.some(k => changes[k])) chrome.storage.local.get(keys, sync);
    });
  }
  // Only the extension's own pages; a content script shares this file and must not restyle the store page.
  // Run at once: the styles in <head> are parsed, so the cached colours are in place before the first
  // paint. A linked stylesheet (sorted.css) may not have loaded yet, so the override is repeated on load.
  if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:' && typeof document !== 'undefined') {
    try { boot(); } catch (e) { /* storage unavailable */ }
    window.addEventListener('load', () => force(document));
  }

  const api = { DEFAULT_ACCENT, PALETTES, state, use, band, toolbar, accentFor, vars, force, applyVars, page, boot, contrast, mix };
  const out = AIRmodule('theme', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
