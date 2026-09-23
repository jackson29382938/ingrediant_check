// Shared database, diagnostics, and settings online (docs/SETTINGS-SYNC.md, docs/CACHE.md).
// Loaded after settings.js so flash/persist/msg/PREFS/DB_KEYS exist. There are no URLs to paste:
// the endpoint is a constant of the build, and an empty one means everything stays on this computer.

const ONLINE = !!PREFS.endpoint();

function say(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status' + (kind === 'error' ? ' error' : '');
}

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
      }));
    }
    paintDiag();
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
  chrome.storage.local.get(['weights', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
    applyScoring(o);
    flash(msg('optRestored', 'Restored'));
    setTimeout(() => location.reload(), 400);
  });
}

function applyRestored(values) {
  persist(values, ok => { if (ok) reloadWithStored(); });
}

function wireBackup() {
  const restore = document.getElementById('restoreChrome');
  const sync = chrome.storage && chrome.storage.sync;
  const paint = () => {
    if (!sync) { say('backupStatus', 'Chrome sync is not available here', 'error'); return; }
    sync.get(PREFS.SYNC_KEYS, items => {
      const got = PREFS.fromSyncItems(items || {});
      if (restore) restore.disabled = !got.ok;
      say('backupStatus', got.ok && got.ts ? `Last backup ${new Date(got.ts).toLocaleString()}` : 'No backup yet');
    });
  };
  paint();
  if (sync && sync.onChanged) sync.onChanged.addListener(paint);
  if (restore) {
    restore.addEventListener('click', () => {
      sync.get(PREFS.SYNC_KEYS, items => {
        const got = PREFS.fromSyncItems(items || {});
        if (!got.ok) { say('backupStatus', 'No backup yet', 'error'); return; }
        if (!window.confirm('Replace the settings on this computer with the copy from your Chrome account?')) return;
        applyRestored(got.values);
      });
    });
  }
  wireAccount();
}

// Optional Google sign-in. The token goes to the worker for one request and is never stored.
function googleToken() {
  return new Promise((resolve, reject) => {
    const state = crypto.getRandomValues(new Uint32Array(2)).join('-');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: PREFS.OAUTH_CLIENT_ID, response_type: 'token', scope: 'openid',
      redirect_uri: chrome.identity.getRedirectURL(), prompt: 'select_account', state,
    });
    chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }, redirect => {
      if (chrome.runtime.lastError || !redirect) { reject(new Error('cancelled')); return; }
      const got = new URLSearchParams(new URL(redirect).hash.slice(1));
      if (got.get('state') !== state || !got.get('access_token')) { reject(new Error('no-token')); return; }
      resolve(got.get('access_token'));
    });
  });
}

function wireAccount() {
  const block = document.getElementById('accountBlock');
  if (!block || !ONLINE || !PREFS.OAUTH_CLIENT_ID || !chrome.identity) return;
  block.hidden = false;
  const run = (type, done) => {
    say('accountStatus', 'Signing in…');
    googleToken().then(token => {
      say('accountStatus', type === 'accountSave' ? 'Saving…' : 'Loading…');
      chrome.runtime.sendMessage({ type, token }, res => {
        if (chrome.runtime.lastError || !res) { say('accountStatus', 'Could not reach the database', 'error'); return; }
        done(res);
      });
    }, () => say('accountStatus', 'Sign-in cancelled', 'error'));
  };
  document.getElementById('accountSave').addEventListener('click', () => run('accountSave', res =>
    say('accountStatus', res.ok ? 'Saved to your Google account' : `Could not save — ${res.reason}`, res.ok ? '' : 'error')));
  document.getElementById('accountLoad').addEventListener('click', () => {
    if (!window.confirm('Replace the settings on this computer with the copy saved to your Google account?')) return;
    run('accountLoad', res => {
      if (!res.ok) {
        say('accountStatus', res.reason === 'no-backup' ? 'Nothing saved to this account yet' : `Could not load — ${res.reason}`, 'error');
        return;
      }
      reloadWithStored();
    });
  });
}

if (typeof startSettingsPage === 'function') startSettingsPage();
