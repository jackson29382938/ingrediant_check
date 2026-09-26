// Additives, isolates, and industrial processing aids.
//
// Each entry carries the sentence the user actually reads in the panel. `why` is product copy, not
// a code comment — keep it plain, specific, and free of hedging.
//
// tier: 'cap'   — presence sets a hard ceiling on the whole score
//       'heavy' / 'moderate' / 'light' — point penalties, position-weighted by the caller
//
// EU labels name most additives by E-number ("Emulsifier: E322", "E471", "E 202"), and the
// rulebase knew sixteen of them, so "sweeteners (E951, E950)" scored 65 where "aspartame,
// acesulfame K" scored 22. Every rule that has a code carries it as `\be[- ]?NNN\b`, which
// accepts "E322", "e-322" and "E 322".

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

// Manifest-declared content scripts share one top-level scope, so every const here
// must stay inside this closure or it collides with the other rule files at load time.
(function () {

  // ---------------------------------------------------------------- hard caps
  const CAPS = [
    { m: /\b(red\s*(no\.?\s*)?40|allura red|e[- ]?129|rojo\s*40|rouge\s*40)\b/i, cat: 'colour', cap: 18, why: 'Red 40 artificial colour' },
    { m: /\b(red\s*(no\.?\s*)?3|erythrosine|e[- ]?127)\b/i,          cat: 'colour', cap: 18, why: 'Red 3 artificial colour' },
    { m: /\b(yellow\s*(no\.?\s*)?5|tartrazine|tartrazina|e[- ]?102|amarillo\s*5|jaune\s*5)\b/i, cat: 'colour', cap: 18, why: 'Yellow 5 artificial colour' },
    { m: /\b(yellow\s*(no\.?\s*)?6|sunset yellow|e[- ]?110|amarillo\s*6|jaune\s*6)\b/i, cat: 'colour', cap: 18, why: 'Yellow 6 artificial colour' },
    { m: /\b(blue\s*(no\.?\s*)?1|brilliant blue|e[- ]?133|azul\s*1|bleu\s*1)\b/i, cat: 'colour', cap: 18, why: 'Blue 1 artificial colour' },
    { m: /\b(blue\s*(no\.?\s*)?2|indigotine|e[- ]?132)\b/i,          cat: 'colour', cap: 18, why: 'Blue 2 artificial colour' },
    { m: /\b(green\s*(no\.?\s*)?3|fast green)\b/i,              cat: 'colour', cap: 18, why: 'Green 3 artificial colour' },
    // Azo dyes sold in the EU and not the US. E102, E104, E110, E122, E124 and E129 carry a
    // mandatory "may have an adverse effect on activity and attention in children" warning there.
    { m: /\bquinoline yellow\b|\be[- ]?104\b/i,                     cat: 'colour', cap: 18, why: 'Quinoline yellow (E104) artificial colour' },
    { m: /\b(carmoisine|azorubine)\b|\be[- ]?122\b/i,               cat: 'colour', cap: 18, why: 'Carmoisine (E122) artificial colour' },
    { m: /\bponceau 4r\b|\bcochineal red a\b|\be[- ]?124\b/i,       cat: 'colour', cap: 18, why: 'Ponceau 4R (E124) artificial colour' },
    { m: /\bpatent blue\b|\be[- ]?131\b/i,                         cat: 'colour', cap: 18, why: 'Patent blue V (E131) artificial colour' },
    { m: /\bgreen s\b|\be[- ]?142\b/i,                             cat: 'colour', cap: 18, why: 'Green S (E142) artificial colour' },
    { m: /\bbrilliant black\b|\bblack pn\b|\be[- ]?151\b/i,       cat: 'colour', cap: 18, why: 'Brilliant black (E151) artificial colour' },
    { m: /\bbrown ht\b|\be[- ]?155\b/i,                            cat: 'colour', cap: 18, why: 'Brown HT (E155) artificial colour' },
    { m: /\btitanium dioxide\b|\be[- ]?171\b|\bdi[óo]xido de titanio\b|\bdioxyde de titane\b/i, cat: 'colour', cap: 18, why: 'Titanium dioxide — banned as a food additive in the EU' },
    { m: /\bartificial colou?rs?\b|\bcolorantes?\s+artificiales?\b|\bcolorants?\s+artificiels?\b/i, cat: 'colour', cap: 20, why: 'Artificial colour' },
    { m: /\bcaramel colou?r(ing)?\b|\be[- ]?150[a-d]?\b|\bcolor(ante)? caramelo\b|\bcolorant caramel\b/i, cat: 'colour', cap: 30, why: 'Caramel colour' },
    { m: /\bcarrageenan\b|\be[- ]?407a?\b|\bcarragenina\b|\bcarragh[ée]nane\b/i, cat: 'carrageenan', cap: 40, why: 'Carrageenan — linked to gut inflammation' },
    { m: /\b(bha|butylated hydroxyanisole|e[- ]?320)\b/i,            cat: 'strongPreservative', cap: 45, why: 'BHA preservative' },
    { m: /\b(bht|butylated hydroxytoluene|e[- ]?321)\b/i,            cat: 'strongPreservative', cap: 45, why: 'BHT preservative' },
    { m: /\b(tbhq|tert(?:iary)?[- ]?butyl ?hydroquinone|e[- ]?319)\b/i, cat: 'strongPreservative', cap: 45, why: 'TBHQ preservative' },
    { m: /\bpropyl(ene)? gallate\b|\be[- ]?31[0-2]\b/i,                  cat: 'strongPreservative', cap: 45, why: 'Propyl gallate' },
    { m: /\b(?:sodium )?propyl ?paraben\b|\be[- ]?21[67]\b/i,          cat: 'strongPreservative', cap: 45, why: 'Propylparaben — banned as a food additive in the EU' },
    { m: /\bpotassium bromate\b|\bbromated\b|\be[- ]?924a?\b/i,                              cat: 'processingAid', cap: 15, why: 'Potassium bromate — banned in the EU, UK, and Canada' },
    { m: /\bazodicarbonamide\b|\be[- ]?927a?\b/i,                               cat: 'processingAid', cap: 20, why: 'Azodicarbonamide — the "yoga mat" dough conditioner' },
    { m: /\bolestra\b/i,                                        cat: 'processingAid', cap: 15, why: 'Olestra' },
    { m: /\bbrominated vegetable oil\b|\bbvo\b/i,               cat: 'processingAid', cap: 15, why: 'Brominated vegetable oil' },
  ];

  // ---------------------------------------------------------------- protein isolates
  const ISOLATES = [
    { m: /\bsoy protein (isolate|concentrate)\b|\baislado de prote[íi]na de soja\b|\bisolat de prot[ée]ine de soja\b|\bsojaproteinisolat\b|\bisolato di proteine di soia\b|\bprote[íi]na isolada de soja\b|\bge[iï]soleerd(?:e)?\s+sojaprote[iï]ne\b|\bsoja[- ]?eiwitisolaat\b/i, pts: 22, why: 'Soy protein isolate — hexane-extracted industrial protein' },
    { m: /\bpea protein( isolate| concentrate)?\b/i, pts: 18, why: 'Pea protein isolate' },
    { m: /\brice protein( isolate)?\b/i,             pts: 15, why: 'Rice protein isolate' },
    { m: /\btextured (vegetable|soy) protein\b|\btvp\b/i, pts: 22, why: 'Textured vegetable protein' },
    { m: /\bwheat protein isolate\b|\bvital wheat gluten\b/i, pts: 18, why: 'Isolated wheat gluten' },
    { m: /\bhydrolyzed (soy |vegetable |wheat |corn )?protein\b|\bprote[íi]na(?: vegetal)? hidrolizada\b|\bprot[ée]ines? hydrolys[ée]e?s?\b|\bhydrolysiertes? (?:eiwei[ßs]|protein)\b|\bprotein[ae] idrolizzat[ae]\b/i, pts: 18, why: 'Hydrolyzed protein — a hidden glutamate source' },
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
    { m: /\bnatural (and artificial )?flavou?rs?\b/i,     pts: 15, cat: 'naturalFlavour', why: '"Natural flavors" — an undisclosed proprietary blend, not a food' },
    { m: /\bnatural [a-z]+ flavou?rs?\b/i,                pts: 15, cat: 'naturalFlavour', why: '"Natural flavor" — undisclosed proprietary flavour compound' },
  // Mirror of the natural-flavour catch-all. Without it "artificial butter flavor" and
  // "artificial vanilla flavor" slipped past every flavour rule entirely.
  { m: /\bartificial [a-z]+ flavou?rs?\b/i,             pts: 18, why: 'Artificial flavour compound' },
    // Bare "flavor" / "flavors" is the same undisclosed blend without the adjective.
    { m: /\bflavou?ring\b|^flavou?rs?$|\bsaborizantes?\b|\baromatizantes?\b|\bsabor (?:natural|artificial|id[ée]ntico al natural)\b/i, pts: 12, why: 'Unspecified flavouring' },
    // The same undisclosed blend on Spanish, French, German, Italian, Portuguese and Dutch panels.
    // Same `why` as the English rules on purpose: a bilingual label lists "natural flavour /
    // arôme naturel" and must be charged once, and `seen` de-duplicates by reason.
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi)\s+(?:artificial(?:es)?|artificiels?|k[üu]nstlich\w*|artificial[ei]|kunstmatig\w*)\b|\bk[üu]nstliche[sn]?\s+aroma\b|\bkunstmatig(?:e)?\s+aroma\b/i, pts: 18, why: 'Artificial flavour' },
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi)\s+(?:natural(?:es)?|naturels?|naturali|natuurlijk\w*)\b|\bnat[üu]rliche[sn]?\s+aroma\b|\bnatuurlijk(?:e)?\s+aroma\b/i, pts: 15, cat: 'naturalFlavour', why: '"Natural flavors" — an undisclosed proprietary blend, not a food' },
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi)\b(?!\s+(?:natural|naturel|artificial|artificiel|k[üu]nstlich|kunstmatig|natuurlijk))/i, pts: 12, why: 'Unspecified flavouring' },
    { m: /\bmonosodium glutamate\b|\bmsg\b|\be[- ]?62[0-5]\b|\bglutamic acid\b|\b(?:mono)?potassium glutamate\b|\bcalcium diglutamate\b|\bglutamato monos[óo]dico\b|\bglutamate monosodique\b|\bglutamato monoss[óo]dico\b/i, pts: 16, why: 'MSG' },
    { m: /\b(autolyzed )?yeast extract\b|\bextracto de levadura\b|\bextrait de levure\b|\bhefeextrakt\b|\bestratto di lievito\b|\bextrato de levedura\b|\bgistextract\b/i, pts: 14, why: 'Yeast extract — MSG under another name' },
    { m: /\bdisodium (inosinate|guanylate|5'?[- ]?ribonucleotides?)\b|\b(?:di)?potassium (inosinate|guanylate)\b|\be[- ]?6(?:2[6-9]|3[0-5])\b/i, pts: 12, why: 'Ribonucleotide flavour enhancer' },
    { m: /\bvanillin\b|\bvainillina\b|\bvanilline\b|\bvanillina\b|\bvaniline\b|\bvanilina\b/i, pts: 10, why: 'Vanillin — synthetic vanilla' },
    { m: /\bethyl vanillin\b/i,                           pts: 12, why: 'Ethyl vanillin' },
    // "natural smoke flavor" is charged once, by the natural-flavour rule above.
    { m: /(?<!natural |artificial )\bsmoke flavou?r(ing)?\b/i, pts: 8,  why: 'Liquid smoke flavouring' },
    { m: /\btorula yeast\b/i,                             pts: 10, why: 'Torula yeast — glutamate source' },
    { m: /\bmaltol\b|\bethyl maltol\b/i,                  pts: 10, why: 'Maltol flavour enhancer' },
  ];

  // ---------------------------------------------------------------- emulsifiers, gums, thickeners
  const TEXTURE = [
    // "mono- and diglycerides" — hyphen, space, "and", space — is the usual US spelling, and the
    // single optional separator on each side of "and" never matched it.
    { m: /\bmono[- ]*(?:and|&)?[- ]*di[- ]?glycerides?\b|\bmonoglycerides?\b|\bdiglycerides?\b|\be[- ]?47[01][ab]?\b|\be[- ]?472[a-df]\b|\bmono- und diglyceride\b|\bmono- y diglic[ée]ridos\b|\bmono- et diglyc[ée]rides\b|\bmono- e digliceridi\b/i,   pts: 12, why: 'Mono- and diglycerides — emulsifier, a hidden trans-fat source' },
    { m: /\bpoly(?:sorbate|sorbat[eo]?)\s*(20|40|60|65|80)?\b|\bpoli(?:s|ss)orbato\s*(20|40|60|65|80)?\b|\bpolysorbaat\s*(20|40|60|65|80)?\b|\be[- ]?43[2-6]\b/i, pts: 14, why: 'Polysorbate — associated with gut barrier disruption' },
    { m: /\bdatem\b|\bdiacetyl tartaric\b|\be[- ]?472e\b/i,           pts: 12, why: 'DATEM dough conditioner' },
    { m: /\b(sodium|calcium) stearoyl[- ]2?[- ]?lactylate\b|\bsslr?\b|\be[- ]?48[12]\b/i,   pts: 11, why: 'Sodium stearoyl lactylate' },
    { m: /\b(hydroxypropyl )?methylcellulose\b|\bhpmc\b|\be[- ]?46[1-5]\b/i,              pts: 13, why: 'Methylcellulose — industrial binder' },
    { m: /\b(carboxymethyl ?)?cellulose gum\b|\be[- ]?46[6-9]\b/i, pts: 12, why: 'Cellulose gum' },
    { m: /\bmicrocrystalline cellulose\b|\be[- ]?460\b/i,            pts: 10, why: 'Microcrystalline cellulose — wood pulp filler' },
    { m: /\bpowdered cellulose\b/i,                    pts: 10, why: 'Powdered cellulose' },
    { m: /\bxanthan gum\b|\bgoma xantana\b|\bgomme xanthane\b|\bxanthan\b|\be[- ]?415\b/i,                  pts: 9,  why: 'Xanthan gum' },
    { m: /\bguar gum\b|\bgoma guar\b|\bgomme (de )?guar\b|\bguarkernmehl\b|\be[- ]?412\b/i,                     pts: 8,  why: 'Guar gum' },
    { m: /\bgellan gum\b|\bgoma gellan\b|\bgomme gellane\b|\bgellangummi\b|\bgomma gellan\b|\bgoma gelana\b|\bgellangom\b|\be[- ]?418\b/i, pts: 9,  why: 'Gellan gum' },
    { m: /\blocust bean gum\b|\bcarob (bean )?gum\b|\bjohannisbrotkernmehl\b|\bgoma (?:garrof[íi]n|de algarrobo)\b|\bgomme (?:de )?caroube\b|\bfarina di carrube\b|\be[- ]?410\b/i, pts: 7,  why: 'Locust bean gum' },
    { m: /\btara gum\b|\be[- ]?417\b/i,                              pts: 8,  why: 'Tara gum' },
    { m: /\bacacia gum\b|\bgum acacia\b|\bgum arabic\b|\bgoma ar[áa]biga\b|\bgomme arabique\b|\bgummi arabicum\b|\bgomma arabica\b|\bgoma ar[áa]bica\b|\barabische gom\b|\be[- ]?414\b/i, pts: 5,  why: 'Gum arabic' },
    { m: /\bsoy lecithin\b|\blecitina de soja\b|\bl[ée]cithine de soja\b|\bsojalecithin\b|\blecitina di soia\b|\bsojalecithine\b/i, pts: 9,  why: 'Soy lecithin — hexane-extracted emulsifier' },
    { m: /\bsunflower lecithin\b|\blecitina de girasol\b|\bl[ée]cithine de tournesol\b|\bsonnenblumenlecithin\b|\blecitina di girasole\b|\blecitina de girassol\b|\bzonnebloemlecithine\b/i, pts: 4,  why: 'Sunflower lecithin' },
    // "Lecithin" with no source, or E322 — which is most EU chocolate. Between the two lecithins
    // above, because the source is exactly what the label declined to say.
    { m: /^(?:lecithins?|lecitin[ae]s?|l[ée]cithines?|lecithine?)$|\be[- ]?322\b/i, pts: 7,  why: 'Lecithin — emulsifier, source not stated' },
    { m: /\bmodified (food |corn |potato |tapioca |wheat )?starch\b|\be[- ]?14[0-5]\d\b|\balmid[óo]n modificado\b|\bamidon modifi[ée]\b|\bmodifizierte st[äa]rke\b|\bamido modificato\b|\bamido modificado\b|\bgemodificeerd zetmeel\b/i, pts: 14, why: 'Modified starch — chemically altered' },
    { m: /\bmaltod[eé]xtrin[ae]?\b|\bmaltodestrina\b|\bmaltodextrine\b/i,  pts: 18, why: 'Maltodextrin — raises blood sugar faster than table sugar' },
    { m: /\bcarboxymethyl\b/i,                         pts: 11, why: 'Carboxymethyl derivative' },
    { m: /\bpropylene glycol\b|\be[- ]?1520\b/i,                      pts: 14, why: 'Propylene glycol' },
    { m: /\bglycerin(e)?\b|\bglycerol\b|\bglicerina\b|\bglyc[ée]rine\b|\bglicerolo\b|\bglycerine\b|\be[- ]?422\b/i, pts: 6,  why: 'Glycerin humectant' },
  ];

  // ---------------------------------------------------------------- preservatives
  const PRESERVATIVES = [
    { m: /\b(sodium|potassium) (nitrite|nitrate)\b|\be[- ]?25[0-2]\b|\be[- ]?249\b|\bnitrito de sodio\b|\bnitrite de sodium\b|\bnatriumnitrit\b|\bnitrito di sodio\b|\bnitrito de s[óo]dio\b|\bnatriumnitriet\b/i, pts: 16, why: 'Synthetic nitrite — forms nitrosamines when heated' },
    { m: /\b(sodium|potassium|calcium) benzoate\b|\bbenzoic acid\b|\be[- ]?21[0-3]\b|\bbenzoato de sodio\b|\bbenzoate de sodium\b|\bnatriumbenzoat\b|\bbenzoato di sodio\b|\bbenzoato de s[óo]dio\b|\bnatriumbenzoaat\b/i, pts: 13, why: 'Sodium benzoate' },
    { m: /\b(potassium|calcium|sodium) sorbate\b|\be[- ]?20[1-3]\b|\bsorbato de potasio\b|\bsorbate de potassium\b|\bkaliumsorbat\b|\bsorbato di potassio\b|\bsorbato de pot[áa]ssio\b|\bkaliumsorbaat\b/i, pts: 11, why: 'Potassium sorbate' },
    { m: /\bsorbic acid\b|(?:^|[^a-z])[aá]cido s[oó]rbico(?:$|[^a-z])|\bacide sorbique\b|\bsorbins[äa]ure\b|\bsorbinezuur\b|\be[- ]?200\b/i, pts: 10, why: 'Sorbic acid' },
    { m: /\bcalcium propionate\b|\bpropionato de calcio\b|\bpropionate de calcium\b|\bcalciumpropionat\b|\bpropionato di calcio\b|\bpropionato de c[áa]lcio\b|\bcalciumpropionaat\b|\be[- ]?282\b/i, pts: 12, why: 'Calcium propionate' },
    { m: /\b(sodium|potassium) propionate\b|\bpropionic acid\b|\bsodium diacetate\b|\be[- ]?28[013]\b/i,          pts: 11, why: 'Sodium propionate' },
    { m: /\b(disodium |calcium (disodium )?)?edta\b|\be[- ]?38[56]\b/i,              pts: 14, why: 'EDTA — a chelating agent' },
    { m: /\bsulfur dioxide\b|\bsul(?:ph|f)ites?\b|\bsulfitos?\b|\bsolfiti\b|\bschwefeldioxid\b|\bsodium (bi|meta)?sul(?:ph|f)ite\b|\be[- ]?22[0-8]\b/i, pts: 12, why: 'Sulfites' },
    { m: /\bpotassium metabisulfite\b/i,                pts: 12, why: 'Potassium metabisulfite' },
    { m: /\bnatamycin\b|\be[- ]?235\b/i,                              pts: 10, why: 'Natamycin' },
    { m: /\bnisin\b|\be[- ]?234\b/i,                                  pts: 8,  why: 'Nisin' },
    { m: /\bpolyphosphates?\b|\bsodium (tri)?polyphosphate\b|\b(di|tri)phosphates?\b|\be[- ]?45[0-2]\b/i, pts: 12, why: 'Polyphosphate' },
  ];

  // ---------------------------------------------------------------- acids, anticaking, misc aids
  const PROCESSING = [
    { m: /\bphosphoric acid\b|\be[- ]?338\b/i,               pts: 14, why: 'Phosphoric acid — leaches calcium from bone' },
    { m: /\bcitric acid\b|(?:^|[^a-z])[aá]cido c[ií]trico(?:$|[^a-z])|\bacide citrique\b|\bcitronens[äa]ure\b|\bcitroenzuur\b|\be[- ]?330\b/i, exemptIf: /\bfrom (lemons?|limes?|citrus|fruit)\b/i, pts: 5,  why: 'Industrial citric acid — usually mould-fermented, not citrus' },
    { m: /\bmalic acid\b|\be[- ]?296\b/i,                             pts: 5,  why: 'Malic acid' },
    { m: /\bfumaric acid\b|\be[- ]?297\b/i,                           pts: 6,  why: 'Fumaric acid' },
    { m: /\blactic acid\b|(?:^|[^a-z])[aá]cido (?:l[aá]ctico|lattico)(?:$|[^a-z])|\bacide lactique\b|\bmilchs[äa]ure\b|\bmelkzuur\b|\be[- ]?270\b/i, pts: 5,  why: 'Industrial lactic acid' },
    { m: /\bacetic acid\b|\be[- ]?260\b/i,                            pts: 4,  why: 'Acetic acid' },
    { m: /\bsilicon dioxide\b|\bsilica\b|\bdi[óo]xido de silicio\b|\bdioxyde de silicium\b|\bsiliziumdioxid\b|\bdiossido di silicio\b|\bdi[óo]xido de sil[ií]cio\b|\bsiliciumdioxide\b|\be[- ]?551\b/i, pts: 8,  why: 'Silicon dioxide anticaking agent' },
    { m: /\bcalcium silicate\b|\be[- ]?552\b/i,                       pts: 8,  why: 'Calcium silicate' },
    { m: /\bsodium alumino?silicate\b|\be[- ]?55[4-6]\b|\be[- ]?173\b|\balumin(i)?um (compound|phosphate|sulfate|silicate|powder)\b/i, pts: 12, why: 'Aluminium compound' },
    { m: /\bmagnesium stearate\b|\be[- ]?572\b/i,                     pts: 7,  why: 'Magnesium stearate' },
    { m: /\btripotassium phosphate\b|\be[- ]?340\b/i,                 pts: 10, why: 'Tripotassium phosphate' },
    { m: /\bdipotassium phosphate\b/i,                  pts: 9,  why: 'Dipotassium phosphate' },
    { m: /\b(disodium|trisodium|monocalcium|dicalcium|tricalcium|monosodium|monopotassium|calcium|sodium|potassium) phosphates?\b|\be[- ]?339\b|\be[- ]?341\b/i, pts: 9, why: 'Phosphate additive' },
    { m: /\bsodium alumini?um (phosphate|sulfate)\b|\be[- ]?541\b/i,    pts: 13, why: 'Sodium aluminium phosphate' },
    { m: /\bcalcium sulph?ate\b|\be[- ]?516\b/i,                        pts: 6,  why: 'Calcium sulfate' },
    { m: /\bammonium (chloride|sulph?ate)\b|\be[- ]?510\b/i,            pts: 8,  why: 'Ammonium salt dough conditioner' },
    { m: /\bl[- ]?cysteine\b|\be[- ]?92[01]\b/i,                         pts: 10, why: 'L-cysteine dough conditioner' },
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
    { m: /^(?:preservatives?|conservad?or(?:es)?|conservantes?|conservateurs?|konservierungsstoffe?|conservanti|conserveermiddel(?:en)?|preservatives? added)$/i, pts: 10, why: 'Unnamed preservative' },
    { m: /^(?:colou?rs?(?: added)?|artificial colou?r added|colorantes?|colorants?|farbstoffe?|coloranti|kleurstoffen?|color natural|colorante natural)$/i, pts: 8, why: 'Unnamed colour' },
    { m: /^(?:emulsifiers?|emulsionantes?|[ée]mulsifiants?|emulgator(?:en)?|emulsionanti|emulgatoren)$/i, pts: 8, why: 'Unnamed emulsifier' },
    { m: /^(?:stabili[sz]ers?|estabilizantes?|stabilisants?|stabilisator(?:en)?|stabilizzanti|thickeners?|espesantes?|[ée]paississants?|verdickungsmittel|addensanti|verdikkingsmiddelen?|stabilisatoren)$/i, pts: 6, why: 'Unnamed stabiliser or thickener' },
    { m: /^(?:acidity regulators?|acidulants?|acidulantes?|acidifiants?|s[äa]uerungsmittel|s[äa]ureregulator(?:en)?|acidificanti|correttore di acidit[àa]|regulador de acidez|aciditeitsregelaar(?:s)?)$/i, pts: 4, why: 'Unnamed acidity regulator' },
    { m: /^(?:antioxidants?|antioxidantes?|antioxydants?|antioxidationsmittel|antiossidanti|antioxidanten)$/i, pts: 4, why: 'Unnamed antioxidant' },
  ];

  // ---------------------------------------------------------------- synthetic fortification
  const FORTIFICATION = [
    { m: /\bthiamin(e)? mononitrate\b/i,        pts: 8,  why: 'Synthetic thiamine' },
    { m: /\briboflavin\b|\be[- ]?101\b/i,                     pts: 7,  why: 'Synthetic riboflavin' },
    { m: /\bfolic acid\b/i,                     pts: 9,  why: 'Folic acid — the synthetic form, not folate' },
    { m: /\b(reduced iron|ferrous (sulfate|fumarate))\b/i, pts: 9, why: 'Elemental iron filings — the fortification form' },
    { m: /\bpyridoxine hydrochloride\b/i,       pts: 7,  why: 'Synthetic B6' },
    { m: /\bcyanocobalamin\b/i,                 pts: 7,  why: 'Cyanocobalamin — the synthetic B12 form' },
    { m: /\bzinc oxide\b/i,                     pts: 8,  why: 'Zinc oxide fortification' },
    { m: /\bniacinamide\b|\bniacin\b/i,         pts: 7,  why: 'Synthetic niacin' },
    { m: /\bcalcium carbonate\b|\be[- ]?170\b/i,              pts: 5,  why: 'Calcium carbonate fortification' },
    { m: /\b(sodium|calcium) ascorbate\b|\bascorbic acid\b|\bascorbyl palmitate\b|(?:^|[^a-z])[aá]cido asc[oó]rbico(?:$|[^a-z])|\bacide ascorbique\b|\bascorbins[äa]ure\b|\bascorbinezuur\b|\be[- ]?30[0-4]\b/i, pts: 5, why: 'Synthetic vitamin C' },
    { m: /\bvitamin a (palmitate|acetate)\b/i,  pts: 7,  why: 'Synthetic vitamin A' },
    { m: /\bd[- ]?alpha[- ]?tocopher(ol|yl)\b|\bmixed tocopherols\b|\btocopherols?\b|\be[- ]?30[6-9]\b/i, pts: 3, why: 'Tocopherol antioxidant' },
    { m: /\bcholecalciferol\b|\bvitamin d[23]\b/i, pts: 3, why: 'Added vitamin D' },
    { m: /\bpotassium iodide\b/i,               pts: 3,  why: 'Added iodine' },
    { m: /\bsodium selenite\b/i,                pts: 6,  why: 'Sodium selenite' },
  ];

  // ---------------------------------------------------------------- grains, gluten, legumes
  const GRAINS = [
    { m: /\benriched (wheat |bleached |unbleached )?flour\b/i, pts: 15, why: 'Enriched flour — stripped, then synthetically re-dosed' },
    { m: /\b(bleached|refined|white) flour\b/i,     pts: 14, why: 'Refined white flour' },
    { m: /\bwheat flour\b|\bharina(?:\s+integral)?\s+de\s+trigo\b|\bfarine(?:\s+(?:compl[èe]te|int[ée]grale))?\s+de\s+bl[ée](?:$|[^a-z])|\b(?:vollkorn)?weizenmehl\b|\bvollkornweizenmehl\b|\bfarina(?:\s+integrale)?\s+di\s+(?:grano|frumento)\b|\bfarinha(?:\s+integral)?\s+de\s+trigo\b|\b(?:volkoren)?tarwemeel\b/i, pts: 12, why: 'Wheat flour' },
    { m: /\bwheat\b|\btrigo\b|\bbl[ée](?:$|[^a-z])|\bweizen\b|\bfrumento\b|\btarwe\b/i, pts: 9,  why: 'Wheat', gluten: true },
    { m: /\bbarley\b|\bcebada\b|\borge\b|\bgerste\b|\borzo\b|\bcevada\b|\bgerst\b/i, pts: 8,  why: 'Barley', gluten: true },
    { m: /\brye\b|\bcenteno\b|\bseigle\b|\broggen\b|\bsegale\b|\bcenteio\b|\brogge\b/i, pts: 8,  why: 'Rye', gluten: true },
    { m: /\bsemolina\b|\bdurum\b|\bs[ée]mola\b|\bsemoule\b|\b(?:hartweizen)?grie[ßs]\b|\bs[ée]mola\b|\bgriesmeel\b/i, pts: 10, why: 'Durum semolina', gluten: true },
    { m: /\bspelt\b/i,                              pts: 5,  why: 'Spelt', gluten: true },
    { m: /\btriticale\b/i,                          pts: 8,  why: 'Triticale', gluten: true },
    { m: /\bmalted barley( flour)?\b/i,             pts: 8,  why: 'Malted barley', gluten: true },
    { m: /\bcorn ?(flour|meal|starch|masa)\b|\bcornstarch\b|\bcornmeal\b|\balmid[óo]n de ma[ií]z\b|\bamidon de ma[ïi]s\b|\bmaisst[äa]rke\b|\bamido di mais\b|\bamido de milho\b|\bma[iï]szetmeel\b/i, pts: 7,  why: 'Corn flour or starch' },
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
  // ---------------------------------------------------------------- nuts, seeds & legumes
  // Off for everyone by default (the plantDefense weight is 0). Only the animal-based goal counts
  // these, on the view that plant defence compounds (lectins, phytates, oxalates) are worth avoiding.
  // Anchored so nutmeg, coconut, pea protein and seed oils are not caught: oils have their own rules.
  // The exclusions after a legume cover how stores write oil and lecithin, not only English:
  // Turkish soy lecithin is "soya lesitini" and soy oil "soya yağı". Matched as a legume, the lecithin
  // was also counted as recognised text, and that lifted a Turkish chocolate list over the coverage
  // gate it had been declined by (tests/languages.test.js).
  const PLANTS = [
    { m: /\b(?:beans?|lentils?|chickpeas?|garbanzos?|split peas|(?<!pea )peas\b|peanuts?|soy ?beans?|soya|edamame|tofu|tempeh)\b(?!\s+(?:oil|protein|lecithin|l[eé][cs]it|lecyt|ya[gğ]))/i,
      pts: 8, why: 'Legumes — lectins and phytates' },
    { m: /\b(?:almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?)\b(?!\s+(?:oil|milk))/i,
      pts: 6, why: 'Tree nuts — phytates and oxalates' },
    { m: /\b(?:chia|flax(?:seed)?s?|linseed|sesame(?: seeds?)?|(?:sunflower|pumpkin|hemp|poppy) seeds?)\b(?!\s+oil)/i,
      pts: 6, why: 'Seeds — phytates and plant defence compounds' },
  ];

  const TRADITIONAL_PREP = /\b(sourdough|sprouted|soaked|long[- ]?fermented|naturally leavened|einkorn|emmer|khorasan|kamut|heritage (wheat|grain))\b/i;

  const _exports = AIRmodule('additives', {
    CAPS, ISOLATES, FLAVOURS, TEXTURE, PRESERVATIVES, PROCESSING, FORTIFICATION, GRAINS, UNNAMED, TRADITIONAL_PREP, PLANTS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
