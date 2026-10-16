const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { receiver } = require('./receiver-harness.js');
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
  assert.equal(r.get({}).accounts, true, 'the health reply says account storage has a client id');
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

test('Google account tokens reject conflicting audiences and expired token metadata', () => {
  const payload = { _format: 'ingredient-check-settings', weights: {} };
  for (const info of [
    { aud: 'other-client', azp: 'client-1', sub: '1001' },
    { aud: 'client-1', azp: 'other-client', sub: '1001' },
    { aud: 'client-1', sub: '1001', expires_in: 0 },
    { aud: 'client-1', sub: '1001', expires_in: -1 },
    { aud: 'client-1', sub: '1001', expires_in: 'invalid' },
    { aud: 'client-1', sub: { malformed: true } },
  ]) {
    const token = 'a'.repeat(30);
    const r = receiver({ tokens: { [token]: info } });
    assert.equal(r.post({ kind: 'account', token, payload }).ok, false);
    assert.equal(r.tabs.has('accounts'), false, 'rejected tokens must not create account rows');
  }
  const token = 'b'.repeat(30);
  assert.equal(receiver({ tokens: { [token]: { aud: 'client-1', azp: 'client-1', sub: '1001', expires_in: '3600' } } })
    .post({ kind: 'account', token, payload }).ok, true);
});
test('deployment template uses the same public OAuth client as the extension', () => {
  const template = fs.readFileSync(require.resolve('../docs/apps-script.gs'), 'utf8');
  const client = template.match(/var OAUTH_CLIENT_ID = '([^']*)';/)[1];
  assert.equal(client, require('../src/engine/db/prefs.js').OAUTH_CLIENT_ID);
});

test('a sheet from before outcome/feedback keeps its rowIds and gains the new columns', () => {
  const r = receiver();
  const base = ['ts', 'version', 'store', 'asin', 'upc', 'brand', 'product_name', 'source', 'via', 'confidence', 'gate',
    'coverage', 'parsed', 'score', 'verdict', 'nova', 'base', 'cap', 'penalties', 'bonuses', 'flags', 'provenance',
    'weights', 'ingredients'];
  assert.equal(r.post(batch(0, 1)).inserted, 1);                  // creates the tab (new layout)
  const sheet = r.tabs.get('diagnostics');
  // Rebuild it as the old layout: rowId in column 25, nothing after it.
  sheet.data.length = 0;
  r.setLocked(true);
  sheet.data.push([...base, 'rowId'], [...base.map(() => 'x'), 'r-old']);
  r.setLocked(false);
  assert.equal(r.post(batch(0, 1)).inserted, 1);                  // r-0 is new here
  assert.equal(r.post({ kind: 'diagnostics', batchId: 'again', rows: [{ rowId: 'r-old', ingredients: 'x' }] }).inserted, 0);
  assert.deepEqual(sheet.data[0].slice(-3), ['outcome', 'feedback', 'rowId']);
  assert.equal(sheet.data[1].at(-1), 'r-old');
  assert.equal(sheet.data[1][24], '');
});
