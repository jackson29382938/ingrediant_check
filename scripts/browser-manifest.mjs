// One canonical manifest; Firefox fields are generated, never edited separately.
import fs from 'node:fs';
export const FIREFOX_ID = 'ingredient-check@jackson29382938.github.io';
export function browserManifest(manifest, target, backgroundSource) {
  if (!['chrome', 'firefox'].includes(target)) throw new Error('Unknown browser target: ' + target);
  const out = structuredClone(manifest);
  if (target === 'chrome') return out;
  delete out.minimum_chrome_version;
  out.permissions = out.permissions.filter(p => !['offscreen', 'sidePanel'].includes(p)).concat('identity');
  out.optional_permissions = out.optional_permissions.filter(p => p !== 'identity');
  const imports = backgroundSource.match(/importScripts\(([\s\S]*?)\);/);
  if (!imports) throw new Error('Background imports could not be determined');
  out.background = { scripts: [...imports[1].matchAll(/'([^']+)'/g)].map(m => 'src/' + m[1]).concat('src/background.js') };
  out.sidebar_action = { default_panel: out.side_panel.default_path, default_title: '__MSG_appName__', default_icon: out.icons };
  delete out.side_panel;
  out.browser_specific_settings = { gecko: { id: FIREFOX_ID, strict_min_version: '142.0', data_collection_permissions: { required: ['none'], optional: ['personallyIdentifyingInfo', 'healthInfo', 'websiteActivity', 'websiteContent', 'technicalAndInteraction'] } } };
  return out;
}
export function readBrowserManifest(root, target) {
  return browserManifest(JSON.parse(fs.readFileSync(root + '/manifest.json', 'utf8')), target, fs.readFileSync(root + '/src/background.js', 'utf8'));
}
