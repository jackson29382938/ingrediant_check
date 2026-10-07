// The toolbar popup follows the settings level (src/options/popup.html data-level, popup.js applyLevel).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../src/engine/db/_module.js');
require('../src/engine/db/allergens.js');
require('../src/engine/categories.js');
const prefs = require('../src/engine/db/prefs.js');

const popup = fs.readFileSync('src/options/popup.html', 'utf8');
const script = fs.readFileSync('src/options/popup.js', 'utf8');
const options = fs.readFileSync('src/options/options.html', 'utf8');
const ui = fs.readFileSync('src/options/ui.css', 'utf8');

// An element's own id, or for a label the id of the checkbox it wraps (never a neighbour's).
const idOf = (tag, attrs, rest) => (attrs.match(/\bid="([^"]+)"/)
  || (tag === 'label' ? rest.match(/^\s*<input[^>]*\bid="([^"]+)"/) : null) || [])[1];

// Every element carrying a data-level, with its id.
function gated() {
  const out = [];
  for (const m of popup.matchAll(/<(\w+)\b([^>]*\bdata-level="(\d)"[^>]*)>(?=([\s\S]{0,120}))/g)) {
    out.push({ tag: m[1], level: Number(m[3]), id: idOf(m[1], m[2], m[4]) });
  }
  return out;
}
const levelOfId = id => (gated().find(g => g.id === id) || { level: 0 }).level;

test('Minimal keeps the essentials; Standard and up show every control the popup has today', () => {
  // Never gated: the only pause switch, this page's score, goals, the disclosure for automatic
  // requests to Amazon, the way to Settings and to report a problem, the cache clear, the safety note.
  for (const id of ['enabled', 'pageScore', 'autoScoreSearch', 'presets', 'openSettings', 'openReport', 'clear', 'status']) {
    assert.equal(levelOfId(id), 0, `${id} shows at every level`);
  }
  const ids = [...popup.matchAll(/<input type="checkbox" id="(\w+)"/g)].map(m => m[1]);
  // Where a switch sits (on top, or under "More") is a layout choice; which level shows it is the rule.
  const shownAtMinimal = ids.filter(id => levelOfId(id) === 0).sort();
  assert.deepEqual(shownAtMinimal, ['autoScoreSearch', 'enabled'], 'two switches at Minimal');
  const shownAtSimple = ids.filter(id => levelOfId(id) <= 1).sort();
  assert.deepEqual(shownAtSimple, ['autoScoreSearch', 'badges', 'enabled', 'foodOnly'], 'four at Simple');
  assert.equal(ids.filter(id => levelOfId(id) <= 2).length, ids.length, 'Standard shows all of them');
  assert.ok(gated().every(g => g.level <= 2), 'nothing is held back for Advanced or Everything: they match today\'s popup');
});

test('a switch that makes requests stays outside "More", with its line saying so', () => {
  // The disclosure sits where the switch is: folding either away would leave a switch that sends requests
  // with nothing next to it (the harness checks the same in a real browser).
  const more = popup.indexOf('<details class="more-box"');
  assert.ok(more > 0);
  for (const id of ['autoScoreSearch', 'hoverScore']) {
    const at = popup.indexOf(`<input type="checkbox" id="${id}"`);
    assert.ok(at > 0 && at < more, `${id} is on top, not folded under More`);
    const label = popup.slice(popup.lastIndexOf('<label', at), popup.indexOf('</label>', at));
    assert.match(label, /class="net"/, `${id} names the requests it makes`);
  }
});

test('a popup link never points into a Settings section that the same level would hide', () => {
  for (const [link, section] of [['openNetwork', 'sec-rate'], ['openStores', 'sec-stores']]) {
    const sectionLevel = Number((options.match(new RegExp(`<section id="${section}"[^>]*data-level="(\\d)"`)) || [])[1] || 0);
    assert.ok(levelOfId(link) >= sectionLevel, `${link} (level ${levelOfId(link)}) opens ${section} (level ${sectionLevel})`);
  }
});

