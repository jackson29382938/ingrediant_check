// "Report a problem or suggest an improvement": what a report contains, what it never contains, and
// the recent-actions log behind it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
require('../src/engine/db/prefs.js');
require('../src/engine/db/sorted-results.js');
require('../src/engine/db/unit-price.js');
require('../src/engine/db/speed.js');
const A = require('../src/engine/db/activity.js');
require('../src/options/store-request.js');
const D = require('../src/options/report-data.js');

test('recent actions: short, no query strings, repeats folded, capped', () => {
  let log = [];
  log = A.append(log, 'popup', 'autoScoreSearch off', 1000);
  log = A.append(log, 'popup', 'autoScoreSearch off', 2000);
  assert.equal(log.length, 1, 'the same line twice is one line');
  assert.equal(log[0].t, 2000);
  log = A.append(log, 'Amazon sort menu', 'chose Price per ounce on https://www.amazon.com/s?k=kefir&session-id=123#x', 3000);
  assert.equal(log[1].what, 'chose Price per ounce on https://www.amazon.com/s');
  log = A.append(log, 'x'.repeat(100), 'y\u0000z'.repeat(200), 4000);
  assert.equal(log[2].where.length, 40);
  assert.equal(log[2].what.length, A.MAX_TEXT);
  assert.ok(!log[2].what.includes('\u0000'));
  for (let i = 0; i < 100; i++) log = A.append(log, 'side panel', `slider health=${i}`, 5000 + i);
  assert.equal(log.length, A.MAX_ENTRIES);
  assert.equal(log.at(-1).what, 'slider health=99');
  assert.deepEqual(A.sanitize([null, 'junk', { where: '', what: 'x' }, { where: 'a', what: 'b', t: 'soon' }]).map(e => e.what), ['b']);
});

test('page address: path and search term only', () => {
  assert.equal(D.pageAddress('https://www.amazon.com/LIFEWAY-Organic-Plain-Kefir-FZ/dp/B0DX45213W/ref=sr_1_3_us_f3_0o_wf?dib=eyJ2&keywords=kefir&qid=1'),
    'https://www.amazon.com/LIFEWAY-Organic-Plain-Kefir-FZ/dp/B0DX45213W');
  assert.equal(D.pageAddress('https://www.amazon.com/s?k=organic+kefir&crid=3KB&sprefix=kef'), 'https://www.amazon.com/s?k=organic%20kefir');
  assert.equal(D.pageAddress('chrome-extension://abc/src/options/sidepanel.html'), 'extension page /src/options/sidepanel.html');
  assert.equal(D.pageAddress('javascript:alert(1)'), '');
  assert.equal(D.pageAddress('not a url'), '');
});

test('settings come through the sanitizers: no token, no cache contents, no stray keys', () => {
  const s = D.settingsFrom({
    enabled: true, autoScoreSearch: false, weights: { sugar: 1.5, notACategory: 9 }, goals: ['weightLoss', 'made-up'],
    allergens: ['milk'], avoidList: ['carrageenan'], sortLoadMore: true, sortCount: 30, unitMissing: 'infer-more', speedMode: 'fresh',
    'unitPrice': false, 's:amazon.com:B000000001': { score: 90 }, 'p:amazon.com:B000000001': { data: 'x' },
    googleToken: 'ya29.secret', accountEmail: 'person@example.com', diagQueue: [{ secret: 1 }], contributeUrl: 'https://evil.example',
  });
  assert.equal(s.autoScoreSearch, false);
  assert.equal(s.unitPrice, false);
  assert.deepEqual(s.goals, ['weightLoss']);
  assert.equal(s.weights.sugar, 1.5);
  assert.equal(s.weights.notACategory, undefined);
  assert.equal(s.sortCount, 30);
  assert.equal(s.unitMissing, 'infer-more');
  assert.equal(s.speedMode, 'fresh');
  assert.deepEqual(s.cached, { scores: 1, productReadings: 1 });
  const flat = JSON.stringify(s);
  for (const secret of ['ya29', 'person@example.com', 'diagQueue', 'evil.example', 'B000000001']) {
    assert.ok(!flat.includes(secret), `${secret} must not be in a report`);
  }
});

