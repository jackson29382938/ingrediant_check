// Allergen and diet detection.
//
// These never change the score. They surface a warning on the panel, because "is there dairy in
// this" is a different question from "is this a good product" and conflating them helps nobody.
// Detection is conservative: it flags on presence, and a missed flag is worse than a noisy one, so
// borderline terms are included.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {

// "Peanut butter", "cocoa butter", "coconut milk" and "cream of tartar" are not dairy. score.js has
// known this since NOT_REAL_BUTTER was written; the flags did not, so a vegan was told peanut butter
// is not vegan and a milk allergy was warned about cocoa butter. One dairy pattern, shared by the
// allergen, the vegan check and the dairy-free check, so the three cannot drift apart again.
//
// Fifteen of the twenty-one stores print their labels in Spanish, French, German or Italian, and
// the rules read those languages, so the flags do too. Plant "milks" are excluded in each: the
// Romance languages put the plant after the noun ("leche de coco", "lait d'amande", "latte di
// mandorla") and German compounds it in front ("Kokosmilch", "Hafermilch").
const NOT_DAIRY_BEFORE = '(?<!\\b(?:peanut|almond|cashew|sunflower|seed|nut|cocoa|cacao|shea|apple|soy|soya|coconut|oat|rice|hemp|pea|macadamia|pistachio|walnut|hazelnut|pecan|sesame|pumpkin|flax|tiger ?nut|body|mango|kokum)\\s)';
const PLANT_ES = '(?!\\s+de\\s+(?:coco|almendras?|avena|soja|arroz|anacardos?|avellanas?|cacao|cacahuete|man[ií]|karit[ée]))';
const PLANT_FR = '(?!\\s+(?:de\\s+(?:coco|soja|riz|cacao|karit[ée]|cacahu[èe]tes?)|d[\'’](?:amandes?|avoine|noisettes?|arachide)))';
const PLANT_IT = '(?!\\s+di\\s+(?:cocco|mandorl[ae]|avena|soia|riso|nocciol[ae]|cacao|arachidi|karit[ée]))';
// "Milk thistle" and "milkweed" are plants; "cream of tartar" is a salt of tartaric acid.
const DAIRY = NOT_DAIRY_BEFORE + '\\b(?:milk|butter|cream)\\b(?!\\s*(?:of\\s+tartar|flavou?r|thistle|weed))'
  + '|\\b(?:dairy|cheese|yogh?urt|whey|casein(?:ate)?|lactose|ghee|kefir|custard|buttermilk|lactalbumin|lactoglobulin|paneer|quark)\\b'
  // Named cheeses, butterfat, curds ("bean curd" is tofu), half-and-half, skyr and labneh name no
  // dairy word, and all were read as dairy-free.
  + '|\\b(?:butterfat|skyr|labneh|mozzarella|parmesan|parmigiano|cheddar|feta|gouda|brie|camembert|provolone|romano|pecorino|gruy[èe]re|emmental|emmenthal|havarti|colby|monterey jack|halloumi|burrata|asiago|fontina)\\b'
  + '|(?<!\\bbean\\s)\\bcurds?\\b|\\bhalf[- ]?(?:and|&)[- ]?half\\b'
  // es
  + '|\\b(?:leche|nata|mantequilla)' + PLANT_ES + '\\b|\\b(?:queso|suero(?: de leche)?|lactosa|case[ií]na|yogur|requesón|cuajada)\\b'
  // "crema" is Spanish and Italian; "crema de cacahuete" and "crema di nocciole" are spreads
  + '|\\bcrema(?!\\s+d[ei]\\s+(?:coco|cocco|cacahuete|man[ií]|nocciol[ae]|mandorl[ae]|almendras?|arroz|riso|cacao|soja|soia|avena))\\b'
  // fr
  + '|\\b(?:lait|beurre|cr[èe]me)' + PLANT_FR + '\\b|\\b(?:fromage|lactos[ée]rum|petit[- ]lait|cas[ée]ine|yaourt|babeurre)\\b'
  // de — compounds, so no leading boundary: Vollmilchpulver, Süßmolkenpulver, Butterreinfett
  + '|(?<!kokos|nuss|kern|mandel|hafer|soja|reis|erdnuss|cashew|kakao|shea)(?:milch|molke|sahne|rahm|quark|k[äa]se|joghurt|butterreinfett|kasein|laktose)\\w*'
  // it
  + '|\\b(?:latte|burro|panna)' + PLANT_IT + '\\b|\\b(?:formaggio|siero(?: di latte)?|lattosio|caseina|yogurt|ricotta|mascarpone)\\b';

