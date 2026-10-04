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
    { m: /\b(blue\s*(no\.?\s*)?2|indigotine|indigo carmine|e[- ]?132)\b/i, cat: 'colour', cap: 18, why: 'Blue 2 artificial colour' },
    { m: /\bcitrus red\s*(no\.?\s*)?2\b/i,                      cat: 'colour', cap: 18, why: 'Citrus Red 2 — permitted in the US only on orange peel' },
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
    // Caramel colour in each label language: "sockerkulör", "Zuckerkulör" and "caramello semplice"
    // were read as nothing, so a cola scored like sparkling water where "caramel colour" caps it.
    { m: /\bcaramel colou?r(ing)?\b|\be[- ]?150[a-d]?\b|\bcolor(ante)? caramelo\b|\bcolorant caramel\b|\bcaramel (?:ordinaire|de sulfite caustique|ammoniacal|au sulfite d['’]ammonium)\b|\b(?:caustic sul(?:ph|f)ite|sul(?:ph|f)ite ammonia|ammonia) caramel\b|\bcouleur caramel\b|(?<![a-zß-ÿ\u0100-\u017f])(?:sockerkul[öo]r|zuckerkul[öo]r|zuckercouleur|karamellf[äa]rg|karamelkleur|karmel (?:amoniakalno(?:-siarczynowy)?|siarczynowy|zwyk[łl]y)|(?:amonyum s[üu]lfit|kostik s[üu]lfit|sade) karamel|karamel renklendirici)(?![a-zß-ÿ\u0100-\u017f])|\bcaramello (?:semplice|solfitico|ammoniacale|caustico)\b|\bcorante caramelo\b/i, cat: 'colour', cap: 30, why: 'Caramel colour' },
    { m: /\bcarrageenan\b|\bcarragh[ée]nanes?\b|\bkarragenan\b|\bcarrageen\b|\bkarrageen\b|\bcarragenano\b|\bkarragen\b|\bkaragenan\b|\be[- ]?407a?\b|\bcarragenina\b|\bcarragenanos?\b|\bcarragenine\b|\bcarragh[ée]nane\b/i, cat: 'carrageenan', cap: 40, why: 'Carrageenan — thickener' },
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
    { m: /\bsoya? protein (isolate|concentrate)\b|\baislado de prote[íi]na de soja\b|\bisolat de prot[ée]ine de soja\b|\bsojaproteinisolat\b|\bisolato di proteine di soia\b|\bprote[íi]na isolada de soja\b|\bge[iï]soleerd(?:e)?\s+sojaprote[iï]ne\b|\bsoja[- ]?eiwitisolaat\b/i, pts: 22, why: 'Soy protein isolate — isolated protein' },
    { m: /\bpea protein( isolate| concentrate)?\b|\bprot[ée]ines? de pois\b|\bprote[íi]nas? de guisante\b|\berbsenprotein\b|\berwteneiwit\b|\bproteine di pisello\b|\bprote[íi]na de ervilha\b|(?<![a-zß-ÿ\u0100-\u017f])[äa]rtprotein\b|\bbia[łl]ko grochu\b|\bbezelye proteini\b/i, pts: 18, why: 'Pea protein isolate' },
    { m: /\brice protein( isolate)?\b/i,             pts: 15, why: 'Rice protein isolate' },
    { m: /\btextured (vegetable|soy) protein\b|\btvp\b/i, pts: 22, why: 'Textured vegetable protein' },
    { m: /\bwheat protein isolate\b|\bvital wheat gluten\b|\bwheat gluten\b/i, pts: 18, why: 'Isolated wheat gluten' },
    { m: /\bhydroly[sz]ed (soy |soya |vegetable |plant |wheat |corn |maize |pea |rice )?proteins?\b|\bprote[íi]nas?(?: vegetal(?:es)?)?(?: de (?:soja|trigo|ma[íi]z|guisante|arroz|milho|ervilha))? hidroli[sz]ad[ao]s?\b|\bprot[ée]ines?(?: v[ée]g[ée]tales?)?(?: de (?:soja|bl[ée]|ma[ïi]s|pois|riz))? hydrolys[ée]e?s?(?![a-zß-ÿ\u0100-\u017f])|\bhydrolysiertes? (?:pflanzliches |soja|weizen|mais|erbsen|pflanzen)?(?:eiwei(?:ß|ss)|protein)(?![a-zß-ÿ\u0100-\u017f])|\bprotein[ae](?: vegetal[ei])?(?: di (?:soia|frumento|mais|piselli|riso))? idrolizzat[ae]\b|\bgehydrolyseerde? (?:plantaardige |soja-?|tarwe-?|mais-?|erwten-?)?(?:eiwit(?:ten)?|prote[iï]nen?)(?![a-zß-ÿ\u0100-\u017f])|\bhydrolyser(?:ad|at|ade) (?:vegetabiliskt |soja|vete|majs|ärt)?protein(?![a-zß-ÿ\u0100-\u017f])|(?<![a-zß-ÿ\u0100-\u017f])hydrolizowane bia[łl]ko(?: ro[śs]linne| sojowe| pszenne)?(?![a-zß-ÿ\u0100-\u017f])|(?<![a-zß-ÿ\u0100-\u017f])hidrolize (?:bitkisel |soya |bu[ğg]day |m[ıi]s[ıi]r )?protein(?:i)?(?![a-zß-ÿ\u0100-\u017f])/i, pts: 18, why: 'Hydrolyzed protein — a hidden glutamate source' },
    { m: /\bwhey protein (isolate|concentrate|hydrolysate)\b|\bkoncentrat bia[łl]ek serwatkowych\b|\bizolat bia[łl]ek serwatkowych\b|\bconcentrado de prote[íi]nas? de soro\b|\bprot[ée]ines? de lactos[ée]rum\b|\bmolkenprotein(?:konzentrat|isolat)?\b|\bweiprote[iï]ne\b|\bvassleprotein(?:koncentrat)?\b|\bprote[íi]nas? de suero\b|\bproteine del siero\b|\bpeyniralt[ıi] suyu proteini\b/i, pts: 10, why: 'Whey protein isolate — processed dairy fraction' },
    { m: /\bmilk protein (isolate|concentrate)\b/i,  pts: 10, why: 'Milk protein isolate' },
    { m: /\bcasein(ate)?\b|\b(sodium|calcium) caseinate\b/i, pts: 12, why: 'Caseinate — chemically extracted milk protein' },
    // Collagen peptides are deliberately absent: they are an isolated protein, but not an
    // industrial one in the sense the rest of this table is about. A pts:0 entry used to sit here,
    // which tag() filters out, so it never reached the panel in any form.
    { m: /\bsoy leghemoglobin\b/i,                   pts: 20, why: 'Soy leghemoglobin — genetically engineered heme' },
    { m: /\begg white (protein )?(powder|solids)\b|\bdried egg whites?\b|\bblancs? d['’] ?(?:œ|oe)ufs? en poudre|\bclaras? de huevo en polvo|\balbume d['’] ?uovo in polvere|\bclaras? de ovo em p[óo]|\beiklarpulver\b|\bkippeneiwitpoeder\b|(?<![a-zß-ÿœ\u0100-\u017f])[äa]ggvitepulver\b|\bbia[łl]k(?:o|a) jaj(?:a)? w proszku|\byumurta ak[ıi] tozu/i, pts: 4, why: 'Dried egg white' },
  ];

  // ---------------------------------------------------------------- flavour & glutamates
  const FLAVOURS = [
    { m: /\bartificial (and natural )?flavou?r(?:ing)?s?\b/i,     pts: 18, why: 'Artificial flavour' },
    { m: /\bnatural (and artificial )?flavou?r(?:ing)?s?\b/i,     pts: 15, cat: 'naturalFlavour', why: '"Natural flavors" — an undisclosed flavour blend' },
    { m: /\bnatural [a-z]+ flavou?r(?:ing)?s?\b/i,                pts: 15, cat: 'naturalFlavour', why: '"Natural flavor" — undisclosed proprietary flavour compound' },
  // Mirror of the natural-flavour catch-all. Without it "artificial butter flavor" and
  // "artificial vanilla flavor" slipped past every flavour rule entirely.
  { m: /\bartificial [a-z]+ flavou?r(?:ing)?s?\b/i,             pts: 18, why: 'Artificial flavour compound' },
    // Bare "flavor" / "flavors" is the same undisclosed blend without the adjective. UK labels print
    // "flavourings", which matched no rule at all, and "natural flavourings" neither.
    { m: /(?<!\b(?:natural|artificial)(?: and (?:natural|artificial))?(?: [a-z]+)? |\bsmoke )\bflavou?rings?\b|^flavou?rs?$|\bsaborizantes?\b|\baromatizantes?\b|\bsabor (?:natural|artificial|id[ée]ntico al natural)\b/i, pts: 12, why: 'Unspecified flavouring' },
    // The same undisclosed blend on Spanish, French, German, Italian, Portuguese, Dutch, Swedish and
    // Polish panels. A qualifier in front ("natürliches Aroma", "naturliga aromer", "naturalny
    // aromat") is charged once, as natural or artificial: the bare-word rule used to charge it again.
    // Same `why` as the English rules on purpose: a bilingual label lists "natural flavour /
    // arôme naturel" and must be charged once, and `seen` de-duplicates by reason.
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi|aromat(?:y)?)\s+(?:artificial(?:es)?|artificiels?|k[üu]nstlich\w*|artificial[ei]|kunstmatig\w*|sztuczn\w*)\b|\bk[üu]nstliche[sn]?\s+aroma\b|\bkunstmatig(?:e)?\s+aroma\b|\bkonstgjorda?\s+arom(?:er)?\b|\bsztuczn[ey]\s+aromat(?:y)?\b|\byapay\s+aroma\b/i, pts: 18, why: 'Artificial flavour' },
    { m: /\b(?:aromas?|ar[ôo]mes?|aromen|aromi|aromat(?:y)?)\s+(?:natural(?:es)?|naturels?|naturali|naturale|naturais|natuurlijk\w*|naturaln\w*)\b|\bnat[üu]rliche[sn]?\s+arom(?:a|en|as)\b|\bnatuurlijk(?:e)?\s+aroma(?:['’]s)?(?![a-zß-ÿ\u0100-\u017f])|\bnaturliga?\s+arom(?:er)?\b|\bnaturaln[ey]\s+aromat(?:y)?\b|\bdo[ğg]al\s+aroma\b/i, pts: 15, cat: 'naturalFlavour', why: '"Natural flavors" — an undisclosed flavour blend' },
    // German, Dutch and Swedish write the flavour into the word ("Vanillearoma", "kokosnootaroma",
    // "vaniljarom") and Turkish after it ("vanilya aroması"). None of the rules above saw them, so
    // "natürliches Vanillearoma" was free where "natural vanilla flavour" costs 15. The suffix is
    // found with a fixed-length lookbehind rather than a free prefix, which would backtrack.
    { m: /(?<![a-zß-ÿ\u0100-\u017f])(?:nat[üu]rliche[sn]?|natuurlijke?|naturliga?|do[ğg]al)\s+[a-zß-ÿ\u0100-\u017f]{1,30}?(?:aroma|aromen|arom|aromer)(?![a-zß-ÿ\u0100-\u017f])|(?<![a-zß-ÿ\u0100-\u017f])do[ğg]al\s+[a-zçğıöşü]{1,30}\s+aromas[ıi](?![a-zß-ÿ\u0100-\u017f])/i,
      pts: 15, cat: 'naturalFlavour', why: '"Natural flavor" — undisclosed proprietary flavour compound' },
    { m: /(?<![a-zß-ÿ\u0100-\u017f])(?:k[üu]nstliche[sn]?|kunstmatige?|konstgjorda?|yapay)\s+[a-zß-ÿ\u0100-\u017f]{1,30}?(?:aroma|aromen|arom|aromer)(?![a-zß-ÿ\u0100-\u017f])|(?<![a-zß-ÿ\u0100-\u017f])yapay\s+[a-zçğıöşü]{1,30}\s+aromas[ıi](?![a-zß-ÿ\u0100-\u017f])/i,
      pts: 18, why: 'Artificial flavour compound' },
    { m: /(?=arom)(?<=[a-zß-ÿ\u0100-\u017f]{3})(?<!rauch|rook|rök)(?<!(?:nat[üu]rliche[sn]?|natuurlijke?|naturliga?|k[üu]nstliche[sn]?|kunstmatige?|konstgjorda?)\s+[a-zß-ÿ\u0100-\u017f]{0,30})(?:aroma|aromen|arom|aromer)(?![a-zß-ÿ\u0100-\u017f])|(?=aromas[ıi])(?<![a-zß-ÿ\u0100-\u017f])(?<!(?:do[ğg]al|yapay)\s+(?:[a-zçğıöşü]{1,30}\s+)?)aromas[ıi](?![a-zß-ÿ\u0100-\u017f])/i,
      pts: 12, why: 'Unspecified flavouring' },
    { m: /(?<!\b(?:nat[üu]rliche[sn]?|natuurlijke?|naturliga?|naturaln[ey]|k[üu]nstliche[sn]?|kunstmatige?|konstgjorda?|sztuczn[ey]|do[ğg]al|yapay)\s+)\b(?:aromas?|ar[ôo]mes?|aromen|aromi|arom|aromer|aromat|aromaty)(?![a-zß-ÿ\u0100-\u017f])(?!\s+(?:natura|naturel|artificial|artificiel|k[üu]nstlich|kunstmatig|natuurlijk|naturaln|sztuczn))/i, pts: 12, why: 'Unspecified flavouring' },
    { m: /\bmonosodium glutamate\b|\bmsg\b|\be[- ]?62[0-5]\b|\bglutamic acid\b|\b(?:mono)?potassium glutamate\b|\bcalcium diglutamate\b|\bglutamato monos[óo]dico\b|\bglutamate monosodique\b|\bglutamato monoss[óo]dico\b|\bglutammato monosodico\b|\bmononatriumglutamaat\b|\bmononatriumglutamat\b|\bglutaminian (?:mono)?sodu\b|\bmonosodyum glutamat\b/i, pts: 16, why: 'MSG' },
    { m: /\b(autolyzed )?yeast extract\b|\bextracto de levadura\b|\bextrait de levure\b|\bhefeextrakt\b|\bestratto di lievito\b|\bextrato de levedura\b|\bgistextract\b|\bj[äa]stextrakt\b|\bekstrakt (?:z )?dro[żz]d[żz]\w*|\bmaya [öo]z[üu](?![a-zß-ÿ\u0100-\u017f])/i, pts: 14, why: 'Yeast extract — added flavouring' },
    { m: /\bdisodium (inosinate|guanylate|5'?[- ]?ribonucleotides?)\b|\b(?:guanilato|inosinato) dis[óo]dico\b|\b(?:guanylate|inosinate) disodique\b|\bdinatrium(?:guanyl|inosin)aa?t\b|\bdisodyum (?:guanilat|inosinat)\b|\b(?:di)?potassium (inosinate|guanylate)\b|\be[- ]?6(?:2[6-9]|3[0-5])\b/i, pts: 12, why: 'Ribonucleotide flavour enhancer' },
    { m: /\bvanillin\b|\bvainillina\b|\bvanilline\b|\bvanillina\b|\bvaniline\b|\bvanilina\b|\bwanilina\b|\bvanilin\b/i, pts: 10, why: 'Vanillin — synthetic vanilla' },
    { m: /\bethyl vanillin\b/i,                           pts: 12, why: 'Ethyl vanillin' },
    // "natural smoke flavor" is charged once, by the natural-flavour rule above.
    { m: /(?<!natural |artificial )\bsmoke flavou?r(ing)?\b|\bliquid smoke\b|\braucharoma\w*|\brookaroma\b|(?<![a-zß-ÿ\u0100-\u017f])r[öo]karom(?:er)?\b|\bar[ôo]me de fum[ée]e\b|\baroma (?:de humo|di fumo|de fumo)\b|\baromat dymu\b|\bduman aromas[ıi]/i, pts: 8,  why: 'Liquid smoke flavouring' },
    { m: /\btorula yeast\b/i,                             pts: 10, why: 'Torula yeast — glutamate source' },
    { m: /\bmaltol\b|\bethyl maltol\b/i,                  pts: 10, why: 'Maltol flavour enhancer' },
  ];

  // ---------------------------------------------------------------- emulsifiers, gums, thickeners
  const TEXTURE = [
    // "mono- and diglycerides" — hyphen, space, "and", space — is the usual US spelling, and the
    // single optional separator on each side of "and" never matched it.
    { m: /\bmono[- ]*(?:and|&)?[- ]*di[- ]?glycerides?\b|\bmonoglycerides?\b|\bdiglycerides?\b|\be[- ]?47[01][ab]?\b|\be[- ]?472[a-df]\b|\bmono- und diglyceride\b|\bmono ve digliserit\w*|\bmono-? ?(?:i|en|och|e|y|et|ve|und|and)[- ]di-?gl[iy][cs][eé]r[a-zé]*|\bmono- y diglic[ée]ridos\b|\bmono- et diglyc[ée]rides\b|\bmono- e digliceridi\b/i,   pts: 12, why: 'Mono- and diglycerides — emulsifier' },
    { m: /\bpoly(?:sorbate|sorbat[eo]?)\s*(20|40|60|65|80)?\b|\bpoli(?:s|ss)orbato\s*(20|40|60|65|80)?\b|\bpolysorbaat\s*(20|40|60|65|80)?\b|\be[- ]?43[2-6]\b/i, pts: 14, why: 'Polysorbate — emulsifier' },
    { m: /\bdatem\b|\bdiacetyl tartaric\b|\be[- ]?472e\b/i,           pts: 12, why: 'DATEM dough conditioner' },
    // PGPR had no rule: it is how cheap chocolate is made with less cocoa butter.
    { m: /\bpolyglycerol polyricinoleate\b|\bpgpr\b|\be[- ]?476\b|\bpolyricinol[ée]ate de polyglyc[ée]rol\b|\bpolirricinoleato de poliglicerol\b|\bpoliricinoleato di poliglicerolo\b|\bpolyglycerin[- ]?polyricinoleat\b|\bpolyglycerol[- ]?polyricinole(?:aa|a)t\b|\bpolirycynooleinian poliglicerolu\b|\bpoligliserol polirisinolat\b|\bpoligliserol poliricinoleat\b/i,
      pts: 11, why: 'PGPR — castor-oil emulsifier standing in for cocoa butter' },
    { m: /\b(sodium|calcium) stearoyl[- ]2?[- ]?lactylate\b|\bsslr?\b|\be[- ]?48[12]\b/i,   pts: 11, why: 'Sodium stearoyl lactylate' },
    { m: /\b(hydroxypropyl )?methylcellulose\b|\bhpmc\b|\be[- ]?46[1-5]\b/i,              pts: 13, why: 'Methylcellulose — industrial binder' },
    { m: /\b(carboxymethyl ?)?cellulose gum\b|\be[- ]?46[6-9]\b/i, pts: 12, why: 'Cellulose gum' },
    { m: /\bmicrocrystalline cellulose\b|\be[- ]?460\b/i,            pts: 10, why: 'Microcrystalline cellulose — texture agent' },
    { m: /\bpowdered cellulose\b/i,                    pts: 10, why: 'Powdered cellulose' },
    { m: /\bxanthan gum\b|\bgoma xantana\b|\bgomme xanthane\b|\bxanthan\b|\bxantangummi\b|\bxanthaangom\b|\bguma ksantanowa\b|\bksantan gam[ıi]?(?![a-zß-ÿ\u0100-\u017f])|\be[- ]?415\b/i,                  pts: 9,  why: 'Xanthan gum' },
    { m: /\bguar gum\b|\bguar gam[ıi]?(?![a-zß-ÿ\u0100-\u017f])|\bgoma (?:de )?guar\b|\bgomme (de )?guar\b|\bguarkernmehl\b|\bguargom\b|\bguarpitmeel\b|\bguarkärnmjöl\b|\bguma guar\b|\bgomma (?:di )?guar\b|\be[- ]?412\b/i,                     pts: 8,  why: 'Guar gum' },
    { m: /\bgellan gum\b|\bgoma gellan\b|\bgomme gellane\b|\bgellangummi\b|\bgomma (?:di )?gellano?\b|\bgoma gelana\b|\bgellangom\b|\bgellan\b|\bjellan\b|\be[- ]?418\b/i, pts: 9,  why: 'Gellan gum' },
    { m: /\blocust bean gum\b|\bcarob (bean )?gum\b|\bjohannisbrotkernmehl\b|\bgoma (?:garrof[íi]n|de algarrobo)\b|\bgomme (?:de )?caroube\b|\bfarina di (?:semi di )?carrube\b|\bjohannesbroodpitmeel\b|\bm[ąa]czka chleba [śs]wi[ęe]toja[ńn]skiego\b|\bke[çc]i ?boynuzu gam[ıi]|\bgoma de alfarroba\b|\bjohannesbr[öo]dk[äa]rnmj[öo]l\b|\be[- ]?410\b/i, pts: 7,  why: 'Locust bean gum' },
    { m: /\btara gum\b|\be[- ]?417\b/i,                              pts: 8,  why: 'Tara gum' },
    { m: /\bacacia gum\b|\bgum acacia\b|\bgum arabic\b|\bgoma ar[áa]biga\b|\bgomme arabique\b|\bgomme d['’] ?acacia\b|\bgoma de acacia\b|\bgomma d['’] ?acacia\b|\bakaziengummi\b|\bguma arabska\b|\bgummi arabicum\b|\bgomma arabica\b|\bgoma ar[áa]bica\b|\barabische gom\b|\bakasya gam[ıi](?![a-zß-ÿ\u0100-\u017f])|\be[- ]?414\b/i, pts: 5,  why: 'Gum arabic' },
    { m: /\bsoy(?:a)? lecithins?\b|\blecitinas? de soja\b|\bl[ée]cithines? de soja\b|\bsojalecithine?n?\b|\blecitin[ae] di soia\b|\bsojalecithine\b|\bsojalecitin\b|\bsoja[- ]lecithine?n?\b|\blecytyn[ay]? sojow[ae]\b|\bsojowa lecytyna\b|\bsoya lesitini?\b/i, pts: 9,  why: 'Soy lecithin — soy-derived emulsifier' },
    { m: /\bsunflower lecithins?\b|\blecitinas? de girasol\b|\bl[ée]cithines? de tournesol\b|\bsonnenblumenlecithine?n?\b|\blecitin[ae] di girasole\b|\blecith?ina de girassol\b|\bzonnebloemlecithine\b|\bsolroslecitin\b|\blecytyn[ay]? s[łl]onecznikow[ae]\b|\bay[çc][ıi][çc]ek lesitini?\b/i, pts: 4,  why: 'Sunflower lecithin' },
    // "Lecithin" with no source, or E322 — which is most EU chocolate. Between the two lecithins
    // above, because the source is exactly what the label declined to say.
    { m: /^(?:lecithins?|lecitin[ae]s?|l[ée]cithines?|lecithine?n?|lecitin(?:er)?|lecytyn[ay]?|lesitin(?:ler)?)$|\be[- ]?322\b/i, pts: 7,  why: 'Lecithin — emulsifier, source not stated' },
    { m: /\bmodified (food |corn |maize |potato |tapioca |wheat |rice |waxy maize )?starch\b|\be[- ]?14[0-5]\d\b|\balmid[óo]n modificado\b|\bamidon (?:de (?:ma[ïi]s|bl[ée]|pomme de terre|tapioca|riz) )?modifi[ée](?![a-zß-ÿ\u0100-\u017f])|\bmodifizierte st[äa]rke\b|\bamido modificato\b|\bamido modificado\b|\bgemodificeerd zetmeel\b|\bmodifierad (?:majs|potatis|vete|tapioka)?st[äa]rkelse\b|\bskrobia (?:kukurydziana |ziemniaczana |pszenna |tapiokowa )?modyfikowana\b|\bmodyfikowana skrobia\b|\bmodifiye (?:m[ıi]s[ıi]r |patates |bu[ğg]day )?ni[şs]asta(?:s[ıi])?(?![a-zß-ÿ\u0100-\u017f])/i, pts: 14, why: 'Modified starch — chemically altered' },
    { m: /\bmaltod[eé]xtrin[ae]?\b|\bmaltodestrina\b|\bmaltodextrine\b|\bmaltodekstryna\b|\bmaltodekstrin\b|(?<=[a-zß-ÿ\u0100-\u017f]{3})maltodextrin[ae]?(?![a-zß-ÿ\u0100-\u017f])/i,  pts: 18, why: 'Maltodextrin — starch-derived bulking agent' },
    { m: /\bcarboxymethyl\b|(?:natrium|sodium ?)carboxymethyl|\bcarboxym[ée]thylcellulose\b|\bcarboximetilcelulosa\b|\bcarbossimetilcellulosa\b|\bkarboksymetyloceluloza\b|\bkarboksimetil sel[üu]loz\b|\bcarboximetilcelulose\b/i,                         pts: 11, why: 'Carboxymethyl derivative' },
    { m: /\bpropylene glycol\b|\be[- ]?1520\b/i,                      pts: 14, why: 'Propylene glycol' },
    { m: /\bglycerin(e)?\b|\bglyc[ée]rol\b|\bglicerina\b|\bglyc[ée]rine\b|\bglicerolo\b|\bglycerine\b|\bgliser(?:ol|in)\b|\bglicerol\b|\be[- ]?422\b/i, pts: 6,  why: 'Glycerin humectant' },
  ];

  // ---------------------------------------------------------------- preservatives
  const PRESERVATIVES = [
    { m: /\b(sodium|potassium) (nitrite|nitrate)\b|\be[- ]?25[0-2]\b|\be[- ]?249\b|\bnitrito de sodio\b|\bnitrite de sodium\b|\bnatriumnitrit\b|\bnitrito di sodio\b|\bnitrito de s[óo]dio\b|\bnatriumnitriet\b|\bazotyn sodu\b/i, pts: 16, why: 'Synthetic nitrite — curing preservative' },
    { m: /\b(sodium|potassium|calcium) benzoate\b|\bbenzoic acid\b|\be[- ]?21[0-3]\b|\bbenzoato de sodio\b|\bbenzoate de sodium\b|\bnatriumbenzoat\b|\bbenzoato di sodio\b|\bbenzoato de s[óo]dio\b|\bbenzoato s[óo]dico\b|\bnatriumbenzoaat\b|\bnatriumbensoat\b|\bbensoesyra\b|\bbenzoesan sodu\b|\bkwas benzoesowy\b|\bsodyum benzoat\b|\bbenzoik asit\b/i, pts: 13, why: 'Sodium benzoate' },
    { m: /\b(potassium|calcium|sodium) sorbate\b|\be[- ]?20[1-3]\b|\bsorbato de potasio\b|\bsorbate de potassium\b|\bkaliumsorbat\b|\bsorbato di potassio\b|\bsorbato de pot[áa]ssio\b|\bsorbato pot[áa]sico\b|\bkaliumsorbaat\b|\bsorbinian potasu\b|\bpotasyum sorbat\b/i, pts: 11, why: 'Potassium sorbate' },
    { m: /\bsorbic acid\b|(?:^|[^a-z])[aá]cido s[oó]rbico(?:$|[^a-z])|\bacide sorbique\b|\bsorbins[äa]ure\b|\bsorbinezuur\b|\bsorbinsyra\b|\bkwas sorbowy\b|\bsorbik asit\b|\be[- ]?200\b/i, pts: 10, why: 'Sorbic acid' },
    { m: /\bcalcium propionate\b|\bpropionato de calcio\b|\bpropionate de calcium\b|\bcalciumpropionat\b|\bpropionato di calcio\b|\bpropionato de c[áa]lcio\b|\bcalciumpropionaat\b|\bkalciumpropionat\b|\bpropionian wapnia\b|\bkalsiyum propiyonat\b|\be[- ]?282\b/i, pts: 12, why: 'Calcium propionate' },
    { m: /\b(sodium|potassium) propionate\b|\bpropionic acid\b|\bsodium diacetate\b|\be[- ]?28[013]\b/i,          pts: 11, why: 'Sodium propionate' },
    { m: /\b(disodium |calcium (disodium )?)?edta\b|\be[- ]?38[56]\b/i,              pts: 14, why: 'EDTA — a chelating agent' },
    // "sodium metabisulfite" carries both prefixes, and "(bi|meta)?" allowed one: the commonest
    // sulphite on a label was charged nothing, in English and in every other language. The sulphite
    // caramels ("sulphite ammonia caramel", "amonyum sülfit karamel") are caramel colour, not this.
    { m: /\bsulfur dioxide\b|\bsulphur dioxide\b|(?<!caramel (?:de |au )?|caustic )\bsul(?:ph|f)ites?\b(?![- ](?:ammonia[- ]|ammoniacal )?caramel)|\bsulfitos?\b|\bsolfiti\b|\bschwefeldioxid\b|\bsodium (?:meta)?(?:bi)?sul(?:ph|f)ite\b|\be[- ]?22[0-8]\b|(?<![a-zß-ÿ\u0100-\u017f])(?<!caramel (?:de |au )?|amoniakalno[- ])(?:sulfit[a-z]*(?![a-z])(?!\s+(?:ammoniacal|karamel|caramel))|s[üu]lfit[a-zıüş]*(?![a-zıüş])(?!\s+(?:ammonia|karamel|caramel))|solfit[oi]|siarczyn[a-zęąó]*|pirosiarczyn[a-zęąó]*|natrium(?:meta)?(?:bi|di)?sulfi(?:t|et)[a-z]*|(?:m[ée]ta)?bisulfite de sodium|(?:meta)?bis?sulfito (?:de |di )?s[óo]di(?:o|co)|metabisolfito di sodio|disolfito di sodio|sodyum (?:meta)?bis[üu]lfit|anhydride sulfureux|dioxyde de soufre|anh[íi]drido sulfuroso|anidride solforosa|di[óo]xido de (?:azufre|enxofre)|zwaveldioxide|svaveldioxid|dwutlenek siarki|k[üu]k[üu]rt dioksit)(?![a-zß-ÿ\u0100-\u017f])/i, pts: 12, why: 'Sulfites' },
    { m: /\bpotassium metabisul(?:ph|f)ite\b|(?<![a-zß-ÿ\u0100-\u017f])(?:kalium(?:meta)?(?:bi|di)?sulfi(?:t|et)[a-z]*|(?:m[ée]ta)?bisulfite de potassium|(?:meta)?bis?sulfito (?:de |di )?pot[áa]s(?:io|sio|ico)|metabisolfito di potassio|potasyum (?:meta)?bis[üu]lfit)(?![a-zß-ÿ\u0100-\u017f])/i, pts: 12, why: 'Potassium metabisulfite' },
    { m: /\bnatamycin\b|\be[- ]?235\b/i,                              pts: 10, why: 'Natamycin' },
    { m: /\bnisin\b|\be[- ]?234\b/i,                                  pts: 8,  why: 'Nisin' },
    { m: /\bpolyphosphates?\b|\bsodium (tri)?polyphosphate\b|\b(di|tri)phosphates?\b|\b\w*(?:di|tri|poly)(?:phosphat|fosfa|fosfor(?!owy))\w*|\bpolifosfat\w*|\be[- ]?45[0-2]\b/i, pts: 12, why: 'Polyphosphate' },
  ];

  // ---------------------------------------------------------------- acids, anticaking, misc aids
  const PROCESSING = [
    { m: /\bphosphoric acid\b|(?:^|[^a-z])[áa]cido fosf[óo]rico\b|\bacide phosphorique\b|\bfosforzuur\b|\bphosphors[äa]ure\b|\bfosforsyra\b|\bkwas (?:orto)?fosforowy\b|\bfosforik asit\b|\be[- ]?338\b/i,               pts: 14, why: 'Phosphoric acid — acidity regulator' },
    { m: /\bcitric acid\b|(?:^|[^a-z])[aá]cido c[ií]trico(?:$|[^a-z])|\bacide citrique\b|\b[cz]itronens[äa]ure\b|\bcitroenzuur\b|\bcitronsyra\b|\bkwas cytrynowy\b|\bsitrik asit\b|\be[- ]?330\b/i, exemptIf: /\bfrom (lemons?|limes?|citrus|fruit)\b/i, pts: 5,  why: 'Citric acid — acidity regulator' },
    { m: /\bmalic acid\b|\bappelzuur\b|(?:^|[^a-z])[äa]pfels[äa]ure\b|(?:^|[^a-z])[áa]cido m[áa]lico\b|\bacide malique\b|\bacido malico\b|(?<![a-zß-ÿ\u0100-\u017f])[äa]ppelsyra\b|\bkwas jab[łl]kowy\b|\bmalik asit\b|\be[- ]?296\b/i,                             pts: 5,  why: 'Malic acid' },
    { m: /\bfumaric acid\b|\be[- ]?297\b/i,                           pts: 6,  why: 'Fumaric acid' },
    { m: /\blactic acid\b|(?:^|[^a-z])[aá]cido (?:l[aá]ctico|lattico)(?:$|[^a-z])|\bacide lactique\b|\bmilchs[äa]ure\b|\bmelkzuur\b|\bmj[öo]lksyra\b|\bkwas mlekowy\b|\blaktik asit\b|\be[- ]?270\b/i, pts: 5,  why: 'Industrial lactic acid' },
    { m: /\bacetic acid\b|\be[- ]?260\b/i,                            pts: 4,  why: 'Acetic acid' },
    { m: /\bsilicon dioxide\b|\bsilica\b|\bdi[óo]xido de silicio\b|\bdioxyde de silicium\b|\bsiliziumdioxid\b|\bdiossido di silicio\b|\bdi[óo]xido de sil[ií]cio\b|\bsiliciumdioxide?\b|\bbiossido di silicio\b|\bkiseldioxid\b|\bdwutlenek krzemu\b|\bsilisyum dioksit\b|\be[- ]?551\b/i, pts: 8,  why: 'Silicon dioxide anticaking agent' },
    { m: /\bcalcium silicate\b|\be[- ]?552\b/i,                       pts: 8,  why: 'Calcium silicate' },
    { m: /\bsodium alumino?silicate\b|\be[- ]?55[4-6]\b|\be[- ]?173\b|\balumin(i)?um (compound|phosphate|sulfate|silicate|powder)\b/i, pts: 12, why: 'Aluminium compound' },
    { m: /\bmagnesium stearate\b|\be[- ]?572\b/i,                     pts: 7,  why: 'Magnesium stearate' },
    { m: /\btripotassium phosphate\b|\be[- ]?340\b/i,                 pts: 10, why: 'Tripotassium phosphate' },
    { m: /\bdipotassium phosphate\b/i,                  pts: 9,  why: 'Dipotassium phosphate' },
    { m: /\b(disodium|trisodium|monocalcium|dicalcium|tricalcium|monosodium|monopotassium|calcium|sodium|potassium) phosphates?\b|\btri(?:calcium|kalcium|calcio|kalsiyum)[- ]?(?:fosfaat|phosphat|fosfat)\b|\b(?:di|tri|mono)?(?:kalium|natrium|calcium|kalcium)(?:phosphate?n?|fosfaat|fosfaten|fosfat(?:er)?)\b|\bfosfat[io]s? d[ie] (?:potassio|sodio|calcio|pot[áa]ssio|s[óo]dio|c[áa]lcio)\b|\bfosfatos? (?:di|tri|mono)?(?:pot[áa]sicos?|s[óo]dicos?|c[áa]lcicos?)\b|\bphosphates? (?:de |d['’] ?)(?:potassium|sodium|calcium)\b|\b(?:fosfato tric[áa]lcico|phosphate tricalcique|fosforan tr[óo]jwapniowy)\b|\be[- ]?339\b|\be[- ]?341\b/i, pts: 9, why: 'Phosphate additive' },
    { m: /\bsodium alumini?um (phosphate|sulfate)\b|\be[- ]?541\b/i,    pts: 13, why: 'Sodium aluminium phosphate' },
    { m: /\bcalcium sul(?:f|ph)ate\b|\bcalciumsulf(?:aat|at)\b|\bsulfate de calcium\b|\bsulfato de c[áa]lcio\b|\bsolfato di calcio\b|\bkalciumsulfat\b|\bsiarczan wapnia\b|\bkalsiyum s[üu]lfat\b|\be[- ]?516\b/i,                        pts: 6,  why: 'Calcium sulfate' },
    { m: /\bammonium (chloride|sul(?:f|ph)ate)\b|\be[- ]?510\b/i,            pts: 8,  why: 'Ammonium salt dough conditioner' },
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
    { m: /^(?:preservatives?|preserving agents?|agents? de conservation|agentes? de conservaci[óo]n|agentes? conservantes?|agent[ei] conservant[ei]|conservad?or(?:es)?|conservantes?|conservateurs?|konservierungsstoffe?|conservanti|conserveermiddel(?:en)?|preservatives? added|konserveringsmedel|konserwant(?:y)?|substancj[ae] konserwując[ae]|koruyucu(?:lar)?|koruyucu madde)$/i, pts: 10, why: 'Unnamed preservative' },
    { m: /^(?:colou?rs?(?: added)?|colou?rings?|colou?ring agents?|artificial colou?r added|colorantes?|colorants?|farbstoffe?|coloranti|kleurstof(?:fen)?|color natural|colorante natural|f[äa]rg[äa]mne(?:n)?|barwnik(?:i)?|renklendirici(?:ler)?|renk maddesi)$/i, pts: 8, why: 'Unnamed colour' },
    { m: /^(?:emulsifiers?|emulsifying agents?|agents? [ée]mulsifiants?|agentes? emulsionantes?|agentes? emulsificantes?|agent[ei] emulsionant[ei]|emulsionantes?|emulgentes?|[ée]mulsifiants?|emulgator(?:en)?|emulsionanti|emulgatoren|emulgeringsmedel|emulgatory|em[üu]lgat[öo]r(?:ler)?)$/i, pts: 8, why: 'Unnamed emulsifier' },
    { m: /^(?:stabili[sz]ers?|stabili[sz]ing agents?|thickening agents?|gelling agents?|g[ée]lifiants?|gelificantes?|gelificant[ei]|geliermittel|geleermiddel(?:en)?|geleringsmedel|substancj[ae] [żz]eluj[ąa]c[ae]|jelle[şs]tirici(?:ler)?|espessantes?|agents? [ée]paississants?|agentes? espesantes?|agentes? gelificantes?|agent[ei] addensant[ei]|agent[ei] gelificant[ei]|agentes? espessantes?|estabilizantes?|stabilisants?|stabilisator(?:en)?|stabilizzant[ei]|estabilizador(?:es)?|thickeners?|espesantes?|[ée]paississants?|verdickungsmittel|addensanti|verdikkingsmiddelen?|stabilisatoren|stabiliseringsmedel|f[öo]rtjockningsmedel|stabilizator(?:y)?|substancj[ae] zag[ęe]szczając[ae]|zag[ęe]stnik(?:i)?|stabiliz(?:at)?[öo]r(?:ler)?|k[ıi]vam (?:artt?[ıi]r[ıi]c[ıi](?:lar)?|verici(?:ler)?))$/i, pts: 6, why: 'Unnamed stabiliser or thickener' },
    { m: /^(?:acidity regulators?|acidity correctors?|acidifying agents?|acidifiers?|acidulants?|acidulantes?|acidifiants?|acidificantes?|correctore?s? de acidez|reguladore?s? de acidez|s[äa]uerungsmittel|s[äa]ureregulator(?:en)?|acidificanti|correttor[ei] di acidit[àa]|regulador de acidez|aciditeitsregelaar(?:s)?|surhetsreglerande medel|regulator(?:y)? kwasowo[śs]ci|zuurte-?regelaars?|[śs]rod(?:ek|ki) zakwaszaj[ąa]c[ey]|asitlik d[üu]zenleyici(?:ler)?|asitlendirici)$/i, pts: 4, why: 'Unnamed acidity regulator' },
    // Every flavour enhancer the rules can name (MSG, yeast extract, ribonucleotides) is a cosmetic
    // additive, so an unnamed one votes on the processing class, unlike the other function words.
    { m: /^(?:flavou?r enhancers?|exhausteurs? de go[ûu]t|potenciadore?s? del? sabor|esaltator[ei] di sapidit[àa]|geschmacksverst[äa]rker|smaakversterkers?|smakf[öo]rst[äa]rkare|wzmacniacze? smaku|intensificadore?s? de sabor|real[çc]adore?s? de sabor|lezzet artt?[ıi]r[ıi]c[ıi](?:lar)?)$/i, pts: 12, why: 'Unnamed flavour enhancer', cat: 'glutamate', ultra: true },
    // Every sweetener the rules can name is at least NOVA 4 (stevia extract, the mildest, costs 8), so an
    // unnamed one is charged as that and votes the same way. "Contains sweeteners", the EU statement that
    // accompanies named ones, is its own entry and is not anchored here, so it costs nothing.
    { m: /^(?:sweeteners?|edulcorantes?|[ée]dulcorants?|s[üu](?:ß|ss)ungsmittel|dolcificant[ei]|zoetstof(?:fen)?|s[öo]tningsmedel|substancj[ae] s[łl]odz[ąa]c[ae]|tatland[ıi]r[ıi]c[ıi](?:lar)?|ado[çc]antes?)$/i, pts: 8, why: 'Unnamed sweetener', cat: 'sweetener', ultra: true },
    { m: /^(?:antioxidants?|anti-?oxidants?|antioxidantes?|antioxydants?|antioxidationsmittel|antiossidanti|antioxidanten|antioxidationsmedel|przeciwutleniacz(?:e)?|antioksidan(?:lar)?)$/i, pts: 4, why: 'Unnamed antioxidant' },
  ];

  // ---------------------------------------------------------------- synthetic fortification
  const FORTIFICATION = [
    { m: /\bthiamin(e)? mononitrate\b|\bthiamin(?:e)? hydrochloride\b|\bthiaminmononitrat\b|\bmononitrate de thiamine\b|\bmononitrato de tiamina\b|\btiamina mononitrato\b/i,        pts: 8,  why: 'Synthetic thiamine' },
    { m: /\briboflavin[ae]?\b|\bribofla(?:vine|wina)\b|\be[- ]?101\b/i,                     pts: 7,  why: 'Synthetic riboflavin' },
    { m: /\bfolic acid\b|(?:^|[^a-z])[áa]cido f[óo]lico\b|\bacide folique\b|\bfols[äa]ure\b|\bfoliumzuur\b|\bfolsyra\b|\bkwas foliowy\b|\bfolik asit\b/i,                     pts: 9,  why: 'Folic acid — the synthetic form, not folate' },
    { m: /\b(reduced iron|ferrous (sulfate|fumarate))\b/i, pts: 9, why: 'Elemental iron fortification' },
    { m: /\bpyridoxine hydrochloride\b|\bchlorhydrate de pyridoxine\b|\bpyridoxinhydrochlorid\b|\bclorhidrato de piridoxina\b|\bpiridossina cloridrato\b|\bcloridrato de piridoxina\b/i,       pts: 7,  why: 'Synthetic B6' },
    { m: /\bcyanocobalamine?\b|\bcianocobalamina\b|\bcyjanokobalamina\b|\bsiyanokobalamin\b/i,                 pts: 7,  why: 'Cyanocobalamin — the synthetic B12 form' },
    { m: /\bzinc oxide\b/i,                     pts: 8,  why: 'Zinc oxide fortification' },
    { m: /\bniacinamide?\b|\bniacin[ae]?\b|\bniacyn[ay]\b|\bnicotinamide?\b|\bnicotinamida\b|\bnikotynamid\b|\bniasin\b/i,         pts: 7,  why: 'Synthetic niacin' },
    { m: /\bcalcium carbonate\b|\bcarbonate de calcium\b|\bcarbonato de c[áa]lcio\b|\bcarbonato di calcio\b|\bcalciumcarbona(?:at|t)\b|\bkalciumkarbonat\b|\bw[ęe]glan wapnia\b|\bkalsiyum karbonat\b|\be[- ]?170\b/i,              pts: 5,  why: 'Calcium carbonate fortification' },
    { m: /\b(sodium|calcium) ascorbate\b|\bascorbic acid\b|\bascorbyl palmitate\b|\bascorbylpalmitat\b|\bpalmitate d['’]ascorbyle\b|\bpalmitato de ascorbilo\b|\bascorbilpalmitato\b|\bpalmitynian askorbylu\b|\bascorbylpalmitaat\b|(?:^|[^a-z])[aá]cido asc[oó]rbico(?:$|[^a-z])|\bacide ascorbique\b|\bascorbins[äa]ure\b|\bascorbinezuur\b|\bkwas askorbinowy\b|\baskorbik asit\b|\baskorbinsyra\b|\be[- ]?30[0-4]\b/i, pts: 5, why: 'Synthetic vitamin C' },
    { m: /\bvitamin a (palmitate|acetate)\b/i,  pts: 7,  why: 'Synthetic vitamin A' },
    { m: /\bd[- ]?alpha[- ]?tocopher(ol|yl)\b|\bmixed tocopherols\b|\btocopherols?\b|(?<![a-zß-ÿ\u0100-\u017f])toco(?:ph|f)[ée]r(?:ols?|oles|oli|[óo]is|olen?|olo)(?![a-zß-ÿ\u0100-\u017f])|\be[- ]?30[6-9]\b/i, pts: 3, why: 'Tocopherol antioxidant' },
    { m: /\bcholecalciferol\b|\bvitamin d[23]\b/i, pts: 3, why: 'Added vitamin D' },
    { m: /\bpotassium iodide\b|\bpotassium iodate\b|\bkaliumjodi[dt]e?\b|\biod(?:ure|ate) de potassium\b|\byod(?:uro|ato) pot[áa]sico\b|\biod(?:uro|ato) di potassio\b|\bjod(?:ek|an) potasu\b|\bpotasyum iyod(?:[üu]r|at)\b|\biod(?:eto|ato) de pot[áa]ssio\b/i,               pts: 3,  why: 'Added iodine' },
    { m: /\bsodium selenite\b/i,                pts: 6,  why: 'Sodium selenite' },
  ];

  // ---------------------------------------------------------------- grains, gluten, legumes
  // A grain rule plus its local flour and starch names. German, Dutch and Swedish write these as one
  // word ("Roggenmehl", "aardappelzetmeel", "potatisstärkelse"), which \b-anchored words miss.
  const NB_L = '(?<![a-zß-ÿœ\\u0100-\\u017f])', NB_R = '(?![a-zß-ÿœ\\u0100-\\u017f])';
  const grain = (en, local) => new RegExp(en.source + '|' + NB_L + '(?:' + local.join('|') + ')' + NB_R, 'i');

  const GRAINS = [
    { m: /\b(?:enriched|fortified) (wheat |bleached |unbleached |white )?flour\b/i, pts: 15, why: 'Enriched flour — stripped, then synthetically re-dosed' },
    // "Refined wheat flour" is the same refined flour as "refined flour"; Indian labels call it maida.
    { m: /\b(bleached|refined|white) (?:wheat )?flour\b|\bmaida\b/i,     pts: 14, why: 'Refined white flour' },
    { m: /\bwheat flour\b|\bharina(?:\s+integral)?\s+de\s+trigo\b(?!\s+(?:sarraceno|mourisco))|\bfarine(?:\s+(?:compl[èe]te|int[ée]grale))?\s+de\s+bl[ée](?!\s*noir)(?:$|[^a-z])|\b(?:vollkorn)?weizenmehl\b|\bvollkornweizenmehl\b|\bfarina(?:\s+integrale)?\s+di\s+(?:grano|frumento)\b(?!\s+saraceno)|\bfarinha(?:\s+integral)?\s+de\s+trigo\b(?!\s+(?:sarraceno|mourisco))|\b(?:volkoren\s?)?tarwe(?:meel|bloem)\b|\bfarine\s+(?:compl[èe]te\s+)?de\s+froment\b|\bvetemj[öo]l\b|\bm[ąa]ka\s+pszenna(?:\s+pe[łl]noziarnista)?\b|\bpszenna\s+m[ąa]ka\b|\bbu[ğg]day\s+unu\b/i, pts: 12, why: 'Wheat flour' },
    { m: /\bwheat\b|\btrigo\b(?!\s+(?:sarraceno|mourisco))|\bbl[ée](?!\s*noir)(?:$|[^a-z])|\bweizen\b|\bfrumento\b|\bfroment\b|\btarwe\b|\bvete\w*|\bpszen(?:ica|icy|n[aey]|nego|nej)\b|\bfullkorns(?:durum)?vete\w*|\btarwe\w*|\bweizen\w*|\bbu[ğg]day\b/i, pts: 9,  why: 'Wheat', gluten: true },
    { m: /\bbarley\b|\bcebada\b|\borge\b|\bgerste\b|\borzo\b|\bcevada\b|\bgerst\b|\bgerste(?:nmalz|mout)\w*|\bgerstemout\w*|\bgersten?(?:vlokken|bloem|meel|flocken|mehl|graupen|gr[üu]tze)\w*|\bkornmalt\b|\bj[ęe]czmie[ńn](?![a-z\u0100-\u017f])|\bj[ęe]czmienn(?:a|e|y|ego|ej)(?![a-z\u0100-\u017f])|\barpa\b/i, pts: 8,  why: 'Barley', gluten: true },
    { m: grain(/\brye\b|\bcenteno\b|\bseigle\b|\broggen\b|\bsegale\b|\bcenteio\b|\brogge\b|\br[åa]gmj[öo]l\b|(?:^|[^a-z])[żz]yt(?:o|nia|ni)\b|(?:^|[^a-z\u0100-\u017f])[çc]avdar\b/i, [
      '(?:vollkorn)?roggen(?:vollkorn)?(?:mehl|schrot|flocken|sauerteig|malz)[a-z]*', 'rogge(?:bloem|meel|vlokken)', '(?:fullkorns)?råg(?:mjöl|kross|flingor|sikt)?', '[żz]ytni(?:e|ej|ego)']), pts: 8,  why: 'Rye', gluten: true },
    { m: /\bsemolina\b|\bdurum\b|\b(?:fullkorns)?durumvete\b|\bs[ée]mola\b|\bsemoule\b|\b(?:hartweizen)?grie(?:ss|[ßs])(?![a-zß])|\bs[ée]mola\b|\bgriesmeel\b/i, pts: 10, why: 'Durum semolina', gluten: true },
    { m: grain(/\bspelt\b/i, ['(?:vollkorn)?dinkel(?:vollkorn)?(?:mehl|flocken|schrot)?', 'spelt(?:meel|bloem|mjöl)', '[ée]peautre', 'espelta', 'farro(?: spelta)?', 'spelta', 'orkisz[a-z]*', 'kav[ıi]lca']),
      pts: 5,  why: 'Spelt', gluten: true },
    { m: /\btriticale\b/i,                          pts: 8,  why: 'Triticale', gluten: true },
    { m: /\bmalted barley( flour)?\b|\borge malt[ée]e\b|\bcebada malteada\b|\borzo maltato\b|\bgem[äa]lzte gerste\b|\bgemoute gerst\b|\bcevada maltada\b/i,             pts: 8,  why: 'Malted barley', gluten: true },
    { m: /\bcorn ?(flour|meal|starch|masa)\b|\bcornstarch\b|\bcornmeal\b|\bmaize ?(?:flour|meal|starch)\b|\balmid[óo]n de ma[ií]z\b|\bamidon (?:modifi[ée] )?(?:de )?ma[ïi]s(?![a-zß-ÿ\u0100-\u017f])|\bmaisst[äa]rke\b|\bamido di mais\b|\bamido de milho\b|\bma[iï]szetmeel\b|\bmajsst[äa]rkelse\b|\bmajsmj[öo]l\b|\bskrobia kukurydziana\b|\bm[ąa]ka kukurydziana\b|\bm[ıi]s[ıi]r (?:ni[şs]astas[ıi](?![a-zß-ÿ\u0100-\u017f])|unu\b)/i, pts: 7,  why: 'Corn flour or starch' },
    { m: grain(/\boat (flour|fiber)\b/i, ['farine d[\'’] ?avoine', 'harina de avena', '(?:vollkorn)?hafermehl', 'havermeel', 'havremjöl', 'm[ąa]ka owsiana', 'yulaf unu', 'farina d[\'’] ?avena', 'farinha de aveia']),
      pts: 5,  why: 'Oat flour' },
    { m: /\brice flour\b|\brijste?(?:bloem|meel)\b|\breismehl\b|\bharina de arroz\b|\bfarine de riz\b|\bfarina di riso\b|\bfarinha de arroz\b|\brismj[öo]l\b|\bm[ąa]ka ry[żz]owa\b|\bpirin[çc] unu\b/i,                         pts: 6,  why: 'Rice flour' },
    { m: grain(/\bsoy(bean)? (flour|grits)\b/i, ['farine de soja', 'harina de soja', 'sojamehl', 'soja(?:bonen)?meel', 'sojamjöl', 'm[ąa]ka sojowa', 'soya unu', 'farina di soia', 'farinha de soja']),
      pts: 12, why: 'Soy flour' },
    { m: grain(/\bchickpea flour\b|\bgram flour\b/i, ['farine de pois chiches?', 'harina de garbanzos?', 'kichererbsenmehl', 'kikkererwtenmeel', 'kikärtsmjöl', 'm[ąa]ka z ciecierzycy', 'nohut unu', 'farina di ceci', 'farinha de gr[ãa]o[- ]de[- ]bico', 'besan']),
      pts: 5,  why: 'Chickpea flour' },
    { m: grain(/\blentil flour\b/i, ['farine de lentilles?', 'harina de lentejas?', 'linsenmehl', 'linzenmeel', 'linsmjöl', 'm[ąa]ka z soczewicy', 'mercimek unu', 'farina di lenticchie', 'farinha de lentilhas?']),
      pts: 5,  why: 'Lentil flour' },
    { m: grain(/\bpotato (starch|flour)\b/i, ['f[ée]cule de pommes? de terre', 'amidon de pommes? de terre', 'almid[óo]n de patatas?', 'f[ée]cula de patatas?', 'kartoffelst[äa]rke', 'kartoffelmehl', 'aardappelzetmeel', 'potatisst[äa]rkelse', 'potatismjöl', 'skrobia ziemniaczana', 'patates ni[şs]astas[ıi]', 'fecola di patat[ae]', 'amido di patat[ae]', 'f[ée]cula de batata', 'amido de batata']),
      pts: 5,  why: 'Potato starch' },
    { m: grain(/\btapioca (starch|flour)\b/i, ['(?:amidon|f[ée]cule) de (?:tapioca|manioc)', 'almid[óo]n de (?:tapioca|yuca|mandioca)', 'tapiokast[äa]rke', 'tapioca(?:zetmeel|meel)', 'tapiokast[äa]rkelse', 'skrobia z (?:tapioki|manioku)', 'amido di (?:tapioca|manioca)', 'f[ée]cula de mandioca', 'amido de mandioca', 'tapyoka ni[şs]astas[ıi]']),
      pts: 4,  why: 'Tapioca starch' },
    { m: /\bwheat (bran|germ|starch)\b|\btarwe(?:zetmeel|zemelen|kiemen)\b|\bweizen(?:st[äa]rke|kleie|keime)\b|\b(?:almid[óo]n|salvado|germen) de trigo\b|\b(?:amidon|son|germe) de bl[ée](?![a-z])|\b(?:amido|crusca|germe) di (?:frumento|grano)\b|\b(?:amido|farelo|g[ée]rmen) de trigo\b|\bvete(?:st[äa]rkelse|kli|groddar)\b|\bskrobia pszenna\b|\botr[ęe]by pszenne\b|\bbu[ğg]day (?:ni[şs]astas[ıi]|kepe[ğg]i)(?![a-zß-ÿ\u0100-\u017f])/i,           pts: 7,  why: 'Wheat fraction', gluten: true },
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

  // With the same words in each label language: "farine de seigle, eau, levain" kept the whole
  // rye charge that "rye flour, water, sourdough" halves.
  const TRADITIONAL_PREP = new RegExp('\\b(sourdough|sprouted|soaked|long[- ]?fermented|naturally leavened|einkorn|emmer|khorasan|kamut|heritage (wheat|grain))\\b'
    + '|(?<![a-zß-ÿœ\\u0100-\\u017f])(?:levain|masa madre|lievito madre|(?:roggen|weizen|dinkel|natur)?[- ]?sauerteig[a-z]*|zuurdesem|surdeg|zakwas(?:u|ie|em)?'
    + '|ek[şs]i maya|massa m[ãa]e|germée?s?|gekeimt[a-z]*|germinad[oa]s|germogliat[oaie]|gekiemd[a-z]*|groddad[a-z]*|kie[łl]kowan[a-zęąó]*|engrain|tremp[ée]e?s|eingeweicht[a-z]*|remojad[oa]s|ammollat[oaie]|geweekt[a-z]*|bl[öo]tlagd[a-z]*|namoczon[a-zęąó]*|demolhad[oa]s|[ıi]slat[ıi]lm[ıi][şs])(?![a-zß-ÿœ\\u0100-\\u017f])', 'i');

  const _exports = AIRmodule('additives', {
    CAPS, ISOLATES, FLAVOURS, TEXTURE, PRESERVATIVES, PROCESSING, FORTIFICATION, GRAINS, UNNAMED, TRADITIONAL_PREP, PLANTS,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