const CTX = {
  when: Date.parse('2026-09-25T18:00:00Z'), version: '1.1.0', rules: '2026-09-25.1', userAgent: 'Mozilla/5.0 Chrome/141', language: 'en-US',
  url: 'https://www.amazon.com/s?k=kefir&crid=XYZ', pageScore: { score: 78, verdict: 'Good', via: 'nic-ingredients-content' },
  sorted: { mode: 'unitPrice', loading: false, status: 'Collected 55 products.', sourceUrl: 'https://www.amazon.com/s?k=kefir&qid=1',
    items: [{ score: 90, unitPrice: 0.2 }, { score: null, unitPrice: null }] },
  settings: { autoScoreSearch: true, weights: { sugar: 1.5 }, avoidList: ['carrageenan'] },
  actions: [{ t: 1, where: 'Amazon sort menu', what: 'chose Price per ounce on https://www.amazon.com/s' }],
  screenshot: 'data:image/jpeg;base64,AAAA',
};

test('a report: the reader\'s words, then the details, each part can be left out', () => {
  const r = D.build({ kind: 'problem', title: 'No price per ounce for kefir', description: 'Most say "No price per ounce".', steps: '1. Sort by price per ounce' }, CTX);
  assert.equal(r.subject, '[Ingredient Check] Something is wrong / needs a fix: No price per ounce for kefir');
  assert.match(r.text, /Most say "No price per ounce"/);
  assert.match(r.text, /Page: https:\/\/www\.amazon\.com\/s\?k=kefir\n/);
  assert.match(r.text, /Side panel list: .*"listings":2,"withScore":1,"withPricePerOunce":1/);
  assert.match(r.text, /Weights changed from default: sugar=1\.5/);
  assert.match(r.text, /Avoid list: carrageenan/);
  assert.match(r.text, /Amazon sort menu: chose Price per ounce/);
  assert.match(r.text, /Screenshot: attached in the report file/);
  assert.equal(r.report.environment.rules, '2026-09-25.1');
  const lean = D.build({ kind: 'feature', title: 'x' }, CTX, { page: false, settings: false, actions: false, screenshot: false });
  assert.equal(lean.report.page, 'left out');
  assert.equal(lean.report.settings, 'left out');
  assert.equal(lean.report.recentActions, 'left out');
  assert.equal(lean.report.screenshot, 'left out');
  assert.ok(!/kefir|carrageenan|sort menu/.test(lean.text), 'left-out parts are not in the text');
  assert.equal(D.build({ kind: 'nonsense' }, {}).report.kind, 'problem');
});

test('the email draft goes to the developer, CRLF, cut when very long, asks for the attachment', () => {
  const r = D.build({ kind: 'improvement', title: 'Faster panel', description: 'x'.repeat(4000), steps: 'y'.repeat(4000) }, CTX);
  assert.ok(r.mailto.startsWith('mailto:jackson29382938@gmail.com?subject=%5BIngredient%20Check%5D%20Make%20something%20better'));
  const body = decodeURIComponent(r.mailto.split('&body=')[1]);
  assert.ok(body.includes('\r\n') && !/[^\r]\n/.test(body), 'CRLF line breaks');
  assert.ok(body.length < D.MAILTO_BODY_MAX + 400);
  assert.match(body, /cut here; the full report is in the attached file/);
  assert.match(body, /Please attach the report file/);
});

test('the report file: one escaped HTML page, only a real image embedded', () => {
  const r = D.build({ kind: 'other', title: '<img src=x onerror=alert(1)>' }, CTX);
  const html = D.htmlFile(r, CTX.screenshot);
  assert.ok(!html.includes('<img src=x'), 'the reader\'s text is escaped');
  assert.match(html, /<img alt="Screenshot of the page" src="data:image\/jpeg;base64,AAAA">/);
  assert.ok(!D.htmlFile(r, 'javascript:alert(1)').includes('javascript:'));
  assert.ok(!D.htmlFile(r, 'data:text/html;base64,AAAA').includes('data:text/html'));
  assert.equal(D.fileName(CTX.when), 'ingredient-check-report-202609251800.html');
});
