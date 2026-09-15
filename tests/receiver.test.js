const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function receiver() {
  const tabs = new Map();
  let locked = false, failFlush = false, legacy = '{}';
  function newSheet() {
    const data = [];
    return { data, getLastRow: () => data.length,
      appendRow(row) { data.push([...row]); }, setFrozenRows() {},
      getRange(r, c, height = 1, width = 1) {
        return {
          getValues: () => Array.from({ length: height }, (_, i) =>
            Array.from({ length: width }, (_, j) => data[r - 1 + i]?.[c - 1 + j] ?? '')),
          setValue(value) { this.setValues([[value]]); },
          setValues(values) {
            assert.equal(locked, true, 'all appends must hold the shared lock');
            values.forEach((row, i) => {
              data[r - 1 + i] ||= [];
              row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
            });
          },
        };
      },
    };
  }
  const c = vm.createContext({
    LockService: { getScriptLock: () => ({
      tryLock() { if (locked) return false; locked = true; return true; },
      releaseLock() { locked = false; },
    }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: name => tabs.get(name),
      insertSheet(name) { const sheet = newSheet(); tabs.set(name, sheet); return sheet; },
    }), flush() { if (failFlush) { failFlush = false; throw new Error('lost acknowledgement'); } } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => legacy,
      setProperty() { throw new Error('dedup must not depend on property writes'); } }) },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../docs/apps-script.gs'), 'utf8'), c);
  return { tabs, post: body => c.doPost({ postData: { contents: JSON.stringify(body) } }),
    failNext: () => { failFlush = true; }, setLocked: v => { locked = v; },
    setLegacy: v => { legacy = JSON.stringify(v); } };
}
const batch = (start, count = 12) => ({ kind: 'diagnostics', batchId: `b-${start}`,
  rows: Array.from({ length: count }, (_, i) => ({ rowId: `r-${start + i}`, ingredients: 'Oats' })) });
test('retry after append but before acknowledgement never duplicates data', () => {
  const r = receiver();
  r.failNext();
  assert.equal(r.post(batch(0)).ok, false);
  assert.equal(r.post(batch(0)).inserted, 0);
  assert.equal(r.tabs.get('diagnostics').data.length, 13);
  assert.equal(r.tabs.get('diagnostics').data[0].at(-1), 'rowId');
});
test('duplicate protection survives well beyond the old 400-row and 80-batch limits', () => {
  const r = receiver();
  for (let i = 0; i < 1200; i += 12) assert.equal(r.post(batch(i)).inserted, 12);
  assert.equal(r.post(batch(0)).inserted, 0);
  assert.equal(r.post(batch(1194)).inserted, 6);
  assert.equal(r.tabs.get('diagnostics').data.length, 1207);
});
test('concurrent requests are refused until the lock is released', () => {
  const r = receiver();
  r.setLocked(true);
  assert.equal(r.post(batch(0)).ok, false);
  assert.equal(r.tabs.size, 0);
  r.setLocked(false);
  assert.equal(r.post(batch(0)).inserted, 12);
  assert.equal(r.post({ kind: 'report', product_name: '=HYPERLINK("bad")' }).wrote, 1);
  assert.ok(r.tabs.get('reports').data[1].includes('\'=HYPERLINK("bad")'));
});
test('legacy dedup history is respected during migration', () => {
  const r = receiver();
  r.setLegacy({ batches: ['b-0'], rows: ['r-12'] });
  assert.equal(r.post(batch(0)).inserted, 0);
  assert.equal(r.post(batch(12)).inserted, 11);
});
