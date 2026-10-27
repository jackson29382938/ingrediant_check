// Rulebase revision.
//
// A cached score is only as good as the rules that produced it. The score cache used to retire on
// the manifest version alone, and the September 14 rulebase rewrite shipped without a bump — so
// every badge and popup card kept showing the old number for up to thirty days. This constant is
// part of the cache fingerprint, and tests/rules-revision.test.js pins a hash of the rule sources
// against it: change a rule without changing this, and the suite fails and tells you what to do.
//
// Bump RULES_REVISION whenever anything in these files changes in a way that can move a score:
//   src/engine/score.js, src/engine/categories.js,
//   src/engine/db/{oils,sugars,additives,labels,allergens,provenance}.js
// Then copy the hash the failing test prints into RULES_HASH.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  // 2026-10-18.1: declared shares and "contains 2% or less of" blocks set an ingredient's weight, the
  // label's own allergen line is no longer scored as ingredients, and text written with full-width,
  // bullet or HTML separators is read as the list it is. See docs/releases/1.16.0.md.
  //
  // 2026-10-27.4: personal-care and supplement indices read real labels and titles. Drug Facts blocks and
  // INCI joins are read as lists, ingredient names are recognized by shape, supplement servings above an
  // adult upper limit and documented cautions are charged, and more titles are claimed (fewer wrongly).
  // Food rules are untouched. See docs/releases/1.17.2.md and docs/PERSONAL-CARE.md.
  const RULES_REVISION = '2026-10-27.4';
  const RULES_HASH = '11f8902d-351301';
  const _exports = AIRmodule('revision', { RULES_REVISION, RULES_HASH });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
