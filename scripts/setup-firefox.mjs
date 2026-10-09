#!/usr/bin/env node
// Pinned Firefox/WebDriver tooling outside the production package. TLS stays verified.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir = path.resolve(process.env.IC_FIREFOX_TOOLS || path.join(os.tmpdir(), 'ingredient-check-firefox-tools'));
const version = '157.0.1', driverVersion = '0.36.0';
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Automatic setup targets Linux x64. On other systems set FIREFOX_BINARY and GECKODRIVER.');
fs.mkdirSync(dir, { recursive: true });
function command(cmd, args) { const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.status}`); }
function download(url, file) { command('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', url, '-o', file]); }
const archive = path.join(dir, 'firefox.tar.xz'), checks = path.join(dir, 'SHA512SUMS');
const file = `linux-x86_64/en-US/firefox-${version}.tar.xz`;
if (!fs.existsSync(path.join(dir, 'firefox', 'firefox'))) {
  download(`https://archive.mozilla.org/pub/firefox/releases/${version}/${file}`, archive);
  download(`https://archive.mozilla.org/pub/firefox/releases/${version}/SHA512SUMS`, checks);
  const line = fs.readFileSync(checks, 'utf8').split('\n').find(row => row.trim().endsWith(' ' + file));
  if (!line || crypto.createHash('sha512').update(fs.readFileSync(archive)).digest('hex') !== line.split(/\s+/)[0]) throw new Error('Firefox official SHA512 verification failed');
  command('tar', ['-xf', archive, '-C', dir]); fs.rmSync(archive);
}
if (!fs.existsSync(path.join(dir, 'geckodriver'))) {
  const packed = path.join(dir, 'geckodriver.tar.gz');
  download(`https://github.com/mozilla/geckodriver/releases/download/v${driverVersion}/geckodriver-v${driverVersion}-linux64.tar.gz`, packed);
  command('tar', ['-xzf', packed, '-C', dir]); fs.rmSync(packed);
}
command(path.join(dir, 'firefox/firefox'), ['--version']); command(path.join(dir, 'geckodriver'), ['--version']);
console.log(`FIREFOX_BINARY=${path.join(dir, 'firefox/firefox')}`);
console.log(`GECKODRIVER=${path.join(dir, 'geckodriver')}`);
