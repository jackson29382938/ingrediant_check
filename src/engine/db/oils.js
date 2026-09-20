// Industrial seed and vegetable oils.
//
// The heaviest single signal in this engine. Presence of any HARD entry caps the whole score at 25
// no matter how good the rest of the product is, on the view that solvent-extracted, high-linoleic
// oils are a defining marker of industrial food. Users who disagree can lower or zero the
// 'Refined seed & vegetable oils' weight in settings. TRADITIONAL fats below are the opposite: they earn a bonus.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

// Manifest-declared content scripts share one top-level scope, so every const here
// must stay inside this closure or it collides with the other rule files at load time.
(function () {

  const HARD = [
    // Solvent-extracted, high-PUFA industrial oils. Any one of these caps the score.
    { id: 'canola',      m: /\b(canola|rapeseed|colza)\s*(oil|seed oil)?\b|\braps[öo]l\b|\bolio\s+di\s+colza\b/i, why: 'Canola/rapeseed oil' },
    // "High oleic" and "partially hydrogenated" variants have their own rules below, so the plain
    // rules step aside for them — one ingredient used to render two or three CAP rows.
    { id: 'soybean',     m: /(?<!high[- ]oleic )\b(soybean|soya bean|soy)\s+oil\b|(?:^|[^A-Za-z])(aceite|huile|[óo]leo)\s+de\s+soja\b|\bolio\s+di\s+soia\b|\bsoja[öo]l\b|\bsojaolie\b/i, why: 'Soybean oil' },
    { id: 'sunflower',   m: /(?<!high[- ]oleic )\bsunflower\s+oil\b|(?:^|[^A-Za-z])(aceite\s+de\s+girasol|huile\s+de\s+tournesol|sonnenblumen[öo]l|olio\s+di\s+girasole|[óo]leo\s+de\s+girassol|zonnebloemolie)\b/i, why: 'Sunflower oil' },
    { id: 'safflower',   m: /(?<!high[- ]oleic )\bsafflower\s+oil\b|\baceite\s+de\s+c[áa]rtamo\b|\bhuile\s+de\s+carthame\b|\bdistel[öo]l\b|\bolio\s+di\s+c[áa]rtamo\b|[óo]leo\s+de\s+c[áa]rtamo\b|\bsaffloerolie\b/i, why: 'Safflower oil' },
    { id: 'corn',        m: /\bcorn\s+oil\b|\b(aceite\s+de\s+ma[ií]z|huile\s+de\s+ma[ïi]s|olio\s+di\s+mais|mais(?:keim)?[öo]l|[óo]leo\s+de\s+milho|ma[iï]solie)\b/i, why: 'Corn oil' },
    { id: 'cottonseed',  m: /\bcottonseed\s+oil\b|\baceite\s+de\s+algod[oó]n\b|\bhuile\s+de\s+coton\b|\bbaumwollsaat[öo]l\b|\bolio\s+di\s+semi\s+di\s+cotone\b|[óo]leo\s+de\s+algod[aã]o\b|\bkatoenzaadolie\b/i, why: 'Cottonseed oil' },
    { id: 'grapeseed',   m: /\bgrape\s?seed\s+oil\b|\baceite\s+de\s+(?:pepitas|semillas?)\s+de\s+uva\b|\bhuile\s+de\s+p[ée]pins\s+de\s+raisin\b|\btraubenkern[öo]l\b|\bolio\s+di\s+vinaccioli\b|[óo]leo\s+de\s+semente\s+de\s+uva\b|\bdruivenpitolie\b/i, why: 'Grapeseed oil' },
    { id: 'ricebran',    m: /\brice\s?bran\s+oil\b/i,                             why: 'Rice bran oil' },
    { id: 'peanutoil',   m: /\bpeanut\s+oil\b|\baceite\s+de\s+(?:cacahuete|man[íi])(?:$|[^a-z])|\bhuile\s+d['’]arachide\b|\berdnuss[öo]l\b|\bolio\s+di\s+arachidi\b|[óo]leo\s+de\s+amendoim\b|\bpindaolie\b/i, why: 'Peanut oil' },
    { id: 'sesameind',   m: /\brefined\s+sesame\s+oil\b/i,                         why: 'Refined sesame oil' },
    { id: 'vegetable',   m: /\bvegetable\s+oil\b|(?:^|[^A-Za-z])(aceite\s+vegetal|huile\s+v[ée]g[ée]tale|pflanzen[öo]l|olio\s+vegetale|pflanzliche[sn]?\s+[öo]l|[óo]leo\s+vegetal|plantaardige\s+olie)\b/i, why: 'Unspecified "vegetable oil"' },
    { id: 'blend',       m: /\b(oil\s+blend|blend\s+of\s+\w+\s+oils?)\b/i,        why: 'Unspecified oil blend' },
    { id: 'shortening',  m: /\bshortening\b/i,                                    why: 'Vegetable shortening' },
    { id: 'margarine',   m: /\bmargarine\b/i,                                     why: 'Margarine' },
    { id: 'interester',  m: /\binte?re?sterified\b/i,                             why: 'Interesterified fat' },
    { id: 'hydrogen',    m: /(?<!partially )\b(fully )?hydrogenated\b|(?<!parcialmente )\b(totalmente\s+)?hidrogenad[oa]\b|(?<!partiellement )\bhydrog[ée]n[ée]e?\b|\bgeh[äa]rtet\b|\bidrogenat[oi]\b/i, why: 'Hydrogenated oil' },
    { id: 'monoglyoil',  m: /\bhigh\s+oleic\s+(soybean|sunflower|safflower)\b/i,  why: 'High-oleic industrial seed oil' },
  ];

  // Artificial trans fat. Its own, far lower cap.
  const TRANS = { m: /\bpartially\s+hydrogenated\b|\bparcialmente\s+hidrogenad[oa]\b|\bpartiellement\s+hydrog[ée]n[ée]e?\b/i, why: 'Partially hydrogenated oil (artificial trans fat)', cap: 5 };

  const TRADITIONAL = [
    { id: 'butter',   m: /(?<!peanut |almond |cashew |sunflower |seed |nut |cocoa |shea |apple |soy |coconut )\bbutter\b/i, why: 'Butter' },
    { id: 'ghee',     m: /\bghee\b/i,                     why: 'Ghee' },
    { id: 'tallow',   m: /\b(beef )?tallow\b/i,           why: 'Tallow' },
    { id: 'lard',     m: /\blard\b/i,                     why: 'Lard' },
    { id: 'suet',     m: /\bsuet\b/i,                     why: 'Suet' },
    { id: 'duckfat',  m: /\bduck fat\b/i,                 why: 'Duck fat' },
    { id: 'coconut',  m: /\bcoconut oil\b|\baceite de coco\b|\bhuile de coco\b|\bkokos[öo]l\b|\bolio di cocco\b/i, why: 'Coconut oil' },
    { id: 'olive',    m: /\b(extra virgin )?olive oil\b|\baceite de oliva\b|\bhuile d['’]olive\b|\boliven[öo]l\b|\bolio d['’]oliva\b/i, why: 'Olive oil' },
    { id: 'avocado',  m: /\bavocado oil\b/i,              why: 'Avocado oil' },
    { id: 'palmfruit',m: /\b(red )?palm (fruit )?oil\b/i, why: 'Palm fruit oil' },
    { id: 'creamfat', m: /\b(milk fat|butterfat|cream)\b/i, why: 'Dairy fat' },
    { id: 'cocoabtr', m: /\bcocoa butter\b/i,             why: 'Cocoa butter' },
  ];

  // Cold-pressed / unrefined qualifiers soften an otherwise-capped oil.
  const UNREFINED = /\b(cold[- ]pressed|expeller[- ]pressed|unrefined|virgin|first press)\b/i;

  // TRADITIONAL fats earn their bonus via labels.BONUSES ("Minimally refined cooking fat"), not
  // from this list. Kept here as the authoritative set of fats that are not industrial seed oils,
  // so future scoring work has one place to look. UNREFINED softens HARD caps in score.js.
  const _exports = AIRmodule('oils', { HARD, TRANS, TRADITIONAL, UNREFINED });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
