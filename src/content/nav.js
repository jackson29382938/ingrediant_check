// One way to learn that the page address changed without a page load.
//
// Amazon, Target and the other stores are single-page apps: moving from results to a product rewrites the
// address with history.pushState and swaps the content, so no load event fires. Four content scripts each
// polled `location.href` on a 500 ms or 1 s timer to notice, on every open store tab, for as long as the tab
// lived. This is the one copy of that check:
//
//   - Where the browser has the Navigation API (every Chrome this extension supports) the address is checked
//     when the current history entry changes, which covers pushState, replaceState, back/forward and hash
//     changes, and costs nothing between navigations. A slow safety poll stays on, in case a store changes the
//     address in a way that fires nothing.
//   - Elsewhere (Firefox before it ships the API) it polls every 500 ms, as the scripts did.
//
// A listener is told only when the address really differs from the last one it was told about. Listening is
// counted: the timers and the event handlers exist only while at least one script is subscribed, so a paused
// extension (main.js unsubscribes) has no poll running at all.

(function (root) {
  root.AIR = root.AIR || {};

  const POLL_WITHOUT_API_MS = 500;
  const SAFETY_POLL_MS = 5000;
  const listeners = new Set();
  let last = null, timer = null, wired = null;

  const hasNavigationApi = () => {
    try { return typeof navigation !== 'undefined' && !!navigation && typeof navigation.addEventListener === 'function'; }
    catch (e) { return false; }
  };

  function check() {
    if (location.href === last) return;
    last = location.href;
    for (const fn of [...listeners]) {
      try { fn(last); } catch (e) { console.debug('[AIR]', e); }
    }
  }

  function wire() {
    if (wired) return;
    wired = [];
    const add = (target, type) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, check);
      wired.push(() => target.removeEventListener?.(type, check));
    };
    add(root, 'popstate');
    add(root, 'hashchange');
    const api = hasNavigationApi();
    if (api) add(navigation, 'currententrychange');
    timer = setInterval(check, api ? SAFETY_POLL_MS : POLL_WITHOUT_API_MS);
  }

  function unwire() {
    if (!wired) return;
    for (const off of wired) off();
    wired = null;
    clearInterval(timer);
    timer = null;
  }

  // -> a function that stops listening. `fn` gets the new address.
  function onChange(fn) {
    if (!listeners.size) last = location.href;
    listeners.add(fn);
    wire();
    return () => {
      listeners.delete(fn);
      if (!listeners.size) unwire();
    };
  }

  // The caller has already dealt with the current address (it just read it): do not announce it.
  function sync() { last = location.href; }

  root.AIR.nav = { onChange, sync, hasNavigationApi, POLL_WITHOUT_API_MS, SAFETY_POLL_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.nav;
})(typeof globalThis !== 'undefined' ? globalThis : self);
