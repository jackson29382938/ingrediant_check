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
const DB_KEYS = ['sheetUrl', 'producersUrl', 'contributeUrl', 'shareContributions', 'sendDiagnostics'];
const SHEET_ORIGINS = ['https://docs.google.com/*'];
const SCRIPT_ORIGINS = ['https://script.google.com/*', 'https://script.googleusercontent.com/*'];
let saveTimer = null;
let writing = false;

function originsForUrl(url) {
  const u = String(url || '').trim();
  const origins = [];
  if (/^https:\/\/docs\.google\.com\//i.test(u)) origins.push(...SHEET_ORIGINS);
  if (/^https:\/\/script\.google\.com\//i.test(u) || /^https:\/\/script\.googleusercontent\.com\//i.test(u)) {
    origins.push(...SCRIPT_ORIGINS);
  }
  return [...new Set(origins)];
}

function requestOrigins(origins, done) {
  if (!origins.length) { done(true); return; }
  if (!chrome.permissions || typeof chrome.permissions.request !== 'function') { done(true); return; }
  chrome.permissions.request({ origins }, granted => {
    done(!chrome.runtime.lastError && !!granted);
  });
}

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

function markUrl(el, ok) {
  if (!el) return;
  el.classList.toggle('invalid', ok === false);
  el.setAttribute('aria-invalid', ok === false ? 'true' : 'false');
}

function readUrlField(id, kind) {
  const el = document.getElementById(id);
  const raw = ((el && el.value) || '').trim();
  if (!raw) { markUrl(el, true); return ''; }
  const ok = kind === 'script' ? !!PREFS.toScriptUrl(raw) : !!PREFS.toSheetUrl(raw);
  markUrl(el, ok);
  if (!ok) return null;
  return kind === 'script' ? PREFS.toScriptUrl(raw) : raw;
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
function renderPresets() {
  const host = document.getElementById('presets');
  host.textContent = '';
  for (const [id, preset] of Object.entries(CATS.PRESETS)) {
    const b = document.createElement('button');
    b.className = 'preset';
    b.type = 'button';
    b.dataset.preset = id;
    b.textContent = preset.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => applyPreset(id));
    b.addEventListener('mouseenter', () => { document.getElementById('presetNote').textContent = preset.note; });
    host.appendChild(b);
  }
}

function applyPreset(id) {
  const preset = CATS.PRESETS[id];
  if (!preset) return;
  applyScoring({ ...state, weights: { ...CATS.DEFAULT_WEIGHTS, ...preset.weights } });
  renderCategories();
  markActivePreset(id);
  document.getElementById('presetNote').textContent = preset.note;
  save({ immediate: true });
}

function markActivePreset(id) {
  document.querySelectorAll('.preset').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.preset === id)));
}

function markPresetDirty() {
  // Once a slider moves, the weights are the user's, not a preset's. Say so rather than leaving a
  // preset highlighted that no longer describes what is set.
  const match = Object.entries(CATS.PRESETS).find(([, p]) => {
    const target = { ...CATS.DEFAULT_WEIGHTS, ...p.weights };
    return Object.keys(target).every(k => Math.abs(weightOf(k) - target[k]) < 0.001);
  });
  markActivePreset(match ? match[0] : null);
  document.getElementById('presetNote').textContent = match ? match[1].note : msg('optCustomWeights', 'Custom weights.');
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
    if (!window.confirm(msg('optResetConfirm', 'Reset weights, warnings, and the avoid list to defaults? Database URLs are left alone.'))) return;
    applyScoring({});
    renderAll();
    save({ immediate: true });
    flash(msg('optResetDone', 'Reset to defaults'));
  });
}

