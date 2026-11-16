// Runs tests/*.test.js: in parallel, except the files that assert a wall-clock limit, which run alone afterwards.
//
//   npm test                         everything
//   npm test -- tests/a.test.js ...  just those files (the serial ones still run alone)
//   npm run test:coverage            the parallel files once more, measuring the scoring engine (src/engine)
//                                    and failing under the floors below
//
// A file opts out of parallel running with a line `// @serial: <why>` near its top. A test that times a
// parse against a millisecond budget is measuring the machine as much as the code once other test processes
// share it, so those run with the machine to themselves. `node --test --test-concurrency=1` for all of it
// took about 60 s; this takes about half that on four cores and the same on one.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Coverage of the engine and its rule files: what a score is computed from. The floors sit a little under what
// the suite measured when they were set (99% of lines, 93% of branches, 97% of functions), so a new rule file
// or parser path that no test reaches fails here. Content scripts and pages are loaded through `vm` by their
// tests, which Node's coverage does not count, so they are left out rather than reported as zero. The files
// that time a parse are skipped: instrumented code is slower, and they assert nothing about coverage.
const coverage = process.argv.includes('--coverage');
const COVERAGE_ARGS = ['--experimental-test-coverage', '--test-coverage-include=src/engine/**',
  '--test-coverage-lines=97', '--test-coverage-branches=90', '--test-coverage-functions=94'];
const requested = process.argv.slice(2).filter(arg => arg !== '--coverage');
const files = (requested.length ? requested : readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.js')).map(f => join('tests', f)))
  .map(f => relative(root, join(root, f))).sort();
const serial = files.filter(f => /^\/\/ @serial\b/m.test(readFileSync(join(root, f), 'utf8').split('\n', 12).join('\n')));
const parallel = files.filter(f => !serial.includes(f));

const run = (label, list, args) => {
  if (!list.length) return 0;
  console.log(`\n# ${label}: ${list.length} file${list.length === 1 ? '' : 's'}`);
  return spawnSync(process.execPath, ['--test', ...args, ...list], { cwd: root, stdio: 'inherit' }).status ?? 1;
};

const failed = (coverage ? [run('in parallel, with engine coverage', parallel, COVERAGE_ARGS)]
  : [run('in parallel', parallel, []), run('alone (wall-clock limits)', serial, ['--test-concurrency=1'])]).some(code => code !== 0);
process.exit(failed ? 1 : 0);
