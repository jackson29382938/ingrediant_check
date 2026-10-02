const { test } = require('node:test');
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
    const sheet = { data, getLastRow: () => data.length,
      getLastColumn: () => Math.max(0, ...data.map(r => r.length)),
      appendRow(row) { assert.equal(locked, true, 'all appends must hold the shared lock'); data.push([...row]); },
      setFrozenRows() {},
      deleteRow(row) { assert.equal(locked, true); data.splice(row - 1, 1); },
      getRangeList: a1s => ({ getRanges: () => a1s.map(a1 => {
        const [, r] = a1.match(/^A(\d+):G\d+$/);
        return sheet.getRange(Number(r), 1, 1, 7);
      }) }),
      getRange(r, c, height = 1, width = 1) {
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
    "var OAUTH_CLIENT_ID = '';", `var OAUTH_CLIENT_ID = ${JSON.stringify(clientId)};`), c);
  return { context: c, tabs, order, post: body => c.doPost({ postData: { contents: JSON.stringify(body) } }),
    get: parameter => c.doGet({ parameter }),
    sheet: name => { const sh = newSheet(); tabs.set(name, sh); order.push(name); return sh; },
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
const product = over => ({ store: 'amazon.com', asin: 'B00TESTOAT', status: 'ok',
  data: { title: 'Oats', text: 'Organic rolled oats', via: 'nic-ingredients-content' },
  scanned_at: '2026-09-20T00:00:00.000Z', ...over });
const KEY = 'amazon.com:B00TESTOAT';
test('products: older scans never overwrite newer rows; newer scans replace and reset pulls', () => {
  const r = receiver();
  assert.equal(r.post({ kind: 'products', upserts: [product(), product({ asin: 'bad' }), product({ status: 'great', asin: 'B00TESTOA2' })] }).upserted, 1);
  const tab = r.tabs.get('products');
  assert.deepEqual(tab.data[0], ['key', 'store', 'asin', 'status', 'data', 'scanned_at', 'pulls']);
  assert.equal(tab.data[1][0], "'" + KEY);
  assert.equal(JSON.parse(tab.data[1][4].replace(/^'/, '')).text, 'Organic rolled oats');
  assert.equal(r.post({ kind: 'products', upserts: [product({ data: { text: 'Sugar' }, scanned_at: '2026-09-19T00:00:00Z' })] }).upserted, 0);
  assert.equal(r.post({ kind: 'products', pulls: [{ key: KEY, scanned_at: '2026-09-20T00:00:00Z', n: 3 }] }).pulled, 1);
  assert.equal(tab.data[1][6], 3);
  assert.equal(r.post({ kind: 'products', upserts: [product({ data: { text: 'Oats, salt' }, scanned_at: '2026-09-21T00:00:00Z' })] }).upserted, 1);
  assert.equal(tab.data.length, 2);
  assert.equal(JSON.parse(tab.data[1][4].replace(/^'/, '')).text, 'Oats, salt');
  assert.equal(tab.data[1][6], 0);
});
test('products: a pull counts only against the scan the reader saw, and batches are bounded', () => {
  const r = receiver();
  r.post({ kind: 'products', upserts: [product()] });
  const res = r.post({ kind: 'products', pulls: [{ key: KEY, scanned_at: '2026-09-01T00:00:00Z' }] });
  assert.equal(res.pulled, 0);
  assert.equal(res.tab, 'products');
  assert.equal(r.tabs.get('products').data[1][6], 0);
  assert.equal(r.post({ kind: 'products', upserts: Array(301).fill(product()) }).ok, false);
  assert.equal(r.post({ kind: 'products', upserts: [product({ data: { text: 'x'.repeat(13000) } })] }).upserted, 0);
});
test('lookup returns only the rows asked for, parsed, without taking the write lock', () => {
  const r = receiver();
  assert.deepEqual(r.post({ kind: 'lookup', keys: [KEY] }).rows, []);
  r.post({ kind: 'products', upserts: [product(), product({ asin: 'B00TESTOA2' })] });
  r.setLocked(true);   // a batch write in progress must not block reads
  const res = r.post({ kind: 'lookup', keys: [KEY, 'amazon.com:B000MISSING', KEY] });
  r.setLocked(false);
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].asin, 'B00TESTOAT');
  assert.equal(res.rows[0].data.text, 'Organic rolled oats');
  assert.equal(res.rows[0].scanned_at, '2026-09-20T00:00:00.000Z');
  assert.equal(r.post({ kind: 'lookup', keys: Array(101).fill(KEY) }).ok, false);
});
test('products are closed until the owner opens them: nothing stored, nothing served', () => {
  const r = receiver({ productsOpen: false });
  const res = r.post({ kind: 'products', upserts: [product()] });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'products closed');
  assert.equal(r.tabs.has('products'), false);
  // Rows written while it was open are not served once it is closed again.
  const open = receiver();
  open.post({ kind: 'products', upserts: [product()] });
  const lookup = receiver({ productsOpen: false });
  lookup.tabs.set('products', open.tabs.get('products'));
  const got = lookup.post({ kind: 'lookup', keys: [KEY] });
  assert.equal(got.ok, true);
  assert.equal(got.closed, true);
  assert.deepEqual(got.rows, []);
});
test('products: a scan stamped ahead of the receiver clock is stored at the receiver time', () => {
  const r = receiver();
  const ahead = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  assert.equal(r.post({ kind: 'products', upserts: [product({ scanned_at: ahead })] }).upserted, 1);
  const stored = Date.parse(r.tabs.get('products').data[1][5].replace(/^'/, ''));
  assert.ok(stored <= Date.now(), 'never later than now');
  assert.ok(stored < Date.parse(ahead));
});
test('GET ?kind=provenance serves the first tab and the producers tab as text', () => {
  const r = receiver();
  r.sheet('Sheet1').data.push(['asin', 'upc', 'certifications'], ['B000000001', 12345678, 'USDA Organic']);
  r.sheet('producers').data.push(['brand', 'certifications'], ['Acme', 'AGA']);
  const res = r.get({ kind: 'provenance' });
  assert.deepEqual(res.provenance, [['asin', 'upc', 'certifications'], ['B000000001', '12345678', 'USDA Organic']]);
  assert.deepEqual(res.producers, [['brand', 'certifications'], ['Acme', 'AGA']]);
  assert.equal(r.get({}).service, 'ingredient-check');
});
test('accounts: a verified token opens only its own row, keyed by a hash, never the email', () => {
  const tokens = {
    ['a'.repeat(30)]: { aud: 'client-1', sub: '1001', email: 'person@example.com' },
    ['b'.repeat(30)]: { aud: 'client-1', sub: '1002' },
    ['c'.repeat(30)]: { aud: 'someone-else', sub: '1001' },
  };
  const r = receiver({ tokens });
  const payload = { _format: 'ingredient-check-settings', weights: { sugar: 0.5 } };
  assert.equal(r.post({ kind: 'account', token: 'a'.repeat(30), payload }).tab, 'accounts');
  assert.equal(r.post({ kind: 'account', token: 'a'.repeat(30), payload: { ...payload, weights: { sugar: 0.7 } } }).ok, true);
  const tab = r.tabs.get('accounts');
  assert.equal(tab.data.length, 2, 'one row per account, replaced in place');
  assert.ok(!JSON.stringify(tab.data).includes('person@example.com'));
  assert.ok(!JSON.stringify(tab.data).includes('1001'));
  assert.equal(r.post({ kind: 'accountGet', token: 'a'.repeat(30) }).payload.weights.sugar, 0.7);
  assert.equal(r.post({ kind: 'accountGet', token: 'b'.repeat(30) }).payload, null);
  assert.equal(r.post({ kind: 'accountGet', token: 'c'.repeat(30) }).ok, false, 'a token for another app is refused');
  assert.equal(r.post({ kind: 'accountGet', token: 'd'.repeat(30) }).ok, false, 'an unknown token is refused');
  assert.equal(r.post({ kind: 'account', token: 'a'.repeat(30), payload: { weights: {} } }).ok, false);
  assert.equal(receiver({ clientId: '', tokens }).post({ kind: 'accountGet', token: 'a'.repeat(30) }).ok, false,
    'accounts stay off until a client id is configured');
});

test('each request logs one line for load measurement, with no payload in it', () => {
  const lines = [];
  const r = receiver();
  r.context.console = { log: line => lines.push(JSON.parse(line)) };
  r.post({ kind: 'products', upserts: [product()] });
  r.post({ kind: 'lookup', keys: [KEY, 'amazon.com:B000MISSING'] });
  r.setLocked(true);
  r.post(batch(0));
  r.setLocked(false);
  r.get({ kind: 'provenance' });
  assert.deepEqual(lines.map(l => [l.kind, l.items, l.ok, l.busy]),
    [['products', 1, true, false], ['lookup', 2, true, false], ['diagnostics', 12, false, true], ['get:provenance', 1, true, false]]);
  assert.ok(lines.every(l => Number.isFinite(l.ms) && l.ic === 'request'));
  assert.ok(!JSON.stringify(lines).includes('Organic rolled oats'), 'no product data in the log');
});

test('Google client can be configured by owner script property without accepting another app', () => {
  const token = 'a'.repeat(30);
  const r = receiver({clientId:'',propertyClientId:'registered-client',tokens:{[token]:{aud:'registered-client',sub:'1001'}}});
  assert.equal(r.post({kind:'account',token,payload:{_format:'ingredient-check-settings',weights:{}}}).ok,true);
  assert.equal(receiver({clientId:'',propertyClientId:'other-client',tokens:{[token]:{aud:'registered-client',sub:'1001'}}}).post({kind:'accountGet',token}).ok,false);
});

test('owner purge closes exchange and removes only the requested product', () => {
  const r = receiver();
  const sh = r.sheet('products');
  sh.data.push(['key'], ['amazon.pl:B00MCJ3180'], ['amazon.com:B00LOAW7U6'], ['amazon.pl:B00MCJ3180']);
  assert.equal(r.context.purgeHistoricalPolishReading(), 2);
  assert.equal(sh.data.length, 2);
  assert.equal(sh.data[1][0], 'amazon.com:B00LOAW7U6');
  assert.equal(r.post({kind:'lookup',keys:[]}).closed, true);
});
