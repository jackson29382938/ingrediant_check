// The panel-state helpers (src/content/panel.js) for the tests that build a stand-in AIR.panel instead of loading the
// real one. Spread into the stand-in: `panel: { ...require('./panel-state-fakes.js'), mount() {}, ... }`.
'use strict';
const panel = require('../src/content/panel.js');
module.exports = { panelState: panel.panelState, setPanelState: panel.setPanelState, PANEL_STATES: panel.PANEL_STATES };
