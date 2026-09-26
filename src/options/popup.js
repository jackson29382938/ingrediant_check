const CACHE = AIR.db.scoreCache;
const CATS = AIR.db.categories;
const PREFS = AIR.db.prefs;
const KEYS = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'hoverBreakdown', 'hoverScore', 'unitPrice', 'ocrLabels', 'useOpenFoodFacts'];
// Every plain checkbox. useOpenFoodFacts is handled separately because it also drives an
// optional-permission request. hoverScore was missing from this list, which left the
// checkbox inert: it never loaded its stored value and never wrote one.
const TOGGLE_KEYS = ['enabled', 'badges', 'foodOnly', 'autoScoreSearch', 'hoverBreakdown', 'hoverScore', 'unitPrice', 'ocrLabels'];
const OFF_PERMISSION = { origins: ['https://world.openfoodfacts.org/*'] };
let writing = false;

const cleanToggles = raw => PREFS.sanitizeToggles(raw);

function say(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg || '';
}

function persist(values, done) {
  writing = true;
  chrome.storage.local.set(values, () => {
    writing = false;
    if (chrome.runtime.lastError) {
      say(msg('popupCouldNotSave', 'Could not save.'));
      if (done) done(false);
      return;
    }
    if (done) done(true);
  });
}

// Swap in the active locale. The English copy stays in the HTML so the popup is readable and
// reviewable as source, and so it still renders if a message key is ever missing.
(function localise() {
  if (!chrome.i18n || typeof chrome.i18n.getMessage !== 'function') return;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
})();

// Off is a pause. The sub-toggles are disabled so they cannot be changed into a state that is not
// running, but they keep their values and stay readable, because the whole point of the master
// switch is that it does not cost you your configuration.
function paintMaster(on) {
  document.body.classList.toggle('paused', !on);
  for (const el of document.querySelectorAll('.sub-toggles input')) el.disabled = !on;
}

function save(key, value) {
  persist({ [key]: value });
}

// { ids, custom } — the selected goals, and whether a slider has since moved off them.
function currentGoals(weights, goals) {
  return CATS.describeGoals(weights, goals);
}

let popupPresetCategory = 'everyday';

function paintPopupActive(goals) {
  const name = document.getElementById('presetActiveName');
  if (!name) return;
  const label = CATS.goalsLabel(goals.ids);
  name.textContent = goals.custom
    ? `${msg('optPresetCustomLabel', 'Custom')}${goals.ids.length ? ` (${label})` : ''}`
    : label;
  name.classList.toggle('is-custom', goals.custom);
}

// "Goals · 2": how many selected goals a tab holds, so goals picked on other tabs stay visible.
function paintCategoryCount(tab, cat, goalIds) {
  const n = (goalIds || []).filter(id => CATS.PRESETS[id] && (CATS.PRESETS[id].category || 'everyday') === cat.id).length;
  tab.textContent = n ? `${cat.label} · ${n}` : cat.label;
  tab.classList.toggle('has-picks', n > 0);
}

function renderPresetCategories(weights, goalIds) {
  const host = document.getElementById('presetCats');
  if (!host) return;
  const cats = CATS.PRESET_CATEGORIES || [{ id: 'everyday', label: 'Everyday' }];
  host.textContent = '';
  for (const cat of cats) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-cat';
    b.dataset.category = cat.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(cat.id === popupPresetCategory));
    paintCategoryCount(b, cat, goalIds);
    b.addEventListener('click', () => {
      popupPresetCategory = cat.id;
      const grid = document.getElementById('presets');
      if (grid) grid.dataset.userTab = '1';
      renderPresets(weights, goalIds);
    });
    host.appendChild(b);
  }
}

