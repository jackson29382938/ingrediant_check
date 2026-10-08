// First-run setup: how much to configure, then goals, warnings, an avoid list, four fetch choices and
// an optional Google backup, in about a minute. The first answer decides which later steps are asked. Opened
// on install (background.js) and from "Run setup again" in the popup and settings. It starts from
// what is already stored, and writes everything through the same sanitizers as the settings page.

const CATS = AIR.db.categories;
const ALLERGENS = AIR.db.allergens;
const PREFS = AIR.db.prefs;
const OFF_PERMISSION = { origins: ['https://world.openfoodfacts.org/*'] };
const AVOID_HINTS = PREFS.AVOID_HINTS;
const OPTIONS = ['autoScoreSearch', 'sharedCache', 'ocrLabels', 'useOpenFoodFacts'];
// A step is asked when the chosen level (index into PREFS.LEVELS) is at least this.
const STEPS = [['level', 0], ['goals', 0], ['warn', 0], ['avoid', 1], ['options', 2], ['google', 2]];
let setupToken = null;
let startHistoryEnabled = false;
let busy = false;
let setupReady = false;
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

const picked = { goals: [], allergens: [], diets: [], avoid: [], level: PREFS.DEFAULT_LEVEL };
let startGoals = [], startWeights = null, startImportance = {}, step = 0;

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

// n is a position in plan(); one past the last question is the closing screen.
function show(n, { focus = true } = {}) {
  step = n;
  const steps = plan();
  const last = steps.length;
  const id = n < last ? steps[n] : 'done';
  for (const s of document.querySelectorAll('[data-step]')) s.hidden = s.dataset.step !== id;
  const bars = document.getElementById('progress');
  bars.textContent = '';
  for (let i = 0; i < last; i++) {
    const bar = document.createElement('span');
    bar.classList.toggle('on', i <= n);
    bars.appendChild(bar);
  }
  document.getElementById('stepCount').textContent = n < last ? `${msg('welStep', 'Step')} ${n + 1} / ${last}` : '';
  document.getElementById('back').hidden = n === 0 || n >= last;
  document.getElementById('skip').hidden = n >= last;
  document.getElementById('next').textContent = n >= last ? msg('welClose', 'Close')
    : n === last - 1 ? msg('welFinish', 'Finish') : msg('welNext', 'Next');
  // Focus the new step's heading, so a screen reader announces the step. A heading takes focus only
  // with a tabindex; without one this call did nothing and focus stayed on the Next button.
  for (const k of document.querySelectorAll('.key[data-for]')) k.hidden = (k.dataset.for === 'level') !== (id === 'level');
  const heading = document.querySelector(`[data-step="${id}"] h1`);
  if (heading && focus) { heading.tabIndex = -1; heading.focus(); }
}

function closeTab() {
  try { chrome.tabs.getCurrent(tab => (tab ? chrome.tabs.remove(tab.id) : window.close())); }
  catch (e) { window.close(); }
}

function setBusy(on) {
  busy = on;
  document.getElementById('next').disabled = on;
  for (const id of ['back', 'skip', 'googleSignIn']) document.getElementById(id).disabled = on || !setupReady;
}

function saveChoices(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error('save-failed'));
      else resolve();
    });
  });
}

