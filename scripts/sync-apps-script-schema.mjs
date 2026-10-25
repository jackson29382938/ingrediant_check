// docs/apps-script.gs ends with src/engine/db/purchase-history.js, byte for byte, so the backend validates a
// purchase record with the code the extension builds it with (tests/purchase-history.test.js fails when they differ).
// After editing that file: node scripts/sync-apps-script-schema.mjs, then redeploy the script.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'src/engine/db/purchase-history.js'), 'utf8');
const scriptPath = join(root, 'docs/apps-script.gs');
const script = readFileSync(scriptPath, 'utf8');
// The copy starts at the schema file's own first line.
const start = script.indexOf(schema.split('\n', 1)[0] + '\n');
if (start < 0) throw new Error('docs/apps-script.gs does not contain the first line of purchase-history.js');
const next = script.slice(0, start) + schema;
if (next === script) console.log('already in sync');
else { writeFileSync(scriptPath, next); console.log(`re-synced: ${script.length - start} -> ${schema.length} characters`); }
