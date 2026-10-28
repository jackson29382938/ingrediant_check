/* global accountRequest, networkRequest */
// Private authenticated storage. Never send history to an older endpoint's contribution handler.
(function(root) {
  const H = root.AIR.db.purchaseHistory, ALARM = 'ic-purchase-sync';
  let chain = Promise.resolve();
  const serial = fn => { const next = chain.catch(() => {}).then(fn); chain = next; return next; };
  const keys = ['purchaseHistory', 'historyEnabled', 'historyAutoSync', 'historyOwner', 'historyDeletePending', 'historyEpoch', 'historyAccount', 'googleProfile', 'oauthClientId', 'enabled'];
  const email = profile => typeof profile?.email === 'string' ? profile.email.toLowerCase() : '';
  function retry(delay = 1) { chrome.alarms.create(ALARM, { delayInMinutes: delay }); }
  async function status(ok, reason = '') { await chrome.storage.local.set({ historySyncStatus: { ok, reason, at: Date.now() } }); }
  async function configure(msg) {
    const old = await chrome.storage.local.get(keys);
    const on = msg.enabled === true;
    if (on && old.historyDeletePending) return { ok: false, reason: 'delete-pending' };
    const values = { historyEnabled: on, historyAutoSync: on && msg.autoSync !== false };
    if (!old.historyOwner && !old.purchaseHistory?.length) values.historyOwner = email(old.googleProfile);
    await chrome.storage.local.set(values);
    if (on && values.historyAutoSync) retry(); else await chrome.alarms.clear(ALARM);
    return { ok: true };
  }
  async function ingest(msg) {
    const conf = await chrome.storage.local.get(keys);
    if (!conf.historyEnabled || conf.enabled === false || conf.historyDeletePending) return { ok: false, reason: 'off' };
    if (conf.historyOwner && email(conf.googleProfile) && conf.historyOwner !== email(conf.googleProfile)) return { ok: false, reason: 'account-changed' };
    if (!Array.isArray(msg.records) || msg.records.length > 100) return { ok: false, reason: 'invalid-records' };
    // Only a record that arrived can change, and only the stored record with the same key can differ from
    // it, so those are compared first. Re-cleaning the whole history to find out that nothing changed
    // cost about 0.4 s of worker time per message at the 10,000-record limit (0.1 s at 3,000), and the
    // order page sends one after every label it reads. The full merge, which can also refuse a record
    // ('history-full', 'invalid-history-identity'), runs only when a record is new or different.
    const arrivedKeys = new Set(msg.records.map(r => r && r.key));
    const stored = Array.isArray(conf.purchaseHistory) ? conf.purchaseHistory : [];
    const touched = stored.filter(r => r && arrivedKeys.has(r.key));
    const arrived = H.merge(touched, msg.records);
    const canonical = list => JSON.stringify(list.map(r => ({ ...H.clean(r), observedAt: 0 })));   // when it was seen is not a change
    if (canonical(H.merge(touched, [])) === canonical(arrived)) return { ok: true, count: stored.length, records: arrived };
    const records = H.merge(conf.purchaseHistory, msg.records);
    await chrome.storage.local.set({ purchaseHistory: records, historySyncStatus: { ok: false, reason: conf.historyAutoSync !== false ? 'pending' : 'local-only', at: Date.now() } });
    if (conf.historyAutoSync !== false) retry();
    return { ok: true, count: records.length, records: records.filter(r => msg.records.some(x => x.key === r.key)) };
  }
  async function capabilities(count = 0) {
    const endpoint = root.AIR.db.prefs.endpoint();
    if (!endpoint) throw new Error('no-endpoint');
    const res = await networkRequest(endpoint, { credentials: 'omit', referrerPolicy: 'no-referrer' }, r => r.ok ? r.json() : null);
    if (res?.history !== true || res.historySchema !== 1) throw new Error('backend-update-required');
    if (count > (Number(res.historyCapacity) || 1000)) throw new Error('backend-capacity-update-required');
  }
  async function sync(token, manual = false) {
    const conf = await chrome.storage.local.get(keys);
    if (conf.enabled === false || (!conf.historyDeletePending && (!conf.historyEnabled || (!manual && conf.historyAutoSync === false)))) return { ok: false, reason: 'off' };
    try {
      if (!email(conf.googleProfile)) throw new Error('needs-sign-in');
      // An account switch never transfers another account's local purchase history.
      if (conf.historyOwner && conf.historyOwner !== email(conf.googleProfile)) throw new Error('account-changed');
      await capabilities(conf.purchaseHistory?.length || 0);
      if (!token) {
        if (!await chrome.permissions.contains({ permissions: ['identity'] })) throw new Error('needs-sign-in');
        token = await root.AIR.googleAuth.token(chrome, root.AIR.db.prefs.oauthClientId(conf.oauthClientId) || root.AIR.db.prefs.OAUTH_CLIENT_ID, { silent: true });
      }
      const who = await root.AIR.googleAuth.profile(token);
      if (email(who) !== email(conf.googleProfile)) throw new Error('account-changed');
      await chrome.storage.local.set({ historyOwner: email(who) });
      const remote = await accountRequest('historyGet', token);
      if (remote.ok !== true || remote.kind !== 'historyGet' || !Array.isArray(remote.records) || !/^[a-f0-9]{64}$/.test(remote.account || '')) throw new Error('read-not-confirmed');
      if (conf.historyAccount && conf.historyAccount !== remote.account) throw new Error('account-changed');
      await chrome.storage.local.set({ historyAccount: remote.account });
      if (conf.historyDeletePending) {
        const deleted = await accountRequest('historyClear', token);
        if (deleted.ok !== true || deleted.kind !== 'historyClear') throw new Error('delete-not-confirmed');
        await chrome.storage.local.set({ historyDeletePending: false, purchaseHistory: [], historyOwner: '', historyEpoch: deleted.clearedAt, historyAccount: '' });
        await status(true, 'deleted'); await chrome.alarms.clear(ALARM); return { ok: true };
      }
      const epoch = Number(remote.clearedAt) || 0;
      const afterClear = epoch && conf.historyEpoch !== epoch ? [] : conf.purchaseHistory || [];
      const merged = H.merge(afterClear, remote.records);
      // Save the merged local copy before uploads, so interrupted sync retains every record.
      await chrome.storage.local.set({ purchaseHistory: merged, historyEpoch: epoch });
      const remoteByKey = new Map(H.merge([], remote.records).map(r => [r.key, JSON.stringify(r)]));
      const pending = merged.filter(r => remoteByKey.get(r.key) !== JSON.stringify(r));
      for (let i = 0; i < pending.length; i += 100) {
        const current = await chrome.storage.local.get(keys);
        if (!current.historyEnabled || current.enabled === false || (!manual && current.historyAutoSync === false) || current.historyOwner !== email(current.googleProfile)) throw new Error('off');
        const written = await accountRequest('historyPut', token, { epoch, records: pending.slice(i, i + 100) });
        if (written.ok !== true || written.kind !== 'historyPut') throw new Error('write-not-confirmed');
      }
      await status(true); await chrome.alarms.clear(ALARM); return { ok: true, count: merged.length };
    } catch (e) {
      const reason = ['backend-update-required', 'backend-capacity-update-required', 'account-changed', 'off', 'history-full', 'no-endpoint'].includes(e.message) ? e.message : 'needs-sign-in-or-network';
      await status(false, reason);
      if (reason !== 'off') retry(5);
      return { ok: false, reason };
    }
  }
  async function clear(token) {
    const conf = await chrome.storage.local.get(keys);
    await chrome.storage.local.set({ purchaseHistory: [], historyEnabled: false, historyAutoSync: false, historyDeletePending: !!conf.historyOwner });
    if (conf.historyOwner) return sync(token, true);
    await status(true, 'deleted'); return { ok: true };
  }
  function handle(msg, sender, reply) {
    if (msg.type === 'purchaseOpenHistory') { chrome.tabs.create({ url: chrome.runtime.getURL('src/options/history.html') }).then(() => reply({ ok: true }), () => reply({ ok: false })); return true; }
    if (!['purchaseImport', 'purchaseSync', 'purchaseConfigure', 'purchaseDelete'].includes(msg.type)) return false;
    serial(() => msg.type === 'purchaseImport' ? ingest(msg) : msg.type === 'purchaseConfigure' ? configure(msg) : msg.type === 'purchaseDelete' ? clear(msg.token) : sync(msg.token, true)).then(reply, e => reply({ ok: false, reason: e.message === 'history-full' ? e.message : 'storage-error' }));
    return true;
  }
  chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) serial(() => sync()).catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.purchaseHistory || changes.googleProfile) chrome.storage.local.get(keys).then(c => { if (c.historyDeletePending || (c.historyEnabled && c.historyAutoSync !== false)) retry(); });
  });
  root.AIR.historyWorker = { handle, ingest, configure, sync: (token, manual) => serial(() => sync(token, manual)), clear: token => serial(() => clear(token)) };
})(typeof globalThis !== 'undefined' ? globalThis : self);
