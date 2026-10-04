// OAuth helpers. The access token is used for one account request and never persisted. Only the
// signed-in profile (email, name, picture) is kept, on this computer, to show who is signed in.
(function (root) {
  function redirectToken(raw, expectedRedirect, state) {
    let url, expected;
    try { url = new URL(raw); expected = new URL(expectedRedirect); }
    catch (e) { throw new Error('invalid-redirect'); }
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.search !== expected.search || url.username || url.password) {
      throw new Error('invalid-redirect');
    }
    const got = new URLSearchParams(url.hash.slice(1));
    for (const name of ['state', 'access_token', 'token_type', 'error', 'expires_in']) {
      if (got.getAll(name).length > 1) throw new Error('invalid-redirect');
    }
    if (got.get('state') !== state) throw new Error('invalid-redirect');
    if (got.get('error')) throw new Error(got.get('error') === 'access_denied' ? 'cancelled' : 'no-token');
    if (got.has('expires_in') && (!/^\d+$/.test(got.get('expires_in')) || Number(got.get('expires_in')) <= 0)) {
      throw new Error('no-token');
    }
    const value = got.get('access_token');
    if (!value || !/^[\w.~+/-]{20,4096}={0,2}$/.test(value)
      || (got.get('token_type') || '').toLowerCase() !== 'bearer') throw new Error('no-token');
    return value;
  }
  // openid, email and profile are Google's basic sign-in scopes: who you are, nothing in your account.
  const SCOPE = 'openid email profile';
  const PROFILE_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

  // `silent`: reuse the Google session without showing a window (prompt=none). Rejects when Google
  // needs the reader to act, and the caller then asks again with a window.
  function token(api, clientId, { silent = false } = {}) {
    return new Promise((resolve, reject) => {
      const state = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
      const redirect = api.identity.getRedirectURL();
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'token', scope: SCOPE,
        redirect_uri: redirect, prompt: silent ? 'none' : 'select_account', state });
      api.identity.launchWebAuthFlow({ url: url.href, interactive: !silent }, returned => {
        const error = api.runtime.lastError;
        if (error) {
          reject(new Error(/cancel|closed|did not approve|denied/i.test(error.message || '') ? 'cancelled' : 'auth-failed'));
          return;
        }
        if (!returned) { reject(new Error('cancelled')); return; }
        try { resolve(redirectToken(returned, redirect, state)); } catch (e) { reject(e); }
      });
    });
  }
  // What Google returns about the signed-in account, reduced to what is shown and bounded: an email,
  // a name, and a picture only from Google's own image hosts. null when there is no usable email.
  // eslint-disable-next-line no-control-regex
  const plain = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
  function cleanProfile(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const email = plain(src.email, 254);
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return null;
    let picture = '';
    try {
      const u = new URL(String(src.picture || ''));
      if (u.protocol === 'https:' && !u.username && !u.password && /(^|\.)googleusercontent\.com$/i.test(u.hostname)) picture = u.href.slice(0, 500);
    } catch (e) { /* no usable picture */ }
    return { email, name: plain(src.name, 100), picture };
  }
  async function profile(accessToken, fetchImpl) {
    const res = await (fetchImpl || fetch)(PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('profile-failed');
    const clean = cleanProfile(await res.json());
    if (!clean) throw new Error('profile-failed');
    return clean;
  }

  root.AIR = root.AIR || {};
  root.AIR.googleAuth = { redirectToken, token, SCOPE, cleanProfile, profile };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.googleAuth;
})(typeof globalThis !== 'undefined' ? globalThis : self);
