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
  return (out || fallback).replace('$1', sub != null ? String(sub) : '$1');
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
let saveTimer = null;
let writing = false;
let restoringSettings = false;
let settingsReady = false;
let pendingWrites = 0;
const restoreWaiters = [];

// A restore must follow pending local saves and suppress old scoring writes until reload.
AIR.settingsRestore = {
  begin() {
    restoringSettings = true;
    clearTimeout(saveTimer);
    return new Promise(resolve => {
      if (!pendingWrites) resolve();
      else restoreWaiters.push(resolve);
    });
  },
  complete() { restoringSettings = false; },
};

function flash(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (kind === 'error' ? ' error' : '');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 2800);
}

function persist(values, done) {
  pendingWrites++;
  writing = true;
  // Which settings changed, for "Report a problem"'s recent actions (names and short values only).
  if (AIR.db.activity) {
    AIR.db.activity.log('settings', Object.entries(values || {}).map(([k, v]) =>
      (typeof v === 'object' ? k : `${k}=${String(v).slice(0, 20)}`)).join(', '));
  }
  chrome.storage.local.set(values, () => {
    pendingWrites--;
    writing = pendingWrites > 0;
    if (!pendingWrites) restoreWaiters.splice(0).forEach(resolve => resolve());
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
  if (restoringSettings) return;
  clearTimeout(saveTimer);
  const write = () => persist(scoringPayload(), ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}

function applyScoring(next) {
  const clean = PREFS.sanitizeScoring(next);
  state.weights = clean.weights;
  state.goals = clean.goals;
  state.goalImportance = clean.goalImportance;
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
    const baseline = document.createElement('div');
    baseline.className = 'help baseline';
    baseline.textContent = `${msg('optBalancedDefault', 'Balanced default')}: ${CATS.DEFAULT_WEIGHTS[c.id]}`;
    label.append(name, baseline, help);

    const slider = document.createElement('input');
    slider.type = 'range';
    // Signed categories go below zero: a goal can make them count in a product's favour.
    slider.min = CATS.SIGNED && CATS.SIGNED.has(c.id) ? '-2' : '0'; slider.max = '2'; slider.step = 'any';
    slider.value = String(weightOf(c.id));
    slider.id = `w-${c.id}`;
    slider.setAttribute('aria-label', `${c.label} weight`);

    const val = document.createElement('div');
    val.className = 'val';
    const paint = v => {
      const n = Number(v);
      const shown = Math.abs(n).toLocaleString('en', {maximumFractionDigits:3});
      val.textContent = n === 0 ? 'off' : n < 0 ? `+${shown}× plus` : `${shown}×`;
      val.className = 'val' + (n === 0 ? ' zero' : n < 0 ? ' plus' : n > 1 ? ' high' : '');
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

// { ids, custom } — the selected goals, and whether a slider has since moved off them.
function currentGoals() {
  return CATS.describeGoals(state.weights, state.goals, state.goalImportance);
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
    // "Goals · 2": how many selected goals a tab holds, so goals picked on other tabs stay visible.
    const picks = currentGoals().ids.filter(g => CATS.PRESETS[g] && (CATS.PRESETS[g].category || 'everyday') === cat.id).length;
    b.textContent = picks ? `${cat.label} · ${picks}` : cat.label;
    b.classList.toggle('has-picks', picks > 0);
    b.addEventListener('click', () => {
      presetCategory = cat.id;
      const grid = document.getElementById('presets');
      if (grid) grid.dataset.userTab = '1';
      renderPresetCategories();
      renderPresets();
    });
    host.appendChild(b);
  }
  paintTabs(host, document.getElementById('presets'));
  const blurb = document.getElementById('presetCatBlurb');
  const active = presetCategories().find(c => c.id === presetCategory);
  if (blurb) blurb.textContent = (active && active.blurb) || '';
}

function renderPresets() {
  const host = document.getElementById('presets');
  if (!host) return;
  host.textContent = '';
  const goals = currentGoals();
  const matchId = goals.ids[0] || (goals.custom ? null : 'balanced');
  if (matchId && CATS.PRESETS[matchId] && CATS.PRESETS[matchId].category && !host.dataset.userTab) {
    presetCategory = CATS.PRESETS[matchId].category;
  }

  const entries = presetList().filter(([, p]) => (p.category || 'everyday') === presetCategory);
  for (const [id, preset] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-card';
    b.dataset.preset = id;
    b.setAttribute('aria-pressed', String(goals.ids.includes(id) || (id === 'balanced' && !goals.ids.length && !goals.custom)));
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

  paintPresetActive(goals);
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

function paintPresetActive(goals) {
  const name = document.getElementById('presetActiveName');
  if (!name) return;
  const label = CATS.goalsLabel(goals.ids);
  name.textContent = goals.custom
    ? `${msg('optPresetCustomLabel', 'Custom')}${goals.ids.length ? ` (${label})` : ''}`
    : label;
  name.classList.toggle('is-custom', goals.custom);
}

// A goal card toggles that goal; the weights become the average of everything selected.
function applyPreset(id) {
  if (!CATS.PRESETS[id]) return;
  const goals = CATS.toggleGoal(currentGoals().ids, id);
  applyScoring({ ...state, goals, weights: CATS.goalWeights(goals, state.goalImportance) });
  // Goals combine across tabs: stay on the tab that was clicked instead of jumping to the first
  // selected goal's tab, which hid the goal just picked.
  const host = document.getElementById('presets');
  presetCategory = CATS.PRESETS[id].category || presetCategory;
  if (host) host.dataset.userTab = '1';
  renderCategories();
  renderPresetCategories();
  renderPresets();
  renderGoalMix();
  showPresetDetail(id);
  save({ immediate: true });
}

// One slider per selected goal, shown once two or more are picked: how much that goal counts where
// goals set the same dial. 1 each is a plain average; moving one re-averages the weights.
function renderGoalMix() {
  const box = document.getElementById('goalMix');
  const rows = document.getElementById('goalMixRows');
  if (!box || !rows) return;
  const goals = currentGoals();
  const ids = goals.ids.filter(id => CATS.PRESETS[id]);
  box.hidden = ids.length < 2 || goals.custom;
  if (box.hidden) { rows.textContent = ''; delete rows.dataset.ids; return; }
  // The same goals: update the values in place, so a save while a slider is being dragged does not
  // rebuild it under the pointer.
  if (rows.dataset.ids === ids.join(',')) {
    for (const input of rows.querySelectorAll('input[data-goal-mix]')) {
      if (input === document.activeElement) continue;
      const v = (state.goalImportance && state.goalImportance[input.dataset.goalMix]) || 1;
      input.value = String(v);
      input.nextElementSibling.textContent = `×${v}`;
    }
    return;
  }
  rows.dataset.ids = ids.join(',');
  rows.textContent = '';
  for (const id of ids) {
    const label = CATS.PRESETS[id].label;
    const value = (state.goalImportance && state.goalImportance[id]) || 1;
    const row = document.createElement('div');
    row.className = 'goal-mix-row';
    const name = document.createElement('label');
    name.htmlFor = `goalMix-${id}`;
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `goalMix-${id}`;
    input.dataset.goalMix = id;
    input.min = String(CATS.IMPORTANCE_MIN);
    input.max = String(CATS.IMPORTANCE_MAX);
    input.step = '0.01';
    input.value = String(value);
    input.setAttribute('aria-label', msg('optGoalMixAria', `How much ${label} counts`, label));
    const out = document.createElement('output');
    out.htmlFor = input.id;
    out.textContent = `×${value}`;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = `×${v}`;
      const imp = { ...(state.goalImportance || {}), [id]: v };
      applyScoring({ ...state, goalImportance: imp, weights: CATS.goalWeights(currentGoals().ids, imp) });
      renderCategories();
      markPresetDirty();
      save();
    });
    row.append(name, input, out);
    rows.appendChild(row);
  }
}

function markActivePreset(goals) {
  document.querySelectorAll('.preset-card').forEach(b => b.setAttribute('aria-pressed', String(
    goals.ids.includes(b.dataset.preset) || (b.dataset.preset === 'balanced' && !goals.ids.length && !goals.custom))));
}

function markPresetDirty() {
  // Once a slider moves, the weights are the user's, not a preset's. Say so rather than leaving a
  // preset highlighted that no longer describes what is set.
  const goals = currentGoals();
  const match = goals.custom ? null : [goals.ids.at(-1) || 'balanced'];
  markActivePreset(goals);
  paintPresetActive(goals);
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
  // Every setting, as stored: the same set a Chrome or Google backup carries (not the master switch).
  document.getElementById('export').addEventListener('click', () => {
    chrome.storage.local.get(PREFS.SETTING_KEYS, stored => {
      const blob = new Blob([JSON.stringify(PREFS.backupPayload({ ...stored, ...scoringPayload() }), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ingredient-check-settings.json';
      a.click();
      // Revoking at once can cancel the download before Chrome has read the blob.
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      flash(msg('optExported', 'Exported'));
    });
  });

  const file = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => file.click());
  // A settings export is a few kilobytes; a large file is the wrong file, and parsing it would hang.
  const IMPORT_MAX_BYTES = 1024 * 1024;
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    try {
      if (f.size > IMPORT_MAX_BYTES) {
        flash(msg('optNotExport', 'That file is not an Ingredient Check settings export'), 'error');
        return;
      }
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
      // Everything else the file holds (switches, sort, speed, display); the controls follow storage.
      const scoringKeys = Object.keys(PREFS.sanitizeScoring({}));
      const rest = Object.fromEntries(Object.entries(parsed.values || {}).filter(([k]) => !scoringKeys.includes(k)));
      if (Object.keys(rest).length) persist(rest);
      flash(msg('optImported', 'Imported'));
    } catch (e) {
      flash(msg('optImportFailed', 'That file could not be read'), 'error');
    } finally {
      // Always cleared, so choosing the same file again after a failed import tries it again.
      file.value = '';
    }
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
const AVOID_HINTS = PREFS.AVOID_HINTS;

function paintAvoidCount() {
  const el = document.getElementById('avoidCount');
  if (!el) return;
  const max = PREFS.AVOID_MAX_LINES || 80;
  const n = state.avoidList.length;
  el.textContent = n ? `${n} / ${max} entries` : `Up to ${max} entries.`;
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
      if (ta) ta.value = state.avoidList.join(', ');
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
  renderGoalMix();
  renderChips('allergens', ALLERGENS.ALLERGENS, state.allergens, (id, on) => toggleIn(state.allergens, id, on));
  renderChips('diets', ALLERGENS.DIETS, state.diets, (id, on) => toggleIn(state.diets, id, on));
  const avoid = document.getElementById('avoidList');
  if (document.activeElement !== avoid) avoid.value = state.avoidList.join(', ');
  paintAvoidHints();
  const fo = document.getElementById('foodOnly');
  if (fo) fo.checked = state.foodOnly;
  markPresetDirty();
}

// A checkbox for one of the popup's toggles (prefs.TOGGLE_DEFAULTS). It shows the stored value,
// follows the popup if that flips it while this page is open, and saves on change. `onPaint` runs
// with the value whenever it is shown or changed, for controls that depend on it.
function bindToggle(id, onPaint) {
  const box = document.getElementById(id);
  if (!box) return null;
  const show = on => { box.checked = on; if (onPaint) onPaint(on); };
  const read = () => chrome.storage.local.get(id, o => show(PREFS.sanitizeToggles(o)[id]));
  read();
  chrome.storage.onChanged.addListener(changes => { if (changes[id]) read(); });
  box.addEventListener('change', () => {
    if (onPaint) onPaint(box.checked);
    persist({ [id]: box.checked }, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  });
  return box;
}

// "Amazon access" names the stores from the manifest, so the list cannot drift from what Chrome
// actually granted. "*://*.amazon.co.uk/*" -> "amazon.co.uk".
function amazonStores(manifest) {
  return ((manifest && manifest.host_permissions) || [])
    .map(p => (String(p).match(/^\*:\/\/\*\.(amazon\.[a-z.]+)\/\*$/) || [])[1])
    .filter(Boolean);
}

// Results pages: the two options that request product pages from Amazon, and which stores it can
// reach. They are in the popup too; they are here so the explanation sits next to the switch.
function wireSearchScoring() {
  bindToggle('autoScoreSearch');
  bindToggle('hoverScore');
  const list = document.getElementById('amazonStores');
  let stores = [];
  try { stores = amazonStores(chrome.runtime.getManifest()); } catch (e) { /* not an extension page */ }
  if (list && stores.length) list.textContent = stores.join(', ');
}

// Sort results by score (src/content/sort.js): what to do with unscored listings, and load more.
// Saved on change, bounded by sortedResults.sanitizeSort, followed if another page changes them.
function wireSort() {
  const R = AIR.db.sortedResults;
  const count = document.getElementById('sortCount');
  const more = document.getElementById('sortLoadMore');
  const radios = [...document.querySelectorAll('input[name="sortMissing"]')];
  const depth = document.getElementById('sortDepth');
  const limit = document.getElementById('sortTimeLimit');
  if (!R || !count || !more || !radios.length || !depth || !limit) return;
  const keys = Object.keys(R.SORT_DEFAULTS);

  // "How much to load" is the same two settings as the checkbox and number below it, as one choice.
  const DEPTHS = [100, 200, 300, 500];
  const option = (select, value, text) => select.appendChild(new Option(text, value));
  option(depth, 'page', msg('optSortDepthPage', 'Just this page (about 48 products)'));
  for (const n of DEPTHS) option(depth, String(n), msg('optSortDepthN', 'About $1 products', n));
  const custom = new Option(msg('optSortDepthCustom', 'Custom (set below)'), 'custom');
  custom.hidden = true;
  depth.appendChild(custom);
  for (const s of R.TIME_LIMITS) {
    option(limit, String(s), !s ? msg('optSortTimeNone', 'No limit')
      : s < 120 ? msg('optSortSeconds', '$1 seconds', s) : msg('optSortMinutes', '$1 minutes', s / 60));
  }

  const paint = o => {
    const v = R.sanitizeSort(o);
    radios.forEach(r => { r.checked = r.value === v.sortMissing; });
    more.checked = v.sortLoadMore;
    count.value = String(v.sortCount);
    count.disabled = !v.sortLoadMore;
    depth.value = !v.sortLoadMore ? 'page' : DEPTHS.includes(v.sortCount) ? String(v.sortCount) : 'custom';
    custom.hidden = depth.value !== 'custom';
    limit.value = String(v.sortTimeLimit);
  };
  const save = (over = {}) => {
    const v = R.sanitizeSort({
      sortMissing: (radios.find(r => r.checked) || {}).value,
      sortLoadMore: more.checked,
      sortCount: count.value,
      sortTimeLimit: limit.value,
      ...over,
    });
    paint(v);
    persist(v, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  };
  chrome.storage.local.get(keys, paint);
  chrome.storage.onChanged.addListener(changes => {
    if (keys.some(k => changes[k])) chrome.storage.local.get(keys, paint);
  });
  radios.forEach(r => r.addEventListener('change', () => save()));
  more.addEventListener('change', () => save());
  count.addEventListener('change', () => save());
  limit.addEventListener('change', () => save());
  depth.addEventListener('change', () => {
    if (depth.value === 'custom') return;
    // Just this page keeps the count, so choosing a depth again starts from it.
    save(depth.value === 'page' ? { sortLoadMore: false } : { sortLoadMore: true, sortCount: Number(depth.value) });
  });

  // Price per ounce: the on/off switch (also in the popup) and what to do without Amazon's unit price.
  const U = AIR.db.unitPrice;
  const unitRadios = [...document.querySelectorAll('input[name="unitMissing"]')];
  if (U && unitRadios.length) {
    const paintUnit = o => {
      const v = U.sanitizeUnit(o);
      unitRadios.forEach(r => { r.checked = r.value === v.unitMissing; });
    };
    bindToggle('unitPrice', on => unitRadios.forEach(r => { r.disabled = !on; }));
    chrome.storage.local.get('unitMissing', paintUnit);
    chrome.storage.onChanged.addListener(changes => { if (changes.unitMissing) paintUnit({ unitMissing: changes.unitMissing.newValue }); });
    unitRadios.forEach(r => r.addEventListener('change', () => {
      const v = U.sanitizeUnit({ unitMissing: (unitRadios.find(x => x.checked) || {}).value });
      persist(v, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
    }));
  }
}

// Speed and freshness (AIR.db.speed): five steps, Balanced by default.
function wireSpeed() {
  const SP = AIR.db.speed;
  const radios = [...document.querySelectorAll('input[name="speedMode"]')];
  if (!SP || !radios.length) return;
  const paint = o => {
    const { speedMode } = SP.sanitizeSpeed(o);
    radios.forEach(r => { r.checked = r.value === speedMode; });
  };
  chrome.storage.local.get('speedMode', paint);
  chrome.storage.onChanged.addListener(changes => { if (changes.speedMode) paint({ speedMode: changes.speedMode.newValue }); });
  radios.forEach(r => r.addEventListener('change', () => {
    const v = SP.sanitizeSpeed({ speedMode: (radios.find(x => x.checked) || {}).value });
    persist(v, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  }));

  // How fast product pages are requested: its own choice, beside how long scores are kept.
  const paces = [...document.querySelectorAll('input[name="ratePace"]')];
  const paintPace = o => { const { ratePace } = SP.sanitizePace(o); paces.forEach(r => { r.checked = r.value === ratePace; }); };
  chrome.storage.local.get('ratePace', paintPace);
  chrome.storage.onChanged.addListener(changes => { if (changes.ratePace) paintPace({ ratePace: changes.ratePace.newValue }); });
  paces.forEach(r => r.addEventListener('change', () => {
    persist(SP.sanitizePace({ ratePace: (paces.find(x => x.checked) || {}).value }), ok => { if (ok) flash(msg('optSaved', 'Saved')); });
  }));
}

// Results-page breakdown: the toggle, how much it shows, and how long a hover waits before it opens.
function wireBreakdown() {
  const detail = document.getElementById('breakdownDetail');
  const delay = document.getElementById('breakdownDelayMs');
  const val = document.getElementById('breakdownDelayVal');
  if (!document.getElementById('hoverBreakdown') || !detail || !delay) return;
  const paintDelay = ms => { if (val) val.textContent = `${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s`; };
  bindToggle('hoverBreakdown', on => { detail.disabled = delay.disabled = !on; });
  const paint = o => {
    const shown = PREFS.sanitizeDisplay(o);
    detail.value = shown.breakdownDetail;
    delay.value = String(shown.breakdownDelayMs);
    paintDelay(shown.breakdownDelayMs);
  };
  const keys = ['breakdownDetail', 'breakdownDelayMs'];
  chrome.storage.local.get(keys, paint);
  chrome.storage.onChanged.addListener(changes => {
    if (keys.some(k => changes[k])) chrome.storage.local.get(keys, paint);
  });
  // Only this section's own keys: sanitizeDisplay returns every display key, defaults included.
  detail.addEventListener('change', () =>
    persist({ breakdownDetail: PREFS.sanitizeDisplay({ breakdownDetail: detail.value }).breakdownDetail },
      ok => { if (ok) flash(msg('optSaved', 'Saved')); }));
  delay.addEventListener('input', () => paintDelay(Number(delay.value)));
  delay.addEventListener('change', () =>
    persist({ breakdownDelayMs: PREFS.sanitizeDisplay({ breakdownDelayMs: Number(delay.value) }).breakdownDelayMs },
      ok => { if (ok) flash(msg('optSaved', 'Saved')); }));
}

// How many settings to show (PREFS.LEVELS). Elements carry data-level="N": the first level that
// shows them. Hidden only with a class, so the `hidden` attribute other code toggles is untouched.
function applyLevel(level) {
  const at = Math.max(0, PREFS.LEVELS.indexOf(level));
  for (const el of document.querySelectorAll('[data-level]')) {
    el.classList.toggle('lvl-hidden', Number(el.dataset.level) > at);
  }
  for (const r of document.querySelectorAll('input[name="settingsLevel"]')) r.checked = r.value === PREFS.LEVELS[at];
}

// The picker. The first load writes the level back, so it is stored from then on.
function wireLevel() {
  chrome.storage.local.get(['settingsLevel', 'onboarded'], o => {
    const stored = PREFS.levelOf(o);
    if (stored !== o.settingsLevel) persist({ settingsLevel: stored });
    applyLevel(stored);
  });
  chrome.storage.onChanged.addListener(changes => {
    if (changes.settingsLevel) applyLevel(PREFS.sanitizeDisplay({ settingsLevel: changes.settingsLevel.newValue }).settingsLevel);
  });
  for (const r of document.querySelectorAll('input[name="settingsLevel"]')) {
    r.addEventListener('change', () => {
      applyLevel(r.value);
      persist({ settingsLevel: r.value }, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
    });
  }
}

// Product-page panel and the wait before Score on hover starts.
function wirePanelAndHover() {
  bindToggle('panelOpen');
  bindToggle('sortRemember');
  const delay = document.getElementById('scoreHoverDelayMs');
  const val = document.getElementById('scoreHoverDelayVal');
  if (!delay) return;
  const paint = ms => { if (val) val.textContent = `${(ms / 1000).toFixed(1)} s`; };
  const show = o => { const ms = PREFS.sanitizeDisplay(o).scoreHoverDelayMs; delay.value = String(ms); paint(ms); };
  chrome.storage.local.get('scoreHoverDelayMs', show);
  chrome.storage.onChanged.addListener(changes => {
    if (changes.scoreHoverDelayMs) show({ scoreHoverDelayMs: changes.scoreHoverDelayMs.newValue });
  });
  delay.addEventListener('input', () => paint(Number(delay.value)));
  delay.addEventListener('change', () =>
    persist({ scoreHoverDelayMs: PREFS.sanitizeDisplay({ scoreHoverDelayMs: Number(delay.value) }).scoreHoverDelayMs },
      ok => { if (ok) flash(msg('optSaved', 'Saved')); }));
}

// The keyboard shortcuts for the sorted list. Chrome owns the keys (chrome://extensions/shortcuts);
// this shows what they are now and opens that page. Repainted when the reader returns to this tab.
function wireShortcuts() {
  const list = document.getElementById('shortcutList');
  const change = document.getElementById('changeShortcuts');
  if (!list || !chrome.commands || typeof chrome.commands.getAll !== 'function') return;
  const labels = { 'sort-health': msg('optShortcutHealth', 'Sort by Ingredient Check score'),
    'sort-price': msg('optShortcutPrice', 'Sort by price per ounce') };
  const paint = () => chrome.commands.getAll(all => {
    list.textContent = '';
    for (const c of all || []) {
      if (!labels[c.name]) continue;
      const li = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = labels[c.name];
      li.append(name, document.createTextNode(' '));
      if (c.shortcut) { const k = document.createElement('kbd'); k.textContent = c.shortcut; li.append(k); }
      else li.append(document.createTextNode(msg('optShortcutNone', 'not set')));
      list.append(li);
    }
  });
  paint();
  window.addEventListener('focus', paint);
  if (change) change.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
}

// Called from settings-database.js, the options page's second classic script, once it has loaded.
/* exported startSettingsPage */
function startSettingsPage() {
  chrome.storage.local.get(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
    if (chrome.runtime.lastError) {
      document.getElementById('status').textContent = 'Could not load your settings. Reload this page before making changes.';
      document.getElementById('status').className = 'status error';
      return;
    }
    settingsReady = true;
    applyScoring(o);
    if (!PREFS.scoringEqual(o, state)) persist(scoringPayload());
    const first = currentGoals().ids[0];
    if (first && CATS.PRESETS[first].category) presetCategory = CATS.PRESETS[first].category;
    renderAll();
    wireCatTools();
    wireFileActions();
    wireDatabase();
    wireSearchScoring();
    wireSort();
    wireSpeed();
    wireBreakdown();
    wirePanelAndHover();
    wireShortcuts();
    wireLevel();

    document.getElementById('avoidList').addEventListener('input', e => {
      state.avoidList = PREFS.sanitizeAvoidList(e.target.value);
      paintAvoidHints();
      save();
    });
    document.getElementById('avoidList').addEventListener('blur', e => {
      state.avoidList = PREFS.sanitizeAvoidList(e.target.value);
      e.target.value = state.avoidList.join(', ');
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
  if (settingsReady && !restoringSettings) persist(scoringPayload());
});

// Stay in sync if the popup flips the same keys while this page is open.
chrome.storage.onChanged.addListener(changes => {
  if (writing) return;
  if (changes.foodOnly) {
    state.foodOnly = changes.foodOnly.newValue !== false;
    const fo = document.getElementById('foodOnly');
    if (fo) fo.checked = state.foodOnly;
  }
  if (changes.weights || changes.goals || changes.goalImportance || changes.allergens || changes.diets || changes.avoidList) {
    chrome.storage.local.get(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
      applyScoring(o);
      renderAll();
    });
  }
});
