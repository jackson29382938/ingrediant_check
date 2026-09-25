// Recent actions, for "Report a problem or suggest an improvement" (src/options/report.html).
//
// A short list of what the reader did with Ingredient Check: switches turned on or off, goals picked,
// the Amazon sort-menu option chosen, the side panel's buttons, settings changed, product pages
// scored. Kept in chrome.storage.session: in memory, this browser session only, gone when Chrome
// closes, never sent anywhere. The report page shows it, and it leaves only if the reader attaches
// the report to an email themselves.
//
// Entries are short text. Web addresses are cut to their path (no query, no fragment) so a search
// term's tracking parameters and session tokens never land here.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const KEY = 'activityLog';
  const MAX_ENTRIES = 60;
  const MAX_TEXT = 160;

  // eslint-disable-next-line no-control-regex
  const clean = (v, max = MAX_TEXT) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/[^\s]+/gi, u => { try { const x = new URL(u); return x.origin + x.pathname; } catch (e) { return ''; } })
    .replace(/\s+/g, ' ').trim().slice(0, max);

  function entry(where, what, now = Date.now()) {
    const w = clean(where, 40);
    const a = clean(what);
    if (!w || !a) return null;
    return { t: Number.isFinite(now) ? now : Date.now(), where: w, what: a };
  }

  // Untrusted list -> at most MAX_ENTRIES clean entries, oldest first.
  function sanitize(list) {
    return (Array.isArray(list) ? list : []).map(e => e && entry(e.where, e.what, Number(e.t))).filter(Boolean).slice(-MAX_ENTRIES);
  }

  function append(list, where, what, now) {
    const e = entry(where, what, now);
    const out = sanitize(list);
    if (!e) return out;
    // The same thing twice in a row (a slider dragged, a page re-scored) is one line.
    const last = out[out.length - 1];
    if (last && last.where === e.where && last.what === e.what) { last.t = e.t; return out; }
    out.push(e);
    return out.slice(-MAX_ENTRIES);
  }

  // From an extension page (popup, settings, side panel). Content scripts cannot reach session
  // storage, so they send { type: 'logAction' } to the worker, which calls this. Best effort.
  let chain = Promise.resolve();
  function log(where, what) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return chain;
      chain = chain.then(async () => {
        const got = await chrome.storage.session.get(KEY);
        await chrome.storage.session.set({ [KEY]: append(got[KEY], where, what) });
      }).catch(() => {});
    } catch (e) { /* not an extension context */ }
    return chain;
  }

  const api = { KEY, MAX_ENTRIES, MAX_TEXT, entry, sanitize, append, log, clean };
  const out = AIRmodule('activity', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
