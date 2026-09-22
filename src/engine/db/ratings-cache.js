// Shared ratings cache: the `ratings_cache` tab on the shared sheet. One row per store, ASIN and
// scoring fingerprint, so a product scored once can badge for everyone with the same settings.
// A row is a score and where it came from. No ingredient text, notes, or anything about who scanned.
//
// `prefs` is a short hash of the score cache fingerprint (rules revision, weights, sheet revision),
// not the fingerprint itself: the full string is ~1.5 KB and would cap the tab at a few thousand rows.
// The Apps Script receiver (docs/apps-script.gs) repeats the sanitize and upsert rules because it
// cannot load this file. Keep the two in step.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const TAB = 'ratings_cache';
  const COLUMNS = ['key', 'store', 'asin', 'score', 'verdict', 'prefs', 'source', 'nova', 'name', 'scanned_at', 'pulls'];
  // A row is due for a rescan after this many pulls or this much age, whichever comes first.
  const MAX_PULLS = 100;
  const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const QUEUE_MAX = 300;
  const PRIVATE_SOURCES = new Set(['manual-paste', 'food-override']);

  // FNV-1a. Not cryptographic; it only has to separate scoring setups for one product.
  function fnv(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
  // Engine version rides along: the score cache also refuses entries from another version.
  // The leading letter keeps an all-digit hash from being typed as a number by gviz.
  const prefsHash = (version, fingerprint) => 'p' + fnv(String(version || '') + '|' + String(fingerprint || ''));

  function stale(row, now = Date.now()) {
    const t = Date.parse(row && row.scanned_at);
    if (!Number.isFinite(t)) return true;
    return (Number(row.pulls) || 0) >= MAX_PULLS || now - t >= MAX_AGE_MS;
  }

  // Row-shaped input from either side: a queued upsert, or a CSV row anyone with the /exec URL wrote.
  function sanitize(raw, now = Date.now()) {
    if (!raw || typeof raw !== 'object') return null;
    // A leading ' is the text marker the receiver writes so Sheets keeps these as strings.
    const str = v => String(v == null ? '' : v).replace(/^'/, '');
    const store = str(raw.store).toLowerCase().replace(/^www\./, '');
    const asin = str(raw.asin).toUpperCase();
    const prefs = str(raw.prefs);
    const source = str(raw.source);
    const verdict = str(raw.verdict);
    const score = Math.round(Number(raw.score));
    const nova = raw.nova === '' || raw.nova == null ? '' : Number(raw.nova);
    const t = typeof raw.scanned_at === 'number' ? raw.scanned_at : Date.parse(str(raw.scanned_at));
    if (store.length > 40 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(store)) return null;
    if (!/^[A-Z0-9]{10}$/.test(asin) || !/^p[0-9a-f]{1,8}$/.test(prefs)) return null;
    if (!/^[a-z0-9_:-]{1,40}$/i.test(source) || PRIVATE_SOURCES.has(source)) return null;
    if (!(score >= 0 && score <= 100)) return null;
    if (nova !== '' && !(Number.isInteger(nova) && nova >= 1 && nova <= 4)) return null;
    if (!Number.isFinite(t) || t > now + 5 * 60 * 1000) return null;
    return {
      key: `${store}:${asin}:${prefs}`, store, asin, score,
      verdict: /^[A-Za-z ]{1,20}$/.test(verdict) ? verdict : '',
      prefs, source, nova,
      name: str(raw.name).replace(/\s+/g, ' ').trim().slice(0, 80),
      scanned_at: new Date(t).toISOString(),
      pulls: Math.max(0, Math.floor(Number(raw.pulls) || 0)),
    };
  }

  // Local score cache entry (see score-cache.js) -> shareable row.
  function fromEntry(entry, now = Date.now()) {
    if (!entry || typeof entry !== 'object') return null;
    return sanitize({ ...entry, prefs: prefsHash(entry.v, entry.prefs), scanned_at: entry.t, pulls: 0 }, now);
  }

  // Shared row -> local score cache entry, once the caller has matched `fingerprint` to row.prefs.
  function toEntry(row, fingerprint, { schema, version }) {
    return {
      schema, v: version, t: Date.parse(row.scanned_at),
      store: row.store, asin: row.asin, prefs: fingerprint,
      score: row.score, verdict: row.verdict, nova: row.nova === '' ? undefined : row.nova,
      source: row.source, provenanceSource: '', name: row.name,
    };
  }

  // Parsed CSV (header first) -> { "store:ASIN": [fresh rows] }.
  function indexRows(rows, now = Date.now()) {
    const index = Object.create(null);
    if (!rows || !rows.length) return index;
    const head = rows[0].map(h => String(h).trim().toLowerCase());
    for (const r of rows.slice(1)) {
      const raw = {};
      head.forEach((h, i) => { raw[h] = r[i]; });
      const row = sanitize(raw, now);
      if (!row || stale(row, now)) continue;
      const k = `${row.store}:${row.asin}`;
      (index[k] = index[k] || []).push(row);
    }
    return index;
  }

  // Fold a { upserts: [entries], pulls: [{key, scanned_at}] } message into the pending write queue.
  // The newest scan per key wins; repeated pulls of the same scan add up.
  function mergeQueue(queue, msg, now = Date.now()) {
    const q = {
      upserts: { ...((queue && queue.upserts) || {}) },
      pulls: { ...((queue && queue.pulls) || {}) },
    };
    for (const entry of (msg && Array.isArray(msg.upserts) ? msg.upserts : [])) {
      const row = fromEntry(entry, now);
      if (!row) continue;
      const held = Object.hasOwn(q.upserts, row.key) ? q.upserts[row.key] : null;
      if (!held || Date.parse(held.scanned_at) < Date.parse(row.scanned_at)) q.upserts[row.key] = row;
    }
    for (const p of (msg && Array.isArray(msg.pulls) ? msg.pulls : [])) {
      const key = String((p && p.key) || '');
      const t = Date.parse(p && p.scanned_at);
      if (!/^[a-z0-9.-]{3,40}:[A-Z0-9]{10}:p[0-9a-f]{1,8}$/.test(key) || !Number.isFinite(t)) continue;
      const scanned = new Date(t).toISOString();
      const held = Object.hasOwn(q.pulls, key) ? q.pulls[key] : null;
      q.pulls[key] = held && held.scanned_at === scanned
        ? { scanned_at: scanned, n: Math.min(MAX_PULLS, held.n + 1) }
        : { scanned_at: scanned, n: 1 };
    }
    // Insertion order is oldest first; an endpoint that never confirms must not fill storage.
    for (const part of ['upserts', 'pulls']) {
      const keys = Object.keys(q[part]);
      for (const k of keys.slice(0, Math.max(0, keys.length - QUEUE_MAX))) delete q[part][k];
    }
    return q;
  }

  const queueSize = q => Object.keys((q && q.upserts) || {}).length + Object.keys((q && q.pulls) || {}).length;

  const api = AIRmodule('ratingsCache', {
    TAB, COLUMNS, MAX_PULLS, MAX_AGE_MS, QUEUE_MAX,
    fnv, prefsHash, stale, sanitize, fromEntry, toEntry, indexRows, mergeQueue, queueSize,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