let popupGoals = [];
function renderPresets(weights, goalIds = popupGoals) {
  const host = document.getElementById('presets');
  if (!host) return;
  popupGoals = goalIds || [];
  popupWeights = weights;
  const goals = currentGoals(weights, popupGoals);
  const first = goals.ids[0] || (goals.custom ? null : 'balanced');
  if (first && CATS.PRESETS[first].category && !host.dataset.userTab) {
    popupPresetCategory = CATS.PRESETS[first].category;
  }
  renderPresetCategories(weights, goals.ids);

  host.textContent = '';
  const entries = Object.entries(CATS.PRESETS)
    .filter(([, p]) => (p.category || 'everyday') === popupPresetCategory);
  for (const [id, preset] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = id;
    b.setAttribute('aria-pressed', String(goals.ids.includes(id) || (id === 'balanced' && !goals.ids.length && !goals.custom)));
    b.title = preset.note;
    const glyph = document.createElement('span');
    glyph.className = 'preset-glyph';
    glyph.textContent = preset.glyph || preset.label.slice(0, 3);
    glyph.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'preset-copy';
    const title = document.createElement('span');
    title.className = 'preset-title';
    title.textContent = preset.label;
    const snip = document.createElement('span');
    snip.className = 'preset-snip';
    snip.textContent = preset.note;
    copy.append(title, snip);
    b.append(glyph, copy);
    b.addEventListener('click', () => applyPreset(id));
    host.appendChild(b);
  }

  document.querySelectorAll('.preset-cat').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.category === popupPresetCategory));
  });

  paintPopupActive(goals);
  const note = document.getElementById('presetNote');
  if (note) {
    const last = goals.ids.at(-1);
    note.textContent = goals.custom
      ? msg('popupPresetCustom', 'Custom weights — open Settings to fine-tune every dial.')
      : goals.ids.length > 1
        ? msg('popupGoalsCombined', 'Goals combined: where two set the same dial, they are averaged.')
        : CATS.PRESETS[last || 'balanced'].note;
  }
}

// A goal card toggles that goal; the weights become the average of everything selected. Goals
// combine across tabs, so the popup stays on the tab that was clicked: it used to jump back to the
// first selected goal's tab, which hid the goal just picked and looked like only one could be chosen.
let popupWeights = null;
function applyPreset(id) {
  if (!CATS.PRESETS[id]) return;
  const goals = CATS.toggleGoal(currentGoals(popupWeights, popupGoals).ids, id);
  const weights = PREFS.sanitizeScoring({ weights: CATS.goalWeights(goals) }).weights;
  const host = document.getElementById('presets');
  popupPresetCategory = CATS.PRESETS[id].category || popupPresetCategory;
  if (host) host.dataset.userTab = '1';
  persist({ weights, goals }, ok => { if (ok) renderPresets(weights, goals); });
  AIR.db.activity && AIR.db.activity.log('popup', `goal ${goals.includes(id) ? 'picked' : 'removed'}: ${id} (now: ${goals.join(', ') || 'balanced'})`);
}

chrome.storage.local.get([...KEYS, 'weights', 'goals'], options => {
  const toggles = cleanToggles(options);
  const healed = {};
  for (const key of KEYS) {
    if (options[key] !== undefined && options[key] !== toggles[key]) healed[key] = toggles[key];
  }
  if (Object.keys(healed).length) persist(healed);

  for (const key of TOGGLE_KEYS) {
    const input = document.getElementById(key);
    if (!input) continue;
    input.checked = toggles[key];
    input.addEventListener('change', () => {
      save(key, input.checked);
      AIR.db.activity && AIR.db.activity.log('popup', `${key} ${input.checked ? 'on' : 'off'}`);
      if (key === 'enabled') paintMaster(input.checked);
    });
  }
  paintMaster(toggles.enabled);
  renderPresets(options.weights, options.goals);

  const fallback = document.getElementById('useOpenFoodFacts');
  chrome.permissions.contains(OFF_PERMISSION, hasPermission => {
    fallback.checked = toggles.useOpenFoodFacts && hasPermission;
    if (toggles.useOpenFoodFacts && !hasPermission) persist({ useOpenFoodFacts: false });

    fallback.addEventListener('change', () => {
      const requested = fallback.checked;
      fallback.disabled = true;
      say('');

      if (requested) {
        // Chrome only allows optional permission requests in response to a user gesture, so this
        // must run directly from the change handler.
        chrome.permissions.request(OFF_PERMISSION, granted => {
          const permissionError = chrome.runtime.lastError;
          if (permissionError || !granted) {
            fallback.checked = false;
            fallback.disabled = false;
            persist({ useOpenFoodFacts: false });
            say(msg('popupOffDenied', 'Chrome did not grant Open Food Facts access.'));
            return;
          }
          // Some automated/headless Chromium builds report a successful request without actually
          // retaining the host grant. Persist only what Chrome says is truly present.
          chrome.permissions.contains(OFF_PERMISSION, confirmed => {
            fallback.checked = !!confirmed;
            fallback.disabled = false;
            persist({ useOpenFoodFacts: fallback.checked });
            if (!confirmed) say(msg('popupOffNotKept', 'Chrome did not keep the Open Food Facts permission.'));
          });
        });
        return;
      }

      chrome.permissions.remove(OFF_PERMISSION, () => {
        const permissionError = chrome.runtime.lastError;
        fallback.disabled = false;
        fallback.checked = false;
        persist({ useOpenFoodFacts: false });
        void permissionError;
      });
    });
  });
});

