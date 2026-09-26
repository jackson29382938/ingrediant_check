// The report page (report.html): fills the previews, keeps the email draft and the file in step
// with the form, and hands both to the reader. Nothing is sent from here (see report-data.js).

(function () {
  const D = AIR.reportData;
  const $ = id => document.getElementById(id);
  const t = (key, fallback) => { try { return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback; } catch (e) { return fallback; } };
  const ctx = { when: Date.now(), userAgent: navigator.userAgent, language: navigator.language };
  let screenshot = '';

  (function localise() {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const text = t(el.dataset.i18n, '');
      if (text) el.textContent = text;
    }
  })();

  const form = () => ({
    kind: (document.querySelector('input[name="kind"]:checked') || {}).value,
    title: $('title').value, description: $('description').value, steps: $('steps').value, expected: $('expected').value,
  });
  const include = () => ({
    screenshot: $('inc-screenshot').checked, page: $('inc-page').checked,
    settings: $('inc-settings').checked, actions: $('inc-actions').checked,
  });
  const current = () => D.build(form(), { ...ctx, screenshot }, include());

  function paint() {
    const built = current();
    const r = built.report;
    $('pagePreview').textContent = JSON.stringify(typeof r.page === 'object' ? r.page : D.build({}, { ...ctx }, {}).report.page, null, 2);
    $('settingsPreview').textContent = JSON.stringify(typeof r.settings === 'object' ? r.settings : D.settingsFrom(ctx.settings), null, 2);
    const actions = AIR.db.activity.sanitize(ctx.actions);
    $('actionsPreview').textContent = actions.length
      ? actions.map(a => `${new Date(a.t).toLocaleTimeString()}  ${a.where}: ${a.what}`).join('\n')
      : t('reportNoActions', 'Nothing recorded yet in this browser session.');
    $('envPreview').textContent = JSON.stringify(r.environment, null, 2);
    for (const part of ['screenshot', 'page', 'settings', 'actions']) $(`part-${part}`).classList.toggle('off', !$(`inc-${part}`).checked);
    $('shot').hidden = !screenshot;
    $('shotNone').hidden = !!screenshot;
    if (screenshot) $('shot').src = screenshot;
    $('textPreview').textContent = built.text;
    $('email').href = built.mailto;
  }

  function setShot(dataUrl) {
    if (typeof dataUrl === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)) {
      screenshot = dataUrl;
      $('inc-screenshot').checked = true;
    }
    paint();
  }
  function readImage(file) {
    if (!file || !/^image\/(?:png|jpeg|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setShot(reader.result);
    reader.readAsDataURL(file);
  }

  $('shotFile').addEventListener('change', e => readImage(e.target.files && e.target.files[0]));
  document.addEventListener('paste', e => {
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => /^image\//.test(i.type));
    if (item) { e.preventDefault(); readImage(item.getAsFile()); }
  });
  document.addEventListener('input', paint);
  document.addEventListener('change', paint);

  $('download').addEventListener('click', () => {
    const built = current();
    const blob = new Blob([D.htmlFile(built, include().screenshot ? screenshot : '')], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = D.fileName(ctx.when);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    $('status').textContent = t('reportDownloaded', 'Saved to your Downloads folder. Now open the email draft and attach it.');
    AIR.db.activity.log('report', `downloaded report file (${built.report.kind})`);
  });
  $('email').addEventListener('click', () => {
    $('status').textContent = t('reportEmailOpened', 'Your email app should open with the draft. Attach the report file, then press Send.');
  });
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(current().text);
      $('status').textContent = t('reportCopied', 'Copied. Paste it wherever you like.');
    } catch (e) {
      $('status').textContent = t('reportCopyFailed', 'Could not copy. Select the preview text below instead.');
    }
  });

  (async function load() {
    try { ctx.version = chrome.runtime.getManifest().version; } catch (e) { ctx.version = ''; }
    ctx.rules = (AIR.db.revision && AIR.db.revision.RULES_REVISION) || '';
    try {
      const session = await chrome.storage.session.get(['reportDraft', 'sortedResults', AIR.db.activity.KEY]);
      const draft = session.reportDraft || {};
      ctx.url = draft.url || '';
      ctx.pageScore = draft.pageScore || null;
      ctx.sorted = session.sortedResults || null;
      ctx.actions = session[AIR.db.activity.KEY] || [];
      if (draft.shot) screenshot = draft.shot;
      if (draft.shotSkipped === 'not-a-store') {
        $('shotNone').textContent = t('reportShotNotStore', 'No screenshot was taken: the tab you were on was not an Amazon or Target page, so it was left alone. You can add one below, or paste an image with Ctrl/Cmd+V.');
      }
    } catch (e) { /* session storage unavailable */ }
    // The settings, and the cached entries by key only (report-data.js counts them).
    try {
      const keys = await AIR.db.scoreCache.storedKeys(chrome.storage.local);
      const cached = keys.filter(AIR.db.scoreCache.isCacheKey);
      ctx.settings = { ...(await chrome.storage.local.get(keys.filter(k => !AIR.db.scoreCache.isCacheKey(k)))),
        ...Object.fromEntries(cached.map(k => [k, true])) };
    } catch (e) { ctx.settings = {}; }
    paint();
  })();
})();
