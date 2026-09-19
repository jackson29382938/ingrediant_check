// Store locale headings and JP/AR OCR decline. Run: node tests/locale.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const src = (...p) => path.join(__dirname, '..', 'src', ...p);

require(src('engine/db/_module.js'));
const extract = require(src('content/extract.js'));
const panel = require(src('content/panel.js'));

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

console.log('ingredient headings');
for (const heading of ['Ingredients', 'Ingredienser', 'İçindekiler', 'Icindekiler', '原材料']) {
  check(`recognises "${heading}"`, () => {
    assert.ok(extract.INGREDIENT_HEADING.test(heading), `missed ${heading}`);
    assert.ok(extract.INGREDIENT_HEADING.test(heading + ':'), `missed ${heading}:`);
  });
}

console.log('\nOCR readiness');
check('US/SE/TR still allow English OCR', () => {
  assert.equal(extract.ocrReadyForHost('www.amazon.com'), true);
  assert.equal(extract.ocrReadyForHost('www.amazon.se'), true);
  assert.equal(extract.ocrReadyForHost('www.amazon.com.tr'), true);
});
check('JP and Arabic stores decline English OCR', () => {
  assert.equal(extract.ocrReadyForHost('www.amazon.co.jp'), false);
  assert.equal(extract.ocrReadyForHost('amazon.co.jp'), false);
  assert.equal(extract.ocrReadyForHost('www.amazon.ae'), false);
  assert.equal(extract.ocrReadyForHost('www.amazon.sa'), false);
  assert.equal(extract.localeStatus('www.amazon.co.jp').reason, 'jp-ocr-not-ready');
  assert.equal(extract.localeStatus('www.amazon.ae').reason, 'ar-ocr-not-ready');
});

console.log('\nfailure copy names the locale decline');
check('panel failure card mentions the skipped OCR', () => {
  const html = panel.renderFailure({ localeDeclined: true });
  assert.match(html, /English reader will misread|photo OCR is not used/i);
});

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall passed');
