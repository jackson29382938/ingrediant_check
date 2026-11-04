// Replica Walmart and Target pages for scripts/retailer-sort-harness.mjs. They are NOT captures of the live
// sites (both block automated browsers: Walmart shows "Robot or human?", Target answers HTTP 429). They are
// built from what earlier sessions recorded from the real pages, and every part that is a guess is named:
//
//   Walmart  recorded: data-testid="item-stack" result groups, role=group cards carrying data-item-id, an
//            overlay link with a screen-reader-only <h3>, a separate data-automation-id="product-title",
//            data-testid="unified-global-product-price-a11y-text", data-dca-card-id ad modules, results
//            wrapped in a <form> (docs/STORES.md, tests/walmart-audit.test.js).
//            guessed:  how an ad is labelled. Several styles are served at once on purpose (a visible
//            "Sponsored" label, Walmart's /sp/track click-through, an aria-label that ends in "Sponsored",
//            a placement attribute, a label-only banner, and an ad that arrives late) so the harness shows the
//            extension does not depend on any single one.
//   Target   recorded: ListingPageProductListing cards, the "assets" and "content" links, an h3 title and, on
//            an ad, aria-label="<title> Sponsored" (tests/pages/target-s-oats.html, captured 2026-09-25).
//            guessed:  price, unit price and rating markup (the saved capture had them removed).
//
// Both replicas behave like the real sites' single-page apps: the home page has a search box, submitting it
// changes the address with history.pushState and renders results after a short delay, with no page load.

const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const OATS = 'Whole grain rolled oats.';
const CEREAL = 'Whole grain oats, sugar, corn starch, honey, brown sugar syrup, salt, tripotassium phosphate, canola oil, natural almond flavor.';
const LOOPS = 'Sugar, wheat flour, corn flour, whole grain oat flour, soluble corn fiber, vegetable oil, red 40, yellow 6, blue 1, BHT for freshness.';

