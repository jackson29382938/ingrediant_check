// USDA FoodData Central: a second barcode database for US packaged foods, tried after Open Food Facts has
// nothing usable. FoodData Central is public-domain US government data (branded foods come from the
// manufacturers' label submissions), free to use with an api.data.gov key the reader gets themselves at
// https://fdc.nal.usda.gov/api-key-signup. Off until the reader pastes that key, turns the switch on and grants
// the optional api.nal.usda.gov host permission (Settings -> Label reading).
//
// What is sent: the barcode, as a search term, with the reader's key in a header. Nothing about the product page,
// the store, the reader or their purchases. The key is stored under `usdaKey`, which no backup, export, sync or
// report carries, and only this worker reads it. (The shared DEMO_KEY is not used: it is limited to a handful of
// requests an hour for everyone, which measured out at "over the limit" before the first call in testing.)
//
// A record is accepted only when its own barcode is the one asked for, so a text match on another product's
// description can never supply a label. An answer is kept 30 days, "no record" 3 days, because a key allows
// 1,000 requests an hour and most barcodes are asked about once.
//
// Called from background.js lookupBarcode, which passes networkRequest (the worker's one fetch helper, which stops
// on the pause switch). The result has the shape of the Open Food Facts one plus `source: 'usda-fdc'`, so the pages
// that read it name the right database.