async function finish() {
  if (busy || !setupReady) return;
  setBusy(true);
  const status = document.getElementById('status');
  status.textContent = 'Saving your choices…';
  try {
    // Request optional barcode access directly from Finish's user gesture.
    // A checked recommendation is not itself a Chrome permission grant.
    if (asked('options') && document.getElementById('useOpenFoodFacts').checked) {
      const granted = await new Promise(resolve => chrome.permissions.request(OFF_PERMISSION,
        ok => resolve(!chrome.runtime.lastError && ok)));
      if (!granted) {
        document.getElementById('useOpenFoodFacts').checked = false;
        status.textContent = msg('popupOffDenied', 'Chrome did not grant Open Food Facts access.');
        return;
      }
    }
    const goals = CATS.sanitizeGoals(picked.goals);
    const sameGoals = goals.length === startGoals.length && goals.every(g => startGoals.includes(g));
    // Unchanged goals keep whatever sliders were already set; new goals load their weights.
    const weights = sameGoals && startWeights ? startWeights : CATS.goalWeights(goals, startImportance);
    const scoring = PREFS.sanitizeScoring({
      weights, goals, goalImportance: startImportance, allergens: picked.allergens, diets: picked.diets,
      // A step that was not asked leaves its stored answers as they were.
      avoidList: asked('avoid') ? document.getElementById('avoidList').value : picked.avoid, foodOnly: true,
    });
    const values = { weights: scoring.weights, goals: scoring.goals, goalImportance: scoring.goalImportance, allergens: scoring.allergens,
      diets: scoring.diets, avoidList: scoring.avoidList, onboarded: true, settingsLevel: picked.level };
    if (asked('options')) for (const id of OPTIONS) values[id] = document.getElementById(id).checked;
    await saveChoices(values);
    const historyBox = document.getElementById('setupPurchaseHistory');
    if (historyBox && historyBox.checked !== startHistoryEnabled) {
      const configured = await chrome.runtime.sendMessage({ type: 'purchaseConfigure', enabled: historyBox.checked, autoSync: historyBox.checked });
      if (!configured?.ok) throw new Error('history-configuration-failed');
    }
    if (historyBox?.checked) await chrome.tabs.create({ url: 'https://www.amazon.com/your-orders/orders' });
    if (setupToken) {
      const token = setupToken;
      setupToken = null;
      status.textContent = 'Choices saved. Backing up with Google…';
      const local = 'Choices saved locally. Google backup could not be completed; try again in Settings.';
      try {
        // Never replace a copy that is already there: a new computer or a reinstall would overwrite what
        // another computer saved with its own first choices. Setup writes only when the account has none.
        const existing = await chrome.runtime.sendMessage({ type: 'accountFetch', token });
        if (existing && existing.ok === true) {
          status.textContent = 'Your choices are saved on this computer. This Google account already has a saved copy, so it was left as it is. In Settings you can Restore it here, or Save to replace it.';
        } else if (existing && existing.reason === 'no-backup') {
          const result = await chrome.runtime.sendMessage({ type: 'accountSave', token });
          status.textContent = result && result.ok ? 'Your choices are saved and backed up.' : local;
        } else {
          status.textContent = local;
        }
      } catch (e) { status.textContent = local; }
      document.getElementById('backupStatus').textContent = status.textContent;
    } else {
      status.textContent = 'Your choices are saved on this computer.';
      document.getElementById('backupStatus').textContent = status.textContent;
    }
    show(plan().length);
  } catch (e) {
    status.textContent = 'Could not save your choices. Please try again.';
  } finally { setBusy(false); }
}

document.getElementById('next').addEventListener('click', () => {
  if (busy) return;
  if (!setupReady) { location.reload(); return; }
  const last = plan().length;
  if (step >= last) { closeTab(); return; }
  if (step === last - 1) { finish(); return; }
  show(step + 1);
});
document.getElementById('back').addEventListener('click', () => { if (!busy && setupReady) show(Math.max(0, step - 1)); });

// Setup works from the keyboard alone (the shortcuts are listed under the buttons). Enter is "next"
// unless the focus is somewhere Enter already means something (the footer buttons, a link, a text box).
// A choice chip is a toggle button, but there Space toggles and Enter moves on, so a keyboard reader
// can tick choices and press Enter without leaving the keys. The single-letter keys are ignored while
// typing, and Shift+S, not S, skips so a stray key cannot.
function onKey(e) {
  if (e.defaultPrevented || e.altKey || !e.key) return;
  const t = e.target || {};
  const tag = String(t.tagName || '').toUpperCase();
  const toggle = tag === 'INPUT' && (t.type === 'radio' || t.type === 'checkbox');
  const typing = !toggle && (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || !!t.isContentEditable);
  const chip = tag === 'BUTTON' && !!t.classList && typeof t.classList.contains === 'function' && t.classList.contains('chip');
  const press = !chip && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY');
  const mod = e.ctrlKey || e.metaKey;
  const click = id => { e.preventDefault(); document.getElementById(id).click(); };
  if (e.key === 'Enter') {
    if (mod || !(typing || press)) click('next');   // preventDefault on a chip also stops its own Enter toggle
    return;
  }
  if (mod || typing) return;
  const key = e.key.toLowerCase();
  if (key === 'b' && !e.shiftKey && !document.getElementById('back').hidden) click('back');
  else if (key === 's' && e.shiftKey && !document.getElementById('skip').hidden) click('skip');
  else if (/^[1-5]$/.test(e.key) && plan()[step] === 'level') { e.preventDefault(); chooseLevel(PREFS.LEVELS[Number(e.key) - 1], true); }
}
if (typeof document.addEventListener === 'function') document.addEventListener('keydown', onKey);
document.getElementById('next').setAttribute('aria-keyshortcuts', 'Enter');
document.getElementById('back').setAttribute('aria-keyshortcuts', 'B');
document.getElementById('skip').setAttribute('aria-keyshortcuts', 'Shift+S');

