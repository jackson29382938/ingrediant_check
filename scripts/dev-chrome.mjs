#!/usr/bin/env node
// Start headed Chrome with this unpacked extension and keep it current.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startUrl = process.env.INGREDIENT_CHECK_URL
  || 'https://www.amazon.com/s?k=oat+milk&i=grocery';
const watch = !process.argv.includes('--no-watch');

function alreadyOpen() {
  try {
    const url = execFileSync(process.execPath, [path.join(root, 'scripts/ab.mjs'), 'get', 'url'], {
      encoding: 'utf8',
      timeout: 8000,
    }).trim();
    return Boolean(url);
  } catch {
    return false;
  }
}

function openSession() {
  const child = spawn(process.execPath, [path.join(root, 'scripts/ab.mjs'), 'open', startUrl], {
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`agent-browser open exited ${code}`));
    });
    child.on('error', reject);
  });
}

function scheduleReload() {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const child = spawn(process.execPath, [path.join(root, 'scripts/reload-extension.mjs')], {
        stdio: 'inherit',
      });
      child.on('error', (err) => console.error(err.message));
    }, 700);
  };
}

if (!alreadyOpen()) {
  console.log(`ingredient-check: opening Chrome with extension at ${startUrl}`);
  await openSession();
} else {
  console.log('ingredient-check: Chrome session already running');
}

if (!watch) process.exit(0);

const reload = scheduleReload();
const watched = [path.join(root, 'src'), path.join(root, 'manifest.json'), path.join(root, 'icons')];
for (const target of watched) {
  if (!fs.existsSync(target)) continue;
  fs.watch(target, { recursive: true }, (_event, filename) => {
    if (filename && /(^|[\\/])\./.test(filename)) return;
    console.log(`ingredient-check: ${filename || target} changed`);
    reload();
  });
}

console.log('ingredient-check: watching src/, manifest.json, icons/ — Ctrl+C to stop the watcher');