(function (root) {
  const ENDPOINT = 'https://api.nal.usda.gov/fdc/v1/foods/search';
  const PERMISSION = { origins: ['https://api.nal.usda.gov/*'] };
  const KEY = 'usdaKey';
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
  const BACKOFF_MS = 5 * 60 * 1000;
  const MAX_TEXT = 6000;
  const KEY_FORMAT = /^[A-Za-z0-9]{16,64}$/;
  // Phrases, never the bare word: "Pet" is also a brand of evaporated milk.
  const PET = /\b(?:pet|dog|cat|puppy|kitten|bird|fish)\s+(?:food|treats?|supplies)\b/i;
  // FoodData Central nutrient ids -> the engine's nutrition fields. Branded values are per 100 g or 100 ml.
  const NUTRIENTS = { sodium: 1093, saturatedFat: 1258, sugar: 2000, addedSugar: 1235, fibre: 1079, protein: 1003, carbs: 1005, fat: 1004 };

  let backoffUntil = 0;
  const inFlight = new Map();

  // A barcode as digits without leading zeros, so a 12-digit UPC-A and its 13-digit EAN form are one number.
  const digits = code => String(code == null ? '' : code).replace(/\D/g, '').replace(/^0+/, '');

  function nutritionFromFdc(food) {
    const unit = String(food && food.servingSizeUnit || '').toLowerCase();
    const basis = /^(?:g|grm|gram)s?$/.test(unit) ? 'servingGrams' : /^(?:ml|mlt|milliliter)s?$/.test(unit) ? 'servingMl' : '';
    if (!basis || !Array.isArray(food.foodNutrients)) return null;
    const out = { [basis]: 100 };
    for (const [field, id] of Object.entries(NUTRIENTS)) {
      const found = food.foodNutrients.find(n => n && Number(n.nutrientId) === id);
      const value = found && Number(found.value);
      if (Number.isFinite(value) && value >= 0) out[field] = value;
    }
    return Object.keys(out).length > 1 ? out : null;
  }

  // The search answer -> the reading for exactly this barcode, or null. Pure.
  function parseSearch(json, code, { foodOnly = true } = {}) {
    const want = digits(code);
    if (!want || !json || !Array.isArray(json.foods)) return null;
    const matches = json.foods.filter(f => f && typeof f === 'object' && digits(f.gtinUpc) === want
      && typeof f.ingredients === 'string' && f.ingredients.trim());
    if (!matches.length) return null;
    matches.sort((a, b) => String(b.modifiedDate || b.publishedDate || '').localeCompare(String(a.modifiedDate || a.publishedDate || '')));
    const food = matches[0];
    const category = String(food.foodCategory || '').slice(0, 120);
    if (foodOnly && PET.test(category + ' ' + String(food.description || ''))) {
      return { rejected: 'not-food', reason: 'USDA FoodData Central lists this as a pet product' };
    }
    const text = food.ingredients.replace(/\s+/g, ' ').replace(/[\s.]+$/, '').trim().slice(0, MAX_TEXT);
    const name = [food.brandName || food.brandOwner, food.description].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const nutrition = nutritionFromFdc(food);
    return {
      ingredients_text: text, labels: '', nova_group: null, name: name || null, product_type: 'food',
      categories_tags: [], categories: category, pnns_groups_1: '', source: 'usda-fdc',
      ...(nutrition ? { nutrition } : {}),
    };
  }

  async function config(toggle) {
    const conf = await chrome.storage.local.get(['enabled', 'useUsda', KEY]);
    const toggles = root.AIR.db.prefs.sanitizeToggles(conf);
    if (!toggles.enabled) return { ok: false, reason: 'paused' };
    if (toggle && !toggles.useUsda) return { ok: false, reason: 'not-enabled' };
    const key = typeof conf[KEY] === 'string' ? conf[KEY].trim() : '';
    if (!KEY_FORMAT.test(key)) return { ok: false, reason: 'no-key' };
    if (!await chrome.permissions.contains(PERMISSION)) return { ok: false, reason: 'no-permission' };
    return { ok: true, key };
  }

  function failure(status) {
    if (status === 400 || status === 401 || status === 403) return 'bad-key';
    if (status === 429) { backoffUntil = Date.now() + BACKOFF_MS; return 'rate-limited'; }
    return 'unavailable';
  }

  // -> { ok: true, json } | { ok: false, reason }
  async function search(key, query, networkRequest) {
    if (Date.now() < backoffUntil) return { ok: false, reason: 'rate-limited' };
    const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&dataType=Branded&pageSize=10`;
    try {
      const res = await networkRequest(url, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'X-Api-Key': key } },
        async r => ({ status: r.status, json: r.ok ? await r.json() : null }));
      return res.json ? { ok: true, json: res.json } : { ok: false, reason: failure(res.status) };
    } catch (e) {
      return { ok: false, reason: String(e && e.message) === 'paused' ? 'paused' : 'unavailable' };
    }
  }

  // The reading for a barcode, or null (no key, switched off, no such product, offline). `manual`: the reader
  // pressed Look up in the library, so the switch is not asked, as for Open Food Facts.
  async function lookup(code, { manual = false, foodOnly = true, networkRequest } = {}) {
    const want = digits(code);
    if (!want || want.length < 7 || want.length > 14 || typeof networkRequest !== 'function') return null;
    const cfg = await config(manual ? null : 'useUsda');
    if (!cfg.ok) return null;
    const cacheKey = `usda:${want}`;
    const held = (await chrome.storage.local.get(cacheKey))[cacheKey];
    if (held && Number.isFinite(held.t) && Date.now() - held.t < (held.data ? TTL_MS : MISS_TTL_MS)) {
      return held.data ? afterFoodCheck(held.data, foodOnly) : null;
    }
    if (!inFlight.has(cacheKey)) {
      inFlight.set(cacheKey, (async () => {
        const reply = await search(cfg.key, want, networkRequest);
        if (!reply.ok) return null;                       // not cached: a refusal says nothing about the barcode
        const data = parseSearch(reply.json, want, { foodOnly: false });
        await chrome.storage.local.set({ [cacheKey]: data ? { t: Date.now(), data } : { t: Date.now() } }).catch(() => {});
        return data;
      })().finally(() => inFlight.delete(cacheKey)));
    }
    const data = await inFlight.get(cacheKey);
    return data ? afterFoodCheck(data, foodOnly) : null;
  }

  // The pet check is per caller, as Open Food Facts' food check is: the record is the same for everyone.
  function afterFoodCheck(data, foodOnly) {
    if (foodOnly && PET.test(`${data.categories || ''} ${data.name || ''}`)) {
      return { rejected: 'not-food', reason: 'USDA FoodData Central lists this as a pet product' };
    }
    return data;
  }

  // The settings page's key check. Ok on any answer that is not a refusal.
  async function test(networkRequest) {
    const cfg = await config(null);
    if (!cfg.ok) return cfg;
    const reply = await search(cfg.key, 'cheddar cheese', networkRequest);
    return reply.ok ? { ok: true } : { ok: false, reason: reply.reason };
  }

  root.AIR = root.AIR || {};
  root.AIR.usdaWorker = { lookup, test, parseSearch, nutritionFromFdc, digits, PERMISSION, KEY, ENDPOINT,
    // For tests: clear the pause after a 429.
    resetBackoff() { backoffUntil = 0; } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
