// Capture public barcode-label evidence without accounts or private retailer pages.
// node scripts/capture-label-evidence.mjs --output /tmp/labels.json 3017620422003 ...
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2), index = args.indexOf('--output');
if (index < 0 || !args[index + 1]) throw new Error('Provide --output and a new JSON file path');
const output = args.splice(index, 2)[1];
if (!args.length || args.some(code => !/^\d{8,14}$/.test(code))) throw new Error('Provide 8–14 digit barcodes');
if (fs.existsSync(output)) throw new Error('Refusing to overwrite reviewed evidence');
const entries = [];
for (const barcode of [...new Set(args)]) {
  const sourceUrl = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=code,product_name,ingredients_text,lang,allergens_tags`;
  const result = spawnSync('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', sourceUrl], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('Public label request failed for ' + barcode);
  const response = JSON.parse(result.stdout), product = response.product;
  if (response.status !== 1 || !product?.ingredients_text?.trim()) throw new Error('No label available for ' + barcode);
  entries.push({ barcode, captured: new Date().toISOString().slice(0, 10), evidence: 'public-database-capture',
    sourceUrl, responseSha256: createHash('sha256').update(result.stdout).digest('hex'), responseJson: result.stdout,
    review: 'pending: inspect source text and add explicit allergen expectations before using as a regression' });
  console.log('Captured ' + barcode + ': ' + product.product_name);
}
fs.writeFileSync(output, JSON.stringify({ source: 'Open Food Facts contributors', license: 'https://opendatacommons.org/licenses/odbl/1-0/',
  limitation: 'Public database text, not independently verified packaging, retailer extraction, OCR or clinical validation.', entries }, null, 2) + '\n', { flag: 'wx' });
