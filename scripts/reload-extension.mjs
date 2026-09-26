#!/usr/bin/env node
// Reload the unpacked extension + current Amazon tab so content scripts pick up disk changes.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runAb(args, { ignoreFail = false } = {}) {
  try {
    return execFileSync(process.execPath, [path.join(root, 'scripts/ab.mjs'), ...args], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim();
  } catch (err) {
    if (ignoreFail) return '';
    throw err;
  }
}

function cdpPortFromUrl(wsUrl) {
  try {
    return new URL(wsUrl).port;
  } catch {
    return '';
  }
}

async function cdpCall(wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP open timeout for ${method}`)), 4000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', reject);
  });
  const id = 1;
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 4000);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
  });
  ws.send(JSON.stringify({ id, method, params }));
  try {
    return await reply;
  } finally {
    try { ws.close(); } catch { /* already closed after runtime.reload() */ }
  }
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list failed: ${res.status}`);
  return res.json();
}

async function reloadSleepingExtension(browserUrl, port) {
  // Chrome removes idle workers from /json/list. The extension manager can reload an unpacked
  // extension even then; use its exact directory to avoid touching another installed extension.
  const { targetId } = await cdpCall(browserUrl, 'Target.createTarget', {
    url: 'chrome://extensions/', background: true,
  });
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const page = (await listTargets(port)).find(t => t.id === targetId);
      if (page?.webSocketDebuggerUrl) {
        const result = await cdpCall(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const list = document.querySelector('extensions-manager')?.shadowRoot
              ?.querySelector('extensions-item-list')?.shadowRoot;
            const item = [...(list?.querySelectorAll('extensions-item') || [])]
              .find(e => e.data?.path === ${JSON.stringify(root)});
            const button = item?.shadowRoot?.querySelector('#dev-reload-button');
            if (!button) return false;
            button.click();
            return true;
          })()`,
        });
        if (result.result?.value === true) return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  } finally {
    await cdpCall(browserUrl, 'Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function reloadUnpackedExtension(port, browserUrl) {
  const targets = await listTargets(port);
  const sw = targets.find((t) =>
    (t.type === 'service_worker' || t.type === 'background_page')
    && String(t.url || '').startsWith('chrome-extension://')
  );
  if (!sw?.webSocketDebuggerUrl) return reloadSleepingExtension(browserUrl, port);
  try {
    await cdpCall(sw.webSocketDebuggerUrl, 'Runtime.enable');
  } catch { /* some targets already have Runtime */ }
  try {
    await cdpCall(sw.webSocketDebuggerUrl, 'Runtime.evaluate', {
      expression: 'chrome.runtime.reload()',
    });
  } catch {
    // The worker disconnects as soon as reload starts — that is success.
  }
  return true;
}

const cdpUrl = runAb(['get', 'cdp-url'], { ignoreFail: true });
if (!cdpUrl) {
  console.error('ingredient-check: Chrome session is not running. Start it with npm run chrome');
  process.exit(0);
}

const port = cdpPortFromUrl(cdpUrl);
let reloaded = false;
if (port) {
  try {
    reloaded = await reloadUnpackedExtension(port, cdpUrl);
  } catch (err) {
    console.error(`ingredient-check: extension reload failed (${err.message})`);
  }
}

await new Promise((r) => setTimeout(r, reloaded ? 900 : 200));
runAb(['reload'], { ignoreFail: true });
await new Promise((r) => setTimeout(r, 1200));
console.log(reloaded
  ? 'ingredient-check: reloaded extension and page'
  : 'ingredient-check: reloaded page (extension worker not found)');
