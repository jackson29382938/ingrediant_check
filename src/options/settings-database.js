// Shared database, diagnostics, and settings online (docs/SETTINGS-SYNC.md, docs/CACHE.md).
// Loaded after settings.js so flash/persist/msg/PREFS exist. There are no URLs to paste:
// the endpoint is a constant of the build, and an empty one means everything stays on this computer.

const ONLINE = !!PREFS.endpoint();
// The toggles this section owns. They go online, so they live here beside what they send.
const DB_KEYS = ['sharedCache', 'sharedProducts', 'shareContributions', 'sendDiagnostics', 'settingsBackup'];

function say(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status' + (kind === 'error' ? ' error' : '');
}

// Shared product readings go through the shared database: with it off, or no database in this
// build, the box would do nothing, so it is shown disabled (its saved value is kept).
function paintSharedProducts() {
  const main = document.getElementById('sharedCache');
  const box = document.getElementById('sharedProducts');
  if (!main || !box) return;
  box.disabled = !PREFS.SHARED_PRODUCTS_ALLOWED || !ONLINE || !main.checked;
  if (!PREFS.SHARED_PRODUCTS_ALLOWED) {
    box.checked = false;
    box.title = 'Shared product exchange is closed pending verification of trust controls.';
  }
  const chip = box.closest('label');
  if (chip) chip.classList.toggle('disabled', box.disabled);
}

// Called by settings.js (startSettingsPage).
/* exported wireDatabase */
function wireDatabase() {
  const notice = document.getElementById('endpointStatus');
  if (notice && !ONLINE) {
    notice.hidden = false;
    notice.textContent = 'The shared database is not set up in this build, so every lookup stays on '
      + 'this computer. The settings backup to your Chrome account still works.';
  }
  chrome.storage.local.get(DB_KEYS, o => {
    const toggles = PREFS.sanitizeToggles(o);
    for (const id of DB_KEYS) {
      const box = document.getElementById(id);
      if (!box) continue;
      box.checked = toggles[id];
      box.addEventListener('change', () => persist({ [id]: box.checked }, ok => {
        if (!ok) return;
        flash(msg('optSaved', 'Saved'));
        if (id === 'sendDiagnostics') paintDiag();
        if (id === 'sharedCache') paintSharedProducts();
      }));
    }
    paintDiag();
    paintSharedProducts();
    wireBackup();
  });

  const flushBtn = document.getElementById('flushDiagnostics');
  if (flushBtn) {
    flushBtn.addEventListener('click', () => {
      say('diagStatus', 'Sending…');
      chrome.runtime.sendMessage({ type: 'flushDiagnostics' }, res => {
        if (chrome.runtime.lastError || !res) { say('diagStatus', 'Could not reach the database', 'error'); return; }
        say('diagStatus', res.ok ? `Sent ${res.sent} rows`
          : res.reason === 'nothing-to-send' ? 'Nothing queued'
          : `Could not send — ${res.reason} (${res.queued || 0} still queued)`, res.ok ? '' : 'error');
      });
    });
  }

  const refresh = document.getElementById('refreshSheet');
  if (refresh) {
    refresh.addEventListener('click', () => {
      if (!ONLINE) { say('sheetStatus', 'Not set up in this build', 'error'); return; }
      say('sheetStatus', 'Fetching…');
      chrome.runtime.sendMessage({ type: 'refreshSheet' }, res => {
        if (chrome.runtime.lastError || !res || !res.ok) {
          say('sheetStatus', 'Could not reach the database — is the shared database switched off?', 'error');
          return;
        }
        say('sheetStatus', `Loaded ${res.count} product records and ${res.producers || 0} producers`);
      });
    });
  }
}

function paintDiag() {
  chrome.runtime.sendMessage({ type: 'diagnosticsStatus' }, res => {
    if (chrome.runtime.lastError || !res) return;
    say('diagStatus', !res.configured ? 'Not set up in this build'
      : res.queued ? `${res.queued} row${res.queued === 1 ? '' : 's'} waiting to send`
      : 'Nothing queued');
  });
}

// ---------------------------------------------------------------- settings online

// Restoring rewrites most of what this page shows, so the page reloads. The page state is set to
// what is now stored first: the pagehide handler in settings.js saves that state on the way out,
// and with the old values still in it, it wrote them straight back over the restore.
function reloadWithStored() {
  chrome.storage.local.get(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
    applyScoring(o);
    flash(msg('optRestored', 'Restored'));
    setTimeout(() => location.reload(), 400);
  });
}

function applyRestored(values) {
  persist(values, ok => { if (ok) reloadWithStored(); });
}

