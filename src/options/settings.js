// Settings page.
//
// Renders one slider per scoring category, straight from the taxonomy in engine/categories.js, so
// adding a category to the engine adds it here with no UI work. Writes go through prefs.sanitize*
// before chrome.storage.local, so a hand-edited import or a leftover key cannot corrupt scoring.

const CATS = AIR.db.categories;
const ALLERGENS = AIR.db.allergens;
const PREFS = AIR.db.prefs;

function msg(key, fallback, sub) {
  let out = '';
  try { out = chrome.i18n && chrome.i18n.getMessage(key, sub != null ? [String(sub)] : []) || ''; }
  catch (e) { /* missing key or not in an extension page */ }
  return out || fallback;
}

(function localise() {
  if (!chrome.i18n || typeof chrome.i18n.getMessage !== 'function') return;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const text = chrome.i18n.getMessage(el.dataset.i18n);
    if (text) el.textContent = text;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const text = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (text) el.setAttribute('placeholder', text);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const text = chrome.i18n.getMessage(el.dataset.i18nAria);
    if (text) el.setAttribute('aria-label', text);
  }
})();

const state = PREFS.sanitizeScoring({});
const DB_KEYS = ['sharedCache', 'shareContributions', 'sendDiagnostics', 'settingsBackup'];
let saveTimer = null;
let writing = false;

function flash(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (kind === 'error' ? ' error' : '');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 2800);
}

function persist(values, done) {
  writing = true;
  chrome.storage.local.set(values, () => {
    writing = false;
    if (chrome.runtime.lastError) {
      flash(msg('optCouldNotSave', 'Could not save') + ' — ' + chrome.runtime.lastError.message, 'error');
      if (done) done(false);
      return;
    }
    if (done) done(true);
  });
}

function scoringPayload() {
  return PREFS.sanitizeScoring(state);
}

function save({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const write = () => persist(scoringPayload(), ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}

function applyScoring(next) {
  const clean = PREFS.sanitizeScoring(next);
  state.weights = clean.weights;
  state.allergens = clean.allergens;
  state.diets = clean.diets;
  state.avoidList = clean.avoidList;
  state.foodOnly = clean.foodOnly;
}

// ---------------------------------------------------------------- categories
function weightOf(id) {
  return id in state.weights ? state.weights[id] : CATS.DEFAULT_WEIGHTS[id];
}

function syncCatMeta(row, id) {
  const w = weightOf(id);
  const def = CATS.DEFAULT_WEIGHTS[id];
  row.dataset.off = w === 0 ? '1' : '0';
  row.dataset.custom = Math.abs(w - def) > 0.001 ? '1' : '0';
}

function applyCatFilter() {
  const host = document.getElementById('categories');
  const empty = document.getElementById('catEmpty');
  if (!host) return;
  const q = ((document.getElementById('catFilter') || {}).value || '').trim().toLowerCase();
  const modeBtn = document.querySelector('.cat-filter[aria-pressed="true"]');
  const mode = (modeBtn && modeBtn.dataset.filter) || 'all';
  let visible = 0;
  let custom = 0;
  let lastGroup = null;
  for (const el of host.children) {
    if (el.classList.contains('cat-group')) {
      lastGroup = el;
      el.hidden = true;
      continue;
    }
    if (!el.classList.contains('cat')) continue;
    if (el.dataset.custom === '1') custom++;
    const matchQ = !q || (el.dataset.search || '').includes(q);
    const matchMode = mode === 'all'
      || (mode === 'off' && el.dataset.off === '1')
      || (mode === 'custom' && el.dataset.custom === '1');
    const show = matchQ && matchMode;
    el.hidden = !show;
    if (show) {
      visible++;
      if (lastGroup) lastGroup.hidden = false;
    }
  }
  if (empty) empty.hidden = visible > 0;
  const customBtn = document.querySelector('.cat-filter[data-filter="custom"]');
  if (customBtn) {
    const changed = msg('optFilterChanged', 'Changed');
    customBtn.textContent = custom ? `${changed} · ${custom}` : changed;
  }
}

function renderCategories() {
  const host = document.getElementById('categories');
  host.textContent = '';
  let lastGroup = null;

  for (const c of CATS.CATEGORIES) {
    if (c.kind === 'flag') continue;   // flags are configured in their own sections below

    if (c.group !== lastGroup) {
      lastGroup = c.group;
      const h = document.createElement('h2');
      h.className = 'cat-group';
      h.textContent = c.group;
      host.appendChild(h);
    }

    const row = document.createElement('div');
    row.className = 'cat';
    row.dataset.search = `${c.group} ${c.label} ${c.help} ${c.id}`.toLowerCase();
    row.dataset.id = c.id;
    syncCatMeta(row, c.id);

    const label = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.label;
    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = msg(`catHelp_${c.id}`, c.help);
    label.append(name, help);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0'; slider.max = '2'; slider.step = '0.1';
    slider.value = String(weightOf(c.id));
    slider.id = `w-${c.id}`;
    slider.setAttribute('aria-label', `${c.label} weight`);

    const val = document.createElement('div');
    val.className = 'val';
    const paint = v => {
      val.textContent = Number(v) === 0 ? 'off' : `${Number(v).toFixed(1)}×`;
      val.className = 'val' + (Number(v) === 0 ? ' zero' : Number(v) > 1 ? ' high' : '');
    };
    paint(slider.value);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      state.weights[c.id] = v;
      applyScoring(state);
      paint(weightOf(c.id));
      syncCatMeta(row, c.id);
      markPresetDirty();
      applyCatFilter();
      save();
    });

    row.append(label, slider, val);
    host.appendChild(row);
  }
  applyCatFilter();
}