function isOn(key, value) {
  return cleanToggles({ [key]: value })[key];
}

function msg(key, fallback, sub) {
  let out = '';
  try { out = chrome.i18n && chrome.i18n.getMessage(key, sub != null ? [String(sub)] : []) || ''; }
  catch (e) { /* missing key or not in an extension page */ }
  return out || fallback;
}

// One palette and one set of NOVA labels, owned by the panel. The copies that used to live here
// had already drifted from it once.
const { NOVA_TEXT: NOVA_SHORT, BAND_COLOR: bandColor } = AIR.panel;

function asinFromUrl(url) {
  try { return (new URL(url).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1] || ''; }
  catch (e) { return ''; }
}

function isAmazonUrl(url) {
  try { return /(^|\.)amazon\./i.test(new URL(url).hostname); }
  catch (e) { return false; }
}

// The product id on a page the extension runs on: the ASIN on Amazon, the store adapter's id
// elsewhere (Target's TCIN). null when the extension does not run on this page at all.
function productOnPage(url) {
  if (isAmazonUrl(url)) return asinFromUrl(url);
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return null; }
  const adapter = Object.values(AIR.storeAdapters || {}).find(a => a.matchesHost(host));
  return adapter ? adapter.productId(url) : null;
}

// The "This page" card from a content script's own answer (see paintPageScore). The entry is the
// score the page just computed, validated like any cached score before it is shown.
function paintStoreCard(card, live, adapter) {
  let version = '';
  try { version = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
  chrome.storage.local.get(['weights', 'foodOnly', 'sheetIndexRev', 'producerIndexRev'], obj => {
    if (!CACHE.valid(live, { store: live.store, asin: live.asin, version, prefs: obj, allowManual: true })) {
      card.hidden = true;
      return;
    }
    const c = bandColor(live.score);
    card.hidden = false;
    card.textContent = '';
    card.className = 'page-score';
    card.style.setProperty('--fg', c.fg);
    card.style.setProperty('--bg', c.bg);
    card.style.setProperty('--ring', c.ring);
    const kicker = document.createElement('div');
    kicker.className = 'ps-kicker';
    kicker.textContent = `${msg('popupThisPage', 'This page')} · ${adapter.name}`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center';
    const num = document.createElement('div');
    num.className = 'ps-num';
    num.textContent = String(live.score);
    const meta = document.createElement('div');
    const verdict = document.createElement('div');
    verdict.className = 'ps-verdict';
    verdict.textContent = live.verdict || '';
    const sub = document.createElement('div');
    sub.className = 'ps-sub';
    sub.textContent = [NOVA_SHORT[live.nova], live.name].filter(Boolean).join(' · ');
    meta.append(verdict, sub);
    row.append(num, meta);
    card.append(kicker, row);
  });
}

function paintPageScore() {
  const card = document.getElementById('pageScore');
  if (!card || !chrome.tabs || typeof chrome.tabs.query !== 'function') return;
  chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
    const tab = tabs && tabs[0];
    let url = tab && tab.url;
    // A store the extension reaches only through a content script (Target) grants no host
    // permission, so Chrome hides the tab's address from the popup. Its content script answers for
    // the page instead; with no answer, the page is one the extension does not run on.
    if (!url && tab && typeof tab.id === 'number') {
      let live = null;
      try { live = await chrome.tabs.sendMessage(tab.id, { type: 'currentPageScore' }); } catch { /* no content script */ }
      if (live && live.store && live.asin) url = `https://www.${live.store}/`;
      if (url) {
        const adapter = Object.values(AIR.storeAdapters || {}).find(a => a.matchesHost(new URL(url).hostname));
        if (adapter) return paintStoreCard(card, live, adapter);
      }
    }
    const asin = url ? productOnPage(url) : null;
    if (asin == null) { card.hidden = true; return; }
    let version = '';
    try { version = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
    card.hidden = false;
    card.textContent = '';
    card.removeAttribute('style');
    if (!asin) {
      card.className = 'page-score empty';
      const p = document.createElement('div');
      p.className = 'ps-empty';
      p.textContent = msg('popupSearchPage', 'Search page — scores show as badges on tiles you have already opened.');
      card.appendChild(p);
      return;
    }
    const store = new URL(url).hostname;
    const key = CACHE.key(store, asin);
    chrome.storage.local.get([key, 'weights', 'foodOnly', 'ocrLabels', 'useOpenFoodFacts', 'sheetIndexRev', 'producerIndexRev'], async obj => {
      let live = null;
      try { live = await chrome.tabs.sendMessage(tab.id, { type: 'currentPageScore' }); } catch { /* tab has no active content script */ }
      const context = { store, asin, version, prefs: obj };
      const hit = CACHE.valid(live, { ...context, allowManual: true }) ? live : obj[key];
      card.textContent = '';
      if (!CACHE.valid(hit, { ...context, allowManual: hit === live })) {
        card.className = 'page-score empty';
        const p = document.createElement('div');
        p.className = 'ps-empty';
        p.textContent = msg('popupNoScore', 'Not scored yet. Wait for the panel on this page, then reopen.');
        card.appendChild(p);
        return;
      }
      const c = bandColor(hit.score);
      card.className = 'page-score';
      card.style.setProperty('--fg', c.fg);
      card.style.setProperty('--bg', c.bg);
      card.style.setProperty('--ring', c.ring);
      const kicker = document.createElement('div');
      kicker.className = 'ps-kicker';
      kicker.textContent = msg('popupThisPage', 'This page');
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:center';
      const num = document.createElement('div');
      num.className = 'ps-num';
      num.textContent = String(hit.score);
      const meta = document.createElement('div');
      const verdict = document.createElement('div');
      verdict.className = 'ps-verdict';
      verdict.textContent = hit.verdict || '';
      const sub = document.createElement('div');
      sub.className = 'ps-sub';
      const source = hit.source === 'manual-paste' ? msg('srcShortPasted', 'Pasted label (this tab)')
        : hit.source === 'food-override' ? msg('srcShortOverride', 'Food filter overridden (this tab)')
        : hit.source === 'label-ocr' ? msg('srcShortOcr', 'Label photo')
        : hit.source === 'open-food-facts' ? msg('srcShortBarcode', 'Open Food Facts') : msg('srcShortPage', 'Product page');
      sub.textContent = [NOVA_SHORT[hit.nova], hit.name, source, hit.provenanceSource].filter(Boolean).join(' · ');
      meta.append(verdict, sub);
      row.append(num, meta);
      card.append(kicker, row);
    });
  });
}

