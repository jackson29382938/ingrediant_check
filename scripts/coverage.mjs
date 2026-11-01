#!/usr/bin/env node
// Line, branch and function coverage of src/ from the test suite, using the coverage report built into node:test
// (no dependency). It shows which code no test reaches, which is where dead code and untested branches hide.
//
//   npm run test:coverage                  everything, report on stdout
//   npm run test:coverage -- --lcov        also write coverage/lcov.info for an editor or a viewer
//
// Needs Node 22.5+ to limit the report to src/ and the scripts that ship; older Node prints the whole report.
//
// Read it with one limit in mind: the engine, the rule tables, the stores and the options helpers are loaded with
// require() and measured in full, but the content scripts and the service worker are run inside node:vm contexts by
// the tests (the way Chrome loads them), and V8 attributes only part of that code to its file. A low row for
// content/product.js, content/search.js or background.js means "measured through vm", not "untested".
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
const canFilter = major > 22 || (major === 22 && minor >= 5);
const lcov = process.argv.includes('--lcov');
const flags = ['--test', '--experimental-test-coverage'];
if (canFilter) flags.push('--test-coverage-include=src/**/*.js');
if (lcov) {
  mkdirSync(join(root, 'coverage'), { recursive: true });
  flags.push('--test-reporter=lcov', '--test-reporter-destination=coverage/lcov.info', '--test-reporter=spec', '--test-reporter-destination=stdout');
}
const files = readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.js')).map(f => join('tests', f));
// One process, one report: the serial files are measured in the same run, as the clock limits do not apply here.
const result = spawnSync(process.execPath, [...flags, ...files], { cwd: root, stdio: 'inherit' });
if (!canFilter) console.log('\n(Node before 22.5 cannot limit the report to src/; read the src/ rows.)');
process.exit(result.status ?? 1);
