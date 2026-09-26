// Tabs for the goal categories (popup and settings page), as the ARIA tabs pattern expects: one tab
// stop for the whole row, arrow keys (and Home / End) to move between tabs, which selects them, and
// each tab tied to the panel it controls. The pages render the tabs themselves and call paintTabs
// after every render; the key handler is attached to the row once.

/* exported paintTabs */
function paintTabs(list, panel) {
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const current = tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];
  for (const tab of tabs) {
    tab.tabIndex = tab === current ? 0 : -1;
    if (panel && panel.id) tab.setAttribute('aria-controls', panel.id);
  }
  if (panel && current && current.id) panel.setAttribute('aria-labelledby', current.id);
  if (list.dataset.tabsWired) return;
  list.dataset.tabsWired = '1';
  list.addEventListener('keydown', e => {
    const all = [...list.querySelectorAll('[role="tab"]')];
    const at = all.indexOf(document.activeElement);
    if (at < 0) return;
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    all[(to + all.length) % all.length].click();
    // The click re-renders the row; focus the tab that is selected now.
    const selected = list.querySelector('[role="tab"][aria-selected="true"]');
    if (selected) selected.focus();
  });
}