// Scores (s:), the product data behind them (p:) and barcode records (off:). Clearing only the
// scores would rebuild them instantly from p:, which is not what "clear" means here.
// Cached entries (s: scores, p: product readings, off: Open Food Facts), by key only.
const cacheKeys = async () => (await CACHE.storedKeys(chrome.storage.local)).filter(CACHE.isCacheKey);

function compareLabel(hit) {
  const name = (hit.name || hit.asin || '').replace(/\s+/g, ' ').trim();
  return [hit.score, hit.verdict, name].filter(Boolean).join(' · ');
}

function paintCompareCard(hit) {
  const card = document.createElement('div');
  card.className = 'compare-card';
  if (!hit) return card;
  const c = bandColor(hit.score);
  card.style.setProperty('--fg', c.fg);
  card.style.setProperty('--bg', c.bg);
  card.style.setProperty('--ring', c.ring);
  const num = document.createElement('div');
  num.className = 'ps-num';
  num.textContent = String(hit.score);
  const verdict = document.createElement('div');
  verdict.className = 'ps-verdict';
  verdict.textContent = hit.verdict || '';
  const sub = document.createElement('div');
  sub.className = 'ps-sub';
  sub.textContent = [NOVA_SHORT[hit.nova], hit.name, hit.asin].filter(Boolean).join(' · ');
  card.append(num, verdict, sub);
  return card;
}

