// Real Chrome storage APIs in two isolated, signed-out profiles. Delivery is simulated;
// this does not claim that Google account sync transported the data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profiles = [], contexts = [];
try {
  const snapshots = [];
  for (const label of ['A', 'B']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-sync-profile-'));
    profiles.push(profile);
    const context = await chromium.launchPersistentContext(profile, {
      headless:true, ...(process.env.HARNESS_CHROME ? {executablePath:process.env.HARNESS_CHROME} : {channel:'chromium'}),
      args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    contexts.push(context);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const snapshot = await worker.evaluate(async label => {
      await chrome.storage.local.set({settingsBackup:true, sharedCache:false, avoidList:Array.from({length:80}, (_, i)=>(label+i).padEnd(80,'漢')), speedMode:'freshest'});
      // Let the normal local-change debounce finish before simulating delivery.
      await new Promise(resolve => setTimeout(resolve, 2200));
      if (!(await self.backupToChrome()).ok) throw new Error('first backup failed');
      if (!(await self.backupToChrome()).ok) throw new Error('second backup failed');
      return chrome.storage.sync.get(null);
    }, label);
    snapshots.push({worker,snapshot});
  }
  assert.notEqual(snapshots[0].snapshot.icBackup._syncDevice, snapshots[1].snapshot.icBackup._syncDevice);
  for (const winner of [0,1]) {
    const combined = {...snapshots[0].snapshot,...snapshots[1].snapshot,icBackup:snapshots[winner].snapshot.icBackup};
    for (const [profileIndex, {worker}] of snapshots.entries()) {
      const result = await worker.evaluate(async items => {
        await chrome.storage.sync.set(items);
        const parsed = await AIR.db.prefs.readSync(chrome.storage.sync);
        const local = await chrome.storage.local.get('avoidList');
        return {ok:parsed.ok, restored:parsed.values?.avoidList[0][0], local:local.avoidList[0][0], bytes:await chrome.storage.sync.getBytesInUse(null)};
      }, combined);
      assert.ok(result.ok);
      assert.equal(result.restored, winner === 0 ? 'A' : 'B');
      assert.ok(result.bytes <= 102400);
      assert.equal(result.local, profileIndex === 0 ? 'A' : 'B');
      console.log(`complete backup ${winner === 0 ? 'A' : 'B'} restored coherently; ${result.bytes} sync bytes; local settings still ${result.local}`);
    }
  }
  console.log('two-profile storage simulation passed; no sign-in or remote delivery used');
} finally {
  for (const context of contexts) await context.close();
  for (const profile of profiles) fs.rmSync(profile,{recursive:true,force:true});
}
