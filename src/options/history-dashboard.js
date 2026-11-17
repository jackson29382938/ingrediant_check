// Dependency-free charts and local, reversible comparison views.
(function() {
  const A = AIR.db.purchaseAnalytics, H = AIR.db.purchaseHistory, $ = id => document.getElementById(id);
  let conf = {}, limit = 500, generation = 0, memoKey = '', memo = new Map(), projected = [], calculating = false, scoreInput = () => null;
  // The same helper as history.js: every string shown goes through it, with `$1`…`$9` for the values.
  const t = (key, fallback, ...subs) => {
    let text = '';
    try { text = chrome.i18n.getMessage(key, subs.map(String)); } catch (e) { /* no locale: the English below */ }
    return text || fallback.replace(/\$(\d)/g, (all, n) => (subs[n - 1] === undefined ? all : String(subs[n - 1])));
  };
  const fmt = n => n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  function svgNode(tag, attrs = {}, text) { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; }
  function svgBase(target, label) { target.replaceChildren(); const svg = svgNode('svg', { viewBox: '0 0 540 270', role: 'img', 'aria-label': label }); svg.append(svgNode('title', {}, label)); target.append(svg); return svg; }
  function line(svg, x1, y1, x2, y2, cls) { svg.append(svgNode('line', { x1, y1, x2, y2, class: cls })); }
  function timeline(groups) {
    const rated = groups.filter(g => g.mean !== null), svg = svgBase($('trendChart'), t('histChartTrendLabel', 'Average purchase score over time; exact values are in the timeline data table.'));
    if (!rated.length) { svg.append(svgNode('text', { x: 25, y: 125 }, t('histChartNoRated', 'No rated purchases match this view.'))); return; }
    const y = n => 220 - n * 1.8, dates = rated.map(g => Date.parse(g.month.length === 4 ? g.month + '-01-01' : g.month + '-01'));
    const low = Math.min(...dates), high = Math.max(...dates), x = g => high === low ? 290 : 55 + (Date.parse(g.month.length === 4 ? g.month + '-01-01' : g.month + '-01') - low) / (high - low) * 455;
    for (const n of [0, 25, 50, 75, 100]) { line(svg, 50, y(n), 520, y(n), 'grid'); svg.append(svgNode('text', { x: 13, y: y(n) + 4, class: 'axis' }, n)); }
    const series = new Map(); for (const g of rated) { const list = series.get(g.setup) || []; list.push(g); series.set(g.setup, list); }
    const setupNames = new Map([...new Set(groups.map(g => g.setup))].map((key, i) => [key, t('histRecordedSetup', 'Recorded setup $1', i + 1)]));
    const dash = ['', '8 4', '2 4', '12 4 2 4']; let seriesIndex = 0;
    const readout = el('p', t('histChartReadout', 'Hover or focus a point to inspect its average and coverage.')); readout.className = 'chart-readout'; readout.setAttribute('aria-live', 'polite'); $('trendChart').append(readout);
    for (const list of series.values()) {
      const pattern = dash[seriesIndex++ % dash.length];
      svg.append(svgNode('polyline', { points: list.map(g => `${x(g)},${y(g.mean)}`).join(' '), class: 'trend-line', 'stroke-dasharray': pattern }));
      for (const g of list) {
        const mode = $('errorBars').value, interval = mode === 'iqr' ? [g.q1, g.q3] : mode === 'range' ? [g.min, g.max] : mode === 'ci' ? g.ci : null;
        if (interval && interval.every(Number.isFinite)) { line(svg, x(g), y(interval[0]), x(g), y(interval[1]), 'error'); for (const n of interval) line(svg, x(g) - 5, y(n), x(g) + 5, y(n), 'error'); }
        const label = t('histPointLabel', '$1: $2/100 · $3/$4 product entries rated · $5 identified orders · $6', g.month, fmt(g.mean), g.rated, g.items, g.orders, g.setup === 'current' ? t('histCurrentGoals', 'Current goals') : setupNames.get(g.setup)) + (interval ? ' · ' + t('histPointInterval', 'interval $1–$2', fmt(interval[0]), fmt(interval[1])) : '');
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
    const svg = svgBase($('distributionChart'), t('histChartBandsLabel', 'Number of rated product entries by score band')), max = Math.max(1, ...bins);
    for (let i = 0; i < 5; i++) {
      const height = bins[i] / max * 165, color = AIR.db.theme.band([12, 37, 62, 82, 95][i]);
      const dark = conf.theme === 'dark' || (conf.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
      const rect = svgNode('rect', { x: 35 + i * 100, y: 220 - height, width: 64, height, rx: 7, fill: dark ? color.dfg : color.fg, tabindex: '0', role: 'img', 'aria-label': t('histBandEntriesLong', '$1: $2 product entries', labels[i], bins[i]) }); rect.append(svgNode('title', {}, t('histBandEntries', '$1: $2 entries', labels[i], bins[i]))); svg.append(rect);
      svg.append(svgNode('text', { x: 67 + i * 100, y: 210 - height, 'text-anchor': 'middle' }, bins[i])); svg.append(svgNode('text', { x: 67 + i * 100, y: 245, 'text-anchor': 'middle' }, labels[i]));
    }
  }
  function options() { return { mode: $('scoreView').value, weighting: $('averageWeight').value, period: $('period').value, search: $('itemSearch').value.trim(), from: $('dateFrom').value, to: $('dateTo').value, status: $('itemStatus').value, source: $('sourceFilter').value, rating: $('ratingFilter').value, min: $('scoreMin').value, max: $('scoreMax').value, sort: $('itemSort').value }; }
  function render() {
    if (calculating) return;
    const opts = options(), rows = A.filter(projected, opts), s = A.stats(rows, opts.weighting), periods = A.periods(rows, opts);
    const all = A.stats(projected), approx = rows.filter(r => r.record.state === 'purchased' && r.current !== null && r.partial).length;
    const quality = A.quality(rows, opts.mode);
    $('historyEmpty').hidden = projected.length > 0;
    $('historyNoMatches').hidden = !projected.length || rows.length > 0;
    const notes = [];
    if (quality.purchased) {
      notes.push(t('histQualityUsable', '$1/$2 purchased entries have a usable score ($3% coverage).', quality.rated, quality.purchased, Math.round(quality.rated / quality.purchased * 100)));
      if (quality.missing) notes.push(t('histQualityMissing', '$1 missing scores are excluded from averages, not counted as zero.', quality.missing));
      if (quality.setups > 1) notes.push(t('histQualitySetups', '$1 recorded scoring setups are mixed in the overall average. Switch to current goals for a consistent comparison; timeline lines remain separate.', quality.setups));
      if (quality.approximate) notes.push(t('histQualityApproximate', '$1 comparisons use older ingredient-only inputs.', quality.approximate));
    } else notes.push(rows.length ? t('histNoConfirmed', 'No confirmed purchases in this view. Returned, cancelled and unconfirmed entries do not contribute to trends.') : t('histNothingToSummarize', 'No purchased entries to summarize.'));
    $('qualitySummary').textContent = notes.join(' ');
    $('qualityMeter').max = Math.max(1, quality.purchased); $('qualityMeter').value = quality.rated;
    $('qualityMeter').setAttribute('aria-label', t('histMeterLabel', '$1 of $2 purchased entries rated', quality.rated, quality.purchased));
    $('coverage').textContent = t('histCoverageMatching', '$1 of $2 matching purchased product entries rated · $3 identified orders', s.rated, s.items, s.orders) + (s.ungrouped ? ' · ' + t('histCoverageUngrouped', '$1 older entries have unknown order grouping (revisit their order pages to fill it)', s.ungrouped) : '') + '. ' + t('histCoverageFull', 'Full history: $1 purchased product entries across $2 identified orders. Cancelled, returned and unconfirmed entries do not drive trends.', all.items, all.orders);
    $('viewNote').textContent = opts.mode === 'recorded' ? t('histShowingRecorded', 'Showing the original recorded scores. Different scoring setups remain separate in the timeline.') : t('histShowingCurrent', 'Showing current-goal comparisons calculated locally. $1 matching entries use ingredient text only. $2 could not be recalculated. Recorded scores are unchanged.', approx, s.items - s.rated);
    $('goalSummary').textContent = t('histCurrentSetup', 'Current setup:') + ' ' + (AIR.db.categories.sanitizeGoals(conf.goals).length ? AIR.db.categories.sanitizeGoals(conf.goals) : ['balanced']).map(id => t('presetLabel_' + id, AIR.db.categories.PRESETS[id].label)).join(' + ') + (AIR.db.categories.describeGoals(conf.weights, conf.goals, conf.goalImportance).custom ? ' · ' + t('histCustomWeights', 'custom weights') : '');
    $('metrics').replaceChildren();
    for (const [name, value, hint, id] of [[t('histMetricAverage', 'Average score'), fmt(s.mean), opts.weighting === 'order' ? t('histHintOrders', 'Each rated identified order equally') : t('histHintEntries', 'Each rated product entry equally'), 'metricAverage'], [t('histMetricOrders', 'Identified orders'), fmt(s.orders), s.ungrouped ? t('histHintUngrouped', '$1 entries not grouped', s.ungrouped) : t('histHintOrderGroups', 'Distinct order groups'), 'metricOrders'], [t('histMetricEntries', 'Product entries'), fmt(s.items), t('histHintDistinct', '$1 distinct products; not quantities', s.unique), 'metricItems'], [t('histMetricCoverage', 'Rating coverage'), s.items ? `${Math.round(s.rated / s.items * 100)}%` : '—', t('histHintRatedMissing', '$1 rated · $2 missing', s.rated, s.items - s.rated), 'metricCoverage']]) {
      const card = el('div'); card.className = 'metric'; card.append(el('span', name)); const valueNode = el('strong', value); valueNode.id = id; card.append(valueNode, el('small', hint)); $('metrics').append(card);
    }
    timeline(periods); histogram(rows);
    const drivers = A.drivers(rows, $('driverBasis').value, scoreInput, result => result.breakdown);
    $('driversNote').textContent = `${$('driverBasis').value === 'current' ? t('histDriversCurrent', 'Current-goal analysis; original ratings stay unchanged.') : t('histDriversRecorded', 'Original recorded point breakdowns only; older scores are not reconstructed.')} ${t('histDriversCovered', '$1/$2 matching purchased entries have usable breakdowns. Processing base total: $3 points. Scale-floor adjustments: $4 points.', drivers.covered, drivers.eligible, fmt(drivers.base), fmt(drivers.adjustment))}${$('driverBasis').value === 'current' ? ' ' + t('histDriversApprox', 'Older entries without full inputs use ingredient-only approximations.') : ''}`;
    for (const [id, factors] of [['bonusDrivers', drivers.positives], ['minusDrivers', drivers.negatives]]) { $(id).replaceChildren(); for (const factor of factors.slice(0, 8)) $(id).append(el('li', t('histDriverRow', '$1 points · $2 · $3 entries / $4 identified orders', (factor.net > 0 ? '+' : '') + fmt(factor.net), factor.why, factor.items, factor.orders))); if (!factors.length) $(id).append(el('li', t('histNoContributors', 'No contributors available for this view.'))); }
    $('driverRows').replaceChildren(); for (const factor of drivers.factors.sort((a,b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 500)) { const tr = el('tr'); for (const value of [factor.why, fmt(factor.positive), fmt(factor.negative), fmt(factor.net), factor.items, factor.orders]) tr.append(el('td', value)); $('driverRows').append(tr); }

    $('statistics').replaceChildren();
    for (const [name, value] of [[t('histStatSampleSize', 'Sample size'), s.n], [t('histStatMedian', 'Median'), s.median], [t('histStatSd', 'Sample SD'), s.sd], [t('histStatQ1', '25th percentile'), s.q1], [t('histStatQ3', '75th percentile'), s.q3], [t('histStatMin', 'Minimum'), s.min], [t('histStatMax', 'Maximum'), s.max], [t('histStatInterval', '95% interval'), s.ci ? `${fmt(s.ci[0])}–${fmt(s.ci[1])}` : t('histUnavailable', 'Unavailable')], [t('histStatClusters', 'Rated order clusters'), s.orderRated]]) { const div = el('div'); div.append(el('dt', name), el('dd', typeof value === 'string' ? value : fmt(value))); $('statistics').append(div); }
    $('statsNote').textContent = `${opts.weighting === 'order' ? t('histStatsCountOrders', 'Sample size counts rated identified order means; ungrouped entries are excluded.') : t('histStatsCountEntries', 'Sample size counts rated product entries.')} ${t('histStatsNote', 'Product entries are distinct products within an order, not purchased quantities or servings. Missing scores are never zero. Intervals estimate variation in rated purchases using order clusters; they do not measure OCR accuracy, label completeness, or medical benefit. Missing labels can bias the average; check rating coverage before comparing periods.')} ${opts.mode === 'recorded' ? t('histStatsMixed', 'The overall average mixes recorded setups; the timeline separates them.') : t('histStatsWarnings', 'Warnings below remain those recorded at import.')} ${!s.ci ? t('histStatsNoInterval', 'Not enough complete order grouping for a confidence interval.') : ''}`;
    const setups = new Map(); $('months').replaceChildren();
    for (const g of periods) { if (!setups.has(g.setup)) setups.set(g.setup, setups.size + 1); const tr = el('tr'); for (const value of [g.month, g.setup === 'current' ? t('histCurrentGoals', 'Current goals') : t('histSetupRow', 'Setup $1 · $2', setups.get(g.setup), g.rows[0].record.version), fmt(g.mean), `${g.rated}/${g.items}`, g.flagged]) tr.append(el('td', value)); $('months').append(tr); }
    const groups = new Map(); for (const r of H.merge([], conf.purchaseHistory)) if (r.orderKey && !groups.has(r.orderKey)) groups.set(r.orderKey, groups.size + 1);
    const orderRows = new Map();
    for (const item of rows.filter(r => r.record.state === 'purchased')) { const id = item.record.orderKey || 'unknown', list = orderRows.get(id) || []; list.push(item); orderRows.set(id, list); }
    $('orderTotals').replaceChildren();
    const visibleOrderRows = [...orderRows].slice(0, 500);
    for (const [id, list] of visibleOrderRows) { const summary = A.stats(list), tr = el('tr'); for (const value of [id === 'unknown' ? t('histUngroupedLegacy', 'Ungrouped legacy entries') : t('histOrderN', 'Order $1', groups.get(id)), id === 'unknown' ? t('histMultipleUnknown', 'Multiple / unknown') : list[0].record.date, list.length, summary.rated, fmt(summary.mean)]) tr.append(el('td', value)); $('orderTotals').append(tr); }
    if (orderRows.size > 500) { const rest = [...orderRows].slice(500).flatMap(([, list]) => list), summary = A.stats(rest), tr = el('tr'); for (const value of [t('histOtherGroups', 'Other $1 groups / ungrouped entries', orderRows.size - 500), t('histMultipleDates', 'Multiple dates'), rest.length, summary.rated, fmt(summary.mean)]) tr.append(el('td', value)); $('orderTotals').append(tr); }
    const total = el('tr'); for (const value of [t('histTotalPurchased', 'Total purchased entries'), '', s.items, s.rated, fmt(s.mean)]) total.append(el('td', value)); $('orderTotals').append(total);
    $('items').replaceChildren(); for (const item of rows.slice(0, limit)) {
      const r = item.record, tr = el('tr'), name = el('td'), link = el('a', r.name); link.href = `https://www.amazon.com/dp/${r.asin}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; name.append(link);
      tr.append(el('td', r.date), name); for (const value of [r.orderKey ? t('histOrderN', 'Order $1', groups.get(r.orderKey)) : t('histUnknown', 'Unknown'), t('histState' + String(r.state || 'unknown').replace(/^./, c => c.toUpperCase()), r.state), fmt(r.score), opts.mode === 'current' ? fmt(item.current) + (item.current !== null && item.partial ? ' ' + t('histApprox', '(approx.)') : '') : t('histSelectComparison', 'Select comparison'), item.delta === null ? '—' : (item.delta > 0 ? '+' : '') + fmt(item.delta), r.scoredAt ? new Date(r.scoredAt).toLocaleDateString() : t('histUnavailable', 'Unavailable'), r.source || t('histSourceNotRecorded', 'Not recorded')]) tr.append(el('td', value)); $('items').append(tr);
    }
    $('itemCount').textContent = t('histItemCount', '$1 matching entries · $2 shown', rows.length, Math.min(limit, rows.length)); $('moreItems').hidden = rows.length <= limit;
    const counts = new Map(); for (const r of rows.filter(r => r.record.state === 'purchased')) { const c = counts.get(r.record.asin) || { name: r.record.name, entries: 0, orders: new Set(), unknown: 0 }; c.entries++; if (r.record.orderKey) c.orders.add(r.record.orderKey); else c.unknown++; counts.set(r.record.asin, c); }
    $('products').replaceChildren(); for (const c of [...counts.values()].sort((a, b) => b.entries - a.entries).slice(0, 10)) $('products').append(el('li', t('histFrequentRow', '$1 — $2 product entries · $3 identified orders', c.name, c.entries, c.orders.size) + (c.unknown ? ' · ' + t('histFrequentUngrouped', '$1 ungrouped', c.unknown) : '')));
  }
  async function update(raw) {
    conf = raw; calculating = $('scoreView').value === 'current' || $('driverBasis').value === 'current'; $('trends').closest('section').setAttribute('aria-busy', String(calculating)); const turn = ++generation, opts = options(), scoring = AIR.db.prefs.sanitizeScoring(conf), key = JSON.stringify(scoring);
    if (key !== memoKey) { memo.clear(); memoKey = key; }
    const records = H.merge([], conf.purchaseHistory), result = [];
    // Deleted/replaced history must not survive as serialized label inputs in the
    // open dashboard's scoring cache. Retain only inputs still in current storage.
    const liveInputs = new Set(records.map(record => record.input || (record.ingredients ? { name: record.name, ingredients_text: record.ingredients } : null)).filter(Boolean).map(input => JSON.stringify(input)));
    for (const cached of memo.keys()) if (!liveInputs.has(cached)) memo.delete(cached);
    const score = input => { const key = JSON.stringify(input); if (!memo.has(key)) { const result = AIR.engine.score(input, scoring), { score, parsed, coverage, readable } = result; memo.set(key, { score, parsed, coverage, readable, breakdown: H.fromResult(result) }); } return memo.get(key); };
    scoreInput = score;
    if ($('driverBasis').value === 'current') $('driversNote').textContent = t('histAnalysing', 'Analysing saved labels locally…');
    if (opts.mode === 'current') $('viewNote').textContent = t('histCalculating', 'Calculating current-goal comparisons on your computer…');
    for (let offset = 0; offset < records.length; offset += 100) {
      for (const record of records.slice(offset, offset + 100)) { result.push(A.project(record, opts.mode, score)); const input = record.input || (record.ingredients ? { name: record.name, ingredients_text: record.ingredients } : null); if ($('driverBasis').value === 'current' && input) score(input); }
      if (calculating) { await new Promise(resolve => setTimeout(resolve, 0)); if (turn !== generation) return; }
    }
    if (turn !== generation) return; calculating = false; $('trends').closest('section').setAttribute('aria-busy', 'false'); projected = result; render();
  }
  let timer;
  for (const id of ['itemSearch', 'dateFrom', 'dateTo', 'itemStatus', 'sourceFilter', 'ratingFilter', 'scoreMin', 'scoreMax', 'itemSort', 'averageWeight', 'period', 'errorBars']) $(id).addEventListener('input', () => { limit = 500; clearTimeout(timer); timer = setTimeout(render, 100); });
  $('driverBasis').addEventListener('change', () => { void update(conf); });
  $('scoreView').addEventListener('change', () => { limit = 500; void update(conf); });
  $('resetFilters').addEventListener('click', () => { for (const id of ['itemSearch', 'dateFrom', 'dateTo', 'scoreMin', 'scoreMax']) $(id).value = ''; $('itemStatus').value = 'all'; $('ratingFilter').value = 'all'; $('sourceFilter').value = 'all'; $('itemSort').value = 'newest'; limit = 500; render(); });
  $('moreItems').addEventListener('click', () => { limit += 500; render(); });
  AIR.historyDashboard = { update };
})();
