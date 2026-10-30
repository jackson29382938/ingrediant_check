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
// Then copy the hash the failing test prints into RULES_HASH. The hash covers code only: a comment on
// its own line, a blank line or trailing spaces change nothing, so prose can be edited freely. A comment
// trailing code, a rename or any reformatting of code still counts.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  // 2026-10-18.1: declared shares and "contains 2% or less of" blocks set an ingredient's weight, the
  // label's own allergen line is no longer scored as ingredients, and text written with full-width,
  // bullet or HTML separators is read as the list it is. See docs/releases/1.16.0.md.
  //
  // 2026-10-18.2 (never released alone): nested lists, incomplete readings, nutrition basis, multilingual
  // qualifiers and dominant-food sourcing. Retains 1.16.0 share weighting.
  //
  // 2026-10-25.1 (never released alone): a word broken across two lines by a hyphen is charged as the word,
  // and a list written one ingredient to a line is a list. RULES_HASH covers code only from here on.
  //
  // 2026-10-27.4 (1.18.0): personal-care and supplement indices read real labels and titles. Drug Facts
  // blocks and INCI joins are read as lists, ingredient names are recognized by shape, supplement servings
  // above an adult upper limit and documented cautions are charged, and more titles are claimed (fewer
  // wrongly). See docs/releases/1.18.0.md and docs/PERSONAL-CARE.md.
  //
  // 2026-10-28.1 (1.18.1): the three above in one release. See docs/releases/1.18.1.md.
  //
  // 2026-10-30.1 (1.19.0): the personal-care evidence index starts at 100 and is charged, as a food is, instead of
  // 50 + 30 - 10 (so almost every label was 80 or 70); a label with no function ingredient is rated, not declined;
  // an active ingredient printed after its own name is no longer dropped; an index takes the engine's band words.
  // Food scores do not move. See docs/releases/1.19.0.md and docs/PERSONAL-CARE.md.
  const RULES_REVISION = '2026-10-30.1';
  const RULES_HASH = '934b6d08-277608';
  const _exports = AIRmodule('revision', { RULES_REVISION, RULES_HASH });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
