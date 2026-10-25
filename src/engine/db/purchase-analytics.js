// Descriptive purchase statistics. Recorded snapshots are never mutated.
(function (root) {
  function project(record, mode, score) {
    let current = null,
      partial = false;
    if (mode === 'current') {
      const input = record.input || (record.ingredients ? { name: record.name, ingredients_text: record.ingredients } : null);
      partial = !record.input;
      if (input) {
        const result = score(input);
        if (result?.readable && Number.isFinite(result.score)) current = result.score;
      }
    }
    return {
      record,
      score: mode === 'current' ? current : record.score,
      recorded: record.score,
      current,
      delta: current !== null && record.score !== null ? current - record.score : null,
      partial,
    };
  }
  function drivers(rows, basis, scorer, breakdownOf) {
    const groups = new Map();
    let eligible = 0,
      covered = 0,
      base = 0,
      adjustment = 0;
    for (const { record } of rows.filter(r => r.record.state === 'purchased')) {
      eligible++;
      const input = record.input || (record.ingredients ? { name: record.name, ingredients_text: record.ingredients } : null);
      let breakdown = record.breakdown;
      if (basis === 'current') {
        const result = input && scorer(input);
        breakdown = result?.readable ? breakdownOf(result) : null;
      }
      if (!breakdown) continue;
      covered++;
      base += breakdown.base;
      for (const row of breakdown.rows) {
        if (row.kind === 'adjustment') {
          adjustment += row.c;
          continue;
        }
        const why = row.kind === 'limit' ? 'Score limit: ' + row.why.split(' — ')[0] : row.why;
        const group = groups.get(why) || { why, positive: 0, negative: 0, net: 0, items: new Set(), orders: new Set() };
        group.net += row.c;
        if (row.c > 0) group.positive += row.c;
        else group.negative += row.c;
        group.items.add(record.key);
        if (record.orderKey) group.orders.add(record.orderKey);
        groups.set(why, group);
      }
    }
    const factors = [...groups.values()].map(g => ({
      ...g,
      items: g.items.size,
      orders: g.orders.size,
      average: covered ? g.net / covered : 0,
    }));
    return {
      eligible,
      covered,
      base,
      adjustment,
      factors,
      positives: factors.filter(g => g.net > 0).sort((a, b) => b.net - a.net),
      negatives: factors.filter(g => g.net < 0).sort((a, b) => a.net - b.net),
    };
  }
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p,
      low = Math.floor(index);
    return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
  }
  function stats(rows, weighting = 'item') {
    const purchased = rows.filter(r => r.record.state === 'purchased'),
      groups = new Map();
    for (const row of purchased)
      if (row.record.orderKey) {
        const values = groups.get(row.record.orderKey) || [];
        if (row.score !== null) values.push(row.score);
        groups.set(row.record.orderKey, values);
      }
    const rated = purchased.filter(r => r.score !== null),
      orderValues = [...groups.values()].filter(v => v.length);
    const values = (
      weighting === 'order' ? orderValues.map(v => v.reduce((a, b) => a + b, 0) / v.length) : rated.map(r => r.score)
    ).sort((a, b) => a - b);
    const n = values.length,
      mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
    const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
    let ci = null;
    // Order clusters keep multiple products from one order from pretending to be independent samples.
    if (orderValues.length > 1 && (weighting === 'order' || rated.every(r => r.record.orderKey))) {
      const k = orderValues.length,
        df = k - 1;
      const t =
        df <= 10
          ? [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228][df]
          : df <= 20
            ? 2.228
            : df <= 30
              ? 2.086
              : df <= 60
                ? 2.042
                : df <= 120
                  ? 2
                  : 1.98;
      const se =
        weighting === 'order'
          ? sd / Math.sqrt(n)
          : Math.sqrt(
              (k / (k - 1)) * orderValues.reduce((s, v) => s + (v.reduce((a, b) => a + b, 0) - mean * v.length) ** 2, 0)
            ) / rated.length;
      ci = [Math.max(0, mean - t * se), Math.min(100, mean + t * se)];
    }
    return {
      items: purchased.length,
      orders: groups.size,
      ungrouped: purchased.filter(r => !r.record.orderKey).length,
      rated: rated.length,
      orderRated: orderValues.length,
      n,
      mean,
      sd,
      median: quantile(values, 0.5),
      q1: quantile(values, 0.25),
      q3: quantile(values, 0.75),
      min: n ? values[0] : null,
      max: n ? values[n - 1] : null,
      ci,
      flagged: purchased.filter(r => r.record.flags.length).length,
      unique: new Set(purchased.map(r => r.record.asin)).size,
    };
  }
  function filter(rows, options = {}) {
    const selected = rows.filter(
      r =>
        (!options.search || `${r.record.name} ${r.record.asin}`.toLowerCase().includes(options.search.toLowerCase())) &&
        (!options.from || r.record.date >= options.from) &&
        (!options.to || r.record.date <= options.to) &&
        (!options.status || options.status === 'all' || r.record.state === options.status) &&
        (options.rating !== 'rated' || r.score !== null) &&
        (options.rating !== 'missing' || r.score === null) &&
        (options.rating !== 'flagged' || r.record.flags.length) &&
        (options.min === '' || options.min === undefined || (r.score !== null && r.score >= Number(options.min))) &&
        (options.max === '' || options.max === undefined || (r.score !== null && r.score <= Number(options.max)))
    );
    const sort = options.sort || 'newest';
    return selected.sort((a, b) => {
      if (sort === 'name') return a.record.name.localeCompare(b.record.name) || a.record.key.localeCompare(b.record.key);
      if (['highest', 'lowest', 'change'].includes(sort)) {
        const x = sort === 'change' ? a.delta : a.score,
          y = sort === 'change' ? b.delta : b.score;
        if (x === null || y === null) {
          if (x !== y) return x === null ? 1 : -1;
        } else if (x !== y) return sort === 'lowest' ? x - y : y - x;
      }
      return (
        (sort === 'oldest' ? 1 : -1) * a.record.date.localeCompare(b.record.date) || a.record.key.localeCompare(b.record.key)
      );
    });
  }
  function periods(rows, options = {}) {
    const groups = new Map();
    for (const row of rows.filter(r => r.record.state === 'purchased')) {
      const month = row.record.date.slice(0, options.period === 'year' ? 4 : 7);
      const setup = options.mode === 'current' ? 'current' : `${row.record.version}:${row.record.profile}`;
      const key = month + ':' + setup,
        group = groups.get(key) || { month, setup, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    return [...groups.values()]
      .sort((a, b) => a.month.localeCompare(b.month) || a.setup.localeCompare(b.setup))
      .map(g => ({ ...g, ...stats(g.rows, options.weighting) }));
  }
  const api = { project, stats, filter, periods, quantile, drivers };
  root.AIR = root.AIR || {};
  root.AIR.db = root.AIR.db || {};
  root.AIR.db.purchaseAnalytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
