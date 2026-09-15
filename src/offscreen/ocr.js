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
    const creating = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: CORE, langPath: CORE, gzip: true, workerBlobURL: false,
    });
    workerPromise = creating;
    creating.catch(() => { if (workerPromise === creating) workerPromise = null; });
  }
  return workerPromise;
}

function resetWorker() {
  const previous = workerPromise;
  workerPromise = null;
  // Do not wait for a stuck worker to acknowledge termination. A late startup is disposed too.
  previous?.then(worker => worker.terminate()).catch(() => {});
}

// Images are fetched here rather than passed as blobs, because m.media-amazon.com serves them with
// Access-Control-Allow-Origin: * — verified — so no host permission is needed for any of this.
async function ocrOne(url, signal) {
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const worker = await getWorker();
  if (signal.aborted) throw new Error('cancelled');
  const { data } = await worker.recognize(blob);
  return { url, text: data.text || '', confidence: data.confidence || 0 };
}

// One job owns the worker at a time. Each deadline includes time spent waiting in the queue.
let ocrWork = Promise.resolve();
let activeJob = null;
const jobs = new Set();
function ocrImages(urls, { limit = 5, timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const job = { controller };
  jobs.add(job);
  const duration = Math.min(45000, Math.max(1, Number(timeoutMs) || 45000));
  let deadline;
  const cancelled = new Promise(resolve => {
    controller.signal.addEventListener('abort', () => {
      if (activeJob === job) resetWorker();
      resolve([]);
    }, { once: true });
    deadline = setTimeout(() => controller.abort(), duration);
  });
  const run = async () => {
    if (controller.signal.aborted) return [];
    activeJob = job;
    const scan = async () => {
      const results = [];
      const count = Math.min(5, Math.max(1, Number(limit) || 5));
      for (const url of (Array.isArray(urls) ? urls : []).slice(0, count)) {
        if (controller.signal.aborted) break;
        try {
          const r = await ocrOne(url, controller.signal);
          if (controller.signal.aborted) break;
          results.push(r);
          if (AIR.db.ocrText.ingredientsFromOcr(r.text)) break;
        } catch (e) { /* try the next image unless cancelled */ }
      }
      return results;
    };
    try { return await Promise.race([scan(), cancelled]); }
    finally { if (activeJob === job) activeJob = null; }
  };
  const queued = ocrWork.then(run);
  ocrWork = queued.catch(() => {});
  return Promise.race([queued, cancelled]).finally(() => {
    clearTimeout(deadline);
    jobs.delete(job);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== 'ocr-offscreen') return false;
  if (msg.type === 'cancelOcr') {
    for (const job of jobs) job.controller.abort();
    reply({ ok: true });
    return false;
  }
  if (msg.type === 'ocrImages') {
    ocrImages(msg.urls, msg.options || {})
      .then(results => reply({ ok: true, results }))
      .catch(e => reply({ ok: false, reason: String(e && e.message || e) }));
    return true;
  }
  return false;
});
