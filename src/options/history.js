(function () {
  const H = AIR.db.purchaseHistory,
    $ = id => document.getElementById(id);
  let conf = {},
    busy = false,
    dashboardDirty = true;
  const dashboardKeys = [
    'purchaseHistory',
    'theme',
    'palette',
    'accent',
    'weights',
    'goals',
    'goalImportance',
    'allergens',
    'diets',
    'avoidList',
    'foodOnly',
  ];
  const reasons = {
    'backend-capacity-update-required':
      'History is kept locally. Update the Apps Script backend before syncing more than its current history capacity.',
    pending: 'New purchases are saved locally and waiting for automatic sync.',
    'local-only': 'New purchases are saved locally. Automatic sync is off; use Sync now to upload them.',
    'delete-pending': 'Account deletion is still pending. Complete deletion before enabling import.',
    'backend-update-required':
      'The account backend needs the purchase-history update. Your history remains local; no purchase data was sent.',
    'account-changed':
      'This local history belongs to another Google account. Sign in to that account before syncing or deleting its account copy.',
    'needs-sign-in-or-network':
      'Sync needs Google sign-in or a working connection. Your local history is kept, and automatic sync will retry.',
    'history-full': 'The 10,000-entry limit has been reached. Export your history before removing entries.',
    off: 'Import or automatic sync is off.',
    deleted: 'History deleted from this device and the authenticated account.',
  };
  function say(text) {
    $('status').textContent = text;
  }
  async function paint() {
    conf = await chrome.storage.local.get([
      'purchaseHistory',
      'historyEnabled',
      'historyAutoSync',
      'historyOwner',
      'historySyncStatus',
      'historyDeletePending',
      'googleProfile',
      'oauthClientId',
      'theme',
      'palette',
      'accent',
      'ocrLabels',
      'useOpenFoodFacts',
      'ratePace',
      'orderBadgePlacement',
      'hoverBreakdown',
      'historyScan',
      'weights',
      'goals',
      'goalImportance',
      'allergens',
      'diets',
      'avoidList',
      'foodOnly',
    ]);
    AIR.db.theme.use(conf);
    AIR.db.theme.force(document);
    $('historyEnabled').checked = conf.historyEnabled === true;
    $('historyAutoSync').checked = conf.historyAutoSync !== false;
    const toggles = AIR.db.prefs.sanitizeToggles(conf);
    const onOff = flag => (flag ? 'on' : 'off');
    const pace = ['gentle', 'normal', 'quick', 'fast'].includes(conf.ratePace) ? conf.ratePace : 'normal';
    $('readingSummary').textContent =
      `Shared settings: label photos ${onOff(toggles.ocrLabels)} · barcode lookup ${onOff(toggles.useOpenFoodFacts)} · ` +
      `fetching pace ${pace} · hover details ${onOff(toggles.hoverBreakdown)}.`;
    $('account').textContent = conf.googleProfile?.email
      ? `Signed in: ${conf.googleProfile.email}`
      : 'Not signed in. Import can work locally; account sync waits for Google sign-in.';
    $('orderBadgePlacement').value = conf.orderBadgePlacement === 'title' ? 'title' : 'image';
    const scan = conf.historyScan;
    if (scan && !busy) $('scanBackground').checked = scan.background !== false;
    const estimate = AIR.db.historyScan.estimate(scan || {}),
      minutes = seconds => (seconds < 60 ? 'under 1 minute' : `${Math.ceil(seconds / 60)} minutes`);
    const SCAN_STATUS = { complete: 'Scan complete', running: 'Scanning', paused: 'Scan paused' };
    $('scanStatus').textContent = scan
      ? `${Object.hasOwn(SCAN_STATUS, scan.status) ? SCAN_STATUS[scan.status] : 'Scan cancelled'} · ${scan.pages || 0} pages imported.` +
        (scan.status === 'running'
          ? ` Remaining estimate: ${minutes(estimate.lowSeconds)}–${minutes(estimate.highSeconds)} for at least ${estimate.pages} known remaining pages. More pages may be discovered.`
          : '') +
        ` ${scan.reason || ''}`
      : 'No full-history scan started. Enable import, then start a scan.';
    if (!busy) {
      $('scanStart').disabled = !conf.historyEnabled || scan?.status === 'running';
      $('scanPause').disabled = scan?.status !== 'running';
      $('scanResume').disabled = scan?.status !== 'paused';
      $('scanCancel').disabled = !['running', 'paused'].includes(scan?.status);
      $('scanOpen').disabled = scan?.tabId === undefined;
    }
    const status = conf.historySyncStatus;
    if (!busy)
      say(
        conf.historyDeletePending
          ? 'Local history cleared. Account deletion is pending; sign in to its Google account and click Sync now.'
          : status
            ? status.ok
              ? status.reason === 'deleted'
                ? reasons.deleted
                : `Synced ${new Date(status.at).toLocaleString()}`
              : reasons[status.reason] || 'Sync has not completed. Local history is kept.'
            : 'No account sync yet.'
      );
    const estimateTotal = (scan?.pages || 0) + estimate.pages;
    if (!scan || (scan.status !== 'running' && !scan.pages)) $('scanProgress').value = 0;
    else if (scan.status === 'complete') $('scanProgress').value = 100;
    else if (estimateTotal > 0 && scan?.pages) $('scanProgress').value = Math.min(99, (scan.pages / estimateTotal) * 100);
    else $('scanProgress').removeAttribute('value');
    $('scanProgress').setAttribute(
      'aria-label',
      scan?.status === 'complete'
        ? 'Order-page scan complete'
        : 'Estimated order-page scan progress; total may grow as years are discovered'
    );
    $('scanProgressNote').textContent = scan
      ? `${scan.pages || 0} pages finished · ${scan.pageOrders || 0} order appearances · ${scan.pageItems || 0} product-entry appearances processed. ` +
        'Pages revisited across filters can overlap; deduplicated purchase totals are shown below. ' +
        (scan.status !== 'complete' ? 'Progress is an estimate and may decrease when more pages are discovered.' : '')
      : 'Start a scan to see progress.';
    if (dashboardDirty) {
      dashboardDirty = false;
      void AIR.historyDashboard.update(conf);
    }
  }
  async function auth() {
    const granted = await chrome.permissions.request({ permissions: ['identity'] });
    if (!granted) throw new Error('Google sign-in permission was not granted.');
    const token = await AIR.googleAuth.token(
      chrome,
      AIR.db.prefs.oauthClientId(conf.oauthClientId) || AIR.db.prefs.OAUTH_CLIENT_ID
    );
    const who = await AIR.googleAuth.profile(token);
    await chrome.storage.local.set({ googleProfile: { ...who, at: Date.now() } });
    return token;
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button,input,select').forEach(b => {
      b.disabled = true;
    });
    say('Working…');
    try {
      const r = await fn();
      say(r?.ok ? 'Done.' : reasons[r?.reason] || r?.reason || 'Could not complete this action.');
    } catch (e) {
      say(
        e.message === 'cancelled'
          ? 'Google sign-in cancelled. Local history is kept.'
          : 'Could not finish. Check your connection and Google sign-in settings.'
      );
    } finally {
      busy = false;
      document.querySelectorAll('button,input,select').forEach(b => {
        b.disabled = false;
      });
      await paint();
    }
  }
  $('historyEnabled').addEventListener('change', () =>
    action(() =>
      chrome.runtime.sendMessage({
        type: 'purchaseConfigure',
        enabled: $('historyEnabled').checked,
        autoSync: $('historyAutoSync').checked,
      })
    )
  );
  $('historyAutoSync').addEventListener('change', () =>
    action(() =>
      chrome.runtime.sendMessage({
        type: 'purchaseConfigure',
        enabled: $('historyEnabled').checked,
        autoSync: $('historyAutoSync').checked,
      })
    )
  );
  $('orderBadgePlacement').addEventListener('change', () =>
    action(async () => {
      await chrome.storage.local.set({ orderBadgePlacement: $('orderBadgePlacement').value === 'title' ? 'title' : 'image' });
      return { ok: true };
    })
  );
  for (const [id, type] of [
    ['scanStart', 'purchaseScanStart'],
    ['scanPause', 'purchaseScanPause'],
    ['scanResume', 'purchaseScanResume'],
    ['scanCancel', 'purchaseScanCancel'],
  ])
    $(id).addEventListener('click', () =>
      action(() => chrome.runtime.sendMessage({ type, background: $('scanBackground').checked }))
    );
  $('scanOpen').addEventListener('click', () => {
    if (conf.historyScan?.tabId !== undefined)
      chrome.tabs
        .update(conf.historyScan.tabId, { active: true })
        .catch(() => say('The scan tab was closed. Resume to open another.'));
  });
  $('signIn').addEventListener('click', () =>
    action(async () => {
      await auth();
      return { ok: true };
    })
  );
  $('sync').addEventListener('click', () =>
    action(async () => chrome.runtime.sendMessage({ type: 'purchaseSync', token: await auth() }))
  );
  $('delete').addEventListener('click', () => {
    if (
      confirm(
        'Delete purchase history from this device and your authenticated account? Import will be switched off. Offline account deletion will remain pending.'
      )
    )
      action(async () =>
        chrome.runtime.sendMessage({ type: 'purchaseDelete', token: conf.historyOwner ? await auth() : undefined })
      );
  });
  $('openOrders').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.amazon.com/your-orders/orders' }));
  $('export').addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ format: 'ingredient-check-purchases', records: H.merge([], conf.purchaseHistory) }, null, 2)], {
        type: 'application/json',
      })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ingredient-check-purchases.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  let paintTimer;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && dashboardKeys.some(key => changes[key])) dashboardDirty = true;
    if (
      area === 'local' &&
      [
        'purchaseHistory',
        'historyScan',
        'historyEnabled',
        'historyAutoSync',
        'historyOwner',
        'historySyncStatus',
        'historyDeletePending',
        'googleProfile',
        'theme',
        'palette',
        'accent',
        'ocrLabels',
        'useOpenFoodFacts',
        'ratePace',
        'orderBadgePlacement',
        'hoverBreakdown',
        'weights',
        'goals',
        'goalImportance',
        'allergens',
        'diets',
        'avoidList',
        'foodOnly',
      ].some(key => changes[key])
    ) {
      clearTimeout(paintTimer);
      paintTimer = setTimeout(() => {
        void paint();
      }, 150);
    }
  });
  const reveal = () => {
    if (['#historySettings', '#controls'].includes(location.hash)) $('purchasePreferences').open = true;
  };
  addEventListener('hashchange', reveal);
  reveal();
  void paint();
})();
