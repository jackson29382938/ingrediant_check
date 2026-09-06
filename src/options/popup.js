const PREFS = (typeof AIR !== 'undefined' && AIR.db && AIR.db.prefs) || null;
const KEYS = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'hoverScore', 'ocrLabels', 'useOpenFoodFacts'];
// Every plain checkbox. useOpenFoodFacts is handled separately because it also drives an
// optional-permission request. hoverScore was missing from this list, which left the
// checkbox inert: it never loaded its stored value and never wrote one.
const TOGGLE_KEYS = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'hoverScore', 'ocrLabels'];
const DEFAULTS = PREFS ? PREFS.TOGGLE_DEFAULTS : {
  enabled: true, badges: true, foodOnly: true, autoScoreSearch: false,
  hoverScore: false, ocrLabels: false, useOpenFoodFacts: false,
};
const OFF_PERMISSION = { origins: ['https://world.openfoodfacts.org/*'] };
let writing = false;

function cleanToggles(raw) {
  return PREFS ? PREFS.sanitizeToggles(raw) : { ...DEFAULTS, ...raw };
}

function say(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg || '';
}

function persist(values, done) {
  writing = true;
  chrome.storage.local.set(values, () => {
    writing = false;
    if (chrome.runtime.lastError) {
      say('Could not save.');
      if (done) done(false);
      return;
    }
    if (done) done(true);
  });
}

// Swap in the active locale. The English copy stays in the HTML so the popup is readable and
// reviewable as source, and so it still renders if a message key is ever missing.
(function localise() {
  if (!chrome.i18n || typeof chrome.i18n.getMessage !== 'function') return;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
})();

// Off is a pause. The sub-toggles are disabled so they cannot be changed into a state that is not
// running, but they keep their values and stay readable, because the whole point of the master
// switch is that it does not cost you your configuration.
function paintMaster(on) {
  document.body.classList.toggle('paused', !on);
  for (const el of document.querySelectorAll('.sub-toggles input')) el.disabled = !on;
}

function save(key, value) {
  persist({ [key]: value });
}

chrome.storage.local.get(KEYS, options => {
  const toggles = cleanToggles(options);
  const healed = {};
  for (const key of KEYS) {
    if (options[key] !== undefined && options[key] !== toggles[key]) healed[key] = toggles[key];
  }
  if (Object.keys(healed).length) persist(healed);

  for (const key of TOGGLE_KEYS) {
    const input = document.getElementById(key);
    if (!input) continue;
    input.checked = toggles[key];
    input.addEventListener('change', () => {
      save(key, input.checked);
      if (key === 'enabled') paintMaster(input.checked);
    });
  }
  paintMaster(toggles.enabled);

  const fallback = document.getElementById('useOpenFoodFacts');
  chrome.permissions.contains(OFF_PERMISSION, hasPermission => {
    fallback.checked = toggles.useOpenFoodFacts && hasPermission;
    if (toggles.useOpenFoodFacts && !hasPermission) persist({ useOpenFoodFacts: false });

    fallback.addEventListener('change', () => {
      const requested = fallback.checked;
      fallback.disabled = true;
      say('');

      if (requested) {
        // Chrome only allows optional permission requests in response to a user gesture, so this
        // must run directly from the change handler.
        chrome.permissions.request(OFF_PERMISSION, granted => {
          const permissionError = chrome.runtime.lastError;
          if (permissionError || !granted) {
            fallback.checked = false;
            fallback.disabled = false;
            persist({ useOpenFoodFacts: false });
            say('Chrome did not grant Open Food Facts access.');
            return;
          }
          // Some automated/headless Chromium builds report a successful request without actually
          // retaining the host grant. Persist only what Chrome says is truly present.
          chrome.permissions.contains(OFF_PERMISSION, confirmed => {
            fallback.checked = !!confirmed;
            fallback.disabled = false;
            persist({ useOpenFoodFacts: fallback.checked });
            if (!confirmed) say('Chrome did not keep the Open Food Facts permission.');
          });
        });
        return;
      }

      chrome.permissions.remove(OFF_PERMISSION, () => {
        const permissionError = chrome.runtime.lastError;
        fallback.disabled = false;
        fallback.checked = false;
        persist({ useOpenFoodFacts: false });
        void permissionError;
      });
    });
  });
});

function isOn(key, value) {
  return cleanToggles({ [key]: value })[key];
}

function msg(key, fallback, sub) {
  let out = '';
  try { out = chrome.i18n && chrome.i18n.getMessage(key, sub != null ? [String(sub)] : []) || ''; }
  catch (e) { /* missing key or not in an extension page */ }
  return out || fallback;
}

const NOVA_SHORT = {
  1: 'Whole / minimally processed',
  2: 'Culinary ingredient',
  3: 'Processed',
  4: 'Ultra-processed',
};

function bandColor(score) {
  return score >= 90 ? { fg: '#0f7b3f', bg: '#e8f5ec', ring: '#1a9850' }
    : score >= 75 ? { fg: '#4a7c1f', bg: '#eef6e4', ring: '#66bd63' }
    : score >= 50 ? { fg: '#9a6206', bg: '#fdf3e2', ring: '#f0a02a' }
    : score >= 25 ? { fg: '#a8480f', bg: '#fdeee5', ring: '#f46d43' }
    : { fg: '#a4161a', bg: '#fdecec', ring: '#d73027' };
}