// ---------------------------------------------------------------- Walmart
// ad: how the advertisement is marked on the page, or absent for an organic result.
export const WALMART_ITEMS = [
  { id: '10314926', title: 'Great Value Old Fashioned Oats, 42 oz', price: 3.97, unit: '9.5 \u00a2/oz', stars: 4.7, reviews: 8123, ing: OATS },
  { id: '10315264', title: 'Quaker Old Fashioned Rolled Oats, 18 oz', price: 4.48, unit: '24.9 \u00a2/oz', stars: 4.8, reviews: 5210, ing: OATS },
  { id: '20000001', title: 'Premium Oat Clusters with Almonds, 14 oz', price: 6.48, unit: '46.3 \u00a2/oz', stars: 4.2, reviews: 310, ing: CEREAL, ad: 'label' },
  { id: '10450112', title: "Bob's Red Mill Organic Old Fashioned Rolled Oats, 32 oz", price: 7.98, unit: '24.9 \u00a2/oz', stars: 4.8, reviews: 2764, ing: 'Organic whole grain rolled oats.' },
  { id: '10450113', title: 'Marketside Organic Steel Cut Oats, 24 oz', price: 5.48, unit: '22.8 \u00a2/oz', stars: 4.5, reviews: 640, ing: 'Organic steel cut oats.' },
  { id: '10450114', title: 'Quaker Instant Oatmeal Variety Pack, 32 Count', price: 6.98, unit: '21.8 \u00a2/ea', stars: 4.6, reviews: 12044, ing: 'Whole grain rolled oats, sugar, salt, natural flavor, caramel color, guar gum.' },
  { id: '20000002', title: 'Crunchy Granola Oat Bites, 10 oz', price: 4.28, unit: '42.8 \u00a2/oz', stars: 4.0, reviews: 98, ing: CEREAL, ad: 'tracker' },
  { id: '10450115', title: 'Honey Nut Cheerios Heart Healthy Cereal, 19.5 oz', price: 4.98, unit: '25.5 \u00a2/oz', stars: 4.7, reviews: 15432, ing: CEREAL },
  { id: '10450116', title: 'Froot Loops Breakfast Cereal, 10.1 oz', price: 3.68, unit: '36.4 \u00a2/oz', stars: 4.6, reviews: 4412, ing: LOOPS },
  { id: '10450117', title: 'KIND Dark Chocolate Nuts & Sea Salt Bars, 12 ct', price: 9.98, unit: '83.2 \u00a2/ea', stars: 4.6, reviews: 3010, ing: 'Almonds, peanuts, honey, glucose syrup, dark chocolate, sugar, palm kernel oil, sea salt.' },
  { id: '20000003', title: 'Maple Brown Sugar Oatmeal Cups, 8 ct', price: 5.58, unit: '69.8 \u00a2/ea', stars: 4.3, reviews: 120, ing: CEREAL, ad: 'aria' },
  { id: '10450118', title: 'Silk Unsweetened Almondmilk, 64 fl oz', price: 3.48, unit: '5.4 \u00a2/fl oz', stars: 4.4, reviews: 1980, ing: 'Almondmilk (filtered water, almonds), calcium carbonate, sea salt, sunflower lecithin, gellan gum.' },
  { id: '10450119', title: 'Fresh Gala Apples, 3 lb Bag', price: 4.97, unit: '$1.66/lb', stars: 4.5, reviews: 770, ing: 'Apples.' },
  { id: '10450120', title: 'Assorted Breakfast Snack Box', price: 5.0, unit: '', stars: 0, reviews: 0, ing: '' },
  { id: '10450121', title: 'Nature Valley Crunchy Granola Bars, Oats n Honey, 12 Count, 8.94 oz', price: 3.98, unit: '44.5 \u00a2/oz', stars: 4.7, reviews: 9021, ing: 'Whole grain oats, sugar, canola oil, rice flour, honey, soy flour, brown sugar syrup, salt, soy lecithin, baking soda, natural flavor.' },
  { id: '10450122', title: "Cascadian Farm Organic Granola, 12.5 oz", price: 5.48, unit: '43.8 \u00a2/oz', stars: 4.4, reviews: 1203, ing: 'Organic rolled oats, organic cane sugar, organic sunflower oil, organic honey, sea salt.' },
];
// A brand carousel (placement attribute) and a banner (label only): ad modules that are not one product card.
export const WALMART_CAROUSEL = [
  { id: '20000004', title: 'Breakfast Biscuits Honey, 5.3 oz', price: 3.18, unit: '60.0 \u00a2/oz', ing: CEREAL },
  { id: '20000005', title: 'Breakfast Biscuits Berry, 5.3 oz', price: 3.18, unit: '60.0 \u00a2/oz', ing: CEREAL },
];
// Further result pages (?page=2, ?page=3); page 4 and beyond are empty, as a real search runs out.
export const WALMART_PAGE_2 = [
  { id: '10460001', title: 'Quaker Steel Cut Oats, 30 oz', price: 6.48, unit: '21.6 \u00a2/oz', stars: 4.7, reviews: 1500, ing: 'Steel cut oats.' },
  { id: '10460002', title: 'Great Value Organic Quick Oats, 18 oz', price: 3.28, unit: '18.2 \u00a2/oz', stars: 4.5, reviews: 420, ing: 'Organic whole grain rolled oats.' },
  { id: '20000010', title: 'Cinnamon Swirl Oat Cereal, 12 oz', price: 4.18, unit: '34.8 \u00a2/oz', stars: 4.0, reviews: 60, ing: CEREAL, ad: 'tracker' },
  { id: '10460003', title: 'Chocolate Peanut Butter Granola, 11 oz', price: 4.78, unit: '43.5 \u00a2/oz', stars: 4.3, reviews: 310, ing: 'Rolled oats, peanuts, sugar, cocoa, palm oil, soy lecithin, natural flavor.' },
  { id: '10460004', title: 'Maple Brown Sugar Instant Oatmeal, 15 Count', price: 3.48, unit: '23.2 \u00a2/ea', stars: 4.6, reviews: 2200, ing: CEREAL },
  { id: '10460005', title: 'Plain Greek Yogurt, 32 oz', price: 4.28, unit: '13.4 \u00a2/oz', stars: 4.6, reviews: 5100, ing: 'Cultured pasteurized nonfat milk.' },
  { id: '10460006', title: 'Honey Oat Bread, 20 oz', price: 3.58, unit: '17.9 \u00a2/oz', stars: 4.4, reviews: 800, ing: 'Whole wheat flour, water, honey, oats, yeast, salt.' },
];
export const WALMART_PAGE_3 = [
  { id: '10470001', title: 'Rolled Oats Canister, 48 oz', price: 5.98, unit: '12.5 \u00a2/oz', stars: 4.7, reviews: 3300, ing: OATS },
  { id: '10470002', title: 'Overnight Oats Jar Variety, 4 Count', price: 7.48, unit: '$1.87/ea', stars: 4.1, reviews: 90, ing: CEREAL },
  { id: '10470003', title: 'Oat Flour, 16 oz', price: 3.18, unit: '19.9 \u00a2/oz', stars: 4.5, reviews: 210, ing: 'Whole grain oat flour.' },
];
export const WALMART_LATE_AD = { id: '20000006', title: 'Late Arriving Toasted Oats, 12 oz', price: 3.88, unit: '32.3 \u00a2/oz', stars: 4.1, reviews: 44, ing: CEREAL, ad: 'label' };

