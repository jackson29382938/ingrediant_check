// Shared database, diagnostics, and settings online (docs/SETTINGS-SYNC.md, docs/CACHE.md).
// Loaded after settings.js so flash/persist/msg/PREFS exist. There are no URLs to paste:
// the endpoint is a constant of the build, and an empty one means everything stays on this computer.

const ONLINE = !!PREFS.endpoint();
// The toggles this section owns. They go online, so they live here beside what they send.
const DB_KEYS = ['sharedCache', 'sharedProducts', 'shareContributions', 'sendDiagnostics', 'settingsBackup'];
let backupBusy = false;
let chromeRestoreAvailable = false;
let accountAvailable = false;
let accountSignInAvailable = false;
// Set by wireAccount while signed in: fetches the Google copy (not applying it) for "Check my backups".
let googleCopy = null;

function paintBackupControls() {
  const restore = document.getElementById('restoreChrome');
  if (restore) restore.disabled = backupBusy || !chromeRestoreAvailable;
  for (const id of ['accountSave', 'accountLoad']) {
    const element = document.getElementById(id);
    if (element) element.disabled = backupBusy || !accountAvailable;
  }
  const signIn = document.getElementById('accountSignIn');
  if (signIn) signIn.disabled = backupBusy || !accountSignInAvailable;
  for (const id of ['oauthClientId', 'saveAccountSetup']) {
    const element = document.getElementById(id);
    if (element) element.disabled = backupBusy;
  }
}

function setBackupBusy(on) {
  backupBusy = on;
  paintBackupControls();
}


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
    // An import, a restore or another page can change these while this one is open.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      const changed = DB_KEYS.filter(id => changes[id]);
      if (!changed.length) return;
      const now = PREFS.sanitizeToggles(Object.fromEntries(changed.map(id => [id, changes[id].newValue])));
      for (const id of changed) { const box = document.getElementById(id); if (box) box.checked = now[id]; }
      paintSharedProducts();
    });
  });

  const flushBtn = document.getElementById('flushDiagnostics');
  if (flushBtn) {
    flushBtn.addEventListener('click', () => {
      say('diagStatus', 'Sending…');
      chrome.runtime.sendMessage({ type: 'flushDiagnostics' }, res => {
        if (chrome.runtime.lastError || !res) { say('diagStatus', 'Could not reach the database', 'error'); return; }
        say('diagStatus', res.ok ? `Sent ${res.sent} rows`
          : res.reason === 'backend-update-required' ? `Update the Apps Script deployment to support diagnostic outcomes. ${res.queued} rows are kept locally.`
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
      : res.reason === 'backend-update-required' ? 'Diagnostic rows are kept locally. Update the Apps Script deployment, then try Send now.'
      : res.queued ? `${res.queued} row${res.queued === 1 ? '' : 's'} waiting to send`
      : 'Nothing queued');
  });
}

// ---------------------------------------------------------------- settings online

// Restoring rewrites most of what this page shows, so the page reloads. The page state is set to
// what is now stored first: the pagehide handler in settings.js saves that state on the way out,
// and with the old values still in it, it wrote them straight back over the restore.
function reloadWithStored() {
  return new Promise(resolve => {
    chrome.storage.local.get(['weights', 'goals', 'goalImportance', 'allergens', 'diets', 'avoidList', 'foodOnly'], o => {
      // A committed restore must never leave an old scoring state ready to write on pagehide.
      // Reload immediately while the restore guard still suppresses that old write.
      if (chrome.runtime.lastError) { location.reload(); resolve(); return; }
      applyScoring(o);
      flash(msg('optRestored', 'Restored'));
      setTimeout(() => { location.reload(); resolve(); }, 400);
    });
  });
}

function applyRestored(values) {
  return new Promise((resolve, reject) => {
    persist(values, ok => {
      if (!ok) { reject(new Error('storage-error')); return; }
      reloadWithStored().then(resolve, reject);
    });
  });
}

function wireBackup() {
  document.getElementById('openChromeProfile')?.addEventListener('click', () => {
    chrome.tabs.create({ url: AIR.browser?.firefox ? 'about:preferences#sync' : 'chrome://settings/people' }).catch(() => say('backupStatus', 'Could not open Chrome profile settings', 'error'));
  });
  const restore = document.getElementById('restoreChrome');
  const sync = chrome.storage && chrome.storage.sync;
  let paintVersion = 0;
  const paint = () => {
    const version = ++paintVersion;
    if (!sync) { say('backupStatus', 'Chrome sync is not available here', 'error'); return; }
    PREFS.readSync(sync).then(got => {
      if (version !== paintVersion) return;
      chromeRestoreAvailable = got.ok;
      paintBackupControls();
      chrome.storage.local.get('backupStatus', local => {
        if (version !== paintVersion) return;
        const failed = local.backupStatus && local.backupStatus.ok === false;
        say('backupStatus', failed ? 'Latest backup failed. Your previous copy is retained; check Chrome sync and try changing a setting again.'
          : got.reason === 'incomplete-backup' ? 'Chrome is still syncing this backup. Try again shortly.'
          : got.ok && got.ts ? `Last backup ${new Date(got.ts).toLocaleString()}` : 'No backup yet', failed ? 'error' : '');
      });
    }).catch(() => {
      if (version !== paintVersion) return;
      chromeRestoreAvailable = false;
      paintBackupControls();
      say('backupStatus', 'Could not read your Chrome backup', 'error');
    });
  };
  paint();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' || (area === 'local' && changes.backupStatus)) paint();
  });
  if (restore) {
    restore.disabled = true;
    restore.addEventListener('click', async () => {
      if (backupBusy || !sync) return;
      setBackupBusy(true);
      try {
        const got = await PREFS.readSync(sync);
        if (!got.ok) { say('backupStatus', got.reason === 'incomplete-backup' ? 'Backup is still syncing. Try again shortly.' : 'No readable backup yet', 'error'); return; }
        if (!window.confirm('Replace the settings on this computer with the copy from your Chrome account?')) return;
        await AIR.settingsRestore?.begin();
        await applyRestored(got.values);
      } catch (e) {
        say('backupStatus', e.message === 'storage-error' ? 'Could not restore settings on this computer. Please try again.' : 'Could not read your Chrome backup', 'error');
      } finally { AIR.settingsRestore?.complete(); setBackupBusy(false); }
    });
  }
  wireAccount();
  wireBackupCheck();
}

