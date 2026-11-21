(function() {
  const S = AIR.db.shopping, $ = id => document.getElementById(id);
  const t = (key, fallback, ...values) => { let value = ''; try { value = chrome.i18n.getMessage(key, values.map(String)); } catch { /* use fallback */ } return value || fallback.replace(/\$(\d)/g, (_, n) => values[n - 1] ?? ''); };
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n, el.textContent);
  let prefs = {}, products = [], currentLabel = null, currentSource = 'manual-paste', busy = false, loadVersion = 0, prices = null;
  let barcodeEvidence = {};
  let sourceRequest = 0, unmatchedPhoto = null;
  const make = (tag, value) => { const el = document.createElement(tag); if (value != null) el.textContent = value; return el; };
  const settingsKeys = ['weights', 'goals', 'allergens', 'diets', 'avoidList', 'ratingStyle', 'personalCareEnabled', 'foodOnly', 'ocrLabels', 'useOpenFoodFacts', 'sheetIndexRev', 'producerIndexRev', 'theme', 'palette', 'accent'];
  const score = (input, preview = false) => {
    const options = AIR.db.prefs.sanitizeScoring(prefs), goal = preview && $('previewGoal').value;
    if (goal && AIR.db.categories.PRESETS[goal]) options.weights = AIR.db.categories.presetWeightMap(goal);
    return AIR.engine.score(input, options);
  };
  async function load() {
    const turn = ++loadVersion;
    const nextPrefs = await chrome.storage.local.get(settingsKeys);
    if (turn !== loadVersion) return;
    prefs = nextPrefs; AIR.db.theme.use(prefs); AIR.db.theme.page(document);
    // The checked label lives in a closed shadow root, so update its scheme too.
    AIR.db.theme.force(AIR.panel.shadowOf($('checkResult').firstElementChild));
    const saved = await S.list(chrome.storage.local), keys = await AIR.db.scoreCache.storedKeys(chrome.storage.local);
    const cached = await chrome.storage.local.get(keys.filter(k => k.startsWith('s:')));
    const listed = AIR.db.scoreCache.listScores(cached, { version: chrome.runtime.getManifest().version, prefs: nextPrefs }).slice(0, 200);
    const readings = await chrome.storage.local.get(listed.map(p => AIR.db.productCache.localKey(p.store, p.asin)));
    const session = await chrome.storage.session.get('sortedResults');
    if (turn !== loadVersion) return;
    const search = session.sortedResults, sourceURL = AIR.db.sortedResults.sanitizeSourceUrl(search?.sourceUrl);
    prices = sourceURL && AIR.db.sortedResults.scopeFor(sourceURL)?.kind === 'amazon' ? { items: AIR.db.sortedResults.sanitizeResults(search.items), store: new URL(sourceURL).hostname.replace(/^www\./, ''), currency: AIR.db.storefronts.storefront(sourceURL).currency, unit: AIR.db.unitPrice.isUnitId(search.unit) ? search.unit : '100g' } : null;
    const recent = listed.flatMap(p => {
      const row = AIR.db.productCache.sanitizeLocal(readings[AIR.db.productCache.localKey(p.store, p.asin)]);
      const reading = row?.status === 'ok' ? row : null;
      const input = S.cleanInput(reading ? AIR.db.productCache.toInput(reading) : cached[p.key]?.input);
      return input ? [{ id: 'cached:' + p.key, name: p.name || input.name, input, source: reading ? reading.data.via : p.source, capturedAt: reading ? Date.parse(reading.scanned_at) : p.t, cached: true, store: p.store, asin: p.asin, sourceRecordDate: reading ? reading.data.sourceRecordDate : p.evidence?.sourceRecordDate }] : [];
    });
    products = [...saved, ...recent];
    $('exportShortlist').disabled = !saved.length;
    const filter = $('listFilter'), selectedList = filter.value; filter.replaceChildren(new Option(t('allLists', 'All lists'), ''));
    for (const name of [...new Set(saved.map(p => p.list))].sort()) filter.append(new Option(name, name));
    if ([...filter.options].some(o => o.value === selectedList)) filter.value = selectedList;
    renderSaved();
    const params = new URLSearchParams(location.search);
    for (const [id, param, fallback] of [['productA', 'a', 0], ['productB', 'b', 1]]) {
      const select = $(id), previous = select.value || (params.get(param) ? 'cached:' + params.get(param) : ''); select.replaceChildren();
      for (const p of products) select.append(new Option(`${p.cached ? t('recentLabel', 'Recent') : p.list}: ${p.name}`, p.id));
      select.value = products.some(p => p.id === previous) ? previous : products[fallback]?.id || products[0]?.id || '';
    }
    compare();
  }
  function renderSaved() {
    const root = $('savedProducts'); root.replaceChildren();
    for (const p of products.filter(p => !p.cached && (!$('listFilter').value || p.list === $('listFilter').value))) {
      const row = make('article'); row.className = 'saved-row'; const body = make('div'), result = score(p.input), ev = S.evidence(result, p);
      body.append(make('strong', p.name), make('p', `${AIR.engine.isReadable(result) ? result.score + '/100' : t('labelUnavailable', 'Label unavailable')} · ${p.list}`), make('p', S.describe(ev, t)));
      if (p.url) { const link = make('a', t('openFreshLabel', 'Open product to check freshness')); link.href = p.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link); }
      const compareButton = make('button', t('compareDetails', 'Compare products')); compareButton.type = 'button'; compareButton.addEventListener('click', () => { $('productA').value = p.id; compare(); $('compareHeading').scrollIntoView({ behavior: 'smooth' }); });
      const remove = make('button', t('removeSaved', 'Remove')); remove.type = 'button'; remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const response = await chrome.runtime.sendMessage({ type: 'shortlistRemove', id: p.id });
          if (!response?.ok) throw new Error('remove-failed');
          await load();
        } catch { $('savedStatus').textContent = t('removeFailed', 'Could not remove this product — try again'); remove.disabled = false; }
      });
      row.append(body, compareButton, remove); root.append(row);
    }
    if (!root.children.length) root.append(make('p', t('noSavedProducts', 'Save products from their score panels or check a label here.')));
  }
  function compare() {
    const selected = [$('productA').value, $('productB').value].map(id => products.find(p => p.id === id));
    const root = $('comparison'); root.replaceChildren(); $('comparisonSummary').textContent = '';
    if (selected.some(p => !p) || selected[0].id === selected[1].id) { $('comparisonSummary').textContent = t('popupCompareEmpty', 'Score two products, then compare them here.'); return; }
    const results = selected.map(p => score(p.input, true)), usable = results.map(r => AIR.engine.isReadable(r));
    const compatible = (results[0].category || 'food') === (results[1].category || 'food') && (results[0].ratingStyle || 'food') === (results[1].ratingStyle || 'food');
    $('comparisonSummary').textContent = !compatible ? t('compareMixed', 'Different categories or rating styles: these scores are not directly comparable.') : usable.every(Boolean) ? t('compareDifference', 'Score difference: $1 points. See the label tradeoffs below.', Math.abs(results[0].score - results[1].score)) : t('comparePartial', 'One or both labels cannot be fully assessed.');
    const table = make('table'), head = make('tr'); head.append(make('th', t('compareFactor', 'Factor')));
    for (const p of selected) { const th = make('th', p.name); th.scope = 'col'; head.append(th); } const thead = make('thead'); thead.append(head); table.append(thead); const body = make('tbody'); table.append(body);
    const add = (label, values) => { const row = make('tr'), th = make('th', label); th.scope = 'row'; row.append(th, ...values.map(value => make('td', value))); body.append(row); };
    const unavailable = t('labelUnavailable', 'Unavailable');
    add(t('ingredientScore', 'Ingredient score'), results.map((r, i) => usable[i] ? `${r.score}/100` : unavailable));
    add(t('evidenceHeading', 'Label evidence'), results.map((r, i) => S.describe(S.evidence(r, selected[i]), t)));
    add(t('warningMatches', 'Selected warning matches'), results.map(r => r.flags?.length ? r.flags.map(f => `${f.label}${f.evidence ? ' · ' + S.warningLabel(f.evidence, t) : ''}`).join('\n') : t('noWarningsConfirmed', 'No selected matches found; absence is not confirmed.')));
    add(t('unassessedFactors', 'Not assessed'), results.map(r => S.evidence(r).missing.join(', ') || '—'));
    for (const [dimension, key, label] of [['processing', 'compareProcessing', 'Processing base'], ['ingredients', 'compareIngredients', 'Ingredient contributions'], ['nutrition', 'compareNutrition', 'Nutrition contributions'], ['sourcing', 'compareSourcing', 'Sourcing contributions']]) add(t(key, label), results.map(r => r.dimensions?.[dimension] != null ? String(r.dimensions[dimension]) : unavailable));
    const priceRows = selected.map(p => {
      const identity = p.id.match(/^product:([^:]+):([^:]+)$/), store = p.store || identity?.[1], asin = p.asin || identity?.[2];
      return prices && prices.store === store ? prices.items.find(item => item.asin === asin) : null;
    });
    const money = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: prices.currency, maximumFractionDigits: 3 }).format(value);
    add(t('compareListingPrice', 'Search listing price'), priceRows.map(p => p?.listingPrice != null ? money(p.listingPrice) : unavailable));
    if (prices) {
      const unit = AIR.db.unitPrice.UNIT_CHOICES.find(u => u.id === prices.unit);
      add(t('compareUnitPrice', 'Search unit price'), priceRows.map(p => { const base = AIR.db.unitPrice.priceIn(p, AIR.db.unitPrice.familyOf(prices.unit)), amount = base != null ? AIR.db.unitPrice.perUnit(base, prices.unit) : null; return amount != null ? `${money(amount)} / ${unit?.short || prices.unit}` : unavailable; }));
    }
    const nutrients = selected.map(p => AIR.engine.normaliseNutrition(p.input.nutrition));
    for (const [field, key, label, unit] of [['protein', 'labelProtein', 'Protein (g)', 'g'], ['fibre', 'labelFibre', 'Fibre (g)', 'g'], ['sugar', 'labelSugar', 'Total sugar (g)', 'g'], ['addedSugar', 'labelAddedSugar', 'Added sugar (g)', 'g'], ['sodium', 'labelSodium', 'Sodium (mg)', 'mg']]) {
      if (nutrients.some(n => n.values[field] != null)) add(t(key, label), nutrients.map(n => n.values[field] != null ? `${Math.round(n.values[field] * 100) / 100} ${unit} ${n.basis}` : unavailable));
    }
    add(t('scoreContributors', 'Main score contributions'), results.map(r => [...(r.bad || []), ...(r.good || [])].filter(f => Number.isFinite(f.c) && f.c !== 0).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 4).map(f => `${f.c > 0 ? '+' : ''}${f.c} ${f.why}`).join('\n') || unavailable));
    root.append(table);
  }
  function checkedLabel() {
    const input = { name: $('labelName').value || t('savedLabel', 'Saved label'), ingredients_text: $('labelText').value, advisory_text: $('labelAdvisory').value }, nutrition = {};
    for (const field of ['protein', 'fibre', 'sugar', 'addedSugar', 'sodium']) if ($(field).value !== '') nutrition[field] = Number($(field).value);
    if (Object.keys(nutrition).length) { nutrition[$('labelBasis').value === '100ml' ? 'servingMl' : 'servingGrams'] = 100; input.nutrition = nutrition; }
    return input;
  }
  const photoNeedsList = () => t('photoNeedsList', 'No ingredient list was found. Replace the extracted text with the complete ingredient list. For another scan, use a clear, upright English label.');
  $('labelForm').addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    if (unmatchedPhoto !== null && $('labelText').value.trim() === unmatchedPhoto) {
      $('checkStatus').textContent = photoNeedsList();
      $('labelText').focus();
      return;
    }
    if (!$('photoReview').hidden && !$('photoConfirmed').checked) {
      $('checkStatus').textContent = t('photoConfirmNeeded', 'Check the ingredients and allergen statements against the package before scoring.');
      $('photoConfirmed').focus();
      return;
    }
    const input = checkedLabel(), result = score(input), readable = AIR.engine.isReadable(result);
    $('checkStatus').textContent = readable ? '' : t('incompleteLabel', 'This label cannot be assessed. Check the extracted text and include the complete ingredient list.');
    $('checkResult').replaceChildren(); $('saveLabelControls').hidden = !readable;
    if (!readable) { currentLabel = null; return; }
    currentLabel = { id: 'label:' + crypto.randomUUID(), name: input.name, input, source: currentSource, capturedAt: Date.now(), savedScore: result.score, ...barcodeEvidence };
    const host = make('div'); $('checkResult').append(host); AIR.panel.mount(host, AIR.panel.render(result, { title: input.name, via: currentSource, confidence: 1, nutrition: input.nutrition, capturedAt: currentLabel.capturedAt, sourceRecordDate: currentLabel.sourceRecordDate, report: false }));
  });
  $('labelForm').addEventListener('input', event => {
    if (event.target.id === 'labelPhoto') return;
    if (['labelText', 'labelAdvisory'].includes(event.target.id)) {
      sourceRequest++;
      $('photoConfirmed').checked = false;
    }
    if (event.target.id === 'labelText' && currentSource !== 'label-ocr') {
      currentSource = 'manual-paste';
      barcodeEvidence = {};
    }
    currentLabel = null; $('saveLabelControls').hidden = true; $('checkResult').replaceChildren();
  });
  $('saveLabel').addEventListener('click', async () => {
    if (!currentLabel) return; const button = $('saveLabel'); button.disabled = true;
    try { await S.save([{ ...currentLabel, list: $('shortlistName').value }]); $('checkStatus').textContent = t('savedProduct', 'Saved'); await load(); }
    catch (error) { $('checkStatus').textContent = S.saveError(error, t); } finally { button.disabled = false; }
  });
  $('saveComparison').addEventListener('click', async () => {
    $('saveComparison').disabled = true;
    try {
      const rows = [];
      for (const id of new Set([$('productA').value, $('productB').value])) {
        const p = products.find(row => row.id === id); if (!p?.cached) continue;
        const url = AIR.stores.storeForHost(p.store)?.id === 'amazon' ? `https://www.${p.store}/dp/${p.asin}` : '';
        rows.push({ ...p, id: `product:${p.store}:${p.asin}`, url, savedScore: score(p.input).score });
      }
      if (rows.length) await S.save(rows);
      $('savedStatus').textContent = t('savedProduct', 'Saved'); await load();
    } catch (error) { $('savedStatus').textContent = S.saveError(error, t); } finally { $('saveComparison').disabled = false; }
  });
  async function readPhotoFile(file) {
    if (!file || busy) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { $('checkStatus').textContent = t('photoLimit', 'Choose a PNG, JPEG or WebP photo smaller than 8 MB.'); return; }
    const request = ++sourceRequest;
    busy = true; currentLabel = null; $('saveLabelControls').hidden = true; $('checkResult').replaceChildren();
    $('labelPhoto').disabled = true; $('checkStatus').textContent = t('photoReading', 'Reading photo locally…'); let frame, timer;
    try {
      const image = await createImageBitmap(file); const pixels = image.width * image.height; image.close(); if (pixels > 20000000) throw new Error('image-size');
      frame = document.createElement('iframe'); frame.hidden = true; frame.src = chrome.runtime.getURL('src/offscreen/ocr.html');
      const ready = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; }); document.body.append(frame);
      const operation = async () => {
        await ready;
        const host = frame.contentWindow, worker = await host.getWorker();
        const image = new host.Blob([await file.arrayBuffer()], { type: file.type });
        return host.recognizeLabel(worker, image);
      };
      const extracted = await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 45000); })]);
      if (request !== sourceRequest) return;
      const OCR = AIR.db.ocrText;
      const label = OCR.labelFromOcr(extracted.text);
      const text = label?.text ?? extracted.text.slice(0, 6000).trim();
      if (!text) throw new Error('empty-photo');
      const unclear = label ? OCR.uncertainWords(`${text} ${label.advisory}`, extracted.words) : [];
      $('labelText').value = text;
      $('labelAdvisory').value = label?.advisory || '';
      if (label?.advisory) $('labelAdvisory').closest('details').open = true;
      unmatchedPhoto = label ? null : text;
      $('photoConfirmed').checked = false;
      $('photoReview').hidden = !!label && !unclear.length;
      for (const field of ['protein', 'fibre', 'sugar', 'addedSugar', 'sodium']) $(field).value = '';
      currentSource = 'label-ocr';
      barcodeEvidence = {};
      $('checkStatus').textContent = !label ? photoNeedsList() : unclear.length
        ? t('photoWords', 'Check these uncertain words against the package: $1.', unclear.map(item => item.word).join(', '))
        : t('reviewPhoto', 'Review the extracted text, then check the label.');
      $('labelText').focus();
    } catch {
      if (request === sourceRequest) $('checkStatus').textContent = t('photoFailed', 'Could not read this photo. Try a clearer, smaller image or paste the ingredients.');
    }
    finally {
      clearTimeout(timer);
      try { frame?.contentWindow?.resetWorker?.(); } catch { /* frame already gone */ }
      frame?.remove(); busy = false; $('labelPhoto').disabled = false; $('labelPhoto').value = '';
    }
  }
  $('labelPhoto').addEventListener('change', () => void readPhotoFile($('labelPhoto').files[0]));
  const dropzone = $('photoDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', e => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('is-dragover'); });
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('is-dragover');
      const file = [...(e.dataTransfer?.files || [])].find(f => /^image\/(?:png|jpeg|webp)$/.test(f.type));
      if (file) void readPhotoFile(file);
      else if (e.dataTransfer?.files?.length) $('checkStatus').textContent = t('photoLimit', 'Choose a PNG, JPEG or WebP photo smaller than 8 MB.');
    });
  }
  document.addEventListener('paste', e => {
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(i => i.kind === 'file' && /^image\/(?:png|jpeg|webp)$/.test(i.type));
    if (!img) return;
    e.preventDefault();
    const file = img.getAsFile();
    if (file) void readPhotoFile(file);
  });
  $('lookupBarcode').addEventListener('click', async () => {
    const code = $('barcode').value.trim(); if (!/^\d{8,14}$/.test(code)) { $('checkStatus').textContent = t('barcodeInvalid', 'Enter an 8–14 digit barcode.'); return; }
    const request = ++sourceRequest;
    $('lookupBarcode').disabled = true;
    try {
      const origins = { origins: ['https://world.openfoodfacts.org/*'] };
      if (!await chrome.permissions.request(origins)) throw new Error('permission');
      const found = await chrome.runtime.sendMessage({ type: 'lookupBarcode', code, foodOnly: true });
      if (request !== sourceRequest) return;
      if (!found?.ingredients_text || found.ingredients_text.length > 6000 || found.rejected) throw new Error('unavailable');
      $('labelName').value = found.name || ''; $('labelText').value = found.ingredients_text; $('labelAdvisory').value = ''; currentSource = AIR.db.productCache.barcodeVia(found); currentLabel = null; $('saveLabelControls').hidden = true; $('checkResult').replaceChildren();
      barcodeEvidence = currentSource === 'usda-fdc' ? { capturedAt: found.capturedAt ?? Date.now(), sourceRecordDate: found.sourceRecordDate } : {};
      unmatchedPhoto = null;
      $('photoReview').hidden = true;
      for (const field of ['protein', 'fibre', 'sugar', 'addedSugar', 'sodium']) $(field).value = '';
      const nutrition = AIR.engine.normaliseNutrition(found.nutrition);
      if (['per 100g', 'per 100ml'].includes(nutrition.basis)) { $('labelBasis').value = nutrition.basis.replace('per ', ''); for (const field of ['protein', 'fibre', 'sugar', 'addedSugar', 'sodium']) if (nutrition.values[field] != null) $(field).value = nutrition.values[field]; }
      $('checkStatus').textContent = t('reviewBarcode', 'Database match loaded. Check it against the package, then check the label.');
    } catch {
      if (request === sourceRequest) $('checkStatus').textContent = t('barcodeFailed', 'Barcode lookup unavailable. Check access and try again, or paste the label.');
    } finally { $('lookupBarcode').disabled = false; }
  });
  for (const id of ['productA', 'productB', 'previewGoal']) $(id).addEventListener('change', compare);
  $('listFilter').addEventListener('change', renderSaved);
  $('exportShortlist').addEventListener('click', async () => {
    try {
      const rows = await S.list(chrome.storage.local);
      const payload = { format: 'ingredient-check-shortlist', version: 1, products: rows };
      const file = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = make('a'); link.href = file; link.download = 'ingredient-check-shortlist.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(file), 10000);
    } catch { $('savedStatus').textContent = t('shortlistExportFailed', 'Could not export saved products — try again'); }
  });
  for (const [id, goal] of Object.entries(AIR.db.categories.PRESETS)) $('previewGoal').append(new Option(goal.label || goal.name || id, id));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && Object.keys(changes).some(k => settingsKeys.includes(k) || k.startsWith(S.PREFIX))) void load().catch(() => { $('savedStatus').textContent = t('saveFailed', 'Could not save — try again'); }); });
  void load().catch(() => { $('savedStatus').textContent = t('saveFailed', 'Could not save — try again'); });
})();
