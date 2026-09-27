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
const PLANT_FR = '(?!\\s+(?:de\\s+(?:coco|soja|riz|cacao|karit[ée]|cacahu[èe]tes?|tartre|marrons)|d[\'’](?:amandes?|avoine|noisettes?|arachide)))';
const PLANT_IT = '(?!\\s+di\\s+(?:cocco|mandorl[ae]|avena|soia|riso|nocciol[ae]|cacao|arachidi|karit[ée]))';
// `\b` does not see an accented letter as part of a word, so "blé", "œuf", "maní" and "łosoś" need
// explicit boundaries. L and R are those boundaries for Latin-1 and Latin Extended-A (Polish), and
// W is the rest of a word: `\w*` stops at "ö", so "jordnötssmör" never reached its end.
const L = '(?<![a-zß-ÿœ\\u0100-\\u017f])';
const R = '(?![a-zß-ÿœ\\u0100-\\u017f])';
const W = '[a-zß-ÿœ\\u0100-\\u017f]*';
// Swedish, Polish, Dutch and Portuguese plant "milks" and butters: kokosmjölk, mleko kokosowe,
// kokosmelk, leite de coco; kakaosmör, masło kakaowe, cacaoboter, manteiga de cacau.
const PLANT_PL = '(?!\\s+(?:kokosow|owsian|sojow|migda[łl]ow|ry[żz]ow|kakaow|orzechow|arachidow|shea|z\\s+orzech)' + W + ')';
const PLANT_PT = '(?!\\s+de\\s+(?:coco|am[êe]ndoas?|aveia|soja|arroz|cacau|amendoim|karit[ée]|castanhas?))';
// "Milk thistle" and "milkweed" are plants; "cream of tartar" is a salt of tartaric acid.
const DAIRY = NOT_DAIRY_BEFORE + L + '(?:milk|butter|cream)' + R + '(?!\\s*(?:of\\s+tartar|flavou?r|thistle|weed))'
  + '|\\b(?:dairy|cheese|yogh?urt|whey|casein(?:ate)?|lactose|ghee|kefir|custard|buttermilk|lactalbumin|lactoglobulin|paneer|quark)\\b'
  // Named cheeses, butterfat, curds ("bean curd" is tofu), half-and-half, skyr and labneh name no
  // dairy word, and all were read as dairy-free.
  + '|\\b(?:butterfat|skyr|labneh|mozzarella|parmesan|parmigiano|cheddar|feta|gouda|brie|camembert|provolone|romano|pecorino|gruy[èe]re|emmental|emmenthal|havarti|colby|monterey jack|halloumi|burrata|asiago|fontina)\\b'
  + '|(?<!\\bbean\\s)\\bcurds?\\b|\\bhalf[- ]?(?:and|&)[- ]?half\\b'
  // es
  + '|\\b(?:leche|nata|mantequilla)' + PLANT_ES + '\\b|\\b(?:queso|suero(?: de leche)?|lactosa|case[ií]na|yogur|requesón|cuajada)\\b'
  // "crema" is Spanish and Italian; "crema de cacahuete" and "crema di nocciole" are spreads
  + '|\\bcrema(?!\\s+d[ei]\\s+(?:t[áa]rtar[oa]|coco|cocco|cacahuete|man[ií]|nocciol[ae]|mandorl[ae]|almendras?|arroz|riso|cacao|soja|soia|avena))\\b'
  // fr
  + '|\\b(?:lait|beurre|cr[èe]me)' + PLANT_FR + '\\b|\\b(?:fromage|lactos[ée]rum|petit[- ]lait|cas[ée]ine|yaourt|babeurre)\\b'
  // de — compounds, so no leading boundary: Vollmilchpulver, Süßmolkenpulver, Butterreinfett.
  // Lactic acid is Milchsäure / mjölksyra / melkzuur, and is not dairy (nor is "lactic acid").
  + '|(?<!kokos|nuss|kern|mandel|hafer|soja|reis|erdnuss|cashew|kakao|shea)(?:milch(?!s[äa]ure)|molke|sahne|rahm|quark|k[äa]se|joghurt|butterreinfett|kasein|laktose)\\w*'
  // it
  + '|\\b(?:latte|burro|panna)' + PLANT_IT + '\\b|\\b(?:formaggio|siero(?: di latte)?|lattosio|caseina|yogurt|ricotta|mascarpone)\\b'
  // sv — compounds with the modifier in front, like German: skummjölkspulver, helmjölk, vasslepulver
  + '|(?<!kokos|havre|soja|ris|mandel|cashew|kakao|shea|jordn[öo]ts?|n[öo]t)(?:mj[öo]lk(?!syra)|gr[äa]dde|vassle|laktos)' + W
  + '|' + L + '(?:sm[öo]r|smörfett|ost|ostpulver|kvarg|filmj[öo]lk)' + R
  // pl — "mleko w proszku", "masło", "śmietanka", "serwatka", "ser"
  + '|' + L + '(?:mlek[aoui]|mleczn' + W + '|mas[łl][ao]|ma[śs]lank' + W + '|[śs]mietan' + W + '|serwatk' + W + '|ser(?:a|y|ek)?|twar[óo]g' + W + '|kazein' + W + '|laktoz' + W + '|jogurt' + W + ')' + PLANT_PL + R
  // nl — melkpoeder, magere melk, roomboter, kaas, wei; kokosmelk and pindakaas (peanut butter) are not
  + '|(?<!kokos|haver|soja|rijst|amandel|cashew|cacao|shea|noten|pinda)melk(?!zuur)' + W + '|' + L + '(?:room(?!\\s+temperat)|roomboter|slagroom|boter|kaas|wei|weipoeder|karnemelk|kwark)' + R
  // pt — leite, manteiga, queijo, soro de leite, iogurte, requeijão
  + '|' + L + '(?:leite|manteiga|creme de leite)' + PLANT_PT + R + '|' + L + '(?:queijos?|soro de leite|iogurtes?|requeij[ãa]o|lactose)' + R
  // tr — süt, süt tozu, tereyağı, peynir altı suyu (whey); "hindistan cevizi sütü", "badem sütü" and
  // "bitkisel krema" (a whipped vegetable-fat topping) are not
  + '|(?<!(?:cevizi|badem|yulaf|soya|pirin[çc]|f[ıi]nd[ıi]k)\\s)' + L + '(?:s[üu]t(?!\\s+asidi)(?:[üu]|l[üu]|tozu)?|tereya[ğg][ıi]?|kaymak|peynir' + W + '|yo[ğg]urt' + W + '|laktoz|kazein' + W + '|ayran|lor)' + R
  + '|(?<!bitkisel\\s)' + L + 'krema(?:s[ıi])?' + R
  // Cheeses, fresh cheeses and dairy words the lists above did not name, found by probing each language.
  + '|' + L + '(?:milkfat|comt[ée]|reblochon|roquefort|raclette|mimolette|morbier|stracciatella|gorgonzola|taleggio|manchego|faisselle'
  + '|yogh?ourt|latticello|natas|cajeta|khoa|labne|topfen|schmand|butterschmalz|butterfett|butter(?:milch|[öo]l|pulver)|kr[äa]uterbutter'
  + '|twar[óo][gż]' + W + '|kefir' + W + '|kesella|smetana|ka[şs]ar' + W + '|(?:natrium|calcium|kalium)case[iï]na?at' + W + ')' + R;

