const KEYS = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'hoverScore', 'ocrLabels', 'useOpenFoodFacts'];
// Every plain checkbox. useOpenFoodFacts is handled separately because it also drives an
// optional-permission request. hoverScore was missing from this list, which left the
// checkbox inert: it never loaded its stored value and never wrote one.
const TOGGLE_KEYS = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'hoverScore', 'ocrLabels'];
const DEFAULTS = { enabled: true, badges: true, foodOnly: true, autoScoreSearch: false, hoverScore: false, ocrLabels: false, useOpenFoodFacts: false };
const OFF_PERMISSION = { origins: ['https://world.openfoodfacts.org/*'] };

// Swap in the active locale. The English copy stays in the HTML so the popup is readable and
// reviewable as source, and so it still renders if a message key is ever missing.
(function localise() {
  if (!chrome.i18n || typeof chrome.i18n.getMessage !== 'function') return;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
})();

function save(key, value) {
  chrome.storage.local.set({ [key]: value });
}

chrome.storage.local.get(KEYS, options => {
  for (const key of TOGGLE_KEYS) {
    const input = document.getElementById(key);
    input.checked = options[key] === undefined ? DEFAULTS[key] : !!options[key];
    input.addEventListener('change', () => save(key, input.checked));
  }

  const fallback = document.getElementById('useOpenFoodFacts');
  chrome.permissions.contains(OFF_PERMISSION, hasPermission => {
    fallback.checked = !!options.useOpenFoodFacts && hasPermission;
    if (options.useOpenFoodFacts && !hasPermission) save('useOpenFoodFacts', false);

    fallback.addEventListener('change', () => {
      const requested = fallback.checked;
      fallback.disabled = true;

      if (requested) {
        // Chrome only allows optional permission requests in response to a user gesture, so this
        // must run directly from the change handler.
        chrome.permissions.request(OFF_PERMISSION, granted => {
          const permissionError = chrome.runtime.lastError;
          if (permissionError || !granted) {
            fallback.checked = false;
            fallback.disabled = false;
            save('useOpenFoodFacts', false);
            return;
          }
          // Some automated/headless Chromium builds report a successful request without actually
          // retaining the host grant. Persist only what Chrome says is truly present.
          chrome.permissions.contains(OFF_PERMISSION, confirmed => {
            fallback.checked = !!confirmed;
            fallback.disabled = false;
            save('useOpenFoodFacts', fallback.checked);
          });
        });
        return;
      }

      chrome.permissions.remove(OFF_PERMISSION, () => {
        const permissionError = chrome.runtime.lastError;
        fallback.disabled = false;
        fallback.checked = false;
        save('useOpenFoodFacts', false);
        void permissionError;
      });
    });
  });
});

function isOn(key, value) {
  if (key === 'hoverScore' || key === 'autoScoreSearch' || key === 'ocrLabels' || key === 'useOpenFoodFacts') return value === true;
  return value !== false;
}

chrome.storage.onChanged.addListener(changes => {
  for (const key of TOGGLE_KEYS) {
    if (!changes[key]) continue;
    const input = document.getElementById(key);
    if (input) input.checked = isOn(key, changes[key].newValue);
  }
  if (changes.useOpenFoodFacts) {
    const fallback = document.getElementById('useOpenFoodFacts');
    if (fallback && !fallback.disabled) fallback.checked = changes.useOpenFoodFacts.newValue === true;
  }
});

document.getElementById('openSettings').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('clear').addEventListener('click', async event => {
  event.preventDefault();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => /^(s|off):/.test(key));
  await chrome.storage.local.remove(keys);
  const msg = chrome.i18n && chrome.i18n.getMessage('popupCleared', [String(keys.length)]);
  event.target.textContent = msg || `Cleared ${keys.length} cached scores`;
});
