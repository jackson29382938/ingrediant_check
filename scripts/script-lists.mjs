// Single source of truth for content_scripts[].js, the way scripts/content-matches.mjs is for .matches.
//
// The same ~35 scripts used to be listed by hand five times in manifest.json (two pairs of identical lists, one
// near-copy), and again in eight extension pages and the test fixtures. A script added to one list and forgotten in
// another surfaced as a TypeError on one page type only: the side panel shipped without product-ratings.js that way.
// Now the three lists below are the only place a content script is added or moved, and
//
//   node scripts/script-lists.mjs --write     puts them into every manifest.json content_scripts entry
//   npm run preflight                          fails when manifest.json differs from them
//   tests/page-dependencies.test.js            fails when a list lacks a module its scripts use
//
// Order matters: a script runs after the ones before it. The blocks keep the order the old lists had.

const COMPAT = ['src/browser-compat.js'];

// The scoring rules and the engine that reads them. _module.js must come first (it defines AIRmodule) and score.js last.
const RULES = [
  'src/engine/db/_module.js', 'src/engine/db/oils.js', 'src/engine/db/sugars.js', 'src/engine/db/additives.js',
  'src/engine/db/labels.js', 'src/engine/db/allergens.js', 'src/engine/db/ingestible.js',
];
const RULES_AMAZON = ['src/engine/db/ocr-text.js'];
const RULES_SHARED = ['src/engine/db/provenance.js'];
const AMAZON_DIAGNOSTICS = ['src/engine/db/diagnostics.js'];
const CATEGORIES = ['src/engine/categories.js', 'src/engine/db/prefs.js', 'src/engine/db/theme.js', 'src/engine/db/revision.js'];
const AMAZON_STORAGE = [
  'src/engine/db/score-cache.js', 'src/engine/db/product-cache.js', 'src/engine/db/shopping.js', 'src/engine/db/storefronts.js',
  'src/engine/db/sorted-results.js', 'src/engine/db/unit-price.js', 'src/engine/db/speed.js', 'src/engine/db/points.js',
];
const RETAILER_STORAGE = ['src/engine/db/speed.js', 'src/engine/db/points.js', 'src/engine/db/score-cache.js'];
const ENGINE = ['src/engine/db/product-ratings.js', 'src/engine/score.js'];
const SANITIZER = ['vendor/dompurify/purify.js'];
const PANEL = ['src/content/nav.js', 'src/content/panel.js'];

// Amazon product and search pages, and the cart (the cart page runs the whole set so single-page navigation from
// a cart to a product works without a reload).
export const AMAZON_PAGES = [
  ...COMPAT, ...RULES, ...RULES_AMAZON, ...RULES_SHARED, ...AMAZON_DIAGNOSTICS, ...CATEGORIES, ...AMAZON_STORAGE, ...ENGINE,
  'src/content/extract.js', ...SANITIZER, ...PANEL,
  'src/content/page.js', 'src/content/product.js', 'src/content/search.js', 'src/content/hover-card.js', 'src/content/sort.js',
  'src/content/main.js', 'src/content/badge-link.js', 'src/stores/registry.js', 'src/stores/cart.js', 'src/content/cart.js',
];

// Target, Walmart, Costco, Instacart and the Kroger-family banners, product pages, search and cart.
export const RETAILER_PAGES = [
  ...COMPAT, ...RULES, ...RULES_SHARED, ...CATEGORIES.slice(0, 3), 'src/engine/db/revision.js',
  ...RETAILER_STORAGE, ...ENGINE, ...SANITIZER, ...PANEL,
  'src/stores/target.js', 'src/stores/label-reader.js', 'src/stores/walmart.js', 'src/stores/costco.js', 'src/stores/grocery.js',
  'src/stores/grocery-pages.js', 'src/content/retailer.js', 'src/content/badge-link.js', 'src/stores/registry.js',
  'src/stores/cart.js', 'src/content/cart.js',
];

// Amazon.com order history (opt-in purchase history).
export const AMAZON_ORDERS = [
  ...COMPAT, ...RULES, ...RULES_AMAZON, ...RULES_SHARED, ...AMAZON_DIAGNOSTICS, ...CATEGORIES, ...AMAZON_STORAGE, ...ENGINE,
  'src/content/extract.js', 'src/stores/registry.js', 'src/stores/cart.js',
  'src/engine/db/purchase-history.js', 'src/engine/db/purchase-store.js', 'src/engine/db/order-overview.js', 'src/stores/amazon-orders.js', 'src/engine/db/history-scan.js',
  ...SANITIZER, ...PANEL, 'src/content/order-hover.js', 'src/content/orders.js',
];

// Which list a manifest entry runs, from what it matches.
export function listFor(entry) {
  const matches = entry.matches || [];
  const amazon = matches.some(m => /amazon\./.test(m));
  if (!amazon) return RETAILER_PAGES;
  return matches.some(m => /your-orders|order-history/.test(m)) ? AMAZON_ORDERS : AMAZON_PAGES;
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  const fs = await import('node:fs');
  const url = new URL('../manifest.json', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(url, 'utf8'));
  for (const entry of manifest.content_scripts) entry.js = [...listFor(entry)];
  fs.writeFileSync(url, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote the script lists into ${manifest.content_scripts.length} content_scripts entries`);
}
