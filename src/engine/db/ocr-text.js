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

// The offscreen document fetches from the extension origin, so a message must not be able to
// point it at an arbitrary Amazon (or other) URL. Only the product-image CDN, only /images/I/.
function isAllowedOcrUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'm.media-amazon.com') return false;
  if (parsed.username || parsed.password || parsed.port) return false;
  if (!parsed.pathname.startsWith('/images/I/')) return false;
  if (VIDEO_POSTER.test(parsed.href)) return false;
  return IMAGE_ID.test(parsed.pathname);
}

function allowedOcrUrls(urls, limit = 5) {
  const cap = Math.min(5, Math.max(1, Number(limit) || 5));
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(urls) ? urls : []) {
    if (!isAllowedOcrUrl(raw)) continue;
    const href = String(raw);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= cap) break;
  }
  return out;
}

// Alt images first: on a real listing the label shot is one of them, and the hero image is the
// front of the pack. De-duplicated by image id, because Amazon repeats the same id at several
// sizes across the thumbnail strip, the main viewer and the zoom layer.
function imageCandidates(doc, limit = 8) {
  let nodes;
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

// The block a label prints under Ingredients / Zutaten / Ingredientes / …. Polish "Skład" only with
// its colon: bare, it starts "składowania" (storage). Same heading set as
// extract.js. Longer locale forms come before English `ingredients?` so INGREDIENTES is not
// truncated to INGREDIENTE + leftover "S:", nor INGREDIENTI to INGREDIENT + "I:". Turkish puts the
// allergen before "içerebilir" (may contain), so the list ends at the sentence that says it.
const BLOCK = /(?:ingredientes|ingredienti|ingredi[eë]nten|ingr[eé]dients?|zutaten|sk[łl]adniki|sk[łl]ad(?=\s*:)|ingredienser|[iİ][çc]indekiler|原材料|ingredients?)\s*[:.-]?\s*([\s\S]{4,6000}?)(?=\s*(?:ALLERGEN|CONTAINS\s*:|MAY\s+CONTAIN|DISTRIBUTED|MANUFACTURED|PRODUCED\s+(?:BY|FOR)|PACKED\s+(?:BY|FOR)|KEEP\s+(?:REFRIGERATED|FROZEN)|REFRIGERATE|NUTRITION|N[ÄA]HRWERT|VALEURS\s+NUTRITIONNELLES|BEST\s+(?:BY|BEFORE)|QUESTIONS|WWW\.|HTTP|KANN\s+SPUREN|PEUT\s+CONTENIR|[ÀA]\s+CONSERVER|PUEDE\s+CONTENER|INFORMACI[ÓO]N\s+NUTRICIONAL|PU[ÒO]\s+CONTENERE|VALORI\s+NUTRIZIONALI|CONSERVARE|KAN\s+SPOREN|BEWAREN|VOEDINGSWAARDE|PODE\s+CONTER|INFORMA[ÇC][ÃA]O\s+NUTRICIONAL|KAN\s+INNEH[ÅA]LLA|F[ÖO]RVARA|N[ÄA]RINGSV[ÄA]RDE|MO[ŻZ]E\s+ZAWIERA|PRZECHOWYWA|WARTO[ŚS][ĆC]\s+OD[ŻZ]YWCZA|\.\s+[^.,]{1,40}?\s+[İI][ÇC]EREB[İI]L[İI]R|BES[İI]N\s+DE[ĞG]ERLER|SER[İI]N\s+VE|$))/i;

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
  // Real single-ingredient labels can be shorter than eight characters (the reported
  // Zorrer label is 'Jujubes'). Keep short known foods; short OCR noise stays unavailable.
  if (body.length < 8 && !/^(?:jujubes?|milk|oats|salt|water|rice|corn|sugar|eggs|dates?|cocoa|cacao|flour)$/i.test(body)) return null;
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
  isAllowedOcrUrl, allowedOcrUrls,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