test('every popup control still exists, so the stored values keep loading and saving whatever is shown', () => {
  const keys = script.match(/const TOGGLE_KEYS = \[([^\]]*)\]/)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
  for (const id of [...keys, 'useOpenFoodFacts']) assert.ok(popup.includes(`id="${id}"`), `${id} is still in the popup`);
  assert.ok(/<link rel="stylesheet" href="ui\.css">/.test(popup), 'the popup loads the shared stylesheet');
  assert.ok(/\.lvl-hidden,\s*\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(ui),
    'the hiding rule beats the display rules, and a hidden element stays hidden (the empty This-page box)');
});

// applyLevel itself, run against a small fake page.
function run(level) {
  const els = [...popup.matchAll(/<(\w+)\b([^>]*\bdata-level="(\d)"[^>]*)>(?=([\s\S]{0,120}))/g)].map(m => ({
    level: m[3], id: idOf(m[1], m[2], m[4]), hidden: false,
    dataset: { level: m[3] }, classList: { toggle(c, on) { this.owner.hidden = on; }, owner: null },
  }));
  els.forEach(e => { e.classList.owner = e; });
  const link = { textContent: '' };
  const code = script.match(/function applyLevel\(level\) \{[\s\S]*?\n\}\n/)[0];
  const ctx = vm.createContext({
    PREFS: prefs, msg: (_k, fallback) => fallback,
    document: { querySelectorAll: () => els, getElementById: id => (id === 'openSettings' ? link : null) },
  });
  vm.runInContext(code + `\napplyLevel(${JSON.stringify(level)})`, ctx);
  return { hidden: els.filter(e => e.hidden).map(e => e.id || e.level), link: link.textContent };
}

test('applyLevel hides what the level does not reach, and shows it again when the level rises', () => {
  const minimal = run('minimal');
  const standard = run('standard');
  assert.ok(minimal.hidden.length > standard.hidden.length);
  assert.equal(standard.hidden.length, 0, 'Standard hides nothing');
  assert.equal(run('expert').hidden.length, 0);
  assert.ok(minimal.hidden.includes('compareBlock') && minimal.hidden.includes('openStores'));
  assert.ok(!minimal.hidden.includes('autoScoreSearch'));
  const simple = run('simple');
  assert.ok(!simple.hidden.includes('badges') && !simple.hidden.includes('foodOnly') && !simple.hidden.includes('openNetwork'));
  assert.ok(simple.hidden.includes('hoverScore') && simple.hidden.includes('unitPrice'));
});

test('an unknown level behaves as Minimal rather than breaking, and the Settings button reads the same at every level', () => {
  assert.deepEqual(run('nonsense').hidden, run('minimal').hidden);
  for (const level of prefs.LEVELS) assert.equal(run(level).link, '', `${level}: applyLevel leaves the Settings button's text alone`);
  assert.equal(levelOfId('openSettings'), 0, 'and it is never gated');
});

test('an install from before levels existed keeps the full popup; a fresh one gets Standard', () => {
  assert.equal(prefs.levelOf({ onboarded: true }), 'expert');
  assert.equal(prefs.levelOf({}), 'standard');
  assert.equal(run(prefs.levelOf({ onboarded: true })).hidden.length, 0);
});

test('the popup listens for level changes before its write guard, and never writes the level itself', () => {
  const listener = script.slice(script.indexOf('chrome.storage.onChanged.addListener(changes =>'));
  assert.ok(listener.indexOf('changes.settingsLevel') < listener.indexOf('if (writing) return;'));
  assert.ok(!/persist\(\s*\{\s*settingsLevel/.test(script) && !/save\('settingsLevel'/.test(script));
  assert.ok(script.includes("'settingsLevel', 'onboarded'"), 'the first read asks for the level');
});
