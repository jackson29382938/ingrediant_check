function productId(url, route) {
  return url.pathname.match(route)?.[1] || '';
}

export function liveCheckOutcomes(kind, entry, route) {
  const transport = entry.transportFailure ? 'unavailable' : entry.challenge || [403, 429].includes(entry.status) ? 'blocked'
    : entry.status >= 200 && entry.status < 300 && !entry.error ? 'reachable' : 'unavailable';
  const product = kind === 'product';
  let identity = 'not-checked';
  let extraction = 'not-checked';
  let scoring = 'not-checked';
  if (transport === 'reachable') {
    const requested = new URL(entry.url);
    const final = new URL(entry.finalUrl);
    const sameHost = final.protocol === 'https:' && final.hostname.replace(/^www\./, '') === requested.hostname.replace(/^www\./, '');
    const id = product && productId(requested, route);
    identity = !product ? 'not-applicable' : (sameHost && id && productId(final, route) === id ? 'matched' : 'mismatch');
    const searchPath = url => url.pathname.replace(/\/$/, '');
    if (product ? identity === 'matched' : sameHost && searchPath(requested) === searchPath(final)) {
      const scored = product ? entry.panel?.state === 'scored' : entry.numericBadges > 0;
      extraction = scored ? 'accepted' : 'unverified';
      scoring = scored ? 'scored' : 'unscored';
    } else {
      scoring = 'wrong-page';
    }
  }
  return { transport, identity, extraction, scoring, warnings: 'not-checked', sorting: 'not-checked', ok: scoring === 'scored' };
}