// ---------------------------------------------------------------- presets
let presetCategory = 'everyday';

function presetList() {
  if (CATS.listPresets) return CATS.listPresets();
  return Object.entries(CATS.PRESETS);
}

function presetCategories() {
  return CATS.PRESET_CATEGORIES || [
    { id: 'everyday', label: 'Everyday', blurb: '' },
  ];
}

function findMatchingPreset() {
  if (CATS.matchPreset) return CATS.matchPreset(state.weights);
  return Object.entries(CATS.PRESETS).find(([, p]) => {
    const target = { ...CATS.DEFAULT_WEIGHTS, ...p.weights };
    return Object.keys(target).every(k => Math.abs(weightOf(k) - target[k]) < 0.001);
  }) || null;
}

function renderPresetCategories() {
  const host = document.getElementById('presetCats');
  if (!host) return;
  host.textContent = '';
  for (const cat of presetCategories()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-cat';
    b.id = `preset-cat-${cat.id}`;
    b.dataset.category = cat.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(cat.id === presetCategory));
    b.textContent = cat.label;
    b.addEventListener('click', () => {
      presetCategory = cat.id;
      const grid = document.getElementById('presets');
      if (grid) grid.dataset.userTab = '1';
      renderPresetCategories();
      renderPresets();
    });
    host.appendChild(b);
  }
  const blurb = document.getElementById('presetCatBlurb');
  const active = presetCategories().find(c => c.id === presetCategory);
  if (blurb) blurb.textContent = (active && active.blurb) || '';
}

