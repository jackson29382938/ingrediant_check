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

// Match the printed heading as a word, or as a Japanese heading next to the list.
const HEADING = String.raw`(?:(?<![\p{L}\p{N}])(?:ingredientes|ingredienti|ingredi[eë]nten|ingr[eé]dients?|zutaten|sk[łl]adniki|sk[łl]ad(?=\s*:)|ingredienser|[iİ][çc]indekiler)(?![\p{L}\p{N}])|原材料)`;
const AMOUNT = String.raw`\s*(?:(?:LESS\s+THAN|UP\s+TO|NOT\s+MORE\s+THAN)\s+)?\d`;
const FACILITY_ADVISORY = String.raw`\b(?:PRODUCED|MADE|MANUFACTURED|PACKED|PACKAGED|PROCESSED|PREPARED|BOTTLED|ROASTED)\s+(?:IN|ON|AT)\s+(?:(?:A|THE|OUR)\s+)?(?:(?:SHARED|SAME)\s+)?(?:FACTORY|FACILITY|PLANT|SITE|PREMISES|EQUIPMENT|(?:PRODUCTION\s+)?LINE)\b`;
const ADVISORY = [
  String.raw`\b(?:ALLERGENS?(?:\s+INFORMATION)?\s*:|CONTAINS\s*:(?!${AMOUNT}))`,
  String.raw`\b(?:MAY\s+CONTAIN|KANN\s+SPUREN|PEUT\s+CONTENIR|PUEDE\s+CONTENER|PU[ÒO]\s+CONTENERE|KAN\s+SPOREN|PODE\s+CONTER|KAN\s+INNEH[ÅA]LLA|MO[ŻZ]E\s+ZAWIERA)\b`,
  String.raw`(?<=[.\n])[ \t]*(?:THIS\s+PRODUCT\s+)?\b(?:CONTAINS|CONTIENE)\b(?![ \t]*:?${AMOUNT})`,
  FACILITY_ADVISORY,
].join('|');
const OTHER_SECTION = String.raw`\b(?:IMPORTED\s+BY|DISTRIBUTED|MANUFACTURED|PRODUCED\s+(?:BY|FOR)|PACKED\s+(?:BY|FOR)|KEEP\s+(?:REFRIGERATED|FROZEN)|REFRIGERATE|NUTRITION(?:AL)?(?:\s+(?:FACTS|INFORMATION|VALUES?|DECLARATION|PANEL)|(?=[ \t]*[:(]))|N[ÄA]HRWERT\w*|VALEURS\s+NUTRITIONNELLES|BEST\s+(?:BY|BEFORE)|QUESTIONS|HTTP|[ÀA]\s+CONSERVER|INFORMACI[ÓO]N\s+NUTRICIONAL|VALORI\s+NUTRIZIONALI|CONSERVARE|BEWAREN|VOEDINGSWAARDE\w*|INFORMA[ÇC][ÃA]O\s+NUTRICIONAL|F[ÖO]RVARA\w*|N[ÄA]RINGSV[ÄA]RDE\w*|PRZECHOWYWA\w*|WARTO[ŚS][ĆC]\s+OD[ŻZ]YWCZA|BES[İI]N\s+DE[ĞG]ERLER|SER[İI]N\s+VE)\b|\bWWW\.|\.\s+[^.,]{1,40}?\s+[İI][ÇC]EREB[İI]L[İI]R`;
const START = new RegExp(HEADING + String.raw`\s*[:.\-–：]?\s*`, 'iu');
const NEXT_HEADING = String.raw`(?:[.;/\n][ \t]*)${HEADING}(?=\s*[:\-–：]|[ \t]*\n)`;
const NEXT_SECTION = new RegExp(`(${ADVISORY})|${OTHER_SECTION}|${NEXT_HEADING}`, 'iu');
const NEXT_ADVISORY = new RegExp(ADVISORY, 'iu');
const TRANSLATION = new RegExp(NEXT_HEADING, 'iu');
const ADVISORY_END = new RegExp(`(?!${FACILITY_ADVISORY})(?:${OTHER_SECTION})`, 'iu');

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

