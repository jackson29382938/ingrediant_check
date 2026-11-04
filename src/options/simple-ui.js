// Shared wayfinding and optional settings search. No preference is changed until
// the reader explicitly chooses Essentials or another existing detail level.
(function() {
  const page = document.body.dataset.uiPage;
  const t = (key, fallback, count) => {
    try { return chrome.i18n.getMessage(key, count == null ? [] : [String(count)]) || fallback.replace('$1', String(count ?? '')); }
    catch { return fallback.replace('$1', String(count ?? '')); }
  };
  const make = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const host = document.querySelector('.wrap') || document.querySelector('main');
  if (!host) return;
  const main = document.querySelector('main');
  if (!main.id) main.id = 'ui-main';
  if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
  const skip = make('a', t('uiSkip', 'Skip to content'), 'ui-skip'); skip.href = '#' + main.id;
  const nav = make('nav', null, 'ui-app-nav'); nav.setAttribute('aria-label', t('uiNavigation', 'Ingredient Check pages'));
  for (const [file, key, fallback] of [['options', 'popupSettingsLink', 'Settings'], ['library', 'uiLabelsSaved', 'Labels & saved'], ['history', 'uiHistory', 'Purchase history']]) {
    const a = make('a', t(key, fallback)); a.href = file + '.html';
    if (page === file) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  host.prepend(skip, nav);
  if (page !== 'options') return;
  const intro = make('section', null, 'ui-settings-tools');
  const text = make('div'); text.append(make('h2', t('uiStartSimple', 'Start with the essentials')), make('p', t('uiSimpleHint', 'Choose your goals and warnings first. More controls are always available.')));
  const simple = make('button', t('uiEssentials', 'Show essentials'), 'btn'); simple.type = 'button';
  simple.addEventListener('click', () => {
    search.value = ''; filter();
    document.querySelector('input[name="settingsLevel"][value="simple"]')?.click();
    document.getElementById('sec-presets')?.scrollIntoView({ block: 'start' });
  });
  const label = make('label', t('uiFindSetting', 'Find a setting')); label.htmlFor = 'ui-settings-search';
  const search = make('input'); search.id = 'ui-settings-search'; search.type = 'search'; search.autocomplete = 'off';
  const count = make('p', '', 'ui-search-count'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
  const empty = make('p', t('uiSearchEmpty', 'No matching sections in this detail view. Clear the search or choose a higher detail level below.')); empty.hidden = true;
  intro.append(text, simple, label, search, count, empty);
  document.querySelector('.layout').before(intro);
  const sections = Array.from(main.querySelectorAll(':scope > section'));
  const links = Array.from(document.querySelectorAll('.jump a[href^="#"]'));
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const section of sections) {
      const visible = !section.classList.contains('lvl-hidden');
      const match = !query || section.id === 'sec-level' || section.textContent.toLocaleLowerCase().includes(query);
      section.classList.toggle('ui-search-hidden', !match);
      if (visible && match && section.id !== 'sec-level') matches++;
    }
    for (const a of links) a.classList.toggle('ui-search-hidden', document.getElementById(a.hash.slice(1))?.classList.contains('ui-search-hidden') || false);
    count.textContent = query ? t('uiSearchCount', '$1 matching settings sections', matches) : '';
    empty.hidden = !query || matches > 0;
  }
  search.addEventListener('input', filter);
  search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; filter(); } });
  chrome.storage.onChanged.addListener((changes, area) => { if ((!area || area === 'local') && changes.settingsLevel) filter(); });
  addEventListener('hashchange', () => { if (search.value) { search.value = ''; filter(); } });
})();