const swatch = id => `<img src="https://i5.walmartimages.com/seo/${id}.jpeg" alt="" width="180" height="180" loading="lazy" style="display:block;margin:0 auto;width:150px;height:150px;object-fit:contain">`;
function walmartTile(item, { href } = {}) {
  const link = href || `/ip/${slug(item.title)}/${item.id}?classType=REGULAR&athbdg=L1600`;
  const tracker = item.ad === 'tracker'
    ? `/sp/track?bt=1&eventST=click&plmt=sp-search-middle~desktop~-~list&pos=7&tax=976759_976787&rdf=1&rd=${encodeURIComponent(`https://www.walmart.com/ip/${slug(item.title)}/${item.id}?adsRedirect=true`)}` : '';
  const label = item.ad === 'label' ? '<div class="flex items-center mb1"><span class="f7 gray" style="font-size:11px;color:#555">Sponsored</span></div>' : '';
  const aria = item.ad === 'aria' ? ` aria-label="${esc(item.title)}, Sponsored"` : '';
  const stars = item.reviews ? `<div class="flex items-center mt2" style="font-size:12px;color:#444"><span aria-label="${item.stars} out of 5 Stars. ${item.reviews} reviews">\u2605 ${item.stars}</span><span style="margin-left:6px">(${item.reviews.toLocaleString('en-US')})</span></div>` : '';
  const [dollars, cents] = item.price.toFixed(2).split('.');
  return `<div role="group" data-item-id="${item.id}" class="mb0 ph0-xl pt0-xl bb b--near-white w-25 pb3-m ph1" style="contain:style"><div class="h-100 pr4-xl pb1-xl pv1 ph1"><div data-testid="list-view" class="sans-serif mid-gray relative flex flex-column w-100 hide-child-opacity" style="position:relative">
    <a link-identifier="${item.id}" href="${tracker || link}"${aria} class="w-100 h-100 z-1 hide-sibling-opacity absolute" style="position:absolute;inset:0;z-index:1"><span class="w_iUH7" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"><h3>${esc(item.title)}</h3></span></a>
    <div class="relative" style="padding:6px 0">${swatch(item.id)}</div>${label}
    <div data-automation-id="product-price" class="flex flex-wrap justify-start items-center lh-title mb1"><span class="w_iUH7" data-testid="unified-global-product-price-a11y-text" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">current price $${item.price.toFixed(2)}</span><div class="mr1 b black lh-copy" aria-hidden="true" style="font-weight:700;font-size:20px"><span style="font-size:13px">$</span>${dollars}<span style="font-size:12px;vertical-align:0.6ex">${cents}</span></div></div>
    ${item.unit ? `<div class="gray mr1 f6 f5-l flex items-end mt1" style="font-size:12px;color:#555">${esc(item.unit)}</div>` : ''}
    <span data-automation-id="product-title" class="normal dark-gray mb0 mt1 lh-title f6 f5-l lh-copy" style="display:block;font-size:14px;margin-top:4px;position:relative">${esc(item.title)}</span>${stars}
    <button type="button" style="position:relative;z-index:2;margin-top:8px;align-self:flex-start;border-radius:999px;border:1px solid #0071dc;background:#fff;color:#0071dc;padding:6px 18px;font-weight:700">Add</button>
  </div></div></div>`;
}
const stack = children => `<div data-testid="item-stack" class="flex flex-wrap w-100 flex-grow-0 flex-shrink-0 ph2 pr0-xl pl4-xl mt0-xl" style="display:flex;flex-wrap:wrap">${children}</div>`;
const sponsoredBanner = '<div class="banner-ad" style="width:100%;margin:8px 8px 16px;padding:14px 18px;background:#eaf3ff;border:1px solid #b7d4f4;border-radius:12px;display:flex;align-items:center;gap:16px"><span style="font-size:11px;color:#555">Sponsored</span><a href="/brand/acme-foods"><img src="https://i5.walmartimages.com/seo/banner.jpeg" alt="Acme Foods" width="120" height="48"></a><p style="margin:0">Fuel your morning. Shop Acme Foods oatmeal.</p></div>';
function walmartResults(query, page = 1) {
  if (page === 2 || page === 3) {
    const items = page === 2 ? WALMART_PAGE_2 : WALMART_PAGE_3;
    return `<form action="/search" method="get"><main data-testid="search-results" style="padding:12px 24px"><h2 style="margin:8px 12px">Results for \u201c${esc(query)}\u201d, page ${page}</h2>${stack(items.map(item => walmartTile(item)).join(''))}</main></form>`;
  }
  if (page > 3) return `<form action="/search" method="get"><main data-testid="search-results" style="padding:12px 24px"><h2>No more results</h2></main></form>`;
  const q = String(query || '').toLowerCase();
  const items = WALMART_ITEMS.filter(() => !/zzzz/.test(q));
  const first = items.slice(0, 9), second = items.slice(9);
  const carousel = `<section data-testid="sp-search-brand-carousel" class="w-100" style="width:100%;padding:8px"><div style="display:flex;flex-wrap:wrap">${WALMART_CAROUSEL.map(item => walmartTile(item)).join('')}</div></section>`;
  return `<form action="/search" method="get"><main data-testid="search-results" style="padding:12px 24px"><h2 style="margin:8px 12px">Results for \u201c${esc(query)}\u201d</h2>
    ${stack('<div id="empty-ad-slot" style="width:100%;height:80px"></div>' + first.map(item => walmartTile(item)).join('') + carousel + sponsoredBanner)}
    ${stack(second.map(item => walmartTile(item)).join(''))}
  </main></form>`;
}
function walmartShell(path, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Walmart replica</title><style>
body{margin:0;font-family:Bogle,Arial,sans-serif;color:#2e2f32;background:#fff}header{background:#0071dc;color:#fff;padding:12px 24px;display:flex;gap:16px;align-items:center}header strong{font-size:22px}
header form{flex:1;display:flex}header input{flex:1;border-radius:999px 0 0 999px;border:0;padding:10px 16px;font-size:15px}header button{border:0;background:#ffc220;border-radius:0 999px 999px 0;padding:0 20px;font-weight:700}
.w-25{width:25%;box-sizing:border-box}.flex{display:flex}.flex-wrap{flex-wrap:wrap}.flex-column{flex-direction:column}.items-center{align-items:center}.items-end{align-items:flex-end}.justify-start{justify-content:flex-start}.relative{position:relative}.absolute{position:absolute}.chat{position:fixed;right:20px;bottom:20px;z-index:50;background:#0071dc;color:#fff;border-radius:999px;padding:12px 18px;font-weight:700}
.home{padding:40px 24px}.home h1{margin:0 0 8px}.rail{display:flex;gap:16px;margin-top:24px}.rail div{flex:1;background:#f2f8fd;border-radius:12px;padding:24px;min-height:120px}
@media(max-width:800px){.w-25{width:50%}header{flex-wrap:wrap}}</style></head><body>
<header><strong>Walmart</strong><form data-search-form action="/search" method="get" role="search"><input type="search" name="q" aria-label="Search" placeholder="Search everything at Walmart online and in store"><button type="submit">Search</button></form><nav><a href="/cart" style="color:#fff">Cart</a></nav></header>
<div id="app">${body}</div><div class="chat">Chat</div>
<script>
(function(){
  const app=document.getElementById('app');
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function render(){ const r=await fetch('/__fragment?path='+encodeURIComponent(location.pathname+location.search)); const html=await r.text(); await delay(250); app.innerHTML=html; }
  async function go(path){ history.pushState({},'',path); app.innerHTML=''; await render(); }
  document.addEventListener('submit',e=>{ const form=e.target.closest('[data-search-form]'); if(!form) return; e.preventDefault(); go('/search?q='+encodeURIComponent(form.q.value)); });
  document.addEventListener('click',e=>{ const a=e.target.closest('a[href]'); if(!a||e.defaultPrevented||e.button) return; const u=new URL(a.href,location.href); if(u.origin===location.origin&&/^\\/(?:ip|search|cart)\\b/.test(u.pathname)&&!u.pathname.startsWith('/sp/')){ e.preventDefault(); go(u.pathname+u.search); } });
  window.addEventListener('popstate',()=>render());
  // A directly loaded results page renders its results a moment after load, as the real site hydrates.
  if(${/^\/search/.test(path)}){ const body=app.innerHTML; app.innerHTML=''; delay(250).then(()=>{app.innerHTML=body;}); }
})();
</script></body></html>`;
}
const walmartHome = () => '<div class="home"><h1>Save money. Live better.</h1><p>Shop groceries, home and more.</p><div class="rail"><div>Deals</div><div>Grocery</div><div>Pharmacy</div></div></div>';
function walmartProduct(id) {
  const item = [...WALMART_ITEMS, ...WALMART_CAROUSEL, WALMART_LATE_AD, ...WALMART_PAGE_2, ...WALMART_PAGE_3].find(i => i.id === id) || WALMART_ITEMS[0];
  return `<main style="padding:24px 40px"><h1>${esc(item.title)}</h1><p style="font-size:26px;font-weight:700">$${item.price.toFixed(2)}</p><p>${esc(item.unit)}</p><div style="height:220px;width:220px;background:#f2f8fd;border-radius:12px"></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { data: {
  product: { usItemId: item.id, name: item.title, category: { path: [{ name: 'Food' }, { name: 'Breakfast & Cereal' }] } },
  idml: { ingredients: { ingredients: { value: item.ing || '' } } } } } } } }).replace(/</g, '\\u003c')}</script></main>`;
}
export function walmartPage(url) {
  const u = new URL(url);
  if (u.pathname === '/__fragment') {
    const path = new URL(u.searchParams.get('path') || '/', 'https://www.walmart.com');
    return fragmentFor(path);
  }
  return walmartShell(u.pathname, fragmentFor(u));
}
function fragmentFor(u) {
  if (/^\/search/.test(u.pathname)) return walmartResults(u.searchParams.get('q') || '', Number(u.searchParams.get('page')) || 1);
  if (/^\/ip\//.test(u.pathname)) return walmartProduct((u.pathname.match(/(\d{5,15})\/?$/) || [])[1]);
  if (/^\/cart/.test(u.pathname)) return walmartCart();
  return walmartHome();
}
// The cart: rows the shared cart reader recognises (a list in a labelled cart region, one product link per row).
function walmartCart() {
  const lines = ['10314926', '10450116', '10450117', '10450119'].map(id => WALMART_ITEMS.find(i => i.id === id));
  const row = item => `<li data-testid="cart-item" style="display:flex;gap:16px;align-items:center;padding:14px 0;border-bottom:1px solid #e3e4e5">`
    + `<img src="https://i5.walmartimages.com/seo/${item.id}.jpeg" alt="" width="72" height="72">`
    + `<div style="flex:1"><a href="/ip/${slug(item.title)}/${item.id}"><h3 style="margin:0;font-size:16px">${esc(item.title)}</h3></a>`
    + `<div style="color:#555;font-size:13px">Qty 1</div></div><strong>$${item.price.toFixed(2)}</strong></li>`;
  return `<main style="padding:24px 40px;max-width:820px"><h1>Cart (${lines.length} items)</h1>`
    + `<ul aria-label="Cart" style="list-style:none;padding:0">${lines.map(row).join('')}</ul></main>`;
}
export const walmartLateAdHtml = () => walmartTile(WALMART_LATE_AD);

// ---------------------------------------------------------------- Target
export const TARGET_PAGE_2 = [
  { id: '13022001', title: 'Quaker Steel Cut Oats - 30oz', price: 6.99, unit: '($0.23/ounce)', stars: 4.7, reviews: 600, ing: 'Steel cut oats.' },
  { id: '94350001', title: 'Premium Protein Granola Clusters - 12oz', price: 6.49, unit: '($0.54/ounce)', stars: 4.2, reviews: 77, ing: CEREAL, ad: true },
  { id: '13022002', title: 'Good & Gather\u2122 Quick Oats - 42oz', price: 5.49, unit: '($0.13/ounce)', stars: 4.6, reviews: 1500, ing: OATS },
  { id: '13022003', title: 'Plain Greek Yogurt - 32oz', price: 4.99, unit: '($0.16/ounce)', stars: 4.5, reviews: 900, ing: 'Cultured pasteurized nonfat milk.' },
  { id: '13022004', title: 'Honey Oat Bread - 20oz', price: 3.79, unit: '($0.19/ounce)', stars: 4.4, reviews: 310, ing: 'Whole wheat flour, water, honey, oats, yeast, salt.' },
  { id: '13022005', title: 'Oatmeal Cookies - 12ct', price: 3.29, unit: '($0.27/count)', stars: 4.3, reviews: 240, ing: 'Flour, sugar, oats, butter, eggs, baking soda, salt.' },
];
export const TARGET_PAGE_3 = [
  { id: '13032001', title: 'Rolled Oats Canister - 48oz', price: 5.99, unit: '($0.12/ounce)', stars: 4.7, reviews: 3300, ing: OATS },
  { id: '13032002', title: 'Oat Flour - 16oz', price: 3.19, unit: '($0.20/ounce)', stars: 4.5, reviews: 150, ing: 'Whole grain oat flour.' },
];
export const TARGET_ITEMS = [
  { id: '79364857', title: 'Organic Old Fashioned Oats - 18oz - Good & Gather\u2122', price: 3.59, unit: '($0.20/ounce)', stars: 4.7, reviews: 1289, ing: 'organic whole grain rolled oats.' },
  { id: '94340519', title: 'Seven Sundays\u2122 Wildberry Protein Oats, Gluten Free Instant Oatmeal - 16 oz', price: 6.99, unit: '($0.44/ounce)', stars: 4.4, reviews: 212, ing: 'Gluten free whole grain oats, protein blend, dried berries, sugar, natural flavor.', ad: true },
  { id: '85793926', title: "Bob's Red Mill\u2122 Gluten Free Organic Old Fashioned Rolled Oats - 32oz", price: 8.79, unit: '($0.27/ounce)', stars: 4.8, reviews: 3340, ing: 'Organic whole grain gluten free rolled oats.' },
  { id: '85793935', title: "Bob's Red Mill\u2122 Gluten Free Organic Quick Cooking Rolled Oats - 28oz", price: 7.79, unit: '($0.28/ounce)', stars: 4.7, reviews: 905, ing: 'Organic whole grain gluten free quick rolled oats.' },
  { id: '94370670', title: 'Oats Overnight\u2122 Chocolate Chip Cookie Dough Breakfast Shake - 2.1oz', price: 3.49, unit: '($1.66/ounce)', stars: 4.2, reviews: 88, ing: 'Whole grain oats, whey protein, sugar, natural flavor.', ad: true },
  { id: '13012345', title: 'Quaker Old Fashioned Oats - 18oz', price: 3.99, unit: '($0.22/ounce)', stars: 4.8, reviews: 4410, ing: 'whole grain rolled oats.' },
  { id: '13012346', title: 'Quaker Instant Oatmeal Original - 10ct', price: 3.79, unit: '($0.38/count)', stars: 4.6, reviews: 2210, ing: 'Whole grain rolled oats, salt, natural flavor.' },
  { id: '13012347', title: 'Cheerios Honey Nut Breakfast Cereal - 19.5oz', price: 5.29, unit: '($0.27/ounce)', stars: 4.7, reviews: 3120, ing: CEREAL },
  { id: '13012348', title: 'Froot Loops Breakfast Cereal - 10.1oz', price: 4.19, unit: '($0.41/ounce)', stars: 4.6, reviews: 990, ing: LOOPS },
  { id: '13012349', title: 'Good & Gather\u2122 Unsweetened Almond Milk - 64 fl oz', price: 3.39, unit: '($0.05/fluid ounce)', stars: 4.5, reviews: 640, ing: 'Almondmilk (filtered water, almonds), calcium carbonate, sea salt, gellan gum.' },
  { id: '13012350', title: 'Nature Valley Crunchy Oats n Honey Granola Bars - 12ct/8.94oz', price: 4.09, unit: '($0.46/ounce)', stars: 4.7, reviews: 2760, ing: 'Whole grain oats, sugar, canola oil, rice flour, honey, soy flour, salt.' },
  { id: '13012351', title: 'Assorted Breakfast Variety Box', price: 6.5, unit: '', stars: 0, reviews: 0, ing: '' },
];
const targetImage = id => `<img src="https://target.scene7.com/is/image/Target/GUEST_${id}" alt="" width="180" height="180" style="display:block;margin:0 auto;width:160px;height:160px;object-fit:contain">`;
function targetTile(item) {
  const ps = `/p/${slug(item.title)}/-/A-${item.id}`;
  const label = item.title + (item.ad ? ' Sponsored' : '');
  const stars = item.reviews ? `<div data-test="ratings" aria-label="${item.stars} out of 5 stars with ${item.reviews} ratings" style="font-size:12px;color:#444">\u2605 ${item.stars} (${item.reviews.toLocaleString('en-US')})</div>` : '';
  return `<div data-test="@web/site-top-of-funnel/ProductCardWrapper" style="padding:8px"><div data-test="ListingPageProductListing"><div><a data-test="assets" href="${ps}"><div data-test="product-listing-gallery-desktop">${targetImage(item.id)}</div></a></div>
  <a aria-label="${esc(label)}" data-test="content" href="${ps}"><div data-test="container-cdui"><div data-test="container-cdui-item-wrapper"><h3 style="font-size:14px;margin:6px 0"><span data-test="text-quill"><span data-test="text-quill-insert-0">${esc(item.title)}</span></span></h3></div></div></a>
  <div data-test="@web/ProductCard/PriceFulfillmentSection"><span data-test="current-price" style="font-size:18px;font-weight:700"><span>$${item.price.toFixed(2)}</span></span> ${item.unit ? `<span data-test="unit-price" style="font-size:12px;color:#555">${esc(item.unit)}</span>` : ''}</div>${stars}
  <button type="button" style="margin-top:8px;border-radius:8px;border:1px solid #cc0000;background:#fff;color:#cc0000;padding:6px 14px;font-weight:700">Add to cart</button></div></div>`;
}
function targetShell(body, drawResults = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Target replica</title><style>
body{margin:0;font-family:system-ui,Arial,sans-serif;color:#333;background:#fff}header{background:#cc0000;color:#fff;padding:12px 24px;display:flex;gap:16px;align-items:center;position:sticky;top:0;z-index:30}header strong{font-size:22px}
header form{flex:1;display:flex}header input{flex:1;border:0;border-radius:8px 0 0 8px;padding:10px 14px;font-size:15px}header button{border:0;background:#333;color:#fff;border-radius:0 8px 8px 0;padding:0 18px}
[data-test="product-grid"]{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:16px 24px}.home{padding:40px 24px}@media(max-width:800px){[data-test="product-grid"]{grid-template-columns:repeat(2,minmax(0,1fr))}}</style></head><body>
<header><strong>Target</strong><form data-search-form action="/s" method="get" role="search"><input type="search" name="searchTerm" aria-label="What can we help you find?" placeholder="What can we help you find?"><button type="submit">Search</button></form></header>
<div id="app">${body}</div>
<script>
(function(){
  const app=document.getElementById('app');
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function render(){ const r=await fetch('/__fragment?path='+encodeURIComponent(location.pathname+location.search)); const html=await r.text(); await delay(250); app.innerHTML=html; }
  async function go(path){ history.pushState({},'',path); app.innerHTML=''; await render(); }
  document.addEventListener('submit',e=>{ const form=e.target.closest('[data-search-form]'); if(!form) return; e.preventDefault(); go('/s?searchTerm='+encodeURIComponent(form.searchTerm.value)); });
  document.addEventListener('click',e=>{ const a=e.target.closest('a[href]'); if(!a||e.defaultPrevented||e.button) return; const u=new URL(a.href,location.href); if(u.origin===location.origin&&/^\\/(?:p|s)\\b/.test(u.pathname)){ e.preventDefault(); go(u.pathname+u.search); } });
  window.addEventListener('popstate',()=>render());
  ${drawResults ? 'render();' : ''}
})();
</script></body></html>`;
}
function targetFragment(u) {
  if (u.pathname === '/s' || u.pathname.startsWith('/s/')) {
    const offset = Number(u.searchParams.get('Nao')) || 0;
    const items = offset === 0 ? TARGET_ITEMS : offset === 24 ? TARGET_PAGE_2 : offset === 48 ? TARGET_PAGE_3 : [];
    return `<main><h1 style="margin:12px 24px;font-size:20px">\u201c${esc(u.searchParams.get('searchTerm') || '')}\u201d</h1><div data-test="product-grid">${items.map(targetTile).join('')}</div></main>`;
  }
  const id = (u.pathname.match(/A-(\d{6,12})/) || [])[1];
  if (id) {
    const item = [...TARGET_ITEMS, ...TARGET_PAGE_2, ...TARGET_PAGE_3].find(i => i.id === id) || TARGET_ITEMS[0];
    return `<main style="padding:24px 40px"><nav aria-label="Breadcrumbs"><a href="/" data-test="@web/Breadcrumbs/BreadcrumbLink">Target</a> <a href="/c/grocery/-/N-5xt1a" data-test="@web/Breadcrumbs/BreadcrumbLink">Grocery</a></nav><h1 data-test="product-title">${esc(item.title)}</h1><p style="font-size:24px;font-weight:700">$${item.price.toFixed(2)}</p>
<div data-test="@web/site-top-of-funnel/ProductDetailCollapsible-LabelInfo"><button aria-expanded="true" type="button"><h3>Label info</h3></button><div><div><h4>Ingredients:</h4><div>${esc(item.ing || '')}</div></div></div></div></main>`;
  }
  return '<div class="home"><h1>Expect More. Pay Less.</h1><p>Grocery, home, beauty and more.</p></div>';
}
export function targetPage(url) {
  const u = new URL(url);
  if (u.pathname === '/__fragment') return targetFragment(new URL(u.searchParams.get('path') || '/', 'https://www.target.com'));
  // Like the real site, a results page's HTML holds no products: the page's scripts fetch and draw them.
  const results = u.pathname === '/s' || u.pathname.startsWith('/s/');
  return targetShell(results ? '' : targetFragment(u), results);
}

// A flat colored square with the product's initials, for every product image request.
export function imageSvg(seed) {
  const hue = (Array.from(String(seed)).reduce((n, c) => n * 31 + c.charCodeAt(0), 7) % 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="16" fill="hsl(${hue} 45% 88%)"/><rect x="48" y="30" width="84" height="120" rx="10" fill="hsl(${hue} 50% 60%)"/><rect x="58" y="62" width="64" height="30" rx="4" fill="#fff" opacity=".85"/></svg>`;
}
