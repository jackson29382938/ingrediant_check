// Regression and feature tests for the 2026-11-21 full-codebase audit and v1.28.0 upgrades.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const panel = require('../src/content/panel.js');
const diagnostics = require('../src/engine/db/diagnostics.js');
const { receiver } = require('./receiver-harness.js');

// Ensure AIR.engine is attached for panel.js nutrition lens normalization.
globalThis.AIR = globalThis.AIR || {};
globalThis.AIR.engine = engine;

test('offscreen/ocr.js: fromWorker fails closed when sender.id is missing or mismatched', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'offscreen', 'ocr.js'), 'utf8');
  const ctx = vm.createContext({
    chrome: {
      runtime: {
        id: 'ext-abc',
        getURL: p => `chrome-extension://ext-abc/${p}`,
        onMessage: { addListener: () => {} },
        sendMessage: () => Promise.resolve(),
      },
    },
    AIR: { db: { ocrText: { isAllowedOcrUrl: () => false, allowedOcrUrls: () => [] } } },
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
    Tesseract: { createWorker: () => Promise.resolve({}) },
  });
  vm.runInContext(src, ctx);
  assert.equal(ctx.fromWorker({ url: 'chrome-extension://ext-abc/src/background.js' }), false, 'missing sender.id must fail closed');
  assert.equal(ctx.fromWorker({ id: '', url: 'chrome-extension://ext-abc/src/background.js' }), false, 'empty sender.id must fail closed');
  assert.equal(ctx.fromWorker({ id: 'other-ext', url: 'chrome-extension://ext-abc/src/background.js' }), false);
  assert.equal(ctx.fromWorker({ id: 'ext-abc', tab: { id: 1 }, url: 'chrome-extension://ext-abc/src/background.js' }), false);
  assert.equal(ctx.fromWorker({ id: 'ext-abc', url: 'chrome-extension://ext-abc/src/options/popup.html' }), false);
  assert.equal(ctx.fromWorker({ id: 'ext-abc', url: 'chrome-extension://ext-abc/src/background.js' }), true);
});

test('panel.js: Nutrition Facts side-by-side badge lens renders normalised pills with high/good highlights', () => {
  const nutrition = { servingGrams: 50, addedSugar: 7, sodium: 400, fibre: 3, protein: 6 };
  const result = engine.score({ name: 'Granola Bar', ingredients_text: 'Oats, honey, salt', nutrition });
  const html = panel.render(result, { title: 'Granola Bar', confidence: 1, via: 'page', nutrition });
  assert.match(html, /class="nut-lens"/);
  assert.match(html, /per 100g/);
  assert.match(html, /class="nut-pill high">Added sugar 14 g</);
  assert.match(html, /class="nut-pill high">Sodium 800 mg</);
  assert.match(html, /class="nut-pill good">Fiber 6 g</);
  assert.match(html, /class="nut-pill good">Protein 12 g</);

  const breakdown = panel.renderBreakdown(result, { asin: 'B000000001', score: result.score, verdict: result.verdict, nutrition });
  assert.match(breakdown, /class="nut-lens"/);

  const noNut = panel.render(result, { title: 'Granola Bar', confidence: 1, via: 'page' });
  assert.doesNotMatch(noNut, /class="nut-lens"/);
});

test('apps-script.gs: doGet exposes schemaVersion matching diagnostics.BACKEND_SCHEMA_VERSION', () => {
  const r = receiver({});
  const status = r.get({});
  assert.equal(status.ok, true);
  assert.equal(status.schemaVersion, diagnostics.BACKEND_SCHEMA_VERSION);
  assert.equal(status.schemaVersion, 2);
});
