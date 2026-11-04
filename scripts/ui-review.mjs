// Real extension screens, isolated synthetic storage, and native browser controls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.UI_REVIEW_SOURCE || root;
const output = process.env.UI_REVIEW_OUTPUT || '/tmp/ic-ui-review';
fs.mkdirSync(output, { recursive: true });
const messages = JSON.parse(fs.readFileSync(path.join(source, '_locales/en/messages.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
const browser = await chromium.launch({ headless: true, executablePath: process.env.HARNESS_CHROME || undefined });
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('https://ui.test/**', route => {
    const file = path.join(source, new URL(route.request().url()).pathname);
    if (!file.startsWith(source + '/') || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: file });
  });
  await context.addInitScript(({ messages, manifest }) => {
    const data = { settingsLevel: 'expert', onboarded: true, weights: {}, goals: [], allergens: ['peanut'], avoidList: ['palm oil'], theme: 'light', historyAutoSync: false };
    const listeners = [], event = { addListener: fn => listeners.push(fn) };
    const answer = (value, cb) => { cb?.(value); return Promise.resolve(value); };
    const local = {
      get: (keys, cb) => answer(keys == null ? { ...data } : Object.fromEntries([].concat(keys).map(k => [k, data[k]])), cb),
      getKeys: () => Promise.resolve(Object.keys(data)),
      set: (values, cb) => { const changes = Object.fromEntries(Object.entries(values).map(([k, newValue]) => [k, { oldValue: data[k], newValue }])); Object.assign(data, values); listeners.forEach(fn => fn(changes, 'local')); return answer(undefined, cb); },
      remove: (keys, cb) => { for (const k of [].concat(keys)) delete data[k]; return answer(undefined, cb); },
    };
    window.__uiData = data;
    window.chrome = {
      i18n: { getMessage: (key, subs = []) => (messages[key]?.message || '').replace(/\$(\d)/g, (_, i) => [].concat(subs)[Number(i) - 1] || '') },
      runtime: { id: 'test-extension', getManifest: () => manifest, getURL: p => 'https://ui.test/' + p,
        onMessage: { addListener() {} }, sendMessage: (_msg, cb) => answer({ ok: false, reason: 'test-only' }, cb) },
      storage: { local, sync: { get: (_k, cb) => answer({}, cb), set: (_v, cb) => answer(undefined, cb), getBytesInUse: (_k, cb) => answer(0, cb) }, session: local, onChanged: event },
      permissions: { contains: (_q, cb) => answer(false, cb), request: (_q, cb) => answer(false, cb), remove: (_q, cb) => answer(true, cb) },
      tabs: { query: (_q, cb) => answer([{ id: 1, url: 'https://www.walmart.com/search?q=beef' }], cb), create: (_q, cb) => answer({}, cb), sendMessage: (_id, _q, cb) => answer(null, cb) },
      commands: { getAll: cb => answer([], cb) },
    };
  }, { messages, manifest });
  for (const screen of ['options', 'popup', 'library', 'history', 'report']) {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: screen === 'popup' ? 375 : 1440, height: 1000 });
    await page.goto(`https://ui.test/src/options/${screen}.html`);
    if (screen === 'options') await page.waitForFunction(() => document.querySelectorAll('.preset-card').length > 0);
    if (screen === 'popup') await page.waitForFunction(() => document.querySelectorAll('.preset').length > 0);
    if (screen === 'history') await page.waitForSelector('#metricItems');
    // Extension URLs boot this automatically; the intercepted HTTPS test origin
    // calls the same appearance pipeline explicitly.
    if (screen === 'options' || screen === 'popup') await page.evaluate(() => window.AIR.db.theme.boot());
    await page.screenshot({ path: path.join(output, `${screen}-desktop.png`) });
    if (source === root) {
      if (screen !== 'popup') {
        assert.equal(await page.locator('.ui-app-nav [aria-current="page"]').count(), screen === 'report' ? 0 : 1);
        await page.locator('.ui-skip').focus();
        await page.keyboard.press('Enter');
        assert(await page.locator('main').evaluate(el => el === document.activeElement), 'Skip link focuses the content');
      }
      if (screen === 'options') {
        const before = await page.evaluate(() => JSON.stringify([window.__uiData.weights, window.__uiData.allergens, window.__uiData.avoidList]));
        await page.getByLabel('Find a setting', { exact: true }).fill('barcode');
        assert.equal(await page.locator('#sec-presets').isVisible(), false);
        await page.getByLabel('Find a setting', { exact: true }).press('Escape');
        assert.equal(await page.locator('#sec-presets').isVisible(), true);
        await page.getByLabel('Find a setting', { exact: true }).fill('zz-no-such-setting');
        assert.equal(await page.getByText('No matching sections', { exact: false }).isVisible(), true);
        await page.getByRole('button', { name: 'Show essentials', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__uiData.settingsLevel), 'simple');
        assert.equal(await page.evaluate(() => JSON.stringify([window.__uiData.weights, window.__uiData.allergens, window.__uiData.avoidList])), before);
        assert.equal(await page.locator('#sec-weights').isVisible(), false);
        await page.waitForFunction(() => !document.getElementById('status').textContent);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, 'settings-essentials.png') });
      }
      if (screen === 'popup') {
        assert.equal(await page.locator('#presets').isVisible(), false);
        await page.locator('#goalPicker > summary').click();
        assert.equal(await page.locator('#presets').isVisible(), true);
        await page.locator('#presetCats [role=tab]').first().focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#presetCats [role=tab][aria-selected=true]').evaluate(n => n === document.activeElement), true);
      }
      if (screen === 'library') {
        await page.locator('#labelName').fill('Rolled oats');
        await page.locator('#labelText').fill('Whole grain rolled oats.');
        await page.locator('button[type=submit]').click();
        await page.waitForFunction(() => !document.getElementById('saveLabelControls').hidden);
        assert(await page.evaluate(() => {
          const host = document.querySelector('#checkResult > div');
          const score = window.AIR.panel.shadowOf(host)?.querySelector('.score');
          return score && Number.isFinite(Number(score.textContent)) && Number(score.textContent) >= 0;
        }));
      }
      await page.setViewportSize({ width: 375, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${screen} horizontal overflow`);
      if (screen === 'library') assert(await page.locator('.file-button').evaluate(el => el.getBoundingClientRect().right <= el.closest('section').getBoundingClientRect().right), 'Photo picker stays inside the label card');
      await page.evaluate(() => { scrollTo(0, 0); });
      await page.screenshot({ path: path.join(output, `${screen}-mobile.png`) });
      await page.evaluate(() => chrome.storage.local.set({ theme: 'dark' }));
      if (screen === 'report') await page.emulateMedia({ colorScheme: 'dark' });
      if (screen !== 'report') await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark');
      if (screen === 'library') assert(await page.evaluate(() => {
        const shadow = window.AIR.panel.shadowOf(document.querySelector('#checkResult > div'));
        return getComputedStyle(shadow.querySelector('.card')).backgroundColor !== 'rgb(255, 255, 255)';
      }), 'Checked label follows the dark theme');
      await page.screenshot({ path: path.join(output, `${screen}-dark.png`) });
    }
    assert.deepEqual(errors, [], `${screen} page errors`);
    await page.close();
  }
  await context.close();
  console.log(source !== root ? 'Baseline screenshots captured.' : 'UI review passed: settings search, explicit Essentials choice, stored preferences preserved, goal disclosure/keyboard tabs, label scoring, and narrow layouts.');
} finally { await browser.close(); }