function wireBackup() {
  document.getElementById('openChromeProfile')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://settings/people' }).catch(() => say('backupStatus', 'Could not open Chrome profile settings', 'error'));
  });
  const restore = document.getElementById('restoreChrome');
  const sync = chrome.storage && chrome.storage.sync;
  const paint = () => {
    if (!sync) { say('backupStatus', 'Chrome sync is not available here', 'error'); return; }
    PREFS.readSync(sync).then(got => {
      if (restore) restore.disabled = !got.ok;
      chrome.storage.local.get('backupStatus', local => {
        const failed = local.backupStatus && local.backupStatus.ok === false;
        say('backupStatus', failed ? 'Latest backup failed. Your previous copy is retained; check Chrome sync and try changing a setting again.'
          : got.reason === 'incomplete-backup' ? 'Chrome is still syncing this backup. Try again shortly.'
          : got.ok && got.ts ? `Last backup ${new Date(got.ts).toLocaleString()}` : 'No backup yet', failed ? 'error' : '');
      });
    }).catch(() => say('backupStatus', 'Could not read your Chrome backup', 'error'));
  };
  paint();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' || (area === 'local' && changes.backupStatus)) paint();
  });
  if (restore) {
    restore.addEventListener('click', () => {
      PREFS.readSync(sync).then(got => {
        if (!got.ok) { say('backupStatus', got.reason === 'incomplete-backup' ? 'Backup is still syncing. Try again shortly.' : 'No readable backup yet', 'error'); return; }
        if (!window.confirm('Replace the settings on this computer with the copy from your Chrome account?')) return;
        applyRestored(got.values);
      }).catch(() => say('backupStatus', 'Could not read your Chrome backup', 'error'));
    });
  }
  wireAccount();
}

// Sign-in is scoped to a single explicit save/restore. Tokens remain in memory only.
function wireAccount() {
  const block = document.getElementById('accountBlock');
  if (!block) return;
  block.hidden = false;
  const save = document.getElementById('accountSave');
  const load = document.getElementById('accountLoad');
  const setup = document.getElementById('accountSetup');
  const field = document.getElementById('oauthClientId');
  let clientId = '';
  let busy = false;
  const paint = () => {
    save.disabled = load.disabled = busy || !ONLINE || !clientId;
  };
  const read = () => chrome.storage.local.get('oauthClientId', o => {
    clientId = PREFS.oauthClientId(o.oauthClientId) || PREFS.oauthClientId(PREFS.OAUTH_CLIENT_ID);
    field.value = clientId;
    setup.open = !clientId;
    paint();
    if (!ONLINE) say('accountStatus', 'The account database is not configured in this build.', 'error');
    else if (!clientId) say('accountStatus', 'Google sign-in needs a registered OAuth client ID. Chrome profile backup works independently.');
  });
  const redirect = chrome.identity ? chrome.identity.getRedirectURL() : `https://${chrome.runtime.id}.chromiumapp.org/`;
  document.getElementById('accountRedirect').textContent = 'Redirect address: ' + redirect;
  document.getElementById('copyAccountRedirect').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(redirect);
      say('accountStatus', 'Redirect address copied. Add it to the OAuth client’s authorized redirect URIs.');
    } catch (e) {
      say('accountStatus', 'Could not copy. Select and copy the redirect address shown above.', 'error');
    }
  });
  document.getElementById('saveAccountSetup').addEventListener('click', () => {
    const id = PREFS.oauthClientId(field.value);
    if (!id) { say('accountStatus', 'Enter a Google client ID ending in .apps.googleusercontent.com', 'error'); return; }
    persist({ oauthClientId: id }, ok => { if (ok) { read(); say('accountStatus', 'Configuration saved. The database owner must configure this same client ID.'); } });
  });
  read();
  const run = async type => {
    if (busy || !clientId) return;
    busy = true; paint(); say('accountStatus', 'Signing in…');
    try {
      // Request optional identity access directly from the button's user gesture.
      if (!await chrome.permissions.request({ permissions: ['identity'] })) throw new Error('permission-denied');
      const token = await AIR.googleAuth.token(chrome, clientId);
      say('accountStatus', type === 'accountSave' ? 'Saving…' : 'Loading…');
      const res = await chrome.runtime.sendMessage({ type, token });
      if (!res || !res.ok) throw new Error(res && res.reason || 'network');
      if (type === 'accountLoad') reloadWithStored();
      else say('accountStatus', 'Saved to your Google account');
    } catch (e) {
      const messages = { cancelled: 'Sign-in cancelled. Your settings are unchanged.',
        'permission-denied': 'Google sign-in permission was not granted.',
        'auth-failed': 'Google sign-in could not start or complete. Register the redirect address in Configure Google sign-in and check the app’s test-user access.',
        'invalid-redirect': 'Google returned an unexpected redirect. Check the registered redirect address.',
        'no-token': 'Google did not return a valid sign-in token.',
        'no-backup': 'Nothing saved to this Google account yet.',
        'storage-error': 'Could not save settings on this computer. Please try again.',
        'Error: accounts are not configured': 'The database owner must configure Google account storage before sign-in can save or restore.',
        'Error: token rejected': 'The database did not accept this Google sign-in. Check that its OAuth client ID matches this extension.' };
      say('accountStatus', messages[e.message] || 'Could not complete the account request. Check the OAuth client, database deployment, and connection.', 'error');
    } finally { busy = false; paint(); }
  };
  save.addEventListener('click', () => run('accountSave'));
  load.addEventListener('click', () => {
    if (!window.confirm('Replace the settings on this computer with the copy saved to your Google account?')) return;
    run('accountLoad');
  });
}

if (typeof startSettingsPage === 'function') startSettingsPage();
