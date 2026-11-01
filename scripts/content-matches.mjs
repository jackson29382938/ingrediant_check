// Single source of truth for content_scripts.matches.
// Preflight requires manifest.json to equal buildContentMatches().
export const AMAZON_HOSTS = [
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.com.au', 'amazon.ie',
  'amazon.in', 'amazon.sg', 'amazon.ae', 'amazon.sa', 'amazon.de', 'amazon.fr',
  'amazon.es', 'amazon.it', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.com.be',
  'amazon.com.tr', 'amazon.com.mx', 'amazon.com.br', 'amazon.co.jp',
];

// Path shapes Chrome matches from the left. The path includes the query string,
// so '/s' alone never matches '/s?k=…' — the '?*' forms cover real search URLs. Slug PDPs need /*/dp/*.
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

// The cart pages, which have their own content_scripts entry (cart ratings): the cart itself, and the page Amazon
// opens right after Add to Cart (/cart/smart-wagon). Each host in both forms, bare then www.
export const CART_PATH_PATTERNS = [
  '/cart', '/cart/', '/cart?*', '/gp/cart/view.html', '/gp/cart/view.html?*', '/cart/view.html', '/cart/view.html?*',
  '/cart/smart-wagon', '/cart/smart-wagon?*',
];
export function buildCartMatches(hosts = AMAZON_HOSTS, paths = CART_PATH_PATTERNS) {
  return hosts.flatMap(host => [host, `www.${host}`].flatMap(h => paths.map(path => `https://${h}${path}`)));
}

// `https://*.amazon.com/...` matches amazon.com itself as well as every subdomain (probed in Chromium: the apex
// and www both inject, evil-amazon.com does not), so one pattern per path covers what two used to. Amazon is
// served over https only; an http address redirects before a page worth scoring exists.
export function buildContentMatches(hosts = AMAZON_HOSTS, paths = PATH_PATTERNS) {
  return hosts.flatMap(host => paths.map(path => `https://*.${host}${path}`));
}

// `node scripts/content-matches.mjs --write` puts the generated list into every Amazon
// content_scripts entry of manifest.json, so the several hundred patterns are never edited by hand.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  const fs = await import('node:fs');
  const url = new URL('../manifest.json', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(url, 'utf8'));
  let entries = 0;
  for (const cs of manifest.content_scripts || []) {
    if (!(cs.matches || []).some(m => /amazon\./.test(m)) || cs.js.includes('src/content/orders.js')) continue;
    // The cart entry has no product paths; every other Amazon entry gets the product and search paths.
    cs.matches = (cs.matches || []).some(m => /\/dp\//.test(m)) ? buildContentMatches() : buildCartMatches();
    entries++;
  }
  fs.writeFileSync(url, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote the Amazon matches into ${entries} content_scripts entries`);
}
