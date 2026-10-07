// A click on a score goes where a click on the item's title goes (src/content/badge-link.js), in the real extension.
// No network: www.amazon.com is the local snapshot server and every retailer page is made up by the test.

// A click on a result's number goes where a click on its title goes: the same tab, a new tab with Ctrl or Cmd, and
// Enter from the keyboard. With "show why on hover" off the number is a plain image; with it on, a
// link that also shows the card. The saved results page puts the badge in front of the title link, not in it.
export async function numbersOpenTheProduct(context, worker, search) {
  const url = 'https://www.amazon.com/s?k=rolled+oats';
  const ready = async () => {
    await search.goto(url, { waitUntil: 'load', timeout: 20000 });
    await search.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await search.waitForFunction(() => [...document.querySelectorAll('.air-badge')].filter(b => /^\d+$/.test(b.textContent.trim())).length >= 2, { timeout: 45000 });
    return search.locator('.air-badge', { hasText: /^\d+$/ }).first();
  };
  const productOf = number => number.evaluate(b => { const link = b.closest('[data-asin]').querySelector('a[href]'); return { href: link.href, beside: !b.closest('a') }; });
  const newTab = async (href, act) => {
    const [tab] = await Promise.all([context.waitForEvent('page', { timeout: 10000 }), act()]);
    await tab.waitForURL(href, { timeout: 10000 });
    await tab.close();
  };
  let number = await ready();
  let { href, beside } = await productOf(number);
  if (!beside) throw new Error('the saved results page should put the badge beside the title link, not in it');
  await number.click();
  await search.waitForURL(href, { timeout: 15000 });            // breakdown off: a click, not a dead image
  number = await ready();
  await worker.evaluate(() => chrome.storage.local.set({ hoverBreakdown: true }));
  try {
    await search.waitForFunction(() => document.querySelector('.air-badge[data-air]')?.getAttribute('role') === 'link', { timeout: 15000 });
    number = search.locator('.air-badge', { hasText: /^\d+$/ }).first();
    const traits = await number.evaluate(b => ({ role: b.getAttribute('role'), tab: b.getAttribute('tabindex'), popup: b.getAttribute('aria-haspopup'), cursor: getComputedStyle(b).cursor }));
    if (traits.role !== 'link' || traits.tab !== '0' || traits.popup !== 'dialog' || traits.cursor !== 'pointer') throw new Error(`a number that shows the card is a focusable link: ${JSON.stringify(traits)}`);
    await number.hover();
    await search.waitForSelector('#air-breakdown', { timeout: 5000 });
    await number.click();                                        // the card does not pin: the click goes to the product
    await search.waitForURL(href, { timeout: 15000 });
    number = await ready();
    await search.waitForFunction(() => document.querySelector('.air-badge[data-air]')?.getAttribute('role') === 'link', { timeout: 15000 });
    await number.evaluate(b => b.blur());
    await number.focus();
    await search.waitForSelector('#air-breakdown', { timeout: 5000 });
    await search.keyboard.press('Enter');
    await search.waitForURL(href, { timeout: 15000 });
    number = await ready();
    await search.waitForFunction(() => document.querySelector('.air-badge[data-air]')?.getAttribute('role') === 'link', { timeout: 15000 });
    await newTab(href, () => number.click({ modifiers: ['ControlOrMeta'] }));
    if (search.url() !== url) throw new Error(`a new-tab click moved this tab to ${search.url()}`);
  } finally {
    await worker.evaluate(() => chrome.storage.local.set({ hoverBreakdown: false }));
  }
}

// On most stores the rating sits beside the title's link, not in it: a click on it still opens the product.
export async function ratingBesideTheLink(context, worker, pageErrors) {
  const beside = await context.newPage();
  beside.on('pageerror', err => pageErrors.push(`rating beside the link: ${err.message}`));
  await beside.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: new URL(route.request().url()).pathname === '/search'
    ? '<html><body><article data-testid="product-card"><div class="title"><a href="/p/oats/0003000001020"><h3>Whole grain oats</h3></a></div></article></body></html>'
    : '<html><body><h1>Whole grain rolled oats</h1><section><h3>Ingredients</h3><p>whole grain rolled oats</p></section></body></html>' }));
  await worker.evaluate(() => chrome.storage.local.remove('s:kroger.com:0003000001020'));
  await beside.goto('https://www.kroger.com/search?query=oats');
  await beside.waitForFunction(() => document.querySelector('.air-badge')?.dataset.airStatus === 'scored', { timeout: 20000 });
  if (await beside.evaluate(() => !!document.querySelector('.air-badge').closest('a'))) throw new Error('this check needs the rating beside the link');
  await beside.locator('.air-badge').click();
  await beside.waitForURL('https://www.kroger.com/p/oats/0003000001020', { timeout: 10000 });
  await beside.close();
}
