// Single source of truth for content_scripts.matches.
// Preflight requires manifest.json to equal buildContentMatches().
export const AMAZON_HOSTS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.com.au', 'amazon.ie',
  'amazon.in', 'amazon.sg', 'amazon.ae', 'amazon.sa', 'amazon.de', 'amazon.fr',
  'amazon.es', 'amazon.it', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.com.be',
  'amazon.com.tr', 'amazon.com.mx', 'amazon.com.br', 'amazon.co.jp',
];

// Path shapes Chrome matches from the left. The path includes the query string,
// so '/s' alone never matches '/s?k=…' — the '?*' forms cover real search URLs. Slug PDPs need /*/dp/*; apex hosts need
// a second origin without the *. subdomain wildcard.
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
  '/b',
  '/b?*',
  '/b/*',
  '/gp/browse*',
  '/stores',
  '/stores?*',
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

// `node scripts/content-matches.mjs --write` puts the generated list into every Amazon
// content_scripts entry of manifest.json, so the several hundred patterns are never edited by hand.
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--write')) {
  const fs = await import('node:fs');
  const url = new URL('../manifest.json', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(url, 'utf8'));
  const matches = buildContentMatches();
  let entries = 0;
  for (const cs of manifest.content_scripts || []) {
    if ((cs.matches || []).some(m => /amazon\./.test(m))) { cs.matches = matches; entries++; }
  }
  fs.writeFileSync(url, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${matches.length} matches into ${entries} Amazon content_scripts entr${entries === 1 ? 'y' : 'ies'}`);
}
