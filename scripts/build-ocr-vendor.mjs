// Reproduce the modern-browser OCR bundles from verified upstream Tesseract.js 5.1.1.
// Usage: node scripts/build-ocr-vendor.mjs /path/to/tools/node_modules
// Tools: tesseract.js@5.1.1, terser@5.44.0, acorn@8.19.0 (see vendor/tesseract/VERSION.txt).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const modules = path.resolve(process.argv[2] || 'node_modules');
const requireTool = createRequire(path.join(modules, 'tesseract.js/package.json'));
for (const [name, version] of Object.entries({ 'tesseract.js': '5.1.1', terser: '5.44.0', acorn: '8.19.0' })) {
  if (requireTool(name + '/package.json').version !== version) throw new Error('Expected ' + name + '@' + version);
}
const { parse } = requireTool('acorn'), { minify } = requireTool('terser');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = {
  'tesseract.min.js': 'a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8',
  'worker.min.js': 'aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc',
};
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Upstream OCR code changed: ' + from);
  return source.replace(from, to);
}
for (const [file, hash] of Object.entries(upstream)) {
  let source = fs.readFileSync(path.join(modules, 'tesseract.js/dist', file), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== hash) throw new Error('Upstream checksum mismatch: ' + file);
  // globalThis is guaranteed in Chrome >=116 and Firefox >=142. Never compile a fallback string.
  const runtime = file === 'worker.min.js' ? 'i' : 'o';
  source = replaceOnce(source, `Function("r","regeneratorRuntime = r")(${runtime})`, `(globalThis.regeneratorRuntime=${runtime})`);
  if (file === 'worker.min.js') source = replaceOnce(source,
    'r.g=function(){if("object"==typeof globalThis)return globalThis;try{return this||new Function("return this")()}catch(t){if("object"==typeof window)return window}}()',
    'r.g=globalThis');
  // wasm-feature-detect emits two immediately called comma expressions. Mozilla's sanitizer
  // analyzer cannot normalize that syntax. An arrow preserves lexical this and evaluation order,
  // while exposing the same feature probes as ordinary call expressions to the analyzer.
  const changes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'SequenceExpression'
        && node.callee.expressions.at(-1).type === 'FunctionExpression') {
      const { start, end } = node.callee;
      changes.push({ start, end, text: `(() => (${source.slice(start, end)}))()` });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { ecmaVersion: 2022 }));
  if (changes.length !== (file === 'worker.min.js' ? 2 : 0)) throw new Error('Unexpected WASM feature-probe count');
  for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  const result = await minify(source, { compress: false, mangle: false, format: { beautify: true, comments: 'all' } });
  if (/\b(?:new\s+)?Function\s*\(|\beval\s*\(/.test(result.code)) throw new Error('Dynamic evaluation remains in ' + file);
  fs.writeFileSync(path.join(root, 'vendor/tesseract', file), result.code.replace(/[ \t]+$/gm, '') + '\n');
  fs.copyFileSync(path.join(modules, 'tesseract.js/dist', file + '.LICENSE.txt'), path.join(root, 'vendor/tesseract', file + '.LICENSE.txt'));
  console.log('Rebuilt ' + file + ' from verified upstream bytes');
}
