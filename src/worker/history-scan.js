// User-started navigation in one ordinary Amazon tab. State survives worker suspension.
(function(root) {
  const S = root.AIR.db.historyScan, KEY = 'historyScan', ALARM = 'ic-history-scan';
  let chain = Promise.resolve();
  const serial = fn => { const next = chain.catch(() => {}).then(fn); chain = next; return next; };
  const read = async () => (await chrome.storage.local.get(KEY))[KEY];
  const write = state => chrome.storage.local.set({ [KEY]: state });
  const nonce = () => crypto.randomUUID();
  function arm() { chrome.alarms.create(ALARM, { delayInMinutes: 0.5 }); }
  async function pause(reason = 'user') {
    const state = await read(); if (!state || !['running', 'paused'].includes(state.status)) return { ok: true };
    state.status = 'paused'; state.reason = reason; await write(state); await chrome.alarms.clear(ALARM);
    if (state.tabId !== undefined) chrome.tabs.sendMessage(state.tabId, { type: 'purchaseScanPause' }).catch(() => {});
    return { ok: true };
  }
  async function permitted() {
    const c = await chrome.storage.local.get(['enabled', 'historyEnabled', 'historyDeletePending', 'historyOwner', 'googleProfile']);
    return c.enabled !== false && c.historyEnabled === true && !c.historyDeletePending && (!c.historyOwner || !c.googleProfile?.email || c.historyOwner === c.googleProfile.email.toLowerCase());
  }
  async function start(msg, resume = false) {
    if (!await permitted()) return { ok: false, reason: 'Enable purchase import and use its original Google account before scanning.' };
    const old = await read(); if (old?.status === 'running') return { ok: true };
    const state = resume && old?.status === 'paused' ? { ...old, status: 'running', reason: '', nonce: nonce() } : {
      status: 'running', nonce: nonce(), queue: [], visited: [], pages: 0, orders: 0, years: [], averageMs: 0,
      currentURL: 'https://www.amazon.com/your-orders/orders', startedAt: Date.now(), background: msg.background !== false,
    };
    state.background = msg.background !== false;
    // A dedicated tab avoids changing a shopping tab the user is using.
    if (old?.tabId !== undefined) { try { const previous = await chrome.tabs.get(old.tabId); if (previous.url === 'about:blank' || S.url(previous.url) === old.currentURL) await chrome.tabs.remove(old.tabId); } catch { /* already closed */ } }
    const tab = await chrome.tabs.create({ url: 'about:blank', active: !state.background });
    state.tabId = tab.id; state.awaiting = false; state.pageStartedAt = Date.now(); await write(state); arm();
    setTimeout(() => { void serial(tick).catch(() => pause('The scan tab could not open Amazon Orders. Resume to retry.')); }, 1000);
    return { ok: true };
  }
  async function tick() {
    const state = await read(); if (state?.status !== 'running') return;
    if (!await permitted()) { await pause('Import paused or account changed.'); return; }
    let tab; try { tab = await chrome.tabs.get(state.tabId); } catch { await pause('The scan tab was closed. Resume to open a new one.'); return; }
    if (state.awaiting && tab.status === 'complete' && !S.url(tab.url)) { await pause('Amazon sign-in or verification is required. Open the scan tab, complete it normally, then Resume.'); return; }
    if (state.awaiting && tab.status === 'complete' && S.url(tab.url) && S.url(tab.url) !== state.currentURL) { if (state.visited.includes(S.url(tab.url))) { await pause('Navigation did not reach the next order page. Resume to retry.'); return; } state.currentURL = S.url(tab.url); await write(state); }
    if (state.awaiting) {
      if (Date.now() - state.pageStartedAt > 15 * 60000) { await pause('This page took over 15 minutes. Check the scan tab, then Resume.'); return; }
      try { await chrome.tabs.sendMessage(state.tabId, { type: 'purchaseScanRetry' }); } catch { /* page loading; alarm retries */ }
    } else {
      state.awaiting = true; state.pageStartedAt = Date.now(); await write(state);
      await chrome.tabs.update(state.tabId, { url: state.currentURL });
    }
    arm();
  }
  async function progress(msg, sender) {
    const state = await read();
    if (state?.status !== 'running' || !state.awaiting || sender.tab?.id !== state.tabId || msg.nonce !== state.nonce || S.url(msg.pageURL) !== state.currentURL || S.url(sender.url) !== state.currentURL) return { ok: false, reason: 'wrong-scan-page' };
    if (!await permitted()) { await pause('Import paused or account changed.'); return { ok: false }; }
    if (msg.reason) { await pause(String(msg.reason).slice(0, 200)); return { ok: true }; }
    if (!msg.plan || msg.plan.unsupportedNext || (S.url(msg.plan.next) && state.visited.includes(S.url(msg.plan.next))) || (!msg.items && !msg.plan.empty)) { await pause('This order-page layout could not be read completely. Check the scan tab before resuming.'); return { ok: true }; }
    state.pages++; state.visited.push(state.currentURL);
    state.pageItems = (state.pageItems || 0) + Math.max(0, Math.min(100, Number(msg.items) || 0));
    state.pageOrders = (state.pageOrders || 0) + Math.max(0, Math.min(100, Number(msg.ordersOnPage) || 0));
    state.averageMs = state.averageMs ? state.averageMs * 0.7 + (Date.now() - state.pageStartedAt) * 0.3 : Date.now() - state.pageStartedAt;
    const candidates = [msg.plan.next, ...(Array.isArray(msg.plan.years) ? msg.plan.years.slice(0, 100) : [])].map(S.url).filter(Boolean);
    for (const u of candidates) if (!state.visited.includes(u) && !state.queue.includes(u)) state.queue.push(u);
    state.orderCounts ||= {};
    const period = new URL(state.currentURL).searchParams.get('timeFilter') || new URL(state.currentURL).searchParams.get('orderFilter') || 'recent';
    state.orderCounts[period] = Math.max(state.orderCounts[period] || 0, Math.min(100000, Number(msg.plan.orders) || 0));
    state.orders = Math.max(state.orderCounts.recent || 0, Object.entries(state.orderCounts).filter(([key]) => /^(?:year-)?(?:19|20)\d{2}$/.test(key)).reduce((sum, [, n]) => sum + n, 0)); state.reason = '';
    if (state.pages >= S.MAX_PAGES) { await write(state); await pause('The 2,000-page safety limit was reached. Export your history and review coverage.'); return { ok: true }; }
    if (!state.queue.length) {
      state.status = 'complete'; state.completedAt = Date.now(); await write(state); await chrome.alarms.clear(ALARM);
      // Keep the final tab available for the user to inspect; never close a tab they may be using.
      return { ok: true };
    }
    state.currentURL = state.queue.shift(); state.awaiting = false; await write(state); arm();
    setTimeout(() => { void serial(tick).catch(() => pause('The next page could not be opened. Resume to retry.')); }, 2000);
    return { ok: true };
  }
  function handle(msg, sender, reply) {
    if (!['purchaseScanStart', 'purchaseScanResume', 'purchaseScanPause', 'purchaseScanCancel', 'purchaseScanState', 'purchaseScanProgress'].includes(msg.type)) return false;
    serial(async () => {
      if (msg.type === 'purchaseScanStart' || msg.type === 'purchaseScanResume') return start(msg, msg.type === 'purchaseScanResume');
      if (msg.type === 'purchaseScanPause') return pause();
      if (msg.type === 'purchaseScanCancel') { await pause('Cancelled by you. Imported purchases are kept.'); const state = await read(); if (state) { state.status = 'cancelled'; await write(state); } return { ok: true }; }
      if (msg.type === 'purchaseScanProgress') return progress(msg, sender);
      const state = await read(); return state?.status === 'running' && sender.tab?.id === state.tabId && S.url(sender.url) === state.currentURL ? { ok: true, nonce: state.nonce } : { ok: false };
    }).then(reply, () => reply({ ok: false, reason: 'Scan could not continue. Check storage and your Amazon tab.' }));
    return true;
  }
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void serial(tick).catch(() => pause('The next page could not be opened. Resume to retry.')); });
  chrome.tabs?.onRemoved?.addListener(id => { void serial(async () => { const state = await read(); if (state?.status === 'running' && state.tabId === id) await pause('The scan tab was closed. Resume to continue.'); }); });
  chrome.tabs?.onUpdated?.addListener((id, change, tab) => { if (change.status === 'complete' && tab.url !== 'about:blank') void serial(async () => { const state = await read(); if (state?.status === 'running' && state.tabId === id) { await tick(); } }); });
  chrome.runtime.onStartup?.addListener(() => { void serial(() => pause('Chrome restarted. Resume to continue the saved scan.')); });
  root.AIR.scanWorker = { handle, start, pause, progress, tick };
})(typeof globalThis !== 'undefined' ? globalThis : self);
