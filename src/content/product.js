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
    publishActionBadge(null);
    const shadow = root.AIR.panel.mount(host, root.AIR.panel.renderNotFood(data));
    wireScoreAnyway(shadow, host, data, key);
    P().settle('not-food');
  }

  function scoreCurrentPage() {
    const { state, HOST_ID, MAX_EXTRACT_RETRIES, unreadable, cacheScore, cache,
      publishActionBadge, sendDiagnostic } = P();
    const urlAsin = (location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/) || [])[1];
    const earlyKey = urlAsin || location.pathname;
    const existing = document.getElementById(HOST_ID);
    const existingState = existing && existing.dataset.airState;
    if (earlyKey === state.lastKey && (existingState === 'scored' || existingState === 'loading')) return;

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

    if (earlyKey !== state.lastKey) state.failedExtracts = 0;
    if (existingState === 'fail' && state.failedExtracts >= MAX_EXTRACT_RETRIES) return;

    const data = root.AIR.extract.extract(document, { asin: urlAsin, foodOnly: state.foodOnly });
    if (!data.ok) state.failedExtracts++;
    if (state.foodOnly && data.ingestible && !data.ingestible.ok) {
      const key = data.asin || earlyKey;
      if (existingState === 'not-food' && key === state.lastKey) { P().settle('not-food'); return; }
      showNotFood(data, key);
      return;
    }
    const key = data.asin || earlyKey;
    if (key === state.lastKey && existingState === 'scored') return;

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
      if (host.dataset.airState === 'fail' || host.dataset.airState === 'loading') return;
      cache(key, null);
      if (data.upc) {
        const requestId = ++state.requestId;
        chrome.storage.local.get('useOpenFoodFacts', options => {
          if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
          if (!options.useOpenFoodFacts) {
            showFailure(host, data, key);
            return;
          }
          host.dataset.airState = 'loading';
          root.AIR.panel.mount(host, root.AIR.panel.renderLoading(data));
          chrome.runtime.sendMessage({ type: 'lookupBarcode', code: data.upc, foodOnly: state.foodOnly }, fallback => {
            const messageError = chrome.runtime.lastError;
            if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
            if (fallback && fallback.rejected === 'not-food') {
              host.dataset.airState = 'not-food';
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
            const result = root.AIR.engine.score({
              name: fallback.name || data.title,
              labels: `${data.labels || ''} ${fallback.labels || ''}`,
              ingredients_text: fallback.ingredients_text,
            }, state.prefs);
            if (unreadable(result)) { showFailure(host, { ...data, lookupAttempted: true, lowCoverage: true }, key); return; }
            host.dataset.airState = 'scored';
            P().settle('scored');
            root.AIR.panel.mount(host, root.AIR.panel.render(result, {
              title: data.title || fallback.name,
              confidence: 0.55,
              via: 'open-food-facts',
            }));
            cacheScore(key, result, data.title || fallback.name, 'open-food-facts', fallback.ingredients_text);
            publishActionBadge(result);
            sendDiagnostic(data, result, 'open-food-facts', fallback.ingredients_text);
          });
        });
        return;
      }
      showFailure(host, data, key);
      return;
    }

    const requestId = ++state.requestId;
    const result = root.AIR.engine.score({
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: data.text,
    }, state.prefs);
    if (unreadable(result)) { showFailure(host, { ...data, lowCoverage: true }, key); return; }
    host.dataset.airState = 'scored';
    P().settle('scored');
    root.AIR.panel.mount(host, root.AIR.panel.render(result, {
      title: data.title, confidence: data.confidence, via: data.via,
    }), reporter(data, result));
    cacheScore(key, result, data.title, data.via, data.text);
    publishActionBadge(result);
    sendDiagnostic(data, result, data.via);

    if (result.provenance) enrichProvenance(host, data, key, result, requestId);
  }

  function enrichProvenance(host, data, key, first, requestId) {
    const { state, cacheScore, publishActionBadge } = P();
    // No shared-database URLs configured → skip the round-trip (storage reads + empty lookups).
    const conf = state.cacheOptions || {};
    if (!conf.sheetUrl && !conf.producersUrl) { maybeContribute(data, first); return; }
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
        host.dataset.airState = 'scored';
        P().settle('scored');
        root.AIR.panel.mount(host, root.AIR.panel.render(better, {
          title: data.title, confidence: data.confidence, via: data.via,
          provenanceSource: record.source,
        }));
        cacheScore(key, better, data.title, data.via, data.text, record.source || 'shared database');
        publishActionBadge(better);
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
    const { state, unreadable, cacheScore, publishActionBadge, sendDiagnostic } = P();
    if (root.AIR.extract.ocrReadyForHost && !root.AIR.extract.ocrReadyForHost(location.hostname)) {
      showFailure(host, { ...data, ocrAttempted: true, localeDeclined: true }, key);
      return;
    }
    const urls = (root.AIR.db.ocrText && root.AIR.db.ocrText.imageCandidates(document)) || [];
    if (!urls.length) { showFailure(host, { ...data, ocrAttempted: true }, key); return; }
    const requestId = ++state.requestId;
    host.dataset.airState = 'loading';
    root.AIR.panel.mount(host, root.AIR.panel.renderLoading({ ...data, ocr: true }));
    const giveUp = extra => {
      host.dataset.airState = '';
      showFailure(host, { ...data, ocrAttempted: true, ...extra }, key);
    };
    try {
      chrome.runtime.sendMessage({ type: 'ocrLabels', urls }, res => {
        void chrome.runtime.lastError;
        if (requestId !== state.requestId || state.lastKey !== key || !host.isConnected) return;
        const best = res && res.ok && root.AIR.db.ocrText.bestBlock(res.results,
          t => root.AIR.extract.looksLikeIngredients(t, data.title));
        if (!best) { giveUp({}); return; }
        const result = root.AIR.engine.score({
          name: data.title, labels: data.labels, certifications: data.certifications,
          ingredients_text: best.text,
        }, state.prefs);
        if (unreadable(result)) { giveUp({ lowCoverage: true }); return; }
        host.dataset.airState = 'scored';
        P().settle('scored');
        root.AIR.panel.mount(host, root.AIR.panel.render(result, {
          title: data.title, confidence: 0.7, via: 'label-ocr',
        }), reporter(data, result));
        cacheScore(key, result, data.title, 'label-ocr', best.text);
        publishActionBadge(result);
        sendDiagnostic(data, result, 'label-ocr', best.text);
      });
    } catch (e) { giveUp({}); }
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
    publishActionBadge(null);
    root.AIR.panel.mount(host, root.AIR.panel.renderFailure(data), null, text => {
      state.manual = { key, data, text };
      renderManual(host, data, key, text);
    });
  }

  function renderManual(host, data, key, text) {
    const { state, unreadable, cacheScore, publishActionBadge, sendDiagnostic } = P();
    const result = root.AIR.engine.score({
      name: data.title, labels: data.labels, certifications: data.certifications,
      nutrition: data.nutrition, ingredients_text: text,
    }, state.prefs);
    // Paste must not launder unrecognised text into a confident Excellent — same coverage floor
    // as DOM / OCR / OFF. Re-open the failure card so the user can try again.
    if (unreadable(result)) {
      state.manual = null;
      showFailure(host, { ...data, lowCoverage: true, ocrAttempted: true }, key);
      return;
    }
    host.dataset.airState = 'scored';
    P().settle('scored');
    root.AIR.panel.mount(host, root.AIR.panel.render(result, {
      title: data.title, confidence: 1, via: 'manual-paste',
    }), reporter(data, result));
    cacheScore(key, result, data.title, 'manual-paste', text);
    publishActionBadge(result);
    sendDiagnostic(data, result, 'manual-paste', text);
  }

  function wireScoreAnyway(shadow, host, data, key) {
    const { state, unreadable, cacheScore, publishActionBadge } = P();
    const btn = shadow && shadow.querySelector('button.anyway');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const data2 = root.AIR.extract.extract(document, { asin: data.asin, foodOnly: false });
      if (!data2.ok) { showFailure(host, data2, key); return; }
      const result = root.AIR.engine.score({
        name: data2.title, labels: data2.labels, certifications: data2.certifications,
        nutrition: data2.nutrition, ingredients_text: data2.text,
      }, state.prefs);
      if (unreadable(result)) {
        showFailure(host, { ...data2, lowCoverage: true, ocrAttempted: true }, key);
        return;
      }
      host.dataset.airState = 'scored';
      P().settle('scored');
      root.AIR.panel.mount(host, root.AIR.panel.render(result, {
        title: data2.title, confidence: data2.confidence, via: data2.via,
      }), reporter(data2, result));
      cacheScore(key, result, data2.title, 'food-override', data2.text);
      publishActionBadge(result);
    });
  }

  const product = { mountPoint, scoreCurrentPage, showFailure, showNotFood, tryOcr, renderManual };
  root.AIR.product = product;
  if (typeof module !== 'undefined' && module.exports) module.exports = product;
})(typeof globalThis !== 'undefined' ? globalThis : self);
