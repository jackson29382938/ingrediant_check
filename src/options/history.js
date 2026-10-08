(function() {
  const H = AIR.db.purchaseHistory, $ = id => document.getElementById(id);
  let conf = {}, busy = false;
  const reasons = { pending: 'New purchases are saved locally and waiting for automatic sync.', 'local-only': 'New purchases are saved locally. Automatic sync is off; use Sync now to upload them.', 'delete-pending': 'Account deletion is still pending. Complete deletion before enabling import.', 'backend-update-required': 'The account backend needs the purchase-history update. Your history remains local; no purchase data was sent.', 'account-changed': 'This local history belongs to another Google account. Sign in to that account before syncing or deleting its account copy.', 'needs-sign-in-or-network': 'Sync needs Google sign-in or a working connection. Your local history is kept, and automatic sync will retry.', 'history-full': 'The 1,000-entry limit has been reached. Export your history before removing entries.', off: 'Import or automatic sync is off.', deleted: 'History deleted from this device and the authenticated account.' };
  function say(text) { $('status').textContent = text; }
  function row(target, values) { const tr = document.createElement('tr'); for (const v of values) { const td = document.createElement('td'); td.textContent = String(v ?? '—'); tr.append(td); } target.append(tr); }
  async function paint() {
    conf = await chrome.storage.local.get(['purchaseHistory', 'historyEnabled', 'historyAutoSync', 'historyOwner', 'historySyncStatus', 'historyDeletePending', 'googleProfile', 'oauthClientId', 'theme', 'palette', 'accent', 'ocrLabels', 'useOpenFoodFacts', 'ratePace']);
    AIR.db.theme.use(conf); AIR.db.theme.force(document);
    $('historyEnabled').checked = conf.historyEnabled === true; $('historyAutoSync').checked = conf.historyAutoSync !== false;
    const toggles = AIR.db.prefs.sanitizeToggles(conf); $('ocrLabels').checked = toggles.ocrLabels; $('useOpenFoodFacts').checked = toggles.useOpenFoodFacts; $('ratePace').value = ['gentle', 'normal', 'quick', 'fast'].includes(conf.ratePace) ? conf.ratePace : 'normal';
    $('account').textContent = conf.googleProfile?.email ? `Signed in: ${conf.googleProfile.email}` : 'Not signed in. Import can work locally; account sync waits for Google sign-in.';
    const status = conf.historySyncStatus;
    if (!busy) say(conf.historyDeletePending ? 'Local history cleared. Account deletion is pending; sign in to its Google account and click Sync now.' : status ? status.ok ? status.reason === 'deleted' ? reasons.deleted : `Synced ${new Date(status.at).toLocaleString()}` : reasons[status.reason] || 'Sync has not completed. Local history is kept.' : 'No account sync yet.');
    const records = H.merge([], conf.purchaseHistory), purchases = records.filter(r => r.state === 'purchased'), rated = purchases.filter(r => r.score !== null);
    $('coverage').textContent = `${rated.length} of ${purchases.length} imported purchases rated. ${records.length - purchases.length} cancelled, returned or unconfirmed entries excluded. ${purchases.filter(r => r.ingredients).length} ingredient lists available for warning checks.`;
    $('months').replaceChildren(); const profiles = new Map();
    for (const g of H.trends(records)) { const key = g.profile + ':' + g.version; if (!profiles.has(key)) profiles.set(key, profiles.size + 1); row($('months'), [g.month, `Setup ${profiles.get(key)} · ${g.version}`, g.average, `${g.rated}/${g.total}`, g.flagged]); }
    $('items').replaceChildren(); for (const r of records) row($('items'), [r.date, r.name, r.state, r.score, r.scoredAt ? new Date(r.scoredAt).toLocaleDateString() : 'Unavailable']);
    const counts = new Map(); for (const r of purchases) { const v = counts.get(r.asin) || { name: r.name, count: 0 }; v.count++; counts.set(r.asin, v); }
    $('products').replaceChildren(); for (const v of [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 10)) { const li = document.createElement('li'); li.textContent = `${v.name} — ${v.count} orders`; $('products').append(li); }
  }
  async function auth() {
    const granted = await chrome.permissions.request({ permissions: ['identity'] }); if (!granted) throw new Error('Google sign-in permission was not granted.');
    const token = await AIR.googleAuth.token(chrome, AIR.db.prefs.oauthClientId(conf.oauthClientId) || AIR.db.prefs.OAUTH_CLIENT_ID);
    const who = await AIR.googleAuth.profile(token); await chrome.storage.local.set({ googleProfile: { ...who, at: Date.now() } }); return token;
  }
  async function action(fn) {
    if (busy) return; busy = true; document.querySelectorAll('button,input,select').forEach(b => { b.disabled = true; }); say('Working…');
    try { const r = await fn(); say(r?.ok ? 'Done.' : reasons[r?.reason] || r?.reason || 'Could not complete this action.'); }
    catch (e) { say(e.message === 'cancelled' ? 'Google sign-in cancelled. Local history is kept.' : 'Could not finish. Check your connection and Google sign-in settings.'); }
    finally { busy = false; document.querySelectorAll('button,input,select').forEach(b => { b.disabled = false; }); await paint(); }
  }
  $('historyEnabled').addEventListener('change', () => action(() => chrome.runtime.sendMessage({ type: 'purchaseConfigure', enabled: $('historyEnabled').checked, autoSync: $('historyAutoSync').checked })));
  $('historyAutoSync').addEventListener('change', () => action(() => chrome.runtime.sendMessage({ type: 'purchaseConfigure', enabled: $('historyEnabled').checked, autoSync: $('historyAutoSync').checked })));
  $('ocrLabels').addEventListener('change', () => action(async () => { await chrome.storage.local.set({ ocrLabels: $('ocrLabels').checked }); return { ok: true }; }));
  $('useOpenFoodFacts').addEventListener('change', () => action(async () => {
    const enabled = $('useOpenFoodFacts').checked;
    if (enabled && !await chrome.permissions.request({ origins: ['https://world.openfoodfacts.org/*'] })) return { ok: false, reason: 'Barcode lookup permission was not granted.' };
    await chrome.storage.local.set({ useOpenFoodFacts: enabled }); return { ok: true };
  }));
  $('ratePace').addEventListener('change', () => action(async () => { await chrome.storage.local.set({ ratePace: $('ratePace').value }); return { ok: true }; }));
  $('signIn').addEventListener('click', () => action(async () => { await auth(); return { ok: true }; }));
  $('sync').addEventListener('click', () => action(async () => chrome.runtime.sendMessage({ type: 'purchaseSync', token: await auth() })));
  $('delete').addEventListener('click', () => { if (confirm('Delete purchase history from this device and your authenticated account? Import will be switched off. Offline account deletion will remain pending.')) action(async () => chrome.runtime.sendMessage({ type: 'purchaseDelete', token: conf.historyOwner ? await auth() : undefined })); });
  $('openOrders').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.amazon.com/your-orders/orders' }));
  $('export').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'ingredient-check-purchases', records: H.merge([], conf.purchaseHistory) }, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'ingredient-check-purchases.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') void paint(); });
  void paint();
})();
