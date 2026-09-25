// Store wishlist: turns a store name and an optional website into an email draft.
//
// Nothing here sends anything. The result is a mailto: link the settings page shows beside an exact
// preview; the reader's own email app opens the draft, and nothing leaves until they press Send.
// There is no backend, no form service and no tracking. The draft carries the two fields below and
// nothing else: no browsing history, no product, no account, no settings.
//
// The website is cut down to its origin. Someone who pastes the product page they were looking at
// would otherwise put that product, and the fact they were looking at it, into the email.

(function (root) {
  const REQUEST_EMAIL = 'jackson29382938@gmail.com';
  const NAME_MIN = 2;
  const NAME_MAX = 60;
  const URL_MAX = 200;

  // Letters and digits in any script, spaces, and the punctuation store names use ("Trader Joe's",
  // "H-E-B", "Marks & Spencer", "Sprouts Farmers Market (US)"). No "@", "/", ":" or "<": an email
  // address or a web address belongs in the other box, and angle brackets have no business in a name.
  const NAME_CHARS = /^[\p{L}\p{M}\p{N} &'’.,!+()-]+$/u;
  const HAS_LETTER = /\p{L}/u;
  const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

  function cleanName(raw) {
    const value = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!value) return { ok: false, error: 'name-empty' };
    if (value.length < NAME_MIN) return { ok: false, error: 'name-short' };
    if (value.length > NAME_MAX) return { ok: false, error: 'name-long' };
    if (/[@/:]/.test(value)) return { ok: false, error: 'name-looks-like-address' };
    if (!NAME_CHARS.test(value) || !HAS_LETTER.test(value)) return { ok: false, error: 'name-chars' };
    return { ok: true, value };
  }

  // -> { ok, value: origin or '', trimmed: whether a path, query or fragment was dropped }
  function cleanUrl(raw) {
    const typed = String(raw == null ? '' : raw).trim();
    if (!typed) return { ok: true, value: '', trimmed: false };
    if (typed.length > URL_MAX) return { ok: false, error: 'url-long' };
    if (/\s/.test(typed)) return { ok: false, error: 'url-invalid' };
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : 'https://' + typed;
    let u;
    try { u = new URL(withScheme); } catch { return { ok: false, error: 'url-invalid' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'url-scheme' };
    if (u.username || u.password) return { ok: false, error: 'url-credentials' };
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || IPV4.test(host) || host.startsWith('[')) {
      return { ok: false, error: 'url-not-public' };
    }
    // A public site has a registrable name: at least one dot and a top-level label of letters
    // (or an IDN "xn--" label).
    const labels = host.split('.');
    const tld = labels[labels.length - 1];
    if (labels.length < 2 || labels.some(l => !l) || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) {
      return { ok: false, error: 'url-invalid' };
    }
    const trimmed = (u.pathname && u.pathname !== '/') || !!u.search || !!u.hash;
    return { ok: true, value: u.origin, trimmed };
  }

  const MESSAGES = {
    'name-empty': 'Enter the store’s name.',
    'name-short': `Use at least ${NAME_MIN} characters for the store’s name.`,
    'name-long': `Keep the store’s name to ${NAME_MAX} characters.`,
    'name-looks-like-address': 'Put a web address in the website box, not the name box.',
    'name-chars': 'Use letters, numbers, spaces and simple punctuation (& \' . , - ! + ( )) in the name.',
    'url-long': `Keep the website to ${URL_MAX} characters.`,
    'url-invalid': 'That does not look like a website address, for example https://www.example.com.',
    'url-scheme': 'Use a website address starting with https:// or http://.',
    'url-credentials': 'Leave out any user name or password in the address.',
    'url-not-public': 'Use the store’s public website, not a local or numeric address.',
    'already-supported': 'Ingredient Check already works on this store.',
  };

  function subjectFor(name) { return `Store request: ${name}`; }

  function bodyFor(name, origin) {
    return [
      'Please add support for this store in Ingredient Check.',
      '',
      `Store: ${name}`,
      `Website: ${origin || '(not given)'}`,
      '',
      'Written by the Ingredient Check store wishlist. It contains only the store above.',
    ].join('\r\n');   // RFC 6068: line breaks in a mailto body are CRLF
  }

  // encodeURIComponent, not URLSearchParams: mail clients read "+" literally, so a space must be %20.
  function mailtoFor(subject, body) {
    return `mailto:${REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // -> { ok, errors: { name?, url? }, notes: [...], to, subject, body, mailto }
  function buildRequest(input, stores) {
    const name = cleanName(input && input.name);
    const url = cleanUrl(input && input.url);
    const errors = {};
    if (!name.ok) errors.name = name.error;
    if (!url.ok) errors.url = url.error;
    const notes = [];
    if (url.ok && url.trimmed) notes.push('url-trimmed');
    if (name.ok && url.ok && stores) {
      const host = url.value ? new URL(url.value).hostname : '';
      const known = (host && stores.storeForHost(host)) || stores.storeForName(name.value);
      if (known && known.status === 'supported') errors.name = 'already-supported';
      else if (known) notes.push('already-planned');
    }
    if (Object.keys(errors).length) return { ok: false, errors, notes };
    const subject = subjectFor(name.value);
    const body = bodyFor(name.value, url.value);
    return { ok: true, errors, notes, to: REQUEST_EMAIL, subject, body, mailto: mailtoFor(subject, body) };
  }

  const api = { REQUEST_EMAIL, NAME_MIN, NAME_MAX, URL_MAX, MESSAGES, cleanName, cleanUrl, buildRequest, mailtoFor };
  root.AIR = root.AIR || {};
  root.AIR.storeRequest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
