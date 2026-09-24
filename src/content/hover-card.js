// Results-page breakdown: hover, focus or click a score badge to see why it scored that way.
//
// A badge is drawn from a small saved score (s:) that carries no reasons. The product data behind it
// (p:, docs/CACHE.md) does, so the card re-runs the engine on that under the reader's current
// weights — about a millisecond, and no network. One card per page, in a closed shadow root, wired
// by delegation so a page of sixty badges costs one set of listeners.
//
// Hover (after `breakdownDelayMs`) or keyboard focus opens it; moving away closes it. A click, Enter
// or Space pins it open for reading; a second click, Esc or a click elsewhere closes it.

(function (root) {
  root.AIR = root.AIR || {};
  const P = () => root.AIR.page;
  const HOST_ID = 'air-breakdown';
  const HIDE_MS = 180;          // grace to move the pointer from the badge onto the card
  let host = null, openFor = null, pinned = false, showTimer = null, hideTimer = null, token = 0;

  const on = () => { const s = P().state; return s.enabled && s.badges && s.hoverBreakdown; };
  // Only a numbered badge has a breakdown; "…" and "?" keep their plain tooltip.
  const scoreBadge = el => {
    const b = el && el.closest && el.closest('.air-badge');
    return b && /^\d+$/.test((b.textContent || '').trim()) ? b : null;
  };
  // Events from inside the closed shadow root are retargeted to the host.
  const inCard = el => !!(host && el && (el === host || host.contains(el)));

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!pinned) close(); }, HIDE_MS);
  }

  function close({ refocus = false } = {}) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    token++;
    const was = openFor;
    openFor = null;
    pinned = false;
    if (was) was.setAttribute('aria-expanded', 'false');
    if (host) host.remove();
    host = null;
    if (refocus && was && was.isConnected) was.focus();
  }

  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:absolute;z-index:2147483000;top:0;left:0;';
    host.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    host.addEventListener('mouseleave', () => { if (!pinned) scheduleHide(); });
    (document.body || document.documentElement).appendChild(host);
    return host;
  }

  // Below the badge, or above it when the viewport has more room there; always inside the viewport.
  function place(badge) {
    const r = badge.getBoundingClientRect();
    const width = Math.min(340, innerWidth - 16);
    host.style.left = `${Math.min(Math.max(8, r.left), innerWidth - width - 8) + scrollX}px`;
    const below = innerHeight - r.bottom;
    if (below >= 260 || below >= r.top) {
      host.style.top = `${r.bottom + 6 + scrollY}px`;
      host.style.transform = '';
    } else {
      host.style.top = `${r.top - 6 + scrollY}px`;
      host.style.transform = 'translateY(-100%)';
    }
  }

  function show(badge) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    const tile = badge.closest('[data-asin]');
    const asin = tile && tile.getAttribute('data-asin');
    if (!asin) return;
    const mine = ++token;
    const { state, storeHost } = P();
    const C = root.AIR.db.productCache;
    const key = C.localKey(storeHost(), asin);
    chrome.storage.local.get(key, obj => {
      if (mine !== token || !badge.isConnected || !on()) return;
      const row = C.sanitize(obj && obj[key]);
      const result = row && row.status === 'ok' ? root.AIR.engine.score(C.toInput(row), state.prefs) : null;
      const [score, verdict] = String(badge.getAttribute('data-air') || '').split(':');
      if (openFor && openFor !== badge) openFor.setAttribute('aria-expanded', 'false');
      openFor = badge;
      badge.setAttribute('aria-expanded', 'true');
      root.AIR.panel.mount(ensureHost(), root.AIR.panel.renderBreakdown(result, {
        asin, score: Number(score), verdict: verdict || '', detail: state.breakdownDetail,
      }));
      place(badge);
    });
  }

  function toggle(badge) {
    if (pinned && openFor === badge) { close(); return; }
    pinned = true;
    if (openFor !== badge) show(badge);
  }

  document.addEventListener('mouseover', e => {
    if (!on()) return;
    const badge = scoreBadge(e.target);
    if (!badge) return;
    clearTimeout(hideTimer);
    if (badge === openFor) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(badge), P().state.breakdownDelayMs);
  });
  document.addEventListener('mouseout', e => {
    const badge = scoreBadge(e.target);
    if (!badge) return;
    clearTimeout(showTimer);
    if (pinned || inCard(e.relatedTarget) || badge.contains(e.relatedTarget)) return;
    if (openFor) scheduleHide();
  });
  document.addEventListener('focusin', e => {
    if (!on()) return;
    const badge = scoreBadge(e.target);
    if (badge && badge !== openFor) show(badge);
  });
  document.addEventListener('focusout', e => {
    if (pinned || !openFor || inCard(e.relatedTarget) || e.relatedTarget === openFor) return;
    if (scoreBadge(e.target) === openFor || inCard(e.target)) scheduleHide();
  });
  // Capture phase: the badge often sits inside the product link, and a click must pin, not navigate.
  document.addEventListener('click', e => {
    const badge = on() && scoreBadge(e.target);
    if (badge) {
      e.preventDefault();
      e.stopPropagation();
      toggle(badge);
      return;
    }
    if (openFor && !inCard(e.target)) close();
  }, true);
  document.addEventListener('keydown', e => {
    const badge = on() && scoreBadge(e.target);
    if (badge && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      toggle(badge);
      return;
    }
    if (e.key === 'Escape' && openFor) close({ refocus: true });
  }, true);
  addEventListener('resize', () => { if (openFor) close(); });

  const hoverCard = { close, show, isOpen: () => !!openFor, isPinned: () => pinned };
  root.AIR.hoverCard = hoverCard;
  if (typeof module !== 'undefined' && module.exports) module.exports = hoverCard;
})(typeof globalThis !== 'undefined' ? globalThis : self);
