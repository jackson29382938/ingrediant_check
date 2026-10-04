// First-run setup: goals, warnings, an avoid list and four fetch choices, in about a minute. Opened
// on install (background.js) and from "Run setup again" in the popup and settings. It starts from
// what is already stored, and writes everything through the same sanitizers as the settings page.

const CATS = AIR.db.categories;
const ALLERGENS = AIR.db.allergens;
const PREFS = AIR.db.prefs;
const OFF_PERMISSION = { origins: ['https://world.openfoodfacts.org/*'] };
const AVOID_HINTS = PREFS.AVOID_HINTS;
const OPTIONS = ['autoScoreSearch', 'sharedCache', 'ocrLabels', 'useOpenFoodFacts'];
const LAST = 5;
let setupToken = null;
let setupClientId = PREFS.OAUTH_CLIENT_ID;

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

const picked = { goals: [], allergens: [], diets: [], avoid: [] };
let startGoals = [], startWeights = null, startImportance = {}, step = 1;

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
        paintGoalSummary();
      }));
    }
    host.append(h, row);
  }
}

function paintGoalSummary() {
  const summary = document.getElementById('goalSummary');
  if (picked.goals.length) {
    summary.textContent = `${msg('welGoalsSelected', 'Selected goals')} (${picked.goals.length}): ${CATS.goalsLabel(picked.goals)}`;
  } else {
    summary.textContent = CATS.describeGoals(startWeights, startGoals, startImportance).custom
      ? msg('welGoalsCustom', 'Your custom weights are kept unless you change goals.')
      : msg('welGoalsBalanced', 'No goals selected: use the balanced defaults.');
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
      box.value = lines.join(', ');
      paintAvoidChoices();
    }));
  }
  box.value = picked.avoid.join(', ');
  paintAvoidChoices();
}

function paintAvoidChoices() {
  picked.avoid = PREFS.sanitizeAvoidList(document.getElementById('avoidList').value);
  const have = new Set(picked.avoid.map(term => term.toLowerCase()));
  for (const button of document.getElementById('avoidHints').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(have.has(button.textContent.toLowerCase())));
  }
  document.getElementById('avoidCount').textContent = `${picked.avoid.length} / ${PREFS.AVOID_MAX_LINES} entries`;
}

document.getElementById('avoidList').addEventListener('input', paintAvoidChoices);
document.getElementById('avoidList').addEventListener('blur', () => {
  paintAvoidChoices();
  document.getElementById('avoidList').value = picked.avoid.join(', ');
});

function show(n) {
  step = n;
  for (const s of document.querySelectorAll('[data-step]')) s.hidden = Number(s.dataset.step) !== n;
  document.querySelectorAll('.progress span').forEach((bar, i) => bar.classList.toggle('on', i < Math.min(n, LAST)));
  document.getElementById('stepCount').textContent = n <= LAST ? `${msg('welStep', 'Step')} ${n} / ${LAST}` : '';
  document.getElementById('back').hidden = n === 1 || n > LAST;
  document.getElementById('skip').hidden = n > LAST;
  document.getElementById('next').textContent = n > LAST ? msg('welClose', 'Close')
    : n === LAST ? msg('welFinish', 'Finish') : msg('welNext', 'Next');
  // Focus the new step's heading, so a screen reader announces the step. A heading takes focus only
  // with a tabindex; without one this call did nothing and focus stayed on the Next button.
  const heading = document.querySelector(`[data-step="${n}"] h1`);
  if (heading) { heading.tabIndex = -1; heading.focus(); }
}

function closeTab() {
  try { chrome.tabs.getCurrent(tab => (tab ? chrome.tabs.remove(tab.id) : window.close())); }
  catch (e) { window.close(); }
}

