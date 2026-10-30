// Local shopping evidence and durable shortlists. Scores are always recomputed from saved inputs.
(function(root) {
  const PREFIX = 'savedProduct:', MAX = 200;
  // eslint-disable-next-line no-control-regex
  const text = (v, max = 200) => typeof v === 'string' ? v.replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).trim() : '';
  function warningProfile(raw = {}) {
    const ids = values => [...new Set((Array.isArray(values) ? values : []).filter(v => typeof v === 'string').map(v => text(v, 120).toLowerCase()))].sort();
    const avoid = root.AIR.db.prefs?.sanitizeAvoidList(raw.avoidList) || raw.avoidList;
    return JSON.stringify([ids(raw.allergens), ids(raw.diets), ids(avoid), Number.isFinite(raw.weights?.allergens) ? raw.weights.allergens : 1, Number.isFinite(raw.weights?.avoidList) ? raw.weights.avoidList : 1]);
  }
  function cleanInput(raw) {
    if (!raw || typeof raw !== 'object' || !text(raw.ingredients_text, 6000)) return null;
    if (raw.ingredients_text.length > 6000 || (typeof raw.advisory_text === 'string' && raw.advisory_text.length > 6000)) return null;
    const out = {};
    // Preserve the exact scoring text, including line breaks and markup separators. It is
    // escaped by the score panel and rendered as text elsewhere, never inserted as raw HTML.
    for (const [key, max] of Object.entries({ name: 250, ingredients_text: 6000, advisory_text: 6000, labels: 3000, certifications: 500, supplement_facts: 3000, category: 30 })) if (typeof raw[key] === 'string') out[key] = raw[key].slice(0, max);
    if (raw.nutrition && typeof raw.nutrition === 'object') {
      out.nutrition = {};
      for (const key of ['sodium', 'saturatedFat', 'transFat', 'sugar', 'addedSugar', 'fibre', 'protein', 'calories', 'fat', 'carbs', 'servingGrams', 'servingMl']) if (Number.isFinite(raw.nutrition[key]) && raw.nutrition[key] >= 0 && raw.nutrition[key] <= 1e9) out.nutrition[key] = raw.nutrition[key];
      if (raw.nutrition.servingSize) out.nutrition.servingSize = text(raw.nutrition.servingSize, 80);
    }
    if (raw.provenanceRecord && typeof raw.provenanceRecord === 'object') out.provenanceRecord = { certifications: text(raw.provenanceRecord.certifications, 500), source: text(raw.provenanceRecord.source, 120), producerRegistry: { certifications: text(raw.provenanceRecord.producerRegistry?.certifications, 500) } };
    return out;
  }
  function evidence(result, meta = {}) {
    return {
      coverage: Number.isFinite(result?.coverage) ? Math.max(0, Math.min(1, result.coverage)) : null,
      source: text(meta.source || meta.via, 60), capturedAt: Number.isFinite(meta.capturedAt) && meta.capturedAt > 0 && meta.capturedAt <= Date.now() ? meta.capturedAt : null,
      readable: result?.readable === true,
      warningProfile: meta.prefs ? warningProfile(meta.prefs) : typeof meta.warningProfile === 'string' && meta.warningProfile.length <= 10000 ? meta.warningProfile : null,
      missing: (result?.nutritionAssessment || []).filter(f => f.status !== 'assessed').map(f => text(f.label, 80)).slice(0, 12),
      assessed: (result?.nutritionAssessment || []).filter(f => f.status === 'assessed').map(f => text(f.category, 40)).slice(0, 12),
      flags: (result?.flags || []).slice(0, 30).map(f => ({ label: text(f.label), kind: text(f.kind, 30), evidence: text(f.evidence, 30), ingredient: text(f.ingredient) })),
    };
  }
  function cleanEvidence(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return evidence({ coverage: raw.coverage, readable: raw.readable, flags: Array.isArray(raw.flags) ? raw.flags : [], nutritionAssessment: [
      ...(Array.isArray(raw.assessed) ? raw.assessed : []).slice(0, 12).map(category => ({ category, status: 'assessed' })),
      ...(Array.isArray(raw.missing) ? raw.missing : []).slice(0, 12).map(label => ({ label, status: 'unavailable' })),
    ] }, raw);
  }
  function sourceLabel(source) {
    return /ocr/.test(source) ? 'Label photo' : source === 'open-food-facts' ? 'Barcode database' : /manual|paste/.test(source) ? 'Entered label' : source ? 'Product page' : 'Source not recorded';
  }
  function describe(raw, t = (_key, fallback) => fallback) {
    const ev = cleanEvidence(raw); if (!ev) return t('evidenceUnknown', 'Evidence not recorded');
    const source = /ocr/.test(ev.source) ? t('srcShortOcr', 'Label photo') : ev.source === 'open-food-facts' ? t('srcShortBarcode', 'Open Food Facts') : /manual|paste/.test(ev.source) ? t('evidenceEntered', 'Entered label') : ev.source ? t('srcShortPage', 'Product page') : t('evidenceUnknown', 'Evidence not recorded');
    return [source, ev.coverage !== null && ev.coverage < 0.7 ? t('evidencePartial', 'Partial reading') : '', ev.missing.length ? t('evidenceMissing', 'Missing selected nutrition data') : '', ev.capturedAt ? new Date(ev.capturedAt).toLocaleDateString() : ''].filter(Boolean).join(' · ');
  }
  function warningLabel(type, t = (_key, fallback) => fallback) {
    const labels = { ingredient: ['warningEvidence_ingredient', 'Ingredient detected'], contains: ['warningEvidence_contains', 'Contains statement'], 'cross-contact': ['warningEvidence_crossContact', 'May contain / shared facility'], advisory: ['warningEvidence_advisory', 'Label advisory'] };
    return labels[type] ? t(...labels[type]) : '';
  }
  function matches(product, filters = {}) {
    if (filters.maxPrice !== '' && filters.maxPrice != null && (!Number.isFinite(product.listingPrice) || product.listingPrice > Number(filters.maxPrice))) return false;
    if (filters.minScore !== '' && filters.minScore != null && (!Number.isFinite(product.score) || product.score < Number(filters.minScore))) return false;
    const ev = cleanEvidence(product.evidence);
    if (filters.complete && (!ev?.readable || ev.coverage === null || ev.coverage < 0.7 || ev.missing.length)) return false;
    const choicesMatch = ev && (!filters.warningProfile || ev.warningProfile === filters.warningProfile);
    const warningsKnown = choicesMatch && ev.readable && ev.coverage === 1;
    if (filters.noMatches && ((choicesMatch && ev.flags.length > 0) || (!warningsKnown && filters.unknown !== 'include'))) return false;
    return true;
  }
  function cleanSaved(raw) {
    const input = cleanInput(raw?.input);
    if (!input || !/^(?:product:[a-z0-9.-]+:[A-Z0-9_-]{5,40}|label:[a-f0-9-]{10,40})$/i.test(raw?.id || '')) return null;
    let url = '';
    try { const u = new URL(raw.url); if (u.protocol === 'https:' && !u.username && !u.password && root.AIR.stores?.storeForHost(u.hostname)) { u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/ref=[^/]*.*$/, ''); url = u.href; } } catch { /* a standalone label has no retailer URL */ }
    return { id: raw.id, input, name: text(raw.name || input.name, 250) || 'Saved label', list: text(raw.list, 60) || 'Shopping list', url,
      source: text(raw.source, 60), capturedAt: Number.isFinite(raw.capturedAt) && raw.capturedAt > 0 && raw.capturedAt <= Date.now() ? raw.capturedAt : null,
      savedAt: Number.isFinite(raw.savedAt) && raw.savedAt > 0 ? Math.min(Date.now(), raw.savedAt) : Date.now(),
      savedScore: Number.isFinite(raw.savedScore) && raw.savedScore >= 0 && raw.savedScore <= 100 ? raw.savedScore : null };
  }
  async function list(area) {
    const keys = typeof area.getKeys === 'function' ? await area.getKeys() : Object.keys(await area.get(null));
    const selected = keys.filter(k => k.startsWith(PREFIX)).slice(0, MAX);
    const rows = await area.get(selected);
    return Object.entries(rows).filter(([key]) => selected.includes(key)).map(([, value]) => cleanSaved(value)).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
  }
  async function save(area, raw) {
    const row = cleanSaved(raw); if (!row) throw new Error('invalid-saved-label');
    const rows = await list(area);
    if (!rows.some(r => r.id === row.id) && rows.length >= MAX) throw new Error('shortlist-full');
    await area.set({ [PREFIX + row.id]: row }); return row;
  }
  function offerSave(shadow, raw) {
    if (!cleanSaved(raw)) return;
    const t = (key, fallback) => { try { return chrome.i18n.getMessage(key) || fallback; } catch { return fallback; } };
    for (const box of shadow.querySelectorAll('.actions, .foot')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'copy save-product'; button.textContent = t('saveProduct', 'Save product'); box.append(button);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await save(chrome.storage.local, raw); button.textContent = t('savedProduct', 'Saved'); }
        catch { button.disabled = false; button.textContent = t('saveFailed', 'Could not save — try again'); }
      });
    }
  }
  const api = { evidence, cleanEvidence, describe, warningLabel, warningProfile, sourceLabel, matches, cleanInput, cleanSaved, list, save, offerSave, PREFIX, MAX };
  root.AIR = root.AIR || {}; root.AIR.db = root.AIR.db || {}; root.AIR.db.shopping = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