// `\b` does not see an accented letter as part of a word, so "blé", "œuf" and "maní" need
// explicit boundaries. L and R are those boundaries for the Latin-1 alphabet.
const L = '(?<![a-zà-ÿœ])';
const R = '(?![a-zà-ÿœ])';
const EGG = L + '(?:eggs?|egg (?:white|yolk)s?|eggnog|aioli|albumen|albumin|ovalbumin|lysozyme|mayonnaise|meringue|huevos?|(?:œ|oe)ufs?|uov[oa]|eier|eigelb|eiwei[sß]|vollei|ei)' + R;

// The wheat rule spells out its grains because `malt\w*` used to be here — and maltodextrin,
// maltitol and maltose are not malt. A coeliac user saw "Wheat / gluten" on gluten-free products
// with maltodextrin in them, which is most of the processed aisle.
const GLUTEN = L + '(?:wheat|gluten|glutine|barley|rye|malt|malted|malt (?:extract|syrup|flour|vinegar|flavou?r)|semolina|durum|spelt|farro|kamut|einkorn|emmer|triticale|seitan|couscous|bulgur'
  // Wheat products that do not say wheat. "Breadfruit" is a fruit (R stops it).
  + '|graham|panko|farina|matzo|matzah|croutons?|bread(?:crumbs?)?|bread crumbs|shortbread'
  + '|trigo|cebada|centeno|espelta|s[ée]mola|bl[ée]|orge|seigle|[ée]peautre|froment|weizen\\w*|gerste\\w*|roggen\\w*|dinkel\\w*|grie[sß]|hartweizen\\w*|grano|frumento|orzo|segale)' + R;

