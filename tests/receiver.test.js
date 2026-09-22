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
const rating = over => ({ store: 'amazon.com', asin: 'B00TESTOAT', score: 80, verdict: 'Good', prefs: 'p1a2b3c',
  source: 'search-tile', nova: 1, name: 'Oats', scanned_at: '2026-09-20T00:00:00.000Z', ...over });
test('ratings: older scans never overwrite newer rows; newer scans replace and reset pulls', () => {
  const r = receiver();
  assert.equal(r.post({ kind: 'ratings', upserts: [rating(), rating({ source: 'manual-paste', asin: 'B00TESTOA2' })] }).upserted, 1);
  const tab = r.tabs.get('ratings_cache');
  assert.deepEqual(tab.data[0], ['key', 'store', 'asin', 'score', 'verdict', 'prefs', 'source', 'nova', 'name', 'scanned_at', 'pulls']);
  assert.equal(tab.data[1][0], "'amazon.com:B00TESTOAT:p1a2b3c");
  assert.equal(r.post({ kind: 'ratings', upserts: [rating({ score: 10, scanned_at: '2026-09-19T00:00:00Z' })] }).upserted, 0);
  assert.equal(r.post({ kind: 'ratings', pulls: [{ key: 'amazon.com:B00TESTOAT:p1a2b3c', scanned_at: '2026-09-20T00:00:00Z', n: 3 }] }).pulled, 1);
  assert.equal(tab.data[1][10], 3);
  assert.equal(r.post({ kind: 'ratings', upserts: [rating({ score: 60, scanned_at: '2026-09-21T00:00:00Z' })] }).upserted, 1);
  assert.equal(tab.data.length, 2);
  assert.equal(tab.data[1][3], 60);
  assert.equal(tab.data[1][10], 0);
});
test('ratings: a pull counts only against the scan the reader saw', () => {
  const r = receiver();
  r.post({ kind: 'ratings', upserts: [rating()] });
  const res = r.post({ kind: 'ratings', pulls: [{ key: 'amazon.com:B00TESTOAT:p1a2b3c', scanned_at: '2026-09-01T00:00:00Z' }] });
  assert.equal(res.pulled, 0);
  assert.equal(res.tab, 'ratings_cache');
  assert.equal(r.tabs.get('ratings_cache').data[1][10], 0);
  assert.equal(r.post({ kind: 'ratings', upserts: Array(301).fill(rating()) }).ok, false);
});
