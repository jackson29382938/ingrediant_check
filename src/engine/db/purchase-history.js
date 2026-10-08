// Private purchase snapshots; intentionally outside settings backup and shared product caches.
(function(root) {
  const MAX = 10000;
  function cleanInput(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.ingredients_text !== 'string' || !raw.ingredients_text.trim()) return null;
    const out = {};
    for (const [key, limit] of Object.entries({ name: 250, ingredients_text: 6000, advisory_text: 6000, labels: 3000, certifications: 500 })) {
      if (typeof raw[key] === 'string') out[key] = raw[key].replace(/[<>]/g, '').slice(0, limit);
    }
    if (raw.nutrition && typeof raw.nutrition === 'object' && !Array.isArray(raw.nutrition)) {
      out.nutrition = {};
      for (const key of ['sodium', 'saturatedFat', 'transFat', 'sugar', 'addedSugar', 'fibre', 'protein', 'calories', 'fat', 'carbs', 'servingGrams', 'servingMl']) if (Number.isFinite(raw.nutrition[key]) && raw.nutrition[key] >= 0 && raw.nutrition[key] <= 1e9) out.nutrition[key] = raw.nutrition[key];
      if (typeof raw.nutrition.servingSize === 'string') out.nutrition.servingSize = raw.nutrition.servingSize.slice(0, 80);
    }
    return out;
  }
  function clean(raw) {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw.key || '') || raw.store !== 'amazon.com' || !/^[A-Z0-9]{10}$/.test(raw.asin || '') || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') || !Number.isFinite(Date.parse(raw.date)) || new Date(raw.date).toISOString().slice(0, 10) !== raw.date || !['purchased', 'cancelled', 'returned', 'unknown'].includes(raw.state)) return null;
    const score = Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 100 ? Math.round(raw.score) : null;
    const plain = (v, n) => typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, n) : '';
    return { key: raw.key, store: 'amazon.com', asin: raw.asin, date: raw.date, state: raw.state,
      name: plain(raw.name, 250), ...( /^[a-f0-9]{64}$/.test(raw.orderKey || '') ? { orderKey: raw.orderKey } : {}), ...(cleanInput(raw.input) ? { input: cleanInput(raw.input) } : {}), score, profile: /^[a-f0-9]{64}$/.test(raw.profile || '') ? raw.profile : '',
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
      if (was.asin !== r.asin || was.date !== r.date || (was.orderKey && r.orderKey && was.orderKey !== r.orderKey)) throw new Error('invalid-history-identity');
      const latest = r.observedAt > was.observedAt ? r : was;
      const terminal = [was, r].filter(x => ['cancelled', 'returned'].includes(x.state)).sort((a, b) => b.observedAt - a.observedAt)[0];
      // Preserve the first usable score, even after preferences or rules change.
      const snapshot = was.score !== null && (r.score === null || was.scoredAt <= r.scoredAt) ? was : r;
      map.set(r.key, { ...latest, state: terminal?.state || latest.state, score: snapshot.score, profile: snapshot.profile, version: snapshot.version,
        ingredients: snapshot.ingredients, flags: snapshot.flags, scoredAt: snapshot.scoredAt,
        ...((was.orderKey || r.orderKey) ? { orderKey: was.orderKey || r.orderKey } : {}),
        input: snapshot.input || ((was.scoredAt === r.scoredAt && was.score === r.score && was.profile === r.profile && was.version === r.version && was.ingredients === r.ingredients) ? was.input || r.input : undefined) });
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
  const value = { MAX, clean, cleanInput, merge, trends };
  root.AIR = root.AIR || {}; root.AIR.db = root.AIR.db || {}; root.AIR.db.purchaseHistory = value;
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
})(typeof globalThis !== 'undefined' ? globalThis : self);
