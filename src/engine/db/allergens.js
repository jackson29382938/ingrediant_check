// Allergen and diet detection.
//
// These never change the score. They surface a warning on the panel, because "is there dairy in
// this" is a different question from "is this a good product" and conflating them helps nobody.
// Detection is conservative: it flags on presence, and a missed flag is worse than a noisy one, so
// borderline terms are included.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

const ALLERGENS = [
  { id: 'milk', label: 'Milk',
    m: /\b(milk|dairy|butter(?!\s*flavou?r)|cream|cheese|yogh?urt|whey|casein(ate)?|lactose|ghee|kefir|custard|buttermilk)\b/i },
  { id: 'egg', label: 'Egg',
    m: /\b(egg|eggs|egg white|egg yolk|albumen|ovalbumin|mayonnaise|meringue)\b/i },
  { id: 'peanut', label: 'Peanut',
    m: /\b(peanut|peanuts|groundnut|arachis)\b/i },
  { id: 'treeNut', label: 'Tree nuts',
    m: /\b(almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|brazil nut|pine nut|praline|marzipan)\w*/i },
  { id: 'soy', label: 'Soy',
    m: /\b(soy|soya|soybean|tofu|tempeh|edamame|miso|tamari|lecithin \(soy\))\w*/i },
  { id: 'wheat', label: 'Wheat / gluten',
    m: /\b(wheat|gluten|barley|rye|malt|semolina|durum|spelt|farro|kamut|triticale|seitan|couscous|bulgur)\w*/i },
  { id: 'fish', label: 'Fish',
    m: /\b(fish|salmon|tuna|cod|halibut|tilapia|anchov\w+|sardine|mackerel|herring|worcestershire)\b/i },
  { id: 'shellfish', label: 'Shellfish',
    m: /\b(shrimp|prawn|crab|lobster|crayfish|clam|mussel|oyster|scallop|squid|octopus|krill)\w*/i },
  { id: 'sesame', label: 'Sesame',
    m: /\b(sesame|tahini|benne|gingelly)\w*/i },
  { id: 'sulfite', label: 'Sulfites',
    m: /\b(sulfite|sulphite|sodium bisulfite|potassium metabisulfite|sulfur dioxide)\w*/i },
  { id: 'corn', label: 'Corn',
    m: /\b(corn|maize|masa|hominy|dextrose|maltodextrin|corn syrup|cornstarch)\w*/i },
  { id: 'nightshade', label: 'Nightshades',
    m: /\b(tomato|potato|eggplant|aubergine|bell pepper|paprika|cayenne|chili|chilli|pimento)\w*/i },
];

// Diet compatibility. `conflict` matching means the product is NOT compatible.
const DIETS = [
  { id: 'vegan', label: 'Vegan',
    conflict: /\b(beef|pork|chicken|turkey|lamb|fish|gelatin|honey|milk|dairy|cheese|butter(?!\s*flavou?r)|cream|whey|casein|egg|lard|tallow|anchov|shellfish|carmine|shellac)\w*/i },
  { id: 'vegetarian', label: 'Vegetarian',
    conflict: /\b(beef|pork|chicken|turkey|lamb|bacon|fish|gelatin|lard|tallow|anchov|shellfish|rennet|carmine)\w*/i },
  { id: 'glutenFree', label: 'Gluten-free',
    conflict: /\b(wheat|gluten|barley|rye|malt|semolina|durum|spelt|farro|triticale|seitan|couscous|bulgur)\w*/i },
  { id: 'dairyFree', label: 'Dairy-free',
    conflict: /\b(milk|dairy|butter(?!\s*flavou?r)|cream|cheese|yogh?urt|whey|casein(ate)?|lactose|ghee)\b/i },
  { id: 'keto', label: 'Keto-friendly',
    conflict: /\b(sugar|flour|rice|potato|corn syrup|maltodextrin|dextrose|honey|molasses|oats|wheat)\w*/i },
  { id: 'porkFree', label: 'Pork-free',
    conflict: /\b(pork|bacon|ham|lard|gelatin|prosciutto|pancetta|chorizo)\w*/i },
];

// Scan a parsed ingredient list. `selected` is the list of ids the user asked to be warned about.
function detect(list, selectedAllergens = [], selectedDiets = []) {
  const found = [];
  for (const a of ALLERGENS) {
    if (!selectedAllergens.includes(a.id)) continue;
    const hit = list.find(i => a.m.test(i));
    if (hit) found.push({ kind: 'allergen', id: a.id, label: a.label, ingredient: hit });
  }
  for (const d of DIETS) {
    if (!selectedDiets.includes(d.id)) continue;
    const hit = list.find(i => d.conflict.test(i));
    if (hit) found.push({ kind: 'diet', id: d.id, label: `Not ${d.label.toLowerCase()}`, ingredient: hit });
  }
  return found;
}

// User's own avoid list: plain words or phrases, matched case-insensitively as substrings.
function matchAvoidList(list, terms = []) {
  const out = [];
  for (const raw of terms) {
    const term = String(raw || '').trim().toLowerCase();
    if (term.length < 2) continue;
    const hit = list.find(i => i.includes(term));
    if (hit) out.push({ kind: 'avoid', id: term, label: `On your avoid list: ${raw}`, ingredient: hit });
  }
  return out;
}

const _exports = AIRmodule('allergens', { ALLERGENS, DIETS, detect, matchAvoidList });
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
