// Product cache: what was read off a product page, before any weighting. docs/CACHE.md.
//
// A score depends on the reader's weights, so a shared score only helps someone with identical
// settings. The ingredient text, title, bullets, certifications and nutrition numbers do not, and
// scoring them locally takes about a millisecond. So this stores the engine's INPUT, once per
// product, and every computer scores it under its own weights. A rule change needs no rescan either.
//
// One shape for three places: `p:<store>:<asin>` in chrome.storage.local, the worker's upload
// queue, and the `products` tab. The Apps Script receiver (docs/apps-script.gs) checks the row
// shape again because it cannot load this file; the field bounds live here only, and are applied
// every time a row is read back.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const TAB = 'products';
  const COLUMNS = ['key', 'store', 'asin', 'status', 'data', 'scanned_at', 'pulls'];
  // A row is due for a rescan after this many pulls or this much age, whichever comes first.
  // Monthly, so a reformulated product is picked up.
  const MAX_PULLS = 100;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const QUEUE_MAX = 300;
  // ok: data carries ingredient text. unreadable: the page published none. not-food: the food gate
  // refused it before reading, so there is no text; readers with the gate off treat it as a miss.
  const STATUSES = new Set(['ok', 'unreadable', 'not-food']);
  // Pasted lists and the food-gate override belong to one tab, never to anyone else.
  const PRIVATE_VIA = new Set(['manual-paste', 'food-override']);
  const NUTRIENTS = ['sodium', 'saturatedFat', 'transFat', 'sugar', 'addedSugar', 'fibre', 'protein',
    'calories', 'fat', 'carbs', 'servingGrams', 'servingMl'];

  const str = (v, n) => String(v == null ? '' : v).replace(/^'/, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const normalizeStore = s => str(s, 60).toLowerCase().replace(/^www\./, '');
  const key = (store, asin) => `${normalizeStore(store)}:${String(asin || '').toUpperCase()}`;
  const localKey = (store, asin) => `p:${key(store, asin)}`;

  // Field bounds match what extract.js can produce (6000 is its MAX_LEN), so a live read and a
  // cached read feed the engine the same input. Unknown fields are dropped.
  function sanitizeData(raw) {
    let src = raw;
    if (typeof src === 'string') { try { src = JSON.parse(src.replace(/^'/, '')); } catch (e) { return null; } }
    if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
    const out = {
      title: str(src.title, 200),
      text: str(src.text, 6000),
      labels: str(src.labels, 3000),
      certifications: str(src.certifications, 500),
      via: str(src.via, 60),
      confidence: Math.min(1, Math.max(0, Number(src.confidence) || 0)),
      food: src.food !== false,
    };
    const n = src.nutrition;
    if (n && typeof n === 'object' && !Array.isArray(n)) {
      const nut = {};
      for (const f of NUTRIENTS) if (Number.isFinite(n[f]) && n[f] >= 0) nut[f] = n[f];
      if (n.servingSize) nut.servingSize = str(n.servingSize, 80);
      if (Object.keys(nut).length) out.nutrition = nut;
    }
    return out;
  }

  // Row-shaped input from any side: a fresh scan, a local entry, or a sheet row anyone could write.
  function sanitize(raw, now = Date.now()) {
    if (!raw || typeof raw !== 'object') return null;
    const store = normalizeStore(raw.store);
    const asin = str(raw.asin, 10).toUpperCase();
    const status = str(raw.status, 12);
    const t = typeof raw.scanned_at === 'number' ? raw.scanned_at : Date.parse(str(raw.scanned_at, 40));
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(store) || !/^[A-Z0-9]{10}$/.test(asin)) return null;
    if (!STATUSES.has(status) || !Number.isFinite(t) || t > now + 5 * 60 * 1000) return null;
    const data = sanitizeData(raw.data);
    if (!data || PRIVATE_VIA.has(data.via)) return null;
    if (status === 'ok' && !data.text) return null;
    return {
      key: key(store, asin), store, asin, status, data,
      scanned_at: new Date(t).toISOString(),
      pulls: Math.max(0, Math.floor(Number(raw.pulls) || 0)),
    };
  }

  // maxAgeMs: the speed setting's age limit (AIR.db.speed); MAX_AGE_MS when not given.
  function stale(row, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
    const t = Date.parse(row && row.scanned_at);
    if (!Number.isFinite(t)) return true;
    return (Number(row.pulls) || 0) >= MAX_PULLS || now - t >= maxAgeMs;
  }

  // Engine input from a row, copied so consumers cannot alter the stored reading.
  function toInput(row) {
    const d = row.data;
    return {
      name: d.title, labels: d.labels, certifications: d.certifications,
      nutrition: d.nutrition ? { ...d.nutrition } : undefined, ingredients_text: d.text,
    };
  }

  // What a live read hands in: the engine input it scored, plus how it was read.
  function fromScan({ store, asin, status = 'ok', input = {}, via = '', confidence = 0, food = true, t = Date.now() }, now = Date.now()) {
    return sanitize({
      store, asin, status, scanned_at: t, pulls: 0,
      data: { title: input.name, text: input.ingredients_text, labels: input.labels,
        certifications: input.certifications, nutrition: input.nutrition, via, confidence, food },
    }, now);
  }

  // Fold { upserts: [rows], pulls: [{ key, scanned_at }] } into the pending write queue. The newest
  // scan per key wins; repeated pulls of the same scan add up; oldest entries go first at the cap.
  function mergeQueue(queue, msg, now = Date.now()) {
    const q = {
      upserts: { ...((queue && queue.upserts) || {}) },
      pulls: { ...((queue && queue.pulls) || {}) },
    };
    for (const raw of (msg && Array.isArray(msg.upserts) ? msg.upserts : [])) {
      const row = sanitize(raw, now);
      if (!row) continue;
      const held = Object.hasOwn(q.upserts, row.key) ? q.upserts[row.key] : null;
      if (!held || Date.parse(held.scanned_at) < Date.parse(row.scanned_at)) q.upserts[row.key] = { ...row, pulls: 0 };
    }
    for (const p of (msg && Array.isArray(msg.pulls) ? msg.pulls : [])) {
      const k = String((p && p.key) || '');
      const t = Date.parse(p && p.scanned_at);
      if (!/^[a-z0-9.-]{3,60}:[A-Z0-9]{10}$/.test(k) || !Number.isFinite(t)) continue;
      const scanned = new Date(t).toISOString();
      const held = Object.hasOwn(q.pulls, k) ? q.pulls[k] : null;
      q.pulls[k] = held && held.scanned_at === scanned
        ? { scanned_at: scanned, n: Math.min(MAX_PULLS, held.n + 1) }
        : { scanned_at: scanned, n: 1 };
    }
    for (const part of ['upserts', 'pulls']) {
      const keys = Object.keys(q[part]);
      for (const k of keys.slice(0, Math.max(0, keys.length - QUEUE_MAX))) delete q[part][k];
    }
    return q;
  }

  const queueSize = q => Object.keys((q && q.upserts) || {}).length + Object.keys((q && q.pulls) || {}).length;

  const api = AIRmodule('productCache', {
    TAB, COLUMNS, MAX_PULLS, MAX_AGE_MS, QUEUE_MAX,
    key, localKey, sanitize, sanitizeData, stale, toInput, fromScan, mergeQueue, queueSize,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
