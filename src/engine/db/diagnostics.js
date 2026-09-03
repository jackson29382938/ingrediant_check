// Diagnostic records, for judging whether the scores are actually right.
//
// A score is a claim, and the only way to know how often the claim is wrong is to look at a lot of
// them next to the evidence they were drawn from. This builds one flat row per scored product:
// what text was read, where it came from, what fired, and what came out. Flat on purpose — every
// field is a spreadsheet column, so accuracy review is sorting and filtering rather than parsing
// JSON by hand.
//
// What is deliberately NOT in here: anything about the person. No user id, no session id, no
// history, no timing of visits, nothing from any page other than the product being scored. The
// row is about the product and the engine's handling of it.
//
// It does record WHICH products were scored, and with auto-scoring on that is a meaningful trace
// of what someone browsed. That is why this is off by default and why the settings page says so
// plainly rather than burying it.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

// One row per scored product. Column order is the sheet's column order.
const COLUMNS = [
  'ts', 'version', 'store', 'asin', 'upc', 'brand', 'product_name',
  'source', 'via', 'confidence', 'gate', 'coverage', 'parsed',
  'score', 'verdict', 'nova', 'base', 'cap',
  'penalties', 'bonuses', 'flags', 'provenance', 'weights', 'ingredients',
];

const trim = (v, n) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const num = v => (typeof v === 'number' && isFinite(v) ? v : '');

// "-13 Refined added sugar; -6 Fat-reduced dairy" — readable in a cell, sortable, and greppable
// for "how often does rule X fire".
function rows(list) {
  return (list || [])
    .filter(h => h && (typeof h.c === 'number' || h.c === 'CAP'))
    .map(h => `${h.c === 'CAP' ? 'CAP' : h.c} ${trim(h.why, 80)}`)
    .join('; ')
    .slice(0, 900);
}

function provenanceSummary(p) {
  if (!p) return '';
  const part = (label, arr) => (arr && arr.length ? `${label}=${arr.map(c => c.id).join('+')}` : '');
  return [p.kind, part('verified', p.verified), part('claimed', p.claims), part('hollow', p.hollow),
    p.unknownCost ? `unknownCost=${p.unknownCost}` : '']
    .filter(Boolean).join(' ').slice(0, 300);
}

// Only the weights that differ from the defaults, so the column stays readable and a row can be
// reproduced exactly.
function weightSummary(weights, defaults) {
  if (!weights || !defaults) return '';
  return Object.keys(weights)
    .filter(k => k in defaults && weights[k] !== defaults[k])
    .sort()
    .map(k => `${k}=${weights[k]}`)
    .join(',')
    .slice(0, 300);
}

// `data` is the extractor output, `result` the engine output, `meta` the surrounding context.
function buildRecord(data, result, meta = {}) {
  data = data || {};
  result = result || {};
  return {
    ts: new Date().toISOString(),
    version: trim(meta.version, 20),
    store: trim(meta.store, 60),
    asin: trim(data.asin, 12),
    upc: trim(data.upc, 16),
    brand: trim(data.brand, 80),
    product_name: trim(data.title, 200),
    // Which path produced the text being scored. The single most useful column: accuracy differs
    // enormously between a structured card, a barcode match and a photo.
    source: trim(meta.source || data.via, 40),
    via: trim(data.via, 40),
    confidence: num(data.confidence),
    gate: trim(data.ingestible && data.ingestible.reason, 80),
    coverage: typeof result.coverage === 'number' ? Math.round(result.coverage * 100) : '',
    parsed: num(result.parsed),
    score: num(result.score),
    verdict: trim(result.verdict, 20),
    nova: num(result.nova),
    base: num(result.base),
    cap: trim(result.cap, 100),
    penalties: rows(result.bad),
    bonuses: rows(result.good),
    flags: (result.flags || []).map(f => f.id).join(',').slice(0, 200),
    provenance: provenanceSummary(result.provenance),
    weights: weightSummary(meta.weights, meta.defaultWeights),
    // The evidence the score was drawn from. Without it a wrong score cannot be diagnosed, only
    // noticed — which is the difference between this being useful and being a vanity metric.
    ingredients: trim(meta.text || data.text, 1200),
  };
}

const _exports = AIRmodule('diagnostics', { COLUMNS, buildRecord, rows, provenanceSummary, weightSummary });
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
