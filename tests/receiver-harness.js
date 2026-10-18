// The deployed Apps Script (docs/apps-script.gs) run in a sandbox with in-memory sheets, a lock and a
// fake Google tokeninfo, shared by the receiver tests and the end-to-end settings-saving tests.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// productsOpen: the PRODUCTS_OPEN script property. The product tests below model an opened receiver.
function receiver({ clientId = 'client-1', tokens = {}, productsOpen = true, propertyClientId = null } = {}) {
  const tabs = new Map();
  const order = [];
  let locked = false, failFlush = false, legacy = '{}';
  function newSheet() {
    const data = [];
    let maxColumns = 26;
    const sheet = { data, getLastRow: () => data.length,
      getMaxColumns: () => maxColumns,
      insertColumnsAfter(column, count) { assert.equal(column, maxColumns); maxColumns += count; },
      getLastColumn: () => Math.max(0, ...data.map(r => r.length)),
      appendRow(row) { assert.equal(locked, true, 'all appends must hold the shared lock'); data.push([...row]); },
      setFrozenRows() {},
      deleteRow(row) { assert.equal(locked, true); data.splice(row - 1, 1); },
      deleteRows(row, count) { assert.equal(locked, true); data.splice(row - 1, count); },
      getRangeList: a1s => ({ getRanges: () => a1s.map(a1 => {
        const [, r] = a1.match(/^A(\d+):G\d+$/);
        return sheet.getRange(Number(r), 1, 1, 7);
      }) }),
      getRange(r, c, height = 1, width = 1) {
        assert.ok(c + width - 1 <= maxColumns, 'range exceeds sheet column grid');
        const values = () => Array.from({ length: height }, (_, i) =>
          Array.from({ length: width }, (_, j) => data[r - 1 + i]?.[c - 1 + j] ?? ''));
        return {
          getValues: values,
          getDisplayValues: () => values().map(row => row.map(String)),
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
    return sheet;
  }
  const c = vm.createContext({
    LockService: { getScriptLock: () => ({
      tryLock() { if (locked) return false; locked = true; return true; },
      releaseLock() { locked = false; },
    }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: name => tabs.get(name),
      getSheets: () => order.map(n => tabs.get(n)),
      insertSheet(name) { const sheet = newSheet(); tabs.set(name, sheet); order.push(name); return sheet; },
    }), flush() { if (failFlush) { failFlush = false; throw new Error('lost acknowledgement'); } } },
    // Google's tokeninfo: `tokens` maps an access token to what Google would say about it.
    UrlFetchApp: { fetch(url) {
      const info = tokens[decodeURIComponent(url.split('access_token=')[1])];
      return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || {}) };
    } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_alg, text) => [...require('node:crypto').createHash('sha256').update(text).digest()].map(b => (b << 24) >> 24) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => (key === 'PRODUCTS_OPEN' ? (productsOpen ? 'true' : null) : key === 'OAUTH_CLIENT_ID' ? propertyClientId : legacy),
      deleteProperty(key) { if (key === 'PRODUCTS_OPEN') productsOpen = false; },
      setProperty() { throw new Error('dedup must not depend on property writes'); } }) },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../docs/apps-script.gs'), 'utf8').replace(
    /var OAUTH_CLIENT_ID = '[^']*';/, `var OAUTH_CLIENT_ID = ${JSON.stringify(clientId)};`), c);
  return { context: c, tabs, order, post: body => c.doPost({ postData: { contents: JSON.stringify(body) } }),
    get: parameter => c.doGet({ parameter }),
    sheet: name => { const sh = newSheet(); tabs.set(name, sh); order.push(name); return sh; },
    failNext: () => { failFlush = true; }, setLocked: v => { locked = v; },
    setLegacy: v => { legacy = JSON.stringify(v); } };
}

module.exports = { receiver };
