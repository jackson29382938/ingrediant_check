'use strict';
// src/content/nav.js: the one place that notices a store's single-page navigation. Four content scripts each
// polled location.href on a 500 ms or 1 s timer for as long as the tab lived; where the browser has the
// Navigation API there is now no timer work between navigations beyond a slow safety check.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function sandbox({ api }) {
  const intervals = [], cleared = [], listeners = [], navListeners = [];
  const location = { href: 'https://www.amazon.com/s?k=oats' };
  const context = vm.createContext({
    console, location,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: id => cleared.push(id),
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => { const at = listeners.findIndex(l => l.type === type && l.fn === fn); if (at >= 0) listeners.splice(at, 1); },
    ...(api ? { navigation: {
      addEventListener: (type, fn) => navListeners.push({ type, fn }),
      removeEventListener: (type, fn) => { const at = navListeners.findIndex(l => l.type === type && l.fn === fn); if (at >= 0) navListeners.splice(at, 1); },
    } } : {}),
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/content/nav.js'), 'utf8'), context);
  return { nav: context.AIR.nav, location, intervals, cleared, listeners, navListeners };
}

test('with the Navigation API an address change is noticed from the event, and only a slow safety poll runs', () => {
  const w = sandbox({ api: true });
  const seen = [];
  w.nav.onChange(url => seen.push(url));
  assert.equal(w.intervals.length, 1);
  assert.equal(w.intervals[0].ms, w.nav.SAFETY_POLL_MS);
  assert.ok(w.intervals[0].ms >= 5000, 'not the 500 ms poll it replaces');
  w.location.href = 'https://www.amazon.com/dp/B000000001';
  w.navListeners.find(l => l.type === 'currententrychange').fn();
  assert.deepEqual(seen, ['https://www.amazon.com/dp/B000000001']);
  w.navListeners.find(l => l.type === 'currententrychange').fn();
  assert.equal(seen.length, 1, 'the same address is not announced twice');
});

test('without the Navigation API it polls twice a second, as the scripts did', () => {
  const w = sandbox({ api: false });
  const seen = [];
  w.nav.onChange(url => seen.push(url));
  assert.equal(w.intervals[0].ms, 500);
  w.location.href = 'https://www.amazon.com/dp/B000000002';
  w.intervals[0].fn();
  assert.equal(seen.length, 1);
});

test('back/forward and hash changes are noticed too', () => {
  const w = sandbox({ api: true });
  const seen = [];
  w.nav.onChange(url => seen.push(url));
  for (const type of ['popstate', 'hashchange']) {
    w.location.href = `https://www.amazon.com/s?k=oats#${type}`;
    w.listeners.find(l => l.type === type).fn();
  }
  assert.equal(seen.length, 2);
});

test('listening is counted: the timer and handlers exist only while someone is subscribed', () => {
  const w = sandbox({ api: true });
  const stopA = w.nav.onChange(() => {}), stopB = w.nav.onChange(() => {});
  assert.equal(w.intervals.length, 1, 'one timer however many subscribers');
  stopA();
  assert.equal(w.cleared.length, 0);
  stopB();
  assert.equal(w.cleared.length, 1, 'the last one out stops the timer');
  assert.equal(w.listeners.length + w.navListeners.length, 0, 'and removes the handlers');
  w.nav.onChange(() => {});
  assert.equal(w.intervals.length, 2, 'a new subscriber starts it again');
});

test('sync() marks the current address as handled, and a failing listener does not stop the others', () => {
  const w = sandbox({ api: true });
  const seen = [];
  const quiet = console.debug; console.debug = () => {};
  try {
    w.nav.onChange(() => { throw new Error('boom'); });
    w.nav.onChange(url => seen.push(url));
    w.location.href = 'https://www.amazon.com/dp/B000000003';
    w.nav.sync();
    w.navListeners[0].fn();
    assert.equal(seen.length, 0, 'the caller already read this address');
    w.location.href = 'https://www.amazon.com/dp/B000000004';
    w.navListeners[0].fn();
    assert.deepEqual(seen, ['https://www.amazon.com/dp/B000000004']);
  } finally { console.debug = quiet; }
});
