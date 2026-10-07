// Results-page and cart breakdown: the card renderer (panel.js) and the hover / focus controller
// (hover-card.js), driven through stub DOM events. A click on the badge opens the product: badge-link.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const panel = require('../src/content/panel.js');
const PC = require('../src/engine/db/product-cache.js');

const TEXT = 'Water, sugar, canola oil, natural flavors, red 40, xanthan gum, citric acid, salt, '
  + 'soy lecithin, sodium benzoate, modified corn starch, organic cane sugar';
const result = engine.score({ ingredients_text: TEXT });
const rows = html => (html.match(/<li /g) || []).length;

test('full shows every row the product panel shows, compact the biggest few, both link to the product', () => {
  const full = panel.renderBreakdown(result, { asin: 'B000000001', score: result.score, verdict: result.verdict, detail: 'full' });
  const compact = panel.renderBreakdown(result, { asin: 'B000000001', score: result.score, verdict: result.verdict, detail: 'compact' });
  const pagePanel = panel.render(result, { title: 'x', confidence: 1 });
  assert.equal(rows(full), rows(pagePanel), 'full = the product page rows');
  assert.ok(rows(compact) < rows(full));
  const caps = result.bad.filter(h => h.c === 'CAP' || h.cap).length;
  assert.ok(rows(compact) <= caps + 5 + 3);
  assert.match(compact, /biggest reasons only/);
  for (const html of [full, compact]) {
    assert.match(html, /href="\/dp\/B000000001"/);
    assert.match(html, /Open product for full detail/);
    assert.match(html, /role="dialog"/);
  }
});

test('no saved reading: the badge score and a pointer to the product, never invented reasons', () => {
  const html = panel.renderBreakdown(null, { asin: 'B000000002', score: 72, verdict: 'Mediocre', detail: 'full' });
  assert.match(html, />72</);
  assert.match(html, /saved before breakdowns were kept/);
  assert.equal(rows(html), 0);
  assert.match(html, /href="\/dp\/B000000002"/);
});

