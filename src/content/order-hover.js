// Purchase snapshot details: no network request and no invented historical breakdown.
(function (root) {
  const A = root.AIR,
    values = new WeakMap();
  let conf = {},
    profile = '',
    version = '',
    host,
    shadow,
    timer,
    hide,
    token = 0,
    active,
    suppressFocus = false;
  function close() {
    token++;
    clearTimeout(timer);
    clearTimeout(hide);
    active?.setAttribute('aria-expanded', 'false');
    active = null;
    host?.remove();
    host = null;
  }
  function refocus(badge) {
    suppressFocus = true;
    badge.focus();
    setTimeout(() => {
      suppressFocus = false;
    }, 0);
  }
  function configure(raw, scoringProfile, engineVersion) {
    conf = raw;
    profile = scoringProfile;
    version = engineVersion;
    close();
  }
  async function show(badge) {
    const value = values.get(badge);
    if (!value || value.record.score === null || conf.hoverBreakdown === false || conf.enabled === false) return;
    close();
    const mine = token,
      { line, record } = value;
    const stored = record.input
      ? {}
      : await A.db.scoreCache.readLocal([A.db.productCache.localKey(location.hostname, line.asin)], conf, null, chrome.storage);
    if (mine !== token || !badge.isConnected) return;
    const row = A.db.productCache.sanitize(stored[A.db.productCache.localKey(location.hostname, line.asin)]);
    let result = null;
    const input = record.input || (row?.status === 'ok' ? A.db.productCache.toInput(row) : null);
    if (
      record.profile === profile &&
      record.version === version &&
      input?.ingredients_text.slice(0, 2000) === record.ingredients
    ) {
      const scored = A.engine.score(input, A.db.prefs.sanitizeScoring(conf));
      if (scored.score === record.score) result = scored;
    }
    host = document.createElement('div');
    host.id = 'air-order-details';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-label', `${line.name}: purchase score ${record.score}/100`);
    host.style.cssText = [
      'position:fixed',
      'z-index:2147483000',
      'width:min(360px,calc(100vw - 16px))',
      'max-height:70vh',
      'overflow:auto',
      'box-shadow:0 4px 18px #0004',
      'border-radius:12px',
    ].join(';');
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{font:14px/1.5 sans-serif;color:#111;background:#fff}',
      '.box{padding:14px;background:#fff;color:#111}',
      'h3{margin:0 0 8px;font-size:16px}',
      'p{margin:8px 0}',
      'button{padding:6px 10px;background:#fff;color:#007185;border:1px solid #007185;border-radius:6px}',
      'button:focus-visible,a:focus-visible{outline:3px solid #007185}',
    ].join('');
    shadow.append(style);
    const box = document.createElement('div');
    box.className = 'box';
    shadow.append(box);
    const add = (tag, text) => {
      const node = document.createElement(tag);
      node.textContent = text;
      box.append(node);
      return node;
    };
    add('h3', `${record.score}/100 · ${line.name}`);
    add('p', `Purchase snapshot rated ${new Date(record.scoredAt).toLocaleDateString()}. Version ${record.version}.`);
    if (record.breakdown) {
      add('p', `Original base: ${record.breakdown.base} points`);
      const list = document.createElement('ul');
      box.append(list);
      for (const factor of record.breakdown.rows) {
        const li = document.createElement('li');
        li.textContent = `${factor.c > 0 ? '+' : ''}${factor.c} · ${factor.why}`;
        list.append(li);
      }
    } else if (result) {
      const panel = document.createElement('div');
      box.append(panel);
      A.panel.mount(
        panel,
        A.panel.renderBreakdown(result, {
          asin: line.asin,
          score: record.score,
          detail: A.db.prefs.sanitizeDisplay(conf).breakdownDetail,
        })
      );
      for (const link of A.panel.shadowOf(panel).querySelectorAll('a')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } else {
      add(
        'p',
        'This is the saved purchase rating. The current scoring setup or label may differ; historical point deductions are not reconstructed.'
      );
      if (record.flags.length) {
        const list = document.createElement('ul');
        box.append(list);
        for (const flag of record.flags) {
          const li = document.createElement('li');
          li.textContent = flag;
          list.append(li);
        }
      }
    }
    if (record.ingredients) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Saved ingredient list';
      details.append(summary);
      const text = document.createElement('p');
      text.textContent = record.ingredients;
      details.append(text);
      box.append(details);
    } else add('p', 'The ingredient list was not saved with this snapshot. Open the product for its current label.');
    const link = add('a', 'Open product');
    link.href = new URL(`/dp/${line.asin}`, location.origin).href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const button = add('button', 'Close details');
    button.type = 'button';
    button.addEventListener('click', () => {
      close();
      refocus(badge);
    });
    document.body.append(host);
    active = badge;
    badge.setAttribute('aria-expanded', 'true');
    const r = badge.getBoundingClientRect();
    host.style.left = `${Math.max(8, Math.min(r.left, innerWidth - host.offsetWidth - 8))}px`;
    host.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - host.offsetHeight - 8))}px`;
    host.addEventListener('mouseenter', () => clearTimeout(hide));
    host.addEventListener('mouseleave', () => {
      hide = setTimeout(close, 250);
    });
  }
  function bind(badge, line, record) {
    if (!values.has(badge)) {
      badge.addEventListener('mouseenter', () => {
        clearTimeout(hide);
        clearTimeout(timer);
        timer = setTimeout(() => {
          void show(badge);
        }, A.db.prefs.sanitizeDisplay(conf).breakdownDelayMs);
      });
      badge.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        hide = setTimeout(close, 250);
      });
      badge.addEventListener('focus', () => {
        if (!suppressFocus) void show(badge);
      });
      badge.addEventListener('blur', event => {
        if (event.relatedTarget !== host) hide = setTimeout(close, 250);
      });
    }
    values.set(badge, { line, record });
    if (record.score !== null && conf.hoverBreakdown !== false) {
      badge.setAttribute('aria-haspopup', 'dialog');
      if (active !== badge) badge.setAttribute('aria-expanded', 'false');
      badge.removeAttribute('title');
    }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) {
      const badge = active;
      close();
      refocus(badge);
    }
  });
  document.addEventListener(
    'click',
    event => {
      if (host && event.target !== host && !active?.contains(event.target)) close();
    },
    true
  );
  addEventListener('resize', close);
  addEventListener(
    'scroll',
    event => {
      if (event.target !== host) close();
    },
    true
  );
  A.orderHover = { bind, configure, close };
})(typeof globalThis !== 'undefined' ? globalThis : self);