const ALLERGENS = [
  { id: 'milk', label: 'Milk', m: new RegExp(DAIRY, 'i') },
  { id: 'egg', label: 'Egg', m: new RegExp(EGG, 'i') },
  { id: 'peanut', label: 'Peanut',
    m: new RegExp(L + '(?:peanuts?|groundnuts?|monkey ?nuts?|arachis|cacahuetes?|cacahuates?|man[ií]|arachides?|erdn[üu]ss\\w*|arachidi)' + R, 'i') },
  { id: 'treeNut', label: 'Tree nuts',
    // Nutmeg is "nuez moscada" / "noix de muscade" / "noce moscata", and coconut is "noix de coco".
    m: /\b(almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|brazil nut|pine nut|praline|marzipan|gianduja|pesto|nougat|frangipane|almendra|anacardo|avellana|nuez(?!\s+moscada)|nueces|pistacho|amande|cajou|noisette|noix(?!\s+de\s+(?:coco|muscade))|pistache|mandel|haseln[üu]ss|waln[üu]ss|cashewkern|pistazie|mandorl|nocciol|noce(?!\s+(?:moscata|di\s+cocco))|noci|pistacchi)\w*/i },
  { id: 'soy', label: 'Soy',
    m: /\b(soy|soya|soybean|soja|soia|tofu|tempeh|edamame|miso|tamari|shoyu|natto|textured vegetable protein|tvp)\w*/i },
  { id: 'wheat', label: 'Wheat / gluten', m: new RegExp(GLUTEN, 'i') },
  { id: 'fish', label: 'Fish',
    m: /\b(fish|salmon|tuna|cod|halibut|tilapia|anchov\w+|sardines?|mackerel|herring|pollock|haddock|worcestershire|pescado|at[úu]n|salm[óo]n|anchoas?|bacalao|poisson|thon|saumon|morue|fisch\w*|thunfisch\w*|lachs\w*|sardellen|pesce|tonno|salmone|acciughe|merluzzo|surimi|bonito|katsuobushi|dashi|caviar|roe)\b/i },
  { id: 'shellfish', label: 'Shellfish',
    m: /\b(shrimp|prawn|crab(?!\s*-?\s*apples?)|lobster|crayfish|langoustine|clam|mussel|oyster|scallop|squid|calamari|octopus|krill|crustacean|mollusc|mollusk|camar[óo]n|camarones|gambas?|langosta|cangrejo|mejill[óo]n|almeja|calamar|crust[áa]ceo|molusco|crevettes?|crabe|homard|moules?|hu[îi]tres?|crustac[ée]s?|mollusques?|garnelen?|krabben?|hummer|muscheln?|krebstier|weichtier|gamber|granchio|aragosta|cozze|vongole|crostacei|molluschi)\w*/i },
  { id: 'sesame', label: 'Sesame',
    m: /\b(sesame|tahini|benne|gingelly|halva|halvah|halwa|gomasio|gomashio|za[\'’]?atar|s[ée]samo|s[ée]same|sesam)\w*/i },
  { id: 'sulfite', label: 'Sulfites',
    m: /\b((?:meta)?bisul(?:f|ph)ites?|metabisul(?:f|ph)ites?|sulfite|sulphite|sodium bisulfite|potassium metabisulfite|sulfur dioxide|sulphur dioxide|sulfitos?|sulfites?|sulfit|schwefeldioxid|solfiti|anidride solforosa|e[- ]?22[0-8])\w*/i },
  // The EU's mandatory-declaration list has three allergens the US list does not.
  { id: 'celery', label: 'Celery',
    m: /\b(celery|celeriac|apio|c[ée]leri|sellerie|sedano)\w*/i },
  { id: 'mustard', label: 'Mustard',
    m: /\b(mustard|dijon|mostaza|moutarde|senf|senape)\w*/i },
  { id: 'lupin', label: 'Lupin',
    m: /\b(lupin|lupine|lupini|altramuz|lupino)\w*/i },
  // "Corned beef" is beef; popcorn is corn; a Cornish hen is a chicken.
  { id: 'corn', label: 'Corn',
    m: /\b(corn(?!ed\b|ish\b)|popcorn|maize|masa|hominy|dextrose|maltodextrin|cornstarch)\w*/i },
  // Sweet potato is a morning glory, not a nightshade.
  { id: 'nightshade', label: 'Nightshades',
    m: /\b(tomato|(?<!\bsweet\s)potato|eggplant|aubergine|bell pepper|paprika|cayenne|chili|chilli|pimento|goji)\w*/i },
];

// Diet compatibility. `conflict` matching means the product is NOT compatible.
// Almond, coconut and other nut flours are keto staples; "eggplant" is not an egg.
//
// The animal lists are spelled out rather than summarised: `shellfish` as a literal word never
// appears on a label, so shrimp, duck, bacon and ham all passed as vegan. "Coconut meat" is not
// meat; microbial and vegetable rennet are vegetarian.
const MEAT = '\\b(?:beef|pork|chicken|turkey|lamb|mutton|veal|venison|bison|duck|quail|rabbit|bacon|sausage|salami|pepperoni|chorizo|prosciutto|pancetta|bresaola|gelatine?|lard|tallow|suet|poultry)\\w*'
  + '|\\b(?:ham|goose|meats?)\\b(?<!(?:coconut|nut|crab) meats?)'
  + '|(?<!\\b(?:vegetable|veggie|vegetal|mushroom|miso|kombu|dashi)\\s)\\b(?:broth|bouillon|stock)\\b';
const SEA = '\\b(?:fish|shellfish|salmon|tuna|cod|anchov|sardine|mackerel|herring|tilapia|shrimp|prawn|lobster|crayfish|clam|mussel|oyster|scallop|squid|calamari|octopus|krill|worcestershire|isinglass|surimi|bonito|katsuobushi|dashi|caviar)\\w*|\\broe\\b|\\bcrab(?:s|meat)?\\b(?!\\s*-?\\s*apples?)';
const NOT_VEGETARIAN = MEAT + '|' + SEA + '|(?<!\\b(?:microbial|vegetable|vegetarian|non-animal)\\s)\\brennet\\b|\\b(?:carmine|cochineal|e[- ]?120|e[- ]?441|e[- ]?904)\\b';
const NOT_VEGAN = NOT_VEGETARIAN + '|' + DAIRY + '|' + EGG + '|\\b(?:honey|royal jelly|beeswax|shellac|lanolin|e[- ]?901|e[- ]?913)\\b';
const DIETS = [
  { id: 'vegan', label: 'Vegan', conflict: new RegExp(NOT_VEGAN, 'i') },
  { id: 'vegetarian', label: 'Vegetarian', conflict: new RegExp(NOT_VEGETARIAN, 'i') },
  { id: 'glutenFree', label: 'Gluten-free', conflict: new RegExp(GLUTEN, 'i') },
  { id: 'dairyFree', label: 'Dairy-free', conflict: new RegExp(DAIRY, 'i') },
  // Oils carry no carbohydrate whatever grain they were pressed from.
  { id: 'keto', label: 'Keto-friendly',
    conflict: /\b(sugar|(?<!\b(?:almond|coconut|flax|flaxseed|hazelnut|walnut|pecan|sunflower|lupin|psyllium|sesame|peanut)\s)flour|(?<!\bcauliflower\s)rice(?!\s+bran\s+oil)|potato|corn syrup|maltodextrin|dextrose|honey|molasses|oats|wheat)\w*/i },
  { id: 'porkFree', label: 'Pork-free',
    conflict: /\b(pork|bacon|lard|gelatin|prosciutto|pancetta|chorizo|schweine\w*|cerdo|porc(?!ini)|maiale|jam[óo]n|jambon|speck|schinken)\w*|\bham\b/i },
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