function labelFromOcr(text) {
  const flat = String(text || '').slice(0, 24000).replace(/\r/g, '');
  const match = START.exec(flat);
  if (!match) return null;
  const tail = flat.slice(match.index + match[0].length);
  const boundary = NEXT_SECTION.exec(tail);
  const end = boundary?.index ?? tail.length;
  if (end > 6000) return null;
  const body = tidyOcr(tail.slice(0, end));
  // A real single-ingredient label can be shorter than eight characters.
  if (body.length < 8 && !/^(?:jujubes?|milk|oats|salt|water|rice|corn|sugar|eggs|dates?|cocoa|cacao|flour)$/i.test(body)) return null;
  const remainder = tail.slice(end).split(TRANSLATION, 1)[0];
  const advisoryStart = boundary?.[1] ? 0 : remainder.search(NEXT_ADVISORY);
  const rest = advisoryStart < 0 ? '' : remainder.slice(advisoryStart).trim();
  const next = rest.search(ADVISORY_END);
  const advisory = tidyOcr(rest.slice(0, next < 0 ? 6000 : Math.min(6000, next)))
    .replace(/^ALLERGENS?(?:\s+INFORMATION)?\s*:\s*(?=CONTAINS|MAY CONTAIN)/i, '')
    .replace(/^THIS\s+PRODUCT\s+(?=CONTAINS)/i, '');
  return { text: body, advisory };
}

const ingredientsFromOcr = text => labelFromOcr(text)?.text ?? null;

// OCR's aggregate score hides individual mistakes such as "SO¥" in a mostly legible list.
const WORD = /[\p{L}\p{N}¥€$¢@|]+(?:[-’'][\p{L}\p{N}¥€$¢@|]+)*/gu;
const BROKEN = /[\p{L}][¥€$¢@]|[¥€$¢@][\p{L}]/u;
const wordKey = word => word.replace(/\|/g, 'I').toLowerCase();

function uncertainWords(text, words = []) {
  const low = new Map();
  for (const { text: word, confidence } of Array.isArray(words) ? words : []) {
    if (!Number.isFinite(confidence) || confidence < 0 || confidence >= 70) continue;
    for (const part of word.match(WORD) || []) {
      const key = wordKey(part);
      low.set(key, Math.min(confidence, low.get(key) ?? Infinity));
    }
  }
  const candidates = new Map();
  for (const word of text.match(WORD) || []) {
    const garbled = BROKEN.test(word);
    const confidence = low.get(wordKey(word));
    if (garbled || (confidence != null && /\p{L}{2}/u.test(word))) candidates.set(wordKey(word), { word, confidence, garbled });
  }
  return [...candidates.values()].sort((a, b) => Number(b.garbled) - Number(a.garbled) || (a.confidence ?? 100) - (b.confidence ?? 100)).slice(0, 12);
}

// A caller can give a validated coverage score, or simply approve the block.
function bestBlock(results, accept) {
  let best = null, bestQuality = -1;
  for (const r of results || []) {
    const label = labelFromOcr(r?.text);
    if (!label) continue;
    const uncertain = uncertainWords(`${label.text} ${label.advisory}`, r.words);
    const candidate = { ...label, url: r.url, uncertain, confidence: r.confidence };
    const approved = typeof accept === 'function' ? accept(label.text, candidate) : true;
    if (approved === false || approved == null) continue;
    const quality = Number.isFinite(approved) ? approved : 0;
    if (!best || quality > bestQuality || (quality === bestQuality && label.text.length > best.text.length)) {
      best = candidate;
      bestQuality = quality;
    }
  }
  return best;
}

const _exports = AIRmodule('ocrText', {
  hiResUrl, imageCandidates, ingredientsFromOcr, labelFromOcr, bestBlock, uncertainWords, tidyOcr, IMAGE_ID,
  isAllowedOcrUrl, allowedOcrUrls,
});
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
