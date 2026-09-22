// Shared-database settings (sheet / producers / contribute / diagnostics).
// Loaded after settings.js so flash/persist/msg/PREFS/markUrl/readUrlField/DB_KEYS exist.

const SHEET_ORIGINS = ['https://docs.google.com/*'];
const SCRIPT_ORIGINS = ['https://script.google.com/*', 'https://script.googleusercontent.com/*'];

function originsForUrl(url) {
  const u = String(url || '').trim();
  const origins = [];
  if (/^https:\/\/docs\.google\.com\//i.test(u)) origins.push(...SHEET_ORIGINS);
  if (/^https:\/\/script\.google\.com\//i.test(u) || /^https:\/\/script\.googleusercontent\.com\//i.test(u)) {
    origins.push(...SCRIPT_ORIGINS);
  }
  return [...new Set(origins)];
}

function requestOrigins(origins, done) {
  if (!origins.length) { done(true); return; }
  if (!chrome.permissions || typeof chrome.permissions.request !== 'function') { done(true); return; }
  chrome.permissions.request({ origins }, granted => {
    done(!chrome.runtime.lastError && !!granted);
  });
}

function revokeUnusedGoogleOrigins(done) {
  if (!chrome.permissions || typeof chrome.permissions.remove !== 'function') {
    if (done) done(true);
    return;
  }
  chrome.storage.local.get(['sheetUrl', 'producersUrl', 'contributeUrl'], o => {
    const urls = PREFS.sanitizeUrls(o);
    const stillNeed = new Set([
      ...originsForUrl(urls.sheetUrl),
      ...originsForUrl(urls.producersUrl),
      ...originsForUrl(urls.contributeUrl),
    ]);
    const drop = [...SHEET_ORIGINS, ...SCRIPT_ORIGINS].filter(origin => !stillNeed.has(origin));
    if (!drop.length) { if (done) done(true); return; }
    chrome.permissions.remove({ origins: drop }, () => {
      void chrome.runtime.lastError;
      if (done) done(true);
    });
  });
}


// ---------------------------------------------------------------- shared database
function wireDatabase() {
  chrome.storage.local.get(DB_KEYS, o => {
    const urls = PREFS.sanitizeUrls(o);
    const toggles = PREFS.sanitizeToggles(o);
    const healed = {};
    for (const key of ['sheetUrl', 'producersUrl', 'contributeUrl']) {
      const el = document.getElementById(key);
      if (!el) continue;
      if ((o[key] || '') !== urls[key]) healed[key] = urls[key];
      el.value = urls[key] || '';
      markUrl(el, true);
      el.addEventListener('change', () => {
        const kind = key === 'contributeUrl' ? 'script' : 'sheet';
        const value = readUrlField(key, kind);
        if (value === null) {
          flash(kind === 'script'
            ? 'That has to be an Apps Script /exec URL'
            : 'That has to be a published Google Sheet link', 'error');
          return;
        }
        const persistUrl = () => persist({ [key]: value }, ok => {
          if (!ok) return;
          if (!value) revokeUnusedGoogleOrigins();
          flash(msg('optSaved', 'Saved'));
        });
        if (!value) { persistUrl(); return; }
        requestOrigins(originsForUrl(value), ok => {
          if (!ok) {
            flash('Chrome blocked access to that host — the lookup cannot run', 'error');
            return;
          }
          persistUrl();
        });
      });
    }
    if (o.shareContributions === true && !toggles.shareContributions) healed.shareContributions = false;
    if (o.sendDiagnostics === true && !toggles.sendDiagnostics) healed.sendDiagnostics = false;
    if (Object.keys(healed).length) persist(healed);

    const share = document.getElementById('shareContributions');
    if (share) {
      share.checked = toggles.shareContributions;
      share.addEventListener('change', () => {
        if (!share.checked) {
          persist({ shareContributions: false });
          return;
        }
        const url = readUrlField('contributeUrl', 'script');
        if (url === null || !url) {
          share.checked = false;
          flash('Set a valid contribution URL first', 'error');
          return;
        }
        requestOrigins(originsForUrl(url), ok => {
          if (!ok) {
            share.checked = false;
            flash('Permission needed to send contributions', 'error');
            return;
          }
          persist({ shareContributions: true, contributeUrl: url }, saved => { if (saved) flash(msg('optSaved', 'Saved')); });
        });
      });
    }

    const diag = document.getElementById('sendDiagnostics');
    const diagStatus = document.getElementById('diagStatus');
    const paintDiag = () => {
      if (!diagStatus) return;
      chrome.runtime.sendMessage({ type: 'diagnosticsStatus' }, res => {
        if (chrome.runtime.lastError || !res) return;
        diagStatus.textContent = !res.configured ? 'No contribution URL set'
          : res.queued ? `${res.queued} row${res.queued === 1 ? '' : 's'} waiting to send`
          : 'Nothing queued';
      });
    };
    if (diag) {
      diag.checked = toggles.sendDiagnostics;
      diag.addEventListener('change', () => {
        if (!diag.checked) { persist({ sendDiagnostics: false }, paintDiag); return; }
        const url = readUrlField('contributeUrl', 'script');
        if (url === null || !url) {
          diag.checked = false;
          flash('Set a valid contribution URL first', 'error');
          return;
        }
        requestOrigins(originsForUrl(url), ok => {
          if (!ok) { diag.checked = false; flash('Permission needed to send diagnostics', 'error'); return; }
          persist({ sendDiagnostics: true, contributeUrl: url }, saved => {
            if (saved) flash(msg('optSaved', 'Saved'));
            paintDiag();
          });
        });
      });
      paintDiag();
    }
    const flushBtn = document.getElementById('flushDiagnostics');
    if (flushBtn) {
      flushBtn.addEventListener('click', () => {
        diagStatus.textContent = 'Sending…';
        chrome.runtime.sendMessage({ type: 'flushDiagnostics' }, res => {
          if (chrome.runtime.lastError || !res) { diagStatus.textContent = 'Could not reach the endpoint'; return; }
          diagStatus.textContent = res.ok ? `Sent ${res.sent} rows`
            : res.reason === 'nothing-to-send' ? 'Nothing queued'
            : `Could not send — ${res.reason} (${res.queued || 0} still queued)`;
        });
      });
    }

    wireSettingsSync();
    paintSheetAccessHint();

    const btn = document.getElementById('refreshSheet');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const status = document.getElementById('sheetStatus');
      const urls = ['sheetUrl', 'producersUrl']
        .map(id => readUrlField(id, 'sheet'))
        .filter(v => v);
      if (['sheetUrl', 'producersUrl'].some(id => readUrlField(id, 'sheet') === null)) {
        status.textContent = 'Fix the highlighted URL first';
        return;
      }
      requestOrigins([...new Set(urls.flatMap(originsForUrl))], ok => {
        if (!ok) { status.textContent = 'Permission needed to read the sheet'; return; }
        status.textContent = 'Fetching…';
        chrome.runtime.sendMessage({ type: 'refreshSheet' }, res => {
          if (chrome.runtime.lastError || !res) { status.textContent = 'Could not reach the sheet'; return; }
          status.textContent = res.ok
            ? `Loaded ${res.count} product records and ${res.producers || 0} producers`
            : 'No usable rows found';
        });
      });
    });
  });
}