async function finish() {
  const next = document.getElementById('next');
  if (next.disabled) return;
  next.disabled = true;
  const status = document.getElementById('status');
  status.textContent = '';
  // Request optional barcode access directly from Finish's user gesture.
  // A checked recommendation is not itself a Chrome permission grant.
  if (document.getElementById('useOpenFoodFacts').checked) {
    const granted = await new Promise(resolve => chrome.permissions.request(OFF_PERMISSION,
      ok => resolve(!chrome.runtime.lastError && ok)));
    if (!granted) {
      document.getElementById('useOpenFoodFacts').checked = false;
      status.textContent = msg('popupOffDenied', 'Chrome did not grant Open Food Facts access.');
      next.disabled = false;
      return;
    }
  }
  const goals = CATS.sanitizeGoals(picked.goals);
  const sameGoals = goals.length === startGoals.length && goals.every(g => startGoals.includes(g));
  // Unchanged goals keep whatever sliders were already set; new goals load their weights.
  const weights = sameGoals && startWeights ? startWeights : CATS.goalWeights(goals, startImportance);
  const scoring = PREFS.sanitizeScoring({
    weights, goals, goalImportance: startImportance, allergens: picked.allergens, diets: picked.diets,
    avoidList: document.getElementById('avoidList').value, foodOnly: true,
  });
  const values = { weights: scoring.weights, goals: scoring.goals, goalImportance: scoring.goalImportance, allergens: scoring.allergens,
    diets: scoring.diets, avoidList: scoring.avoidList, onboarded: true };
  for (const id of OPTIONS) values[id] = document.getElementById(id).checked;
  chrome.storage.local.set(values, async () => {
    if (chrome.runtime.lastError) {
      next.disabled = false;
      status.textContent = 'Could not save your choices. Please try again.';
      return;
    }
    if (setupToken) {
      const token = setupToken;
      setupToken = null;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'accountSave', token });
        status.textContent = result && result.ok ? 'Your choices are saved and backed up.' : 'Choices saved locally. Google backup could not be completed; try again in Settings.';
      } catch (e) { status.textContent = 'Choices saved locally. Google backup could not be completed; try again in Settings.'; }
      document.getElementById('backupStatus').textContent = status.textContent;
    }
    next.disabled = false;
    show(LAST + 1);
  });
}

document.getElementById('next').addEventListener('click', () => {
  if (step > LAST) { closeTab(); return; }
  if (step === LAST) { finish(); return; }
  show(step + 1);
});
document.getElementById('back').addEventListener('click', () => show(Math.max(1, step - 1)));
document.getElementById('skip').addEventListener('click', () => {
  chrome.storage.local.set({ onboarded: true }, closeTab);
});

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

chrome.storage.local.get(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', ...OPTIONS], o => {
  const scoring = PREFS.sanitizeScoring(o);
  const toggles = PREFS.sanitizeToggles(o);
  startImportance = scoring.goalImportance;
  startGoals = CATS.describeGoals(scoring.weights, scoring.goals, startImportance).ids;
  startWeights = scoring.weights;
  picked.goals = [...startGoals];
  picked.allergens = [...scoring.allergens];
  picked.diets = [...scoring.diets];
  picked.avoid = [...scoring.avoidList];
  for (const id of OPTIONS) document.getElementById(id).checked = toggles[id];
  renderGoals();
  paintGoalSummary();
  renderWarnings();
  renderAvoid();
  show(1);
});

document.getElementById('openChromeProfile').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/people' });
});
document.getElementById('openAccountSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#sec-account') });
});

const setupRedirect = () => chrome.identity ? chrome.identity.getRedirectURL() : `https://${chrome.runtime.id}.chromiumapp.org/`;
try { document.getElementById('googleRedirect').textContent = setupRedirect(); }
catch (e) { document.getElementById('googleRedirect').textContent = 'Open this page in the installed extension to see its redirect URL.'; }
chrome.storage.local.get(['oauthClientId'], values => { setupClientId = PREFS.oauthClientId(values.oauthClientId) || PREFS.OAUTH_CLIENT_ID; });
document.getElementById('copyGoogleRedirect').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(setupRedirect()); document.getElementById('googleStatus').textContent = 'Redirect URL copied.'; }
  catch (e) { document.getElementById('googleStatus').textContent = 'Select and copy the redirect URL above.'; }
});
document.getElementById('googleSignIn').addEventListener('click', async () => {
  const button = document.getElementById('googleSignIn');
  if (button.disabled) return;
  button.disabled = true;
  document.getElementById('next').disabled = true;
  const status = document.getElementById('googleStatus');
  try {
    const granted = await new Promise(resolve => chrome.permissions.request({ permissions: ['identity'] }, ok => resolve(!chrome.runtime.lastError && ok)));
    if (!granted) { status.textContent = 'Google sign-in access was not granted. You can continue without it.'; return; }
    setupToken = await AIR.googleAuth.token(chrome, setupClientId);
    status.textContent = 'Google approved sign-in. Finish will save your choices and attempt an account backup.';
  } catch (e) {
    setupToken = null;
    status.textContent = e.message === 'cancelled' ? 'Sign-in cancelled. You can continue without it.' : 'Google sign-in could not finish. Check setup help below: register the exact redirect URL in the Google Cloud OAuth Web client.';
  } finally { button.disabled = false; document.getElementById('next').disabled = false; }
});
