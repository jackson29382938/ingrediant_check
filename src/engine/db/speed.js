// Speed versus freshness: one setting (`speedMode`) with five steps, from "Fastest" to "Most up to
// date". "Balanced" is exactly how the extension behaved before this setting existed, and it is the
// default.
//
// Each step sets three things:
//   maxAgeDays   how old a score or a saved product reading on this computer may be before it is
//                read again
//   autoFetches  how many product pages "Rate every search result" may request per results page
//   sharedDays   how old a shared-database reading may be and still be used; 0 = never use the
//                shared database for answers, read every product page yourself. The worker already
//                drops rows older than 30 days (productCache.MAX_AGE_MS), so 30 is the most it can be.
// Product pages you open are always read fresh, whatever the step (product.js).

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  const DAY = 24 * 60 * 60 * 1000;
  const MODES = ['fastest', 'fast', 'balanced', 'fresh', 'freshest'];
  const DEFAULT_MODE = 'balanced';
  const PROFILES = Object.freeze({
    fastest: Object.freeze({ maxAgeDays: 90, autoFetches: 20, sharedDays: 30 }),
    fast: Object.freeze({ maxAgeDays: 60, autoFetches: 40, sharedDays: 30 }),
    balanced: Object.freeze({ maxAgeDays: 30, autoFetches: 60, sharedDays: 30 }),
    fresh: Object.freeze({ maxAgeDays: 7, autoFetches: 60, sharedDays: 7 }),
    freshest: Object.freeze({ maxAgeDays: 1, autoFetches: 60, sharedDays: 0 }),
  });

  // How fast product pages are requested, for the badges and the sorted list alike (they share one
  // queue): how many at once and the least gap between starts. Normal is how it has always run. Faster
  // finishes sooner but looks more like automated traffic, and Amazon may refuse sooner; the shared
  // throttle pause still stops everything after five refusals in a row. Never more than five at once.
  const PACES = ['gentle', 'normal', 'quick', 'fast'];
  const DEFAULT_PACE = 'normal';
  const PACE_PROFILES = Object.freeze({
    gentle: Object.freeze({ concurrent: 2, gapMs: 400 }),
    normal: Object.freeze({ concurrent: 3, gapMs: 250 }),
    quick: Object.freeze({ concurrent: 4, gapMs: 150 }),
    fast: Object.freeze({ concurrent: 5, gapMs: 100 }),
  });
  function sanitizePace(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return { ratePace: PACES.includes(src.ratePace) ? src.ratePace : DEFAULT_PACE };
  }
  const pace = name => PACE_PROFILES[PACES.includes(name) ? name : DEFAULT_PACE];

  function sanitizeSpeed(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return { speedMode: MODES.includes(src.speedMode) ? src.speedMode : DEFAULT_MODE };
  }

  // The step's numbers, with the ages also in milliseconds.
  function profile(mode) {
    const p = PROFILES[MODES.includes(mode) ? mode : DEFAULT_MODE];
    return { mode: MODES.includes(mode) ? mode : DEFAULT_MODE, ...p, maxAgeMs: p.maxAgeDays * DAY, sharedMs: p.sharedDays * DAY };
  }

  // May a shared-database row scanned at `scannedAt` (ISO string) answer under this step?
  function sharedUsable(scannedAt, mode, now = Date.now()) {
    const p = profile(mode);
    if (!p.sharedDays) return false;
    const t = Date.parse(scannedAt);
    return Number.isFinite(t) && now - t < p.sharedMs;
  }

  const RECALL_KEYS = ['cacheFirst', 'cacheMemory', 'cacheBackgroundRefresh', 'cacheGraceDays'];
  function sanitizeRecall(raw = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return { cacheFirst: src.cacheFirst !== false, cacheMemory: src.cacheMemory !== false,
      cacheBackgroundRefresh: src.cacheBackgroundRefresh !== false,
      cacheGraceDays: [0, 7, 30].includes(src.cacheGraceDays) ? src.cacheGraceDays : 7 };
  }

  const api = { RECALL_KEYS, sanitizeRecall, MODES, DEFAULT_MODE, PROFILES, DAY, sanitizeSpeed, profile, sharedUsable,
    PACES, DEFAULT_PACE, PACE_PROFILES, sanitizePace, pace };
  const out = AIRmodule('speed', api);
  if (typeof module !== 'undefined' && module.exports) module.exports = out;
})();
