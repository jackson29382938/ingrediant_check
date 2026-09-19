#!/usr/bin/env node
// Zip a store-ready extension package. Runs preflight first.
// Includes the files Chrome loads plus LICENSE / README / privacy copy.
// Excludes tests, audits, the Chrome profile, and git metadata.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const zipName = `ingredient-check-${manifest.version}.zip`;
const outFile = path.join(outDir, zipName);
const include = [
  'manifest.json',
  'src',
  'icons',
  '_locales',
  'vendor',
  'LICENSE',
  'README.md',
  'docs/PRIVACY.md',
];

const pre = spawnSync(process.execPath, [path.join(root, 'scripts/preflight.mjs')], {
  cwd: root, stdio: 'inherit',
});
if (pre.status) process.exit(pre.status || 1);

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

const zip = spawnSync('zip', ['-r', '-q', outFile, ...include, '-x', '*.DS_Store'], {
  cwd: root, stdio: 'inherit',
});
if (zip.status === 0) {
  const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
  console.log(`packed ${zipName} (${mb} MB)`);
  process.exit(0);
}

const py = spawnSync('python3', ['-c', `
import zipfile, os
root = ${JSON.stringify(root)}
out = ${JSON.stringify(outFile)}
include = ${JSON.stringify(include)}
skip = {'.DS_Store'}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for item in include:
        full = os.path.join(root, item)
        if os.path.isfile(full):
            z.write(full, item)
            continue
        for dirpath, _dirs, files in os.walk(full):
            for name in files:
                if name in skip:
                    continue
                abs_path = os.path.join(dirpath, name)
                z.write(abs_path, os.path.relpath(abs_path, root))
print('packed', os.path.basename(out), f"({os.path.getsize(out)/1048576:.1f} MB)")
`], { cwd: root, stdio: 'inherit' });
if (py.status) {
  console.error('pack: need `zip` or python3 to write the archive');
  process.exit(py.status || 1);
}
