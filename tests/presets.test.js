'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../src/engine/categories.js');

const {
  PRESETS, PRESET_CATEGORIES, DEFAULT_WEIGHTS, resolveWeights,
  presetWeightMap, weightsMatchPreset, matchPreset, presetsInCategory, listPresets,
} = categories;

describe('goal-based scoring presets', () => {
  it('exports a category list that covers every preset', () => {
    assert.ok(Array.isArray(PRESET_CATEGORIES) && PRESET_CATEGORIES.length >= 4);
    const ids = new Set(PRESET_CATEGORIES.map(c => c.id));
    for (const [id, preset] of Object.entries(PRESETS)) {
      assert.ok(preset.category, `${id} missing category`);
      assert.ok(ids.has(preset.category), `${id} category ${preset.category} not in PRESET_CATEGORIES`);
      assert.ok(preset.label && preset.note, `${id} needs label + note`);
      assert.ok(preset.glyph, `${id} needs glyph`);
      assert.ok(preset.versus, `${id} needs versus copy to distinguish similar goals`);
      assert.equal(typeof preset.weights, 'object');
    }
  });

  it('keeps the classic preset ids so existing imports and tests still resolve', () => {
    for (const id of ['balanced', 'conventional', 'additive', 'wholeFood', 'strictSugar']) {
      assert.ok(PRESETS[id], `missing classic preset ${id}`);
    }
  });

  it('includes the requested goal / training / style presets', () => {
    for (const id of [
      'muscleGain', 'weightLoss', 'maintenance', 'highProtein', 'endurance',
      'strength', 'generalFitness', 'recovery', 'lowCarb', 'highCarb', 'athlete', 'sedentary',
    ]) {
      assert.ok(PRESETS[id], `missing goal preset ${id}`);
    }
  });

  it('clamps every preset weight into the slider range', () => {
    for (const [id, preset] of Object.entries(PRESETS)) {
      for (const [k, v] of Object.entries(preset.weights || {})) {
        assert.ok(k in DEFAULT_WEIGHTS, `${id} unknown weight key ${k}`);
        assert.ok(typeof v === 'number' && v >= 0 && v <= 2, `${id}.${k}=${v} out of range`);
      }
    }
  });

  it('resolves balanced to the engine defaults', () => {
    assert.deepEqual(presetWeightMap('balanced'), DEFAULT_WEIGHTS);
    assert.ok(weightsMatchPreset({}, 'balanced'));
    assert.ok(weightsMatchPreset(DEFAULT_WEIGHTS, PRESETS.balanced));
  });

  it('matchPreset returns Custom (null) after a single dial drifts', () => {
    assert.equal(matchPreset(DEFAULT_WEIGHTS)[0], 'balanced');
    const drifted = resolveWeights({ ...DEFAULT_WEIGHTS, sugar: 1.7 });
    assert.equal(matchPreset(drifted), null);
  });

  it('highProtein rewards protein more than strength or muscleGain', () => {
    const high = presetWeightMap('highProtein');
    const strength = presetWeightMap('strength');
    const bulk = presetWeightMap('muscleGain');
    assert.ok(high.protein > strength.protein);
    assert.ok(high.protein >= bulk.protein);
    assert.ok(high.isolate < strength.isolate);
  });

  it('endurance is more carb-lenient than lowCarb', () => {
    const end = presetWeightMap('endurance');
    const low = presetWeightMap('lowCarb');
    assert.ok(end.sugar < low.sugar);
    assert.ok(end.grain < low.grain);
    assert.ok(low.protein >= end.protein);
  });

  it('weightLoss tightens sugar relative to maintenance', () => {
    const cut = presetWeightMap('weightLoss');
    const hold = presetWeightMap('maintenance');
    assert.ok(cut.sugar > hold.sugar);
    assert.ok(cut.fibre > hold.fibre);
    assert.ok(cut.protein > hold.protein);
  });

  it('presetsInCategory and listPresets stay in sync', () => {
    const all = listPresets();
    assert.equal(all.length, Object.keys(PRESETS).length);
    let counted = 0;
    for (const cat of PRESET_CATEGORIES) {
      const slice = presetsInCategory(cat.id);
      counted += slice.length;
      assert.ok(slice.every(([, p]) => p.category === cat.id));
    }
    assert.equal(counted, all.length);
  });
});
