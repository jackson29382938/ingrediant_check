// Chrome implementation. Packaging replaces this file with the Firefox implementation.
(function(root) {
  root.AIR = root.AIR || {};
  let ready = null;
  root.AIR.platform = {
    openPanel(options) {
      if (!chrome.sidePanel?.open) return Promise.reject(new Error('no-side-panel'));
      return chrome.sidePanel.open(options);
    },
    async ensureOcrHost(path) {
      if (!chrome.offscreen) throw new Error('offscreen API unavailable');
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(path)],
      }).catch(() => []);
      if (existing?.length) return;
      if (!ready) ready = chrome.offscreen.createDocument({
        url: path, reasons: ['WORKERS'],
        justification: 'Reads the ingredient list from a product label photo, on this device.',
      }).catch(error => {
        if (!/single offscreen/i.test(String(error?.message))) throw error;
      }).finally(() => { ready = null; });
      await ready;
    },
    async closeOcrHost() {
      if (!chrome.offscreen?.closeDocument) return;
      try { await chrome.offscreen.closeDocument(); } catch { /* already gone */ }
    },
  };
})(globalThis);