function renderPresets() {
  const host = document.getElementById('presets');
  if (!host) return;
  host.textContent = '';
  const match = findMatchingPreset();
  const matchId = match ? match[0] : null;
  if (matchId && CATS.PRESETS[matchId] && CATS.PRESETS[matchId].category && !host.dataset.userTab) {
    presetCategory = CATS.PRESETS[matchId].category;
  }

  const entries = presetList().filter(([, p]) => (p.category || 'everyday') === presetCategory);
  for (const [id, preset] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-card';
    b.dataset.preset = id;
    b.setAttribute('aria-pressed', String(id === matchId));
    b.setAttribute('aria-describedby', 'presetNote');

    const top = document.createElement('div');
    top.className = 'preset-card-top';
    const glyph = document.createElement('span');
    glyph.className = 'preset-glyph';
    glyph.textContent = preset.glyph || preset.label.slice(0, 3);
    glyph.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'preset-card-title';
    title.textContent = preset.label;
    top.append(glyph, title);

    const note = document.createElement('p');
    note.className = 'preset-card-note';
    note.textContent = preset.note;

    b.append(top, note);
    b.addEventListener('click', () => applyPreset(id));
    b.addEventListener('focus', () => showPresetDetail(id));
    b.addEventListener('mouseenter', () => showPresetDetail(id));
    host.appendChild(b);
  }

  // Sync category tab highlight if auto-follow moved the category.
  document.querySelectorAll('.preset-cat').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.category === presetCategory));
  });
  const blurb = document.getElementById('presetCatBlurb');
  const active = presetCategories().find(c => c.id === presetCategory);
  if (blurb) blurb.textContent = (active && active.blurb) || '';

  paintPresetActive(match);
  if (matchId && CATS.PRESETS[matchId] && CATS.PRESETS[matchId].category === presetCategory) {
    showPresetDetail(matchId);
  } else if (entries[0]) {
    showPresetDetail(entries[0][0], { previewOnly: !matchId });
  } else {
    showPresetDetail(null);
  }
}

function showPresetDetail(id, { previewOnly = false } = {}) {
  const detail = document.getElementById('presetDetail');
  const title = document.getElementById('presetDetailTitle');
  const note = document.getElementById('presetNote');
  const versus = document.getElementById('presetVersus');
  const preset = id && CATS.PRESETS[id];
  if (!detail || !note) return;
  if (!preset) {
    detail.hidden = true;
    note.textContent = '';
    if (versus) versus.textContent = '';
    if (title) title.textContent = '';
    return;
  }
  detail.hidden = false;
  if (title) {
    title.textContent = previewOnly
      ? preset.label
      : msg('optPresetOptimized', 'Optimized for') + ' · ' + preset.label;
  }
  note.textContent = preset.note;
  if (versus) {
    versus.innerHTML = '';
    if (preset.versus) {
      const strong = document.createElement('strong');
      strong.textContent = msg('optPresetVersus', 'How it differs');
      versus.append(strong, document.createTextNode(' — ' + preset.versus));
    }
  }
}

function paintPresetActive(match) {
  const name = document.getElementById('presetActiveName');
  if (!name) return;
  if (match) {
    name.textContent = match[1].label;
    name.classList.remove('is-custom');
  } else {
    name.textContent = msg('optPresetCustomLabel', 'Custom');
    name.classList.add('is-custom');
  }
}

function applyPreset(id) {
  const preset = CATS.PRESETS[id];
  if (!preset) return;
  const weights = CATS.presetWeightMap
    ? CATS.presetWeightMap(id)
    : { ...CATS.DEFAULT_WEIGHTS, ...preset.weights };
  applyScoring({ ...state, weights });
  if (preset.category) presetCategory = preset.category;
  const host = document.getElementById('presets');
  if (host) delete host.dataset.userTab;
  renderCategories();
  renderPresetCategories();
  renderPresets();
  showPresetDetail(id);
  save({ immediate: true });
}

function markActivePreset(id) {
  document.querySelectorAll('.preset-card').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.preset === id)));
}

function markPresetDirty() {
  // Once a slider moves, the weights are the user's, not a preset's. Say so rather than leaving a
  // preset highlighted that no longer describes what is set.
  const match = findMatchingPreset();
  markActivePreset(match ? match[0] : null);
  paintPresetActive(match);
  const note = document.getElementById('presetNote');
  const versus = document.getElementById('presetVersus');
  const title = document.getElementById('presetDetailTitle');
  const detail = document.getElementById('presetDetail');
  if (match) {
    showPresetDetail(match[0]);
  } else {
    if (detail) detail.hidden = false;
    if (title) title.textContent = msg('optPresetCustomLabel', 'Custom');
    if (note) {
      note.textContent = msg('optCustomWeights',
        'Custom weights — dials no longer match a preset. Pick a card to reset, or keep fine-tuning.');
    }
    if (versus) versus.textContent = '';
  }
}

// ---------------------------------------------------------------- flags
function renderChips(hostId, items, selected, onToggle) {
  const host = document.getElementById(hostId);
  host.textContent = '';
  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'chip';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.includes(item.id);
    box.addEventListener('change', () => onToggle(item.id, box.checked));
    label.append(box, document.createTextNode(item.label));
    host.appendChild(label);
  }
}

