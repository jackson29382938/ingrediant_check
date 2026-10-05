'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const theme = require('../src/engine/db/theme.js');

// Machado et al. (2009), severity 100%, applied to linear sRGB:
// https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
const SIMULATIONS = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
function simulatedLab(hex, matrix) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = matrix.map(row => Math.max(0, Math.min(1, row.reduce((sum, c, i) => sum + c * rgb[i], 0))));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function distance(a, b) { return Math.hypot(...a.map((v, i) => v - b[i])) * 100; }

for (const [name, matrix] of Object.entries(SIMULATIONS)) {
  test(`colour-blind score cues remain separated under simulated ${name}`, () => {
    const channels = {
      rings: theme.PALETTES.cvd.light.map(row => row[2]),
      darkText: theme.PALETTES.cvd.dark.map(row => row[0]),
      toolbar: [95, 80, 60, 30, 10].map(score => theme.toolbar(score, 'cvd').bg),
    };
    // Eight Oklab points is an application regression floor, not a WCAG criterion or a promise
    // for every reader. All pairs are checked; numeric scores/verdicts remain independent cues.
    for (const [channel, colors] of Object.entries(channels)) {
      for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
        const delta = distance(simulatedLab(colors[i], matrix), simulatedLab(colors[j], matrix));
        assert.ok(delta >= 8, `${name} ${channel} bands ${i}/${j}: ${delta.toFixed(2)} Oklab points`);
      }
    }
    assert.equal(distance(simulatedLab('#123456', matrix), simulatedLab('#123456', matrix)), 0);
    assert.ok(distance(simulatedLab('#000000', matrix), simulatedLab('#ffffff', matrix)) > 99);
  });
}

test('all toolbar palettes retain readable score numbers, including bright colour-blind fills', () => {
  for (const palette of ['standard', 'cvd']) for (const score of [100, 90, 89, 75, 74, 50, 49, 25, 24, 0]) {
    const colors = theme.toolbar(score, palette);
    assert.ok(theme.contrast(colors.fg, colors.bg) >= 4.5, `${palette} score ${score}`);
  }
  assert.deepEqual(theme.toolbar(95, 'unknown'), theme.toolbar(95, 'standard'));
});
