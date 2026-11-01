// USDA FoodData Central: a second barcode database for US packaged foods, tried after Open Food Facts has
// nothing usable. FoodData Central is public-domain US government data (branded foods come from the
// manufacturers' label submissions). It is asked one of two ways, never both:
//
//   direct   the reader's own free api.data.gov key (https://fdc.nal.usda.gov/api-key-signup), pasted in Settings,
//            straight to api.nal.usda.gov under the optional host permission. Needs the key and the permission.
//   script   Ingredient Check's own lookup script (docs/apps-script.gs, kind 'usda'), which holds the project's key as
//            a Script Property. This is the default, because an extension cannot hold a secret: its files are plain
//            text to anyone who installs it, and USDA deactivates any key it finds in a public repository. The
//            barcode passes through the script, which the shared-database switch can turn off.
//
// Off until the reader turns the switch on (Settings -> Label reading). What is sent: the barcode, as a search term;
// with a personal key, the key in a header. Nothing about the page, the store, the reader or their purchases. The
// personal key is stored under `usdaKey`, which no backup, export, sync or report carries, and only this worker
// reads it. (The shared DEMO_KEY is not used: it measured as "over the limit" before the first call in testing.)
//
// A record is accepted only when its own barcode is the one asked for, whichever way it came, so a text match on
// another product's description, or a wrong answer from the script, can never supply a label. An answer is kept 30
// days, "no record" 3 days, because a key allows 1,000 requests an hour and most barcodes are asked about once.
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

  // How to ask: the reader's own key and permission (direct), else Ingredient Check's script unless the reader
  // switched the shared database off or this build has no script (script).
  async function config(toggle) {
    const conf = await chrome.storage.local.get(['enabled', 'useUsda', 'sharedCache', KEY]);
    const toggles = root.AIR.db.prefs.sanitizeToggles(conf);
    if (!toggles.enabled) return { ok: false, reason: 'paused' };
    if (toggle && !toggles.useUsda) return { ok: false, reason: 'not-enabled' };
    const key = typeof conf[KEY] === 'string' ? conf[KEY].trim() : '';
    const hasKey = KEY_FORMAT.test(key);
    if (hasKey && await chrome.permissions.contains(PERMISSION)) return { ok: true, mode: 'direct', key };
    const url = toggles.sharedCache ? root.AIR.db.prefs.endpoint() : '';
    if (url) return { ok: true, mode: 'script', url };
    return { ok: false, reason: hasKey ? 'no-permission' : 'no-key' };
  }

  function failure(status) {
    if (status === 400 || status === 401 || status === 403) return 'bad-key';
    if (status === 429) { backoffUntil = Date.now() + BACKOFF_MS; return 'rate-limited'; }
    return 'unavailable';
  }

  // -> { ok: true, json: { foods } } | { ok: false, reason }
  async function search(cfg, query, networkRequest) {
    if (Date.now() < backoffUntil) return { ok: false, reason: 'rate-limited' };
    try {
      if (cfg.mode === 'script') {
        const body = await networkRequest(cfg.url, {
          method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ kind: 'usda', code: query }),
        }, res => (res.ok ? res.json() : null));
        if (body && body.ok === true && Array.isArray(body.foods)) return { ok: true, json: { foods: body.foods } };
        return { ok: false, reason: body && /busy/.test(String(body.error)) ? failure(429) : 'unavailable' };
      }
      const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&dataType=Branded&pageSize=10`;
      const res = await networkRequest(url, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'X-Api-Key': cfg.key } },
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
        const reply = await search(cfg, want, networkRequest);
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
    // Any valid barcode will do: an answer with no record still proves the key, permission or script works.
    const reply = await search(cfg, '012345678905', networkRequest);
    return reply.ok ? { ok: true, mode: cfg.mode } : { ok: false, reason: reply.reason };
  }

  root.AIR = root.AIR || {};
  root.AIR.usdaWorker = { lookup, test, parseSearch, nutritionFromFdc, digits, PERMISSION, KEY, ENDPOINT,
    // For tests: clear the pause after a 429.
    resetBackoff() { backoffUntil = 0; } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
