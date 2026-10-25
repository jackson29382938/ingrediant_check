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
  // 2026-10-25.1: a word broken across two lines by a hyphen is charged as the word, and a list with one
  // ingredient per line (or separated by <br>) is read as a list. See docs/releases/1.17.2.md.
  // 2026-10-18.1: declared shares and "contains 2% or less of" blocks set an ingredient's weight, the
  // label's own allergen line is no longer scored as ingredients, and text written with full-width,
  // bullet or HTML separators is read as the list it is. See docs/releases/1.16.0.md.
  const RULES_REVISION = '2026-10-25.1';
  const RULES_HASH = 'e8b1761a-221372';
  const _exports = AIRmodule('revision', { RULES_REVISION, RULES_HASH });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