// Choosing a level changes how many steps follow, so the progress bars are redrawn.
function chooseLevel(level, fromKey = false) {
  picked.level = level;
  for (const r of document.querySelectorAll('input[name="settingsLevel"]')) {
    r.checked = r.value === level;
    if (fromKey && r.checked && typeof r.focus === 'function') r.focus();
  }
  show(step, { focus: false });
}
for (const r of document.querySelectorAll('input[name="settingsLevel"]')) {
  r.addEventListener('change', () => chooseLevel(r.value));
}
document.getElementById('skip').addEventListener('click', async () => {
  if (busy || !setupReady) return;
  setBusy(true);
  setupToken = null;
  try { await saveChoices({ onboarded: true, settingsLevel: picked.level }); closeTab(); }
  catch (e) { document.getElementById('status').textContent = 'Could not save setup status. Please try again.'; }
  finally { setBusy(false); }
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

setBusy(true);
chrome.storage.local.get(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'oauthClientId', 'settingsLevel', 'onboarded', 'historyEnabled', ...OPTIONS], o => {
  if (chrome.runtime.lastError) {
    document.getElementById('status').textContent = 'Could not load your saved choices. Retry before changing settings.';
    document.getElementById('next').textContent = 'Retry loading';
    setBusy(false);
    return;
  }
  setupReady = true;
  const historyBox = document.getElementById('setupPurchaseHistory');
  startHistoryEnabled = o.historyEnabled === true;
  if (historyBox) historyBox.checked = startHistoryEnabled;
  setupClientId = PREFS.oauthClientId(o.oauthClientId) || PREFS.OAUTH_CLIENT_ID;
  const scoring = PREFS.sanitizeScoring(o);
  const toggles = PREFS.sanitizeToggles(o);
  startImportance = scoring.goalImportance;
  startGoals = CATS.describeGoals(scoring.weights, scoring.goals, startImportance).ids;
  startWeights = scoring.weights;
  picked.goals = [...startGoals];
  picked.allergens = [...scoring.allergens];
  picked.diets = [...scoring.diets];
  picked.avoid = [...scoring.avoidList];
  picked.level = PREFS.levelOf(o);
  for (const r of document.querySelectorAll('input[name="settingsLevel"]')) r.checked = r.value === picked.level;
  for (const id of OPTIONS) document.getElementById(id).checked = toggles[id];
  renderGoals();
  paintGoalSummary();
  renderWarnings();
  renderAvoid();
  show(0);
  setBusy(false);
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
document.getElementById('copyGoogleRedirect').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(setupRedirect()); document.getElementById('googleStatus').textContent = 'Redirect URL copied.'; }
  catch (e) { document.getElementById('googleStatus').textContent = 'Select and copy the redirect URL above.'; }
});
document.getElementById('googleSignIn').addEventListener('click', async () => {
  if (busy || !setupReady) return;
  setBusy(true);
  setupToken = null;
  const status = document.getElementById('googleStatus');
  status.textContent = 'Waiting for Google sign-in…';
  try {
    const granted = await new Promise(resolve => chrome.permissions.request({ permissions: ['identity'] }, ok => resolve(!chrome.runtime.lastError && ok)));
    if (!granted) { status.textContent = 'Google sign-in access was not granted. You can continue without it.'; return; }
    setupToken = await AIR.googleAuth.token(chrome, setupClientId);
    status.textContent = 'Google approved sign-in. Finish will save your choices and attempt an account backup.';
    // Who signed in, kept on this computer and shown at the top of Settings. Not needed to continue.
    if (AIR.googleAuth.profile) {
      try {
        const who = await AIR.googleAuth.profile(setupToken);
        await saveChoices({ googleProfile: { ...who, at: Date.now() } });
        status.textContent = `Signed in with Google as ${who.email}. Finish will save your choices and attempt an account backup.`;
      } catch (e) { /* signed in; the profile is just not shown */ }
    }
  } catch (e) {
    setupToken = null;
    status.textContent = e.message === 'cancelled' ? 'Sign-in cancelled. You can continue without it.' : 'Google sign-in could not finish. Check setup help below: register the exact redirect URL in the Google Cloud OAuth Web client.';
  } finally { setBusy(false); }
});
