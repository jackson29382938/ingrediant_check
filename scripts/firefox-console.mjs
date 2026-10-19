// ExtensionCommon.wrapPromise reports native lifecycle diagnostics after navigation parks or
// unloads a page. Match only exact verified messages; application promise rejections stay fatal.
const LIFECYCLE = new Set([
  'Promise resolved while context is inactive',
  // The same wrapPromise path (ExtensionCommon.sys.mjs, Firefox 157) when a harness navigation unloads a
  // page just before an extension API promise resolves. Reproduced on main before 1.16.0, 2 runs in 3.
  'Promise resolved after context unloaded',
  "Promise rejected after context unloaded: Actor 'Conduits' destroyed before query 'RuntimeMessage' was resolved",
]);
export function firefoxConsole(entries, base) {
  const errors = [], inactive = [];
  for (const row of entries) {
    if (!row.source?.startsWith(base)) continue;
    if (LIFECYCLE.has(String(row.message).trim())) inactive.push(row);
    else errors.push(row);
  }
  return { errors, inactive };
}
