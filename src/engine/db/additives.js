// Additives, isolates, and industrial processing aids.
//
// Each entry carries the sentence the user actually reads in the panel. `why` is product copy, not
// a code comment — keep it plain, specific, and free of hedging.
//
// tier: 'cap'   — presence sets a hard ceiling on the whole score
//       'heavy' / 'moderate' / 'light' — point penalties, position-weighted by the caller

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

// Manifest-declared content scripts share one top-level scope, so every const here
// must stay inside this closure or it collides with the other rule files at load time.
(function () {

  // ---------------------------------------------------------------- hard caps
  const CAPS = [
    { m: /\b(red\s*(no\.?\s*)?40|allura red|e129|rojo\s*40|rouge\s*40)\b/i, cat: 'colour', cap: 18, why: 'Red 40 artificial colour' },
    { m: /\b(red\s*(no\.?\s*)?3|erythrosine|e127)\b/i,          cat: 'colour', cap: 18, why: 'Red 3 artificial colour' },
    { m: /\b(yellow\s*(no\.?\s*)?5|tartrazine|tartrazina|e102|amarillo\s*5|jaune\s*5)\b/i, cat: 'colour', cap: 18, why: 'Yellow 5 artificial colour' },
    { m: /\b(yellow\s*(no\.?\s*)?6|sunset yellow|e110|amarillo\s*6|jaune\s*6)\b/i, cat: 'colour', cap: 18, why: 'Yellow 6 artificial colour' },
    { m: /\b(blue\s*(no\.?\s*)?1|brilliant blue|e133|azul\s*1|bleu\s*1)\b/i, cat: 'colour', cap: 18, why: 'Blue 1 artificial colour' },
    { m: /\b(blue\s*(no\.?\s*)?2|indigotine|e132)\b/i,          cat: 'colour', cap: 18, why: 'Blue 2 artificial colour' },
    { m: /\b(green\s*(no\.?\s*)?3|fast green)\b/i,              cat: 'colour', cap: 18, why: 'Green 3 artificial colour' },
    { m: /\btitanium dioxide\b|\be171\b|\bdi[óo]xido de titanio\b|\bdioxyde de titane\b/i, cat: 'colour', cap: 18, why: 'Titanium dioxide — banned as a food additive in the EU' },
    { m: /\bartificial colou?rs?\b|\bcolorantes?\s+artificiales?\b|\bcolorants?\s+artificiels?\b/i, cat: 'colour', cap: 20, why: 'Artificial colour' },
    { m: /\bcaramel colou?r(ing)?\b|\be150[a-d]?\b|\bcolor(ante)? caramelo\b|\bcolorant caramel\b/i, cat: 'colour', cap: 30, why: 'Caramel colour' },
    { m: /\bcarrageenan\b|\be407\b|\bcarragenina\b|\bcarragh[ée]nane\b/i, cat: 'carrageenan', cap: 40, why: 'Carrageenan — linked to gut inflammation' },
    { m: /\b(bha|butylated hydroxyanisole|e320)\b/i,            cat: 'strongPreservative', cap: 45, why: 'BHA preservative' },
    { m: /\b(bht|butylated hydroxytoluene|e321)\b/i,            cat: 'strongPreservative', cap: 45, why: 'BHT preservative' },
    { m: /\b(tbhq|tert[- ]?butylhydroquinone|e319)\b/i,         cat: 'strongPreservative', cap: 45, why: 'TBHQ preservative' },
    { m: /\bpropyl(ene)? gallate\b|\be310\b/i,                  cat: 'strongPreservative', cap: 45, why: 'Propyl gallate' },
    { m: /\bpotassium bromate\b/i,                              cat: 'processingAid', cap: 15, why: 'Potassium bromate — banned in the EU, UK, and Canada' },
    { m: /\bazodicarbonamide\b/i,                               cat: 'processingAid', cap: 20, why: 'Azodicarbonamide — the "yoga mat" dough conditioner' },
    { m: /\bolestra\b/i,                                        cat: 'processingAid', cap: 15, why: 'Olestra' },
    { m: /\bbrominated vegetable oil\b|\bbvo\b/i,               cat: 'processingAid', cap: 15, why: 'Brominated vegetable oil' },
  ];

  // ---------------------------------------------------------------- protein isolates
  const ISOLATES = [
    { m: /\bsoy protein (isolate|concentrate)\b/i,   pts: 22, why: 'Soy protein isolate — hexane-extracted industrial protein' },
    { m: /\bpea protein( isolate| concentrate)?\b/i, pts: 18, why: 'Pea protein isolate' },
    { m: /\brice protein( isolate)?\b/i,             pts: 15, why: 'Rice protein isolate' },
    { m: /\btextured (vegetable|soy) protein\b|\btvp\b/i, pts: 22, why: 'Textured vegetable protein' },
    { m: /\bwheat protein isolate\b|\bvital wheat gluten\b/i, pts: 18, why: 'Isolated wheat gluten' },
    { m: /\bhydrolyzed (soy |vegetable |wheat |corn )?protein\b/i, pts: 18, why: 'Hydrolyzed protein — a hidden glutamate source' },
    { m: /\bwhey protein (isolate|concentrate|hydrolysate)\b/i, pts: 10, why: 'Whey protein isolate — processed dairy fraction' },
    { m: /\bmilk protein (isolate|concentrate)\b/i,  pts: 10, why: 'Milk protein isolate' },
    { m: /\bcasein(ate)?\b|\b(sodium|calcium) caseinate\b/i, pts: 12, why: 'Caseinate — chemically extracted milk protein' },
    // Collagen peptides are deliberately absent: they are an isolated protein, but not an
    // industrial one in the sense the rest of this table is about. A pts:0 entry used to sit here,
    // which tag() filters out, so it never reached the panel in any form.
    { m: /\bsoy leghemoglobin\b/i,                   pts: 20, why: 'Soy leghemoglobin — genetically engineered heme' },
    { m: /\begg white (protein )?(powder|solids)\b/i, pts: 4, why: 'Dried egg white' },
  ];

  // ---------------------------------------------------------------- flavour & glutamates
  const FLAVOURS = [
    { m: /\bartificial (and natural )?flavou?rs?\b/i,     pts: 18, why: 'Artificial flavour' },
    { m: /\bnatural (and artificial )?flavou?rs?\b/i,     pts: 15, why: '"Natural flavors" — an undisclosed proprietary blend, not a food' },
    { m: /\bnatural [a-z]+ flavou?rs?\b/i,                pts: 15, why: '"Natural flavor" — undisclosed proprietary flavour compound' },
  // Mirror of the natural-flavour catch-all. Without it "artificial butter flavor" and
  // "artificial vanilla flavor" slipped past every flavour rule entirely.
  { m: /\bartificial [a-z]+ flavou?rs?\b/i,             pts: 18, why: 'Artificial flavour compound' },
    // Bare "flavor" / "flavors" is the same undisclosed blend without the adjective.
    { m: /\bflavou?ring\b|^flavou?rs?$|\bsaborizantes?\b|\baromatizantes?\b|\bsabor (?:natural|artificial|id[ée]ntico al natural)\b/i, pts: 12, why: 'Unspecified flavouring' },
    // The same undisclosed blend on Spanish, French, German and Italian panels. Without these a
    // Spanish list scored higher than its English twin for saying "aroma" instead of "flavor".
    // Same `why` as the English rules on purpose: a bilingual label lists "natural flavour /
    // arôme naturel" and must be charged once, and `seen` de-duplicates by reason.
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi)\s+(?:artificial(?:es)?|artificiels?|k[üu]nstlich\w*|artificial[ei])\b|\bk[üu]nstliche[sn]?\s+aroma\b/i, pts: 18, why: 'Artificial flavour' },
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi)\s+(?:natural(?:es)?|naturels?|naturali)\b|\bnat[üu]rliche[sn]?\s+aroma\b/i, pts: 15, why: '"Natural flavors" — an undisclosed proprietary blend, not a food' },
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi)\b(?!\s+(?:natural|naturel|artificial|artificiel|k[üu]nstlich))/i, pts: 12, why: 'Unspecified flavouring' },
    { m: /\bmonosodium glutamate\b|\bmsg\b|\be621\b|\bglutamato monos[óo]dico\b|\bglutamate monosodique\b/i, pts: 16, why: 'MSG' },
    { m: /\b(autolyzed )?yeast extract\b/i,               pts: 14, why: 'Yeast extract — MSG under another name' },
    { m: /\bdisodium (inosinate|guanylate|ribonucleotides)\b|\be63[13]\b/i, pts: 12, why: 'Ribonucleotide flavour enhancer' },
    { m: /\bvanillin\b/i,                                 pts: 10, why: 'Vanillin — synthetic vanilla' },
    { m: /\bethyl vanillin\b/i,                           pts: 12, why: 'Ethyl vanillin' },
    { m: /\bsmoke flavou?r(ing)?\b/i,                     pts: 8,  why: 'Liquid smoke flavouring' },
    { m: /\btorula yeast\b/i,                             pts: 10, why: 'Torula yeast — glutamate source' },
    { m: /\bmaltol\b|\bethyl maltol\b/i,                  pts: 10, why: 'Maltol flavour enhancer' },
  ];

  // ---------------------------------------------------------------- emulsifiers, gums, thickeners
  const TEXTURE = [
    { m: /\bmono[- ]?(and|&)?[- ]?diglycerides?\b/i,   pts: 12, why: 'Mono- and diglycerides — emulsifier, a hidden trans-fat source' },
    { m: /\bpolysorbate\s*(60|65|80)?\b|\be43[35]\b/i, pts: 14, why: 'Polysorbate — associated with gut barrier disruption' },
    { m: /\bdatem\b|\bdiacetyl tartaric\b/i,           pts: 12, why: 'DATEM dough conditioner' },
    { m: /\bsodium stearoyl lactylate\b|\bsslr?\b/i,   pts: 11, why: 'Sodium stearoyl lactylate' },
    { m: /\bmethylcellulose\b|\be461\b/i,              pts: 13, why: 'Methylcellulose — industrial binder' },
    { m: /\b(carboxymethyl ?)?cellulose gum\b|\be466\b/i, pts: 12, why: 'Cellulose gum' },
    { m: /\bmicrocrystalline cellulose\b/i,            pts: 10, why: 'Microcrystalline cellulose — wood pulp filler' },
    { m: /\bpowdered cellulose\b/i,                    pts: 10, why: 'Powdered cellulose' },
    { m: /\bxanthan gum\b|\be415\b/i,                  pts: 9,  why: 'Xanthan gum' },
    { m: /\bguar gum\b|\be412\b/i,                     pts: 8,  why: 'Guar gum' },
    { m: /\bgellan gum\b|\be418\b/i,                   pts: 9,  why: 'Gellan gum' },
    { m: /\blocust bean gum\b|\be410\b/i,              pts: 7,  why: 'Locust bean gum' },
    { m: /\btara gum\b/i,                              pts: 8,  why: 'Tara gum' },
    { m: /\bacacia gum\b|\bgum acacia\b|\bgum arabic\b/i,   pts: 5,  why: 'Gum arabic' },
    { m: /\bsoy lecithin\b|\blecitina de soja\b|\bl[ée]cithine de soja\b|\bsojalecithin\b|\blecitina di soia\b/i, pts: 9,  why: 'Soy lecithin — hexane-extracted emulsifier' },
    { m: /\bsunflower lecithin\b|\blecitina de girasol\b|\bl[ée]cithine de tournesol\b|\bsonnenblumenlecithin\b|\blecitina di girasole\b/i, pts: 4,  why: 'Sunflower lecithin' },
    { m: /\bmodified (food |corn |potato |tapioca |wheat )?starch\b|\balmid[óo]n modificado\b|\bamidon modifi[ée]\b|\bmodifizierte st[äa]rke\b|\bamido modificato\b/i, pts: 14, why: 'Modified starch — chemically altered' },
    { m: /\bmaltod[eé]xtrin[ae]?\b|\bmaltodestrina\b/i,  pts: 18, why: 'Maltodextrin — raises blood sugar faster than table sugar' },
    { m: /\bcarboxymethyl\b/i,                         pts: 11, why: 'Carboxymethyl derivative' },
    { m: /\bpropylene glycol\b/i,                      pts: 14, why: 'Propylene glycol' },
    { m: /\bglycerin(e)?\b|\bglycerol\b/i,             pts: 6,  why: 'Glycerin humectant' },
  ];

  // ---------------------------------------------------------------- preservatives
  const PRESERVATIVES = [
    { m: /\bsodium (nitrite|nitrate)\b|\be25[01]\b|\bnitrito de sodio\b|\bnitrite de sodium\b|\bnatriumnitrit\b|\bnitrito di sodio\b/i, pts: 16, why: 'Synthetic nitrite — forms nitrosamines when heated' },
    { m: /\bsodium benzoate\b|\be211\b|\bbenzoato de sodio\b|\bbenzoate de sodium\b|\bnatriumbenzoat\b|\bbenzoato di sodio\b/i, pts: 13, why: 'Sodium benzoate' },
    { m: /\bpotassium sorbate\b|\be202\b|\bsorbato de potasio\b|\bsorbate de potassium\b|\bkaliumsorbat\b|\bsorbato di potassio\b/i, pts: 11, why: 'Potassium sorbate' },
    { m: /\bsorbic acid\b/i,                            pts: 10, why: 'Sorbic acid' },
    { m: /\bcalcium propionate\b|\be282\b/i,            pts: 12, why: 'Calcium propionate' },
    { m: /\bsodium (propionate|diacetate)\b/i,          pts: 11, why: 'Sodium propionate' },
    { m: /\b(disodium |calcium )?edta\b/i,              pts: 14, why: 'EDTA — a chelating agent' },
    { m: /\bsulfur dioxide\b|\bsulfites?\b|\bsodium (bi)?sulfite\b/i, pts: 12, why: 'Sulfites' },
    { m: /\bpotassium metabisulfite\b/i,                pts: 12, why: 'Potassium metabisulfite' },
    { m: /\bnatamycin\b/i,                              pts: 10, why: 'Natamycin' },
    { m: /\bnisin\b/i,                                  pts: 8,  why: 'Nisin' },
    { m: /\bpolyphosphate\b|\bsodium (tri)?polyphosphate\b/i, pts: 12, why: 'Polyphosphate' },
  ];

  // ---------------------------------------------------------------- acids, anticaking, misc aids
  const PROCESSING = [
    { m: /\bphosphoric acid\b|\be338\b/i,               pts: 14, why: 'Phosphoric acid — leaches calcium from bone' },
    { m: /\bcitric acid\b/i, exemptIf: /\bfrom (lemons?|limes?|citrus|fruit)\b/i, pts: 5,  why: 'Industrial citric acid — usually mould-fermented, not citrus' },
    { m: /\bmalic acid\b/i,                             pts: 5,  why: 'Malic acid' },
    { m: /\bfumaric acid\b/i,                           pts: 6,  why: 'Fumaric acid' },
    { m: /\blactic acid\b/i,                            pts: 5,  why: 'Industrial lactic acid' },
    { m: /\bacetic acid\b/i,                            pts: 4,  why: 'Acetic acid' },
    { m: /\bsilicon dioxide\b|\be551\b/i,               pts: 8,  why: 'Silicon dioxide anticaking agent' },
    { m: /\bcalcium silicate\b/i,                       pts: 8,  why: 'Calcium silicate' },
    { m: /\bsodium alumino?silicate\b|\balumin(i)?um (compound|phosphate|sulfate|silicate|powder)\b/i, pts: 12, why: 'Aluminium compound' },
    { m: /\bmagnesium stearate\b/i,                     pts: 7,  why: 'Magnesium stearate' },
    { m: /\btripotassium phosphate\b/i,                 pts: 10, why: 'Tripotassium phosphate' },
    { m: /\bdipotassium phosphate\b/i,                  pts: 9,  why: 'Dipotassium phosphate' },
    { m: /\b(disodium|monocalcium|dicalcium) phosphate\b/i, pts: 9, why: 'Phosphate additive' },
    { m: /\bsodium aluminum (phosphate|sulfate)\b/i,    pts: 13, why: 'Sodium aluminium phosphate' },
    { m: /\bcalcium sulfate\b/i,                        pts: 6,  why: 'Calcium sulfate' },
    { m: /\bammonium (chloride|sulfate)\b/i,            pts: 8,  why: 'Ammonium salt dough conditioner' },
    { m: /\bl[- ]?cysteine\b/i,                         pts: 10, why: 'L-cysteine dough conditioner' },
    { m: /\benzymes?\b/i, exemptIfText: /\b(cultured|cheese|milk|rennet|yogh?urt)\b/i, pts: 3, why: 'Processing enzymes' },
    { m: /^alcohol$|\bethyl alcohol\b|\bethanol\b/i,     pts: 6,  why: 'Added alcohol (preservative / solvent)' },
  { m: /\bcultured dextrose\b/i,                      pts: 9,  why: 'Cultured dextrose — a preservative in disguise' },
  // Celery powder is nitrite. It is cultured specifically to convert its natural nitrate, and USDA
  // labelling rules then permit "uncured — no nitrates or nitrites added". The chemistry reaching
  // the meat is the same as sodium nitrite; only the paperwork differs. Without this, Applegate-
  // style bacon scored 85 while the honestly-labelled nitrite version scored 37, which rewarded the
  // labelling workaround rather than the product.
  { m: /\b(cultured )?celery (juice )?powder\b|\bcelery juice concentrate\b|\bcultured celery\b/i,
    pts: 14, why: 'Celery powder — nitrite by another name, which is what "uncured" means here' },
    ];

  // ---------------------------------------------------------------- unnamed function classes
  // Some labels list the job an additive does and never the additive: "preservative", "color
  // added", "conservador", "colorante", "saborizante". That is an undisclosed additive by
  // definition, and it was free in every language — a Mexican soda scored Mediocre on nothing but
  // its sugar. Anchored to the whole entry, so "conservante: sorbato de potasio" is charged once,
  // for the sorbate, by its own rule.
  const UNNAMED = [
    { m: /^(?:preservatives?|conservad?or(?:es)?|conservantes?|conservateurs?|konservierungsstoffe?|conservanti|preservatives? added)$/i, pts: 10, why: 'Unnamed preservative' },
    { m: /^(?:colou?rs?(?: added)?|artificial colou?r added|colorantes?|colorants?|farbstoffe?|coloranti|color natural|colorante natural)$/i, pts: 8, why: 'Unnamed colour' },
    { m: /^(?:emulsifiers?|emulsionantes?|[ée]mulsifiants?|emulgator(?:en)?|emulsionanti)$/i, pts: 8, why: 'Unnamed emulsifier' },
    { m: /^(?:stabili[sz]ers?|estabilizantes?|stabilisants?|stabilisator(?:en)?|stabilizzanti|thickeners?|espesantes?|[ée]paississants?|verdickungsmittel|addensanti)$/i, pts: 6, why: 'Unnamed stabiliser or thickener' },
    { m: /^(?:acidity regulators?|acidulants?|acidulantes?|acidifiants?|s[äa]uerungsmittel|s[äa]ureregulator(?:en)?|acidificanti|correttore di acidit[àa]|regulador de acidez)$/i, pts: 4, why: 'Unnamed acidity regulator' },
    { m: /^(?:antioxidants?|antioxidantes?|antioxydants?|antioxidationsmittel|antiossidanti)$/i, pts: 4, why: 'Unnamed antioxidant' },
  ];

  // ---------------------------------------------------------------- synthetic fortification
  const FORTIFICATION = [
    { m: /\bthiamin(e)? mononitrate\b/i,        pts: 8,  why: 'Synthetic thiamine' },
    { m: /\briboflavin\b/i,                     pts: 7,  why: 'Synthetic riboflavin' },
    { m: /\bfolic acid\b/i,                     pts: 9,  why: 'Folic acid — the synthetic form, not folate' },
    { m: /\b(reduced iron|ferrous (sulfate|fumarate))\b/i, pts: 9, why: 'Elemental iron filings — the fortification form' },
    { m: /\bpyridoxine hydrochloride\b/i,       pts: 7,  why: 'Synthetic B6' },
    { m: /\bcyanocobalamin\b/i,                 pts: 7,  why: 'Cyanocobalamin — the synthetic B12 form' },
    { m: /\bzinc oxide\b/i,                     pts: 8,  why: 'Zinc oxide fortification' },
    { m: /\bniacinamide\b|\bniacin\b/i,         pts: 7,  why: 'Synthetic niacin' },
    { m: /\bcalcium carbonate\b/i,              pts: 5,  why: 'Calcium carbonate fortification' },
    { m: /\bsodium ascorbate\b|\bascorbic acid\b/i, pts: 5, why: 'Synthetic vitamin C' },
    { m: /\bvitamin a (palmitate|acetate)\b/i,  pts: 7,  why: 'Synthetic vitamin A' },
    { m: /\bd[- ]?alpha[- ]?tocopher(ol|yl)\b|\bmixed tocopherols\b/i, pts: 3, why: 'Tocopherol antioxidant' },
    { m: /\bcholecalciferol\b|\bvitamin d[23]\b/i, pts: 3, why: 'Added vitamin D' },
    { m: /\bpotassium iodide\b/i,               pts: 3,  why: 'Added iodine' },
    { m: /\bsodium selenite\b/i,                pts: 6,  why: 'Sodium selenite' },
  ];

  // ---------------------------------------------------------------- grains, gluten, legumes
  const GRAINS = [
    { m: /\benriched (wheat |bleached |unbleached )?flour\b/i, pts: 15, why: 'Enriched flour — stripped, then synthetically re-dosed' },
    { m: /\b(bleached|refined|white) flour\b/i,     pts: 14, why: 'Refined white flour' },
    { m: /\bwheat flour\b|\bharina de trigo\b|\bfarine de bl[ée]\b|\bweizenmehl\b|\bfarina di (?:grano|frumento)\b/i, pts: 12, why: 'Wheat flour' },
    { m: /\bwheat\b/i,                              pts: 9,  why: 'Wheat', gluten: true },
    { m: /\bbarley\b/i,                             pts: 8,  why: 'Barley', gluten: true },
    { m: /\brye\b/i,                                pts: 8,  why: 'Rye', gluten: true },
    { m: /\bsemolina\b|\bdurum\b/i,                 pts: 10, why: 'Durum semolina', gluten: true },
    { m: /\bspelt\b/i,                              pts: 5,  why: 'Spelt', gluten: true },
    { m: /\btriticale\b/i,                          pts: 8,  why: 'Triticale', gluten: true },
    { m: /\bmalted barley( flour)?\b/i,             pts: 8,  why: 'Malted barley', gluten: true },
    { m: /\bcorn ?(flour|meal|starch|masa)\b|\bcornstarch\b|\bcornmeal\b/i, pts: 7,  why: 'Corn flour or starch' },
    { m: /\boat (flour|fiber)\b/i,                  pts: 5,  why: 'Oat flour' },
    { m: /\brice flour\b/i,                         pts: 6,  why: 'Rice flour' },
    { m: /\bsoy(bean)? (flour|grits)\b/i,           pts: 12, why: 'Soy flour' },
    { m: /\bchickpea flour\b|\bgram flour\b/i,      pts: 5,  why: 'Chickpea flour' },
    { m: /\blentil flour\b/i,                       pts: 5,  why: 'Lentil flour' },
    { m: /\bpotato (starch|flour)\b/i,              pts: 5,  why: 'Potato starch' },
    { m: /\btapioca (starch|flour)\b/i,             pts: 4,  why: 'Tapioca starch' },
    { m: /\bwheat (bran|germ|starch)\b/i,           pts: 7,  why: 'Wheat fraction', gluten: true },
  ];

  // Traditional preparation (sourdough, sprouting, soaking) removes the grain penalty.
  const TRADITIONAL_PREP = /\b(sourdough|sprouted|soaked|long[- ]?fermented|naturally leavened|einkorn|emmer|khorasan|kamut|heritage (wheat|grain))\b/i;

  const _exports = AIRmodule('additives', {
    CAPS, ISOLATES, FLAVOURS, TEXTURE, PRESERVATIVES, PROCESSING, FORTIFICATION, GRAINS, UNNAMED, TRADITIONAL_PREP,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