function controller({ hoverBreakdown = true, delay = 200, stored = {}, cls = 'air-badge' } = {}) {
  const handlers = {}, timers = [], mounts = [], body = [];
  const mkEl = () => ({ style: {}, attrs: {}, isConnected: true, listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, f) { this.listeners[t] = f; }, contains: () => false,
    remove() { this.isConnected = false; body.splice(body.indexOf(this), 1); }, focus() { this.focused = true; } });
  const tile = { getAttribute: () => 'B000000001' };
  // Answers like the browser: the badge for a selector list that names its class, the tile for [data-asin].
  const names = sel => sel.split(',').map(x => x.trim());
  const badge = { ...mkEl(), textContent: '41', closest: sel => (names(sel).includes('.' + cls) ? badge : sel === '[data-asin]' ? tile : null),
    getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 126 }) };
  badge.attrs['data-air'] = '41:Poor';
  const other = { closest: () => null };
  const state = { enabled: true, badges: true, hoverBreakdown, breakdownDetail: 'full', breakdownDelayMs: delay, prefs: {} };
  const c = vm.createContext({
    innerWidth: 1200, innerHeight: 800, scrollX: 0, scrollY: 0, addEventListener() {},
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; },
    document: { addEventListener: (t, f) => { handlers[t] = f; }, body: { appendChild: el => body.push(el) },
      createElement: () => mkEl() },
    chrome: { storage: { local: { get: (k, cb) => cb(stored) } } },
    AIR: { page: { state, storeHost: () => 'amazon.com' }, db: { productCache: PC }, engine,
      panel: { renderBreakdown: panel.renderBreakdown, mount: (h, html) => mounts.push(html) } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/content/hover-card.js'), 'utf8'), c);
  const fire = (type, ev) => handlers[type]({ preventDefault() { this.prevented = true; }, stopPropagation() {}, ...ev });
  const runTimers = () => { for (const t of timers.splice(0)) if (t.f) t.f(); };
  return { c, badge, other, timers, mounts, body, fire, runTimers, card: c.AIR.hoverCard };
}
const row = PC.fromScan({ store: 'amazon.com', asin: 'B000000001', input: { name: 'Drink', ingredients_text: TEXT }, via: 'search-tile' });

test('hover opens after the configured delay with the breakdown of the saved reading', () => {
  const w = controller({ delay: 350, stored: { [PC.localKey('amazon.com', 'B000000001')]: row } });
  w.fire('mouseover', { target: w.badge });
  assert.equal(w.timers.at(-1).ms, 350);
  assert.equal(w.mounts.length, 0, 'nothing before the delay');
  w.runTimers();
  assert.equal(w.mounts.length, 1);
  assert.equal(rows(w.mounts[0]), rows(panel.render(result, { title: 'x', confidence: 1 })));
  assert.equal(w.badge.attrs['aria-expanded'], 'true');
  assert.equal(w.body.length, 1);
});

test('the card closes when the pointer leaves (after a grace), on Esc, and on a click anywhere; a click never pins it open', () => {
  const w = controller({ stored: { [PC.localKey('amazon.com', 'B000000001')]: row } });
  w.fire('mouseover', { target: w.badge });
  w.runTimers();
  assert.equal(w.card.isOpen(), true);
  w.fire('mouseout', { target: w.badge, relatedTarget: w.body[0] });
  w.runTimers();
  assert.equal(w.card.isOpen(), true, 'moving onto the card keeps it');
  w.fire('mouseout', { target: w.badge, relatedTarget: w.other });
  assert.equal(w.timers.at(-1).ms, 180, 'a short grace, so the pointer can reach the card');
  w.runTimers();
  assert.equal(w.card.isOpen(), false);
  w.fire('click', { target: w.badge });
  assert.equal(w.card.isOpen(), false, 'a click on the badge opens nothing here: it goes to the product (badge-link.js)');
  w.fire('focusin', { target: w.badge });
  assert.equal(w.card.isOpen(), true);
  w.fire('click', { target: w.badge });
  assert.equal(w.card.isOpen(), false, 'a click closes it');
  w.fire('focusin', { target: w.badge });
  w.fire('keydown', { target: w.other, key: 'Escape' });
  assert.equal(w.card.isOpen(), false);
  assert.equal(w.badge.focused, true, 'focus returns to the badge');
});

test('a cart line\'s number opens the same card: the cart badge class, the line\'s ASIN, the badge\'s own score', () => {
  const w = controller({ cls: 'air-cart-badge', stored: { [PC.localKey('amazon.com', 'B000000001')]: row } });
  w.badge.attrs['data-air'] = '41:Poor';
  w.fire('mouseover', { target: w.badge });
  w.runTimers();
  assert.equal(w.mounts.length, 1, 'hover shows the card for a cart badge');
  assert.equal(rows(w.mounts[0]), rows(panel.render(result, { title: 'x', confidence: 1 })), 'with the reasons kept for that ASIN');
  assert.match(w.mounts[0], /href="\/dp\/B000000001"/);
  assert.equal(w.badge.attrs['aria-expanded'], 'true');
  const tab = controller({ cls: 'air-cart-badge', stored: {} });
  tab.fire('focusin', { target: tab.badge });
  assert.match(tab.mounts[0], /saved before breakdowns were kept/, 'a line scored before its reading was kept says so instead of inventing reasons');
});

test('keyboard focus opens at once; the setting off leaves badges alone', () => {
  const w = controller({ stored: {} });
  w.fire('focusin', { target: w.badge });
  assert.equal(w.mounts.length, 1);
  assert.match(w.mounts[0], /saved before breakdowns were kept/);
  const off = controller({ hoverBreakdown: false });
  off.fire('mouseover', { target: off.badge });
  off.runTimers();
  const ev = { target: off.badge };
  off.fire('click', ev);
  assert.equal(off.mounts.length, 0);
  assert.equal(off.card.isOpen(), false);
});
