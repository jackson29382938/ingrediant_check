// Settings → Stores: where the extension works, what is planned, and the request form.
// The request is a mailto: draft built by store-request.js; this page only shows it. Nothing is
// stored and nothing is sent: the reader's email app opens, and they press Send or not.

(function () {
  const S = AIR.stores;
  const R = AIR.storeRequest;
  const $ = id => document.getElementById(id);
  const t = (key, fallback) => {
    try { return (chrome.i18n && chrome.i18n.getMessage(key)) || fallback; } catch (e) { return fallback; }
  };

  function renderStores() {
    const list = $('storeList');
    if (!list) return;
    list.textContent = '';
    for (const store of S.STORES) {
      const li = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = store.name;
      const badge = document.createElement('span');
      badge.className = 'store-badge ' + store.status;
      badge.textContent = store.status === 'supported' ? t('optStoreSupported', 'Supported')
        : store.status === 'preview' ? t('optStorePreview', 'Preview — works on the pages you open; still being checked')
        : t('optStorePlanned', 'Planned — not available yet');
      const where = document.createElement('span');
      where.className = 'store-where';
      where.textContent = store.domains.join(', ');
      li.append(name, badge, where);
      list.appendChild(li);
    }
  }

  const NOTES = {
    'url-trimmed': 'The rest of the web address was removed; only the site is included.',
    'already-planned': 'This store is already planned. A request still helps show it is wanted.',
    'already-preview': 'Ingredient Check already runs on this store as a preview. A request still helps show it is wanted.',
  };

  function paint() {
    const name = $('reqName'), url = $('reqUrl'), send = $('reqSend');
    const touched = { name: name.value.trim() !== '', url: url.value.trim() !== '' };
    const r = R.buildRequest({ name: name.value, url: url.value }, S);
    // An empty name box is not an error until something has been typed somewhere.
    const show = (field, box, err) => {
      const e = r.errors[field];
      const visible = e && (touched[field] || e === 'already-supported' || (field === 'name' && touched.url));
      err.textContent = visible ? R.MESSAGES[e] : '';
      box.setAttribute('aria-invalid', visible ? 'true' : 'false');
    };
    show('name', name, $('reqNameError'));
    show('url', url, $('reqUrlError'));
    $('reqNotes').textContent = r.notes.map(n => NOTES[n]).filter(Boolean).join(' ');
    if (r.ok) {
      $('reqPreview').textContent = `To: ${r.to}\nSubject: ${r.subject}\n\n${r.body.replace(/\r\n/g, '\n')}`;
      send.href = r.mailto;
      send.setAttribute('aria-disabled', 'false');
    } else {
      $('reqPreview').textContent = t('optRequestPreviewEmpty', 'Enter a store name to see the draft.');
      send.href = '#';
      send.setAttribute('aria-disabled', 'true');
    }
  }

  function wire() {
    renderStores();
    const name = $('reqName'), url = $('reqUrl'), send = $('reqSend');
    if (!name || !url || !send) return;
    name.addEventListener('input', paint);
    url.addEventListener('input', paint);
    // Only a valid draft leaves this page, and only as a link the reader clicked.
    send.addEventListener('click', e => {
      if (send.getAttribute('aria-disabled') === 'true' || !send.href.startsWith('mailto:')) {
        e.preventDefault();
        paint();
        name.focus();
      }
    });
    paint();
  }

  wire();
})();
