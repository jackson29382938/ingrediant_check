// Opt-in reading of the order page already open. No authenticated order requests or pagination.
(function(root) {
  const A = root.AIR, O = A.amazonOrders, H = A.db.purchaseHistory, cache = A.db.scoreCache;
  let running = false, dirty = false, stopped = false, generation = 0, banner;
  const controllers = new Set();
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
  function note(text) {
    if (!banner) {
      banner = document.createElement('aside'); banner.id = 'air-order-history'; banner.setAttribute('role', 'status');
      banner.style.cssText = 'padding:12px;margin:12px;border:2px solid #007185;border-radius:8px;background:#fff;color:#111;font:14px/1.5 sans-serif';
      document.querySelector('#yourOrders, #ordersContainer, main')?.prepend(banner);
      if (!banner.isConnected) document.body.prepend(banner);
    }
    if (banner.dataset.airText === text) return;
    banner.dataset.airText = text;
    banner.textContent = text;
    const link = document.createElement('button'); link.type = 'button'; link.textContent = 'History & sync settings'; link.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'purchaseOpenHistory' })); banner.append(link);
  }
  function paint(line, record, text) {
    let badge = line.anchor.parentElement.querySelector('.air-order-badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'air-order-badge'; line.anchor.after(badge); }
    const state = record.state === 'purchased' ? '' : ` · ${record.state}`;
    badge.textContent = record.score !== null ? ` ${record.score}/100${state} ` : ` ${text || 'Label unavailable'}${state} `;
    badge.title = record.score !== null ? `Purchase snapshot, scored ${new Date(record.scoredAt).toLocaleDateString()}. Ingredient labels may differ from when ordered. ${record.flags.join('; ')}` : 'Missing labels do not receive an invented score.';
    const c = record.score !== null ? A.db.theme.band(record.score) : { fg: '#374151', bg: '#f3f4f6', ring: '#9ca3af' };
    badge.style.cssText = `display:inline-block;margin:4px;padding:3px 7px;border:2px solid ${c.ring};border-radius:999px;color:${c.fg};background:${c.bg};font:700 12px/1.4 sans-serif`;
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
      const data = adapter.readProduct(doc, final);
      if (!data.real || data.id !== line.asin || !data.ingredients) throw new Error('label');
      if (data.food && !data.food.ok && data.food.negatives?.length) return { nonfood: true };
      const result = A.engine.score({ name: data.title, labels: data.labels, certifications: data.certifications, ingredients_text: data.ingredients, advisory_text: data.advisoryText, nutrition: data.nutrition }, A.db.prefs.sanitizeScoring(conf));
      if (!result.parsed || result.coverage < 0.34) throw new Error('coverage');
      return { score: result.score, ingredients: data.ingredients, flags: (result.flags || []).map(f => f.label || f.name || f.message || f.id || '').filter(Boolean), scoredAt: Date.now() };
    } finally { clearTimeout(timer); controllers.delete(control); }
  }
  let lastURL = location.href, signature = '';
  async function run() {
    if (running) { dirty = true; return; }
    running = true; dirty = false;
    const turn = generation;
    try {
      if (!O.allowed(location)) return;
      const conf = await chrome.storage.local.get(['historyEnabled', 'historyOwner', 'googleProfile', 'enabled', 'purchaseHistory', 'weights', 'foodOnly', 'goals', 'allergens', 'diets', 'avoidList', 'sheetIndexRev', 'producerIndexRev', 'speedMode', 'theme', 'palette']);
      if (!conf.historyEnabled || conf.enabled === false) return;
      if (conf.historyOwner && conf.googleProfile?.email && conf.historyOwner !== conf.googleProfile.email.toLowerCase()) { note('Purchase import paused: your Google account changed. Manage history before switching accounts.'); return; }
      const lines = O.read(document, location), sig = JSON.stringify(lines.map(x => [x.order, x.asin, x.state, x.date]));
      if (sig === signature) return;
      if (!lines.length) { note('No identifiable order items on this page. Open Your Orders; recommendations and order details are not imported.'); return; }
      note('Importing this order page. Only actual order items enter trends; cancelled and returned items are excluded.');
      A.db.theme.use(conf);
      const scoring = A.db.prefs.sanitizeScoring(conf);
      const profile = await hash(JSON.stringify({ scoring: cache.fingerprint(conf, 'page'), allergens: scoring.allergens, diets: scoring.diets, avoid: scoring.avoidList })), version = chrome.runtime.getManifest().version;
      const existing = new Map(H.merge([], conf.purchaseHistory).map(r => [r.key, r]));
      const records = [], speed = A.db.speed.profile(conf.speedMode); let used = 0, at = 0;
      const work = async () => {
        while (at < lines.length && turn === generation && O.allowed(location)) {
          const line = lines[at++], key = await hash(`amazon.com:${line.order}:${line.asin}`), old = existing.get(key);
          let record = { ...(old || {}), key, store: 'amazon.com', asin: line.asin, name: line.name, date: line.date, state: line.state, observedAt: Date.now(), score: old?.score ?? null, profile: old?.profile || profile, version: old?.version || version, scoredAt: old?.scoredAt || 0 };
          const food = A.db.ingestible.assess({ querySelector: () => null }, { title: line.name, text: line.name });
          if (!old && !food.ok && food.negatives?.length) { paint(line, record, 'Not a food'); continue; }
          if (record.score === null && line.state === 'purchased' && !stopped && used < speed.autoFetches) {
            used++;
            try { const data = await product(line, conf, turn); if (data.nonfood) { paint(line, record, 'Not a food'); continue; } record = { ...record, ...data, profile, version }; }
            catch { /* preserve unknown, rather than treating it as zero */ }
          }
          if (turn !== generation || !O.allowed(location)) return;
          record = H.clean(record);
          const saved = await chrome.runtime.sendMessage({ type: 'purchaseImport', records: [record] });
          if (!saved?.ok) throw new Error('history-not-saved');
          records.push(record); if (line.anchor.isConnected) paint(line, record);
        }
      };
      await Promise.all([work(), work()]);
      if (turn !== generation || !O.allowed(location)) return;
      signature = sig;
      const rated = records.filter(r => r.state === 'purchased' && r.score !== null).length;
      note(`This page imported: ${rated} rated food purchases; ${records.filter(r => r.state === 'purchased' && r.score === null).length} labels unavailable. Open older order pages to extend history. Ratings use today's available labels.`);
    } catch { note('Order import did not complete. Successfully imported items are kept; check History & sync settings and retry this page.'); }
    finally { running = false; if (dirty) setTimeout(run, 250); }
  }
  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 300); }).observe(document.documentElement, { childList: true, subtree: true });
  function reset() { generation++; signature = ''; stopped = false; controllers.forEach(c => c.abort()); document.querySelectorAll('.air-order-badge').forEach(b => b.remove()); banner?.remove(); banner = null; void run(); }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (['enabled', 'historyEnabled', 'theme', 'palette'].some(k => changes[k]) || (changes.googleProfile && changes.googleProfile.oldValue?.email !== changes.googleProfile.newValue?.email))) reset(); });
  setInterval(() => { if (location.href !== lastURL) { lastURL = location.href; reset(); } }, 1000);
  void run();
})(typeof globalThis !== 'undefined' ? globalThis : self);
