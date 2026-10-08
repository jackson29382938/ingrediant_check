// Opt-in reading of the order page already open. No authenticated order requests or pagination.
(function(root) {
  const A = root.AIR, O = A.amazonOrders, H = A.db.purchaseHistory, cache = A.db.scoreCache;
  let running = false, dirty = false, stopped = false, generation = 0, banner, badges = new WeakMap();
  const controllers = new Set(), imageWrappers = new Set(), readings = new Map();
  let currentConf, currentItems = [], currentProfile, currentVersion, currentSummary;
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
  function note(text) {
    if (!banner) {
      banner = document.createElement('aside'); banner.id = 'air-order-history'; banner.setAttribute('role', 'status');
      banner.style.cssText = 'padding:12px;margin:12px 0;border:2px solid #007185;border-radius:8px;background:#fff;color:#111;font:14px/1.5 sans-serif;display:flex;flex-wrap:wrap;align-items:center;gap:10px;box-sizing:border-box';
    }
    // Stay with the order list, below Amazon's navigation, even when its container arrives late.
    const first = document.querySelector('.order-card, .order, [data-order-id]');
    if (first && first.previousElementSibling !== banner) first.before(banner);
    if (!banner.isConnected) {
      const heading = [...document.querySelectorAll('h1')].find(h => /your orders/i.test(h.textContent));
      if (heading) heading.after(banner);
      else document.querySelector('#yourOrders, #ordersContainer, main')?.prepend(banner);
    }
    if (!banner.isConnected) return;
    if (banner.dataset.airText === text) return;
    banner.dataset.airText = text;
    const message = document.createElement('span'); message.textContent = text;
    banner.replaceChildren(message);
    const button = (name, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.style.cssText = 'padding:6px 10px;border:1px solid #007185;border-radius:6px;background:#fff;color:#007185;cursor:pointer;font:inherit'; b.addEventListener('click', fn); banner.append(b); };
    button('History & sync settings', () => chrome.runtime.sendMessage({ type: 'purchaseOpenHistory' }));
    button('Refresh ratings', () => reset(false));
  }
  function paint(line, record, text) {
    let badge = badges.get(line.anchor);
    if (!badge?.isConnected) {
      badge = document.createElement('a'); badge.className = 'air-order-badge';
      badge.href = new URL(`/dp/${line.asin}`, location.origin).href; badge.target = '_blank'; badge.rel = 'noopener noreferrer';
      const img = line.anchor.querySelector('img');
      if (img && line.imageOnly) {
        const wrapper = document.createElement('span'); wrapper.className = 'air-order-image';
        wrapper.style.cssText = 'display:inline-block;position:relative;vertical-align:top;max-width:100%;line-height:0';
        line.anchor.before(wrapper); wrapper.append(line.anchor, badge); imageWrappers.add(wrapper); badge.dataset.imageOnly = 'true';
      } else (line.anchor.closest('.a-truncate') || line.anchor).after(badge);
      badges.set(line.anchor, badge);
    }
    const state = record.state === 'purchased' ? '' : ` · ${record.state}`;
    badge.textContent = record.score !== null ? ` ${record.score}/100${state} ` : ` ${text || (record.state === 'purchased' ? 'Label unavailable' : 'Excluded from trends')}${state} `;
    badge.title = record.score !== null ? `Purchase snapshot, scored ${new Date(record.scoredAt).toLocaleDateString()}. Ingredient labels may differ from when ordered. ${record.flags.join('; ')}. Open product.` : `${line.name}: ${text || 'Label unavailable'}. Open the product to read its label, then use Refresh ratings. Missing labels do not receive an invented score.`;
    badge.setAttribute('aria-label', `${line.name}: ${badge.textContent.trim()}. Open product in a new tab.`);
    const c = record.score !== null ? A.db.theme.band(record.score) : { fg: '#374151', bg: '#f3f4f6', ring: '#9ca3af' };
    badge.style.cssText = `display:inline-block;max-width:100%;box-sizing:border-box;white-space:normal;margin:4px 0;padding:3px 7px;border:2px solid ${c.ring};border-radius:999px;color:${c.fg};background:${c.bg};font:700 12px/1.4 sans-serif;text-decoration:none${badge.dataset.imageOnly ? ';position:absolute;bottom:2px;left:2px;margin:0;max-width:calc(100% - 4px);font-size:10px;padding:1px 3px' : ''}`;
  }
  async function product(line, conf, turn) {
    const control = new AbortController(); controllers.add(control);
    const timer = setTimeout(() => control.abort(), 15000);
    try {
      const url = new URL(`/dp/${line.asin}`, location.origin);
      const r = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: control.signal });
      if (turn !== generation || !O.allowed(location)) throw new Error('navigation');
      if ([403, 429, 503].includes(r.status)) stopped = true;
      if (!r.ok || !/text\/html|application\/xhtml\+xml/i.test(r.headers.get('content-type') || '') || Number(r.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('unavailable');
      const final = new URL(r.url || url.href), adapter = A.cart.adapter(location);
      if (final.origin !== location.origin || adapter.productId(final.href) !== line.asin) throw new Error('identity');
      const reader = r.body.getReader(), chunks = []; let size = 0;
      try { while (true) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 8 * 1024 * 1024 || control.signal.aborted) throw new Error('size'); chunks.push(p.value); } }
      finally { await reader.cancel().catch(() => {}); }
      if (turn !== generation || !O.allowed(location)) throw new Error('navigation');
      const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/html');
      if (/robot|captcha|verify you are human|access denied|security verification/i.test([doc.title, doc.querySelector('h1')?.textContent].join(' '))) { stopped = true; throw new Error('challenge'); }
      const data = A.extract.extract(doc, { asin: line.asin, foodOnly: false });
      if (!doc.querySelector('#productTitle') || data.asin !== line.asin || data.reason === 'product-identity-mismatch') throw new Error('label');
      if (data.ingestible && !data.ingestible.ok && data.ingestible.negatives?.length) return { nonfood: true };
      const input = { name: data.title, labels: data.labels, certifications: data.certifications, ingredients_text: data.text, advisory_text: data.advisoryText, nutrition: data.nutrition };
      const rating = rate(input, data.via || 'page', conf);
      return rating || { fallback: { data, input, urls: A.db.ocrText.imageCandidates(doc) } };
    } finally { clearTimeout(timer); controllers.delete(control); }
  }
  function rate(input, source, conf) {
    if (!input.ingredients_text) return null;
    const result = A.engine.score(input, A.db.prefs.sanitizeScoring(conf));
    if (!result.parsed || result.coverage < 0.34) return null;
    return { score: result.score, ingredients: input.ingredients_text, flags: (result.flags || []).map(f => f.label || f.name || f.message || f.id || '').filter(Boolean), scoredAt: Date.now(), input, source };
  }
  async function fallback(reading, conf, turn, status) {
    if (turn !== generation || !O.allowed(location)) return null;
    const { data, input, urls } = reading.fallback, toggles = A.db.prefs.sanitizeToggles(conf);
    if (toggles.useOpenFoodFacts && data.upc) {
      status('Looking up barcode…');
      const found = await chrome.runtime.sendMessage({ type: 'lookupBarcode', code: data.upc, foodOnly: true });
      if (turn !== generation || !O.allowed(location)) return null;
      if (found?.rejected === 'not-food') return { nonfood: true };
      const rating = rate({ ...input, name: data.title || found?.name, labels: `${input.labels || ''} ${found?.labels || ''}`, ingredients_text: found?.ingredients_text }, 'open-food-facts', conf);
      if (rating) return rating;
    }
    if (toggles.ocrLabels && urls.length) {
      status('Reading label photo…');
      const found = await chrome.runtime.sendMessage({ type: 'ocrLabels', urls });
      if (turn !== generation || !O.allowed(location)) return null;
      const best = found?.ok && A.db.ocrText.bestBlock(found.results, text => A.extract.looksLikeIngredients(text, data.title));
      return best ? rate({ ...input, ingredients_text: best.text }, 'label-ocr', conf) : null;
    }
    return null;
  }
  function savedRating(line, conf, version, saved) {
    const P = A.db.productCache, scoreKey = cache.key(location.hostname, line.asin), labelKey = P.localKey(location.hostname, line.asin);
    const row = P.sanitize(saved[labelKey]);
    const age = A.db.speed.profile(conf.speedMode).maxAgeMs, toggles = A.db.prefs.sanitizeToggles(conf);
    if (row && row.store === 'amazon.com' && row.asin === line.asin && row.data.food === false && !P.stale(row, Date.now(), age)) return { nonfood: true };
    if (row && row.store === 'amazon.com' && row.asin === line.asin && row.status === 'ok' && row.data.food !== false && !P.stale(row, Date.now(), age)
      && (!/ocr/i.test(row.data.via) || toggles.ocrLabels) && (row.data.via !== 'open-food-facts' || toggles.useOpenFoodFacts)) {
      const result = A.engine.score(P.toInput(row), A.db.prefs.sanitizeScoring(conf));
      if (result.parsed && result.coverage >= 0.34) return { score: result.score, scoredAt: Date.now(), ingredients: row.data.text, flags: (result.flags || []).map(f => f.label || f.name || f.id || '').filter(Boolean) };
    }
    const hit = saved[scoreKey];
    return cache.valid(hit, { store: location.hostname, asin: line.asin, version, prefs: conf, maxAgeMs: age }) ? { score: hit.score, scoredAt: hit.t, ingredients: '', flags: [] } : null;
  }
  let lastURL = location.href, signature = '';
  async function run() {
    if (running) { dirty = true; return; }
    running = true; dirty = false;
    const turn = generation;
    try {
      if (!O.allowed(location)) return;
      const conf = await chrome.storage.local.get(['historyEnabled', 'historyOwner', 'googleProfile', 'enabled', 'purchaseHistory', 'weights', 'foodOnly', 'goals', 'allergens', 'diets', 'avoidList', 'sheetIndexRev', 'producerIndexRev', 'speedMode', 'ocrLabels', 'useOpenFoodFacts', 'ratePace', 'theme', 'palette']);
      if (conf.enabled === false) { note('Ingredient Check is paused. Resume it in the extension popup to show order ratings.'); return; }
      if (!conf.historyEnabled) { note('Purchase history is off. Open History & sync settings and enable import to show individual order scores and averages.'); return; }
      if (conf.historyOwner && conf.googleProfile?.email && conf.historyOwner !== conf.googleProfile.email.toLowerCase()) { note('Purchase import paused: your Google account changed. Manage history before switching accounts.'); return; }
      const lines = O.read(document, location), sig = JSON.stringify(lines.map(x => [x.order, x.asin, x.state, x.date]));
      if (sig === signature) return;
      if (!lines.length) { note('No identifiable order items on this page. Open Your Orders; recommendations and order details are not imported.'); return; }
      note('Importing this order page. Only actual order items enter trends; cancelled and returned items are excluded.');
      A.db.theme.use(conf);
      const scoring = A.db.prefs.sanitizeScoring(conf);
      const profile = await hash(JSON.stringify({ scoring: cache.fingerprint(conf, 'page'), allergens: scoring.allergens, diets: scoring.diets, avoid: scoring.avoidList })), version = chrome.runtime.getManifest().version;
      const existing = new Map(H.merge([], conf.purchaseHistory).map(r => [r.key, r]));
      const P = A.db.productCache, speed = A.db.speed.profile(conf.speedMode), pace = A.db.speed.pace(conf.ratePace);
      const local = await chrome.storage.local.get([...new Set(lines.flatMap(line => [cache.key(location.hostname, line.asin), P.localKey(location.hostname, line.asin)]))]);
      const items = await Promise.all(lines.map(async line => {
        const key = await hash(`amazon.com:${line.order}:${line.asin}`), old = existing.get(key);
        const record = { ...(old || {}), key, store: 'amazon.com', asin: line.asin, name: line.name, date: line.date, state: line.state, observedAt: Date.now(), score: old?.score ?? null, profile: old?.profile || profile, version: old?.version || version, scoredAt: old?.scoredAt || 0 };
        const food = A.db.ingestible.assess({ querySelector: () => null }, { title: line.name, text: line.name });
        const hit = record.score === null && line.state === 'purchased' ? savedRating(line, conf, version, local) : null;
        const excluded = (!food.ok && !!food.negatives?.length) || !!hit?.nonfood;
        if (!excluded && hit) Object.assign(record, hit, { profile, version });
        return { line, record: H.clean(excluded ? { ...record, state: 'unknown' } : record), old, excluded };
      }));
      if (turn !== generation || !O.allowed(location)) return;
      currentConf = conf; currentItems = items; currentProfile = profile; currentVersion = version;
      const draw = item => { if (item.line.anchor.isConnected) paint(item.line, item.excluded ? { ...item.record, score: null, state: 'purchased' } : item.record, item.excluded ? 'Not a food' : item.record.score === null && item.record.state === 'purchased' ? 'Checking label…' : undefined); };
      const summary = done => {
        if (turn !== generation || !O.allowed(location)) return;
        const records = items.filter(i => !i.excluded).map(i => i.record), scored = records.filter(r => r.state === 'purchased' && r.score !== null), rated = scored.length;
        const average = rated ? `${Math.round(scored.reduce((sum, r) => sum + r.score, 0) / rated)}/100` : 'unavailable (no rated food purchases)';
        note(`Page average: ${average}. ${done ? 'This page imported:' : 'Checking missing labels:'} ${rated} rated food purchases of ${records.filter(r => r.state === 'purchased').length} eligible purchases; ${records.filter(r => r.state === 'purchased' && r.score === null).length} labels unavailable; ${items.filter(i => i.excluded).length} non-food items excluded; ${records.filter(r => r.state !== 'purchased').length} cancelled, returned or unconfirmed entries excluded. Open older order pages to extend history. Ratings use available product labels, not the original purchased package.${stopped ? ' Amazon blocked public label lookups; open products to read labels, then refresh ratings.' : ''}`);
      };
      currentSummary = () => summary(!running);
      // Paint every saved answer before even the first public lookup, independently of its position.
      items.forEach(draw); summary(false);
      const save = async selected => {
        if (!selected.length || turn !== generation || !O.allowed(location)) return;
        const saved = await chrome.runtime.sendMessage({ type: 'purchaseImport', records: selected.map(i => H.clean(i.record)) });
        if (!saved?.ok) throw new Error('history-not-saved');
        for (const item of selected) { const row = saved.records?.find(r => r.key === item.record.key); if (row) Object.assign(item.record, H.merge([item.record], [row])[0]); }
      };
      await save(items.filter(i => !i.excluded || i.old));
      if (turn !== generation || !O.allowed(location)) return;
      const persistReading = async (line, rating) => {
        if (!rating?.input || turn !== generation || !O.allowed(location)) return;
        const row = P.fromScan({ store: 'amazon.com', asin: line.asin, input: rating.input, via: rating.source, confidence: rating.source === 'label-ocr' ? 0.7 : rating.source === 'open-food-facts' ? 0.55 : 1 });
        if (row) await chrome.storage.local.set({ [P.localKey(location.hostname, line.asin)]: row });
      };
      const complete = async (affected, rating) => {
        if (turn !== generation || !O.allowed(location)) return;
        for (const item of affected) {
          if (rating?.nonfood) { item.excluded = true; item.record.state = 'unknown'; }
          else if (rating?.score !== undefined && item.record.score === null) Object.assign(item.record, H.clean({ ...item.record, ...rating, profile, version }));
          draw(item);
          if (!item.excluded && item.record.score === null && item.line.anchor.isConnected) paint(item.line, item.record);
        }
        summary(false);
        if (rating) await save(affected.filter(i => !i.excluded || i.old));
      };
      const cold = new Map();
      for (const item of items) if (!item.excluded && item.record.score === null && item.record.state === 'purchased') { const group = cold.get(item.line.asin) || []; group.push(item); cold.set(item.line.asin, group); }
      // A separate bounded fallback queue keeps slow OCR from holding product-page fetch slots.
      let fallbackActive = 0; const fallbackQueue = [], fallbackTasks = [];
      const pumpFallback = () => {
        while (fallbackActive < 2 && fallbackQueue.length) {
          const task = fallbackQueue.shift(); fallbackActive++;
          task.work().then(task.resolve, task.reject).finally(() => { fallbackActive--; pumpFallback(); });
        }
      };
      const queueFallback = work => { const task = new Promise((resolve, reject) => { fallbackQueue.push({ work, resolve, reject }); pumpFallback(); }); fallbackTasks.push(task); task.catch(() => {}); };
      const pending = [...cold.values()]; let at = 0, used = 0, nextStart = 0;
      const work = async () => {
        while (at < pending.length && turn === generation && O.allowed(location)) {
          const affected = pending[at++], line = affected[0].line;
          if (affected.every(i => i.record.score !== null)) continue;
          if (stopped || used >= speed.autoFetches) { await complete(affected, null); continue; }
          try {
            let reading = readings.get(line.asin);
            if (!reading) {
              used++; const wait = Math.max(0, nextStart - Date.now()); nextStart = Math.max(nextStart, Date.now()) + pace.gapMs;
              if (wait) await new Promise(resolve => setTimeout(resolve, wait));
              if (turn !== generation || stopped || !O.allowed(location)) continue;
              reading = product(line, conf, turn); readings.set(line.asin, reading);
            }
            const data = await reading;
            if (data.fallback) queueFallback(async () => {
              let rating = null; try { rating = await fallback(data, conf, turn, text => { if (turn === generation) affected.forEach(i => { if (i.record.score === null && i.line.anchor.isConnected) paint(i.line, i.record, text); }); }); } catch { /* optional source unavailable */ }
              await persistReading(line, rating); await complete(affected, rating);
            });
            else { await persistReading(line, data); await complete(affected, data); }
          } catch (e) { if (e.message === 'history-not-saved') throw e; await complete(affected, null); }
        }
      };
      await Promise.all(Array.from({ length: pace.concurrent }, work));
      await Promise.all(fallbackTasks);
      if (turn !== generation || !O.allowed(location)) return;
      signature = sig;
      summary(true);
    } catch { note('Order import did not complete. Successfully imported items are kept; check History & sync settings and retry this page.'); }
    finally { running = false; if (dirty) setTimeout(run, 250); }
  }
  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 300); }).observe(document.documentElement, { childList: true, subtree: true });
  function reset(clearStop = true) { generation++; currentItems = []; currentSummary = null; readings.clear(); signature = ''; if (clearStop) stopped = false; badges = new WeakMap(); controllers.forEach(c => c.abort()); document.querySelectorAll('.air-order-badge').forEach(b => b.remove()); for (const wrapper of imageWrappers) { wrapper.replaceWith(...wrapper.childNodes); } imageWrappers.clear(); banner?.remove(); banner = null; void run(); }
  async function cacheChanged(changes) {
    if (!currentItems.length || !currentConf) return;
    const turn = generation, selected = currentItems.filter(i => !i.excluded && i.record.state === 'purchased' && i.record.score === null && [cache.key(location.hostname, i.line.asin), A.db.productCache.localKey(location.hostname, i.line.asin)].some(k => changes[k]));
    if (!selected.length) return;
    const stored = await chrome.storage.local.get([...new Set(selected.flatMap(i => [cache.key(location.hostname, i.line.asin), A.db.productCache.localKey(location.hostname, i.line.asin)]))]);
    if (turn !== generation || !O.allowed(location)) return;
    const updates = [];
    for (const item of selected) {
      const hit = savedRating(item.line, currentConf, currentVersion, stored);
      if (!hit || hit.nonfood || item.record.score !== null) continue;
      Object.assign(item.record, H.clean({ ...item.record, ...hit, profile: currentProfile, version: currentVersion })); updates.push(item.record);
      if (item.line.anchor.isConnected) paint(item.line, item.record);
    }
    if (updates.length) {
      currentSummary?.();
      const saved = await chrome.runtime.sendMessage({ type: 'purchaseImport', records: updates });
      if (turn !== generation || !O.allowed(location)) return;
      if (!saved?.ok) throw new Error('history-not-saved');
      for (const item of selected) { const row = saved.records?.find(r => r.key === item.record.key); if (row) { Object.assign(item.record, H.merge([item.record], [row])[0]); if (item.line.anchor.isConnected) paint(item.line, item.record); } }
      signature = ''; dirty = true; if (!running) void run();
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (['enabled', 'historyEnabled', 'theme', 'palette', 'ocrLabels', 'useOpenFoodFacts', 'ratePace'].some(k => changes[k]) || (changes.googleProfile && changes.googleProfile.oldValue?.email !== changes.googleProfile.newValue?.email)) reset();
    else if (Object.keys(changes).some(k => /^(s|p):amazon\.com:/.test(k))) void cacheChanged(changes).catch(() => { note('A saved product rating could not be added to history. Open History & sync settings and refresh this page.'); });
  });
  setInterval(() => { if (location.href !== lastURL) { lastURL = location.href; reset(); } }, 1000);
  void run();
})(typeof globalThis !== 'undefined' ? globalThis : self);
