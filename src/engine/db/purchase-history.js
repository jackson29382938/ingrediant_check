// Private purchase snapshots; intentionally outside settings backup and shared product caches.
(function(root) {
  const MAX = 1000;
  function clean(raw) {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw.key || '') || raw.store !== 'amazon.com' || !/^[A-Z0-9]{10}$/.test(raw.asin || '') || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') || !Number.isFinite(Date.parse(raw.date)) || new Date(raw.date).toISOString().slice(0, 10) !== raw.date || !['purchased', 'cancelled', 'returned', 'unknown'].includes(raw.state)) return null;
    const score = Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 100 ? Math.round(raw.score) : null;
    const plain = (v, n) => typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, n) : '';
    return { key: raw.key, store: 'amazon.com', asin: raw.asin, date: raw.date, state: raw.state,
      name: plain(raw.name, 250), score, profile: /^[a-f0-9]{64}$/.test(raw.profile || '') ? raw.profile : '',
      version: plain(raw.version, 30), ingredients: plain(raw.ingredients, 2000),
      flags: Array.isArray(raw.flags) ? raw.flags.filter(x => typeof x === 'string').slice(0, 20).map(x => plain(x, 200)) : [],
      observedAt: Number.isFinite(raw.observedAt) ? Math.max(0, Math.min(Date.now() + 300000, raw.observedAt)) : 0,
      scoredAt: score !== null && Number.isFinite(raw.scoredAt) ? Math.max(0, Math.min(Date.now() + 300000, raw.scoredAt)) : 0 };
  }
  function merge(old, incoming) {
    const map = new Map();
    for (const raw of [...(Array.isArray(old) ? old : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      const r = clean(raw); if (!r) continue;
      const was = map.get(r.key);
      if (!was) { if (map.size >= MAX) throw new Error('history-full'); map.set(r.key, r); continue; }
      if (was.asin !== r.asin || was.date !== r.date) throw new Error('invalid-history-identity');
      const latest = r.observedAt > was.observedAt ? r : was;
      // Preserve the first usable score, even after preferences or rules change.
      const snapshot = was.score !== null && (r.score === null || was.scoredAt <= r.scoredAt) ? was : r;
      map.set(r.key, { ...latest, score: snapshot.score, profile: snapshot.profile, version: snapshot.version,
        ingredients: snapshot.ingredients, flags: snapshot.flags, scoredAt: snapshot.scoredAt });
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  }
  function trends(records) {
    const groups = new Map();
    for (const r of merge([], records).filter(r => r.state === 'purchased')) {
      const key = [r.date.slice(0, 7), r.version, r.profile].join(':');
      const g = groups.get(key) || { month: r.date.slice(0, 7), version: r.version, profile: r.profile, total: 0, rated: 0, sum: 0, flagged: 0 };
      g.total++; if (r.score !== null) { g.rated++; g.sum += r.score; } if (r.flags.length) g.flagged++;
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month)).map(g => ({ ...g, average: g.rated ? Math.round(g.sum / g.rated) : null }));
  }
  const value = { MAX, clean, merge, trends };
  root.AIR = root.AIR || {}; root.AIR.db = root.AIR.db || {}; root.AIR.db.purchaseHistory = value;
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
})(typeof globalThis !== 'undefined' ? globalThis : self);
