// Words that are unmistakably an ingredient panel but that no scoring rule charges.
//
// They decide one thing: whether an entry counts as read (score.js `recognised`, and through it the coverage
// gate). Nothing here adds or removes a point. The pattern lived inside score.js, a hundred lines of
// alternation between the parser and the scoring; it is a rule table like the others, reviewed and extended
// one language at a time, so it has a file of its own. A word added here can still move a score: an entry
// that counts as read can name the additive in a function word's bracket, be split from a neighbour, or
// change the processing class, so this file is hashed with the other rule sources (revision.js).

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

(function () {
  // The species a probiotic strain is written with ("B. breve", "L. acidophilus"); score.js joins a genus
  // initial to its species with the same list (joinStrains).
  const STRAIN_SPECIES = 'breve|lactis|longum|acidophilus|casei|paracasei|cremoris|plantarum|reuteri|rhamnosus'
    + '|diacetylactis|florentinus|bulgaricus|delbrueckii|thermophilus|bifidum|infantis|animalis|adolescentis'
    + '|helveticus|fermentum|salivarius|gasseri|johnsonii|kefiri|kefiranofaciens|mesenteroides|coagulans'
    + '|subtilis|boulardii|cerevisiae';

  // Vocabulary that is unmistakably an ingredient panel but matches no scoring rule, so a clean
  // short list is never mistaken for an unreadable one. Deliberately generous: being liberal with
  // ENGLISH food nouns costs the gate nothing, because the text this is meant to catch — another
  // language, OCR noise, a cosmetics panel — will not match English food words either. Matched
  // anywhere in the entry, since "turmeric root powder" should count as much as "turmeric".
  const COMMON_PANEL = new RegExp('\\b(?:' + [
    // panel staples
    'water|salt|spices?|herbs?|seasoning|vinegar|yeast|baking soda|baking powder|sodium bicarbonate',
    'culture|cultures|rennet|enzymes?|pectin|gelatin|agar|broth|stock|juice|puree|paste|extract',
    // beverages and their raw forms
    'tea|green tea|black tea|matcha|coffee|arabica|robusta|espresso|chicory|kombucha|cocoa|cacao|chocolate',
    // aromatics, spices, seasonings
    'vanilla|cinnamon|turmeric|ginger|paprika|cumin|coriander|oregano|basil|thyme|rosemary|sage|dill',
    'nutmeg|clove|cardamom|allspice|fennel|anise|saffron|chili|chilli|cayenne|peppercorns?|mustard',
    'garlic|onion|shallot|leek|celery|parsley|cilantro|bay leaf|bay leaves|lemongrass|mint',
    // produce
    'tomato|potato|carrot|cabbage|cauliflower|broccoli|spinach|kale|lettuce|cucumber|zucchini|squash',
    'pumpkin|beet|beetroot|turnip|radish|asparagus|artichoke|pepper|eggplant|aubergine|mushrooms?',
    'apple|banana|orange|lemon|lime|grape|berry|berries|mango|pineapple|peach|pear|plum|cherry|melon',
    'avocado|olive|coconut|date|fig|raisin|apricot|cranberry|currant',
    // grains, legumes, seeds, nuts
    'oats?|rice|quinoa|barley|millet|sorghum|buckwheat|amaranth|teff|rye|spelt|farro|couscous|pasta',
    'beans?|lentils?|chickpeas?|peas?|soy|edamame|tofu|tempeh|hummus',
    'chia|flax|linseed|hemp|sesame|tahini|sunflower seeds?|pumpkin seeds?|poppy',
    'almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamias?|peanuts?|nuts?',
    'flour|starch|bran|germ|semolina|masa|tapioca|arrowroot|cornmeal',
    // animal foods
    'beef|pork|chicken|turkey|lamb|duck|bison|veal|venison|goat|liver|bone|gelatine',
    'fish|salmon|tuna|cod|halibut|sardines?|anchov(?:y|ies)|mackerel|trout|shrimp|crab|scallops?|oysters?',
    'milk|cream|butter|cheese|yogh?urt|kefir|ghee|whey|curd|eggs?',
    // seaweed, fungi, ferments
    'nori|kombu|wakame|seaweed|kelp|spirulina|chlorella|miso|kimchi|sauerkraut|sourdough|nutritional yeast',
    // Probiotic organisms, by genus or as the "B. breve" / "L. acidophilus" short form (joined by
    // joinStrains below). A kefir that names its twelve strains is not an unreadable label.
    'bifidobacteri(?:um|a)|bifidus|lactobacill(?:us|i)|lactococcus|lacticaseibacillus|leuconostoc|saccharomyces|streptococcus thermophilus|probiotics?|live (?:and )?active cultures',
    '[a-z] (?:' + STRAIN_SPECIES + ')',
    'honey|maple|molasses|syrup',
    // Fortification vocabulary, which real cereal panels are full of. Without it a fortified product
    // reads as barely recognisable: Kellogg's Frosted Flakes measured 44% coverage against live
    // Amazon text, uncomfortably close to the 34% floor for a list the engine reads perfectly well.
    'corn|maize|vitamins?|minerals?|malt|niacin|thiamin[e]?|riboflavin|folate|folic|pyridoxine',
    'cobalamin|tocopherol|ascorb(ic|ate)|calcium|iron|zinc|magnesium|potassium|phosphate',
    // Non-English staples, so a Spanish/French panel that DOES hit the cap rules above clears the
    // coverage gate and gets scored rather than declined.
    'agua|eau|wasser|sal|sel|salz|az[uú]car|sucre|zucker|leche|lait|milch|harina|farine|mehl|avoine|hafer|avena|flocons|hafervollkornflocken|muesli|granola',
    'aceite|huile|[öo]l|jarabe|sirop|jugo|jus|saft|ma[ií]z|ma[ïi]s|trigo|bl[ée]|arroz|riz|reis',
    'soja|girasol|tournesol|colza|vegetal|v[ée]g[ée]tale|almid[óo]n|amidon|levadura|levure',
    // Italian staples, and German compounds: "Vollmilchpulver" and "Kakaobutter" contain the words
    // above but no word boundary, so they read as unrecognised and a correctly scored German list
    // still carried a "50% recognised" warning.
    'acqua|sale|latte|farina|olio|succo|riso|mais|soia|lievito|agenti lievitanti|amido|burro|panna|formaggio|uova|miele|nocciole|mandorle',
    '\\w*(?:milch|zucker|butter|mehl|pulver|st[äa]rke|sirup|saft|salz|wasser|sahne|k[äa]se|joghurt|schokolade|kakao|mandeln|n[üu]sse|haselnuss|erdnuss)\\w*',
    'emulgator(?:en)?|emulsionantes?|emulgentes?|[ée]mulsifiants?|emulsionanti|conservante|conservateur|konservierungsstoff|colorante|colorant|farbstoff|s[äa]uerungsmittel|acidulant|acidificante|correcteur',
    // Colours from food, which no rule charges. Without them "Annatto (color)" read as an unnamed
    // colour next to an unrecognised word, and "beta carotene" lowered coverage on a clean list.
    'annatto|carotenes?|carotenoids?|beet(?:root)? (?:juice|powder|red)|anthocyanins?|lycopene|curcumin|chlorophyll(?:in)?|carmine|cochineal|riboflavin|lutein|paprika (?:extract|oleoresin)|spirulina extract|caramel',
    // Swedish and Polish staples. Words that begin with a letter outside ASCII (äpple, śmietanka,
    // łosoś) follow the list, with explicit boundaries, because `\\b` cannot see those letters. Generic
    // words (olja, olej, mjöl, mąka, syra, kwas) are left out on purpose: "olej bawełniany" or "kwas
    // sorbowy" would then count as read while no rule charged them.
    'vatten|woda|havre|havregryn|havremj[öo]l|owies|owsiane|p[łl]atki|kakao|kulturer|kultury|bakterie|mleko|mleka|mleczn\\w*|dro[żz]d[żz]e|j[äa]st',
    'potatis|ziemniaki|ziemniaczan\\w*|tomater|tomatpur[ée]|pomidory|pomidorow\\w*|vitl[öo]k|czosnek|cebula|basilika|bazylia|oregano|persilja|pietruszka|peppar|pieprz|kanel|cynamon|ingef[äa]ra|imbir|paprika|papryka|kryddor|przyprawy',
    'russin|rodzynki|hasseln[öo]tter|mandlar|orzechy|migda[łl]y|solrosfr[öo]n|pumpafr[öo]n|nasiona|pestki|sesamfr[öo]n|sezam|jab[łl]ka|jab[łl]ko|jordgubbar|truskawki|hallon|maliny|bl[åa]b[äa]r|jagody|citron|cytryna|banan|banany|apelsin|pomara[ńn]cz\\w*',
    'gr[äa]dde|mj[öo]lk|skummj[öo]lk|helmj[öo]lk|mj[öo]lkpulver|\\w*mj[öo]lkspulver|ost|ser|mas[łl]o|jogurt|yoghurt|smetana|vassle|serwatka|jaja|jajka|honung|mi[óo]d|kakaosm[öo]r|kakaomassa|miazga kakaowa|t[łl]uszcz kakaowy',
    'pektin|pektyna|pektyny|koffein|kofeina|kolsyra|kolsyrat|gazowana|natriumbikarbonat|natriumv[äa]tekarbonat|bakpulver|wodorow[ęe]glan sodu|proszek do pieczenia|substancj[ae] spulchniaj[ąa]c[ae]|spulchniacz|j[äa]stpulver',
    'ris|ry[żz]|majs|kukurydza|kli|otr[ęe]by|b[öo]nor|fasola|linser|soczewica|kik[äa]rtor|ciecierzyca|groch|soja',
    'kyckling|kurczak|n[öo]tk[öo]tt|wo[łl]owina|fl[äa]sk|wieprzowina|lax|fisk|ryba|r[äa]kor|krewetki',
    'palmolja|olej palmowy|kokosolja|olej kokosowy|olivolja|oliwa z oliwek|sm[öo]r',
    'emulgeringsmedel|stabiliseringsmedel|f[äa]rg[äa]mne|barwnik|surhetsreglerande medel|regulator kwasowo[śs]ci|smakf[öo]rst[äa]rkare|wzmacniacz smaku|konserveringsmedel|konserwant',
    // Benign E-numbers, so an EU list written in codes is still recognised as a list. Every E-number
    // that a rule charges is recognised through that rule; these are the ones nothing charges.
    'e[- ]?(?:100|120|14[01]|16[0-3][a-i]?|262|32[5-7]|33[1-3]|40[1-6]|440a?|50[0-4](?:i{1,3})?|50[89]|524|57[45]|49[1-5]|901|903|941|948)',
    // Plain English foods and seasonings that real lists name and no rule charges. Each missed `\\b` on a
    // plural or compound ("blackberries" beside "berries", "flaxseed" beside "flax"), so "Shallots" or
    // "Okra, water, salt" read as unrecognised and a clean list could fall under the coverage gate.
    'blackberr(?:y|ies)|pomegranates?|papayas?|guavas?|kiwis?|kiwifruit|a[çc]a[íi]|acai|elderberr(?:y|ies)|mulberr(?:y|ies)|lingonberr(?:y|ies)|sea buckthorn|tart cherr(?:y|ies)|rhubarb|chestnuts?|bulgur|freekeh|polenta|grits|popcorn|oatmeal|flaxseeds?',
    'jalape[ñn]os?|habaneros?|poblanos?|chipotles?|sun-?dried tomato(?:es)?|roasted red peppers?|scallions?|shallots?|leeks?|bok choy|brussels sprouts?|collard greens?|chard|arugula|rocket|yams?|cassava|yuca|plantains?|jackfruit|bamboo shoots?|okra|kohlrabi|rutabaga|watercress|endive|radicchio|dulse|konjac',
    'carob|rooibos|hibiscus|chamomile|peppermint|spearmint|caraway|sumac|za.?atar|wasabi|horseradish|capers?|pickles?|harissa|sriracha|tabasco|hot sauce|hoisin|tamari|worcestershire|mirin|curry(?: powder| leaves)?|garam masala',
    'ricotta|feta|skyr|lobster|squid|calamari|prosciutto|pancetta|salami|pepperoni|chorizo|rabbit|seitan|krill oil|algal oil|mct oil|selenium|chromium|manganese|molybdenum',
  ].join('|') + ')\\b'
    + '|(?<![a-zß-ÿ\\u0100-\\u017f])(?:ägg|äggula|äggvita|äpple|äpplen|ärtor|ärter|[śs]mietan[a-zß-ÿ\\u0100-\\u017f]*|łoso[śs]|żyto'
    // Turkish staples: most end or begin in ı, ş, ğ, ç or ü, so they take the same boundaries.
    + '|su|tuz|maya|s[üu]t|s[üu]t tozu|ya[ğg]s[ıi]z s[üu]t tozu|tam ya[ğg]l[ıi] s[üu]t tozu|krema|tereya[ğg][ıi]|peynir|yo[ğg]urt|yo[ğg]urt k[üu]lt[üu]r[üu]|k[üu]lt[üu]r(?:[üu]|ler)?|yumurta|bal|kakao|kakao ya[ğg][ıi]|kakao k[üu]tlesi'
    + '|patates|domates|sar[ıi]msak|so[ğg]an|fesle[ğg]en|kekik|biber|kuru [üu]z[üu]m|[üu]z[üu]m|f[ıi]nd[ıi]k|badem|ceviz|ay[çc][ıi][çc]e[ğg]i [çc]ekirde[ğg]i|elma|[çc]ilek|limon|portakal|muz'
    + '|pirin[çc]|m[ıi]s[ıi]r|nohut|mercimek|fasulye|bezelye|yulaf|yulaf ezmesi|tavuk|tavuk eti|s[ıi][ğg][ıi]r eti|dana eti|bal[ıi]k|baharat(?:lar)?|pektin|kafein|karbonatl[ıi] su|maden suyu'
    + '|kabart[ıi]c[ıi](?:lar)?|kabartma tozu|sodyum bikarbonat|lezzet artt?[ıi]r[ıi]c[ıi]|palm ya[ğg][ıi]|zeytinya[ğg][ıi]|hindistan cevizi ya[ğg][ıi]|aroma verici(?:ler)?'
    // Everyday words from real labels (Open Food Facts, 2026-09-26), per language, that matched no rule and
    // left real lists declined: nothing here is charged; it only lets the list be read.
    + '|b(?:1|2|3|5|6|7|9|12)|d[23]|vitamin[aeos]?|vitamine[ns]?|vitaminer|vitaminler|witaminy|tocopher\\w*|tocoferol\\w*|tokoferol\\w*|tokoferoller|beta[- ]?karoten|beta[- ]?caroten[eo]?|palm|palme|palma|palmiste|palmkern|shea|karit[ée]' // any
    + '|sodium citrates?|trisodium citrate|calcium citrate|carbon dioxide|carbonic acid|sodium acid carbonate|sodium hydrogen carbonate|ammonium hydrogen carbonate|(?:sodium|ammonium) carbonates?|raising agents?|baking powders?|oligofructose|sultanas|cranberries|humectant|cocoa mass|sunflower|rapeseed|glazing agent|flour treatment agent|anti-?caking agent|firming agent|gelling agent|carnauba wax|beeswax|palm fat|vegetable fats?' // en
    + '|poudres? [àa] lever|carbonates? (?:acides? )?d[e\'’] ?(?:sodium|ammonium)|bicarbonates?|noisettes?|cr[èe]me(?: fra[îi]che)?|magn[ée]sium|extrait de vanille|vanille|ferments? lact?iques?|vinaigre(?: de vin| d[\'’]alcool)?|ail|noix de cajou|noix|levain|levures?|pr[ée]sure(?: halal)?|fromage blanc|perm[ée]at de lactos[ée]rum|lactos[ée]rum(?: en poudre)?|basilic|raisins secs|flocons d[\'’]avoine(?: compl[èe]te)?|avoine|dattes|amandes?|citrates? de sodium|pectines?|huile de palme|graisses? v[ée]g[ée]tales?|mati[èe]re grasse\\w*|sirop d[\'’][ée]rable' // fr
    + '|kohlens[äa]ure|natriumcitrate?|trinatriumcitrat|cashewkerne|basilikum|vanilleextrakt|vanille|tomaten\\w*|sojabohnen|calciumcarbonat|knoblauch|backtriebmittel|eier|walnusskerne|haselnusskerne|sonnenblumen?|pektine?|tricalciumcitrat|tocopherolhaltige extrakte|datteln|weinessig|branntweinessig|essig|traubenmost|kichererbsen|hafer|haferflocken|gew[üu]rze|kartoffel\\w*|zitronen\\w*|lysozym|palm[öo]l|pflanzliche fette|speisesalz|meersalz|jodsalz|natriumhydrogencarbonat|ammoniumhydrogencarbonat|natriumcarbonate|ammoniumcarbonate' // de
    + '|avellanas|gasificantes?|calcio|carbonatos? [áa]cidos? de (?:sodio|amonio)|bicarbonato s[óo]dico(?: y am[óo]nico)?|almendras?(?: tostadas)?|extracto rico en tocoferoles|vitaminas?|manteca de palma|grasas? de palma|grasas? vegetales|copos de avena(?: integral)?|avena(?: integral)?|cacahuetes|oligofructosa|citratos? de sodio|citrato tric[áa]lcico|pectinas?|nata|hierro|yoduro de potasio|fibra de guisante|carbonato de calcio|cafe[íi]na|anacardos|pecanas|pacanas|nueces(?: de brasil)?|sal marina' // es
    + '|anidride carbonica|cipoll[ae]|carbonato acido di (?:sodio|ammonio)|vaniglia|semi di sesamo|noci(?: di acagi[ùu]| del brasile| sgusciate)?|pistacchi|fiocchi d[\'’] ?avena|avena|polpa di pomodoro|concentrato di pomodoro|pomodor[io]|peperoni(?: rossi)?|crusca|germe|anacardi|basilico|patate(?: disidratate)?|caffeina|girasole|olio di palma|grassi vegetali|sale marino|aceto' // it
    + '|[áa]gua|leite(?: de vaca)?(?: pasteurizado)?|levedantes?(?: qu[íi]micos)?|hidrogenocarbonato de (?:s[óo]dio|am[óo]nio)|carbonatos? de (?:s[óo]dio|c[áa]lcio|magn[ée]sio)|extr[ae]c?to rico em tocofer[óo]is|cacau(?: magro)?(?: em p[óo])?|manteiga de cacau|vitaminas?|citrato tric[áa]lcico|pectinas|citratos de s[óo]dio|[óo]leo de palma|flocos de aveia|aveia|milho|di[óo]xido de carbono|gorduras? vegeta(?:l|is)|gordura de palma|tomate|vinagre(?: de [áa]lcool)?|nata|fermentos?(?: vivos)?(?: de iogurte)?|ferro|[áa]cido pantot[ée]nico|ovos|cebola|am[êe]ndoas?|miolo de am[êe]ndoa|amendoins|sementes de s[ée]samo|fibras? vegeta(?:l|is)|fibra de ervilha|cafe[íi]na|avel[ãa]s|sal marinho' // pt
    + '|zout|zeezout|cacaomassa|cacaoboter|magere cacaopoeder|cacaopoeder|melk|pectinen?|natriumcitraten?|vanille|tricalciumcitraat|calciumcitraten|sojabonen|palmolie|bulgaricus|amandel(?:en)?|calciumcarbonaat|ijzer|wortelextract|eieren|plantaardige vetten|mangopit|geleermiddel|rijsmiddel(?:en)?|ammoniumcarbonaten|natriumcarbonaten|hazelnoten|weipoeder|haver|maïsvezel|walnoten|granen|gist|azijn' // nl
    + '|havssalt|ystenzym|tomatpur[ée]|koncentrerad tomatpur[ée]|tomatkoncentrat|[äa]ttika|vin[äa]ger|sojab[öo]nor|natriumkarbonater|jordn[öo]tter|kryddextrakt|[öo]rtextrakt|krydd- och [öo]rtextrakt|paprikaextrakt|l[öo]k|mandel|laktos|yoghurtkultur|chilipeppar|syrakulturer|syrningskultur|bakteriekultur|majsk[äa]rnor|hela majsk[äa]rnor|durumvete|kik[äa]rter|mor[öo]tter|[öo]rtkryddor|mj[öo]lkprotein|trinatriumcitrat|laktasenzym|vassleprodukt|snabbkaffe\\w*|kaffe|kokosfett|mj[öo]lkfett|apelsinjuice\\w*|citronjuice\\w*' // sv
    + '|s[óo]l(?: morska)?|dwutlenek w[ęe]gla|cytryniany sodu|orzeszki (?:ziemne|arachidowe)(?: pra[żz]one)?|pra[żz]one orzeszki arachidowe|gorczyc[ęa]|nap[óo]j sojowy|ekstrakt z wanilii|wyci[ąa]g z rozmarynu|s[łl]onecznik\\w*|miazga z orzech[óo]w laskowych|syrop klonowy|ocet(?: spirytusowy)?|ekstrakty? przypraw(?: i zi[óo][łl])?|przyprawy?|permeat serwatki|t[łl]uszcz palmowy|t[łl]uszcze ro[śs]linne|czekolada\\w*|t[łl]uszcz kakaowy|wodorow[ęe]glan (?:amonu|sodu)|p[łl]atki owsiane|pe[łl]noziarnist\\w* p[łl]atk\\w* owsian\\w*|kukurydz\\w*|ziarna kukurydzy|skrobia z manioku|kokos\\w*|migda[łl]\\w*|soj[ęa]|ziarna soi' // pl
    + '|karbondioksit|sodyum hidrojen karbonat|amonyum (?:hidrojen karbonat|bikarbonat)|ay[çc][ıi][çc]ek|deniz tuzu|yer f[ıi]st[ıi][ğg][ıi]|peynir ?alt[ıi] suyu tozu|poligliserol polirisin?oleat|pamuk|sirke|ni[şs]asta|sodyum metabis[üu]lfit|sodyum sitrat|sodyum asit pirofosfat|hindiba k[öo]k[üu] lifi|hindistan cevizi (?:s[üu]t[üu]|kremas[ıi])|un i[şs]lem maddesi|nem verici|s[ıi][ğg][ıi]r jelatini|parlatma maddesi|karnauba mumu|kalsiyum karbonat|tam ya[ğg]l[ıi] s[üu]t ?tozu|asitli[ğg]i d[üu]zenleyici(?:ler)?' // tr
    // From the second sample (page 2, 661 lists): additives English leaves uncharged but did not read either,
    // in each language, so they counted against the list as unreadable.
    + '|humectants?|humectantes?|humidificantes?|umidificant[ei]|feuchthaltemittel|bevochtigingsmiddel(?:en)?|fuktighetsbevarande medel|substancj[ae] utrzymuj[ąa]c[ae] wilgo[ćc]|nem vericiler?|nemlendirici(?:ler)?'
    + '|(?:sodium|potassium|calcium) alginates?|alginate de (?:sodium|potassium|calcium)|alginato (?:s[óo]dico|pot[áa]sico|c[áa]lcico|de s[óo]dio|di sodio)|(?:natrium|kalium|calcium)alginaa?t|alginian (?:sodu|potasu|wapnia)|sodyum aljinat'
    + '|emulsifying salts?|sels de fonte|sales (?:de )?fundid[oa]s?|sali di fusione|schmelzsalze?|smeltzouten|sm[äa]ltsalter|s[óo]le emulguj[ąa]ce|eritme tuzlar[ıi]|sais de fus[ãa]o'
    + '|polyglycerol esters?(?: of fatty acids)?|sorbitan (?:tri|mono)?stearate|sorbitan(?:tri|mono)stearat|trist[ée]arate de sorbitane|triestearato de sorbitano|(?:ya[ğg] asitlerinin )?poligliserol esterleri'
    + '|sodium hydroxide|natriumhydroxide?|hydroxyde de sodium|hidr[óo]xido de s[óo]dio|idrossido di sodio|wodorotlenek sodu|sodyum hidroksit|kaliumcarbonate?n?|carotin|b[ée]ta[- ]?carot[èe]ne'
    + '|siyah [çc]ay|ye[şs]il [çc]ay|[çc]ay|tahin[ie]?|tahina|karabu[ğg]day|nane|maydanoz|dereotu|fesle[ğg]en|kekik|biberiye|karabiber|mynta|persilja|basilika|timjan|rosmarin|peppar|menthe|persil|aneth|basilic|origan|thym|romarin|ciboulette|menta|perejil|eneldo|albahaca|or[ée]gano|tomillo|romero|prezzemolo|aneto|basilico|origano|timo|rosmarino|minze|petersilie|thymian|peterselie|dille|basilicum|tijm|rozemarijn|mi[ęe]ta|pietruszka|koperek|bazylia|tymianek|rozmaryn|hortel[ãa]|endro|manjeric[ãa]o|or[ée]g[ãa]os|tomilho|alecrim'
    + '|pectins|pantothenic acid|(?:calcium )?d-?pantothenate|biotin|mixed seeds|seed mix|seeds|vegetables|parsnips?|lovage|celeriac|mace|cloves?|chives|curcuma|nigari|salvia hispanica|caffeine|taurine|tartaric acid|invertase|psyllium(?: husks?)?|dietary fib(?:re|er)s?|vegetable fib(?:re|er)s?|ammonium acid carbonate|(?:green |black )?olives|peppermint oil|propellant gas|nitrogen'
    + '|iodine|iodised salt|iodized salt|jod|jodid|iode|yodo|iodio|jodium|jodek|iyot|iyodat|klumpf[öo]rebyggande medel|antiaglomerantes?|anti-?agglom[ée]rants?|trennmittel|antiagglomeranti?|antiklontermiddel(?:en)?|substancj[ae] przeciwzbrylaj[ąa]c[ae]|topaklanmay[ıi] [öo]nleyici(?:ler)?|antiaglutinantes?'
    + '|lactas[ea]|laktase?|lattasi|laktaz(?: enzimi)?|kahve|[öo][ğg][üu]t[üu]lm[üu][şs] kahve|caf[ée](?: moulu| soluble| torr[ée]fi[ée])?|caff[èe]|kaffee|koffie|kaffe|kawa|chicor[ée]e(?: soluble)?|achicoria|cicoria|zichorie|cichorei|cikoria|cykoria|hindiba|sumo|polpa'
    + "|huile de s[ée]same|aceite de s[ée]samo|olio di sesamo|sesam[öo]l|sesamolie|sesamolja|olej sezamowy|susam ya[ğg][ıi]|[óo]leo de s[ée]samo"
    + '|mj[öo]lksyrakulturer?|syrakulturer?|vitm[öo]gelkultur|l[öo]pe|milchs[äa]urekulturen|fermenti lattici|fermentos? l[áa]cticos|zuursel|kultury bakterii|pr[ée]sure|cuajo(?: microbiano)?|caglio|stremsel|podpuszczk[ai]|peynir mayas[ıi]|coalho(?: microbiano)?|labferment'
    // From the third sample (page 3, 715 lists): everyday words English reads and does not charge.
    + '|selderij|selleri|sellerie|apio|c[ée]leri|sedano|aipo|seler|kereviz|prei|purjol[öo]k|poireaux?|puerros?|porro|lauch|p[ıi]rasa'
    + '|citroen\\w*|zitrone|lim[óo]n|limone|lim[ãa]o|sinaasappel\\w*|naranjas?|arancia|arance|laranjas?|mandarijn\\w*'
    + '|vainilla|baunilha|vanilya|wanilia|vanilj\\w*|vanillepoeder|extracto de vainilla|estratto di vaniglia'
    + '|chocolat(?: noir| au lait| blanc)?|cioccolato(?: fondente| al latte| bianco)?|\\w*chocolade|[a-zß-ÿ]*choklad|(?:s[üu]tl[üu] |bitter |beyaz )?[çc]ikolata'
    + '|especias?|especiarias?|specerij(?:en)?|[ée]pices|gew[üu]rz|spezie|przyprawa'
    + '|kryddnejlik(?:a|or)|clavos?(?: de olor)?|chiodi di garofano|cravinhos?|clous? de girofle|(?:gew[üu]rz)?nelken|kruidnagel(?:en)?|go[źz]dzik[ia]?|karanfil'
    + '|mostaza|moutarde|senf|mosterd|senap|hardal|mostarda|senape|senapsfr[öo]n|semillas de mostaza|graines de moutarde|senfk[öo]rner|senfsa(?:men|at)|mosterdzaad|semi di senape|ziarna gorczycy|hardal tohumu|sementes de mostarda'
    + '|carotenos|karotener|karotenler|karoteny|carot[èe]nes?|caroteni|karotene|antocyjany|antocianinas?|antocianine|anthocyanes?|antocyaner|antosiyanin(?:ler)?|antocianos'
    + "|carbonato acido d['’] ?ammonio|ammoniumv[äa]tekarbonat|w[ęe]glany (?:amonu|sodu)|carbonatos? (?:de )?(?:amonio|am[óo]nio|sodio)|ammoniumcarbonat|natriums[äa]urecarbonat|natriumbicarbonaat|carbonati di (?:sodio|ammonio)|bicarbonato di sodio|bicarbonato de s[óo]dio|natriumcarbonate?|(?:sodyum|amonyum) karbonatlar?"
    + '|agent[ei] lievitant[ei]|triebmittel|trisodyum sitrat|citrato tris[óo]dico|citrate trisodique'
    + '|cloruro pot[áa]sico|kaliumchlorid|cloruro di potassio|cloreto de pot[áa]ssio|chlorek potasu|potasyum kl[öo]r[üu]r|kaliumklorid'
    + '|tiamina|tiammina|tiamin|tiamine|farinha|zonnebloem|girassol|solros|levedura|(?:back)?hefe'
    + '|estratt[io] di rosmarino|extrait de romarin|extracto de romero|rosmarinextrakt|rozemarijnextract|ekstrakt z rozmarynu|biberiye ekstrakt[ıi]'
    + ')(?![a-zß-ÿ\\u0100-\\u017f])', 'i');

  const _exports = AIRmodule('vocabulary', { STRAIN_SPECIES, COMMON_PANEL });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
})();