// Check every setting against each saved copy for this Chrome profile: this browser's storage, the
// Chrome profile backup (chrome.storage.sync) and, when signed in, the Google copy. Names the
// settings that differ. A change made a moment ago reaches the Chrome copy within a few seconds.
function wireBackupCheck() {
  const button = document.getElementById('checkBackups');
  const out = document.getElementById('backupCheck');
  if (!button || !out) return;
  const line = (text, bad) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (bad) li.className = 'bad';
    out.appendChild(li);
  };
  const report = (label, got, stored) => {
    if (!got || !got.ok) {
      line(`${label}: ${got && got.reason === 'no-backup' ? 'nothing saved yet' : got && got.reason === 'incomplete-backup' ? 'still syncing, check again shortly' : 'could not be read'}.`, true);
      return;
    }
    const d = PREFS.diffSettings(stored, got.values);
    const when = got.ts ? ` (saved ${new Date(got.ts).toLocaleString()})` : '';
    if (d.differing.length) line(`${label}: ${d.differing.length} of ${d.total} settings differ: ${d.differing.join(', ')}.`, true);
    else line(`${label}: all ${d.total} settings match${when}.`);
  };
  button.addEventListener('click', async () => {
    if (backupBusy) return;
    button.disabled = true;
    out.textContent = '';
    try {
      const stored = await chrome.storage.local.get(PREFS.SETTING_KEYS);
      line(`This browser: ${Object.keys(PREFS.settingsSnapshot(stored)).length} settings are stored and readable.`);
      const sync = chrome.storage && chrome.storage.sync;
      if (!sync) line('Chrome profile backup: Chrome sync is not available here.', true);
      else report('Chrome profile backup', await PREFS.readSync(sync).catch(() => null), stored);
      if (googleCopy) {
        try {
          const copy = await googleCopy();
          if (copy) report('Google copy', copy, stored);
        } catch (e) { line('Google copy: sign-in did not complete.', true); }
      }
    } catch (e) { line('The check could not finish. Please try again.', true); }
    finally { button.disabled = false; }
  });
}

