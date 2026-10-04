'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {redirectToken,token}=require('../src/options/google-auth.js');
const redirect='https://example.chromiumapp.org/';
const access='a'.repeat(30);
test('Google redirect must match the extension, random state, and bearer token shape',()=>{
  const good=`${redirect}#state=nonce&access_token=${access}&token_type=Bearer`;
  assert.equal(redirectToken(good,redirect,'nonce'),access);
  for(const raw of [good.replace('example.chromiumapp.org','evil.example'),good.replace('state=nonce','state=wrong'),
    good.replace('token_type=Bearer','token_type=invalid'),good.replace('/#','/other#')]) {
    assert.throws(()=>redirectToken(raw,redirect,'nonce'));
  }
  assert.throws(()=>redirectToken(`${redirect}#state=nonce&error=access_denied`,redirect,'nonce'),/cancelled/);
});
test('Google auth flow generates a fresh state and returns only an ephemeral token',async()=>{
  const requests=[];
  const api={runtime:{},identity:{getRedirectURL:()=>redirect,launchWebAuthFlow:({url},cb)=>{
    const u=new URL(url);requests.push(u);
    cb(`${redirect}#state=${u.searchParams.get('state')}&access_token=${access}&token_type=Bearer`);
  }}};
  assert.equal(await token(api,'public.apps.googleusercontent.com'),access);
  await token(api,'public.apps.googleusercontent.com');
  assert.notEqual(requests[0].searchParams.get('state'),requests[1].searchParams.get('state'));
  assert.equal(requests[0].searchParams.get('scope'),'openid email profile');
  assert.equal(requests[0].searchParams.get('prompt'),'select_account');
  api.runtime.lastError={message:'cancelled'};
  await assert.rejects(token(api,'public.apps.googleusercontent.com'),/cancelled/);
});

test('Google configuration errors are not reported as user cancellation', async () => {
  const api = { runtime: { lastError: { message: 'Authorization page could not be loaded.' } },
    identity: { getRedirectURL: () => redirect, launchWebAuthFlow(_opts, cb) { cb(); } } };
  await assert.rejects(token(api, 'public.apps.googleusercontent.com'), /auth-failed/);
});


test('Google redirect rejects duplicate OAuth fields, unexpected query parameters and expired tokens', () => {
  const good = `${redirect}#state=nonce&access_token=${access}&token_type=Bearer`;
  for (const suffix of ['&state=other', `&access_token=${access}`, '&token_type=Bearer', '&error=a&error=b', '&expires_in=10&expires_in=20']) {
    assert.throws(() => redirectToken(good + suffix, redirect, 'nonce'), /invalid-redirect/);
  }
  assert.throws(() => redirectToken(good.replace('/#', '/?unexpected=1#'), redirect, 'nonce'), /invalid-redirect/);
  for (const expiry of ['0', '-10', 'Infinity', '1.5', '']) {
    assert.throws(() => redirectToken(good + `&expires_in=${expiry}`, redirect, 'nonce'), /no-token/);
  }
  assert.equal(redirectToken(good + '&expires_in=3600', redirect, 'nonce'), access);
});

test('a silent token asks Google for no window and never shows a picker', async () => {
  const seen = [];
  const api = { runtime: {}, identity: { getRedirectURL: () => redirect, launchWebAuthFlow: ({ url, interactive }, cb) => {
    const u = new URL(url); seen.push({ interactive, prompt: u.searchParams.get('prompt') });
    cb(`${redirect}#state=${u.searchParams.get('state')}&access_token=${access}&token_type=Bearer`);
  } } };
  await token(api, 'public.apps.googleusercontent.com', { silent: true });
  assert.deepEqual(seen, [{ interactive: false, prompt: 'none' }]);
});

test('the Google profile is reduced to an email, a name and a picture from Google image hosts', async () => {
  const { cleanProfile, profile } = require('../src/options/google-auth.js');
  assert.deepEqual(cleanProfile({ email: 'a@example.com', name: ' Ann \u0007', picture: 'https://lh3.googleusercontent.com/a/x=s96-c', sub: '1', locale: 'en' }),
    { email: 'a@example.com', name: 'Ann', picture: 'https://lh3.googleusercontent.com/a/x=s96-c' });
  assert.equal(cleanProfile({ email: 'a@example.com', picture: 'https://evil.example/x.png' }).picture, '', 'not a Google image host');
  assert.equal(cleanProfile({ email: 'a@example.com', picture: 'http://lh3.googleusercontent.com/x' }).picture, '', 'not https');
  assert.equal(cleanProfile({ email: 'not an email' }), null);
  assert.equal(cleanProfile(null), null);
  let call;
  const ok = await profile(access, async (url, opts) => { call = { url, opts }; return { ok: true, json: async () => ({ email: 'a@example.com' }) }; });
  assert.equal(ok.email, 'a@example.com');
  assert.equal(call.opts.headers.Authorization, `Bearer ${access}`);
  assert.equal(call.opts.credentials, 'omit');
  await assert.rejects(profile(access, async () => ({ ok: false })), /profile-failed/);
  await assert.rejects(profile(access, async () => ({ ok: true, json: async () => ({}) })), /profile-failed/);
});
