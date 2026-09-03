// Settings page.
//
// Renders one slider per scoring category, straight from the taxonomy in engine/categories.js, so
// adding a category to the engine adds it here with no UI work. Writes go straight to
// chrome.storage.local; the content script watches for changes, drops its cache and rescores, since
// a cached number computed under different weights is simply wrong.

const CATS = AIR.db.categories;
const ALLERGENS = AIR.db.allergens;

const state = { weights: {}, allergens: [], diets: [], avoidList: [], foodOnly: true };
const DB_KEYS = ['sheetUrl', 'producersUrl', 'contributeUrl', 'shareContributions', 'sendDiagnostics'];
const SHEET_ORIGINS = ['https://docs.google.com/*'];
const SCRIPT_ORIGINS = ['https://script.google.com/*', 'https://script.googleusercontent.com/*'];
let saveTimer = null;

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

function flash(msg) {
  const el = document.getElementById('status');
  el.textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.textContent = ''; }, 2200);
}

function save({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  const write = () => chrome.storage.local.set({
    weights: state.weights,
    allergens: state.allergens,
    diets: state.diets,
    avoidList: state.avoidList,
    foodOnly: state.foodOnly,
  }, () => flash('Saved'));
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}

// ---------------------------------------------------------------- categories
function weightOf(id) {
  return id in state.weights ? state.weights[id] : CATS.DEFAULT_WEIGHTS[id];
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
      h.textContent = c.group;
      h.style.cssText = 'margin:22px 0 8px;padding-top:14px;border-top:2px solid #eaeded';
      if (!host.children.length) h.style.cssText = 'margin:0 0 8px';
      host.appendChild(h);
    }

    const row = document.createElement('div');
    row.className = 'cat';

    const label = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.label;
    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = c.help;
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
      paint(v);
      markPresetDirty();
      save();
    });

    row.append(label, slider, val);
    host.appendChild(row);
  }
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
  state.weights = { ...CATS.DEFAULT_WEIGHTS, ...preset.weights };
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
  document.getElementById('presetNote').textContent = match ? match[1].note : 'Custom weights.';
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
  save();
}

// ---------------------------------------------------------------- import / export
function wireFileActions() {
  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({
      _format: 'ingredient-check-settings', _version: 1,
      weights: state.weights, allergens: state.allergens,
      diets: state.diets, avoidList: state.avoidList,
      foodOnly: state.foodOnly,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ingredient-check-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flash('Exported');
  });

  const file = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      // Validate rather than trust: a hand-edited or wrong file should not silently corrupt scoring.
      state.weights = CATS.resolveWeights(parsed.weights);
      state.allergens = Array.isArray(parsed.allergens) ? parsed.allergens : [];
      state.diets = Array.isArray(parsed.diets) ? parsed.diets : [];
      state.avoidList = Array.isArray(parsed.avoidList) ? parsed.avoidList : [];
      state.foodOnly = parsed.foodOnly !== false;
      renderAll();
      save({ immediate: true });
      flash('Imported');
    } catch (e) {
      flash('That file could not be read');
    }
    file.value = '';
  });

  document.getElementById('reset').addEventListener('click', () => {
    state.weights = { ...CATS.DEFAULT_WEIGHTS };
    state.allergens = []; state.diets = []; state.avoidList = [];
    state.foodOnly = true;
    renderAll();
    save({ immediate: true });
    flash('Reset to defaults');
  });
}

// ---------------------------------------------------------------- shared database
function wireDatabase() {
  chrome.storage.local.get(DB_KEYS, o => {
    for (const key of ['sheetUrl', 'producersUrl', 'contributeUrl']) {
      const el = document.getElementById(key);
      if (!el) continue;
      el.value = o[key] || '';
      el.addEventListener('change', () => {
        const value = el.value.trim();
        const persist = () => chrome.storage.local.set({ [key]: value }, () => flash('Saved'));
        if (!value) { persist(); return; }
        requestOrigins(originsForUrl(value), ok => {
          if (!ok) {
            flash('Chrome blocked access to that host — the lookup cannot run');
            return;
          }
          persist();
        });
      });
    }
    const share = document.getElementById('shareContributions');
    if (share) {
      share.checked = o.shareContributions === true;
      share.addEventListener('change', () => {
        if (!share.checked) {
          chrome.storage.local.set({ shareContributions: false });
          return;
        }
        const url = (document.getElementById('contributeUrl') || {}).value;
        requestOrigins(originsForUrl(url), ok => {
          if (!ok) {
            share.checked = false;
            flash('Permission needed to send contributions');
            return;
          }
          chrome.storage.local.set({ shareContributions: true }, () => flash('Saved'));
        });
      });
    }
  });

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
    chrome.storage.local.get('sendDiagnostics', o => { diag.checked = o.sendDiagnostics === true; });
    diag.addEventListener('change', () => {
      // Shares the contribution endpoint, so it needs the same host grant.
      if (!diag.checked) { chrome.storage.local.set({ sendDiagnostics: false }, paintDiag); return; }
      const url = (document.getElementById('contributeUrl') || {}).value;
      requestOrigins(originsForUrl(url), ok => {
        if (!ok) { diag.checked = false; flash('Permission needed to send diagnostics'); return; }
        chrome.storage.local.set({ sendDiagnostics: true }, () => { flash('Saved'); paintDiag(); });
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
      .map(id => (document.getElementById(id) || {}).value)
      .filter(Boolean)
      .map(v => String(v).trim());
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
}

// ---------------------------------------------------------------- boot
function renderAll() {
  renderCategories();
  renderChips('allergens', ALLERGENS.ALLERGENS, state.allergens, (id, on) => toggleIn(state.allergens, id, on));
  renderChips('diets', ALLERGENS.DIETS, state.diets, (id, on) => toggleIn(state.diets, id, on));
  document.getElementById('avoidList').value = state.avoidList.join('\n');
  const fo = document.getElementById('foodOnly');
  if (fo) fo.checked = state.foodOnly;
  markPresetDirty();
}

chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
  state.weights = CATS.resolveWeights(o.weights);
  state.allergens = Array.isArray(o.allergens) ? o.allergens : [];
  state.diets = Array.isArray(o.diets) ? o.diets : [];
  state.avoidList = Array.isArray(o.avoidList) ? o.avoidList : [];
  state.foodOnly = o.foodOnly !== false;
  renderPresets();
  renderAll();
  wireFileActions();
  wireDatabase();

  document.getElementById('avoidList').addEventListener('input', e => {
    state.avoidList = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
    save();
  });

  const fo = document.getElementById('foodOnly');
  if (fo) {
    fo.addEventListener('change', () => {
      state.foodOnly = fo.checked;
      save({ immediate: true });
    });
  }
});

// Stay in sync if the popup flips the same keys while this page is open.
chrome.storage.onChanged.addListener(changes => {
  if (changes.foodOnly) {
    state.foodOnly = changes.foodOnly.newValue !== false;
    const fo = document.getElementById('foodOnly');
    if (fo) fo.checked = state.foodOnly;
  }
  if (changes.weights || changes.allergens || changes.diets || changes.avoidList) {
    chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList'], o => {
      if (changes.weights) state.weights = CATS.resolveWeights(o.weights);
      if (changes.allergens) state.allergens = Array.isArray(o.allergens) ? o.allergens : [];
      if (changes.diets) state.diets = Array.isArray(o.diets) ? o.diets : [];
      if (changes.avoidList) state.avoidList = Array.isArray(o.avoidList) ? o.avoidList : [];
      renderAll();
    });
  }
});
