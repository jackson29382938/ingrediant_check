# Current validation

Source version: **1.26.5**. The checks below were run on the commit that carries this version, in a cloud
session with Chromium (the preinstalled build, no network to the stores). See the
[1.26.5 release notes](releases/1.26.5.md) and the audits that led to it
([2026-11-15](AUDIT-2026-11-15.md), [2026-11-16](AUDIT-2026-11-16.md)). This file is rewritten at each release;
older records are in the release notes and in [docs/history](history/).

## Checks run on 1.26.5

| Check | Result |
| --- | --- |
| `npm test` | All passed: the parallel files and the serial files that time a parse |
| `npm run test:coverage` | Scoring engine at or above its floors (97% of lines, 90% of branches) |
| `npm run lint` | Passed with `--max-warnings 0` (ESLint 10.15.0) |
| `npm run preflight` | Passed: manifest, scripts, content-script weight, every key against 1,257 English and German messages, every goal and weight message |
| `npm run pack` | Chrome and Firefox 1.26.5 packages built |
| `npm run harness:ci` (real Chromium, installed extension) | Passed |
| `npm run retailers:check` | Passed |
| `npm run website:check` | Passed |
| axe-core on the eight extension pages and seven website pages, light and dark, desktop and phone width | No issues |
| Extension pages in a German-locale browser | No visible English text |
| Service worker with the sorted list open, no debugger attached | Stays stopped after 30 idle seconds |

The CI workflow runs the tests on Node 20, 22 and 24, the Chromium and Firefox harnesses, and the Firefox package
lint on every push.

## What this does not establish

Fixture coverage and automated tests establish implementation behaviour. They do not prove live retailer
coverage, OCR accuracy on real photos, or independent nutrition or health-score accuracy.

## External evidence still required

- Independent nutrition or dietitian review against packaging-verified, held-out labels and a predeclared
  rubric. The scoring corpus and passing tests do not establish clinical validity.
- Live checks of each retailer's pages: store layouts, anti-bot responses and network access change, and a
  blocked check is not counted as a success.
- Deployment owner verification of the Apps Script properties and the deployed web app version.
- Browser-store publication and Mozilla signing remain publisher actions.