const EGG = L + '(?:eggs?|egg (?:white|yolk)s?|eggnog|aioli|albumen|albumin[ae]?|ovo?albumin[ae]?|l[iy]s[io]z[iy]m[ae]?|mayonnaise|meringues?|huevos?|(?:œ|oe)ufs?|uov[oa]|eier(?:nudeln|teigwaren|pulver)?|eiwei(?:ss|[sß])|ei)' + R
  // Yolk, white, mayonnaise and meringue by their own names: yema, tuorlo, albume, mayonesa, maionese,
  // Majonäse, merengue, meringa; German compounds Eigelbpulver, Eiklar, Volleipulver.
  + '|' + L + '(?:yemas?|tuorl[oi]|albume|mayonesa|maionese|mayonaise|majon[äa]se|majonez|majon[äa]s|mayonez|merengues?|meringh?[ae]|eigelb|eiklar|vollei)' + W + R
  // German compounds name the egg last: Hühnerei, Hühnereiweiß, Trockenvollei.
  + '|(?:h[üu]hner|trockenvoll|trocken|fl[üu]ssig)ei(?:wei(?:ss|[sß])|gelb|pulver)?' + R
  // sv ägg, äggula, helägg; pl jaja, jajka, żółtko (białko alone is protein, not egg white); nl eieren,
  // eigeel, kippenei; pt ovos, gema, clara de ovo
  + '|' + L + '(?:hel)?ägg(?:en|ula|gula|vita|vitepulver|pulver)?' + R
  + '|' + L + '(?:jaj(?:a|ka|ko|o|ek)?|jajeczn' + W + '|[żz][óo][łl]tk' + W + '|bia[łl]ko jaja|eieren|eigeel(?:poeder)?|eidooier(?:poeder|s)?|eiwitpoeder|eipoeder|kippenei' + W + '|ovos?|gemas? de ovo|claras? de ovo|yumurta' + W + ')' + R;

