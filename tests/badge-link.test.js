// A click (or Enter) on a score badge opens the product, as a click on the item's title or picture does
// (src/content/badge-link.js), driven through stub DOM events.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Nodes with just what the script calls: a parent, a selector test, descendants, contains, layout.
const has = (n, sel) => sel.split(',').map(x => x.trim()).some(x =>
  (x === 'a[href]' && n.tag === 'a' && n.attrs.href) || (x === '[data-asin]' && 'data-asin' in n.attrs)
  || (x[0] === '.' && String(n.attrs.class || '').split(/\s+/).includes(x.slice(1))));
function node(tag, attrs = {}, kids = [], { rects = true, data = {} } = {}) {
  const n = { tag, attrs, kids, dataset: data, events: [], parentNode: null,
    get href() { return `https://shop.test${attrs.href}`; },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    getClientRects: () => (rects ? [{}] : []),
    closest(sel) { for (let p = n; p; p = p.parentNode) if (has(p, sel)) return p; return null; },
    contains(o) { for (let p = o; p; p = p.parentNode) if (p === n) return true; return false; },
    querySelectorAll(sel) { const all = k => k.flatMap(c => [c, ...all(c.kids)]); return all(kids).filter(c => has(c, sel)); },
    dispatchEvent(ev) { n.events.push(ev); } };
  for (const k of kids) k.parentNode = n;
  return n;
}
const badge = (attrs = {}, opts) => node('span', { class: 'air-badge', ...attrs }, [], opts);
const link = (href, opts) => node('a', { href }, [], opts);

function wire() {
  const handlers = {}, closed = [];
  const c = vm.createContext({
    document: { addEventListener: (type, f, capture) => { handlers[type] = { f, capture }; } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    AIR: { hoverCard: { close: () => closed.push(true) } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/content/badge-link.js'), 'utf8'), c);
  const fire = (type, target, extra = {}) => {
    const ev = { type, target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    if (handlers[type]) handlers[type].f(ev);
    return ev;
  };
  return { fire, closed, handlers };
}
const tile = (...kids) => node('div', { 'data-asin': 'B0TESTOAT1' }, [node('div', {}, kids)]);

test('a click on a badge beside the title link is handed to that link, and nothing else sees it', () => {
  const w = wire(), b = badge(), a = link('/Slug/dp/B0TESTOAT1/ref=sr_1_1');
  tile(b, a);
  const ev = w.fire('click', b, { ctrlKey: false });
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].type, 'click');
  assert.equal(a.events[0].bubbles, true, 'the page sees it as a click on its link');
  assert.equal(ev.prevented && ev.stopped, true, 'the original click is not also delivered');
  assert.equal(w.closed.length, 1, 'the breakdown card closes');
  assert.equal(w.handlers.click.capture, true);
});

test('modifier keys carry over, so Ctrl or Cmd click opens a new tab as it does on the title', () => {
  const w = wire(), b = badge(), a = link('/dp/B0TESTOAT1');
  tile(b, a);
  w.fire('click', b, { ctrlKey: true, metaKey: true, shiftKey: true, altKey: true });
  assert.deepEqual([a.events[0].ctrlKey, a.events[0].metaKey, a.events[0].shiftKey, a.events[0].altKey], [true, true, true, true]);
});

test('a badge inside the link is left to the browser: no second click, nothing prevented', () => {
  const w = wire(), b = badge(), a = link('/dp/B0TESTOAT1');
  a.kids.push(b); b.parentNode = a;
  tile(a);
  const ev = w.fire('click', b);
  assert.equal(a.events.length, 0);
  assert.equal(ev.prevented || ev.stopped, false);
  assert.equal(w.closed.length, 1);
});

test('Enter on a focused badge opens the product, even when the badge is inside the link; other keys do not', () => {
  const w = wire(), outside = badge(), a = link('/dp/B0TESTOAT1');
  tile(outside, a);
  const ev = w.fire('keydown', outside, { key: 'Enter' });
  assert.equal(a.events.length, 1);
  assert.equal(ev.prevented, true);
  const inner = badge(), l2 = link('/dp/B0TESTOAT1');
  l2.kids.push(inner); inner.parentNode = l2; tile(l2);
  w.fire('keydown', inner, { key: 'Enter' });
  assert.equal(l2.events.length, 1, 'the focused badge is not the link, so the browser would not follow it');
  for (const key of [' ', 'Tab', 'a']) assert.equal(w.fire('keydown', outside, { key }).prevented, false);
  assert.equal(a.events.length, 1);
});

test('the link is the visible one to the same product: hidden copies and other products are skipped', () => {
  const w = wire(), b = badge();
  // Amazon keeps hidden "was removed" copies of the title link ahead of the real one.
  const hidden = link('/gp/product/B0TESTOAT1/ref=removed', { rects: false }), other = link('/dp/B0OTHERONE'), real = link('/gp/product/B0TESTOAT1/ref=title');
  tile(b, hidden, other, real);
  w.fire('click', b);
  assert.deepEqual([hidden.events.length, other.events.length, real.events.length], [0, 0, 1]);
  const lone = badge(), stranger = link('/dp/B0OTHERONE');
  tile(lone, stranger);
  const ev = w.fire('click', lone);
  assert.equal(stranger.events.length, 0, 'never a link to a different product');
  assert.equal(ev.prevented, false, 'nothing found: the click is left alone');
});

test('a store badge names its product itself; the link is found in the nearest element around it that has one', () => {
  const w = wire(), b = badge({ class: 'air-badge' }, { data: { airProduct: '111050071' } });
  const a = link('/shop/pd/product/111050071'), far = link('/shop/pd/product/999999999');
  // The badge's own box holds no link; the card around it does. A link to another product sits further out still.
  node('div', {}, [far, node('div', {}, [node('div', {}, [node('div', {}, [b]), a])])]);
  w.fire('click', b);
  assert.deepEqual([a.events.length, far.events.length], [1, 0]);
});

test('a cart badge is a badge too, and anything else is ignored', () => {
  const w = wire(), cart = node('span', { class: 'air-cart-badge' }), a = link('/dp/B0TESTOAT1');
  node('div', { 'data-asin': 'B0TESTOAT1' }, [cart, a]);
  w.fire('click', cart);
  assert.equal(a.events.length, 1);
  const plain = node('span', {}), a2 = link('/dp/B0TESTOAT1');
  node('div', { 'data-asin': 'B0TESTOAT1' }, [plain, a2]);
  assert.equal(w.fire('click', plain).prevented, false);
  assert.equal(a2.events.length, 0);
  assert.equal(w.fire('click', undefined).prevented, false);
});