// ---------------------------------------------------------------- shared database
function wireDatabase() {
  chrome.storage.local.get(DB_KEYS, o => {
    const urls = PREFS.sanitizeUrls(o);
    const toggles = PREFS.sanitizeToggles(o);
    const healed = {};
    for (const key of ['sheetUrl', 'producersUrl', 'contributeUrl']) {
      const el = document.getElementById(key);
      if (!el) continue;
      if ((o[key] || '') !== urls[key]) healed[key] = urls[key];
      el.value = urls[key] || '';
      markUrl(el, true);
      el.addEventListener('change', () => {
        const kind = key === 'contributeUrl' ? 'script' : 'sheet';
        const value = readUrlField(key, kind);
        if (value === null) {
          flash(kind === 'script'
            ? 'That has to be an Apps Script /exec URL'
            : 'That has to be a published Google Sheet link', 'error');
          return;
        }
        const persistUrl = () => persist({ [key]: value }, ok => { if (ok) flash(msg('optSaved', 'Saved')); });
        if (!value) { persistUrl(); return; }
        requestOrigins(originsForUrl(value), ok => {
          if (!ok) {
            flash('Chrome blocked access to that host — the lookup cannot run', 'error');
            return;
          }
          persistUrl();
        });
      });
    }
    if (o.shareContributions === true && !toggles.shareContributions) healed.shareContributions = false;
    if (o.sendDiagnostics === true && !toggles.sendDiagnostics) healed.sendDiagnostics = false;
    if (Object.keys(healed).length) persist(healed);

    const share = document.getElementById('shareContributions');
    if (share) {
      share.checked = toggles.shareContributions;
      share.addEventListener('change', () => {
        if (!share.checked) {
          persist({ shareContributions: false });
          return;
        }
        const url = readUrlField('contributeUrl', 'script');
        if (url === null || !url) {
          share.checked = false;
          flash('Set a valid contribution URL first', 'error');
          return;
        }
        requestOrigins(originsForUrl(url), ok => {
          if (!ok) {
            share.checked = false;
            flash('Permission needed to send contributions', 'error');
            return;
          }
          persist({ shareContributions: true, contributeUrl: url }, saved => { if (saved) flash(msg('optSaved', 'Saved')); });
        });
      });
    }

    const diag = document.getElementById('sendDiagnostics');
    const diagStatus = document.getElementById('diagStatus');
    const paintDiag = () => {
      if (!diagStatus) return;
      chrome.runtime.sendMessage({ type: 'diagnosticsStatus' }, res => {
        if (chrome.runtime.lastError || !res) return;
        diagStatus.textContent = !res.configured ? 'No contribution URL set'
          : res.queued ? `${res.queued} row${res.queued === 1 ? '' : 's'} waiting to send`
          : 'Nothing queued';
      });
    };
    if (diag) {
      diag.checked = toggles.sendDiagnostics;
      diag.addEventListener('change', () => {
        if (!diag.checked) { persist({ sendDiagnostics: false }, paintDiag); return; }
        const url = readUrlField('contributeUrl', 'script');
        if (url === null || !url) {
          diag.checked = false;
          flash('Set a valid contribution URL first', 'error');
          return;
        }
        requestOrigins(originsForUrl(url), ok => {
          if (!ok) { diag.checked = false; flash('Permission needed to send diagnostics', 'error'); return; }
          persist({ sendDiagnostics: true, contributeUrl: url }, saved => {
            if (saved) flash(msg('optSaved', 'Saved'));
            paintDiag();
          });
        });
      });
      paintDiag();
    }
    const flushBtn = document.getElementById('flushDiagnostics');
    if (flushBtn) {
      flushBtn.addEventListener('click', () => {
        diagStatus.textContent = 'Sending…';
        chrome.runtime.sendMessage({ type: 'flushDiagnostics' }, res => {
          if (chrome.runtime.lastError || !res) { diagStatus.textContent = 'Could not reach the endpoint'; return; }
          diagStatus.textContent = res.ok ? `Sent ${res.sent} rows`
            : res.reason === 'nothing-to-send' ? 'Nothing queued'
            : `Could not send — ${res.reason} (${res.queued || 0} still queued)`;
        });
      });
    }

    const btn = document.getElementById('refreshSheet');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const status = document.getElementById('sheetStatus');
      const urls = ['sheetUrl', 'producersUrl']
        .map(id => readUrlField(id, 'sheet'))
        .filter(v => v);
      if (['sheetUrl', 'producersUrl'].some(id => readUrlField(id, 'sheet') === null)) {
        status.textContent = 'Fix the highlighted URL first';
        return;
      }
      requestOrigins([...new Set(urls.flatMap(originsForUrl))], ok => {
        if (!ok) { status.textContent = 'Permission needed to read the sheet'; return; }
        status.textContent = 'Fetching…';
        chrome.runtime.sendMessage({ type: 'refreshSheet' }, res => {
          if (chrome.runtime.lastError || !res) { status.textContent = 'Could not reach the sheet'; return; }
          status.textContent = res.ok
            ? `Loaded ${res.count} product records and ${res.producers || 0} producers`
            : 'No usable rows found';
        });
      });
    });
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
  renderChips('allergens', ALLERGENS.ALLERGENS, state.allergens, (id, on) => toggleIn(state.allergens, id, on));
  renderChips('diets', ALLERGENS.DIETS, state.diets, (id, on) => toggleIn(state.diets, id, on));
  const avoid = document.getElementById('avoidList');
  if (document.activeElement !== avoid) avoid.value = state.avoidList.join('\n');
  paintAvoidHints();
  const fo = document.getElementById('foodOnly');
  if (fo) fo.checked = state.foodOnly;
  markPresetDirty();
}

chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
  applyScoring(o);
  if (!PREFS.scoringEqual(o, state)) persist(scoringPayload());
  renderPresets();
  renderAll();
  wireCatTools();
  wireFileActions();
  wireDatabase();

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
  for (const key of ['sheetUrl', 'producersUrl', 'contributeUrl']) {
    if (!changes[key]) continue;
    const el = document.getElementById(key);
    if (!el || document.activeElement === el) continue;
    el.value = changes[key].newValue || '';
    markUrl(el, true);
  }
});
