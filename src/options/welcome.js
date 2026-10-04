// First-run setup: how much to configure, then goals, warnings, an avoid list and four fetch choices,
// in about a minute. The first answer decides which of the later steps are asked at all. Opened
// on install (background.js) and from "Run setup again" in the popup and settings. It starts from
// what is already stored, and writes everything through the same sanitizers as the settings page.

const CATS = AIR.db.categories;
const ALLERGENS = AIR.db.allergens;
const PREFS = AIR.db.prefs;
const OFF_PERMISSION = { origins: ['https://world.openfoodfacts.org/*'] };
const AVOID_HINTS = ['carrageenan', 'red 40', 'natural flavors', 'sucralose', 'aspartame',
  'palm oil', 'canola oil', 'high fructose corn syrup', 'titanium dioxide', 'msg'];
const OPTIONS = ['autoScoreSearch', 'sharedCache', 'ocrLabels', 'useOpenFoodFacts'];
// A step is asked when the chosen level (index into PREFS.LEVELS) is at least this.
const STEPS = [['level', 0], ['goals', 0], ['warn', 0], ['avoid', 1], ['options', 2]];

const msg = (key, fallback) => {
  try { return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback; } catch (e) { return fallback; }
};
for (const el of document.querySelectorAll('[data-i18n]')) {
  const text = msg(el.dataset.i18n, '');
  if (text) el.textContent = text;
}
for (const el of document.querySelectorAll('[data-i18n-aria]')) {
  const text = msg(el.dataset.i18nAria, '');
  if (text) el.setAttribute('aria-label', text);
}
for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
  const text = msg(el.dataset.i18nPlaceholder, '');
  if (text) el.setAttribute('placeholder', text);
}

const picked = { goals: [], allergens: [], diets: [], avoid: [], level: PREFS.DEFAULT_LEVEL };
let startGoals = [], startWeights = null, step = 0;

// The questions to ask at the chosen level, then the closing screen.
const plan = () => STEPS.filter(([, at]) => at <= PREFS.LEVELS.indexOf(picked.level)).map(([id]) => id);
const asked = id => plan().includes(id);

function chip(label, on, onToggle) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', String(on));
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(next));
    onToggle(next);
  });
  return b;
}
const toggleIn = (list, id, on) => {
  const i = list.indexOf(id);
  if (on && i === -1) list.push(id);
  if (!on && i !== -1) list.splice(i, 1);
};

function renderGoals() {
  const host = document.getElementById('goals');
  const note = document.getElementById('goalNote');
  host.textContent = '';
  for (const cat of CATS.PRESET_CATEGORIES) {
    const entries = CATS.presetsInCategory(cat.id).filter(([id]) => id !== 'balanced');
    if (!entries.length) continue;
    const h = document.createElement('h2');
    h.textContent = cat.label;
    const row = document.createElement('div');
    row.className = 'chips';
    for (const [id, preset] of entries) {
      row.appendChild(chip(preset.label, picked.goals.includes(id), on => {
        toggleIn(picked.goals, id, on);
        note.textContent = on ? preset.note : '';
      }));
    }
    host.append(h, row);
  }
}

function renderWarnings() {
  const a = document.getElementById('allergens');
  const d = document.getElementById('diets');
  a.textContent = '';
  d.textContent = '';
  for (const x of ALLERGENS.ALLERGENS) a.appendChild(chip(x.label, picked.allergens.includes(x.id), on => toggleIn(picked.allergens, x.id, on)));
  for (const x of ALLERGENS.DIETS) d.appendChild(chip(x.label, picked.diets.includes(x.id), on => toggleIn(picked.diets, x.id, on)));
}

function renderAvoid() {
  const host = document.getElementById('avoidHints');
  const box = document.getElementById('avoidList');
  host.textContent = '';
  const have = new Set(picked.avoid.map(x => x.toLowerCase()));
  for (const term of AVOID_HINTS) {
    host.appendChild(chip(term, have.has(term), on => {
      const lines = PREFS.sanitizeAvoidList(box.value).filter(x => x.toLowerCase() !== term);
      if (on) lines.push(term);
      box.value = lines.join('\n');
    }));
  }
  box.value = picked.avoid.join('\n');
}

