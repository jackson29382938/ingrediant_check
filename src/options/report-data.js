// "Report a problem or suggest an improvement": what goes into a report, and the two ways it leaves.
//
// Nothing here sends anything. The report page shows every part before anything leaves, the reader
// can leave any part out, and there are two outputs:
//   - an email draft to the developer (mailto:, like the store request), with the text of the report
//   - one self-contained .html file (the screenshot plus every detail) for the reader to attach,
//     because a mailto: link cannot carry an attachment
// The reader's own email app opens the draft; nothing leaves until they press Send.
//
// Settings are copied through the same sanitizers the extension uses, from an allowlist: no cached
// scores, no Google sign-in token, no queued diagnostics, nothing another page stored. Web addresses
// keep their path and the search term only.

(function (root) {
  const db = () => (root.AIR && root.AIR.db) || {};
  const KINDS = {
    problem: 'Something is wrong / needs a fix',
    feature: 'Add something new',
    improvement: 'Make something better',
    other: 'Other',
  };
  const TITLE_MAX = 120;
  const TEXT_MAX = 4000;
  const MAILTO_BODY_MAX = 6000;

  // eslint-disable-next-line no-control-regex
  const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

  // Amazon or another page -> origin + path without Amazon's /ref= tail, plus the search term.
  function pageAddress(raw) {
    let u;
    try { u = new URL(String(raw || '')); } catch (e) { return ''; }
    if (!/^https?:$/.test(u.protocol)) return u.protocol === 'chrome-extension:' ? `extension page ${u.pathname}` : '';
    const path = u.pathname.replace(/\/ref=[^/]*$/, '');
    return `${u.origin}${path}`;
  }

  // storage.local -> the settings a report needs, and counts of what is cached.
  function settingsFrom(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const { prefs, sortedResults, unitPrice, speed } = db();
    const out = {};
    if (prefs) {
      Object.assign(out, prefs.sanitizeToggles(o), prefs.sanitizeDisplay(o));
      const s = prefs.sanitizeScoring(o);
      Object.assign(out, { weights: s.weights, goals: s.goals, allergens: s.allergens, diets: s.diets, avoidList: s.avoidList });
    }
    if (sortedResults) Object.assign(out, sortedResults.sanitizeSort(o));
    if (unitPrice) Object.assign(out, unitPrice.sanitizeUnit(o));
    if (speed) Object.assign(out, speed.sanitizeSpeed(o));
    const keys = Object.keys(o);
    out.cached = {
      scores: keys.filter(k => k.startsWith('s:')).length,
      productReadings: keys.filter(k => k.startsWith('p:')).length,
    };
    return out;
  }

  // The side panel's list, summarised: which option, how many, the status line.
  function sortedSummary(saved) {
    if (!saved || typeof saved !== 'object') return null;
    const items = Array.isArray(saved.items) ? saved.items : [];
    return {
      mode: saved.mode === 'unitPrice' ? 'price per ounce' : saved.mode === 'health' ? 'Ingredient Check score' : '',
      listings: items.length,
      withScore: items.filter(i => i && typeof i.score === 'number').length,
      withPricePerOunce: items.filter(i => i && typeof i.unitPrice === 'number').length,
      stillLoading: saved.loading === true,
      status: text(saved.status, 300),
      from: pageAddress(saved.sourceUrl),
    };
  }

  function pageScoreSummary(ps) {
    if (!ps || typeof ps !== 'object') return null;
    return {
      score: typeof ps.score === 'number' ? ps.score : null,
      verdict: text(ps.verdict, 30),
      status: text(ps.status, 30),
      product: text(ps.name || ps.title, 160),
      readFrom: text(ps.via || ps.source, 40),
    };
  }

  // The form plus the context -> { subject, text, json, mailto }. `include` says which parts the
  // reader kept.
  function build(form = {}, ctx = {}, include = {}) {
    const kind = Object.hasOwn(KINDS, form.kind) ? form.kind : 'problem';
    const title = text(form.title, TITLE_MAX) || KINDS[kind];
    const keep = { screenshot: include.screenshot !== false, settings: include.settings !== false,
      actions: include.actions !== false, page: include.page !== false };
    const report = {
      format: 'ingredient-check-report', version: 1,
      kind, kindLabel: KINDS[kind], title,
      description: text(form.description, TEXT_MAX),
      steps: text(form.steps, TEXT_MAX),
      expected: text(form.expected, TEXT_MAX),
      when: new Date(Number(ctx.when) || Date.now()).toISOString(),
      environment: {
        extension: text(ctx.version, 20), rules: text(ctx.rules, 30),
        browser: text(ctx.userAgent, 300), language: text(ctx.language, 20),
      },
      page: keep.page ? { address: pageAddress(ctx.url), pageScore: pageScoreSummary(ctx.pageScore), sortedList: sortedSummary(ctx.sorted) } : 'left out',
      settings: keep.settings ? settingsFrom(ctx.settings) : 'left out',
      recentActions: keep.actions && db().activity ? db().activity.sanitize(ctx.actions) : 'left out',
      screenshot: keep.screenshot && ctx.screenshot ? 'attached in the report file' : keep.screenshot ? 'none taken' : 'left out',
    };
    const subject = `[Ingredient Check] ${KINDS[kind]}: ${title}`.slice(0, 180);
    const plain = toText(report);
    return { report, subject, text: plain, mailto: mailtoFor(subject, plain) };
  }

  const time = t => { try { return new Date(t).toISOString().slice(11, 19); } catch (e) { return ''; } };
  function toText(r) {
    const lines = [];
    const add = (...xs) => lines.push(...xs);
    add(`${r.kindLabel}: ${r.title}`, '');
    if (r.description) add('What happened / what I would like:', r.description, '');
    if (r.steps) add('What I clicked / steps:', r.steps, '');
    if (r.expected) add('What I expected instead:', r.expected, '');
    add('--- Details (added by Ingredient Check) ---');
    add(`When: ${r.when}`, `Extension: ${r.environment.extension} · rules ${r.environment.rules}`,
      `Browser: ${r.environment.browser}`, `Language: ${r.environment.language}`);
    if (r.page && typeof r.page === 'object') {
      add(`Page: ${r.page.address || '(none)'}`);
      if (r.page.pageScore) add(`This page's score: ${JSON.stringify(r.page.pageScore)}`);
      if (r.page.sortedList) add(`Side panel list: ${JSON.stringify(r.page.sortedList)}`);
    } else add('Page: left out');
    if (r.settings && typeof r.settings === 'object') {
      const { weights, avoidList, ...rest } = r.settings;
      add(`Settings: ${JSON.stringify(rest)}`);
      const changed = Object.entries(weights || {}).filter(([k, v]) => {
        const def = db().categories && db().categories.DEFAULT_WEIGHTS ? db().categories.DEFAULT_WEIGHTS[k] : undefined;
        return def === undefined || Math.abs(v - def) > 0.001;
      });
      add(`Weights changed from default: ${changed.length ? changed.map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);
      add(`Avoid list: ${(avoidList || []).length ? avoidList.join(', ') : 'empty'}`);
    } else add('Settings: left out');
    if (Array.isArray(r.recentActions)) {
      add('', `Recent actions (${r.recentActions.length}, oldest first):`);
      for (const a of r.recentActions) add(`  ${time(a.t)}  ${a.where}: ${a.what}`);
    } else add('Recent actions: left out');
    add('', `Screenshot: ${r.screenshot}`);
    return lines.join('\n');
  }

  // RFC 6068 wants CRLF line breaks. Long reports are cut (recent actions first go), with a pointer to
  // the attached file, because some email apps refuse very long mailto: links.
  function mailtoFor(subject, body) {
    const to = (root.AIR && root.AIR.storeRequest && root.AIR.storeRequest.REQUEST_EMAIL) || 'jackson29382938@gmail.com';
    let b = body;
    if (b.length > MAILTO_BODY_MAX) b = `${b.slice(0, MAILTO_BODY_MAX)}\n…(cut here; the full report is in the attached file)`;
    b += '\n\nPlease attach the report file you downloaded (ingredient-check-report-….html) before sending.';
    return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b.replace(/\r?\n/g, '\r\n'))}`;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // One self-contained file: opens in any browser, shows the screenshot, carries the JSON.
  function htmlFile(built, screenshot) {
    const shot = typeof screenshot === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(screenshot) ? screenshot : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(built.subject)}</title>
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px}
pre{white-space:pre-wrap;background:#f4f6f5;padding:12px;border-radius:8px}img{max-width:100%;border:1px solid #ccc}</style></head><body>
<h1>${esc(built.subject)}</h1>
<pre>${esc(built.text)}</pre>
${shot ? `<h2>Screenshot</h2><img alt="Screenshot of the page" src="${shot}">` : ''}
<h2>Data</h2><pre id="report-json">${esc(JSON.stringify(built.report, null, 2))}</pre>
</body></html>`;
  }

  const fileName = (when = Date.now()) => `ingredient-check-report-${new Date(when).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.html`;

  const api = { KINDS, TITLE_MAX, TEXT_MAX, MAILTO_BODY_MAX, pageAddress, settingsFrom, sortedSummary, build, toText, mailtoFor, htmlFile, fileName };
  root.AIR = root.AIR || {};
  root.AIR.reportData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
