// Single source of truth for content_scripts.matches.
// Preflight requires manifest.json to equal buildContentMatches().
export const AMAZON_HOSTS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.com.au', 'amazon.ie',
  'amazon.in', 'amazon.sg', 'amazon.ae', 'amazon.sa', 'amazon.de', 'amazon.fr',
  'amazon.es', 'amazon.it', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.com.be',
  'amazon.com.tr', 'amazon.com.mx', 'amazon.com.br', 'amazon.co.jp',
];

// Path shapes Chrome matches from the left, against path AND query string
// (GURL::PathForRequest). `/s` does not match `/s?k=oats` — that URL needs `/s?*`,
// because `?` is a literal and `*` is the only wildcard. The same hole is `/b?node=`.
// A locale prefix (`/-/en/s?k=`) needs `/*/s?*`. Slug PDPs need /*/dp/*; apex hosts
// need a second origin without the *. subdomain wildcard.
export const PATH_PATTERNS = [
  '/dp/*',
  '/*/dp/*',
  '/gp/product/*',
  '/*/gp/product/*',
  '/gp/aw/d/*',
  '/*/gp/aw/d/*',
  '/s',
  '/s?*',
  '/s/*',
  '/*/s',
  '/*/s?*',
  '/*/s/*',
  '/b',
  '/b?*',
  '/b/*',
  '/gp/browse*',
  '/stores',
  '/stores/*',
];

export function buildContentMatches(hosts = AMAZON_HOSTS, paths = PATH_PATTERNS) {
  const out = [];
  for (const host of hosts) {
    for (const path of paths) {
      out.push(`*://*.${host}${path}`);
      out.push(`*://${host}${path}`);
    }
  }
  return out;
}

// Enough of Chrome's URLPattern to catch a match list that misses real Amazon URLs.
// `*.host` does not cover the apex. `?` in the pattern is literal. `*` matches any
// run of characters, including the `?` that starts a query string.
function schemeMatches(patternScheme, scheme) {
  if (patternScheme === '*') return scheme === 'http' || scheme === 'https';
  return patternScheme === scheme;
}

function hostMatches(patternHost, hostname) {
  const host = String(hostname || '').toLowerCase();
  const pat = String(patternHost || '').toLowerCase();
  if (pat === '*') return true;
  if (pat.startsWith('*.')) {
    const rest = pat.slice(1);
    return host.length > rest.length && host.endsWith(rest);
  }
  return host === pat;
}

function globMatch(pattern, text) {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === text;
  if (!text.startsWith(parts[0])) return false;
  let index = parts[0].length;
  for (let i = 1; i < parts.length - 1; i++) {
    const found = text.indexOf(parts[i], index);
    if (found < 0) return false;
    index = found + parts[i].length;
  }
  const last = parts[parts.length - 1];
  if (last === '') return true;
  return text.endsWith(last) && text.length - last.length >= index;
}

function patternMatches(pattern, scheme, hostname, pathAndQuery) {
  const match = /^(?<scheme>\*|https?|file):\/\/(?<host>\*|\*\.[^/]+|[^/]+)(?<path>\/.*)$/.exec(pattern);
  if (!match) return false;
  if (!schemeMatches(match.groups.scheme, scheme)) return false;
  if (!hostMatches(match.groups.host, hostname)) return false;
  return globMatch(match.groups.path, pathAndQuery);
}

export function contentScriptWouldRun(urlString, patterns = buildContentMatches()) {
  let url;
  try { url = new URL(urlString); } catch { return false; }
  const scheme = url.protocol.replace(/:$/, '');
  return patterns.some(pattern => patternMatches(pattern, scheme, url.hostname, url.pathname + url.search));
}
