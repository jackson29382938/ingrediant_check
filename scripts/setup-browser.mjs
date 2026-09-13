#!/usr/bin/env node
// Install the optional browser development tools outside this cloud-synced repository.
// Native package extraction inside Google Drive/OneDrive workspaces can leave partial files.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const AGENT_BROWSER_VERSION = '0.25.5'; // Last known-compatible release for Node 20/22.
const npmCli = process.env.npm_execpath
  || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

if (!fs.existsSync(npmCli)) {
  console.error('ingredient-check: could not locate npm; run this command through npm run browser:setup');
  process.exit(1);
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  return result;
}

console.log(`ingredient-check: installing agent-browser ${AGENT_BROWSER_VERSION} globally`);
run([npmCli, 'install', '--global', `agent-browser@${AGENT_BROWSER_VERSION}`]);

const prefixResult = spawnSync(process.execPath, [npmCli, 'root', '--global'], { encoding: 'utf8' });
if (prefixResult.status !== 0) process.exit(prefixResult.status || 1);
const browserCli = path.join(prefixResult.stdout.trim(), 'agent-browser', 'bin', 'agent-browser.js');
if (!fs.existsSync(browserCli)) {
  console.error(`ingredient-check: installed package is missing its CLI: ${browserCli}`);
  process.exit(1);
}

console.log('ingredient-check: installing Chrome for Testing');
run([browserCli, 'install']);
console.log('ingredient-check: browser environment is ready; run npm run chrome');
