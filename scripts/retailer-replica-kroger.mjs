// A Kroger-style results page for scripts/retailer-sort-harness.mjs (the other Kroger banners, Fry's, Ralphs, King
// Soopers, Smith's, Fred Meyer, QFC, Harris Teeter and Dillons, share this adapter). Not a capture of the live site.
//
// What it models: no next-page link and no page number in the address; more products load as the shopper scrolls to the
// bottom (the case the sorted list's scrolling strategy is for). Cards carry the data-testid the adapter looks for, and
// the price and unit price sit inside the card, outside the product link.
const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const KROGER_ITEMS = Array.from({ length: 24 }, (_, i) => {
  const per = [0.31, 0.22, 0.45, 0.18, 0.27, 0.36, 0.52, 0.15][i % 8] + Math.floor(i / 8) * 0.01;
  const oz = [18, 42, 12, 32, 24, 16, 10, 48][i % 8];
  return { id: String(1111000000001 + i), title: `Oat Breakfast Product ${i + 1}, ${oz} oz`, price: Math.round(per * oz * 100) / 100, unit: `$${per.toFixed(2)} / oz` };
});
const card = item => `<div data-testid="product-card" style="padding:12px;border:1px solid #e3e4e5;border-radius:8px"><a href="/p/${slug(item.title)}/${item.id}"><h3 style="font-size:15px;margin:0 0 6px">${esc(item.title)}</h3></a>`
  + `<div><strong>$${item.price.toFixed(2)}</strong> <span style="color:#555">(${esc(item.unit)})</span></div><button type="button">Add</button></div>`;

export function krogerPage(url) {
  const u = new URL(url);
  if (/^\/p\//.test(u.pathname)) return '<!doctype html><html><head><title>Product</title></head><body><main><h1>Product</h1><p>No nutrition panel on this replica page.</p></main></body></html>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kroger replica</title><style>body{margin:0;font-family:system-ui,sans-serif}header{background:#134a9c;color:#fff;padding:14px 24px}[data-testid="product-grid"]{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:16px 24px}</style></head>
<body><header><strong>Kroger</strong></header><main><h1 style="margin:12px 24px;font-size:20px">Results for “${esc(u.searchParams.get('query') || '')}”</h1><div data-testid="product-grid" id="grid">${KROGER_ITEMS.slice(0, 8).map(card).join('')}</div><div style="height:1400px"></div></main>
<script>
(function(){
  const items=${JSON.stringify(KROGER_ITEMS.map(card))}; let shown=8, busy=false;
  addEventListener('scroll',()=>{ if(busy||shown>=items.length) return; if(innerHeight+scrollY<document.documentElement.scrollHeight-40) return; busy=true;
    setTimeout(()=>{ document.getElementById('grid').insertAdjacentHTML('beforeend',items.slice(shown,shown+8).join('')); shown+=8; busy=false; },500); });
})();
</script></body></html>`;
}
