const { test } = require('node:test');
const assert = require('node:assert/strict');

test('live checks separate page reachability from identity and scoring', async () => {
  const { liveCheckOutcomes } = await import('../scripts/live-check-outcomes.mjs');
  const route = /\/ip\/(?:[^/]+\/)?(\d+)\/?$/;
  const product = { url: 'https://walmart.com/ip/12345678', finalUrl: 'https://www.walmart.com/ip/oats/12345678', status: 200 };
  assert.deepEqual(liveCheckOutcomes('product', { ...product, panel: { state: 'fail' } }, route), {
    transport: 'reachable', identity: 'matched', extraction: 'unverified', scoring: 'unscored',
    warnings: 'not-checked', sorting: 'not-checked', ok: false,
  });
  assert.equal(liveCheckOutcomes('product', { ...product, panel: { state: 'scored' } }, route).ok, true);
  assert.equal(liveCheckOutcomes('product', { ...product, finalUrl: product.finalUrl.replace('12345678', '92345678'), panel: { state: 'scored' } }, route).identity, 'mismatch');
  assert.equal(liveCheckOutcomes('product', { ...product, challenge: true }, route).transport, 'blocked');
  assert.equal(liveCheckOutcomes('product', { ...product, transportFailure: true }, route).transport, 'unavailable');

  const search = { url: 'https://www.walmart.com/search?q=oats', finalUrl: 'https://www.walmart.com/search/?q=oats', status: 200, badges: 20 };
  assert.equal(liveCheckOutcomes('search', search).ok, false, 'status badges do not count as scores');
  assert.equal(liveCheckOutcomes('search', { ...search, numericBadges: 1 }).ok, true);
  assert.equal(liveCheckOutcomes('search', { ...search, finalUrl: 'https://www.walmart.com/', numericBadges: 1 }).ok, false);
});
