// Firefox exposes Promise APIs through browser and callback APIs through chrome.
// Preserve both calling styles used by shared code; Chrome stays untouched.
(function(root) {
  if (!root.browser?.runtime?.getURL || !root.browser.runtime.getURL('').startsWith('moz-extension:')) return;
  const native = root.chrome, modern = root.browser, cache = new WeakMap();
  function bridge(promiseApi, callbackApi) {
    if (!promiseApi || typeof promiseApi !== 'object') return promiseApi;
    if (cache.has(promiseApi)) return cache.get(promiseApi);
    const proxy = new Proxy(promiseApi, { get(target, key) {
      if (key === 'lastError') return callbackApi?.lastError;
      const value = target[key];
      if (typeof value === 'function') return (...args) => {
        if (typeof args.at(-1) === 'function' && typeof callbackApi?.[key] === 'function') return callbackApi[key](...args);
        return value.apply(target, args);
      };
      return value && typeof value === 'object' ? bridge(value, callbackApi?.[key]) : value;
    } });
    cache.set(promiseApi, proxy); return proxy;
  }
  const DATA = ['personallyIdentifyingInfo', 'healthInfo', 'websiteActivity', 'websiteContent', 'technicalAndInteraction'];
  const requestData = (extra = {}) => modern.permissions.request({ ...extra, data_collection: DATA });
  const api = bridge(modern, native);
  const i18n = api.i18n && new Proxy(api.i18n, { get(target, key) {
    if (key !== 'getMessage') return target[key];
    return (name, ...args) => root.AIR_BROWSER_MESSAGE_KEYS && !root.AIR_BROWSER_MESSAGE_KEYS.has(String(name).toLowerCase()) ? '' : target.getMessage(name, ...args);
  } });
  const permissions = api.permissions && new Proxy(api.permissions, { get(target, key) {
    if (key !== 'request') return target[key];
    return (options, callback) => {
      const opts = { ...options }, identity = opts.permissions?.includes('identity');
      if (identity) { opts.permissions = opts.permissions.filter(p => p !== 'identity'); opts.data_collection = DATA; }
      else if (opts.origins?.includes('https://world.openfoodfacts.org/*')) opts.data_collection = ['websiteContent'];
      const pending = modern.permissions.request(opts);
      return callback ? pending.then(callback, () => callback(false)) : pending;
    };
  } });
  const sync = modern.permissions && modern.storage.sync && new Proxy(api.storage.sync, { get(target, key) {
    if (key !== 'set') return target[key];
    return async values => {
      if (!await modern.permissions.contains({ data_collection: DATA })) throw new Error('Firefox data-sharing permission required');
      return modern.storage.sync.set(values);
    };
  } });
  const storage = new Proxy(api.storage, { get(target, key) { return key === 'sync' ? sync : target[key]; } });
  root.chrome = new Proxy(api, { get(target, key) {
    if (key === 'i18n') return i18n;
    if (key === 'permissions') return permissions;
    if (key === 'storage') return storage;
    if (key === 'sidePanel' && modern.sidebarAction) return { open: () => modern.sidebarAction.open() };
    return target[key];
  } });
  root.AIR = root.AIR || {}; root.AIR.browser = { firefox: true, requestData };
  if (typeof document !== 'undefined' && location.protocol === 'moz-extension:') {
    const replay = new WeakSet(), uploads = new Set(['settingsBackup', 'googleAutoSave', 'historyAutoSync', 'sharedProducts', 'shareContributions', 'sendDiagnostics']);
    document.addEventListener('change', event => {
      const box = event.target;
      if (replay.has(box)) { replay.delete(box); return; }
      if ((!uploads.has(box.id) && !(box.id === 'historyEnabled' && document.getElementById('historyAutoSync')?.checked)) || box.type !== 'checkbox' || !box.checked) return;
      event.stopImmediatePropagation(); box.checked = false;
      void requestData().then(granted => { if (granted) { box.checked = true; replay.add(box); box.dispatchEvent(new Event('change', { bubbles: true })); } }).catch(() => {});
    }, true);
    const originalFetch = root.fetch.bind(root);
    root.fetch = async (url, options = {}) => {
      if ((options.method || 'GET').toUpperCase() === 'POST' && !await modern.permissions.contains({ data_collection: DATA })) throw new Error('Firefox data-sharing permission required');
      return originalFetch(url, options);
    };
  }
})(globalThis);