function paintSyncStatus(text, kind) {
  const status = document.getElementById('settingsSyncStatus');
  if (!status) return;
  status.textContent = text || '';
  status.className = 'status' + (kind === 'error' ? ' error' : '');
}

function paintSheetAccessHint() {
  const status = document.getElementById('sheetStatus');
  const el = document.getElementById('sheetUrl');
  if (!status || !el || status.textContent) return;
  const url = (el.value || '').trim();
  if (!url || !chrome.permissions || typeof chrome.permissions.contains !== 'function') return;
  const origins = originsForUrl(url);
  if (!origins.length) return;
  chrome.permissions.contains({ origins }, granted => {
    if (chrome.runtime.lastError || granted || status.textContent) return;
    status.textContent = 'Click Refresh to allow Chrome to read this sheet';
  });
}

function wireSettingsSync() {
  const saveBtn = document.getElementById('saveSettingsSheet');
  const loadBtn = document.getElementById('loadSettingsSheet');
  const toggle = document.getElementById('syncSettings');
  if (toggle) {
    chrome.storage.local.get('syncSettings', o => { toggle.checked = o.syncSettings === true; });
    toggle.addEventListener('change', () => {
      if (!toggle.checked) {
        persist({ syncSettings: false });
        return;
      }
      const url = readUrlField('contributeUrl', 'script');
      if (url === null || !url) {
        toggle.checked = false;
        flash('Deploy the Apps Script and paste its /exec URL first', 'error');
        return;
      }
      requestOrigins(originsForUrl(url), ok => {
        if (!ok) {
          toggle.checked = false;
          flash('Permission needed to save settings', 'error');
          return;
        }
        persist({ ...scoringPayload(), syncSettings: true, contributeUrl: url }, saved => {
          if (!saved) return;
          flash(msg('optSaved', 'Saved'));
          chrome.runtime.sendMessage({ type: 'saveSettings' }, () => { void chrome.runtime.lastError; });
        });
      });
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const url = readUrlField('contributeUrl', 'script');
      if (url === null || !url) {
        paintSyncStatus('Deploy the Apps Script and paste its /exec URL first', 'error');
        return;
      }
      requestOrigins(originsForUrl(url), ok => {
        if (!ok) { paintSyncStatus('Permission needed to save settings', 'error'); return; }
        persist(scoringPayload(), saved => {
          if (!saved) return;
          paintSyncStatus('Saving…');
          chrome.runtime.sendMessage({ type: 'saveSettings' }, res => {
            if (chrome.runtime.lastError || !res) { paintSyncStatus('Could not reach the endpoint', 'error'); return; }
            paintSyncStatus(res.ok ? 'Settings saved to the sheet' : `Could not save — ${res.reason || 'error'}`, res.ok ? '' : 'error');
          });
        });
      });
    });
  }
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const sheet = readUrlField('sheetUrl', 'sheet');
      const script = readUrlField('contributeUrl', 'script');
      if (sheet === null || script === null) { paintSyncStatus('Fix the highlighted URL first', 'error'); return; }
      if (!sheet && !script) { paintSyncStatus('Set a database URL or the Apps Script URL first', 'error'); return; }
      const origins = [...new Set([
        ...(sheet ? originsForUrl(sheet) : []),
        ...(script ? originsForUrl(script) : []),
      ])];
      requestOrigins(origins, ok => {
        if (!ok) { paintSyncStatus('Permission needed to read settings', 'error'); return; }
        paintSyncStatus('Loading…');
        chrome.runtime.sendMessage({ type: 'loadSettings' }, res => {
          if (chrome.runtime.lastError || !res) { paintSyncStatus('Could not read settings', 'error'); return; }
          if (!res.ok) {
            paintSyncStatus(res.reason === 'no-settings'
              ? 'No settings stored on the sheet yet'
              : res.reason === 'sheet-private'
                ? 'Share the sheet as anyone with the link, or paste the Apps Script URL'
                : `Could not load — ${res.reason || 'error'}`, 'error');
            return;
          }
          paintSyncStatus('Loaded settings from the sheet');
        });
      });
    });
  }
}

if (typeof startSettingsPage === 'function') startSettingsPage();
