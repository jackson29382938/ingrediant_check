// Dependency-free charts and local, reversible comparison views.
(function() {
  const A = AIR.db.purchaseAnalytics, H = AIR.db.purchaseHistory, $ = id => document.getElementById(id);
  let conf = {}, limit = 500, generation = 0, memoKey = '', memo = new Map(), projected = [], calculating = false, scoreInput = () => null;
  const fmt = n => n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  function svgNode(tag, attrs = {}, text) { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; }
  function svgBase(target, label) { target.replaceChildren(); const svg = svgNode('svg', { viewBox: '0 0 540 270', role: 'img', 'aria-label': label }); svg.append(svgNode('title', {}, label)); target.append(svg); return svg; }
  function line(svg, x1, y1, x2, y2, cls) { svg.append(svgNode('line', { x1, y1, x2, y2, class: cls })); }
  function timeline(groups) {
    const rated = groups.filter(g => g.mean !== null), svg = svgBase($('trendChart'), 'Average purchase score over time; exact values are in the timeline data table.');
    if (!rated.length) { svg.append(svgNode('text', { x: 25, y: 125 }, 'No rated purchases match this view.')); return; }
    const y = n => 220 - n * 1.8, dates = rated.map(g => Date.parse(g.month.length === 4 ? g.month + '-01-01' : g.month + '-01'));
    const low = Math.min(...dates), high = Math.max(...dates), x = g => high === low ? 290 : 55 + (Date.parse(g.month.length === 4 ? g.month + '-01-01' : g.month + '-01') - low) / (high - low) * 455;
    for (const n of [0, 25, 50, 75, 100]) { line(svg, 50, y(n), 520, y(n), 'grid'); svg.append(svgNode('text', { x: 13, y: y(n) + 4, class: 'axis' }, n)); }
    const series = new Map(); for (const g of rated) { const list = series.get(g.setup) || []; list.push(g); series.set(g.setup, list); }
    const dash = ['', '8 4', '2 4', '12 4 2 4']; let seriesIndex = 0;
    const readout = el('p', 'Hover or focus a point to inspect its average and coverage.'); readout.className = 'chart-readout'; readout.setAttribute('aria-live', 'polite'); $('trendChart').append(readout);
    for (const list of series.values()) {
      const pattern = dash[seriesIndex++ % dash.length];
      svg.append(svgNode('polyline', { points: list.map(g => `${x(g)},${y(g.mean)}`).join(' '), class: 'trend-line', 'stroke-dasharray': pattern }));
      for (const g of list) {
        const mode = $('errorBars').value, interval = mode === 'iqr' ? [g.q1, g.q3] : mode === 'range' ? [g.min, g.max] : mode === 'ci' ? g.ci : null;
        if (interval && interval.every(Number.isFinite)) { line(svg, x(g), y(interval[0]), x(g), y(interval[1]), 'error'); for (const n of interval) line(svg, x(g) - 5, y(n), x(g) + 5, y(n), 'error'); }
        const label = `${g.month}: ${fmt(g.mean)}/100 · ${g.rated}/${g.items} product entries rated · ${g.orders} identified orders · ${g.setup === 'current' ? 'Current goals' : 'Recorded setup ' + g.setup.slice(0, 18)}${interval ? ` · interval ${fmt(interval[0])}–${fmt(interval[1])}` : ''}`;
        const point = svgNode('circle', { cx: x(g), cy: y(g.mean), r: 5, class: 'point', tabindex: '0', role: 'img', 'aria-label': label }); point.append(svgNode('title', {}, label));
        point.addEventListener('mouseenter', () => { readout.textContent = label; }); point.addEventListener('focus', () => { readout.textContent = label; }); svg.append(point);
      }
    }
    const months = [...new Set(rated.map(g => g.month))], labels = months.length <= 5 ? months : [months[0], months[Math.floor(months.length / 2)], months.at(-1)];
    for (const month of labels) svg.append(svgNode('text', { x: x({ month }), y: 245, 'text-anchor': 'middle', class: 'axis' }, month));
  }
  function histogram(rows) {
    const values = rows.filter(r => r.record.state === 'purchased' && r.score !== null).map(r => r.score), bins = [0, 0, 0, 0, 0], labels = ['0–24', '25–49', '50–74', '75–89', '90–100'];
    for (const score of values) bins[score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : score < 90 ? 3 : 4]++;
    const svg = svgBase($('distributionChart'), 'Number of rated product entries by score band'), max = Math.max(1, ...bins);
    for (let i = 0; i < 5; i++) {
      const height = bins[i] / max * 165, color = AIR.db.theme.band([12, 37, 62, 82, 95][i]);
      const dark = conf.theme === 'dark' || (conf.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
      const rect = svgNode('rect', { x: 35 + i * 100, y: 220 - height, width: 64, height, rx: 7, fill: dark ? color.dfg : color.fg, tabindex: '0', role: 'img', 'aria-label': `${labels[i]}: ${bins[i]} product entries` }); rect.append(svgNode('title', {}, `${labels[i]}: ${bins[i]} entries`)); svg.append(rect);
      svg.append(svgNode('text', { x: 67 + i * 100, y: 210 - height, 'text-anchor': 'middle' }, bins[i])); svg.append(svgNode('text', { x: 67 + i * 100, y: 245, 'text-anchor': 'middle' }, labels[i]));
    }
  }
  function options() { return { mode: $('scoreView').value, weighting: $('averageWeight').value, period: $('period').value, search: $('itemSearch').value.trim(), from: $('dateFrom').value, to: $('dateTo').value, status: $('itemStatus').value, rating: $('ratingFilter').value, min: $('scoreMin').value, max: $('scoreMax').value, sort: $('itemSort').value }; }
  function render() {
    if (calculating) return;
    const opts = options(), rows = A.filter(projected, opts), s = A.stats(rows, opts.weighting), periods = A.periods(rows, opts);
    const all = A.stats(projected), approx = rows.filter(r => r.record.state === 'purchased' && r.current !== null && r.partial).length;
    $('coverage').textContent = `${s.rated} of ${s.items} matching purchased product entries rated · ${s.orders} identified orders${s.ungrouped ? ` · ${s.ungrouped} older entries have unknown order grouping (revisit their order pages to fill it)` : ''}. Full history: ${all.items} purchased product entries across ${all.orders} identified orders. Cancelled, returned and unconfirmed entries do not drive trends.`;
    $('viewNote').textContent = opts.mode === 'recorded' ? 'Showing the original recorded scores. Different scoring setups remain separate in the timeline.' : `Showing current-goal comparisons calculated locally. ${approx} matching entries use ingredient text only. ${s.items - s.rated} could not be recalculated. Recorded scores are unchanged.`;
    $('goalSummary').textContent = 'Current setup: ' + AIR.db.categories.goalsLabel(conf.goals) + (AIR.db.categories.describeGoals(conf.weights, conf.goals, conf.goalImportance).custom ? ' · custom weights' : '');
    $('metrics').replaceChildren();
    for (const [name, value, hint, id] of [['Average score', fmt(s.mean), opts.weighting === 'order' ? 'Each rated identified order equally' : 'Each rated product entry equally', 'metricAverage'], ['Identified orders', fmt(s.orders), s.ungrouped ? `${s.ungrouped} entries not grouped` : 'Distinct order groups', 'metricOrders'], ['Product entries', fmt(s.items), `${s.unique} distinct products; not quantities`, 'metricItems'], ['Rating coverage', s.items ? `${Math.round(s.rated / s.items * 100)}%` : '—', `${s.rated} rated · ${s.items - s.rated} missing`, 'metricCoverage']]) {
      const card = el('div'); card.className = 'metric'; card.append(el('span', name)); const valueNode = el('strong', value); valueNode.id = id; card.append(valueNode, el('small', hint)); $('metrics').append(card);
    }
    timeline(periods); histogram(rows);
    const drivers = A.drivers(rows, $('driverBasis').value, scoreInput, result => result.breakdown);
    $('driversNote').textContent = `${$('driverBasis').value === 'current' ? 'Current-goal analysis; original ratings stay unchanged.' : 'Original recorded point breakdowns only; older scores are not reconstructed.'} ${drivers.covered}/${drivers.eligible} matching purchased entries have usable breakdowns. Processing base total: ${fmt(drivers.base)} points. Scale-floor adjustments: ${fmt(drivers.adjustment)} points.${$('driverBasis').value === 'current' ? ' Older entries without full inputs use ingredient-only approximations.' : ''}`;
    for (const [id, factors] of [['bonusDrivers', drivers.positives], ['minusDrivers', drivers.negatives]]) { $(id).replaceChildren(); for (const factor of factors.slice(0, 8)) $(id).append(el('li', `${factor.net > 0 ? '+' : ''}${fmt(factor.net)} points · ${factor.why} · ${factor.items} entries / ${factor.orders} identified orders`)); if (!factors.length) $(id).append(el('li', 'No contributors available for this view.')); }
    $('driverRows').replaceChildren(); for (const factor of drivers.factors.sort((a,b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 500)) { const tr = el('tr'); for (const value of [factor.why, fmt(factor.positive), fmt(factor.negative), fmt(factor.net), factor.items, factor.orders]) tr.append(el('td', value)); $('driverRows').append(tr); }

    $('statistics').replaceChildren();
    for (const [name, value] of [['Sample size', s.n], ['Median', s.median], ['Sample SD', s.sd], ['25th percentile', s.q1], ['75th percentile', s.q3], ['Minimum', s.min], ['Maximum', s.max], ['95% interval', s.ci ? `${fmt(s.ci[0])}–${fmt(s.ci[1])}` : 'Unavailable'], ['Rated order clusters', s.orderRated]]) { const div = el('div'); div.append(el('dt', name), el('dd', typeof value === 'string' ? value : fmt(value))); $('statistics').append(div); }
    $('statsNote').textContent = `Sample size counts ${opts.weighting === 'order' ? 'rated identified order means; ungrouped entries are excluded' : 'rated product entries'}. Missing scores are never zero. ${opts.mode === 'recorded' ? 'The overall average mixes recorded setups; the timeline separates them.' : 'Warnings below remain those recorded at import.'} ${!s.ci ? 'Not enough complete order grouping for a confidence interval.' : ''}`;
    const setups = new Map(); $('months').replaceChildren();
    for (const g of periods) { if (!setups.has(g.setup)) setups.set(g.setup, setups.size + 1); const tr = el('tr'); for (const value of [g.month, g.setup === 'current' ? 'Current goals' : `Setup ${setups.get(g.setup)} · ${g.rows[0].record.version}`, fmt(g.mean), `${g.rated}/${g.items}`, g.flagged]) tr.append(el('td', value)); $('months').append(tr); }
    const groups = new Map(); for (const r of H.merge([], conf.purchaseHistory)) if (r.orderKey && !groups.has(r.orderKey)) groups.set(r.orderKey, groups.size + 1);
    const orderRows = new Map();
    for (const item of rows.filter(r => r.record.state === 'purchased')) { const id = item.record.orderKey || 'unknown', list = orderRows.get(id) || []; list.push(item); orderRows.set(id, list); }
    $('orderTotals').replaceChildren();
    const visibleOrderRows = [...orderRows].slice(0, 500);
    for (const [id, list] of visibleOrderRows) { const summary = A.stats(list), tr = el('tr'); for (const value of [id === 'unknown' ? 'Ungrouped legacy entries' : `Order ${groups.get(id)}`, id === 'unknown' ? 'Multiple / unknown' : list[0].record.date, list.length, summary.rated, fmt(summary.mean)]) tr.append(el('td', value)); $('orderTotals').append(tr); }
    if (orderRows.size > 500) { const rest = [...orderRows].slice(500).flatMap(([, list]) => list), summary = A.stats(rest), tr = el('tr'); for (const value of [`Other ${orderRows.size - 500} groups / ungrouped entries`, 'Multiple dates', rest.length, summary.rated, fmt(summary.mean)]) tr.append(el('td', value)); $('orderTotals').append(tr); }
    const total = el('tr'); for (const value of ['Total purchased entries', '', s.items, s.rated, fmt(s.mean)]) total.append(el('td', value)); $('orderTotals').append(total);
    $('items').replaceChildren(); for (const item of rows.slice(0, limit)) {
      const r = item.record, tr = el('tr'), name = el('td'), link = el('a', r.name); link.href = `https://www.amazon.com/dp/${r.asin}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; name.append(link);
      tr.append(el('td', r.date), name); for (const value of [r.orderKey ? `Order ${groups.get(r.orderKey)}` : 'Unknown', r.state, fmt(r.score), opts.mode === 'current' ? fmt(item.current) + (item.current !== null && item.partial ? ' (approx.)' : '') : 'Select comparison', item.delta === null ? '—' : (item.delta > 0 ? '+' : '') + fmt(item.delta), r.scoredAt ? new Date(r.scoredAt).toLocaleDateString() : 'Unavailable']) tr.append(el('td', value)); $('items').append(tr);
    }
    $('itemCount').textContent = `${rows.length} matching entries · ${Math.min(limit, rows.length)} shown`; $('moreItems').hidden = rows.length <= limit;
    const counts = new Map(); for (const r of rows.filter(r => r.record.state === 'purchased')) { const c = counts.get(r.record.asin) || { name: r.record.name, entries: 0, orders: new Set(), unknown: 0 }; c.entries++; if (r.record.orderKey) c.orders.add(r.record.orderKey); else c.unknown++; counts.set(r.record.asin, c); }
    $('products').replaceChildren(); for (const c of [...counts.values()].sort((a, b) => b.entries - a.entries).slice(0, 10)) $('products').append(el('li', `${c.name} — ${c.entries} product entries · ${c.orders.size} identified orders${c.unknown ? ` · ${c.unknown} ungrouped` : ''}`));
  }
  async function update(raw) {
    conf = raw; calculating = $('scoreView').value === 'current' || $('driverBasis').value === 'current'; $('trends').closest('section').setAttribute('aria-busy', String(calculating)); const turn = ++generation, opts = options(), scoring = AIR.db.prefs.sanitizeScoring(conf), key = JSON.stringify(scoring);
    if (key !== memoKey) { memo.clear(); memoKey = key; }
    const score = input => { const key = JSON.stringify(input); if (!memo.has(key)) { const result = AIR.engine.score(input, scoring), { score, parsed, coverage, readable } = result; memo.set(key, { score, parsed, coverage, readable, breakdown: H.fromResult(result) }); } return memo.get(key); };
    scoreInput = score;
    const records = H.merge([], conf.purchaseHistory), result = [];
    if ($('driverBasis').value === 'current') $('driversNote').textContent = 'Analysing saved labels locally…';
    if (opts.mode === 'current') $('viewNote').textContent = 'Calculating current-goal comparisons on your computer…';
    for (let offset = 0; offset < records.length; offset += 100) {
      for (const record of records.slice(offset, offset + 100)) { result.push(A.project(record, opts.mode, score)); const input = record.input || (record.ingredients ? { name: record.name, ingredients_text: record.ingredients } : null); if ($('driverBasis').value === 'current' && input) score(input); }
      if (calculating) { await new Promise(resolve => setTimeout(resolve, 0)); if (turn !== generation) return; }
    }
    if (turn !== generation) return; calculating = false; $('trends').closest('section').setAttribute('aria-busy', 'false'); projected = result; render();
  }
  let timer;
  for (const id of ['itemSearch', 'dateFrom', 'dateTo', 'itemStatus', 'ratingFilter', 'scoreMin', 'scoreMax', 'itemSort', 'averageWeight', 'period', 'errorBars']) $(id).addEventListener('input', () => { limit = 500; clearTimeout(timer); timer = setTimeout(render, 100); });
  $('driverBasis').addEventListener('change', () => { void update(conf); });
  $('scoreView').addEventListener('change', () => { limit = 500; void update(conf); });
  $('resetFilters').addEventListener('click', () => { for (const id of ['itemSearch', 'dateFrom', 'dateTo', 'scoreMin', 'scoreMax']) $(id).value = ''; $('itemStatus').value = 'all'; $('ratingFilter').value = 'all'; $('itemSort').value = 'newest'; limit = 500; render(); });
  $('moreItems').addEventListener('click', () => { limit += 500; render(); });
  AIR.historyDashboard = { update };
})();
