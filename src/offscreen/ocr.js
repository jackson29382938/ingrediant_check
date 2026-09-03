// Offscreen OCR host.
//
// Runs in an offscreen document rather than the content script, for two reasons. Tesseract spawns
// a worker and allocates tens of megabytes, which has no business happening on Amazon's page
// thread; and a worker created from an extension URL inside a content script is subject to the
// host page's CSP, which Amazon sets restrictively. An offscreen document is extension-origin, so
// the worker, the wasm and the language data all load from our own CSP.
//
// Everything here is local. The vendored engine and language data ship with the extension — MV3
// forbids remote code, and OCR of a label the user is looking at should not become a network
// request to anyone.

const CORE = chrome.runtime.getURL('vendor/tesseract/');
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: CORE,
      langPath: CORE,
      gzip: true,
      workerBlobURL: false,
    }).catch(err => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

// Images are fetched here rather than passed as blobs, because m.media-amazon.com serves them with
// Access-Control-Allow-Origin: * — verified — so no host permission is needed for any of this.
async function ocrOne(url, signal) {
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const worker = await getWorker();
  const { data } = await worker.recognize(blob);
  return { url, text: data.text || '', confidence: data.confidence || 0 };
}

// Sequential on purpose. Tesseract holds one worker; running images in parallel would queue inside
// it anyway while multiplying peak memory. Stops at the first image that yields a usable block,
// because the label shot is usually the second image and scanning the rest is wasted seconds.
async function ocrImages(urls, { limit = 5, timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  const results = [];
  try {
    for (const url of (urls || []).slice(0, limit)) {
      if (controller.signal.aborted) break;
      try {
        const r = await ocrOne(url, controller.signal);
        results.push(r);
        if (AIR.db.ocrText.ingredientsFromOcr(r.text)) break;   // found the label; stop paying
      } catch (e) { /* one unreadable image must not end the pass */ }
    }
  } finally { clearTimeout(deadline); }
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== 'ocr-offscreen') return false;
  if (msg.type === 'ocrImages') {
    ocrImages(msg.urls, msg.options || {})
      .then(results => reply({ ok: true, results }))
      .catch(e => reply({ ok: false, reason: String(e && e.message || e) }));
    return true;
  }
  return false;
});
