// The toolbar popup is sized by the browser to fit its content, so a width or height measured from
// the viewport measures the window it is setting. width:min(360px,100vw) opened the popup about
// 210px wide with one word per line in 1.26.0 (seen in Chrome, reproduced in Chromium).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const html = fs.readFileSync('src/options/popup.html', 'utf8');
const shared = fs.readFileSync('src/options/simple-ui.css', 'utf8');

test('the popup body has a fixed width, not one measured from its own viewport', () => {
  const body = /(?:^|[\s}])body\{([^}]*)\}/.exec(html);
  assert.ok(body, 'popup.html has no body rule');
  assert.match(body[1], /(?:^|;)width:\d+px(?:;|$)/, 'the popup body needs a width in px');
  assert.doesNotMatch(body[1], /\d(?:vw|vh|vmin|vmax|%)/, 'the popup body is sized from the viewport');
  const page = /\[data-ui-page=popup\]\{([^}]*)\}/.exec(shared);
  assert.ok(page, 'simple-ui.css has no popup rule');
  assert.doesNotMatch(page[1], /(?:width|height):/, 'simple-ui.css overrides the popup size');
});

test('popup.js only narrows the popup, and only to the width the window has', () => {
  const js = fs.readFileSync('src/options/popup.js', 'utf8');
  const width = Number(/(?:^|[\s}])body\{[^}]*?width:(\d+)px/.exec(html)[1]);
  assert.match(js, new RegExp(`const FULL = ${width};`), 'fitWidth and the stylesheet disagree on the popup width');
});
