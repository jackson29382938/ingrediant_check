// Native Firefox implementation; copied to browser-platform.js in the Firefox package.
(function(root) {
  root.AIR = root.AIR || {};
  let ready = null;
  root.AIR.platform = {
    openPanel() { return browser.sidebarAction.open(); },
    async ensureOcrHost(path) {
      // Check an in-flight load before the element: its presence does not mean OCR is ready.
      if (ready) return ready;
      if (document.getElementById('air-ocr-host')) return;
      ready = new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.id = 'air-ocr-host'; frame.hidden = true;
        const timeout = setTimeout(() => { frame.remove(); reject(new Error('OCR host timeout')); }, 15000);
        frame.onload = () => { clearTimeout(timeout); resolve(); };
        frame.onerror = () => { clearTimeout(timeout); frame.remove(); reject(new Error('OCR host failed')); };
        frame.src = browser.runtime.getURL(path); document.body.append(frame);
      }).finally(() => { ready = null; });
      return ready;
    },
    async closeOcrHost() { document.getElementById('air-ocr-host')?.remove(); },
  };
})(globalThis);