// The wheat rule spells out its grains because `malt\w*` used to be here — and maltodextrin,
// maltitol and maltose are not malt. A coeliac user saw "Wheat / gluten" on gluten-free products
// with maltodextrin in them, which is most of the processed aisle.
const GLUTEN = L + '(?:wheat|gluten|glutine|barley|rye|malt|malted|malt (?:extract|syrup|flour|vinegar|flavou?r)|semolina|durum|spelt|farro|kamut|einkorn|emmer|triticale|seitan|couscous|bulgur'
  // Wheat products that do not say wheat. "Breadfruit" is a fruit (R stops it).
  // Italian "farina" alone is soft-wheat flour by law, but "farina di riso" or "farina d'avena" is the
  // grain it names, which the rest of this list reads on its own.
  + '|graham|panko|farina(?!(?:\\s+integrale)?\\s+d(?:i\\s|[\'’]))|matzo|matzah|croutons?|bread(?:crumbs?)?|bread crumbs|shortbread'
  // Buckwheat is not wheat: "blé noir", "trigo sarraceno", "grano saraceno" and "trigo mourisco" name it.
  + '|trigo(?!\\s+(?:sarraceno|mourisco))|cebada|centeno|espelta|s[ée]mola(?!\\s+d[ei]\\s+(?:ma[íi]z|mais|milho|riso|arroz))|bl[ée](?!\\s+noir)|orge|seigle|[ée]peautre|froment|weizen' + W + '|gerste' + W + '|roggen' + W + '|dinkel' + W + '|grie(?:ss|[sß])|hartweizen' + W + '|grano(?!\\s+saraceno)|frumento|orzo|segale'
  // sv vete, råg, korn is left out (it also means any grain); pl pszenica, jęczmień, żyto, orkisz;
  // nl tarwe, gerst, rogge; pt cevada, centeio
  + '|vete(?:mj[öo]l|gluten|kli|groddar|flingor|protein|st[äa]rkelse)?|råg' + W + '|pszen' + W + '|j[ęe]czmie' + W + '|[żz]yt(?:o|ni)' + W + '|orkisz' + W + '|tarwe' + W + '|gerst' + W + '|rogge' + W + '|cevada|centeio'
  // tr buğday, arpa, çavdar, irmik (semolina), siyez and kavılca (einkorn, emmer), glüten
  + '|bu[ğg]day' + W + '|arpa|[çc]avdar' + W + '|irmik|siyez|kav[ıi]lca|gl[üu]ten)' + R
  // Wheat products that do not say wheat, in each language: breadcrumbs, bread, semolina, noodles, malt.
  + '|' + L + '(?:chapelure|pan rallado|pangrattato|paniermehl|semmelbr[öo]sel|paneermeel|str[öo]br[öo]d|bu[łl]k' + W + ' tart' + W + '|p[ãa]o ralado|galeta unu'
  + '|pain|pane|pan|(?!johann)[a-zß-ÿ]*brot|(?!johann)[a-zß-ÿ]*brood|(?!johann)[a-zß-ÿ]*br[öo]d|chleb' + W + '(?!\\s+[śs]wi[ęe]toja[ńn]sk)|p[ãa]o|ekmek'
  + '|khorasan|freekeh|engrain|gr[üu]nkern|boulgour|cusc[úu]s|semoule(?!\\s+de\\s+(?:ma[ïi]s|riz))|kasza manna|p[ęe]czak|mannagryn' + W + '|griesmeel|s[êe]mola(?!\\s+de\\s+milho)|graupen'
  + '|nudeln|noedels|makaron' + W + '|makarna|macarr[ãa]o|maccheroni|spaghetti|fideos(?!\\s+de\\s+arroz)|nouilles(?!\\s+de\\s+riz)'
  + '|malz' + W + '|mout(?:extract|meel|azijn)?|maltextrakt|malto|malta|s[łl][óo]d(?:owy|owe|owa|u)?)' + R;