function toggleIn(arr, id, on) {
  const i = arr.indexOf(id);
  if (on && i === -1) arr.push(id);
  if (!on && i !== -1) arr.splice(i, 1);
  applyScoring(state);
  save();
}

// ---------------------------------------------------------------- import / export
function wireFileActions() {
  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(PREFS.exportPayload(state), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ingredient-check-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flash(msg('optExported', 'Exported'));
  });

  const file = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    try {
      const parsed = PREFS.parseImport(await f.text());
      if (!parsed.ok) {
        flash(parsed.reason === 'not-json'
          ? msg('optNotJson', 'That file is not JSON')
          : msg('optNotExport', 'That file is not an Ingredient Check settings export'), 'error');
        return;
      }
      applyScoring(parsed.prefs);
      renderAll();
      save({ immediate: true });
      flash(msg('optImported', 'Imported'));
    } catch (e) {
      flash(msg('optImportFailed', 'That file could not be read'), 'error');
    }
    file.value = '';
  });

  document.getElementById('reset').addEventListener('click', () => {
    if (!window.confirm(msg('optResetConfirm', 'Reset weights, warnings, and the avoid list to defaults? Your online backups are left alone.'))) return;
    applyScoring({});
    renderAll();
    save({ immediate: true });
    flash(msg('optResetDone', 'Reset to defaults'));
  });
}



// ---------------------------------------------------------------- boot
const AVOID_HINTS = [
  'carrageenan', 'red 40', 'yellow 5', 'yellow 6', 'blue 1',
  'titanium dioxide', 'BHT', 'BHA', 'TBHQ',
  'natural flavors', 'artificial flavors', 'sucralose',
];

function paintAvoidCount() {
  const el = document.getElementById('avoidCount');
  if (!el) return;
  const max = PREFS.AVOID_MAX_LINES || 80;
  const n = state.avoidList.length;
  el.textContent = n ? `${n} / ${max} lines` : `Up to ${max} lines.`;
}

function paintAvoidHints() {
  paintAvoidCount();
  const host = document.getElementById('avoidHints');
  if (!host) return;
  const have = new Set(state.avoidList.map(x => x.toLowerCase()));
  host.textContent = '';
  for (const term of AVOID_HINTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hint-chip';
    b.textContent = term;
    if (have.has(term.toLowerCase())) { b.hidden = true; continue; }
    b.addEventListener('click', () => {
      state.avoidList = PREFS.sanitizeAvoidList([...state.avoidList, term]);
      const ta = document.getElementById('avoidList');
      if (ta) ta.value = state.avoidList.join('\n');
      paintAvoidHints();
      save({ immediate: true });
    });
    host.appendChild(b);
  }
}

function wireCatTools() {
  const filter = document.getElementById('catFilter');
  if (filter && !filter.dataset.wired) {
    filter.dataset.wired = '1';
    filter.addEventListener('input', applyCatFilter);
    filter.addEventListener('keydown', e => {
      if (e.key === 'Escape' && filter.value) {
        filter.value = '';
        applyCatFilter();
        e.preventDefault();
      }
    });
  }
  const clearFilter = document.getElementById('catFilterClear');
  if (clearFilter && !clearFilter.dataset.wired) {
    clearFilter.dataset.wired = '1';
    clearFilter.addEventListener('click', () => {
      const box = document.getElementById('catFilter');
      if (box) box.value = '';
      document.querySelectorAll('.cat-filter').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.filter === 'all'));
      });
      applyCatFilter();
      if (box) box.focus();
    });
  }
  document.querySelectorAll('.cat-filter').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-filter').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      applyCatFilter();
    });
  });
  if (!document.documentElement.dataset.slashFilter) {
    document.documentElement.dataset.slashFilter = '1';
    document.addEventListener('keydown', e => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      const box = document.getElementById('catFilter');
      if (!box) return;
      e.preventDefault();
      box.focus();
    });
  }
}

