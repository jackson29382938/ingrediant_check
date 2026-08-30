// The score panel.
//
// Rendered into an open shadow root. Amazon's stylesheet is global and aggressive; a shadow root is
// the only reliable way to guarantee their CSS cannot reach in and ours cannot leak out.

(function (root) {
  root.AIR = root.AIR || {};

  const BAND_COLOR = score =>
    score >= 90 ? { fg: '#0f7b3f', bg: '#e8f5ec', ring: '#1a9850' }
    : score >= 75 ? { fg: '#4a7c1f', bg: '#eef6e4', ring: '#66bd63' }
    : score >= 50 ? { fg: '#9a6206', bg: '#fdf3e2', ring: '#f0a02a' }
    : score >= 25 ? { fg: '#a8480f', bg: '#fdeee5', ring: '#f46d43' }
    : { fg: '#a4161a', bg: '#fdecec', ring: '#d73027' };

  const NOVA_TEXT = {
    1: 'Whole / minimally processed',
    2: 'Culinary ingredient',
    3: 'Processed',
    4: 'Ultra-processed',
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0;
      font-family: "Amazon Ember", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .card { border: 1px solid #d5d9d9; border-radius: 10px; overflow: hidden;
          background: #fff; margin: 14px 0; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .head { display: flex; align-items: center; gap: 14px; padding: 14px 16px; cursor: pointer;
          user-select: none; border: 0; width: 100%; text-align: left; background: var(--bg); }
  .head:hover { filter: brightness(.985); }
  .head:focus-visible, button.go:focus-visible, textarea:focus-visible {
    outline: 3px solid #007185; outline-offset: 2px;
  }
  .score { flex: 0 0 auto; width: 52px; height: 52px; border-radius: 50%;
           display: grid; place-items: center; background: #fff;
           border: 3px solid var(--ring); color: var(--fg); font-size: 20px; font-weight: 700;
           font-variant-numeric: tabular-nums; }
  .meta { flex: 1 1 auto; min-width: 0; }
  .verdict { display: block; font-size: 15px; font-weight: 700; color: var(--fg); letter-spacing: .2px; }
  .sub { display: block; font-size: 12px; color: #565959; margin-top: 2px;
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { flex: 0 0 auto; color: #565959; font-size: 13px; transition: transform .15s; }
  .card.open .chev { transform: rotate(180deg); }
  .body { display: none; padding: 4px 16px 14px; border-top: 1px solid #eaeded; }
  .card.open .body { display: block; }
  h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #565959;
       margin: 14px 0 7px; font-weight: 700; }
  ul { list-style: none; }
  li { display: flex; gap: 10px; align-items: baseline; padding: 4px 0; font-size: 13px; line-height: 1.45; }
  .pts { flex: 0 0 auto; width: 40px; text-align: right; font-weight: 700;
         font-variant-numeric: tabular-nums; font-size: 12px; }
  .plus .pts { color: #0f7b3f; }
  .minus .pts { color: #a4161a; }
  .capflag .pts { color: #a4161a; font-size: 10px; letter-spacing: .5px; }
  .why { flex: 1 1 auto; color: #0f1111; }
  .ing { color: #565959; font-style: italic; }
  .foot { margin-top: 14px; padding-top: 10px; border-top: 1px solid #eaeded;
          font-size: 11px; color: #767676; display: flex; justify-content: space-between; gap: 10px; }
  .flags { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px 0; }
  .flag { font-size: 11px; font-weight: 600; padding: 4px 9px; border-radius: 999px;
          background: #fff4e5; color: #8a4b00; border: 1px solid #ffd8a8; }
  .flag.avoid { background: #fdecec; color: #a4161a; border-color: #f5b5b5; }
  .prov { padding: 10px 16px 0; }
  .prov h5 { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #565959;
             margin: 8px 0 6px; font-weight: 700; }
  .cert { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; font-size: 12px; }
  .cert .tick { flex: 0 0 auto; font-weight: 700; }
  .cert.v .tick { color: #0f7b3f; }
  .cert.c .tick { color: #9a6206; }
  .cert.h .tick { color: #a4161a; }
  .cert .m { color: #565959; }
  .report { background: none; border: 0; padding: 0; font: inherit; font-size: 11px;
            color: #007185; cursor: pointer; text-decoration: underline; }
  .report:hover { color: #c7511f; }
  .report[disabled] { color: #767676; text-decoration: none; cursor: default; }
  .disclaim { margin-top: 10px; font-size: 11px; line-height: 1.45; color: #767676; }
  .fail { padding: 14px 16px; font-size: 13px; color: #0f1111; line-height: 1.5; }
  .fail b { display: block; margin-bottom: 4px; }
  .paste { margin-top: 10px; display: flex; gap: 8px; }
  textarea { flex: 1; min-height: 58px; border: 1px solid #d5d9d9; border-radius: 6px;
             padding: 7px 9px; font-size: 12px; resize: vertical; font-family: inherit; }
  button.go { align-self: flex-end; background: #ffd814; border: 1px solid #fcd200; border-radius: 999px;
              padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; color: #0f1111; }
  button.go:hover { background: #f7ca00; }
  button.go:disabled { background: #f0f2f2; border-color: #d5d9d9; color: #767676; cursor: not-allowed; }
  .hint { margin-top: 6px; font-size: 12px; color: #a4161a; min-height: 1.2em; }
  .hint:empty { display: none; }
  `;

  // Allergen, diet and avoid-list warnings. Deliberately outside the collapsed body: if you asked to
  // be told about sesame, you should not have to expand a card to find out.
  function flagsHTML(flags) {
    if (!flags || !flags.length) return '';
    // A missing flag is the dangerous direction: flags come only from the text we managed to read,
    // so a truncated, unread or unrecognised list produces none at all — which looks identical to
    // "clear". Say so next to the chips rather than anywhere a user has to go looking.
    const hasAllergen = flags.some(f => f.kind === 'allergen');
    return `<div class="flags" role="status">${flags.map(f =>
      `<span class="flag${f.kind === 'avoid' ? ' avoid' : ''}" title="${esc(f.ingredient || '')}">${esc(f.label)}</span>`
    ).join('')}</div>${hasAllergen
      ? `<p class="disclaim" style="padding:6px 16px 0">Found in the ingredient text on this page.
         Absence of a warning is not a safety check — never rely on this for an allergy.</p>`
      : ''}`;
  }

  // For a whole food this is the section that carries the actual information. A certification is
  // shown with what it guarantees, because "AGA certified" means nothing to someone who has not
  // looked it up, and a hollow claim is shown with why it is hollow.
  function provenanceHTML(p, meta) {
    if (!p) return '';
    const rows = [];
    for (const c of p.verified) rows.push(`<div class="cert v"><span class="tick">✓</span>
      <span><b>${esc(c.label)}</b><br><span class="m">${esc(c.means)}</span></span></div>`);
    for (const c of p.claims) rows.push(`<div class="cert c"><span class="tick">~</span>
      <span><b>${esc(c.label)}</b><br><span class="m">${esc(c.means)}</span></span></div>`);
    for (const h of p.hollow) rows.push(`<div class="cert h"><span class="tick">✕</span>
      <span><b>${esc(h.label)} means nothing here</b><br><span class="m">${esc(h.why)}</span></span></div>`);
    if (!rows.length) {
      rows.push(`<div class="cert h"><span class="tick">?</span><span><b>Nothing disclosed about
        how this was produced</b><br><span class="m">No certification, feed, or origin claim on the
        page. Commodity ${esc(p.kind)} with a silent label is conventionally raised by default.</span></span></div>`);
    }
    const src = meta && meta.provenanceSource ? ` · ${esc(meta.provenanceSource)}` : '';
    return `<div class="prov"><h5>How this was produced${src}</h5>${rows.join('')}</div>`;
  }

  function rowsHTML(items, kind) {
    if (!items.length) return '';
    return `<ul>${items.map(h => {
      // A cap that BINDS now carries its own arithmetic (h.cap, numeric), because the score used
      // to jump without any row explaining the gap. A cap that matched but was not the binding
      // one stays a bare 'CAP' label — it constrains nothing, so it has no number to show.
      const isCapLabel = h.c === 'CAP';
      const cls = isCapLabel ? 'capflag' : (h.cap ? 'minus' : kind);
      const pts = isCapLabel ? 'CAP' : (h.c > 0 ? `+${h.c}` : `${h.c}`);
      const ing = h.ing ? ` <span class="ing">— ${esc(h.ing)}</span>` : '';
      return `<li class="${cls}"><span class="pts">${pts}</span><span class="why">${esc(h.why)}${ing}</span></li>`;
    }).join('')}</ul>`;
  }

  // Where the ingredients came from is part of the claim. An Open Food Facts match on a barcode is
  // a materially weaker statement than text read off the product page, and used to render as an
  // indistinguishable "55% confidence".
  function sourceLabel(meta) {
    if (meta.via === 'manual-paste') return 'Ingredients you pasted';
    if (meta.via === 'open-food-facts') return 'Matched by barcode via Open Food Facts — not from this page';
    if (meta.confidence >= 0.9) return 'Ingredients read from page';
    return `Ingredients read from page (${Math.round((meta.confidence || 0) * 100)}% confidence)`;
  }

  // `result` is the engine output; `meta` carries title/confidence/source.
  function render(result, meta) {
    const c = BAND_COLOR(result.score);
    const isCapRow = h => h.c === 'CAP' || h.cap === true;
    const caps = result.bad.filter(isCapRow);
    const minus = result.bad.filter(h => !isCapRow(h));
    const plus = result.good.filter(h => h.c > 0);
    const refinedSugarPresent = result.bad.some(h => /^(Refined added sugar|Cane sugar|Brown sugar|Beet sugar|Powdered sugar|Invert sugar|Dextrose|Glucose syrup|Isolated fructose|Sucrose|Maltose|Agave|Rice syrup|Tapioca syrup|Barley malt syrup|Caramel|Honey powder)/i.test(h.why));
    // A zero-point note about milk or fruit sugar is useful on a clean food, but reads like a health
    // halo on candy or chips. Hide that cosmetic note when refined added sugar is also present.
    const neutral = result.good.filter(h => h.c === 0 && !(refinedSugarPresent && /Natural sugar/i.test(h.why)));

    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:${c.fg};--bg:${c.bg};--ring:${c.ring}">
      <button class="head" part="head" type="button" aria-expanded="false" aria-controls="air-panel-details">
        <span class="score">${result.score}</span>
        <span class="meta">
          <span class="verdict">${esc(result.verdict.toUpperCase())}</span>
          <span class="sub">${esc(NOVA_TEXT[result.nova])} · ${esc(meta.title || '')}</span>
        </span>
        <span class="chev">▾</span>
      </button>
      ${flagsHTML(result.flags)}
      ${provenanceHTML(result.provenance, meta)}
      <div class="body" id="air-panel-details">
        ${caps.length ? `<h4>Disqualifying</h4>${rowsHTML(caps, 'minus')}` : ''}
        ${plus.length ? `<h4>What's good</h4>${rowsHTML(plus, 'plus')}` : ''}
        ${minus.length ? `<h4>What hurt</h4>${rowsHTML(minus, 'minus')}` : ''}
        ${neutral.length ? `<h4>Not counted against it</h4>${rowsHTML(neutral, 'plus')}` : ''}
        <div class="foot">
          <span>${esc(NOVA_TEXT[result.nova])} · base ${result.base}</span>
          <span>${esc(sourceLabel(meta))} · <button class="report" type="button">Looks wrong?</button></span>
        </div>
        <p class="disclaim">A guide to what is on the label, not health advice. Ingredient text can
          be incomplete or out of date — check the package before you rely on this.</p>
      </div>
    </div>`;
  }

  function renderLoading(meta) {
    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9">
      <div class="fail" role="status" aria-live="polite">
        <b>Checking Open Food Facts…</b>
        Amazon didn't publish readable ingredients, so the optional barcode fallback is looking for
        this product. No Amazon page or browsing data is sent.
      </div>
    </div>`;
  }

  // Food-only gate. Deliberately not silent: a missing panel on shampoo looks like a bug, and a
  // score looks like we judged it as food. Say what we decided and why, and offer a one-page override.
  function renderNotFood(meta) {
    const reason = (meta && meta.ingestible && meta.ingestible.reason)
      || 'No evidence this is food, a supplement, or otherwise ingestible';
    const title = meta && meta.title ? meta.title : '';
    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9">
      <div class="fail" role="status">
        <b>Not scored — this does not look like food.</b>
        ${esc(reason)}. A score here would treat it as something you eat.
        ${title ? `<div class="sub" style="white-space:normal;margin-top:6px">${esc(title)}</div>` : ''}
        <div class="paste">
          <button class="go anyway" type="button">Score anyway</button>
        </div>
        <p style="margin-top:10px;font-size:12px;color:#565959">
          This is on because “Only rate food &amp; supplements” is enabled in settings.
        </p>
      </div>
    </div>`;
  }

  // Honest failure state. Never fabricate a score.
  function renderFailure(meta) {
    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9">
      <div class="fail" role="status">
        <b>Couldn't read the ingredients on this page.</b>
        ${meta && meta.lowCoverage
          ? "The ingredients are published, but almost none of them match anything this tool knows — usually that means the label is in a language it cannot read yet. Scoring it anyway would produce a confident wrong answer. "
          : meta && meta.lookupAttempted
          ? "The optional barcode lookup didn't return an ingredient list. "
          : "Amazon doesn't always publish them as text — sometimes they only exist inside the label photo. "}
        Paste them here and I'll score it.
        <div class="paste">
          <textarea id="air-paste" aria-label="Ingredient list" aria-describedby="air-paste-hint" placeholder="Paste the ingredient list…"></textarea>
          <button class="go" type="button" disabled>Score</button>
        </div>
        <p class="hint" id="air-paste-hint" role="status"></p>
      </div>
    </div>`;
  }

  function pasteLooksValid(text) {
    const t = String(text || '').trim();
    if (t.length < 4) return false;
    if (root.AIR.extract && typeof root.AIR.extract.looksLikeIngredients === 'function') {
      return root.AIR.extract.looksLikeIngredients(t);
    }
    return t.length >= 8;
  }

  function wirePasteField(shadow, onPaste) {
    const ta = shadow.querySelector('textarea');
    const go = shadow.querySelector('button.go:not(.anyway)');
    if (!ta || !go) return;
    const hint = shadow.querySelector('.hint');
    const validate = () => {
      const text = ta.value.trim();
      const ok = pasteLooksValid(text);
      go.disabled = !ok;
      ta.setAttribute('aria-invalid', text && !ok ? 'true' : 'false');
      if (hint) {
        hint.textContent = text && !ok
          ? "That doesn't look like an ingredient list yet."
          : '';
      }
    };
    ta.addEventListener('input', validate);
    ta.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !go.disabled) {
        e.preventDefault();
        go.click();
      }
    });
    validate();
    if (typeof onPaste === 'function') {
      go.addEventListener('click', () => {
        const text = ta.value.trim();
        if (!pasteLooksValid(text)) return;
        onPaste(text);
      });
    }
  }

  function mount(host, html, onReport, onPaste) {
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
    const card = shadow.querySelector('.card');
    const report = shadow.querySelector('.report');
    if (report) {
      report.addEventListener('click', e => {
        e.stopPropagation();          // the whole header is a toggle; don't expand on report
        report.disabled = true;
        report.textContent = 'Sending…';
        const done = ok => { report.textContent = ok ? 'Thanks — logged' : 'Set a contribution URL in settings'; };
        if (typeof onReport === 'function') onReport(done); else done(false);
      });
    }
    const head = shadow.querySelector('.head');
    if (head) head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
    });
    wirePasteField(shadow, onPaste);
    return shadow;
  }

  root.AIR.panel = { render, renderLoading, renderFailure, renderNotFood, mount, BAND_COLOR, pasteLooksValid };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.panel;
})(typeof globalThis !== 'undefined' ? globalThis : self);
