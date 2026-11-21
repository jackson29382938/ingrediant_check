// Reproduce the 2026-11-16 audit without sending data to any external service.
// Run: node docs/audit-verification-2026-11-16.cjs
'use strict';
/* global __dirname, console, process, structuredClone, setTimeout, clearTimeout, URL, URLSearchParams, AbortSignal, AbortController */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const engine = require('../src/engine/score.js');
const ocr = require('../src/engine/db/ocr-text.js');
const compact = text => {
  const r = engine.score({ ingredients_text: text }, { allergens: ['soy', 'peanut', 'sesame', 'wheat', 'milk'] });
  return { score: r.score, readable: r.readable, coverage: r.coverage, warnings: r.flags.map(f => f.id) };
};

// Actual output of the shipped Tesseract engine on the public packaging photo for 737628064502.
const noodleOcr = 'INGREDIENTS: RICE NOODLES (RICE, WATER)\nSEASONING PACKET (PEANUT, SUGAR, SALT,\nCORN STARCH, SPICES [CHILI, CINNAMON,\nPEPPER, CUMIN, CLOVE], HYDROLYZED SO¥\nPROTEIN, GREEN ONIONS, CITRIC ACID, PEANUT\nOIL, SESAME OIL, NATURAL FLAVOR). THIS\nPRODUCT CONTAINS PEANUTS.\n\nIMPORTED BY : EPICUREAN INTERNATIONAL. INC.\nP.O. BOX 13242, BERKELEY, CA 94712-4242 USA\n';
const noodleTruth = 'RICE NOODLES (RICE, WATER), SEASONING PACKET (PEANUT, SUGAR, SALT, CORN STARCH, SPICES [CHILI, CINNAMON, PEPPER, CUMIN, CLOVE], HYDROLYZED SOY PROTEIN, GREEN ONIONS, CITRIC ACID, PEANUT OIL, SESAME OIL, NATURAL FLAVOR)';
console.log('real-photo soy omission', JSON.stringify({ truth: compact(noodleTruth), ocr: compact(ocr.ingredientsFromOcr(noodleOcr)) }));
console.log('OCR block includes importer', /IMPORTED BY/.test(ocr.ingredientsFromOcr(noodleOcr)));

// Actual English-model output on the French packaging photo for 7622210449283.
const frenchOcr = 'A@BSCUITS FOURRES (35 %) PARFUM Cuoco\nsea 30 % (Farine de BLE 43\nBiompl 125, cb\nfaao maigre en poudre 4.5%, sitop de glucose, amidn\nBlt poudres a lever (carbonates ¢ ammonium, carbonates\ntesodum), émulsifiant (lecithanes de SOJA), sel, LAT éaeme\ntn dat de lactoserum (de LAIT), arbmes.\nPUT CONTENIR OEUE.\n';
const frenchTruth = 'Céréale 50 % (Farine de BLÉ 34,8 %, farine de BLÉ complète 15,2 %), sucre, huiles végétales (palme, colza), cacao maigre en poudre 4,5 %, sirop de glucose, amidon de BLÉ, poudres à lever (carbonates d’ammonium, carbonates de sodium), émulsifiant (lécithines de SOJA), sel, LAIT écrémé en poudre, perméat de lactosérum (de LAIT), arômes';
console.log('raw OCR fallback', JSON.stringify({ hasBlock: !!ocr.ingredientsFromOcr(frenchOcr), truth: compact(frenchTruth), rawFallback: compact(frenchOcr) }));

// Reuse the repository's worker sandbox, before any test definitions. All fetches below are mocked.
const testFile = path.join(root, 'tests/ai-worker.test.js');
let source = fs.readFileSync(testFile, 'utf8');
source = source.slice(0, source.indexOf("test('only the pages"));
source += '\nmodule.exports = { worker, on, reply, amazonTab };';
const sandboxModule = { exports: {} };
vm.runInNewContext(source, { require: createRequire(testFile), module: sandboxModule, console,
  structuredClone, setTimeout, clearTimeout, URL, URLSearchParams, AbortSignal, AbortController }, { filename: testFile });
const { worker, on, reply, amazonTab } = sandboxModule.exports;
(async () => {
  let release, began;
  const held = new Promise(resolve => { release = resolve; });
  const firstStarted = new Promise(resolve => { began = resolve; });
  const w = worker(on, async (_body, count) => {
    if (count === 1) { began(); await held; }
    return reply(JSON.stringify({ ratings: [] }));
  });
  const first = w.send({ type: 'aiRateIngredients', names: ['zorbex'] }, amazonTab);
  await firstStarted;
  const queued = w.send({ type: 'aiRateIngredients', names: ['plimm'] }, amazonTab);
  await new Promise(resolve => setTimeout(resolve, 20));
  w.data.aiRatings = false;
  w.data.openrouterKey = '';
  release();
  await Promise.all([first, queued]);
  console.log('AI sends after opt-out/key removal', JSON.stringify({ totalRequests: w.calls.length,
    queuedNames: w.calls[1] && JSON.parse(w.calls[1].body.messages[1].content).ingredients,
    queuedUsedRemovedKey: !!w.calls[1]?.options.headers.Authorization.includes(on.openrouterKey) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
