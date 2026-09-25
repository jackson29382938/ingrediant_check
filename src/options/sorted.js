// The sorted list: a tab (sorted.html) and Chrome's side panel (sidepanel.html) show the listings the
// sort toolbar handed over, best Ingredient Check score first. Ported from the Amazon Cost per Ounce
// Sorter's results view. Everything is rendered with textContent; links and images were already
// limited to Amazon by the worker (AIR.db.sortedResults.sanitizeResults), and are re-checked here.

(function () {
  const R = AIR.db.sortedResults;
  const { BAND_COLOR } = AIR.panel;
  const root = document.querySelector('#results-root');
  const isPanel = document.body.dataset.view === 'panel';
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const t = (key, fallback, ...subs) => {
    const args = subs.map(String);
    let text = '';
    try { text = (chrome.i18n && chrome.i18n.getMessage(key, args)) || ''; } catch (e) { /* no locale */ }
    return text || fallback.replace(/\$(\d)/g, (m, n) => (args[n - 1] != null ? args[n - 1] : m));
  };

  const SOURCE_TEXT = {
    scored: () => t('sortedSrcScored', 'Ingredient Check score, under your current settings'),
    unreadable: () => t('sortedSrcUnreadable', 'No readable ingredient list on Amazon'),
    'not-food': () => t('sortedSrcNotFood', 'Not scored: does not look like food'),
    unrated: () => t('sortedSrcUnrated', 'Not scored yet'),
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function showEmpty() {
    root.textContent = '';
    const state = node('section', 'empty-state');
    state.append(node('h2', '', t('sortedEmptyTitle', 'No sorted results yet')));
    state.append(node('p', '', t('sortedEmptyBody', 'Open an Amazon grocery search and choose “Sort results” to put listings in score order. Turn on “Load more results” in Settings to compare more than one page.')));
    root.append(state);
  }

  function makeProduct(product, index) {
    const article = node('article', 'product');
    if (product.image) {
      const image = node('img', 'product-image');
      image.src = product.image;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      article.append(image);
    }

    const content = node('div', 'product-content');
    const heading = node('h2');
    if (product.url) {
      const link = node('a', '', product.title || 'Amazon listing');
      link.href = product.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      heading.append(link);
    } else heading.textContent = product.title || 'Amazon listing';
    content.append(heading);

    const meta = node('div', 'product-meta');
    if (product.rating) meta.append(node('span', '', product.rating));
    if (product.reviews) meta.append(node('span', '', t('sortedReviews', '$1 reviews', product.reviews)));
    if (product.bought) meta.append(node('span', '', product.bought));
    if (product.sponsored) meta.append(node('span', '', t('sortedSponsored', 'Sponsored')));
    meta.append(node('span', '', product.pageNumber > 1
      ? t('sortedResultPage', 'Result $1 · Amazon page $2', index + 1, product.pageNumber)
      : t('sortedResult', 'Result $1', index + 1)));
    content.append(meta);

    const score = node('div', 'score');
    if (typeof product.score === 'number') {
      const c = BAND_COLOR(product.score);
      const chip = node('span', 'score-chip', String(product.score));
      chip.style.color = c.fg;
      chip.style.background = c.bg;
      chip.style.borderColor = c.ring;
      score.append(chip, node('span', 'score-verdict', product.verdict || ''));
    } else {
      score.append(node('span', 'score-chip none', '–'), node('span', 'score-verdict none', t('sortedNoScore', 'No score')));
    }
    score.append(node('small', '', (SOURCE_TEXT[product.source] || SOURCE_TEXT.unrated)()));
    content.append(score);
    if (product.listingPrice != null) content.append(node('p', 'listing-price', t('sortedListed', 'Listed price: $1', money.format(product.listingPrice))));

    if (product.details) {
      const details = node('details');
      details.append(node('summary', '', t('sortedDetails', 'Listing details')));
      details.append(node('pre', '', product.details));
      content.append(details);
    }
    article.append(content);
    return article;
  }

  async function render() {
    let saved = null;
    try { saved = (await chrome.storage.session.get('sortedResults')).sortedResults; } catch (e) { saved = null; }
    // Re-checked on read too: session storage is shared with every extension page.
    const items = R.sanitizeResults(saved && saved.items);
    if (!items.length) return showEmpty();

    root.textContent = '';
    const header = node('header', 'results-header');
    const headingGroup = node('div');
    headingGroup.append(node('p', 'eyebrow', t('sortedEyebrow', 'INGREDIENT CHECK')));
    headingGroup.append(node('h1', '', t('sortedTitle', 'Sorted by Ingredient Check score')));
    headingGroup.append(node('p', 'results-subtitle', t('sortedSubtitle',
      '$1 listings · Best score first · Listings without a score at the end · Scored on your computer with your settings', items.length)));
    header.append(headingGroup);

    const actions = node('div', 'header-actions');
    if (!isPanel) {
      const panelButton = node('button', 'button secondary', t('sortedOpenPanel', 'Open side panel'));
      panelButton.type = 'button';
      panelButton.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openResultsSidePanel' }, response => {
        void chrome.runtime.lastError;
        if (!response || !response.ok) panelButton.textContent = t('sortedPanelFallback', 'Open the side panel from Chrome’s side panel menu');
      }));
      actions.append(panelButton);
    }
    const source = R.sanitizeSourceUrl(saved && saved.sourceUrl);
    if (source) {
      const back = node('a', 'button secondary', t('sortedBack', 'Back to Amazon search'));
      back.href = source;
      back.rel = 'noopener noreferrer';
      actions.append(back);
    }
    header.append(actions);
    root.append(header);

    const list = node('section', 'result-list');
    list.setAttribute('aria-label', t('sortedListAria', 'Amazon listings sorted by Ingredient Check score'));
    R.sortByScore(items).forEach((product, index) => list.append(makeProduct(product, index)));
    root.append(list);
  }

  // A new sort replaces the list while this page is open.
  try {
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.sortedResults) render().catch(showEmpty); });
  } catch (e) { /* not an extension page */ }
  render().catch(showEmpty);
})();