function renderAll() {
  renderCategories();
  renderPresetCategories();
  renderPresets();
  renderChips('allergens', ALLERGENS.ALLERGENS, state.allergens, (id, on) => toggleIn(state.allergens, id, on));
  renderChips('diets', ALLERGENS.DIETS, state.diets, (id, on) => toggleIn(state.diets, id, on));
  const avoid = document.getElementById('avoidList');
  if (document.activeElement !== avoid) avoid.value = state.avoidList.join('\n');
  paintAvoidHints();
  const fo = document.getElementById('foodOnly');
  if (fo) fo.checked = state.foodOnly;
  markPresetDirty();
}

// Results-page breakdown: the toggle, how much it shows, and how long a hover waits before it opens.
function wireBreakdown() {
  const box = document.getElementById('hoverBreakdown');
  const detail = document.getElementById('breakdownDetail');
  const delay = document.getElementById('breakdownDelayMs');
  const val = document.getElementById('breakdownDelayVal');
  if (!box || !detail || !delay) return;
  const paintDelay = ms => { if (val) val.textContent = `${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s`; };
  const paint = o => {
    const shown = { ...PREFS.sanitizeToggles(o), ...PREFS.sanitizeDisplay(o) };
    box.checked = shown.hoverBreakdown;
    detail.value = shown.breakdownDetail;
    delay.value = String(shown.breakdownDelayMs);
    paintDelay(shown.breakdownDelayMs);
    detail.disabled = delay.disabled = !shown.hoverBreakdown;
  };
  const keys = ['hoverBreakdown', 'breakdownDetail', 'breakdownDelayMs'];
  chrome.storage.local.get(keys, paint);
  chrome.storage.onChanged.addListener(changes => {
    if (keys.some(k => changes[k])) chrome.storage.local.get(keys, paint);
  });
  box.addEventListener('change', () => {
    detail.disabled = delay.disabled = !box.checked;
    persist({ hoverBreakdown: box.checked }, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  });
  detail.addEventListener('change', () =>
    persist(PREFS.sanitizeDisplay({ breakdownDetail: detail.value, breakdownDelayMs: Number(delay.value) }),
      ok => { if (ok) flash(msg('optSaved', 'Saved')); }));
  delay.addEventListener('input', () => paintDelay(Number(delay.value)));
  delay.addEventListener('change', () =>
    persist({ breakdownDelayMs: PREFS.sanitizeDisplay({ breakdownDelayMs: Number(delay.value) }).breakdownDelayMs },
      ok => { if (ok) flash(msg('optSaved', 'Saved')); }));
}

function startSettingsPage() {
  chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
    applyScoring(o);
    if (!PREFS.scoringEqual(o, state)) persist(scoringPayload());
    const match = findMatchingPreset();
    if (match && match[1].category) presetCategory = match[1].category;
    renderAll();
    wireCatTools();
    wireFileActions();
    wireDatabase();
    wireBreakdown();

    document.getElementById('avoidList').addEventListener('input', e => {
      state.avoidList = PREFS.sanitizeAvoidList(e.target.value);
      paintAvoidHints();
      save();
    });
    document.getElementById('avoidList').addEventListener('blur', e => {
      state.avoidList = PREFS.sanitizeAvoidList(e.target.value);
      e.target.value = state.avoidList.join('\n');
      paintAvoidHints();
      save({ immediate: true });
    });

    const fo = document.getElementById('foodOnly');
    if (fo) {
      fo.addEventListener('change', () => {
        state.foodOnly = fo.checked;
        applyScoring(state);
        save({ immediate: true });
      });
    }
  });
}

window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  persist(scoringPayload());
});

// Stay in sync if the popup flips the same keys while this page is open.
chrome.storage.onChanged.addListener(changes => {
  if (writing) return;
  if (changes.foodOnly) {
    state.foodOnly = changes.foodOnly.newValue !== false;
    const fo = document.getElementById('foodOnly');
    if (fo) fo.checked = state.foodOnly;
  }
  if (changes.weights || changes.allergens || changes.diets || changes.avoidList) {
    chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
      applyScoring(o);
      renderAll();
    });
  }
});
