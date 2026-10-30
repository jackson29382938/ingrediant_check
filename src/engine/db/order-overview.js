// Compact purchase summaries use purchase dates in the shopper's local calendar.
(function(root) {
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  function summarize(records, now = new Date()) {
    const today = dateKey(now), week = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    week.setDate(week.getDate() - (week.getDay() + 6) % 7);
    const rows = (Array.isArray(records) ? records : []).filter(r => r?.state === 'purchased' && Number.isFinite(r.score) && r.score >= 0 && r.score <= 100
      && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date <= today && Number.isFinite(Date.parse(r.date)) && new Date(r.date).toISOString().slice(0, 10) === r.date);
    const averages = [['day', today], ['week', dateKey(week)], ['month', today.slice(0, 7) + '-01']].flatMap(([period, from]) => {
      const selected = rows.filter(r => r.date >= from);
      return selected.length ? [{ period, count: selected.length, score: selected.reduce((sum, r) => sum + r.score, 0) / selected.length }] : [];
    });
    const days = new Map();
    for (const row of rows) { const values = days.get(row.date) || []; values.push(row.score); days.set(row.date, values); }
    const points = [...days].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, values]) => ({ date, score: values.reduce((sum, n) => sum + n, 0) / values.length }));
    return { averages, points };
  }
  const api = { summarize };
  root.AIR = root.AIR || {}; root.AIR.db = root.AIR.db || {}; root.AIR.db.orderOverview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
