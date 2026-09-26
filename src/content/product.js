// Product-page scoring: panel mount, extract, OCR, barcode fallback, paste.
// Reads shared state from AIR.page. Lifecycle (observer, navigation) stays in main.js.

(function (root) {
  root.AIR = root.AIR || {};
  const P = () => root.AIR.page;

  function mountPoint() {
    return document.querySelector('#nutritionalInfoAndIngredients_feature_div')
      || document.querySelector('#important-information')
      || document.querySelector('#feature-bullets')
      || document.querySelector('#centerCol')
      || document.querySelector('#dp-container');
  }

  function quickNonFood() {
    const state = P().state;
    if (!state.foodOnly) return null;
    const gate = root.AIR.db.ingestible;
    if (!gate || typeof gate.assessTitle !== 'function') return null;
    const el = document.querySelector('#productTitle');
    const title = el && (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    const verdict = gate.assessTitle(title);
    if (verdict.ok || !verdict.negatives.length) return null;
    return { title, verdict };
  }

  function showNotFood(data, key) {
    const { state, HOST_ID, publishActionBadge } = P();
    const anchor = mountPoint();
    if (!anchor) { state.lastKey = key; return; }
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      anchor.parentNode.insertBefore(host, anchor);
    }
    state.lastKey = key;
    host.dataset.airState = 'not-food';
    publishActionBadge({ status: 'not-food' });
    const shadow = root.AIR.panel.mount(host, root.AIR.panel.renderNotFood(data));
    wireScoreAnyway(shadow, host, data, key);
    P().settle('not-food');
  }

  function presentResult(host, data, key, result, meta) {
    const { state, unreadable, cacheScore, publishActionBadge, sendDiagnostic, ingredientSig } = P();
    if (unreadable(result) && meta && meta.checkCoverage !== false) {
      showFailure(host, { ...data, lowCoverage: true, ocrAttempted: !!meta.ocrAttempted }, key);
      return false;
    }
    host.dataset.airState = 'scored';
    delete host.dataset.airCheck;
    // The page's own ingredient text as it stands now, so the next tick compares page to page. A
    // score from a label photo, a barcode or a saved reading used to record ITS text here; the page
    // (a blurb, or nothing) never matched it, so every Amazon update re-read the page and replaced
    // the score with the failure card.
    state.lastTextSig = ingredientSig() || ((meta && meta.textSig != null) ? meta.textSig : (data.text || ''));
    state.failedExtracts = 0;
    // Do not settle('scored') — keep watching for late ingredient hydration.
    root.AIR.panel.mount(host, root.AIR.panel.render(result, {
      title: meta.title || data.title,
      confidence: meta.confidence,
      via: meta.via,
      provenanceSource: meta.provenanceSource,
    }), meta.report === false ? null : reporter(data, result));
    cacheScore(key, result, meta.cacheName || data.title, meta.via, meta.provenanceSource, meta.t);
    if (meta.input && meta.via !== 'manual-paste' && meta.via !== 'food-override') {
      P().rememberProduct(key, { input: meta.input, via: meta.via, confidence: meta.confidence,
        food: !(data.ingestible && data.ingestible.ok === false) });
    }
    publishActionBadge(result);
    P().logAction?.('product page', `${key}: ${result.score} ${result.verdict} (read from ${meta.via || 'page'})`);
    if (meta.sendDiag !== false) {
      sendDiagnostic(data, result, meta.via, meta.text || data.text);
    }
    return true;
  }

  function scoreCurrentPage() {
    const { state, HOST_ID, MAX_EXTRACT_RETRIES, cache, ingredientSig } = P();
    const urlAsin = (location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/) || [])[1];
    const earlyKey = urlAsin || location.pathname;
    const existing = document.getElementById(HOST_ID);
    const existingState = existing && existing.dataset.airState;
    const sig = ingredientSig();

    // Scored + unchanged ingredient text → idle. Changed text → rescore.
    if (earlyKey === state.lastKey && existingState === 'scored') {
      if (sig && sig === state.lastTextSig) return;
      if (!sig && state.lastTextSig) return;
    }
    // Loading: fall through so a now-readable DOM list can cancel OFF/OCR.

    if (state.manual && state.manual.key === earlyKey) {
      const anchor = mountPoint();
      if (!anchor) return;
      let host = existing;
      if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        anchor.parentNode.insertBefore(host, anchor);
      }
      state.lastKey = earlyKey;
      renderManual(host, state.manual.data, earlyKey, state.manual.text);
      return;
    }

    if (earlyKey === state.lastKey && existingState === 'not-food') { P().settle('not-food'); return; }

    const quick = quickNonFood();
    if (quick) {
      showNotFood({ asin: urlAsin, title: quick.title, ingestible: quick.verdict }, earlyKey);
      return;
    }

    if (earlyKey !== state.lastKey) {
      state.failedExtracts = 0;
      state.lastFailSig = null;
    }
    if (existingState === 'fail' && state.failedExtracts >= MAX_EXTRACT_RETRIES) {
      if (sig && sig === state.lastFailSig) return;
      state.failedExtracts = 0;
    }

    const data = root.AIR.extract.extract(document, { asin: urlAsin, foodOnly: state.foodOnly });
    if (!data.ok) {
      state.failedExtracts++;
      state.lastFailSig = sig;
    }
    if (state.foodOnly && data.ingestible && !data.ingestible.ok) {
      const key = data.asin || earlyKey;
      if (existingState === 'not-food' && key === state.lastKey) { P().settle('not-food'); return; }
      showNotFood(data, key);
      return;
    }
    const key = data.asin || earlyKey;
    if (key === state.lastKey && existingState === 'scored' && data.ok
        && data.text && data.text.slice(0, 320) === state.lastTextSig) return;

    const anchor = mountPoint();
    if (!anchor) return;

    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      anchor.parentNode.insertBefore(host, anchor);
    }
    state.lastKey = key;

    if (!data.ok) {
      // A failed re-read never replaces a score: it came from a label photo, a barcode, a saved
      // reading, or text that has since gone. A new product gets a new panel via navigation.
      if (host.dataset.airState === 'fail' || host.dataset.airState === 'scored') return;
      // A cache check in flight holds 'loading' too; a barcode must not start Open Food Facts under it.
      // Nor may the same barcode start it twice: this panel already asked (airBarcode), whether the
      // answer is still coming or the label photo is being read after it. Each Amazon page update used
      // to send a second lookup for one page view, and drop the first answer.
      if (host.dataset.airState === 'loading'
          && (!data.upc || host.dataset.airCheck || host.dataset.airBarcode === String(data.upc))) return;
      cache(key, null);
      // Someone may already have read this product — on this computer, or on another one through
      // the shared cache (a label photo read by OCR, a barcode match). Ask before spending a network
      // lookup or seconds of OCR on it. Once per panel: a new panel (navigation, a weight change)
      // asks again, and a local hit then answers instantly.
      if (!host.dataset.airCacheTried && /^[A-Z0-9]{10}$/.test(key)) {
        host.dataset.airCacheTried = '1';
        fromCache(host, data, key, () => unreadablePage(host, data, key));
        return;
      }
      unreadablePage(host, data, key);
      return;
    }

    // DOM list available while OFF/OCR loading — cancel the in-flight path.
    if (existingState === 'loading') state.requestId++;

    const requestId = ++state.requestId;
    const input = {
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: data.text,
    };
    const result = root.AIR.engine.score(input, state.prefs);
    if (!presentResult(host, data, key, result, {
      input,   // sanitize() keeps only known nutrition fields, so the engine's _normalised mark stays out
      title: data.title, confidence: data.confidence, via: data.via,
      text: data.text, textSig: (data.text || '').slice(0, 320),
    })) return;

    if (result.provenance) enrichProvenance(host, data, key, result, requestId);
  }

  // The page published no readable ingredients: Open Food Facts when a barcode and the toggle allow
  // it, otherwise the failure card (which tries the label photo when that is on).
  function unreadablePage(host, data, key) {
    const { state } = P();
    if (data.upc) {
      const conf = state.cacheOptions || {};
      if (conf.useOpenFoodFacts !== true) {
        showFailure(host, data, key);
        return;
      }
      const requestId = ++state.requestId;
      host.dataset.airState = 'loading';
      host.dataset.airBarcode = String(data.upc);
      root.AIR.panel.mount(host, root.AIR.panel.renderLoading(data));
      chrome.runtime.sendMessage({ type: 'lookupBarcode', code: data.upc, foodOnly: state.foodOnly }, fallback => {
        const messageError = chrome.runtime.lastError;
        if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
        if (fallback && fallback.rejected === 'not-food') {
          host.dataset.airState = 'not-food';
          P().publishActionBadge({ status: 'not-food' });
          const shadow = root.AIR.panel.mount(host, root.AIR.panel.renderNotFood({
            ...data,
            ingestible: { ok: false, reason: fallback.reason || 'Open Food Facts lists this as a non-food product' },
          }));
          wireScoreAnyway(shadow, host, data, key);
          return;
        }
        if (messageError || !fallback || !fallback.ingredients_text) {
          showFailure(host, { ...data, lookupAttempted: true }, key);
          return;
        }
        const input = {
          name: fallback.name || data.title,
          labels: `${data.labels || ''} ${fallback.labels || ''}`,
          ingredients_text: fallback.ingredients_text,
        };
        const result = root.AIR.engine.score(input, state.prefs);
        presentResult(host, data, key, result, {
          input,
          title: data.title || fallback.name,
          confidence: 0.55,
          via: 'open-food-facts',
          text: fallback.ingredients_text,
          cacheName: data.title || fallback.name,
          textSig: fallback.ingredients_text.slice(0, 320),
        });
      });
      return;
    }
    showFailure(host, data, key);
  }

  // A saved reading of this product, from this computer (p:) or the shared products tab. Only an
  // 'ok' row with text helps here — an 'unreadable' row says what this page already said.
  function fromCache(host, data, key, next) {
    const { state, storeHost, rememberProduct, freshLocal, sharedOk, sharedProductsOn, speed } = P();
    const C = root.AIR.db.productCache;
    const requestId = ++state.requestId;
    const live = () => requestId === state.requestId && state.lastKey === key && host.isConnected;
    const done = () => { delete host.dataset.airCheck; host.dataset.airState = ''; };
    host.dataset.airState = 'loading';
    host.dataset.airCheck = '1';
    root.AIR.panel.mount(host, root.AIR.panel.renderLoading({ ...data, cache: true }));
    const use = (row, shared) => {
      done();
      const result = root.AIR.engine.score(C.toInput(row), state.prefs);
      if (!presentResult(host, data, key, result, {
        title: data.title || row.data.title, confidence: row.data.confidence, via: row.data.via,
        text: row.data.text, textSig: row.data.text.slice(0, 320), t: Date.parse(row.scanned_at),
      })) return;
      refreshAfterSaved(host, data, key, result, row.data.text);
      if (!shared) return;
      rememberProduct(key, row, { share: false });
      try {
        chrome.runtime.sendMessage({ type: 'productsQueue', pulls: [{ key: row.key, scanned_at: row.scanned_at }] },
          () => void chrome.runtime.lastError);
      } catch (e) { /* context invalidated */ }
    };
    const miss = () => { done(); next(); };
    const localKey = C.localKey(storeHost(), key);
    chrome.storage.local.get(localKey, obj => {
      if (!live()) return;
      const local = C.sanitize(obj && obj[localKey]);
      if (local && local.status === 'ok' && freshLocal(local)) { use(local, false); return; }
      if (!speed().sharedDays || !sharedProductsOn()) { miss(); return; }
      try {
        chrome.runtime.sendMessage({ type: 'productsLookup', store: storeHost(), asins: [key] }, reply => {
          void chrome.runtime.lastError;
          if (!live()) return;
          const row = C.sanitize(reply && reply.rows && reply.rows[key]);
          if (row && row.status === 'ok' && sharedOk(row)) use(row, true); else miss();
        });
      } catch (e) { miss(); }
    });
  }

  // A saved reading answered first, because it is instant. Opening the product page still reads it
  // again: the barcode lookup and the label photo run now when those settings are on, and their
  // reading replaces the saved one only when it differs (another score or other ingredient text).
  // A re-read that fails, or finds nothing, leaves the saved score in place. When the page itself
  // has readable ingredients this is never reached: scoreCurrentPage scores the live page directly.
  function refreshAfterSaved(host, data, key, shown, shownText) {
    const { state } = P();
    const conf = state.cacheOptions || {};
    const byBarcode = !!data.upc && conf.useOpenFoodFacts === true;
    const byPhoto = state.ocrLabels === true
      && (!root.AIR.extract.ocrReadyForHost || root.AIR.extract.ocrReadyForHost(location.hostname));
    if (!byBarcode && !byPhoto) return;
    const requestId = state.requestId;
    const live = () => requestId === state.requestId && state.lastKey === key && host.isConnected
      && host.dataset.airState === 'scored';
    const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const offer = (input, meta) => {
      if (!live()) return false;
      const result = root.AIR.engine.score(input, state.prefs);
      if (P().unreadable(result)) return false;
      if (result.score === shown.score && norm(input.ingredients_text) === norm(shownText)) return true;
      presentResult(host, data, key, result, { input, sendDiag: false, ...meta });
      return true;
    };
    const photo = () => {
      if (!byPhoto || !live()) return;
      const urls = (root.AIR.db.ocrText && root.AIR.db.ocrText.imageCandidates(document)) || [];
      if (!urls.length) return;
      try {
        chrome.runtime.sendMessage({ type: 'ocrLabels', urls }, res => {
          void chrome.runtime.lastError;
          const best = res && res.ok && root.AIR.db.ocrText.bestBlock(res.results,
            t => root.AIR.extract.looksLikeIngredients(t, data.title));
          if (!best) return;
          offer({ name: data.title, labels: data.labels, certifications: data.certifications, ingredients_text: best.text },
            { title: data.title, confidence: 0.7, via: 'label-ocr', text: best.text, textSig: best.text.slice(0, 320), ocrAttempted: true });
        });
      } catch (e) { /* messaging unavailable */ }
    };
    if (!byBarcode) { photo(); return; }
    try {
      chrome.runtime.sendMessage({ type: 'lookupBarcode', code: data.upc, foodOnly: state.foodOnly }, fallback => {
        void chrome.runtime.lastError;
        const text = fallback && fallback.ingredients_text;
        const used = text && offer({ name: fallback.name || data.title, labels: `${data.labels || ''} ${fallback.labels || ''}`, ingredients_text: text },
          { title: data.title || fallback.name, confidence: 0.55, via: 'open-food-facts', text, textSig: text.slice(0, 320), cacheName: data.title || fallback.name });
        if (!used) photo();
      });
    } catch (e) { photo(); }
  }

  function enrichProvenance(host, data, key, first, requestId) {
    const { state } = P();
    if ((state.cacheOptions || {}).sharedCache === false) { maybeContribute(data, first); return; }
    try {
      chrome.runtime.sendMessage({
        type: 'provenanceLookup',
        key: { asin: data.asin, upc: data.upc, brand: data.brand },
      }, record => {
        const err = chrome.runtime.lastError;
        if (requestId !== state.requestId || !host.isConnected || !state.enabled) return;
        if (err || !record) { maybeContribute(data, first); return; }
        const better = root.AIR.engine.score({
          name: data.title, labels: data.labels, certifications: data.certifications,
          nutrition: data.nutrition, ingredients_text: data.text, provenanceRecord: record,
        }, state.prefs);
        presentResult(host, data, key, better, {
          title: data.title, confidence: data.confidence, via: data.via,
          provenanceSource: record.source || 'shared database',
          text: data.text, textSig: (data.text || '').slice(0, 320),
          sendDiag: false, report: false, checkCoverage: false,
        });
      });
    } catch (e) { /* messaging unavailable in some frames */ }
  }

  function maybeContribute(data, result) {
    if (!result.provenance || !result.provenance.verified.length) return;
    try {
      chrome.runtime.sendMessage({ type: 'contribute', payload: {
        asin: data.asin || '', upc: data.upc || '', brand: data.brand || '',
        product_name: data.title || '', kind: result.provenance.kind,
        certifications: result.provenance.verified.map(v => v.label).join(', '),
        verified_by: 'amazon certification widget',
      } }, () => void chrome.runtime.lastError);
    } catch (e) { /* ignore */ }
  }

  function reporter(data, result) {
    return done => {
      try {
        chrome.runtime.sendMessage({ type: 'report', payload: {
          asin: data.asin || '', upc: data.upc || '', brand: data.brand || '',
          product_name: data.title || '',
          notes: `scored ${result.score} (${result.verdict}); NOVA ${result.nova}; ` +
                 `read via ${data.via || 'unknown'}; ` +
                 `hits: ${result.bad.slice(0, 6).map(b => b.why).join('; ')}`,
          certifications: '', verified_by: 'user report',
        } }, res => { void chrome.runtime.lastError; done(!!(res && res.ok)); });
      } catch (e) { done(false); }
    };
  }

  function tryOcr(host, data, key) {
    const { state } = P();
    if (root.AIR.extract.ocrReadyForHost && !root.AIR.extract.ocrReadyForHost(location.hostname)) {
      showFailure(host, { ...data, ocrAttempted: true, localeDeclined: true }, key);
      return;
    }
    const urls = (root.AIR.db.ocrText && root.AIR.db.ocrText.imageCandidates(document)) || [];
    if (!urls.length) { showFailure(host, { ...data, ocrAttempted: true }, key); return; }
    const requestId = ++state.requestId;
    host.dataset.airState = 'loading';
    root.AIR.panel.mount(host, root.AIR.panel.renderLoading({ ...data, ocr: true }));
    const started = Date.now();
    const giveUp = extra => {
      host.dataset.airState = '';
      showFailure(host, { ...data, ocrAttempted: true, ...extra }, key);
    };
    const stillReading = setTimeout(() => {
      if (requestId !== state.requestId || !host.isConnected || host.dataset.airState !== 'loading') return;
      root.AIR.panel.mount(host, root.AIR.panel.renderLoading({ ...data, ocr: true, slow: true }));
    }, 8000);
    try {
      chrome.runtime.sendMessage({ type: 'ocrLabels', urls }, res => {
        clearTimeout(stillReading);
        void chrome.runtime.lastError;
        if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
        const best = res && res.ok && root.AIR.db.ocrText.bestBlock(res.results,
          t => root.AIR.extract.looksLikeIngredients(t, data.title));
        if (!best) { giveUp({}); return; }
        const input = {
          name: data.title, labels: data.labels, certifications: data.certifications,
          ingredients_text: best.text,
        };
        const result = root.AIR.engine.score(input, state.prefs);
        presentResult(host, data, key, result, {
          input,
          title: data.title, confidence: 0.7, via: 'label-ocr',
          text: best.text, textSig: best.text.slice(0, 320),
          ocrAttempted: true,
        });
        void started;
      });
    } catch (e) { clearTimeout(stillReading); giveUp({}); }
  }

  function showFailure(host, data, key) {
    const { state, publishActionBadge } = P();
    if (state.lastKey !== key || !host.isConnected) return;
    if (host.dataset.airState === 'fail') return;
    if (state.ocrLabels && !data.ocrAttempted) {
      if (root.AIR.extract.ocrReadyForHost && !root.AIR.extract.ocrReadyForHost(location.hostname)) {
        data = { ...data, ocrAttempted: true, localeDeclined: true };
      } else {
        tryOcr(host, data, key);
        return;
      }
    }
    host.dataset.airState = 'fail';
    publishActionBadge({ status: 'fail' });
    root.AIR.panel.mount(host, root.AIR.panel.renderFailure(data), null, text => {
      state.manual = { key, data, text };
      renderManual(host, data, key, text);
    });
  }

  function renderManual(host, data, key, text) {
    const { state } = P();
    const result = root.AIR.engine.score({
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: text,
    }, state.prefs);
    if (!presentResult(host, data, key, result, {
      title: data.title, confidence: 1, via: 'manual-paste',
      text, textSig: text.slice(0, 320), ocrAttempted: true,
    })) {
      state.manual = null;
    }
  }

  function wireScoreAnyway(shadow, host, data, key) {
    const btn = shadow && shadow.querySelector('button.anyway');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const { state } = P();
      const data2 = root.AIR.extract.extract(document, { asin: data.asin, foodOnly: false });
      if (!data2.ok) { showFailure(host, data2, key); return; }
      const result = root.AIR.engine.score({
        name: data2.title, labels: data2.labels, certifications: data2.certifications,
        nutrition: data2.nutrition, ingredients_text: data2.text,
      }, state.prefs);
      presentResult(host, data2, key, result, {
        title: data2.title, confidence: data2.confidence, via: 'food-override',
        text: data2.text, textSig: (data2.text || '').slice(0, 320),
        cacheName: data2.title,
      });
    });
  }

  const product = { mountPoint, scoreCurrentPage, showFailure, showNotFood, tryOcr, renderManual, presentResult };
  root.AIR.product = product;
  if (typeof module !== 'undefined' && module.exports) module.exports = product;
})(typeof globalThis !== 'undefined' ? globalThis : self);
