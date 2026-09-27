// Sweeteners, sorted by source rather than by grams.
//
// Default rule: sugar that comes with the whole food it grew in — fruit, dairy — costs nothing.
// Concentrated traditional sweeteners cost a little; refined and industrial sweeteners cost a lot.
// The 'Naturally occurring sugars' weight turns the first part off for users who want total sugar.
// Artificial sweeteners and sugar alcohols are treated as worse than sugar, not better.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

// Manifest-declared content scripts share one top-level scope, so every const here
// must stay inside this closure or it collides with the other rule files at load time.
(function () {

  // FREE — zero penalty. These are whole foods that happen to contain sugar.
  const FREE = [
    /^[\w' -]{0,24}\bmilk$/i, /^lactose$/i, /^[\w' -]{0,20}\bcream$/i, /^yogh?urt$/i, /^kefir$/i,
    /^dates?$/i, /^date (paste|puree)$/i, /^raisins?$/i, /^currants?$/i, /^figs?$/i, /^prunes?$/i,
    /^banana(s| puree)?$/i, /^apple(s| puree| sauce)?$/i, /^pear(s| puree)?$/i, /^berries$/i,
    /^strawberr(y|ies)$/i, /^blueberr(y|ies)$/i, /^raspberr(y|ies)$/i, /^cherr(y|ies)$/i,
    /^mango(es)?$/i, /^pineapple$/i, /^peach(es)?$/i, /^apricots?$/i, /^orange(s)?$/i,
    /^whole fruit$/i, /^fruit puree$/i, /^coconut$/i, /^pumpkin$/i, /^sweet potato$/i, /^carrots?$/i,
    // The same foods in each label language. They carry no charge by default, but a goal that weighs
    // naturally occurring sugar (the blood-sugar presets do) charged "dates" and "milk" and let
    // "dattes" and "lait" through.
    new RegExp('^(?:lait(?: entier| [ée]cr[ée]m[ée]| demi-[ée]cr[ée]m[ée]| frais| cru)*|leche(?: entera| desnatada| semidesnatada| fresca)?|latte(?: intero| scremato| parzialmente scremato| fresco)?'
      + '|leite(?: inteiro| magro| meio-gordo)?|[a-zäöü]*milch|(?:volle |halfvolle |magere )?melk|[a-zåäö]*mj[öo]lk|mleko(?: pe[łl]ne| odt[łl]uszczone)?|(?:tam ya[ğg]l[ıi] |ya[ğg]s[ıi]z )?s[üu]t'
      + '|lactosa|lattosio|laktose|laktos|laktoza|laktoz|cr[èe]me(?: fra[îi]che)?|nata|panna|sahne|room|gr[äa]dde|[śs]mietan(?:a|ka)|krema|natas'
      + '|yaourt|yogur|yogurt|joghurt|jogurt|yo[ğg]urt|iogurte|k[ée]fir'
      + '|dattes|d[áa]tiles|datteri|datteln|dadels|dadlar|daktyle|hurma|t[âa]maras|raisins secs|(?:uvas )?pasas|uvetta|uva sultanina|rosinen|sultaninen|rozijnen|russin|rodzynki|kuru [üu]z[üu]m|uvas passas'
      + '|figues|higos|fichi|feigen|vijgen|fikon|figi|incir|figos|pruneaux|ciruelas pasas|prugne secche|trockenpflaumen|gedroogde pruimen|katrinplommon|suszone [śs]liwki|kuru erik|ameixas secas'
      + '|bananes?|pl[áa]tanos?|banane|bananas?|bananen|bananen?|banaan|banan(?:y|er)?|muz|pommes?|manzanas?|mel[ae]|[äa]pfel|appels?|[äa]pplen?|jab[łl]k[ao]|elma|ma[çc][ãa]s?|poires?|peras?|pere|birnen?|peren|p[äa]ron|gruszki|armut'
      + '|fraises|fresas|fragole|erdbeeren|aardbeien|jordgubbar|truskawki|[çc]ilek|morangos|myrtilles|ar[áa]ndanos|mirtilli|heidelbeeren|blaubeeren|bosbessen|bl[åa]b[äa]r|bor[óo]wki|mirtilos'
      + '|framboises|frambuesas|lamponi|himbeeren|frambozen|hallon|maliny|ahududu|framboesas|cerises|cerezas|ciliegie|kirschen|kersen|k[öo]rsb[äa]r|wi[śs]nie|kiraz|cerejas'
      + '|mangues?|mangos?|ananas|pi[ñn]a|abacaxi|p[êe]ches|melocotones|pesche|pfirsiche|perziken|persikor|brzoskwinie|[şs]eftali|p[êe]ssegos|abricots|albaricoques|albicocche|aprikosen|abrikozen|aprikoser|morele|kay[ıi]s[ıi]|damascos'
      + '|oranges|naranjas|arance|orangen|sinaasappels|apelsiner|pomara[ńn]cze|portakal|laranjas|noix de coco|coco|cocco|kokos(?:nuss|noot|n[öo]t)?|hindistan cevizi'
      + '|potiron|courge|calabaza|zucca|k[üu]rbis|pompoen|pumpa|dynia|bal kaba[ğg][ıi]|ab[óo]bora|patates? douces?|boniato|batata(?:-doce)?|patata dolce|s[üu][ßs]kartoffeln?|zoete aardappel|s[öo]tpotatis|batat|tatl[ıi] patates'
      + '|carottes?|zanahorias?|carote|karotten|m[öo]hren|wortelen|mor[öo]tter|marchew|havu[çc]|cenouras?'
      + "|pur[ée]e de pommes|compote de pommes|pur[ée] de manzana|purea di mele|apfelmark|apfelmus|appelmoes|[äa]ppelmos|mus jab[łl]kowy|elma p[üu]resi|pur[ée] de ma[çc][ãa]"
      + '|pur[ée]e de fruits|pur[ée] de frutas?|purea di frutta|fruchtp[üu]ree|vruchtenpuree|fruktpur[ée]|przecier owocowy|meyve p[üu]resi)$', 'i'),
  ];

  // TRADITIONAL — small penalty. Real food, but concentrated.
  const TRADITIONAL = [
    { m: /^(organic |raw |unfiltered |wildflower |manuka |clover )*(honey|miel|honig|miele|mel|honing)$/i, pts: 3,  why: 'Honey — concentrated sweetener, light touch' },
    { m: /^(pure |organic )?maple (syrup|sugar)$|^(?:sirop d['’][ée]rable|jarabe de arce|sciroppo d['’]acero|ahornsirup|ahornsiroop|l[öo]nnsirap|syrop klonowy|ak[çc]aa[ğg]a[çc] [şs]urubu|xarope de [áa]cer|sucre d['’][ée]rable|az[úu]car de arce|ahornzucker)$/i,         pts: 4,  why: 'Maple syrup — concentrated sweetener' },
    { m: /^(blackstrap )?molasses$|^(black )?treacle$|^(?:m[ée]lasse|melaza|melassa|mela[çc]o|melasse|melas)(?: de (?:canne|ca[ñn]a|cana))?$/i,                       pts: 4,  why: 'Molasses' },
    { m: /^coconut (sugar|nectar|sap)$/i,                   pts: 5,  why: 'Coconut sugar' },
    { m: /^date (sugar|syrup)$/i,                           pts: 4,  why: 'Date sugar' },
    { m: /^sorghum( syrup)?$/i,                             pts: 5,  why: 'Sorghum syrup' },
    { m: /^(fruit juice concentrate|apple juice concentrate|grape juice concentrate)$/i, pts: 8, why: 'Fruit juice concentrate — sugar stripped of its fruit' },
  ];

  // REFINED — full penalty. Position-weighted by the caller.
  const REFINED = [
    // "cane" is deliberately absent from this list: the cane rule below owns it, and carrying it
    // here as well charged "cane sugar" twice (17 + 4) against 17 for "sugar".
    { m: /^(organic )?(raw |turbinado |demerara |muscovado |granulated |white |caster |icing |confectioner(?:s['’]?|['’]s) )?sugar$/i, pts: 14, why: 'Refined added sugar' },
    // Spanish, French, German, Italian, Portuguese, Dutch, Swedish and Polish — the stores whose
    // headings the extractor already reads.
    { m: /^(az[uú]car|a[cç][uú]car|sucre|zucker|zucchero|suiker|socker|str[öo]socker|betsocker|cukier|[şs]eker|toz [şs]eker|kristal [şs]eker|rafine [şs]eker|pancar [şs]ekeri)( blanc[oa]| refinad[oa]| blanc| raffin[ée]| bianco| grezzo| wit| bia[łl]y| buraczany)?$/i, pts: 14, why: 'Refined added sugar' },
    // The same in each label language, here rather than in the refined rule above, so a cane sugar is
    // charged once and named as English names it.
    { m: /^(evaporated |raw |organic )*cane (juice|sugar|syrup)$|^(?:az[uú]car|sucre|zucchero|a[cç][uú]car)(?: moreno| roux| integral| grezzo| integrale| blond| complet)? d[ei] ca(?:[ñn]a|nne|nna|na)(?: roux| blond| complet| integral| integrale| grezzo| moreno| mascavo)?$|^(?:rohr(?:roh)?zucker|r[öo]rsocker|(?:ruwe )?rietsuiker|cukier trzcinowy|kam[ıi][şs] [şs]ekeri)$/i, pts: 14, why: 'Cane sugar' },
    { m: /^(brown sugar|az[uú]car moren[oa]|a[cç][uú]car mascav[oa]do|sucre (brun|roux)|brauner zucker|zucchero bruno|basterdsuiker|farinsocker|brunt socker|cukier br[ąa]zowy|br[ąa]zowy cukier(?: trzcinowy)?|cukier trzcinowy br[ąa]zowy|esmer [şs]eker|bruine suiker)$/i, pts: 14, why: 'Brown sugar' },
    { m: /^beet sugar$/i,                               pts: 14, why: 'Beet sugar' },
    { m: /^powdered sugar$/i,                           pts: 14, why: 'Powdered sugar' },
    { m: /^(invert sugar( syrup)?|golden syrup|(?:partially )?inverted (?:refiners[’']? )?sugar syrup|az[uú]car invertid[oa]|a[cç][uú]car invertid[oa]|xarope de a[çc][úu]car invertido|sucre inverti|invertzucker(?:sirup)?|sirop de sucre inverti|jarabe de az[uú]car invertido|sciroppo di zucchero invertito|invertsuikerstroop|zucchero invertito|invertsuiker|invertsocker(?:sirap)?|cukier inwertowany|syrop inwertowany|invert [şs]eker(?: [şs]urubu)?|invert [şs]urup)$/i, pts: 15, why: 'Invert sugar' },
    { m: /^(dextrose|dextrosa|destrosio|traubenzucker|dextros|druvsocker|dekstroza|dekstroz)$/i, pts: 14, why: 'Dextrose' },
    { m: /^glucose( syrup| solids)?$|^(jarabe de glucosa|sirop de glucose|glukosesirup|sciroppo di glucosio|xarope de glicose|xarope de glucose|glucosestroop|glukossirap|glukos|syrop glukozowy|glukoza|gl[iu]koz(?: [şs]urubu)?)$/i, pts: 14, why: 'Glucose syrup' },
    { m: /^(fructose|fructosa|fruktose|fruttosio|frutose|fruktos|fruktoza|fr[üu]ktoz)$/i, pts: 16, why: 'Isolated fructose' },
    { m: /^(?:sucrose|sacarosa|saccharose|saccarosio|sacarose|sackaros|sacharoza|sakaroz)$/i,                                  pts: 14, why: 'Sucrose' },
    { m: /^maltose$/i,                                  pts: 14, why: 'Maltose' },
    { m: /^agave( nectar| syrup)?$/i,                   pts: 16, why: 'Agave — among the highest-fructose sweeteners' },
    { m: /^(brown )?rice syrup$|^(jarabe de arroz|sirop de riz|reissirup|sciroppo di riso|rissirap|syrop ry[żz]owy|pirin[çc] [şs]urubu)$/i, pts: 14, why: 'Rice syrup' },
    { m: /^tapioca syrup$/i,                            pts: 13, why: 'Tapioca syrup' },
    { m: /^barley malt( syrup| extract)?$|^(?:gerstemoutextract|gerstenmalzextrakt|extracto de malta de cebada|extrait de malt d['’]orge|estratto di malto d['’]orzo|extrato de malte de cevada|kornmaltextrakt|ekstrakt s[łl]odu j[ęe]czmiennego|arpa malt[ıi] ekstrakt[ıi])$/i,            pts: 12, why: 'Barley malt syrup' },
    { m: /^(?:caramel|karamel|caramelo|caramello|karamell|karmel)$|^carameli[sz]ed sugar( syrup)?$|^(?:a[çc][úu]car caramelizado|az[úu]car caramelizado|sucre caram[ée]lis[ée]|zucchero caramellato|karamellisierter zucker|gekaramelliseerde suiker|karamelliserat socker|karmelizowany cukier(?: w proszku)?|karamelize [şs]eker)$|^burnt sugar$/i,                                  pts: 10, why: 'Caramel' },
    { m: /^honey (powder|solids)$/i,                    pts: 10, why: 'Honey powder — processed, not raw' },
  ];

  // INDUSTRIAL — hard cap territory.
  const INDUSTRIAL = [
    { m: /\bhigh[- ]fructose corn syrup\b|\bhfcs\b|\bjarabe de ma[ií]z de alta fructosa\b|\bsirop de ma[ïi]s [àa] haute teneur en fructose\b/i, cap: 30, why: 'High-fructose corn syrup' },
    // Do not fire a second generic cap inside "high-fructose corn syrup".
    { m: /(?<!fructose )\bcorn syrup( solids)?\b|\bjarabe de ma[ií]z\b|\bsirop de ma[ïi]s\b|\bm[ıi]s[ıi]r [şs]urubu/i, cap: 30, why: 'Corn syrup' },
    { m: /\bglucose[- ]fructose( syrup)?\b|\bglu[ck]ose[- ]fru[ck]tose(?:[- ]?sirup)?\b|\bfru[ck]tose[- ]glu[ck]ose(?:[- ]?sirup)?\b|\bsciroppo di glucosio[- ]fruttosio\b|\bxarope de glicose[- ]frutose\b|\bxarope de frutose[- ]glicose\b|\bglukos[- ]fruktossirap\b|\bsyrop glukozowo[- ]fruktozowy\b|\bsyrop fruktozowo[- ]glukozowy\b|\bglucose[- ]fructose[- ]?stroop\b|\bfructose[- ]glucose[- ]?stroop\b|\bgl[iu]koz[- ]fr[üu]ktoz [şs]urubu|\bfr[üu]ktoz[- ]gl[iu]koz [şs]urubu|\bni[şs]asta bazl[ıi] [şs]eker|\bnb[şs](?![a-zà-ÿ\u0100-\u017f])/i, cap: 30, why: 'Glucose-fructose syrup' },
  ];

  // ARTIFICIAL — treated as more concerning than sugar by default; adjustable in settings.
  const ARTIFICIAL = [
    { m: /\bsucralos[ae]\b|\bsucralosio\b|\bsukraloz[ae]?\b|\bsplenda\b|\be[- ]?955\b/i,       cap: 22, why: 'Sucralose' },
    { m: /\baspartam[eo]?\b|\bnutrasweet\b|\be[- ]?951\b|\be[- ]?962\b/i,   cap: 22, why: 'Aspartame' },
    { m: /\bac[ée]sulfam[eo]?([- ]?k| potassium| pot[áa]sico| de potassium| potassico)?\b|\bacesulfam[- ]?k\b|\bacess?ulfame?(?:[- ]?k| de pot[áa]ssio)?\b|\bases[üu]lfam(?:[- ]?k)?\b|\bace[- ]?k\b|\be[- ]?950\b/i, cap: 22, why: 'Acesulfame potassium' },
    { m: /\bsaccharin[e]?\b|\bsacarina\b|\be[- ]?954\b/i,     cap: 22, why: 'Saccharin' },
    { m: /\bneotame\b|\be[- ]?961\b/i,                        cap: 22, why: 'Neotame' },
    { m: /\badvantame\b|\be[- ]?969\b/i,                      cap: 22, why: 'Advantame' },
    { m: /\bcyclamates?\b|\bcyclamic acid\b|\bcyklaminian\w*|\bsiklamat\b|\bcyclamaat\b|\bciclamatos?\b|\bcyclamat\b|\bcyklamat\b|\be[- ]?952\b/i,                      cap: 22, why: 'Cyclamate' },
  ];

  // SUGAR ALCOHOLS & NOVEL — penalised, not capped.
  const ALCOHOLS = [
    { m: /^(?:erythritol|[ée]rythritol|eritritol[oe]?|erytrytol|erythrit|eritritol|e[- ]?968)$/i,             pts: 12, why: 'Erythritol' },
    { m: /^(?:xylitol|e[- ]?967)$/i,                pts: 10, why: 'Xylitol' },
    { m: /^(?:maltitol(?:s|e|i)?( syrup)?|maltitolo|maltitole|sirop de maltitol|e[- ]?965)$/i,      pts: 12, why: 'Maltitol' },
    { m: /^(?:sorbitol(?:s|e|i)?( syrup)?|sorbitolo|sorbitole|sirop de sorbitol|e[- ]?420)$/i,               pts: 11, why: 'Sorbitol' },
    { m: /^(?:mannitol|e[- ]?421)$/i,               pts: 11, why: 'Mannitol' },
    { m: /^(?:isomalte?|e[- ]?953)$/i,                pts: 11, why: 'Isomalt' },
    { m: /^(?:lactitol|e[- ]?966)$/i,               pts: 11, why: 'Lactitol' },
    { m: /^sugar alcohols?$/i,                      pts: 11, why: 'Sugar alcohol (unnamed)' },
    { m: /^allulose$/i,               pts: 8,  why: 'Allulose' },
    { m: /^(steviol glycosides?|stevia( leaf extract)?|reb[- ]?[am]|e[- ]?960[a-d]?|glycosides? de st[ée]viol(?: issus de (?:la )?st[ée]via)?|gluc[óo]sidos de esteviol|gluc[óo]sidos de steviol|glicosidi steviolici|steviolglycosid(?:e|en)|steviolglykosider|glikozydy stewiolowe|steviol glikozitleri|glicos[íi]deos de esteviol)$/i, pts: 8, why: 'Stevia extract — refined, not the leaf' },
    { m: /^monk fruit( extract| juice concentrate)?$/i, pts: 6, why: 'Monk fruit extract' },
    { m: /^(soluble )?(corn|tapioca|chicory) (fiber|root fiber)$|^(?:fibres? (?:solubles? )?de (?:chicor[ée]e|ma[ïi]s)|fibra (?:solubile )?di (?:cicoria|mais)|fibra (?:soluble )?de (?:achicoria|ma[ií]z)|fibra (?:sol[úu]vel )?de (?:chic[óo]ria|milho)|zichorienwurzelfasern?|zichorienfasern?|chicoreivezels?|cichoreivezels?|ma[ïi]svezels?|oplosbare ma[ïi]svezels?|cikoriafiber|b[łl]onnik z cykorii|hindiba k[öo]k[üu] lifi)$/i, pts: 9, why: 'Isolated fiber syrup' },
    // Oligofructose and fructo-oligosaccharides are inulin cut shorter, the same chicory isolate: they
    // were charged nothing where "inulin" costs 6, in English and every other language.
    { m: /^(?:inulin[ae]?|inuline|in[üu]lin|oligofru(?:c|k|t)to[sz][ae]?|oligofru(?:c|k|t)t?os[ae]?|oligofruttosio|oligofrutose|oligofructosa|oligofruktoz[ay]?|(?:fru(?:c|k)to|frutt?o?|fruto)[- ]?oligo(?:sac?c?h?[aá]r|sackar|sakkar|ssacar)[a-zíéáö]*|fos)$/i, pts: 6,  why: 'Isolated inulin' },
    { m: /^(?:polydextrose|e[- ]?1200)$/i,           pts: 12, why: 'Polydextrose' },
  ];

  const _exports = AIRmodule('sugars', { FREE, TRADITIONAL, REFINED, INDUSTRIAL, ARTIFICIAL, ALCOHOLS });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
