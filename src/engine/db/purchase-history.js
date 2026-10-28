// Private purchase snapshots; intentionally outside settings backup and shared product caches.
(function(root) {
  const MAX = 10000;
  function cleanInput(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.ingredients_text !== 'string' || !raw.ingredients_text.trim()) return null;
    const out = {};
    if (raw.inputSchema === 1) out.inputSchema = 1;
    // A bounded snapshot of every field the scorer reads, not a live registry reference.
    const evidence = raw.provenanceRecord;
    const plain = v => typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, 500) : '';
    if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
      out.provenanceRecord = { certifications: plain(evidence.certifications), source: plain(evidence.source).slice(0, 120) };
      if (evidence.producerRegistry && typeof evidence.producerRegistry === 'object') {
        out.provenanceRecord.producerRegistry = { certifications: plain(evidence.producerRegistry.certifications) };
      }
    }
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
  function cleanBreakdown(raw, score) {
    if (!Number.isFinite(score) || !raw || !Number.isFinite(raw.base) || raw.base < 0 || raw.base > 200 || !Array.isArray(raw.rows) || raw.rows.length > 80) return null;
    const rows = [];
    for (const row of raw.rows) {
      if (!row || typeof row.why !== 'string' || !row.why.trim() || !Number.isFinite(row.c) || Math.abs(row.c) > 200) return null;
      rows.push({ why: row.why.replace(/[<>]/g, '').slice(0, 160), c: row.c, kind: ['limit', 'adjustment'].includes(row.kind) ? row.kind : 'factor' });
    }
    const out = { base: raw.base, rows };
    return Math.abs(raw.base + rows.reduce((sum, r) => sum + r.c, 0) - score) < 0.001 && JSON.stringify(out).length <= 12000 ? out : null;
  }
  function fromResult(result) {
    if (!result) return null;
    return cleanBreakdown({ base: result.base, rows: [...(result.good || []), ...(result.bad || [])].filter(r => Number.isFinite(r.c) && r.c !== 0).map(r => ({ why: r.why, c: r.c, kind: r.cap ? 'limit' : /^Score floor/.test(r.why) ? 'adjustment' : 'factor' })) }, result.score);
  }
  function clean(raw) {
    if (!raw || !/^[a-f0-9]{64}$/.test(raw.key || '') || raw.store !== 'amazon.com' || !/^[A-Z0-9]{10}$/.test(raw.asin || '') || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') || !Number.isFinite(Date.parse(raw.date)) || new Date(raw.date).toISOString().slice(0, 10) !== raw.date || !['purchased', 'cancelled', 'returned', 'unknown'].includes(raw.state)) return null;
    const score = Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 100 ? Math.round(raw.score) : null;
    const breakdown = cleanBreakdown(raw.breakdown, score);
    const plain = (v, n) => typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, n) : '';
    return { key: raw.key, store: 'amazon.com', asin: raw.asin, date: raw.date, state: raw.state,
      name: plain(raw.name, 250), ...(typeof raw.source === 'string' ? { source: plain(raw.source, 60) } : {}), ...(typeof raw.rulesRevision === 'string' ? { rulesRevision: plain(raw.rulesRevision, 60) } : {}), ...(breakdown ? { breakdown } : {}), ...( /^[a-f0-9]{64}$/.test(raw.orderKey || '') ? { orderKey: raw.orderKey } : {}), ...(cleanInput(raw.input) ? { input: cleanInput(raw.input) } : {}), score, profile: /^[a-f0-9]{64}$/.test(raw.profile || '') ? raw.profile : '',
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
        source: snapshot.source, rulesRevision: snapshot.rulesRevision, ingredients: snapshot.ingredients, flags: snapshot.flags, scoredAt: snapshot.scoredAt,
        ...((was.orderKey || r.orderKey) ? { orderKey: was.orderKey || r.orderKey } : {}),
        breakdown: snapshot.breakdown || ((was.scoredAt === r.scoredAt && was.score === r.score && was.profile === r.profile && was.version === r.version && was.ingredients === r.ingredients) ? was.breakdown || r.breakdown : undefined),
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
  const value = { MAX, clean, cleanInput, cleanBreakdown, fromResult, merge, trends };
  root.AIR = root.AIR || {}; root.AIR.db = root.AIR.db || {}; root.AIR.db.purchaseHistory = value;
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
})(typeof globalThis !== 'undefined' ? globalThis : self);
