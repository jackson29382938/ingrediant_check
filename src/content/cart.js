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
  let fallbackActive = 0, fallbackQueue = [];
  const version = chrome.runtime.getManifest().version;
  let url = location.href;
  function reset() {
    generation++; used = 0; blocked = false; active = 0; jobs.clear();
    fallbackActive = 0; fallbackQueue = [];
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
    const named = category => category === 'food' ? t('catFood', 'Food') : A.db.productRatings.categoryLabel(category, t);
    q('.t').textContent = s.groups ? s.groups.map(g => `${named(g.category)}: ${g.average}`).join(' · ')
      : s.category ? t('cartAverageCare', '$1 average', named(s.category)) : `${t('cartAverage', 'Cart average')} · ${s.verdict}`;
    q('.s').textContent = [t('cartRated', '$1 of $2 items rated', s.rated, s.total), s.pending ? t('cartChecking', 'checking…') : '',
      earnedHere ? t('cartXpGained', '+$1 XP', earnedHere) : '', lv ? t('cartLevel', 'Level $1 · $2/$3 XP', lv.level, lv.into, lv.need) : ''].filter(Boolean).join(' · ');
    // An index, or a cart of several kinds, has no quality band.
    const c = s.average == null || s.category ? A.db.theme.neutral() : A.db.theme.band(s.average);
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
  function paint(tile, hit, status, saved = false, detail = '', reason = '') {
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
    const care = !!hit && !!hit.category && hit.category !== 'food';
    const label = hit ? `${hit.score}${care ? ` · ${A.db.productRatings.categoryLabel(hit.category, t)}` : ''}${saved ? ' · saved' : ''}` : status === 'checking' ? detail === 'ocr' ? t('cartReadingPhoto', 'Reading label photo…') : detail === 'barcode' ? t('cartReadingBarcode', 'Looking up barcode…') : 'Checking label…' : status === 'not-food' ? 'Not a food' : status === 'unavailable' ? 'Label unavailable' : 'Open to rate';
    if (b.textContent !== label) b.textContent = label;
    b.dataset.airProduct = tile.id; b.dataset.airStatus = hit ? 'scored' : status || 'limited';
    if (!hit && reason) b.dataset.airReason = reason; else delete b.dataset.airReason;
    // As on a results page: where this page has the breakdown card (Amazon, hover-card.js) a score opens it from the
    // keyboard too, so it is a focusable link and the card stands in for the tooltip. Any badge goes to its product when clicked.
    const card = !!(hit && settings.hoverBreakdown && A.hoverCard), air = hit ? `${hit.score}:${hit.verdict}${care ? ':' + hit.category : ''}` : '', sig = `${air}|${card}|${reason}`;
    if (b.dataset.airSig !== sig) {   // not on every pass: the card sets aria-expanded while it is open
      b.dataset.airSig = sig;
      let name = hit ? `Ingredient Check: ${hit.score}/100 — ${hit.verdict}${care ? ` · ${A.db.productRatings.caption(hit, t)}` : ''}` : 'Ingredient Check: open this product to read or paste its ingredient label.';
      if (hit?.evidence && A.db.shopping) name += ' · ' + A.db.shopping.describe(hit.evidence, t);
      if (!hit && reason === 'blocked') name = t('cartLabelBlocked', 'The store blocked the public label request. Open the product to read its label.');
      if (air) b.dataset.air = air; else delete b.dataset.air;
      for (const a of ['title', 'tabindex', 'aria-haspopup', 'aria-expanded']) b.removeAttribute(a);
      b.setAttribute('aria-label', name); b.setAttribute('role', card ? 'link' : 'img');
      if (card) { b.setAttribute('tabindex', '0'); b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); } else b.title = name;
    }
    const color = hit ? (care ? A.db.theme.neutral() : A.db.theme.band(hit.score)) : { fg: '#374151', bg: '#f3f4f6', ring: '#9ca3af' };
    for (const k of ['fg', 'bg', 'ring']) b.style.setProperty('--' + k, color[k]);
  }
  const live = turn => turn === generation && location.href === url && C.allowed(location);
  function rate(input, source, capturedAt = Date.now()) {
    if (!input.ingredients_text) return null;
    const result = A.engine.score(input, prefs);
    if (!A.engine.isReadable(result)) return null;
    return { schema: cache.SCHEMA, cacheRevision: cache.CACHE_REVISION, v: version, t: capturedAt,
      prefs: cache.fingerprint(raw, source, result.category), source, input,
      ...(A.db.shopping ? { evidence: A.db.shopping.evidence(result, { source, capturedAt, prefs: raw }) } : {}),
      score: result.score, verdict: result.verdict, nova: result.nova, category: result.category || 'food', ratingStyle: result.ratingStyle || 'food', name: String(input.name || '').slice(0, 120) };
  }
  async function finish(job, hit, turn, remember = true, confidence = 1) {
    if (!live(turn)) return;
    if (!hit) { job.status = 'unavailable'; job.reason ||= 'no-readable-label'; schedule(); return; }
    job.hit = { ...hit, store: cache.normalizeStore(location.hostname), asin: job.id }; job.status = 'scored'; job.detail = '';
    // Public label evidence only, never the cart title/URL/quantity; it stays on this computer.
    if (remember) A.page?.rememberProduct(job.id, { input: hit.input, via: hit.source, confidence, food: hit.category === 'food' && job.food !== false }, { share: false });
    await chrome.storage.local.set({ [cache.key(location.hostname, job.id)]: job.hit });
    if (live(turn)) schedule();
  }
  async function fallback(job, data, input, turn) {
    if (!live(turn)) return;
    let hit = null;
    if (settings.useOpenFoodFacts && data.upc) {
      job.detail = 'barcode'; schedule();
      try {
        const found = await chrome.runtime.sendMessage({ type: 'lookupBarcode', code: data.upc, foodOnly: settings.foodOnly });
        if (!live(turn)) return;
        if (found?.ingredients_text && !found.rejected) hit = rate({ ...input, ingredients_text: found.ingredients_text, nutrition: input.nutrition || found.nutrition }, 'open-food-facts');
      } catch { /* an optional source must not stop photo fallback */ }
    }
    if (!live(turn)) return;
    if (!hit && settings.ocrLabels && data.imageUrls?.length && A.extract.ocrReadyForHost(location.hostname)) {
      job.detail = 'ocr'; schedule();
      try {
        const found = await chrome.runtime.sendMessage({ type: 'ocrLabels', urls: data.imageUrls });
        if (!live(turn)) return;
        const best = found?.ok && A.db.ocrText.bestBlock(found.results, text => A.extract.looksLikeIngredients(text, data.title));
        if (best) hit = rate({ ...input, ingredients_text: best.text }, 'label-ocr');
      } catch { /* keep this item unavailable if neither source can read its actual label */ }
    }
    await finish(job, hit, turn, true, hit?.source === 'label-ocr' ? 0.7 : 0.55);
  }
  function pumpFallback() {
    while (fallbackActive < 2 && fallbackQueue.length) {
      const task = fallbackQueue.shift(); if (!live(task.turn)) continue;
      fallbackActive++;
      fallback(task.job, task.data, task.input, task.turn).catch(() => { if (live(task.turn)) task.job.status = 'unavailable'; }).finally(() => {
        if (!live(task.turn)) return;
        fallbackActive--; pumpFallback(); schedule();
      });
    }
  }
  function savedReading(tile, value, maxAge) {
    const P = A.db.productCache;
    if (!P || !A.db.speed.sanitizeRecall(raw).cacheFirst) return null;
    const row = P.sanitize(value);
    if (!row || row.store !== cache.normalizeStore(location.hostname) || row.asin !== tile.id || row.status !== 'ok' || P.stale(row, Date.now(), maxAge)) return null;
    if ((/ocr/i.test(row.data.via) && !settings.ocrLabels) || (row.data.via === 'open-food-facts' && !settings.useOpenFoodFacts) || ['manual-paste', 'food-override'].includes(row.data.via)) return null;
    if (row.data.food === false && !A.db.ingestible?.allowsProduct?.(row.data.title, prefs)) return null;
    return rate(P.toInput(row), row.data.via || 'page', Date.parse(row.scanned_at));
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
      // The same reader every page fetch uses (stores/cart.js): capped, aborts with the signal, and says when the page is a block page.
      let doc;
      try { doc = await C.publicDocument(response, control.signal); }
      catch (error) { if (error.blocked && turn === generation) blocked = true; throw error; }
      if (turn !== generation || control.signal.aborted || location.href !== url || !C.allowed(location)) return;
      const data = a.readProduct(doc, final);
      data.supplementFacts = data.supplementFacts || A.retailerLabels?.supplementFacts?.(doc) || '';
      if (data.real === false) throw new Error('not-product-page'); // publicDocument already stops real challenge pages
      if (data.id !== job.id || data.identityMatches === false) throw new Error('identity');
      // The page's own food check when the adapter has one (Amazon: department and breadcrumbs), else the title's.
      const food = data.food || A.db.ingestible.assess({ querySelector: () => null }, { title: data.title, text: [data.title, ...(data.crumbs || []), data.labelText || ''].join('\n') });
      job.food = food.ok !== false;
      if (settings.foodOnly && !food.ok && (food.negatives || []).length && !A.db.ingestible?.allowsProduct?.(data.title, prefs)) { job.status = 'not-food'; return; }
      // Scored from what a product page scores from, so the same product reads the same number everywhere.
      const input = { name: data.title, labels: data.labels, certifications: data.certifications, ingredients_text: data.ingredients, advisory_text: data.advisoryText, category: data.supplementFacts ? 'supplement' : undefined, supplement_facts: data.supplementFacts, nutrition: data.nutrition };
      const hit = rate(input, data.via || 'page');
      if (turn !== generation || control.signal.aborted || location.href !== url || !C.allowed(location)) return;
      if (hit) await finish(job, hit, turn, true, data.confidence);
      else if (C.store(location)?.id === 'amazon' && ((settings.useOpenFoodFacts && data.upc) || (settings.ocrLabels && data.imageUrls?.length))) {
        fallbackQueue.push({ job, data, input, turn }); pumpFallback();
      } else { job.status = 'unavailable'; job.reason = data.ingredients ? 'unreadable-label' : 'no-label'; }
    } catch (error) { if (turn === generation) { job.status = 'unavailable'; job.reason = blocked ? 'blocked' : error.message === 'identity' ? 'identity' : 'request-failed'; } }
    finally { clearTimeout(timeout); controllers.delete(control); if (turn === generation) { active--; schedule(); } }
  }
  async function pass() {
    if (!settings.enabled || !settings.badges || !C.allowed(location)) return;
    const tiles = C.tiles(document, location), turn = generation;
    const current = new Set(tiles.map(t => t.anchor));
    document.querySelectorAll('.air-cart-badge').forEach(b => { if (!current.has(b.parentElement)) b.remove(); });
    const PC = A.db.productCache;
    const scores = await cache.readLocal(tiles.flatMap(t => [cache.key(location.hostname, t.id), ...(PC ? [PC.localKey(location.hostname, t.id)] : [])]), raw, null, chrome.storage);
    if (turn !== generation || location.href !== url) return;
    const speed = A.db.speed.profile(raw.speedMode), done = [];
    for (const tile of tiles) {
      if (!live(turn)) return;
      if (!tile.anchor.isConnected) continue;
      const saved = scores[cache.key(location.hostname, tile.id)];
      const recalled = cache.recall(saved, { store: location.hostname, asin: tile.id, version, prefs: raw, maxAgeMs: speed.maxAgeMs });
      if (recalled && !recalled.refresh) { paint(tile, saved, undefined, recalled.stale); done.push({ id: tile.id, score: saved.score, category: saved.category || 'food', status: 'scored' }); continue; }
      let job = jobs.get(tile.id);
      if (!job?.hit && PC) {
        const held = savedReading(tile, scores[PC.localKey(location.hostname, tile.id)], speed.maxAgeMs);
        if (held) { job ||= { ...tile }; jobs.set(tile.id, job); await finish(job, held, turn, false); }
      }
      if (!job && settings.autoScoreSearch && !blocked && used < speed.autoFetches && active < 2) {
        job = { ...tile, status: 'checking' }; jobs.set(tile.id, job); used++; active++; void read(job, turn);
      }
      const status = job?.status || (blocked ? 'unavailable' : 'limited');
      paint(tile, job?.hit || recalled?.hit, status, recalled?.stale && !job?.hit, job?.detail, job?.reason || (blocked ? 'blocked' : ''));
      done.push({ id: tile.id, score: job?.hit?.score ?? recalled?.hit.score, category: job?.hit?.category || recalled?.hit.category || 'food', status: job?.hit || recalled ? 'scored' : status });
    }
    renderSummary(done, tiles);
    void award(done);
  }
  const keys = ['enabled', 'badges', 'foodOnly', 'ratingStyle', 'personalCareEnabled', 'autoScoreSearch', 'pointsEnabled', 'hoverBreakdown', 'weights', 'allergens', 'diets', 'avoidList', 'ocrLabels', 'useOpenFoodFacts', 'speedMode', 'cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays', 'sheetIndexRev', 'producerIndexRev', 'theme', 'palette'];
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
      if (Object.keys(changes).some(k => k.startsWith('s:') || k.startsWith(`p:${cache.normalizeStore(location.hostname)}:`))) schedule();
    }
  });
  load();
})(typeof globalThis !== 'undefined' ? globalThis : self);
