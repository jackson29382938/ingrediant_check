// Every action a workflow runs is named by a commit, not by a tag.
//
// `uses: actions/checkout@v6` runs whatever the v6 tag points to on the day of the run, and the owner of that
// repository (or anyone who takes it over) can move the tag. The release workflow runs with permission to
// write to this repository and publishes the packages people install, so what it runs is fixed to a commit
// that was looked at, with the version it was beside it for the next person to update.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', '.github', 'workflows');
const uses = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).flatMap(file =>
  fs.readFileSync(path.join(dir, file), 'utf8').split('\n')
    .map((line, i) => ({ file, line: i + 1, text: line.trim() }))
    .filter(l => /^(?:-\s*)?uses:/.test(l.text)));

test('the workflows run actions', () => {
  assert.ok(uses.length >= 10, `only ${uses.length} "uses:" lines found: the scan no longer reaches the workflows`);
});

test('an action from another repository is pinned to a commit, with its version beside it', () => {
  for (const { file, line, text } of uses) {
    const target = text.replace(/^(?:-\s*)?uses:\s*/, '');
    if (target.startsWith('./')) continue;   // a workflow in this repository, at this commit
    assert.match(target, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${file}:${line} "${target}" is not owner/name@<40-hex commit> # vX.Y.Z`);
  }
});

test('one action is pinned to one commit everywhere', () => {
  const pins = new Map();
  for (const { text } of uses) {
    const m = /uses:\s*([\w.-]+\/[\w./-]+)@(\S+)/.exec(text);
    if (!m) continue;
    pins.set(m[1], (pins.get(m[1]) || new Set()).add(m[2]));
  }
  for (const [action, commits] of pins) assert.equal(commits.size, 1, `${action} is pinned to ${[...commits].join(' and ')}`);
});

// A pinned action is not the only code a job runs. `npm install web-ext@10.0.0` pins one package and lets the
// 340 it depends on resolve afresh, install scripts and all; in the release job that ran with permission to write
// to the repository, between building the packages and publishing them (docs/AUDIT-2026-11-15.md, finding 8).
test('a workflow that may write to the repository downloads no packages', () => {
  for (const file of fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    if (!/^\s*contents:\s*write\b/m.test(text)) continue;
    const runs = text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
    assert.doesNotMatch(runs, /\b(?:npm (?:install|i|ci|exec)|npx|yarn|pnpm|pip install|curl|wget)\b/, `${file} can write to the repository and installs or downloads something`);
  }
});

test('tools are installed without running their packages\' install scripts', () => {
  const sources = [...fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8')),
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')].join('\n').split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  const installs = sources.match(/npm install[^\n"&]*/g) || [];
  assert.ok(installs.length >= 3, `only ${installs.length} installs found: the scan no longer reaches them`);
  for (const command of installs) assert.match(command, /--ignore-scripts\b/, command);
});
