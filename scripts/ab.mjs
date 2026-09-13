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
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const platformPaths = process.platform === 'win32'
    ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome.exe']
    : process.platform === 'darwin'
      ? ['Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']
      : ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome'];
  for (const version of versions) {
    for (const relative of platformPaths) {
      const candidate = path.join(browsers, version, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function agentBrowserCommand() {
  const configured = process.env.INGREDIENT_CHECK_AGENT_BROWSER;
  if (configured && fs.existsSync(configured)) {
    return configured.endsWith('.js')
      ? { file: process.execPath, args: [configured] }
      : { file: configured, args: [] };
  }
  const local = path.join(root, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
  if (fs.existsSync(local)) return { file: process.execPath, args: [local] };

  // npm's global shims are .cmd files on Windows, which child_process cannot execute directly.
  // Resolve the package's JavaScript entry point instead; this also works when a synced workspace
  // cannot safely host node_modules itself.
  const npmCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const npmCli of npmCandidates) {
    if (!fs.existsSync(npmCli)) continue;
    try {
      const globalRoot = execFileSync(process.execPath, [npmCli, 'root', '--global'], {
        encoding: 'utf8', timeout: 4000,
      }).trim();
      const globalCli = path.join(globalRoot, 'agent-browser', 'bin', 'agent-browser.js');
      if (fs.existsSync(globalCli)) return { file: process.execPath, args: [globalCli] };
    } catch { /* try the next npm installation */ }
  }
  return process.platform === 'win32' ? null : { file: 'agent-browser', args: [] };
}

const cli = agentBrowserCommand();
if (!cli) {
  console.error('ingredient-check: agent-browser is not installed; run npm run browser:setup');
  process.exit(1);
}

function missingCli(err) {
  return err && (err.code === 'ENOENT' || err.code === 'UNKNOWN');
}

// Google Chrome removed --load-extension. Chrome for Testing still accepts it.
const chrome = process.env.INGREDIENT_CHECK_CHROME || findChromeForTesting();
const profile = process.env.INGREDIENT_CHECK_PROFILE
  || path.join(root, '.chrome-profile');

function sessionAlive() {
  try {
    const out = execFileSync(cli.file, [...cli.args, 'session', 'list'], {
      encoding: 'utf8',
      timeout: 4000,
    });
    return out.includes(session);
  } catch (err) {
    if (missingCli(err)) {
      console.error('ingredient-check: agent-browser is not installed; run npm run browser:setup');
    }
    return false;
  }
}

// Let agent-browser allocate its debugging port. Overriding it prevents Chrome from writing
// the DevToolsActivePort file the launcher waits for, causing repeated launch timeouts.
const launchArgs = [
  '--session', session,
  '--headed',
  '--extension', root,
  '--profile', profile,
];
if (chrome) launchArgs.push('--executable-path', chrome);

const prefix = sessionAlive() ? ['--session', session] : launchArgs;

const child = spawn(cli.file, [
  ...cli.args,
  ...prefix,
  ...process.argv.slice(2),
], { stdio: 'inherit' });

child.on('error', (err) => {
  if (missingCli(err)) console.error('ingredient-check: agent-browser is not installed; run npm run browser:setup');
  else console.error(`ingredient-check: could not start agent-browser (${err.message})`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
