// AI ingredient ratings: what a language model may tell the score about an ingredient no rule knows.
//
// The rulebase charges only what it recognises, so an ingredient it has never seen is free, and a list
// full of them reads as clean or, below the coverage gate, as unreadable. With the reader's opt-in a
// model is asked about exactly those ingredients (src/worker/ai.js) and its answer comes back through
// this file, which is the whole of what a model can do to a score:
//
//   - It picks one of a closed list of classes. A class is not a number: the points, the category whose
//     weight scales them, and whether the class votes on the NOVA processing level are fixed here, in
//     code, so the score is a pure function of (label, settings, ratings) and the same ratings always
//     give the same score. Nothing a model writes is ever shown as a reason, a name or a number.
//   - It can only charge. A class that is a plain food, a culinary ingredient or a vitamin makes the entry
//     "recognised" (so coverage counts it) and costs nothing. No class adds points, so a model can never
//     lift a score, and none sets a hard ceiling, so a model can never cap one.
//   - Its charges are smaller than the curated rules' for the same kind of ingredient, they are limited
//     per product (MAX_CHARGED entries, MAX_RAW points before the engine's usual saturation), and an
//     answer below MIN_CONFIDENCE is treated as no answer.
//   - A rating applies only to entries NO rule recognises. A curated rule always wins.
//
// Ratings travel with the saved reading of a product (productCache `aiRatings`, kept on this computer
// and never uploaded or accepted from the shared database) and every row they produce is labelled
// "AI estimate" in the panel and carries `ai: true`.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

// id -> what the engine does with it. `cat` is an existing category (categories.js), so the reader's own
// weight for it (and a goal's) scales an AI charge exactly as it scales a curated one; weight 0 charges
// nothing. `upf` is the NOVA vote: 'hard' makes the product ultra-processed, as the matching curated rule does.
const CLASSES = Object.freeze({
  whole:          { label: 'Whole food', cat: null, pts: 0, upf: 'none' },
  culinary:       { label: 'Culinary ingredient', cat: null, pts: 0, upf: 'none' },
  nutrient:       { label: 'Vitamin or mineral', cat: null, pts: 0, upf: 'none' },
  flavouring:     { label: 'Flavouring', cat: 'flavour', pts: 8, upf: 'hard' },
  sweetener:      { label: 'Sweetener', cat: 'sweetener', pts: 8, upf: 'hard' },
  sugar:          { label: 'Added sugar', cat: 'sugar', pts: 8, upf: 'soft' },
  texture:        { label: 'Emulsifier, gum or thickener', cat: 'texture', pts: 6, upf: 'soft' },
  preservative:   { label: 'Preservative', cat: 'preservative', pts: 8, upf: 'hard' },
  colour:         { label: 'Colour', cat: 'colour', pts: 8, upf: 'hard' },
  processing_aid: { label: 'Processing aid', cat: 'processingAid', pts: 5, upf: 'soft' },
  isolate:        { label: 'Isolated or modified protein or starch', cat: 'isolate', pts: 8, upf: 'hard' },
  processed:      { label: 'Industrially processed ingredient', cat: 'processingAid', pts: 4, upf: 'soft' },
});
const CLASS_IDS = Object.freeze(Object.keys(CLASSES));

const MIN_CONFIDENCE = 0.6;
// Per product: how many AI-rated entries may be charged, and how many raw points they may add together
// before the engine's saturation curve. A long list of strange words is not a long list of defects.
const MAX_CHARGED = 6;
const MAX_RAW = 24;
// Ratings kept with one saved reading, and the most one request may ask about.
const MAX_PER_READING = 24;
const MAX_PER_REQUEST = 24;
const MAX_KEY = 80;

// The key an ingredient is stored and looked up under. Entries reach the engine already lower-cased and
// trimmed (score.js tidy()); this makes a name typed or returned elsewhere match them.
function keyOf(name) {
  if (typeof name !== 'string') return '';
  if (name === '__proto__' || name === 'constructor' || name === 'prototype') return '';
  const key = name.normalize('NFKC').toLowerCase().replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ').replace(/^[\s*•\-–:,.;]+|[\s*•\-–:,.;]+$/g, '');
  if (!key || key.length > MAX_KEY || !/\p{L}/u.test(key)) return '';
  return key;
}

// One stored rating -> { c: class id, k: confidence 0..1 } or null. Anything else is dropped.
function cleanRating(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.c !== 'string' || !CLASS_IDS.includes(raw.c)) return null;
  const k = Number(raw.k);
  if (!Number.isFinite(k)) return null;
  return { c: raw.c, k: Math.round(Math.min(1, Math.max(0, k)) * 100) / 100 };
}

// A stored map of ratings, bounded and healed. Used wherever a saved reading is read back.
function sanitize(raw, limit = MAX_PER_READING) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [name, value] of Object.entries(raw)) {
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') continue;
    const key = keyOf(name), rating = key && cleanRating(value);
    if (!rating || Object.hasOwn(out, key)) continue;
    out[key] = rating;
    if (++n >= limit) break;
  }
  return out;
}

// What score() consults. `usable` is a rating the engine may act on; a low-confidence one is no answer.
function forProduct(raw) {
  const map = sanitize(raw, MAX_PER_READING);
  const usable = key => {
    const r = Object.hasOwn(map, key) ? map[key] : null;
    return r && r.k >= MIN_CONFIDENCE ? r : null;
  };
  return {
    size: Object.keys(map).length,
    // The entry is understood: any class counts, including the ones that charge nothing.
    recognises(ing) { return !!usable(keyOf(ing)); },
    // The class definition for an entry, or null. `pts` 0 means recognised and free.
    rate(ing) {
      const r = usable(keyOf(ing));
      return r ? { id: r.c, k: r.k, ...CLASSES[r.c] } : null;
    },
  };
}

// The model's reply -> the ratings for exactly the names that were asked about. Strict on purpose: the
// reply is text from a third party, and the only things taken from it are a class id from the closed list
// and a number, for names this request contained. Extra names, extra fields and prose are ignored.
function parseReply(text, asked) {
  const wanted = new Map();
  for (const name of Array.isArray(asked) ? asked : []) { const key = keyOf(name); if (key) wanted.set(key, true); }
  let body = String(text == null ? '' : text).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  let json;
  try { json = JSON.parse(body); } catch { return {}; }
  const list = Array.isArray(json) ? json : json && Array.isArray(json.ratings) ? json.ratings : [];
  const out = {};
  for (const item of list.slice(0, MAX_PER_REQUEST * 2)) {
    if (!item || typeof item !== 'object') continue;
    const key = keyOf(item.name);
    const rating = key && wanted.has(key) && !Object.hasOwn(out, key) && cleanRating({ c: item.class, k: item.confidence });
    if (rating) out[key] = rating;
  }
  return out;
}

// Names worth asking about: what the engine reported as unrecognised, normalised, de-duplicated, minus
// anything already rated, and bounded.
function toAsk(unrecognised, known) {
  const out = [], seen = new Set();
  const have = known && typeof known === 'object' ? known : {};
  for (const name of Array.isArray(unrecognised) ? unrecognised : []) {
    const key = keyOf(name);
    if (!key || seen.has(key) || Object.hasOwn(have, key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= MAX_PER_REQUEST) break;
  }
  return out;
}

const api = AIRmodule('aiRatings', {
  CLASSES, CLASS_IDS, MIN_CONFIDENCE, MAX_CHARGED, MAX_RAW, MAX_PER_READING, MAX_PER_REQUEST,
  keyOf, cleanRating, sanitize, forProduct, parseReply, toAsk,
});
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
