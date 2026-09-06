// Reading an ingredient list out of OCR output.
//
// Amazon frequently publishes no ingredient text at all, or publishes the product name in the
// ingredients field (see the Lifeway case in tests/blurb.test.js). The label photo is often the
// only place the real list exists. This file holds the pure part of that: which images are worth
// looking at, and how to pull a list out of the text an OCR engine returns.
//
// Deliberately narrow: INGREDIENTS ONLY. Measured on a real Lifeway label, OCR read the ingredient
// block cleanly at 70% confidence but mangled the nutrition table into "SOAIUM rnc 125MQ" and
// "Total Carb 189". Feeding those numbers to the nutrition scoring would reproduce exactly the
// class of error that the impossible-value guard in score.js exists to catch, so nutrition is
// never taken from OCR.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

// Amazon serves every product image from one id with size modifiers appended:
//   .../images/I/514iQ-HJVEL._SX38_SY50_CR,0,0,38,50_.jpg   (thumbnail)
//   .../images/I/514iQ-HJVEL._SL1600_.jpg                   (large)
// Everything from the first dot after the id is presentation, so it can be replaced.
const IMAGE_ID = /\/images\/I\/([A-Za-z0-9_+%-]{6,})\./;
// Video posters carry a play-icon overlay and never show a label.
const VIDEO_POSTER = /play-icon-overlay|PKdp-play/i;

function hiResUrl(url, px = 1600) {
  const m = String(url || '').match(IMAGE_ID);
  if (!m || VIDEO_POSTER.test(url)) return null;
  return `https://m.media-amazon.com/images/I/${m[1]}._SL${px}_.jpg`;
}

// Alt images first: on a real listing the label shot is one of them, and the hero image is the
// front of the pack. De-duplicated by image id, because Amazon repeats the same id at several
// sizes across the thumbnail strip, the main viewer and the zoom layer.
function imageCandidates(doc, limit = 8) {
  let nodes = [];
  try {
    nodes = [...doc.querySelectorAll('#altImages img, #imgTagWrapperId img, #landingImage, #main-image-container img')];
  } catch (e) { return []; }
  const seen = new Set();
  const out = [];
  for (const img of nodes) {
    const src = img.getAttribute('src') || img.getAttribute('data-old-hires') || '';
    const id = (src.match(IMAGE_ID) || [])[1];
    if (!id || seen.has(id)) continue;
    const url = hiResUrl(src);
    if (!url) continue;
    seen.add(id);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

// The block a US label prints under "INGREDIENTS". Stops at whatever section follows, because the
// allergen and distributor lines are not ingredients and would poison the parse.
const BLOCK = /INGREDIENT(?:E?S|EN)?\s*[:.\-]?\s*([\s\S]{8,6000}?)(?=\s*(?:ALLERGEN|CONTAINS\s*:|MAY\s+CONTAIN|DISTRIBUTED|MANUFACTURED|PRODUCED\s+(?:BY|FOR)|PACKED\s+(?:BY|FOR)|KEEP\s+(?:REFRIGERATED|FROZEN)|REFRIGERATE|NUTRITION|BEST\s+(?:BY|BEFORE)|QUESTIONS|WWW\.|HTTP|$))/i;

// OCR noise that is safe to remove: it never carries meaning, and leaving it in only lowers the
// recognition coverage the engine measures. Nothing here rewrites a WORD into another word —
// guessing that "IUICE" meant "JUICE" is the kind of correction that eventually corrupts a real
// ingredient, and no rule depends on it anyway.
function tidyOcr(text) {
  return String(text || '')
    .replace(/[|]/g, 'I')            // vertical bars are almost always a capital I
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;])\s*/g, '$1 ')
    .replace(/[“”"']/g, '')
    .replace(/\s*\.\s*$/, '')
    .trim();
}

function ingredientsFromOcr(text) {
  const flat = String(text || '').replace(/\r/g, '');
  const m = flat.match(BLOCK);
  if (!m) return null;
  const body = tidyOcr(m[1]);
  if (body.length < 8) return null;
  return body;
}

// Given [{ url, text }] from the OCR pass, the best candidate is the one whose extracted block a
// real ingredient parser will accept. Longer wins ties: a label photographed straight-on yields
// more of the list than one at an angle.
function bestBlock(results, accept) {
  let best = null;
  for (const r of results || []) {
    const body = ingredientsFromOcr(r && r.text);
    if (!body) continue;
    if (typeof accept === 'function' && !accept(body)) continue;
    if (!best || body.length > best.text.length) best = { url: r.url, text: body };
  }
  return best;
}

const _exports = AIRmodule('ocrText', {
  hiResUrl, imageCandidates, ingredientsFromOcr, bestBlock, tidyOcr, IMAGE_ID,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
