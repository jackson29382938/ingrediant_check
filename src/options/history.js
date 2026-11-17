(function() {
  const H = AIR.db.purchaseHistory, $ = id => document.getElementById(id);
  // Every string the page shows goes through t(): the German reader used to get this whole page in English,
  // because none of it had a key (docs/AUDIT-2026-11-16.md, finding 8). `$1`…`$9` in a fallback are the values.
  const t = (key, fallback, ...subs) => {
    let text = '';
    try { text = chrome.i18n.getMessage(key, subs.map(String)); } catch (e) { /* no locale: the English below */ }
    return text || fallback.replace(/\$(\d)/g, (all, n) => (subs[n - 1] === undefined ? all : String(subs[n - 1])));
  };
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder, el.placeholder);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria, el.getAttribute('aria-label') || ''));
  document.documentElement.lang = (chrome.i18n?.getUILanguage?.() || 'en').split('-')[0];
  let conf = {}, busy = false, dashboardDirty = true;
  const dashboardKeys = ['purchaseHistory', 'theme', 'palette', 'accent', 'weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly', 'ratingStyle', 'personalCareEnabled'];
  const reasons = { 'backend-capacity-update-required': t('histReasonBackendCapacityUpdateRequired', 'History is kept locally. Update the Apps Script backend before syncing more than its current history capacity.'), pending: t('histReasonPending', 'New purchases are saved locally and waiting for automatic sync.'), 'local-only': t('histReasonLocalOnly', 'New purchases are saved locally. Automatic sync is off; use Sync now to upload them.'), 'delete-pending': t('histReasonDeletePending', 'Account deletion is still pending. Complete deletion before enabling import.'), 'backend-update-required': t('histReasonBackendUpdateRequired', 'The account backend needs the purchase-history update. Your history remains local; no purchase data was sent.'), 'account-changed': t('histReasonAccountChanged', 'This local history belongs to another Google account. Sign in to that account before syncing or deleting its account copy.'), 'needs-sign-in-or-network': t('histReasonNeedsSignInOrNetwork', 'Sync needs Google sign-in or a working connection. Your local history is kept, and automatic sync will retry.'), 'history-full': t('histReasonHistoryFull', 'The 10,000-entry limit has been reached. Export your history before removing entries.'), off: t('histReasonOff', 'Import or automatic sync is off.'), deleted: t('histReasonDeleted', 'History deleted from this device and the authenticated account.') };
  function say(text) { $('status').textContent = text; }
  async function paint() {
    conf = await chrome.storage.local.get(['purchaseHistory', 'historyEnabled', 'historyAutoSync', 'historyOwner', 'historySyncStatus', 'historyDeletePending', 'googleProfile', 'oauthClientId', 'theme', 'palette', 'accent', 'ocrLabels', 'useOpenFoodFacts', 'ratePace', 'orderBadgePlacement', 'hoverBreakdown', 'historyScan', 'weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly', 'ratingStyle', 'personalCareEnabled']);
    AIR.db.theme.use(conf); AIR.db.theme.page(document);
    $('historyEnabled').checked = conf.historyEnabled === true; $('historyAutoSync').checked = conf.historyAutoSync !== false;
    const toggles = AIR.db.prefs.sanitizeToggles(conf); const on = value => (value ? t('histOn', 'on') : t('histOff', 'off')), pace = ['gentle', 'normal', 'quick', 'fast'].includes(conf.ratePace) ? conf.ratePace : 'normal';
    $('readingSummary').textContent = t('histSharedSettings', 'Shared settings: label photos $1 · barcode lookup $2 · fetching pace $3 · hover details $4.', on(toggles.ocrLabels), on(toggles.useOpenFoodFacts), t('histPace' + pace[0].toUpperCase() + pace.slice(1), pace), on(toggles.hoverBreakdown));
    $('account').textContent = conf.googleProfile?.email ? t('histSignedIn', 'Signed in: $1', conf.googleProfile.email) : t('histNotSignedIn', 'Not signed in. Import can work locally; account sync waits for Google sign-in.');
    $('orderBadgePlacement').value = conf.orderBadgePlacement === 'title' ? 'title' : 'image';
    const scan = conf.historyScan;
    if (scan && !busy) $('scanBackground').checked = scan.background !== false;
    const estimate = AIR.db.historyScan.estimate(scan || {}), minutes = seconds => seconds < 60 ? t('histUnderAMinute', 'under 1 minute') : t('histMinutes', '$1 minutes', Math.ceil(seconds / 60));
    const scanState = scan && (scan.status === 'complete' ? t('histScanComplete', 'Scan complete') : scan.status === 'running' ? t('histScanning', 'Scanning') : scan.status === 'paused' ? t('histScanPaused', 'Scan paused') : t('histScanCancelled', 'Scan cancelled'));
    $('scanStatus').textContent = scan ? `${t('histScanPages', '$1 · $2 pages imported.', scanState, scan.pages || 0)}${scan.status === 'running' ? ' ' + t('histScanRemaining', 'Remaining estimate: $1–$2 for at least $3 known remaining pages. More pages may be discovered.', minutes(estimate.lowSeconds), minutes(estimate.highSeconds), estimate.pages) : ''} ${scan.reason || ''}` : t('histNoScan', 'No full-history scan started. Enable import, then start a scan.');
    if (!busy) { $('scanStart').disabled = !conf.historyEnabled || scan?.status === 'running'; $('scanPause').disabled = scan?.status !== 'running'; $('scanResume').disabled = scan?.status !== 'paused'; $('scanCancel').disabled = !['running', 'paused'].includes(scan?.status); $('scanOpen').disabled = scan?.tabId === undefined; }
    const status = conf.historySyncStatus;
    if (!busy) say(conf.historyDeletePending ? t('histDeletePending', 'Local history cleared. Account deletion is pending; sign in to its Google account and click Sync now.') : status ? status.ok ? status.reason === 'deleted' ? reasons.deleted : t('histSynced', 'Synced $1', new Date(status.at).toLocaleString()) : reasons[status.reason] || t('histSyncIncomplete', 'Sync has not completed. Local history is kept.') : t('histNoSyncYet', 'No account sync yet.'));
    const estimateTotal = (scan?.pages || 0) + estimate.pages;
    if (!scan || (scan.status !== 'running' && !scan.pages)) $('scanProgress').value = 0;
    else if (scan.status === 'complete') $('scanProgress').value = 100;
    else if (estimateTotal > 0 && scan?.pages) $('scanProgress').value = Math.min(99, scan.pages / estimateTotal * 100);
    else $('scanProgress').removeAttribute('value');
    $('scanProgress').setAttribute('aria-label', scan?.status === 'complete' ? t('histScanProgressDone', 'Order-page scan complete') : t('histScanProgressEstimate', 'Estimated order-page scan progress; total may grow as years are discovered'));
    $('scanProgressNote').textContent = scan ? `${t('histScanNote', '$1 pages finished · $2 order appearances · $3 product-entry appearances processed. Pages revisited across filters can overlap; deduplicated purchase totals are shown below.', scan.pages || 0, scan.pageOrders || 0, scan.pageItems || 0)} ${scan.status !== 'complete' ? t('histScanNoteEstimate', 'Progress is an estimate and may decrease when more pages are discovered.') : ''}` : t('histScanNoteNone', 'Start a scan to see progress.');
    if (dashboardDirty) { dashboardDirty = false; void AIR.historyDashboard.update(conf); }
  }
  async function auth() {
    const granted = await chrome.permissions.request({ permissions: ['identity'] }); if (!granted) throw new Error(t('histNoSignInPermission', 'Google sign-in permission was not granted.'));
    const token = await AIR.googleAuth.token(chrome, AIR.db.prefs.oauthClientId(conf.oauthClientId) || AIR.db.prefs.OAUTH_CLIENT_ID);
    const who = await AIR.googleAuth.profile(token); await chrome.storage.local.set({ googleProfile: { ...who, at: Date.now() } }); return token;
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.querySelectorAll('button,input,select').forEach(b => { b.disabled = true; });
    say(t('histWorking', 'Working…'));
    try { const r = await fn(); say(r?.ok ? t('histDone', 'Done.') : reasons[r?.reason] || r?.reason || t('histActionFailed', 'Could not complete this action.')); }
    catch (e) { say(e.message === 'cancelled' ? t('histSignInCancelled', 'Google sign-in cancelled. Local history is kept.') : t('histCouldNotFinish', 'Could not finish. Check your connection and Google sign-in settings.')); }
    finally {
      busy = false;
      document.querySelectorAll('button,input,select').forEach(b => { b.disabled = false; });
      await paint();
      if (focused && focused.isConnected && !focused.disabled) focused.focus();
    }
  }
  $('historyEnabled').addEventListener('change', () => action(() => chrome.runtime.sendMessage({ type: 'purchaseConfigure', enabled: $('historyEnabled').checked, autoSync: $('historyAutoSync').checked })));
  $('historyAutoSync').addEventListener('change', () => action(() => chrome.runtime.sendMessage({ type: 'purchaseConfigure', enabled: $('historyEnabled').checked, autoSync: $('historyAutoSync').checked })));
  $('orderBadgePlacement').addEventListener('change', () => action(async () => { await chrome.storage.local.set({ orderBadgePlacement: $('orderBadgePlacement').value === 'title' ? 'title' : 'image' }); return { ok: true }; }));
  for (const [id, type] of [['scanStart', 'purchaseScanStart'], ['scanPause', 'purchaseScanPause'], ['scanResume', 'purchaseScanResume'], ['scanCancel', 'purchaseScanCancel']]) $(id).addEventListener('click', () => action(() => chrome.runtime.sendMessage({ type, background: $('scanBackground').checked })));
  $('scanOpen').addEventListener('click', () => { if (conf.historyScan?.tabId !== undefined) chrome.tabs.update(conf.historyScan.tabId, { active: true }).catch(() => say(t('histScanTabClosed', 'The scan tab was closed. Resume to open another.'))); });
  $('signIn').addEventListener('click', () => action(async () => { await auth(); return { ok: true }; }));
  $('sync').addEventListener('click', () => action(async () => chrome.runtime.sendMessage({ type: 'purchaseSync', token: await auth() })));
  $('delete').addEventListener('click', () => { if (confirm(t('histConfirmDelete', 'Delete purchase history from this device and your authenticated account? Import will be switched off. Offline account deletion will remain pending.'))) action(async () => chrome.runtime.sendMessage({ type: 'purchaseDelete', token: undefined })); });
  $('openOrders').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.amazon.com/your-orders/orders' }));
  $('export').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'ingredient-check-purchases', records: H.merge([], conf.purchaseHistory) }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'ingredient-check-purchases.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); });
  let paintTimer;
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && dashboardKeys.some(key => changes[key])) dashboardDirty = true; if (area === 'local' && ['purchaseHistory', 'historyScan', 'historyEnabled', 'historyAutoSync', 'historyOwner', 'historySyncStatus', 'historyDeletePending', 'googleProfile', 'theme', 'palette', 'accent', 'ocrLabels', 'useOpenFoodFacts', 'ratePace', 'orderBadgePlacement', 'hoverBreakdown', 'weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly', 'ratingStyle', 'personalCareEnabled'].some(key => changes[key])) { clearTimeout(paintTimer); paintTimer = setTimeout(() => { void paint(); }, 150); } });
  const reveal = () => {
    if (['#historySettings', '#controls'].includes(location.hash)) $('purchasePreferences').open = true;
    if (location.hash === '#scanHeading') { $('scanControls').open = true; $('scanHeading').scrollIntoView({ block: 'start' }); }
  };
  addEventListener('hashchange', reveal); reveal();
  void paint();
})();
