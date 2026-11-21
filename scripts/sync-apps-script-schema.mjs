import { readFileSync, writeFileSync } from 'node:fs';

const schema = readFileSync(new URL('../src/engine/db/purchase-history.js', import.meta.url), 'utf8');
const template = new URL('../docs/apps-script.gs', import.meta.url);
const script = readFileSync(template, 'utf8');
const marker = '// Private purchase snapshots; intentionally outside settings backup and shared product caches.';
const start = script.indexOf(marker);
if (start < 0 || script.indexOf(marker, start + marker.length) >= 0 || !schema.startsWith(marker)) {
  throw new Error('Could not identify exactly one purchase-history schema to synchronize');
}
const synced = script.slice(0, start) + schema;
if (synced !== script) writeFileSync(template, synced);
