// Ratings only: no cart mutations, authenticated requests, screenshots or cart-data uploads.
(function(root) {
  const A = root.AIR, C = A.cart, cache = A.db.scoreCache;
  let raw = {}, prefs = {}, settings = {}, generation = 0, used = 0, active = 0, blocked = false, timer;
  const jobs = new Map(), controllers = new Set();
  const version = chrome.runtime.getManifest().version;
  let url = location.href;
  function reset() {
    generation++; used = 0; blocked = false; active = 0; jobs.clear();
    for (const c of controllers) c.abort(); controllers.clear();
    document.querySelectorAll('.air-cart-badge').forEach(b => b.remove());
    url = location.href; schedule();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(pass, 200); }
  function paint(tile, hit, status) {
    let b = tile.anchor.querySelector('.air-cart-badge');
    if (!b) {
      b = document.createElement('span'); b.className = 'air-cart-badge';
      b.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-flex!important;vertical-align:middle!important;margin:4px!important}span{font:700 12px/1.4 sans-serif;padding:3px 7px;border:2px solid var(--ring);border-radius:999px;color:var(--fg);background:var(--bg)} </style><span><slot></slot></span>';
      if (tile.imageOnly) {
        if (getComputedStyle(tile.anchor).position === 'static') tile.anchor.style.position = 'relative';
        b.style.cssText = 'position:absolute!important;top:4px!important;left:4px!important;z-index:2!important;pointer-events:none!important';
      }
      tile.anchor.insertBefore(b, tile.anchor.firstChild);
    }
    const label = hit ? `${hit.score}` : status === 'checking' ? 'Checking label…' : status === 'not-food' ? 'Not a food' : status === 'unavailable' ? 'Label unavailable' : 'Open to rate';
    if (b.textContent !== label) b.textContent = label;
    b.dataset.airProduct = tile.id; b.dataset.airStatus = hit ? 'scored' : status || 'limited';
    b.title = hit ? `Ingredient Check: ${hit.score}/100 — ${hit.verdict}` : 'Ingredient Check: open this product to read or paste its ingredient label.';
    b.setAttribute('aria-label', b.title); b.setAttribute('role', 'img');
    const color = hit ? A.db.theme.band(hit.score) : { fg: '#374151', bg: '#f3f4f6', ring: '#9ca3af' };
    for (const k of ['fg', 'bg', 'ring']) b.style.setProperty('--' + k, color[k]);
  }
  async function read(job, turn) {
    const control = new AbortController(); controllers.add(control);
    const timeout = setTimeout(() => control.abort(), 15000);
    try {
      const response = await fetch(job.url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: control.signal });
      if (turn !== generation || control.signal.aborted || location.href !== url || !C.allowed(location)) return;
      if ([403, 429, 503].includes(response.status)) blocked = true;
      if (!response.ok) throw new Error('unavailable');
      const a = C.adapter(location), final = new URL(response.url || job.url);
      if (final.origin !== location.origin || a.productId(final.href) !== job.id) throw new Error('identity');
      if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('type');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 8 * 1024 * 1024 || control.signal.aborted) throw new Error('size'); chunks.push(p.value); }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/html');
      if (turn !== generation || control.signal.aborted || location.href !== url || !C.allowed(location)) return;
      if (/robot or human|verify you are human|access denied|press.*hold|just a moment|security verification/i.test([doc.title, doc.querySelector('h1')?.textContent].join(' '))) { blocked = true; throw new Error('blocked'); }
      const data = a.readProduct(doc, final);
      if (data.id !== job.id || !data.ingredients) throw new Error('label');
      const food = A.db.ingestible.assess({ querySelector: () => null }, { title: data.title, text: [data.title, ...(data.crumbs || []), data.labelText || ''].join('\n') });
      if (settings.foodOnly && !food.ok && food.negatives.length) { job.status = 'not-food'; return; }
      const result = A.engine.score({ name: data.title, ingredients_text: data.ingredients, advisory_text: data.advisoryText, nutrition: data.nutrition }, prefs);
      if (!result.parsed || result.coverage < 0.34) throw new Error('coverage');
      if (turn !== generation || control.signal.aborted || location.href !== url || !C.allowed(location)) return;
      job.hit = { schema: cache.SCHEMA, v: version, t: Date.now(), store: cache.normalizeStore(location.hostname), asin: job.id,
        prefs: cache.fingerprint(raw, 'page'), source: 'page', score: result.score, verdict: result.verdict, nova: result.nova, name: data.title.slice(0, 120) };
      await chrome.storage.local.set({ [cache.key(location.hostname, job.id)]: job.hit });
    } catch { if (turn === generation) job.status = 'unavailable'; }
    finally { clearTimeout(timeout); controllers.delete(control); if (turn === generation) { active--; schedule(); } }
  }
  async function pass() {
    if (!settings.enabled || !settings.badges || !C.allowed(location)) return;
    const tiles = C.tiles(document, location), turn = generation;
    const current = new Set(tiles.map(t => t.anchor));
    document.querySelectorAll('.air-cart-badge').forEach(b => { if (!current.has(b.parentElement)) b.remove(); });
    const scores = await chrome.storage.local.get(tiles.map(t => cache.key(location.hostname, t.id)));
    if (turn !== generation || location.href !== url) return;
    const speed = A.db.speed.profile(raw.speedMode);
    for (const tile of tiles) {
      if (!tile.anchor.isConnected) continue;
      const saved = scores[cache.key(location.hostname, tile.id)];
      if (cache.valid(saved, { store: location.hostname, asin: tile.id, version, prefs: raw, maxAgeMs: speed.maxAgeMs })) { paint(tile, saved); continue; }
      let job = jobs.get(tile.id);
      if (!job && settings.autoScoreSearch && !blocked && used < speed.autoFetches && active < 2) {
        job = { ...tile, status: 'checking' }; jobs.set(tile.id, job); used++; active++; void read(job, turn);
      }
      paint(tile, job?.hit, job?.status || (blocked ? 'unavailable' : 'limited'));
    }
  }
  const keys = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'weights', 'allergens', 'diets', 'avoidList', 'speedMode', 'sheetIndexRev', 'producerIndexRev', 'theme', 'palette'];
  function load() { chrome.storage.local.get(keys, o => { raw = o || {}; settings = A.db.prefs.sanitizeToggles(raw); prefs = A.db.prefs.sanitizeScoring(raw); A.db.theme.use(raw); reset(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden'] });
  setInterval(() => { if (url !== location.href) reset(); }, 1000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (keys.some(k => changes[k])) load();
    else {
      for (const k of Object.keys(changes)) if (k.startsWith(`s:${cache.normalizeStore(location.hostname)}:`)) jobs.delete(k.split(':')[2]);
      if (Object.keys(changes).some(k => k.startsWith('s:'))) schedule();
    }
  });
  load();
})(typeof globalThis !== 'undefined' ? globalThis : self);
