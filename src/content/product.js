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
    state.lastTextSig = (meta && meta.textSig != null) ? meta.textSig : (ingredientSig() || data.text || '');
    state.failedExtracts = 0;
    // Do not settle('scored') — keep watching for late ingredient hydration.
    root.AIR.panel.mount(host, root.AIR.panel.render(result, {
      title: meta.title || data.title,
      confidence: meta.confidence,
      via: meta.via,
      provenanceSource: meta.provenanceSource,
    }), meta.report === false ? null : reporter(data, result));
    cacheScore(key, result, meta.cacheName || data.title, meta.via, meta.provenanceSource);
    if (meta.input && meta.via !== 'manual-paste' && meta.via !== 'food-override') {
      P().rememberProduct(key, { input: meta.input, via: meta.via, confidence: meta.confidence,
        food: !(data.ingestible && data.ingestible.ok === false) });
    }
    publishActionBadge(result);
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
      if (host.dataset.airState === 'fail') return;
      if (host.dataset.airState === 'loading' && !data.upc) return;
      cache(key, null);
      if (data.upc) {
        const conf = state.cacheOptions || {};
        if (conf.useOpenFoodFacts !== true) {
          showFailure(host, data, key);
          return;
        }
        const requestId = ++state.requestId;
        host.dataset.airState = 'loading';
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
