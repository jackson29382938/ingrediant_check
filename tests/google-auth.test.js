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
  assert.equal(requests[0].searchParams.get('scope'),'openid');
  api.runtime.lastError={message:'cancelled'};
  await assert.rejects(token(api,'public.apps.googleusercontent.com'),/cancelled/);
});

test('Google configuration errors are not reported as user cancellation', async () => {
  const api = { runtime: { lastError: { message: 'Authorization page could not be loaded.' } },
    identity: { getRedirectURL: () => redirect, launchWebAuthFlow(_opts, cb) { cb(); } } };
  await assert.rejects(token(api, 'public.apps.googleusercontent.com'), /auth-failed/);
});
