// A click (or Enter) on a score badge opens the product, as a click on the item's title or picture does.
//
// On Amazon's results and cart, and on most stores' results, the badge sits beside the title link, not in it, so by
// itself a click did nothing. It is handed to the product's own link rather than to a URL of our own: the link keeps
// its target, the modifier keys (Ctrl or Cmd for a new tab, Shift for a new window) and whatever the page does with a
// click on it (a sponsored result still goes through its redirect). A badge inside the link needs nothing; the click
// is already on it. Wired by delegation, so a page of sixty badges costs two listeners.

(function (root) {
  root.AIR = root.AIR || {};
  const badgeOf = el => (el && el.closest && el.closest('.air-badge, .air-cart-badge')) || null;

  // The link a badge stands for: the one it sits in, else the first visible link to the same product in the nearest
  // element around it that has one. The product is named on the badge (the cart and the stores) or by its Amazon tile.
  function productLink(badge) {
    const inside = badge.closest('a[href]');
    if (inside) return inside;
    const id = String((badge.dataset && badge.dataset.airProduct) || (badge.closest('[data-asin]') || badge).getAttribute('data-asin') || '').toLowerCase();
    for (let n = badge.parentNode; id && n && n.querySelectorAll; n = n.parentNode) {
      const link = [...n.querySelectorAll('a[href]')].find(a => a.getClientRects().length && a.href.toLowerCase().includes(id));
      if (link) return link;
    }
    return null;
  }

  function follow(badge, e) {
    const link = productLink(badge);
    if (root.AIR.hoverCard) root.AIR.hoverCard.close();
    if (!link || (e.type !== 'keydown' && link.contains(badge))) return;
    e.preventDefault();
    e.stopPropagation();
    link.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    }));
  }

  // Capture phase, so the page's own handlers on the tile see one click (the link's), not two.
  document.addEventListener('click', e => { const badge = badgeOf(e.target); if (badge) follow(badge, e); }, true);
  document.addEventListener('keydown', e => { const badge = e.key === 'Enter' && badgeOf(e.target); if (badge) follow(badge, e); }, true);

  root.AIR.badgeLink = { productLink, follow };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AIR.badgeLink;
})(typeof globalThis !== 'undefined' ? globalThis : self);
