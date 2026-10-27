// Ratings only: no cart mutations, authenticated requests, screenshots or cart-data uploads.
(function(root) {
  const A = root.AIR, C = A.cart, cache = A.db.scoreCache, P = A.db.points;
  let raw = {}, prefs = {}, settings = {}, generation = 0, used = 0, active = 0, blocked = false, timer;
  // Cart points (optional): what is stored, what this page earned, and the line that shows the cart as a whole.
  let xp = P.sanitize(), earnedHere = 0, summary = null;
  const awarded = new Set();
  const t = (key, fallback, ...subs) => {
    let out = '';
    try { out = chrome.i18n.getMessage(key, subs.map(String)); } catch { /* not in an extension page */ }
    return out || fallback.replace(/\$(\d)/g, (m, i) => subs[i - 1]);
  };
  const jobs = new Map(), controllers = new Set();
  const version = chrome.runtime.getManifest().version;
  let url = location.href;
  function reset() {
    generation++; used = 0; blocked = false; active = 0; jobs.clear();
    for (const c of controllers) c.abort(); controllers.clear();
    document.querySelectorAll('.air-cart-badge').forEach(b => b.remove());
    awarded.clear(); earnedHere = 0; removeSummary();
    url = location.href; schedule();
  }
  function dropSummary() { document.querySelectorAll('.air-cart-summary').forEach(n => n.remove()); summary = null; }
  // No summary any more (no scored line, another page, the switch went off): the icon stops showing an average too.
  function removeSummary() { dropSummary(); publishBadge(null); }
  // The toolbar icon shows the cart's average on a cart tab, as it shows a product's score on a product page.
  let badged;
  function publishBadge(s) {
    const score = s && s.rated && s.average != null ? s.average : undefined;
    if (score === badged) return;
    badged = score;
    try {
      chrome.runtime.sendMessage(score === undefined ? { type: 'pageScore' } : { type: 'pageScore', score, verdict: s.verdict }, () => void chrome.runtime.lastError);
    } catch { /* the extension was reloaded under this page */ }
  }
  // The cart as a whole, under Amazon's "Shopping Cart" heading (elsewhere in front of the list): the average of
  // the lines that have a score, how many that is, and (only when points are on) the level. Nothing is added to
  // the page when there is no score yet, and the page is not touched again while the line is unchanged.
  function renderSummary(items, tiles) {
    const s = C.summarize(items), place = C.summaryPlace(document, location, tiles[0]);
    if (!place || !s.rated) { removeSummary(); return; }
    const lv = settings.pointsEnabled ? P.level(xp.total) : null;
    publishBadge(s);
    const sig = JSON.stringify([s, earnedHere, lv]);
    if (summary?.isConnected && summary.dataset.airSig === sig) return;
    if (!summary?.isConnected) {
      dropSummary();
      summary = document.createElement('div');
      summary.className = 'air-cart-summary'; summary.setAttribute('role', 'status');
      summary.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block!important;margin:8px 0!important}.box{display:flex;align-items:center;gap:12px;padding:10px 14px;border:2px solid var(--ring);border-radius:12px;background:var(--bg);color:var(--fg);font:14px/1.4 sans-serif}.num{flex:none;display:grid;place-items:center;min-width:46px;height:46px;padding:0 6px;box-sizing:border-box;border:3px solid var(--ring);border-radius:999px;background:#fff;font:700 18px/1 sans-serif}.t{font-weight:700}.s{font-size:12px}</style><div class="box"><span class="num"></span><span><span class="t"></span><br><span class="s"></span></span></div>';
      place.parent.insertBefore(summary, place.before);
    }
    const q = sel => summary.shadowRoot.querySelector(sel);
    q('.num').textContent = s.average == null ? '—' : String(s.average);
    q('.t').textContent = s.groups ? s.groups.map(g => `${g.category}: ${g.average}`).join(' · ') : `${t('cartAverage', 'Cart average')} · ${s.verdict}`;
    q('.s').textContent = [t('cartRated', '$1 of $2 items rated', s.rated, s.total), s.pending ? t('cartChecking', 'checking…') : '',
      earnedHere ? t('cartXpGained', '+$1 XP', earnedHere) : '', lv ? t('cartLevel', 'Level $1 · $2/$3 XP', lv.level, lv.into, lv.need) : ''].filter(Boolean).join(' · ');
    const c = A.db.theme.band(s.average == null ? 50 : s.average);
    for (const k of ['fg', 'bg', 'ring']) summary.style.setProperty('--' + k, c[k]);
    summary.dataset.airSig = sig;
  }
  // Points for the good lines that have not been looked at yet on this page (each product once a week, and the
  // stored object is read and written only when there is something new). Never touches a score.
  async function award(items) {
    if (!settings.pointsEnabled) return;
    const fresh = items.filter(i => Number.isFinite(i.score) && (!i.category || i.category === 'food') && !awarded.has(i.id)), turn = generation;
    if (!fresh.length) return;
    for (const i of fresh) awarded.add(i.id);
    const stored = (await chrome.storage.local.get('xp')).xp;
    if (turn !== generation) return;
    const host = cache.normalizeStore(location.hostname), r = P.earn(stored, fresh.map(i => ({ key: `${host}:${i.id}`, score: i.score })));
    xp = r.xp;
    if (r.gained) { earnedHere += r.gained; await chrome.storage.local.set({ xp }); }
    schedule();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(pass, 200); }
  function paint(tile, hit, status, saved = false) {
    let b = tile.anchor.querySelector('.air-cart-badge');
    if (!b) {
      b = document.createElement('span'); b.className = 'air-cart-badge';
      b.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-flex!important;vertical-align:middle!important;margin:4px!important;cursor:pointer}span{font:700 12px/1.4 sans-serif;padding:3px 7px;border:2px solid var(--ring);border-radius:999px;color:var(--fg);background:var(--bg)} </style><span><slot></slot></span>';
      if (tile.imageOnly) {
        if (getComputedStyle(tile.anchor).position === 'static') tile.anchor.style.position = 'relative';
        b.style.cssText = 'position:absolute!important;top:4px!important;left:4px!important;z-index:2!important';
      }
      tile.anchor.insertBefore(b, tile.anchor.firstChild);
    }
    const label = hit ? `${hit.score}${hit.category && hit.category !== 'food' ? ` · ${hit.category}` : ''}${saved ? ' · saved' : ''}` : status === 'checking' ? 'Checking label…' : status === 'not-food' ? 'Not a food' : status === 'unavailable' ? 'Label unavailable' : 'Open to rate';
    if (b.textContent !== label) b.textContent = label;
    b.dataset.airProduct = tile.id; b.dataset.airStatus = hit ? 'scored' : status || 'limited';
    // As on a results page: where this page has the breakdown card (Amazon, hover-card.js) a score opens it from the
    // keyboard too, so it is a focusable link and the card stands in for the tooltip. Any badge goes to its product when clicked.
    const card = !!(hit && settings.hoverBreakdown && A.hoverCard), air = hit ? `${hit.score}:${hit.verdict}` : '', sig = `${air}|${card}`;
    if (b.dataset.airSig !== sig) {   // not on every pass: the card sets aria-expanded while it is open
      b.dataset.airSig = sig;
      const name = hit ? `Ingredient Check: ${hit.score}/100 — ${hit.verdict}${hit.category && hit.category !== 'food' ? ` · ${hit.category} · ${hit.ratingStyle}` : ''}` : 'Ingredient Check: open this product to read or paste its ingredient label.';
      if (air) b.dataset.air = air; else delete b.dataset.air;
      for (const a of ['title', 'tabindex', 'aria-haspopup', 'aria-expanded']) b.removeAttribute(a);
      b.setAttribute('aria-label', name); b.setAttribute('role', card ? 'link' : 'img');
      if (card) { b.setAttribute('tabindex', '0'); b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); } else b.title = name;
    }
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
      data.supplementFacts = data.supplementFacts || A.retailerLabels?.supplementFacts?.(doc) || '';
      if (data.real === false) { blocked = true; throw new Error('blocked'); }   // a robot check, not the product page
      if (data.id !== job.id || !data.ingredients) throw new Error('label');
      // The page's own food check when the adapter has one (Amazon: department and breadcrumbs), else the title's.
      const food = data.food || A.db.ingestible.assess({ querySelector: () => null }, { title: data.title, text: [data.title, ...(data.crumbs || []), data.labelText || ''].join('\n') });
      if (settings.foodOnly && !food.ok && (food.negatives || []).length && !A.db.ingestible?.allowsProduct?.(data.title, prefs)) { job.status = 'not-food'; return; }
      // Scored from what a product page scores from, so the same product reads the same number everywhere.
      const input = { name: data.title, labels: data.labels, certifications: data.certifications, ingredients_text: data.ingredients, advisory_text: data.advisoryText, category: data.supplementFacts ? 'supplement' : undefined, supplement_facts: data.supplementFacts, nutrition: data.nutrition };
      const result = A.engine.score(input, prefs);
      if (!A.engine.isReadable(result)) throw new Error('coverage');
      if (turn !== generation || control.signal.aborted || location.href !== url || !C.allowed(location)) return;
      // What was read stays on this computer, as a search tile keeps it (docs/CACHE.md), so the card behind the number
      // can say why. Amazon only (A.page), and never shared.
      A.page?.rememberProduct(job.id, { input, via: data.via, confidence: data.confidence, food: food.ok !== false }, { share: false });
      job.hit = { schema: cache.SCHEMA, cacheRevision: cache.CACHE_REVISION, v: version, t: Date.now(), store: cache.normalizeStore(location.hostname), asin: job.id,
        prefs: cache.fingerprint(raw, 'page'), source: 'page', input, score: result.score, verdict: result.verdict, nova: result.nova, category: result.category || 'food', ratingStyle: result.ratingStyle || 'food', name: data.title.slice(0, 120) };
      await chrome.storage.local.set({ [cache.key(location.hostname, job.id)]: job.hit });
    } catch { if (turn === generation) job.status = 'unavailable'; }
    finally { clearTimeout(timeout); controllers.delete(control); if (turn === generation) { active--; schedule(); } }
  }
  async function pass() {
    if (!settings.enabled || !settings.badges || !C.allowed(location)) return;
    const tiles = C.tiles(document, location), turn = generation;
    const current = new Set(tiles.map(t => t.anchor));
    document.querySelectorAll('.air-cart-badge').forEach(b => { if (!current.has(b.parentElement)) b.remove(); });
    const scores = await cache.readLocal(tiles.map(t => cache.key(location.hostname, t.id)), raw, null, chrome.storage);
    if (turn !== generation || location.href !== url) return;
    const speed = A.db.speed.profile(raw.speedMode), done = [];
    for (const tile of tiles) {
      if (!tile.anchor.isConnected) continue;
      const saved = scores[cache.key(location.hostname, tile.id)];
      const recalled = cache.recall(saved, { store: location.hostname, asin: tile.id, version, prefs: raw, maxAgeMs: speed.maxAgeMs });
      if (recalled && !recalled.refresh) { paint(tile, saved, undefined, recalled.stale); done.push({ id: tile.id, score: saved.score, category: saved.category || 'food', status: 'scored' }); continue; }
      let job = jobs.get(tile.id);
      if (!job && settings.autoScoreSearch && !blocked && used < speed.autoFetches && active < 2) {
        job = { ...tile, status: 'checking' }; jobs.set(tile.id, job); used++; active++; void read(job, turn);
      }
      const status = job?.status || (blocked ? 'unavailable' : 'limited');
      paint(tile, job?.hit || recalled?.hit, status, recalled?.stale && !job?.hit);
      done.push({ id: tile.id, score: job?.hit?.score ?? recalled?.hit.score, category: job?.hit?.category || recalled?.hit.category || 'food', status: job?.hit || recalled ? 'scored' : status });
    }
    renderSummary(done, tiles);
    void award(done);
  }
  const keys = ['enabled', 'badges', 'foodOnly', 'ratingStyle', 'personalCareEnabled', 'autoScoreSearch', 'pointsEnabled', 'hoverBreakdown', 'weights', 'allergens', 'diets', 'avoidList', 'speedMode', 'cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays', 'sheetIndexRev', 'producerIndexRev', 'theme', 'palette'];
  function load() { chrome.storage.local.get([...keys, 'xp'], o => { raw = o || {}; settings = A.db.prefs.sanitizeToggles(raw); prefs = A.db.prefs.sanitizeScoring(raw); xp = P.sanitize(raw.xp); A.db.theme.use(raw); reset(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'hidden', 'aria-hidden'] });
  setInterval(() => { if (url !== location.href) reset(); }, 1000);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (keys.some(k => changes[k])) load();
    else {
      if (changes.xp) { xp = P.sanitize(changes.xp.newValue); schedule(); }   // another tab earned points
      for (const k of Object.keys(changes)) if (k.startsWith(`s:${cache.normalizeStore(location.hostname)}:`)) {
        const id = k.split(':')[2], job = jobs.get(id);
        // Keep our just-completed lookup even when disk recall is off; otherwise its own write
        // starts another lookup on every storage event.
        if (!job?.hit || job.hit.t !== changes[k].newValue?.t || job.hit.score !== changes[k].newValue?.score) jobs.delete(id);
      }
      if (Object.keys(changes).some(k => k.startsWith('s:'))) schedule();
    }
  });
  load();
})(typeof globalThis !== 'undefined' ? globalThis : self);
