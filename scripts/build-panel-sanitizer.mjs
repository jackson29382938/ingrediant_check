// Reproduce the modern-HTML DOMPurify build, preserving all sanitization rules.
// Usage: node scripts/build-panel-sanitizer.mjs /path/to/tools/node_modules
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const modules = path.resolve(process.argv[2] || 'node_modules');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let source = fs.readFileSync(path.join(modules, 'dompurify/dist/purify.js'), 'utf8');
const hash = 'acefba6ebc9733869f60c80b519eaefad1691ea56022c54a3e6cbe74286d8d46';
if (createHash('sha256').update(source).digest('hex') !== hash) throw new Error('DOMPurify 3.4.16 upstream checksum mismatch');
const legacy = '\t\t\tif (!doc || !doc.documentElement) {\n\t\t\t\tdoc = implementation.createDocument(NAMESPACE, "template", null);\n\t\t\t\ttry {\n\t\t\t\t\tdoc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;\n\t\t\t\t} catch (_) {}\n\t\t\t}';
if (source.split(legacy).length !== 2) throw new Error('DOMPurify fallback changed');
// Panels use HTML only and supported browsers all implement DOMParser. Fail closed if parsing
// fails; never fall back to writing untrusted markup through an innerHTML setter.
source = source.replace(legacy, '\t\t\tif (!doc || !doc.documentElement) return null;');
source = source.replace('//# sourceMappingURL=purify.js.map', '');
const target = path.join(root, 'vendor/dompurify'); fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'purify.js'), source);
fs.copyFileSync(path.join(modules, 'dompurify/LICENSE'), path.join(target, 'LICENSE'));
console.log('Rebuilt DOMPurify from verified upstream bytes (HTML parser, fail closed)');