// Google sign-in. Signing in and storing a backup are separate: sign-in only proves who the reader is
// (shown at the top of this page), and a backup needs the database to be set up as well. Tokens stay
// in memory; only the profile (email, name, picture) is kept, on this computer, to show who is signed in.
function wireAccount() {
  const block = document.getElementById('accountBlock');
  if (!block) return;
  block.hidden = false;
  const el = id => document.getElementById(id);
  const save = el('accountSave');
  const load = el('accountLoad');
  const setup = el('accountSetup');
  const field = el('oauthClientId');
  const auth = AIR.googleAuth;
  let clientId = '';
  let profile = null;

  const paintProfile = () => {
    const header = el('googleHeader');
    if (header) header.hidden = !profile;
    for (const id of ['accountSignedOut']) if (el(id)) el(id).hidden = !!profile;
    for (const id of ['accountSignedIn']) if (el(id)) el(id).hidden = !profile;
    if (setup) setup.hidden = !!profile;
    if (!profile) return;
    el('googleEmail').textContent = profile.email;
    el('googleName').textContent = profile.name;
    el('googleName').hidden = !profile.name;
    el('accountWho').textContent = profile.email;
    const pic = el('googleAvatar');
    if (pic) {
      // A picture Google cannot serve (offline, blocked) just disappears; the email still shows.
      pic.onerror = () => { pic.hidden = true; };
      if (profile.picture) pic.src = profile.picture; else pic.removeAttribute?.('src');
      pic.hidden = !profile.picture;
    }
  };
  const paint = () => {
    accountAvailable = ONLINE && !!clientId;
    accountSignInAvailable = !!clientId;
    paintBackupControls();
  };
  const readProfile = () => chrome.storage.local.get('googleProfile', o => {
    profile = auth && auth.cleanProfile ? auth.cleanProfile(o && o.googleProfile) : null;
    paintProfile();
  });
  const read = () => chrome.storage.local.get('oauthClientId', o => {
    if (chrome.runtime.lastError) {
      clientId = ''; paint();
      say('accountStatus', 'Could not read your Google sign-in configuration. Reload this page to retry.', 'error');
      return;
    }
    clientId = PREFS.oauthClientId(o.oauthClientId) || PREFS.oauthClientId(PREFS.OAUTH_CLIENT_ID);
    field.value = clientId;
    setup.open = !clientId;
    paint();
    if (!ONLINE) say('accountStatus', 'The account database is not configured in this build.', 'error');
    else if (!clientId) say('accountStatus', 'Google sign-in needs a registered OAuth client ID. Chrome profile backup works independently.');
  });
  const redirect = chrome.identity ? chrome.identity.getRedirectURL() : `https://${chrome.runtime.id}.chromiumapp.org/`;
  el('accountRedirect').textContent = 'Redirect address: ' + redirect;
  el('copyAccountRedirect').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(redirect);
      say('accountStatus', 'Redirect address copied. Add it to the OAuth client’s authorized redirect URIs.');
    } catch (e) {
      say('accountStatus', 'Could not copy. Select and copy the redirect address shown above.', 'error');
    }
  });
  el('saveAccountSetup').addEventListener('click', () => {
    if (backupBusy) return;
    const id = PREFS.oauthClientId(field.value);
    if (!id) { say('accountStatus', 'Enter a Google client ID ending in .apps.googleusercontent.com', 'error'); return; }
    setBackupBusy(true); paint();
    persist({ oauthClientId: id }, ok => {
      setBackupBusy(false);
      if (ok) { read(); say('accountStatus', 'Configuration saved. The database owner must configure this same client ID.'); }
      else { paint(); say('accountStatus', 'Could not save sign-in configuration. Please try again.', 'error'); }
    });
  });
  read();
  readProfile();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.googleProfile) readProfile();
    if (changes.googleBackupStatus || changes.googleLinked) paintGoogleStatus();
  });
  if (typeof bindToggle === 'function') bindToggle('googleAutoSave');
  // When the Google copy was last written, and why automatic saving has paused if it has.
  const paintGoogleStatus = () => chrome.storage.local.get(['googleLinked', 'googleBackupStatus'], o => {
    const s = (o && o.googleBackupStatus) || null;
    const when = s && s.t ? new Date(s.t).toLocaleString() : '';
    say('googleSaveStatus', !o || o.googleLinked !== true
      ? 'Automatic saving starts after you first save to, or restore from, your Google account on this computer.'
      : !s ? 'Automatic saving is on.'
      : s.ok ? `Last saved to Google ${when}.`
      : s.reason === 'needs-sign-in' ? `Automatic saving paused ${when}: Google needs you to sign in again. Click Save my settings to Google.`
      : `Could not save to Google ${when} (${s.reason}).`, s && !s.ok ? 'error' : '');
  });
  paintGoogleStatus();

  // A token for one request. Already signed in: try Google's session without a window first.
  const getToken = async () => {
    // Request optional identity access directly from the button's user gesture.
    if (!await chrome.permissions.request({ permissions: ['identity'] })) throw new Error('permission-denied');
    if (profile) { try { return await auth.token(chrome, clientId, { silent: true }); } catch (e) { /* ask with a window */ } }
    return auth.token(chrome, clientId);
  };
  // Keep who signed in. Returns false when Google signed the reader in but shared no usable profile.
  const rememberProfile = async token => {
    if (!auth.profile) return true;
    try { profile = await auth.profile(token); } catch (e) { return false; }
    await new Promise(resolve => persist({ googleProfile: { ...profile, at: Date.now() } }, resolve));
    paintProfile();
    return true;
  };
  const who = () => (profile ? ` (${profile.email})` : '');
  const errorText = e => ({
    cancelled: 'Sign-in cancelled. Your settings are unchanged.',
    'permission-denied': 'Google sign-in permission was not granted.',
    'auth-failed': 'Google sign-in could not start or complete. Register the redirect address in Configure Google sign-in and check the app’s test-user access.',
    'invalid-redirect': 'Google returned an unexpected redirect. Check the registered redirect address.',
    'no-token': 'Google did not return a valid sign-in token.',
    'no-backup': 'Nothing saved to this Google account yet.',
    'storage-error': 'Could not save settings on this computer. Please try again.',
    'Error: accounts are not configured': `You are signed in${who()}, but Ingredient Check's database has not been set up for Google accounts yet, so nothing can be saved or restored online. Your settings are unchanged. The database owner needs to finish that one setup step.`,
    'Error: token rejected': 'The database did not accept this Google sign-in. Check that its OAuth client ID matches this extension.',
  })[e.message] || 'Could not complete the account request. Check the OAuth client, database deployment, and connection.';

  googleCopy = async () => {
    if (!profile || !clientId) return null;
    const token = await getToken();
    return (await chrome.runtime.sendMessage({ type: 'accountFetch', token })) || { ok: false, reason: 'network' };
  };

  // Sign in only: shows who is signed in, and changes nothing else.
  el('accountSignIn')?.addEventListener('click', async () => {
    if (backupBusy || !clientId) return;
    setBackupBusy(true); paint(); say('accountStatus', 'Signing in…');
    try {
      const token = await getToken();
      say('accountStatus', await rememberProfile(token) ? `Signed in with Google${who()}.`
        : 'Signed in, but Google did not share your email, so it cannot be shown here.');
    } catch (e) { say('accountStatus', errorText(e), 'error'); }
    finally { setBackupBusy(false); paint(); }
  });
  el('googleSignOut')?.addEventListener('click', () => {
    chrome.storage.local.remove(['googleProfile', 'googleLinked', 'googleBackupStatus'], () => {
      profile = null; paintProfile();
      say('accountStatus', 'Signed out. Your settings on this computer and in Chrome sync are unchanged.');
    });
  });

  const run = async type => {
    if (backupBusy || !ONLINE || !clientId) return;
    setBackupBusy(true); paint(); say('accountStatus', 'Signing in…');
    try {
      const token = await getToken();
      const known = await rememberProfile(token);
      say('accountStatus', type === 'accountSave' ? 'Saving…' : 'Loading…');
      if (type === 'accountLoad') await AIR.settingsRestore?.begin();
      const res = await chrome.runtime.sendMessage({ type, token });
      if (!res || !res.ok) throw new Error(res && res.reason || 'network');
      if (type === 'accountLoad') await reloadWithStored();
      else say('accountStatus', `Saved to your Google account${who()}${known ? '' : '. Google did not share your email, so it is not shown here'}`);
    } catch (e) {
      say('accountStatus', errorText(e), 'error');
    } finally { if (type === 'accountLoad') AIR.settingsRestore?.complete(); setBackupBusy(false); paint(); }
  };
  save.addEventListener('click', () => run('accountSave'));
  load.addEventListener('click', () => {
    if (backupBusy || !ONLINE || !clientId) return;
    if (!window.confirm('Replace the settings on this computer with the copy saved to your Google account?')) return;
    run('accountLoad');
  });
}

if (typeof startSettingsPage === 'function') startSettingsPage();
