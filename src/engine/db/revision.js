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
  const RULES_REVISION = '2026-09-28.10';
  const RULES_HASH = '55dbba7a-277508';
  const _exports = AIRmodule('revision', { RULES_REVISION, RULES_HASH });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