function fillCompareSelect(select, listed, chosen) {
  const keep = listed.some(h => h.key === chosen) ? chosen : (listed[0] && listed[0].key);
  select.textContent = '';
  for (const hit of listed) {
    const opt = document.createElement('option');
    opt.value = hit.key;
    opt.textContent = compareLabel(hit);
    select.appendChild(opt);
  }
  if (keep) select.value = keep;
  return select.value;
}

function paintCompare() {
  const block = document.getElementById('compareBlock');
  const empty = document.getElementById('compareEmpty');
  const pick = document.getElementById('comparePick');
  const grid = document.getElementById('compareGrid');
  const selA = document.getElementById('compareA');
  const selB = document.getElementById('compareB');
  if (!block || !empty || !pick || !grid || !selA || !selB) return;
  let version = '';
  try { version = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
  // Only the saved scores and the settings they are checked against, not the product readings.
  (async () => {
    const scoreKeys = (await CACHE.storedKeys(chrome.storage.local)).filter(k => k.startsWith('s:'));
    const all = await chrome.storage.local.get([...scoreKeys, 'weights', 'foodOnly', 'ocrLabels', 'useOpenFoodFacts',
      'sheetIndexRev', 'producerIndexRev', 'compareA', 'compareB']);
    const prefs = {
      weights: all.weights, foodOnly: all.foodOnly, ocrLabels: all.ocrLabels,
      useOpenFoodFacts: all.useOpenFoodFacts,
      sheetIndexRev: all.sheetIndexRev, producerIndexRev: all.producerIndexRev,
    };
    const listed = CACHE.listScores(all, { version, prefs });
    if (listed.length < 2) {
      block.hidden = true;
      empty.hidden = false;
      pick.hidden = true;
      grid.textContent = '';
      return;
    }
    block.hidden = false;
    empty.hidden = true;
    pick.hidden = false;
    let pickA = all.compareA;
    let pickB = all.compareB;
    if (pickA === pickB) pickB = listed.find(h => h.key !== pickA)?.key;
    if (!listed.some(h => h.key === pickA)) pickA = listed[0].key;
    if (!listed.some(h => h.key === pickB) || pickB === pickA) {
      pickB = listed.find(h => h.key !== pickA)?.key;
    }
    const aKey = fillCompareSelect(selA, listed, pickA);
    const bKey = fillCompareSelect(selB, listed, pickB);
    const hitA = listed.find(h => h.key === aKey);
    const hitB = listed.find(h => h.key === bKey);
    grid.textContent = '';
    grid.append(paintCompareCard(hitA), paintCompareCard(hitB));
    if (aKey !== all.compareA || bKey !== all.compareB) persist({ compareA: aKey, compareB: bKey });
  })().catch(() => { block.hidden = true; });
}

function wireCompare() {
  for (const id of ['compareA', 'compareB']) {
    const el = document.getElementById(id);
    if (!el || el.dataset.wired) continue;
    el.dataset.wired = '1';
    el.addEventListener('change', () => {
      persist({ [id]: el.value }, () => paintCompare());
    });
  }
}

function paintCacheCount() {
  const btn = document.getElementById('clear');
  if (!btn) return;
  cacheKeys().then(keys => {
    const n = keys.filter(k => !k.startsWith('p:')).length;
    btn.disabled = keys.length === 0;
    btn.textContent = n
      ? msg('popupClearN', `Clear ${n} cached scores`, n)
      : msg('popupClear', 'Clear cached scores');
  }, () => {});
}

function paintWhy(on) {
  document.body.classList.toggle('show-why', on);
  const btn = document.getElementById('toggleWhy');
  if (btn) btn.textContent = on
    ? msg('popupHideWhy', 'Hide explanations')
    : msg('popupShowWhy', 'Why these matter');
}

chrome.storage.onChanged.addListener(changes => {
  if (writing) return;
  for (const key of TOGGLE_KEYS) {
    if (!changes[key]) continue;
    const input = document.getElementById(key);
    if (!input) continue;
    input.checked = isOn(key, changes[key].newValue);
    if (key === 'enabled') paintMaster(input.checked);
  }
  if (changes.useOpenFoodFacts) {
    const fallback = document.getElementById('useOpenFoodFacts');
    if (fallback && !fallback.disabled) fallback.checked = isOn('useOpenFoodFacts', changes.useOpenFoodFacts.newValue);
  }
  if (changes.weights || changes.goals) chrome.storage.local.get(['weights', 'goals'], o => renderPresets(o.weights, o.goals));
  if (changes.popupShowWhy) paintWhy(changes.popupShowWhy.newValue === true);
  if (Object.keys(changes).some(k => /^(s|p|off):/.test(k) || ['weights', 'foodOnly', 'ocrLabels', 'useOpenFoodFacts', 'sheetIndexRev', 'producerIndexRev', 'compareA', 'compareB'].includes(k))) {
    paintCacheCount();
    paintPageScore();
    paintCompare();
  }
});

document.getElementById('openSettings').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById('openSetup').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/welcome.html') });
});

