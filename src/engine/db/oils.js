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
    { id: 'canola',      m: /\b(canola|rapeseed|colza)\s*(oil|seed oil)?\b/i,     why: 'Canola/rapeseed oil' },
    { id: 'soybean',     m: /\b(soybean|soya bean|soy)\s+oil\b|\b(aceite|huile)\s+de\s+soja\b/i, why: 'Soybean oil' },
    { id: 'sunflower',   m: /\bsunflower\s+oil\b|\b(aceite\s+de\s+girasol|huile\s+de\s+tournesol|sonnenblumen[öo]l)\b/i, why: 'Sunflower oil' },
    { id: 'safflower',   m: /\bsafflower\s+oil\b/i,                               why: 'Safflower oil' },
    { id: 'corn',        m: /\bcorn\s+oil\b|\b(aceite\s+de\s+ma[ií]z|huile\s+de\s+ma[ïi]s)\b/i, why: 'Corn oil' },
    { id: 'cottonseed',  m: /\bcottonseed\s+oil\b/i,                              why: 'Cottonseed oil' },
    { id: 'grapeseed',   m: /\bgrape\s?seed\s+oil\b/i,                            why: 'Grapeseed oil' },
    { id: 'ricebran',    m: /\brice\s?bran\s+oil\b/i,                             why: 'Rice bran oil' },
    { id: 'peanutoil',   m: /\bpeanut\s+oil\b/i,                                  why: 'Peanut oil' },
    { id: 'sesameind',   m: /\brefined\s+sesame\s+oil\b/i,                         why: 'Refined sesame oil' },
    { id: 'vegetable',   m: /\bvegetable\s+oil\b|\b(aceite\s+vegetal|huile\s+v[ée]g[ée]tale|pflanzen[öo]l)\b/i, why: 'Unspecified "vegetable oil"' },
    { id: 'blend',       m: /\b(oil\s+blend|blend\s+of\s+\w+\s+oils?)\b/i,        why: 'Unspecified oil blend' },
    { id: 'shortening',  m: /\bshortening\b/i,                                    why: 'Vegetable shortening' },
    { id: 'margarine',   m: /\bmargarine\b/i,                                     why: 'Margarine' },
    { id: 'interester',  m: /\binte?re?sterified\b/i,                             why: 'Interesterified fat' },
    { id: 'hydrogen',    m: /\b(fully )?hydrogenated\b|\b(totalmente\s+)?hidrogenad[oa]\b|\bhydrog[ée]n[ée]e?\b/i, why: 'Hydrogenated oil' },
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
    { id: 'coconut',  m: /\bcoconut oil\b/i,              why: 'Coconut oil' },
    { id: 'olive',    m: /\b(extra virgin )?olive oil\b/i, why: 'Olive oil' },
    { id: 'avocado',  m: /\bavocado oil\b/i,              why: 'Avocado oil' },
    { id: 'palmfruit',m: /\b(red )?palm (fruit )?oil\b/i, why: 'Palm fruit oil' },
    { id: 'creamfat', m: /\b(milk fat|butterfat|cream)\b/i, why: 'Dairy fat' },
    { id: 'cocoabtr', m: /\bcocoa butter\b/i,             why: 'Cocoa butter' },
  ];

  // Cold-pressed / unrefined qualifiers soften an otherwise-capped oil.
  const UNREFINED = /\b(cold[- ]pressed|expeller[- ]pressed|unrefined|virgin|first press)\b/i;

  // TRADITIONAL and UNREFINED were defined here from the start and exported by neither this line
  // nor anything else, so the softening the header comment promises never happened. UNREFINED is
  // now consumed by the cap assembly in score.js.
  const _exports = AIRmodule('oils', { HARD, TRANS, TRADITIONAL, UNREFINED });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
