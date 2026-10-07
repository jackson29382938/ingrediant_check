// Optional points (prefs pointsEnabled, off by default): XP for putting good-scoring products in a cart.
//
//   A score of 90 or more earns 20 XP, 75 or more earns 10, anything lower earns nothing. A product earns
//   again only after a week, so reopening a cart does not farm points. Level n costs 100 x n XP.
//
// Progress is kept on this computer only (storage key `xp`), is never part of a settings backup, and never
// changes a score. What is stored is read as untrusted: sanitize() cleans it before anything uses it.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const AWARDS = Object.freeze([[90, 20], [75, 10]]);
  const MAX_SEEN = 1000;       // products remembered, so the stored object stays small
  const MAX_TOTAL = 1e9;
  const MAX_KEY = 120;

  function worth(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return 0;
    const award = AWARDS.find(([min]) => score >= min);
    return award ? award[1] : 0;
  }

  // { total, seen }: the points so far, and when each product last earned some.
  function sanitize(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const total = Number.isFinite(o.total) ? Math.min(MAX_TOTAL, Math.max(0, Math.floor(o.total))) : 0;
    const seen = {};
    const stored = o.seen && typeof o.seen === 'object' && !Array.isArray(o.seen) ? o.seen : {};
    for (const [key, t] of Object.entries(stored)) {
      if (key.length <= MAX_KEY && typeof t === 'number' && Number.isFinite(t) && t > 0) seen[key] = t;
    }
    return { total, seen };
  }

  // A week-old entry can block nothing, so it goes first; then the oldest beyond the cap.
  function prune(seen, now) {
    const live = Object.entries(seen).filter(([, t]) => now - t < COOLDOWN_MS);
    live.sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(live.slice(0, MAX_SEEN));
  }

  // items: [{ key: 'amazon.com:B0…', score }], one per cart line. -> the new stored object, what was gained,
  // and which products earned it.
  function earn(raw, items, now = Date.now()) {
    const xp = sanitize(raw);
    const seen = { ...xp.seen };
    const earned = [];
    let gained = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const key = item && typeof item.key === 'string' && item.key.length <= MAX_KEY ? item.key : '';
      const pts = key ? worth(item.score) : 0;
      if (!pts) continue;
      const last = seen[key];
      // Not again within a week. A clock that went backwards gives a negative gap, which is also under a week.
      if (last !== undefined && now - last < COOLDOWN_MS) continue;
      seen[key] = now;
      gained += pts;
      earned.push({ key, xp: pts });
    }
    return { xp: { total: Math.min(MAX_TOTAL, xp.total + gained), seen: prune(seen, now) }, gained, earned };
  }

  // Where a total sits: the level, the points into it, and what the next level costs.
  function level(total) {
    let left = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    let n = 1;
    let need = 100;
    while (left >= need) { left -= need; n++; need = 100 * n; }
    return { level: n, into: left, need };
  }

  const api = { COOLDOWN_MS, AWARDS, MAX_SEEN, MAX_TOTAL, worth, sanitize, earn, level };
  const out = AIRmodule('points', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