// Straight to a settings section. openOptionsPage() cannot take a fragment; creating a tab needs no
// extra permission.
function openSettingsAt(section) {
  const url = chrome.runtime.getURL('src/options/options.html#' + section);
  if (chrome.tabs && typeof chrome.tabs.create === 'function') chrome.tabs.create({ url });
  else chrome.runtime.openOptionsPage();
}
// The settings that fetch from Amazon, and the note on which stores it can reach.
document.getElementById('openNetwork').addEventListener('click', e => {
  e.preventDefault();
  openSettingsAt('sec-rate');
});
// Where it works, what is planned, and the request form.
document.getElementById('openStores').addEventListener('click', e => {
  e.preventDefault();
  openSettingsAt('sec-stores');
});

// Report a problem or suggest an improvement. The screenshot is taken here, because Chrome allows
// capturing the tab only right after the toolbar button was clicked (activeTab); the report page
// then shows it, and the reader decides whether it goes out. Nothing is sent from here.
// Only an Amazon or Target tab is captured, and only its address noted (AIR.stores.reportMayCapture):
// the popup opens over whatever tab is in front, and that may be a bank or an email.
document.getElementById('openReport').addEventListener('click', async e => {
  e.preventDefault();
  const draft = { t: Date.now(), url: '', shot: '', pageScore: null, shotSkipped: '' };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && AIR.stores && AIR.stores.reportMayCapture(tab.url)) {
      draft.url = tab.url || '';
      try { draft.shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 }); } catch (err) { draft.shot = ''; }
      try { draft.pageScore = await chrome.tabs.sendMessage(tab.id, { type: 'currentPageScore' }); } catch (err) { draft.pageScore = null; }
    } else if (tab) {
      draft.shotSkipped = 'not-a-store';
    }
  } catch (err) { /* no tab access */ }
  try { await chrome.storage.session.set({ reportDraft: draft }); } catch (err) { /* the page still opens */ }
  await AIR.db.activity.log('popup', 'opened "Report a problem or suggest an improvement"');
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/report.html') });
});

document.getElementById('toggleWhy').addEventListener('click', () => {
  const next = !document.body.classList.contains('show-why');
  paintWhy(next);
  persist({ popupShowWhy: next });
});

document.getElementById('clear').addEventListener('click', async event => {
  event.preventDefault();
  try {
    const keys = await cacheKeys();
    await chrome.storage.local.remove(keys);
    const n = keys.filter(k => !k.startsWith('p:')).length;
    const cleared = chrome.i18n && chrome.i18n.getMessage('popupCleared', [String(n)]);
    event.target.textContent = cleared || `Cleared ${n} cached scores`;
    event.target.disabled = true;
    paintPageScore();
    paintCompare();
  } catch (e) {
    say(msg('popupCouldNotClear', 'Could not clear cached scores.'));
  }
});

chrome.storage.local.get('popupShowWhy', o => paintWhy(o.popupShowWhy === true));
paintPageScore();
paintCacheCount();
wireCompare();
paintCompare();

(function paintVersion() {
  const el = document.getElementById('version');
  if (!el) return;
  try {
    const v = chrome.runtime.getManifest().version;
    el.textContent = v ? `v${v}` : '';
  } catch (e) { el.textContent = ''; }
})();
