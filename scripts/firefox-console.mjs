// ExtensionCommon.wrapPromise emits this diagnostic when a successful browser API completes
// after navigation parks its old page in BFCache. It is not an application exception. Keep it
// visible separately; all other own-extension errors remain fatal, including rejected promises.
export function firefoxConsole(entries, base) {
  const errors = [], inactive = [];
  for (const row of entries) {
    if (!row.source?.startsWith(base)) continue;
    if (String(row.message).trim() === 'Promise resolved while context is inactive') inactive.push(row);
    else errors.push(row);
  }
  return { errors, inactive };
}
