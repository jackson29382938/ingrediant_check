// OAuth helpers. The access token is used for one account request and never persisted.
(function (root) {
  function redirectToken(raw, expectedRedirect, state) {
    let url, expected;
    try { url = new URL(raw); expected = new URL(expectedRedirect); }
    catch (e) { throw new Error('invalid-redirect'); }
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password) {
      throw new Error('invalid-redirect');
    }
    const got = new URLSearchParams(url.hash.slice(1));
    if (got.get('state') !== state) throw new Error('invalid-redirect');
    if (got.get('error')) throw new Error(got.get('error') === 'access_denied' ? 'cancelled' : 'no-token');
    const value = got.get('access_token');
    if (!value || !/^[\w.~+/-]{20,4096}={0,2}$/.test(value)
      || (got.get('token_type') || '').toLowerCase() !== 'bearer') throw new Error('no-token');
    return value;
  }
  function token(api, clientId) {
    return new Promise((resolve, reject) => {
      const state = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
      const redirect = api.identity.getRedirectURL();
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'token', scope: 'openid',
        redirect_uri: redirect, prompt: 'select_account', state });
      api.identity.launchWebAuthFlow({ url: url.href, interactive: true }, returned => {
        if (api.runtime.lastError || !returned) { reject(new Error('cancelled')); return; }
        try { resolve(redirectToken(returned, redirect, state)); } catch (e) { reject(e); }
      });
    });
  }
  root.AIR = root.AIR || {};
  root.AIR.googleAuth = { redirectToken, token };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.googleAuth;
})(typeof globalThis !== 'undefined' ? globalThis : self);