function asinFromUrl(url) {
  try { return (new URL(url).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1] || ''; }
  catch (e) { return ''; }
}

function isAmazonUrl(url) {
  try { return /(^|\.)amazon\./i.test(new URL(url).hostname); }
  catch (e) { return false; }
}

function paintPageScore() {
  const card = document.getElementById('pageScore');
  if (!card || !chrome.tabs || typeof chrome.tabs.query !== 'function') return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs && tabs[0];
    const url = tab && tab.url;
    if (!url || !isAmazonUrl(url)) { card.hidden = true; return; }
    const asin = asinFromUrl(url);
    let version = '';
    try { version = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
    card.hidden = false;
    card.textContent = '';
    card.removeAttribute('style');
    if (!asin) {
      card.className = 'page-score empty';
      const p = document.createElement('div');
      p.className = 'ps-empty';
      p.textContent = msg('popupSearchPage', 'Search page — scores show as badges on tiles you have already opened.');
      card.appendChild(p);
      return;
    }
    chrome.storage.local.get(`s:${asin}`, obj => {
      const hit = obj[`s:${asin}`];
      card.textContent = '';
      if (!hit || typeof hit.score !== 'number' || (version && hit.v !== version)) {
        card.className = 'page-score empty';
        const p = document.createElement('div');
        p.className = 'ps-empty';
        p.textContent = msg('popupNoScore', 'Not scored yet. Wait for the panel on this page, then reopen.');
        card.appendChild(p);
        return;
      }
      const c = bandColor(hit.score);
      card.className = 'page-score';
      card.style.setProperty('--fg', c.fg);
      card.style.setProperty('--bg', c.bg);
      card.style.setProperty('--ring', c.ring);
      const kicker = document.createElement('div');
      kicker.className = 'ps-kicker';
      kicker.textContent = msg('popupThisPage', 'This page');
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:center';
      const num = document.createElement('div');
      num.className = 'ps-num';
      num.textContent = String(hit.score);
      const meta = document.createElement('div');
      const verdict = document.createElement('div');
      verdict.className = 'ps-verdict';
      verdict.textContent = hit.verdict || '';
      const sub = document.createElement('div');
      sub.className = 'ps-sub';
      sub.textContent = [NOVA_SHORT[hit.nova], hit.name].filter(Boolean).join(' · ');
      meta.append(verdict, sub);
      row.append(num, meta);
      card.append(kicker, row);
    });
  });
}

function cacheKeys(all) {
  return Object.keys(all || {}).filter(key => /^(s|off):/.test(key));
}

function paintCacheCount() {
  const btn = document.getElementById('clear');
  if (!btn) return;
  chrome.storage.local.get(null, all => {
    const n = cacheKeys(all).length;
    btn.disabled = n === 0;
    btn.textContent = n
      ? msg('popupClearN', `Clear ${n} cached scores`, n)
      : msg('popupClear', 'Clear cached scores');
  });
}

function paintWhy(on) {
  document.body.classList.toggle('show-why', on);
  const btn = document.getElementById('toggleWhy');
  if (btn) btn.textContent = on
    ? msg('popupHideWhy', 'Hide explanations')
    : msg('popupShowWhy', 'Why these matter');
}

chrome.storage.onChanged.addListener(changes => {
  if (writing) return;
  for (const key of TOGGLE_KEYS) {
    if (!changes[key]) continue;
    const input = document.getElementById(key);
    if (!input) continue;
    input.checked = isOn(key, changes[key].newValue);
    if (key === 'enabled') paintMaster(input.checked);
  }
  if (changes.useOpenFoodFacts) {
    const fallback = document.getElementById('useOpenFoodFacts');
    if (fallback && !fallback.disabled) fallback.checked = isOn('useOpenFoodFacts', changes.useOpenFoodFacts.newValue);
  }
  if (changes.popupShowWhy) paintWhy(changes.popupShowWhy.newValue === true);
  if (Object.keys(changes).some(k => /^(s|off):/.test(k))) {
    paintCacheCount();
    paintPageScore();
  }
});

document.getElementById('openSettings').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('toggleWhy').addEventListener('click', () => {
  const next = !document.body.classList.contains('show-why');
  paintWhy(next);
  persist({ popupShowWhy: next });
});

document.getElementById('clear').addEventListener('click', async event => {
  event.preventDefault();
  try {
    const all = await chrome.storage.local.get(null);
    const keys = cacheKeys(all);
    await chrome.storage.local.remove(keys);
    const cleared = chrome.i18n && chrome.i18n.getMessage('popupCleared', [String(keys.length)]);
    event.target.textContent = cleared || `Cleared ${keys.length} cached scores`;
    event.target.disabled = true;
    paintPageScore();
  } catch (e) {
    say('Could not clear cached scores.');
  }
});

chrome.storage.local.get('popupShowWhy', o => paintWhy(o.popupShowWhy === true));
paintPageScore();
paintCacheCount();

(function paintVersion() {
  const el = document.getElementById('version');
  if (!el) return;
  try {
    const v = chrome.runtime.getManifest().version;
    el.textContent = v ? `v${v}` : '';
  } catch (e) { el.textContent = ''; }
})();
