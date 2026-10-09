#!/usr/bin/env node
// Zip a store-ready extension package. Runs preflight first.
// Includes only what Chrome loads plus LICENSE, a short README, and privacy copy.
// Excludes tests, audits, harness pages, the Chrome profile, and git metadata.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBrowserManifest } from './browser-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
if (targets.some(t => !['chrome', 'firefox'].includes(t))) throw new Error('Use chrome and/or firefox');
const browsers = targets.length ? targets : ['chrome', 'firefox'];
const manifest = readBrowserManifest(root, 'chrome');
const outDir = path.join(root, 'dist');
const include = [
  'manifest.json',
  'src',
  'icons',
  '_locales',
  'vendor',
  'LICENSE',
  'README.md',
  'docs/PRIVACY.md',
  'docs/BROWSERS.md',
  'docs/PURCHASE-HISTORY.md',
  'docs/apps-script.gs',
];

const pre = spawnSync(process.execPath, [path.join(root, 'scripts/preflight.mjs')], { cwd: root, stdio: 'inherit' });
if (pre.status !== 0) process.exit(pre.status || 1);
fs.mkdirSync(outDir, { recursive: true });
for (const browser of browsers) {
  const folder = path.join(outDir, browser === 'chrome' ? 'unpacked' : 'firefox');
  fs.rmSync(folder, { recursive: true, force: true }); fs.mkdirSync(folder, { recursive: true });
  for (const item of include) {
    const dest = path.join(folder, item); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(path.join(root, item), dest, { recursive: true, filter: source => !path.basename(source).startsWith('._') && path.basename(source) !== '.DS_Store' });
  }
  if (browser === 'firefox') {
    // Adapt visible browser instructions and translations, without changing shared logic or IDs.
    const copy = text => text.replaceAll('chrome://settings/people', 'about:preferences#sync').replaceAll('chrome://extensions/shortcuts', 'about:addons').replaceAll('chrome://extensions', 'about:addons').replace(/Chrome(?:’s|'s) side panel/g, "Firefox's sidebar").replace(/Chrome/g, 'Firefox');
    for (const name of fs.readdirSync(path.join(folder, 'src/options')).filter(name => name.endsWith('.html'))) {
      const file = path.join(folder, 'src/options', name);
      // Only text nodes: keep IDs, filenames, script URLs and i18n keys stable.
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/>([^<]+)</g, (_m, text) => '>' + copy(text) + '<'));
    }
    const known = Object.keys(JSON.parse(fs.readFileSync(path.join(folder, '_locales/en/messages.json'), 'utf8'))).map(key => key.toLowerCase());
    const compat = path.join(folder, 'src/browser-compat.js');
    fs.writeFileSync(compat, 'globalThis.AIR_BROWSER_MESSAGE_KEYS = new Set(' + JSON.stringify(known) + ');\n' + fs.readFileSync(compat, 'utf8'));
    for (const locale of fs.readdirSync(path.join(folder, '_locales'))) {
      const file = path.join(folder, '_locales', locale, 'messages.json'), messages = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const message of Object.values(messages)) message.message = copy(message.message);
      fs.writeFileSync(file, JSON.stringify(messages, null, 2) + '\n');
    }
  }
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(readBrowserManifest(root, browser), null, 2) + '\n');
  const zipName = `ingredient-check-${manifest.version}${browser === 'firefox' ? '-firefox' : ''}.zip`, outFile = path.join(outDir, zipName);
  fs.rmSync(outFile, { force: true });
  const result = spawnSync('python3', ['-c', `
import zipfile, os, sys
folder, out = sys.argv[1:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirs, files in os.walk(folder):
        dirs.sort()
        for name in sorted(files):
            full = os.path.join(dirpath, name)
            z.write(full, os.path.relpath(full, folder))
`, folder, outFile], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`packed ${browser}: ${zipName} (${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB), folder ${path.relative(root, folder)}`);
}