// n is a position in plan(); one past the last question is the closing screen.
function show(n, { focus = true } = {}) {
  step = n;
  const steps = plan();
  const last = steps.length;
  const id = n < last ? steps[n] : 'done';
  for (const s of document.querySelectorAll('[data-step]')) s.hidden = s.dataset.step !== id;
  const bars = document.getElementById('progress');
  bars.textContent = '';
  for (let i = 0; i < last; i++) bars.appendChild(document.createElement('span')).classList.toggle('on', i <= n);
  document.getElementById('stepCount').textContent = n < last ? `${msg('welStep', 'Step')} ${n + 1} / ${last}` : '';
  document.getElementById('back').hidden = n === 0 || n >= last;
  document.getElementById('skip').hidden = n >= last;
  document.getElementById('next').textContent = n >= last ? msg('welClose', 'Close')
    : n === last - 1 ? msg('welFinish', 'Finish') : msg('welNext', 'Next');
  // Focus the new step's heading, so a screen reader announces the step. A heading takes focus only
  // with a tabindex; without one this call did nothing and focus stayed on the Next button.
  const heading = document.querySelector(`[data-step="${id}"] h1`);
  if (heading && focus) { heading.tabIndex = -1; heading.focus(); }
}

function closeTab() {
  try { chrome.tabs.getCurrent(tab => (tab ? chrome.tabs.remove(tab.id) : window.close())); }
  catch (e) { window.close(); }
}

async function finish() {
  const goals = CATS.sanitizeGoals(picked.goals);
  const sameGoals = goals.length === startGoals.length && goals.every(g => startGoals.includes(g));
  // Unchanged goals keep whatever sliders were already set; new goals load their weights.
  const weights = sameGoals && startWeights ? startWeights : CATS.goalWeights(goals);
  const scoring = PREFS.sanitizeScoring({
    weights, goals, allergens: picked.allergens, diets: picked.diets,
    // A step that was not asked leaves its stored answers as they were.
    avoidList: asked('avoid') ? document.getElementById('avoidList').value : picked.avoid, foodOnly: true,
  });
  const values = { weights: scoring.weights, goals: scoring.goals, allergens: scoring.allergens,
    diets: scoring.diets, avoidList: scoring.avoidList, onboarded: true, settingsLevel: picked.level };
  if (asked('options')) {
    for (const id of OPTIONS) values[id] = document.getElementById(id).checked;
    if (values.useOpenFoodFacts) {
      values.useOpenFoodFacts = await new Promise(resolve => chrome.permissions.contains(OFF_PERMISSION, resolve));
    }
  }
  chrome.storage.local.set(values, () => show(plan().length));
}

document.getElementById('next').addEventListener('click', () => {
  const last = plan().length;
  if (step >= last) { closeTab(); return; }
  if (step === last - 1) { finish(); return; }
  show(step + 1);
});
document.getElementById('back').addEventListener('click', () => show(Math.max(0, step - 1)));
document.getElementById('skip').addEventListener('click', () => {
  chrome.storage.local.set({ onboarded: true, settingsLevel: picked.level }, closeTab);
});

// Choosing a level changes how many steps follow, so the progress bars are redrawn.
for (const r of document.querySelectorAll('input[name="settingsLevel"]')) {
  r.addEventListener('change', () => { picked.level = r.value; show(step, { focus: false }); });
}

// Chrome only grants an optional host permission in response to a click, so ask right here.
document.getElementById('useOpenFoodFacts').addEventListener('change', e => {
  const box = e.target;
  const status = document.getElementById('status');
  status.textContent = '';
  if (!box.checked) { chrome.permissions.remove(OFF_PERMISSION, () => void chrome.runtime.lastError); return; }
  chrome.permissions.request(OFF_PERMISSION, granted => {
    if (chrome.runtime.lastError || !granted) {
      box.checked = false;
      status.textContent = msg('popupOffDenied', 'Chrome did not grant Open Food Facts access.');
    }
  });
});

chrome.storage.local.get(['weights', 'goals', 'allergens', 'diets', 'avoidList', 'settingsLevel', 'onboarded', ...OPTIONS], o => {
  const scoring = PREFS.sanitizeScoring(o);
  const toggles = PREFS.sanitizeToggles(o);
  startGoals = CATS.describeGoals(scoring.weights, scoring.goals).ids;
  startWeights = scoring.weights;
  picked.goals = [...startGoals];
  picked.allergens = [...scoring.allergens];
  picked.diets = [...scoring.diets];
  picked.avoid = [...scoring.avoidList];
  picked.level = PREFS.levelOf(o);
  for (const r of document.querySelectorAll('input[name="settingsLevel"]')) r.checked = r.value === picked.level;
  for (const id of OPTIONS) document.getElementById(id).checked = toggles[id];
  chrome.permissions.contains(OFF_PERMISSION, has => {
    if (!has) document.getElementById('useOpenFoodFacts').checked = false;
  });
  renderGoals();
  renderWarnings();
  renderAvoid();
  show(0);
});
