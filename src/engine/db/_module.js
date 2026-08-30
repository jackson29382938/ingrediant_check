// Dual-mode module shim.
//
// The same rule files must load in two places: Node (for the test suites) and a Chrome content
// script (where `import` is unavailable in a manifest-declared script and there is no build step).
// Every db file ends with AIRmodule('name', value); this resolves it to whichever world it's in.
(function (root) {
  root.AIR = root.AIR || { db: {} };
  root.AIR.db = root.AIR.db || {};
  root.AIRmodule = function (name, value) {
    root.AIR.db[name] = value;
    return value;   // callers assign to their own module.exports; doing it here targets the wrong scope
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
