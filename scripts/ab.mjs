#!/usr/bin/env node
// Thin wrapper: every agent-browser call loads this unpacked extension.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const session = process.env.INGREDIENT_CHECK_SESSION || 'ingredient-check';

function findChromeForTesting() {
  const home = os.homedir();
  const browsers = path.join(home, '.agent-browser/browsers');
  if (!fs.existsSync(browsers)) return '';
  const versions = fs.readdirSync(browsers)
    .filter((name) => name.startsWith('chrome-'))
    .sort()
    .reverse();
  for (const version of versions) {
    const candidate = path.join(
      browsers,
      version,
      'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

// Google Chrome removed --load-extension. Chrome for Testing still accepts it.
const chrome = process.env.INGREDIENT_CHECK_CHROME || findChromeForTesting();
const profile = process.env.INGREDIENT_CHECK_PROFILE
  || path.join(root, '.chrome-profile');

function sessionAlive() {
  try {
    const out = execFileSync('agent-browser', ['session', 'list'], {
      encoding: 'utf8',
      timeout: 4000,
    });
    return out.includes(session);
  } catch {
    return false;
  }
}

const launchArgs = [
  '--session', session,
  '--headed',
  '--extension', root,
  '--profile', profile,
  '--args', '--remote-debugging-port=9333',
];
if (chrome) launchArgs.push('--executable-path', chrome);

const prefix = sessionAlive() ? ['--session', session] : launchArgs;

const child = spawn('agent-browser', [
  ...prefix,
  ...process.argv.slice(2),
], { stdio: 'inherit' });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
