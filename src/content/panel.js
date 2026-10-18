// The score panel.
//
// Rendered into a closed shadow root. Amazon's stylesheet is global and aggressive; a shadow root
// is the only reliable way to guarantee their CSS cannot reach in and ours cannot leak out. Closed
// mode also keeps host.shadowRoot null so page JS cannot walk the card. Tests and the harness use
// AIR.panel.shadowOf(host) — a second attachShadow on a closed root throws.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('../engine/db/theme.js');

(function (root) {
  root.AIR = root.AIR || {};

  // The score colours: the reader's palette (engine/db/theme.js). fg, bg and ring are the light-scheme
  // text, fill and ring; dfg and dring are the text and ring on the dark surfaces.
  const BAND_COLOR = score => root.AIR.db.theme.band(score);

  // chrome.i18n where it exists, the English string otherwise. The fallback keeps this file
  // runnable under Node — the test suites render the panel — and keeps the source readable, so a
  // reviewer can see the copy without opening messages.json. Every key here must exist in
  // _locales/en/messages.json; tests/sanity.test.js enforces that.
  function t(key, fallback, ...subs) {
    let out = null;
    try { out = chrome.i18n.getMessage(key, subs.map(String)) || null; }
    catch (e) { /* not running inside an extension */ }
    if (!out) out = fallback;
    return subs.reduce((acc, v, i) => acc.split('$' + (i + 1)).join(String(v)), out);
  }

  function verdictText(v) {
    if (v === 'Excellent') return t('verdictExcellent', 'Excellent');
    if (v === 'Good') return t('verdictGood', 'Good');
    if (v === 'Mediocre') return t('verdictMediocre', 'Mediocre');
    if (v === 'Poor') return t('verdictPoor', 'Poor');
    if (v === 'Avoid') return t('verdictAvoid', 'Avoid');
    return v;
  }

  const NOVA_TEXT = {
    get 1() { return t('novaWhole', 'Whole / minimally processed'); },
    get 2() { return t('novaCulinary', 'Culinary ingredient'); },
    get 3() { return t('novaProcessed', 'Processed'); },
    get 4() { return t('novaUltra', 'Ultra-processed'); },
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0;
      font-family: "Amazon Ember", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .card { border: 1px solid #d5d9d9; border-radius: 10px; overflow: hidden;
          background: #fff; margin: 14px 0; box-shadow: 0 1px 3px rgba(0,0,0,.06);
          min-height: 72px; }
  .card[role="status"], .fail[role="status"] { }
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
  .actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 2px 16px 8px; }
  .card.open .actions { display: none; }
  .flags + .actions, .actions + .flags { padding-top: 0; }
  button.copy { background: none; border: 0; padding: 0; font: inherit; font-size: 11px;
                color: #007185; cursor: pointer; text-decoration: underline; }
  button.copy:hover { color: #c7511f; }
  button.copy:focus-visible { outline: 3px solid #007185; outline-offset: 2px; }
  @keyframes air-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .55 } }
  .loading b { animation: air-pulse 1.2s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .loading b { animation: none; }
    .chev { transition: none; }
  }
  @media (prefers-color-scheme: dark) {
    .card { background: #1b1c1c; border-color: #3a3c3c; box-shadow: none; }
    .head { background: #232525; }
    .head:hover { filter: brightness(1.06); }
    .body { border-top-color: #3a3c3c; }
    .sub, .chev, .ing, .m, h4, .prov h5, .foot, .disclaim { color: #aeaeae; }
    .why { color: #f3f3f3; }
    .pts { color: #f3f3f3; }
    .plus .pts { color: #7bd99b; }
    .minus .pts, .capflag .pts { color: #ff8585; }
    .pop { color: #f3f3f3; }
    .fail { color: #f3f3f3; }
    .foot { border-top-color: #3a3c3c; }
    .score { background: #1b1c1c; border-color: var(--dring, var(--ring)); color: var(--dfg, var(--fg)); }
    .verdict { color: var(--dfg, var(--fg)); }
    textarea { background: #232525; border-color: #3a3c3c; color: #f3f3f3; }
    button.go:disabled { background: #2d2f2f; border-color: #3a3c3c; color: #8a8a8a; }
    .flag { background: #3d2e14; color: #f3d19c; border-color: #8a6a2a; }
    .flag.avoid { background: #3a1c1c; color: #f5b5b5; border-color: #8a3a3a; }
    .report, button.copy { color: #4db6c8; }
    .report:hover, button.copy:hover { color: #e8a07a; }
    .hint { color: #f5b5b5; }
    /* "How this was produced": the rows inherited the page's black text and a light-theme grey for the
       description, so a certification read as black on near-black. */
    .cert { color: #f3f3f3; }
    .cert .m { color: #aeaeae; }
    .cert.v .tick { color: #7bd99b; }
    .cert.c .tick { color: #f0b455; }
    .cert.h .tick { color: #ff8585; }
  }
  `;

  // Allergen, diet and avoid-list warnings. Deliberately outside the collapsed body: if you asked to
  // be told about sesame, you should not have to expand a card to find out.
  function flagsHTML(flags, selected = false) {
    if (!flags || !flags.length) return selected ? `<p class="disclaim" style="padding:6px 16px 0">${esc(t('allergenNoFlags', 'No selected warnings were found in the text this page provided. Lists can be incomplete — this does not confirm a product is free of an allergen.'))}</p>` : '';
    // A missing flag is the dangerous direction: flags come only from the text we managed to read,
    // so a truncated, unread or unrecognised list produces none at all — which looks identical to
    // "clear". Say so next to the chips rather than anywhere a user has to go looking.
    const hasAllergen = flags.some(f => f.kind === 'allergen');
    return `<div class="flags" role="status">${flags.map(f =>
      `<span class="flag${f.kind === 'avoid' ? ' avoid' : ''}" title="${esc(f.ingredient || '')}">${esc(f.label)}</span>`
    ).join('')}</div>${hasAllergen
      ? `<p class="disclaim" style="padding:6px 16px 0">${esc(t('allergenCaveat',
          'Found in the ingredient text on this page. Absence of a warning is not a safety check — never rely on this for an allergy.'))}</p>`
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
      <span><b>${esc(t('hollowMeansNothing', '$1 means nothing here', h.label))}</b><br><span class="m">${esc(h.why)}</span></span></div>`);
    if (!rows.length) {
      rows.push(`<div class="cert h"><span class="tick">?</span><span><b>${esc(t('notFoodNothing',
        'Nothing disclosed about how this was produced'))}</b><br><span class="m">${esc(t('producedSilent',
        'No certification, feed, or origin claim on the page. Commodity $1 with a silent label is conventionally raised by default.', p.kind))}</span></span></div>`);
    }
    const src = meta && meta.provenanceSource ? ` · ${esc(meta.provenanceSource)}` : '';
    return `<div class="prov"><h5>${esc(t('headProduced', 'How this was produced'))}${src}</h5>${rows.join('')}</div>`;
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
    if (meta.via === 'manual-paste') return t('srcPasted', 'Ingredients you pasted');
    if (meta.via === 'label-ocr') return t('srcOcr', 'Read from the label photo on this page');
    if (meta.via === 'open-food-facts') return t('srcBarcode', 'Matched by barcode via Open Food Facts — not from this page');
    if (meta.confidence >= 0.9) return t('srcPage', 'Ingredients read from page');
    return t('srcPageConf', 'Ingredients read from page ($1% confidence)', Math.round((meta.confidence || 0) * 100));
  }

  // The panel's rows, grouped. Shared by the product panel and the results-page breakdown so the
  // two can never disagree about what a score was made of.
  function sections(result) {
    const isCapRow = h => h.c === 'CAP' || h.cap === true;
    // The engine marks rows from the refined-sugar table; this used to re-list those rule names
    // here and had already drifted from sugars.js once.
    const refinedSugarPresent = result.bad.some(h => h.refined === true);
    return {
      caps: result.bad.filter(isCapRow),
      minus: result.bad.filter(h => !isCapRow(h)),
      plus: result.good.filter(h => h.c > 0),
      // A zero-point note about milk or fruit sugar is useful on a clean food, but reads like a
      // health halo on candy or chips. Hide that cosmetic note when refined added sugar is present.
      neutral: result.good.filter(h => h.c === 0 && !(refinedSugarPresent && /Natural sugar/i.test(h.why))),
    };
  }

  // `result` is the engine output; `meta` carries title/confidence/source.
  function render(result, meta) {
    const c = BAND_COLOR(result.score);
    const { caps, minus, plus, neutral } = sections(result);
    const copyLine = [result.score, verdictText(result.verdict), NOVA_TEXT[result.nova], meta.title || '']
      .filter(Boolean).join(' · ');

    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:${c.fg};--bg:${c.bg};--ring:${c.ring};--dfg:${c.dfg};--dring:${c.dring}" role="status" aria-live="polite">
      <button class="head" part="head" type="button" aria-expanded="false" aria-controls="air-panel-details">
        <span class="score" title="${esc(verdictText(result.verdict))} · ${esc(NOVA_TEXT[result.nova])}">${result.score}</span>
        <span class="meta">
          <span class="verdict">${esc(verdictText(result.verdict).toUpperCase())}</span>
          <span class="sub">${esc(NOVA_TEXT[result.nova])} · ${esc(meta.title || '')}</span>
        </span>
        <span class="chev">▾</span>
      </button>
      <div class="actions">
        <button class="copy" type="button" data-copy="${esc(copyLine)}">${esc(t('copyScore', 'Copy score'))}</button>
      </div>
      ${typeof result.coverage === 'number' && result.coverage < 0.7
        ? `<p class="disclaim" style="padding:4px 16px 0">${esc(t('coverageWarn',
          'Only $1% of this list was recognised — treat the score as a partial reading.',
          Math.round(result.coverage * 100)))}</p>`
        : ''}
      ${flagsHTML(result.flags, !!result.selectedAllergens?.length)}
      ${provenanceHTML(result.provenance, meta)}
      <div class="body" id="air-panel-details">
        ${caps.length ? `<h4>${esc(t('headDisqualifying', 'Score limits'))}</h4>${rowsHTML(caps, 'minus')}` : ''}
        ${plus.length ? `<h4>${esc(t('headGood', "What's good"))}</h4>${rowsHTML(plus, 'plus')}` : ''}
        ${minus.length ? `<h4>${esc(t('headHurt', 'What hurt'))}</h4>${rowsHTML(minus, 'minus')}` : ''}
        ${neutral.length ? `<h4>${esc(t('headNeutral', 'Not counted against it'))}</h4>${rowsHTML(neutral, 'plus')}` : ''}
        <div class="foot">
          <span>${esc(NOVA_TEXT[result.nova])} · ${esc(t('footBase', 'base $1', result.base))}${
            result.ruleCount ? ' · ' + esc(t('footRules', '$1 rules', result.ruleCount)) : ''}${
            typeof result.coverage === 'number' && result.coverage < 1
              ? ' · ' + esc(t('footCoverage', '$1% of the list recognised', Math.round(result.coverage * 100))) : ''}</span>
          <span><button class="copy" type="button" data-copy="${esc(copyLine)}">${esc(t('copyScore', 'Copy score'))}</button>
            · ${esc(sourceLabel(meta))}${meta.report === false ? ''
              : ` · <button class="report" type="button">${esc(t('reportLink', 'Looks wrong?'))}</button>`}</span>
        </div>
        <p class="disclaim">${esc(t('disclaimer',
          'A guide to what is on the label, not health advice. Ingredient text can be incomplete or out of date — check the package before you rely on this.'))}</p>
      </div>
    </div>`;
  }

  const POP_CSS = `
  .pop { width: 340px; max-width: calc(100vw - 16px); max-height: min(70vh, 540px); overflow: auto;
         background: #fff; border: 1px solid #d5d9d9; border-radius: 10px; font-size: 13px;
         box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 12px 14px 10px; }
  .pop .top { display: flex; align-items: center; gap: 10px; }
  .pop .score { width: 40px; height: 40px; font-size: 16px; border-width: 2px; }
  .pop h4 { margin: 10px 0 4px; }
  .pop li { padding: 2px 0; font-size: 12px; }
  .pop .flags { padding: 8px 0 0; }
  .pop .prov { padding: 6px 0 0; }
  .pop .note { margin-top: 8px; font-size: 11px; color: #565959; }
  .pop .more { display: block; margin-top: 10px; padding-top: 8px; border-top: 1px solid #eaeded;
               font-size: 12px; font-weight: 600; color: #007185; text-decoration: none; }
  .pop .more:hover { color: #c7511f; text-decoration: underline; }
  .pop .more:focus-visible { outline: 3px solid #007185; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    .pop { background: #1b1c1c; border-color: #3a3c3c; }
    .pop .note { color: #aeaeae; }
    .pop .more { color: #4db6c8; border-top-color: #3a3c3c; }
  }
  `;

  // Why a results-page badge says what it says. `result` is the engine output for that product
  // under the reader's weights, or null when no reading is kept for it; `meta` carries the badge's
  // own score and verdict, the ASIN, and `detail`: 'full' (every row, as on the product page) or
  // 'compact' (disqualifiers, the top five minuses and top three pluses).
  function renderBreakdown(result, meta) {
    const shown = result || { score: meta.score, verdict: meta.verdict, nova: meta.nova, good: [], bad: [] };
    const c = BAND_COLOR(shown.score);
    const more = `<a class="more" href="/dp/${esc(meta.asin)}">${esc(t('breakdownMore', 'Open product for full detail'))} →</a>`;
    const head = `<div class="top">
        <span class="score">${shown.score}</span>
        <span class="meta"><span class="verdict">${esc(verdictText(shown.verdict).toUpperCase())}</span>
          <span class="sub">${esc(NOVA_TEXT[shown.nova] || '')}</span></span>
      </div>`;
    let body;
    if (!result) {
      body = `<p class="note">${esc(t('breakdownNone', 'This score was saved before breakdowns were kept. Open the product to see why.'))}</p>`;
    } else {
      const compact = meta.detail === 'compact';
      const { caps, minus, plus, neutral } = sections(result);
      const top = (rows, n) => (compact ? rows.slice().sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, n) : rows);
      body = `${flagsHTML(result.flags, !!result.selectedAllergens?.length)}
        ${compact ? '' : provenanceHTML(result.provenance, meta)}
        ${caps.length ? `<h4>${esc(t('headDisqualifying', 'Score limits'))}</h4>${rowsHTML(caps, 'minus')}` : ''}
        ${plus.length ? `<h4>${esc(t('headGood', "What's good"))}</h4>${rowsHTML(top(plus, 3), 'plus')}` : ''}
        ${minus.length ? `<h4>${esc(t('headHurt', 'What hurt'))}</h4>${rowsHTML(top(minus, 5), 'minus')}` : ''}
        ${!compact && neutral.length ? `<h4>${esc(t('headNeutral', 'Not counted against it'))}</h4>${rowsHTML(neutral, 'plus')}` : ''}
        ${!caps.length && !plus.length && !minus.length ? `<p class="note">${esc(t('breakdownClean', 'Nothing on this label moved the score up or down.'))}</p>` : ''}
        ${compact && (minus.length > 5 || plus.length > 3 || neutral.length) ? `<p class="note">${esc(t('breakdownTrimmed', 'Showing the biggest reasons only.'))}</p>` : ''}
        ${result.score !== meta.score ? `<p class="note">${esc(t('breakdownDiffers', 'The product page scored this $1 with shared certification data this breakdown does not include.', meta.score))}</p>` : ''}`;
    }
    return `<style>${CSS}${POP_CSS}</style>
    <div class="pop" role="dialog" aria-label="${esc(t('breakdownLabel', 'Why this scored $1', shown.score))}"
         style="--fg:${c.fg};--bg:${c.bg};--ring:${c.ring};--dfg:${c.dfg};--dring:${c.dring}">${head}${body}${more}</div>`;
  }

  function renderLoading(meta) {
    const ocr = !!(meta && meta.ocr);
    const slow = !!(meta && meta.slow);
    if (meta && meta.cache) {
      return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9;--dfg:#aeaeae;--dring:#5a5c5c">
      <div class="fail loading" role="status" aria-live="polite">
        <b>${esc(t('loadingCacheTitle', 'Looking for a saved reading…'))}</b>
        ${esc(t('loadingCacheBody', "Amazon didn't publish the ingredients as text. Checking whether this product was already read, here or in the shared database."))}
      </div>
    </div>`;
    }
    const title = ocr
      ? (slow
        ? t('loadingOcrSlowTitle', 'Still reading the label…')
        : t('loadingOcrTitle', 'Reading the label photo…'))
      : t('loadingTitle', 'Checking Open Food Facts…');
    const body = ocr
      ? (slow
        ? t('loadingOcrSlowBody', 'Large photos take longer. This stays on your computer — nothing is sent anywhere.')
        : t('loadingOcrBody', "Amazon didn't publish the ingredients as text, so the label image is being read on your computer. This takes a few seconds and nothing is sent anywhere."))
      : t('loadingBody', "Amazon didn't publish readable ingredients, so the optional barcode fallback is looking for this product. No Amazon page or browsing data is sent.");
    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9;--dfg:#aeaeae;--dring:#5a5c5c">
      <div class="fail loading" role="status" aria-live="polite">
        <b>${esc(title)}</b>
        ${esc(body)}
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
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9;--dfg:#aeaeae;--dring:#5a5c5c">
      <div class="fail" role="status" aria-live="polite">
        <b>${esc(t('notFoodTitle', 'Not scored — this does not look like food.'))}</b>
        ${esc(reason)}. ${esc(t('notFoodBody', 'A score here would treat it as something you eat.'))}
        ${title ? `<div class="sub" style="white-space:normal;margin-top:6px">${esc(title)}</div>` : ''}
        <div class="paste">
          <button class="go anyway" type="button">${esc(t('notFoodButton', 'Score anyway'))}</button>
        </div>
        <p style="margin-top:10px;font-size:12px;color:#565959">${esc(t('notFoodWhy',
          'This is on because “Only rate food & supplements” is enabled in settings.'))}</p>
      </div>
    </div>`;
  }

  // A neutral message with one optional action, for a store page that needs something from the
  // visitor before it can be read (Target's collapsed "Label info"). The action is a button in the
  // panel; the page itself is only touched when the visitor presses it.
  function renderNotice(meta) {
    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9;--dfg:#aeaeae;--dring:#5a5c5c">
      <div class="fail" role="status" aria-live="polite">
        <b>${esc(meta.title || '')}</b>
        ${esc(meta.body || '')}
        ${meta.action ? `<div class="paste"><button class="go notice-action" type="button">${esc(meta.action)}</button></div>` : ''}
      </div>
    </div>`;
  }

  // Honest failure state. Never fabricate a score.
  function renderFailure(meta) {
    return `
    <style>${CSS}</style>
    <div class="card" style="--fg:#565959;--bg:#f7f8f8;--ring:#d5d9d9;--dfg:#aeaeae;--dring:#5a5c5c">
      <div class="fail" role="status" aria-live="polite">
        <b>${esc(t('failTitle', "Couldn't read the ingredients on this page."))}</b>
        ${meta && meta.lowCoverage
          ? esc(t('failUnreadable', 'The ingredients are published, but almost none of them match anything this tool knows — usually that means the label is in a language it cannot read yet. Scoring it anyway would produce a confident wrong answer. '))
          : meta && meta.localeDeclined
          ? esc(t('failLocale', 'This Amazon store’s labels are in a script the on-device English reader will misread, so photo OCR is not used here yet. Paste the list if you can read it. '))
          : meta && meta.ocrOutcome === 'no-images'
          ? esc(t('failOcrNoImages', 'No usable label photo was available to check. '))
          : meta && meta.ocrOutcome === 'error'
          ? esc(t('failOcrError', 'The label photo could not be checked because the reader failed. '))
          : meta && meta.ocrOutcome === 'no-match'
          ? esc(t('failOcrNoMatch', 'The label photo was checked, but no ingredient list could be read from it. '))
          : meta && meta.lookupAttempted
          ? esc(t('failLookup', "The optional barcode lookup didn't return an ingredient list. "))
          : meta && meta.storeName
          ? esc(t('failNoTextStore', "$1 doesn't publish an ingredient list for every product. ", meta.storeName))
          : esc(t('failNoText', "Amazon doesn't always publish them as text — sometimes they only exist inside the label photo. "))}
        ${esc(t('failPastePrompt', "Paste them here and I'll score it."))}
        <div class="paste">
          <textarea id="air-paste" aria-label="${esc(t('pasteLabel', 'Ingredient list'))}" aria-describedby="air-paste-hint" placeholder="${esc(t('pastePlaceholder', 'Paste the ingredient list…'))}"></textarea>
          <button class="go" type="button" disabled>${esc(t('scoreButton', 'Score'))}</button>
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
          ? t('pasteInvalid', "That doesn't look like an ingredient list yet.")
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
    // The field is deliberately NOT focused on mount. The failure card appears a second or so
    // after a product page loads, on every product Amazon publishes no ingredient text for, and
    // pulling focus into it redirected whatever the person was typing into the search box.
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('no clipboard'));
  }

  function wireCopy(shadow) {
    shadow.querySelectorAll('button.copy').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const text = btn.getAttribute('data-copy') || '';
        const original = btn.textContent;
        copyToClipboard(text).then(() => {
          btn.textContent = t('copied', 'Copied');
          setTimeout(() => { btn.textContent = original; }, 1400);
        }).catch(() => {
          btn.textContent = t('copyFailed', 'Could not copy');
          setTimeout(() => { btn.textContent = original; }, 1400);
        });
      });
    });
  }

  // host.shadowRoot is always null when mode is 'closed'. Keep our own handle.
  const shadows = new WeakMap();

  function shadowOf(host) {
    return host ? shadows.get(host) || null : null;
  }

  function attach(host) {
    let shadow = shadows.get(host);
    if (shadow) return shadow;
    shadow = host.attachShadow({ mode: 'closed' });
    shadows.set(host, shadow);
    return shadow;
  }

  function mount(host, html, onReport, onPaste) {
    const shadow = attach(host);
    const safe = root.DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORCE_BODY: true, USE_PROFILES: { html: true } });
    if (!safe) throw new Error('Score panel HTML parsing failed');
    shadow.replaceChildren(safe);
    root.AIR.db.theme.force(shadow);          // light or dark as the reader chose, not only the system's
    const card = shadow.querySelector('.card');
    const report = shadow.querySelector('.report');
    if (report) {
      report.addEventListener('click', e => {
        e.stopPropagation();          // the whole header is a toggle; don't expand on report
        report.disabled = true;
        report.textContent = t('reportSending', 'Sending…');
        const done = ok => {
          report.textContent = ok ? t('reportThanks', 'Thanks — logged')
            : t('reportNoUrl', 'Set a contribution URL in settings');
        };
        if (typeof onReport === 'function') onReport(done); else done(false);
      });
    }
    const head = shadow.querySelector('.head');
    if (head) head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
    });
    if (head && card) {
      shadow.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !card.classList.contains('open')) return;
        card.classList.remove('open');
        head.setAttribute('aria-expanded', 'false');
        head.focus();
      });
    }
    wireCopy(shadow);
    wirePasteField(shadow, onPaste);
    return shadow;
  }

  // Expand a mounted card, as a click on its header does.
  function openCard(host) {
    const shadow = shadowOf(host);
    const card = shadow && shadow.querySelector('.card');
    const head = shadow && shadow.querySelector('.head');
    if (!card || !head) return;
    card.classList.add('open');
    head.setAttribute('aria-expanded', 'true');
  }

  root.AIR.panel = { openCard, render, renderBreakdown, renderLoading, renderFailure, renderNotFood, renderNotice, mount, shadowOf, BAND_COLOR, NOVA_TEXT, pasteLooksValid, t, sections };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.panel;
})(typeof globalThis !== 'undefined' ? globalThis : self);