const ALLERGENS = [
  { id: 'milk', label: 'Milk', m: new RegExp(DAIRY, 'i') },
  { id: 'egg', label: 'Egg', m: new RegExp(EGG, 'i') },
  { id: 'peanut', label: 'Peanut',
    m: new RegExp(L + '(?:peanuts?|groundnuts?|monkey ?nuts?|arachis|cacahu[eè]tes?|cacahuates?|man[ií]|arachides?|erdn[üu](?:ss|ß)' + W + '|arachidi'
      // sv jordnötter, pl orzeszki ziemne / arachidowe, nl pinda's / aardnoten, pt amendoim
      + '|jordn[öo]t' + W + '|orzeszk' + W + ' ziemn' + W + '|arachidow' + W + '|pinda' + W + '|aardno' + W + '|amendoi[mn]s?'
      // tr yer fıstığı; bare "fıstık" may be peanut or pistachio, so it flags both
      + '|yer f[ıi]st[ıi][ğg][ıi]|(?<!(?:antep|[şs]am)\\s)f[ıi]st[ıi]k' + W + ')' + R, 'i') },
  { id: 'treeNut', label: 'Tree nuts',
    // Nutmeg is "nuez moscada" / "noix de muscade" / "noce moscata", and coconut is "noix de coco".
    // "Contains: tree nuts" is how US labels declare them, and "nuts" how UK labels do; the generic
    // words in each language were missing, so the declaration itself went unflagged. Tiger nuts are
    // tubers.
    m: new RegExp(/\b(tree ?nuts?|(?<!tiger\s)nuts?\b|mixed nuts|frutos secos|frutos de c[áa]scara|frutta a guscio|fruits? [àa] coques?|schalenfr[üu]chte|n[üu](?:ss|ß)e\b|almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia|brazil nut|pine nut|praline|marzipan|gianduja|pesto|nougat|frangipane|almendra|anacardo|avellana|nuez(?!\s+moscada)|nueces|pistacho|amande|cajou|noisette|noix(?!\s+de\s+(?:coco|muscade))|pistache|mandel|haseln[üu](?:ss|ß)|waln[üu](?:ss|ß)|cashewkern|pistazie|mandorl|nocciol|noce(?!\s+(?:moscata|di\s+cocco))|noci|pistacchi)\w*/.source + '|' + L + '(?:n[öo]tter|n[öo]tkr[äa]m|hasseln[öo]t' + W + '|valn[öo]t' + W + '|cashewn[öo]t' + W + '|pekann[öo]t' + W + '|paran[öo]t' + W + '|mandl(?:ar|or)?' + W + '|mandelmassa|pistasch' + W + '|orzech' + W + '|migda[łl]' + W + '|nerkowc' + W + '|pistacj' + W + '|noten|hazelno' + W + '|walno' + W + '|cashewno' + W + '|pecanno' + W + '|am[êe]ndoas?|avel[ãa]s?|castanhas?(?: de caju| do par[áa])?|noz(?![- ]moscada)|nozes|pistaches?|f[ıi]nd[ıi]k' + W + '|badem' + W + '|(?<!hindistan\\s)ceviz' + W + '|kaju|antep f[ıi]st[ıi][ğg][ıi]|[şs]am f[ıi]st[ıi][ğg][ıi]|f[ıi]st[ıi]k' + W + '|kabuklu yemi[şs]' + W + '|sert kabuklu meyve' + W + '|makadamya|pikan)' + R
      // Pine nuts, compound and accented names, and the nut pastes and sweets by their local names.
      + '|' + L + '(?:pignons?(?: de pin)?|pi[ñn]ones|pinoli|pinienkern' + W + '|pijnboompit' + W + '|pinjen[öo]t' + W + '|pinh[õo]es'
      + '|(?:para|pekan|pecan|macadamia|pinien)n[üu](?:ss|ß)' + W + '|anacardi|pist[áa]cios?|macad[âa]mias?|makadamian[öo]t' + W
      + '|pralin[ée]?s?|massepain|mazap[áa]n|marsepein|marcepan' + W + '|marsipan|amaretti|gianduia|turr[óo]n' + W + '|torron' + W + ')' + R, 'i') },
  { id: 'soy', label: 'Soy',
    m: new RegExp(/\b(soy|soya|soybean|soja|soia|tofu|tempeh|edamame|miso|tamari(?!nd)|shoyu|natto|yuba|textured vegetable protein|tvp)\w*/.source + '|' + L + '(?:sojow' + W + '|sojab[öo]n' + W + '|sojabon' + W + '|soya' + W + '|soj[ęeiy]|soi)' + R, 'i') },
  { id: 'wheat', label: 'Wheat / gluten', m: new RegExp(GLUTEN, 'i') },
  { id: 'fish', label: 'Fish',
    m: new RegExp(/\b(fish|salmon|tuna|cod|halibut|tilapia|anchov\w+|sardines?|mackerel|herring|pollock|haddock|worcestershire|pescado|at[úu]n|salm[óo]n|anchoas?|bacalao|poisson|thon|saumon|morue|fisch\w*|thunfisch\w*|lachs\w*|sardellen|pesce|tonno|salmone|acciughe|merluzzo|surimi|bonito|katsuobushi|dashi|caviar|roe)\b/.source + '|' + L + '(?:fisk' + W + '|lax|tonfisk|sill|torsk|ansjovis|makrill|ryb(?:a|y|n' + W + ')|[łl]oso[śs]' + W + '|tu[ńn]czyk' + W + '|[śs]led[źz]' + W + '|dorsz' + W + '|sardynk' + W + '|makrel' + W + '|vis|zalm|tonijn|haring|kabeljauw|makreel|peixes?|atum|salm[ãa]o|bacalhau|sardinhas?|anchovas?|bal[ıi]k(?!esir)' + W + '|ton bal[ıi][ğg][ıi]|somon|hamsi|sardalya|uskumru|morina|levrek|[çc]ipura)' + R
      // Fish by species, in each language. Trout, hake, cabillaud, merluza, Hering, Kabeljau, Seelachs,
      // pstrąg and the rest were read as clear, in English too.
      + '|' + L + '(?:trout|hake|plaice|whiting|sprats?|pilchards?|eels?|carp|catfish|snapper|monkfish|kippers?|whitebait|swordfish|sea ?bass|perch|pike|grouper|mahi[- ]?mahi|turbot|bream|pangasius|pollack|coley|basa|barramundi|zander|sturgeon|lumpfish|dogfish|whitefish|rockfish|codfish|kingfish|milkfish'
      + '|maquereaux?|poissons|saumons|thons|cabillaud|merlus?|harengs?|truites?|anchois|colin|lieu noir|[ée]glefin|fl[ée]tan|dorades?|limandes?|rougets?|espadon|lottes?|brochets?|sandres?|carpes?|anguilles?|loup de mer|pangas'
      + '|sardinas?|caballas?|merluzas?|arenques?|truchas?|boquerones?|jurel|abadejo|lubinas?|pez espada|bacaladilla|anguilas?|angulas|lenguados?|pescadillas?|salmonetes?|rodaballo|besugo|panga|palometa|melva'
      + '|sgombr[oi]|aring(?:a|he)|trot[ae]|alici|nasello|branzin[oi]|spigol[ae]|orat[ae]|pesce spada|sarde|baccal[àa]|stoccafisso|platessa|merluzz[oi]|anguill[ae]|rombo|cernia|dentice|palombo'
      + '|(?:alaska-?)?seelachs' + W + '|hering' + W + '|matjes|b[üu]ckling' + W + '|forelle' + W + '|kabeljau' + W + '|sprotten|scholle' + W + '|dorsch' + W + '|rotbarsch' + W + '|zander' + W + '|hecht' + W + '|karpfen' + W + '|seehecht' + W + '|steinbutt'
      + '|cavalas?|pescadas?|trutas?|carapaus?|robalos?|pescadinhas?|linguados?|peixe-espada|enguias?|badejo|corvina'
      + '|forel' + W + '|koolvis|schol|heek|sprot' + W + '|paling|wijting|zeebaars|sardientjes|vis(?:olie|saus|gelatine|filet|sticks?|soep)' + W
      + '|str[öo]mming' + W + '|sej|kolja|r[öo]dsp[äa]tta|g[äa]dda|abborre|r[öo]ding|forell|(?:skarp)?sill' + W
      + '|pstr[ąa]g' + W + '|mintaj' + W + '|szprot' + W + '|karp(?:ia|iu|iem)?|sandacz' + W + '|fl[ąa]dr' + W + '|morszczuk' + W
      + '|alabal[ıi]k' + W + '|palamut|l[üu]fer|istavrit|mezgit|ringa)' + R, 'i') },
  { id: 'shellfish', label: 'Shellfish',
    m: new RegExp(/\b(shellfish|shrimp|prawn|crab(?!\s*-?\s*apples?)|lobster|crayfish|langoustine|clam|mussel|oyster|scallop|squid|calamari|octopus|krill|crustacean|mollusc|mollusk|camar[óo]n|camarones|gambas?|langosta|cangrejo|mejill[óo]n|almeja|calamar|crust[áa]ceo|molusco|crevettes?|crabe|homard|moules?|hu[îi]tres?|crustac[ée]s?|mollusques?|garnelen?|krabben?|hummer|muscheln?|krebstier|weichtier|gamber|granchio|aragosta|cozze|vongole|crostacei|molluschi)\w*/.source + '|' + L + '(?:r[äa]kor|r[äa]ka|krabba|musslor|skaldjur|bl[öo]tdjur|kr[äa]ftdjur|krewetk' + W + '|homar' + W + '|(?:ma[łl]ż|mał[żz])' + W + '|skorupiak' + W + '|mi[ęe]czak' + W + '|ostryg' + W + '|garnal' + W + '|kreeft|mossel' + W + '|oester' + W + '|schaaldier' + W + '|weekdier' + W + '|camar[ãa]o|camar[õo]es|caranguejo|lagosta|mexilh' + W + '|(?<!papryk[ai]\\s)ostras?(?!\\s+papryk)|crust[áa]ceos|karides' + W + '|yenge[çc]' + W + '|midye' + W + '|istakoz|kalamar|ahtapot|istiridye|deniz [üu]r[üu]nleri|kabuklu deniz' + W + '|yumu[şs]ak[çc]a' + W + ')' + R
      // Crustaceans and molluscs by species, in each language (squid, octopus and snails are molluscs).
      // Left out for their other meanings: Spanish "polvo" (powder), "choco" (chocolate), and the pasta
      // and biscuit names "lumache", "caracoles" and "canestrelli".
      + '|' + L + '(?:scampi|cockles?|whelks?|winkles?|periwinkles?|snails?|escargots?|cuttlefish|abalone|conch|sea urchins?|crawfish'
      + '|cigalas?|bogavantes?|centollas?|n[ée]coras?|percebes|berberechos|navajas|vieiras|zamburi[ñn]as|sepias?|chipirones|pulpos?|ostiones'
      + '|(?<!fruits? [àa] )coques|bulots|bigorneaux|palourdes|seiches?|encornets|poulpes?|langoustes?|[ée]crevisses|(?:coquilles? )?saint[- ]jacques'
      + '|seppi[ae]|polpo|totani|moscardini|capesante|ostriche|astice|mazzancolle'
      + '|(?:jakobs|mies|venus|herz)muschel' + W + '|kalmar' + W + '|oktopus' + W + '|languste' + W + '|(?:fluss)?krebs(?:e|fleisch|schw[äa]nze)' + W + '|austern?'
      + '|inktvis' + W + '|krab(?:y|[óo]w|a|ben|vlees|sticks?|salade)?|sint[- ]jakobsschelp' + W + '|kokkels|slakken'
      + '|lagostins?|am[êe]ijoas?|berbig[ãa]o|lulas?|santolas?|carac[óo]is'
      + '|kr[äa]ftor|bl[åa]musslor|ostron|pilgrimsmusslor|havskr[äa]ftor|sniglar'
      + '|o[śs]miornic' + W + '|przegrzebk' + W + '|m[ąa]tw' + W + '|[śs]limak' + W
      + '|salyangoz' + W + '|ahtapot' + W + '|istakoz' + W + ')' + R, 'i') },
  { id: 'sesame', label: 'Sesame',
    m: new RegExp(/\b(sesame|tahini|tahina|benne|gingelly|halva|halvah|halwa|gomasio|gomashio|za['’]?atar|s[ée]samo|s[ée]same|sesam)\w*/.source + '|' + L + '(?:sezam' + W + '|gergelim|susam' + W + '|tahin)' + R, 'i') },
  { id: 'sulfite', label: 'Sulfites',
    m: new RegExp(/\b((?:meta)?bisul(?:f|ph)ites?|metabisul(?:f|ph)ites?|sulfite|sulphite|sodium bisulfite|potassium metabisulfite|sulfur dioxide|sulphur dioxide|sulfitos?|sulfites?|sulfit|schwefeldioxid|solfiti|anidride solforosa|e[- ]?22[0-8])\w*/.source + '|' + L + '(?:svaveldioxid|sulfiter|dwutlenek siarki|siarczyn' + W + '|zwaveldioxide|sulfieten|di[óo]xido de enxofre|sulfitos|k[üu]k[üu]rt dioksit|s[üu]lfit' + W + ')' + R
      // Compounds name the salt first: Kaliummetabisulfit, Natriumdisulfit, natriumbisulfiet, bisolfito.
      + '|(?:kalium|natrium|calcium|kalcium)(?:meta)?(?:bi|di)?sulfi(?:e?t|te)' + W + '|' + L + '(?:meta)?bisolfit' + W + '|' + L + 'disulfit' + W, 'i') },
  // The EU's mandatory-declaration list has three allergens the US list does not.
  { id: 'celery', label: 'Celery',
    m: new RegExp(/\b(celery|celeriac|apio|c[ée]leri|sellerie|sedano)\w*/.source + '|' + L + '(?:selleri|seler' + W + '|selderij' + W + '|knollensellerie|stangensellerie|aipo|kereviz' + W + ')' + R, 'i') },
  { id: 'mustard', label: 'Mustard',
    m: new RegExp(/\b(mustard|dijon|mostaza|moutarde|senf|senape)\w*/.source + '|' + L + '(?:senaps' + W + '|senap|gorczyc' + W + '|musztard' + W + '|mosterd|mostarda|hardal' + W + ')' + R, 'i') },
  { id: 'lupin', label: 'Lupin',
    m: new RegExp(/\b(lupin|lupine|lupini|altramuz|altramuces|lupino)\w*/.source + '|' + L + '(?:[łl]ubin' + W + '|tremo[çc]o' + W + '|ac[ıi] bakla)' + R, 'i') },
  // "Corned beef" is beef; popcorn is corn; a Cornish hen is a chicken.
  { id: 'corn', label: 'Corn',
    m: new RegExp(/\b(corn(?!ed\b|ish\b)|popcorn|maize|masa(?!\s+(?:kakaow|madre|jajow|serow|makow|orzechow|czekoladow|mleczn|kokosow|pszenn|ziemniaczan))|hominy|dextrose|maltodextrin|cornstarch)\w*/.source
      // in each label language
      + '|' + L + '(?:ma[ïi]s(?:gries|grie(?:ss|[ßs])|zetmeel|meel|mehl|st[äa]rke|olie|[öo]l|k[öo]rner|kolben|vezel|keim[öo]l|maltodextrin[ae]?|glukose' + W + '|glucose' + W + '|siroop|sirup)?|ma[ií]z|milho|majs' + W + '|kukurydz' + W + '|m[ıi]s[ıi]r|dextros[ae]?|dekstroz[a]?|destrosio|maltodextrin[ae]?|maltodekstryn[ay]|maltodekstrin)' + R, 'i') },
  // Sweet potato is a morning glory, not a nightshade.
  { id: 'nightshade', label: 'Nightshades',
    m: new RegExp(/\b(tomato|(?<!\bsweet\s)potato|eggplant|aubergine|bell pepper|paprika|cayenne|chili|chilli|pimento|goji)\w*/.source
      // in each label language; sweet potato (patate douce, batata) is not a nightshade
      + '|' + L + '(?:tomat' + W + '|pomodor' + W + '|pomidor' + W + '|domates|pommes? de terre|patat[ae]s?(?!\\s+(?:douces?|dolci|dulces?))|kartoffel' + W
      + '|aardappel' + W + '|potatis|ziemniak' + W + '|aubergines?|berenjenas?|melanzan[ae]|poivrons?|pimientos?|peperon[ei]|paprik' + W + '|piment' + W + '|patl[ıi]can|biber)' + R, 'i') },
];

// Diet compatibility. `conflict` matching means the product is NOT compatible.
// Almond, coconut and other nut flours are keto staples; "eggplant" is not an egg.
//
// The animal lists are spelled out rather than summarised: `shellfish` as a literal word never
// appears on a label, so shrimp, duck, bacon and ham all passed as vegan. "Coconut meat" is not
// meat; microbial and vegetable rennet are vegetarian.
const MEAT = '\\b(?:beef|pork|chicken|turkey|lamb|mutton|veal|venison|bison|duck|quail|rabbit|bacon|sausage|salami|pepperoni|chorizo|prosciutto|pancetta|bresaola|gelatin(?!i[sz])e?|lard|tallow|suet|poultry)\\w*'
  + '|\\b(?:ham|goose|meats?)\\b(?<!(?:coconut|nut|crab) meats?)'
  + '|(?<!\\b(?:vegetable|veggie|vegetal|mushroom|miso|kombu|dashi)\\s)\\b(?:broth|bouillon|stock)\\b'
  // es / fr / it — the stores print their labels in these, and "manteca de cerdo" or "saindoux"
  // (lard) read as vegetarian. "Porcini" is a mushroom; "lemon rind" is peel.
  + '|' + L + '(?:cerdo|ternera|pollo|pavo|cordero|tocino|jam[óo]n|manteca de cerdo|gelatina|carne|porc|b(?:œ|oe)uf|poulet|dinde|agneau|veau|jambon|saindoux|g[ée]latine|viande|maiale|manzo|tacchino|agnello|vitello|strutto)' + R
  // de — compounds: Schweinefleisch, Rindfleisch, Putenbrust, Schweineschmalz. "Hühnerei" is an egg.
  + '|(?:schweine?|rind|rinder|kalb|lamm|puten|h[äa]hnchen|h[üu]hner(?!ei)|wild)(?:fleisch|brust|schmalz|speck|br[üu]he|fett)\\w*'
  + '|\\b(?:schwein\\w*|speck|schinken|schmalz|talg|fleisch\\w*|h[äa]hnchen\\w*)'
  // sv, pl, nl, pt. Swedish and Dutch compound like German: nötkött, fläskkött, kycklingbuljong,
  // varkensvlees, rundvlees. Bare "gris" (French grey, as in sel gris) and "rund" (German round,
  // as in Rundkornreis) are left to the compounds.
  + '|' + L + '(?:k[öo]tt' + W + '|n[öo]tk[öo]tt' + W + '|fl[äa]sk' + W + '|kyckling' + W + '|skinka|kalkon' + W + '|gelatin(?!i[sz])' + W + '|ister'
  + '|mi[ęe]s(?!z)' + W + '|wieprzow' + W + '|wo[łl]ow' + W + '|drobiow' + W + '|kurczak' + W + '|kurczaka|indyk' + W + '|szynk' + W + '|boczek|boczku|smalec|smalcu|[żz]elatyn' + W + '|wieprzowin' + W + '|wo[łl]owin' + W
  + '|vlees' + W + '|varken' + W + '|kip|kippen(?!ei)' + W + '|kalkoen' + W + '|spek|reuzel|gelatine'
  + '|porco|su[íi]n' + W + '|frango|bovin' + W + '|presunto|toucinho|banha'
  // tr — "hindi" is turkey but "hindistan cevizi" is coconut, so only the word itself
  + '|s[ıi][ğg][ıi]r' + W + '|dana|kuzu|koyun|tavuk' + W + '|hindi|hindi eti|domuz' + W + '|jelatin' + W + '|sucuk' + W + '|past[ıi]rma|k[ıi]yma|salam|sosis|et suyu|et [öo]z[üu]|[a-zçğıöşü]+ eti)' + R
  + '|(?:varkens|rund|runder|kippen|kalfs)(?:vlees|vet|bouillon)' + W + '|(?:n[öo]t|fl[äa]sk|gris|kalv|lamm)(?:k[öo]tt|fett|buljong)' + W
const SEA = '\\b(?:fish|shellfish|salmon|tuna|cod|anchov|sardine|mackerel|herring|tilapia|shrimp|prawn|lobster|crayfish|clam|mussel|oyster|scallop|squid|calamari|octopus|krill|worcestershire|isinglass|surimi|bonito|katsuobushi|dashi|caviar)\\w*|\\broe\\b|\\bcrab(?:s|meat)?\\b(?!\\s*-?\\s*apples?)';
// Collagen and pepsin come from animals; carmine from insects.
const FOREIGN_SEA = ALLERGENS.filter(a => a.id === 'fish' || a.id === 'shellfish').map(a => a.m.source).join('|');
const NOT_VEGETARIAN = MEAT + '|' + SEA + '|' + FOREIGN_SEA + '|(?<!\\b(?:microbial|vegetable|vegetarian|non-animal)\\s)\\brennet\\b|\\b(?:carmine|cochineal|collagen|pepsin|e[- ]?120|e[- ]?441|e[- ]?904)\\b'
  // The same in each label language: carmine, rennet (not the microbial or vegetable kind), animal fat,
  // tallow, collagen, compound gelatine, bone broth, and sausages and cured meats by name. Dutch "gehakt"
  // is also "chopped", and "worst" is English, so only the compounds ("rookworst") count.
  + '|' + L + '(?:carmin[ea]?|cochenille|karmin|karmijn|koszenil' + W + '|carminio|cochinilla|cochonilha|ko[şs]ineal|acide carminique|kwas karminowy|carminic acid'
  + '|(?:[a-zß-ÿ]+)?gelat(?:ine?|yn[aey])'
  + '|tierfett' + W + '|tierische[sn]? fett' + W + '|graisses? animales?|grasas? animal(?:es)?|grass[io] animal[ei]|dierlijke? vet(?:ten)?|animaliskt fett|t[łl]uszcz' + W + ' zwierz[ęe]c' + W + '|hayvansal ya[ğg]' + W + '|gorduras? anima(?:l|is)'
  + '|suif|[a-zß-ÿ]*talg|sebo|sego|[łl][óo]j|don ya[ğg][ıi]|kollagen|col[áa]geno|collag[èe]ne|kolagen|collageen|kolajen|e[- ]?542'
  + '|knochenbr[üu]he|caldo de huesos|brodo di ossa|ros[óo][łl]|foie gras|salchich[óo]n|[a-zß-ÿ]*wurst(?:e|en|chen|scheiben|br[äa]t)?|mortadella|cecina|panceta|guanciale|ossobuco|kavurma'
  + '|kie[łl]bas' + W + '|kabanos' + W + '|par[óo]wk' + W + '|mielonk' + W + '|[a-z]+worst|[a-zåäö]*korv'
  + '|(?<!(?:micro|mikro|v[ée]g[ée]tal|vegetabil|bitkisel)[a-zß-ÿ]*\\s)(?:pr[ée]sure|caglio|cuajo|stremsel|l[öo]pe|podpuszczk' + W + '|peynir mayas[ıi]|coalho|lab)(?!\\s+\\(?(?:micro|mikro|v[ée]g[ée]tal|bitkisel))'
  + ')' + R;
// Confectioner's glaze is shellac. L-cysteine (E920) is usually made from feathers or hair: borderline,
// so flagged, as this module flags borderline. Vitamin D3 is not: vegan products print "vitamin D3
// (from lichen)", and the parenthesis is split off before this runs, so it would flag exactly those.
const NOT_VEGAN = NOT_VEGETARIAN + '|' + DAIRY + '|' + EGG + '|\\b(?:honey|royal jelly|beeswax|shellac|lanolin|confectioner[\'’]?s glaze|l-cysteine|e[- ]?901|e[- ]?913|e[- ]?920)\\b'
  // Honey in each label language: miel, Honig, miele, honung, miód, honing, mel.
  + '|' + L + '(?:miel|honig|miele|honung|mi[óo]d|miodu|honing|mel|bal)' + R;
const DIETS = [
  { id: 'vegan', label: 'Vegan', conflict: new RegExp(NOT_VEGAN, 'i') },
  { id: 'vegetarian', label: 'Vegetarian', conflict: new RegExp(NOT_VEGETARIAN, 'i') },
  { id: 'glutenFree', label: 'Gluten-free', conflict: new RegExp(GLUTEN, 'i') },
  { id: 'dairyFree', label: 'Dairy-free', conflict: new RegExp(DAIRY, 'i') },
  // Oils carry no carbohydrate whatever grain they were pressed from.
  { id: 'keto', label: 'Keto-friendly',
    conflict: new RegExp(/\b(sugar|(?<!\b(?:almond|coconut|flax|flaxseed|hazelnut|walnut|pecan|sunflower|lupin|psyllium|sesame|peanut)\s)flour|(?<!\bcauliflower\s)rice(?!\s+bran\s+oil)|potato|corn syrup|maltodextrin|dextrose|honey|molasses|oats|wheat)\w*/.source
      // The same in each label language: sugars and syrups, flours (not nut or coconut flour), rice,
      // potato, honey, oats and the gluten grains. Before this only English lists could conflict.
      + '|' + L + '(?:sucre|az[uú]car|a[çc][úu]car|zucchero|zucker' + W + '|suiker|socker|cukier|[şs]eker|glu[ck]os' + W + '|glikoz|dextros[ae]?|dekstroz|fru[ck]tos' + W
      + '|sirop|jarabe|sciroppo|sirup|stroop|sirap|syrop|[şs]urub[u]?|xarope|maltodextrin[ae]?|maltodekstryn[ay]|m[ée]lasse|melaza|melassa'
      + '|farine(?!\\s+d[e\'’]\\s*(?:amandes?|coco|noisettes?))|harina(?!\\s+de\\s+(?:almendras?|coco))|farina(?!\\s+di\\s+(?:mandorle|cocco|nocciole))|farinha(?!\\s+de\\s+(?:am[êe]ndoa|coco))'
      + '|m[ąa]ka(?!\\s+(?:migda|kokos))|riz|arroz|riso|reis|rijst|ris|ry[żz]|pirin[çc]|pommes? de terre|patat[ae]s?|kartoffel' + W + '|aardappel' + W + '|potatis|ziemniak' + W + '|batatas?'
      + '|miel|honig|miele|honing|honung|mi[óo]d|miodu|bal|mel|avoine|avena|hafer' + W + '|haver' + W + '|havre' + W + '|owies|owsian' + W + '|yulaf|aveia)' + R
      + '|(?<!mandel|kokos|lein|nuss|erdnuss)mehl|\\w(?:siroop|sirup|stroop|sirap)|(?<!amandel|kokos|noten)(?:bloem|meel)\\b|(?<!mandel|kokos)mj[öo]l(?!k)|\\bunu\\b(?<!badem unu)|' + GLUTEN, 'i') },
  { id: 'porkFree', label: 'Pork-free',
    conflict: /\b(pork|bacon|lard|gelatin|prosciutto|pancetta|chorizo|schweine\w*|cerdo|porc(?!ini|j)|maiale|jam[óo]n|jambon|speck|schinken|fl[äa]sk|griskött|skinka|wieprzow|smalec|boczek|szynk|varken|reuzel|porco|toucinho|banha|presunto|domuz|jelatin)\w*|\bham\b|(?<![a-zß-ÿœ\u0100-\u017f])(?:[żz]elatyn|spek\b)/i },
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
