// Provenance bonuses and whole-food recognition.
//
// Two separate jobs:
//   BONUSES    — sourcing claims that lift a score, capped in aggregate so a label can lift a good
//                product but never launder a bad one.
//   WHOLE      — single-ingredient real foods, used by the NOVA classifier to recognise NOVA 1.

if (typeof require !== 'undefined' && typeof module !== 'undefined') require('./_module.js');

// Manifest-declared content scripts share one top-level scope, so every const here
// must stay inside this closure or it collides with the other rule files at load time.
(function () {

  const BONUSES = [
    { pts: 12, cat: 'animalWelfare', why: '100% grass-fed / grass-finished', m: /\bgrass[- ]?(fed|finished)\b/i },
    { pts: 10, cat: 'animalWelfare', why: 'Pasture-raised',              m: /\bpasture[- ]?(raised|fed)\b/i },
    { pts: 10, cat: 'animalWelfare', why: 'Wild-caught',                 m: /\bwild[- ]?(caught|harvested)\b/i },
    { pts:  8, cat: 'organic', why: 'Certified organic',                 m: /\b(certified )?organic\b/i },
    { pts:  8, cat: 'dairyProcessing', why: 'Raw / unpasteurised dairy', m: /\braw (milk|cream|cheese|dairy|butter)\b|\bunpasteurized\b/i },
    { pts:  7, cat: 'animalWelfare', why: 'Regeneratively farmed',       m: /\bregenerativ(e|ely)\b/i },
    { pts:  6, cat: 'fermented', why: 'Fermented / live cultures',       m: /\b(cultured|fermented|live active cultures|probiotic|kefir|kimchi|sauerkraut)\b/i },
    { pts:  6, cat: 'unrefined', why: 'Minimally refined cooking fat', m: /(?<!peanut |almond |cashew |sunflower |seed |nut |cocoa |shea |apple |soy )\b(butter|ghee|tallow|lard|suet|duck fat|coconut oil|olive oil|avocado oil)\b/i },
    { pts:  5, cat: 'dairyProcessing', why: 'A2 dairy',                  m: /\ba2\b/i },
    { pts:  5, cat: 'traditionalPrep', why: 'Sourdough / sprouted grain', m: /\b(sourdough|sprouted|naturally leavened|einkorn|soaked)\b/i },
    { pts:  5, cat: 'nonGmo', why: 'Non-GMO verified',                   m: /\bnon[- ]?gmo\b/i },
    { pts:  5, cat: 'unrefined', why: 'Unrefined salt',                  m: /\b(sea salt|redmond|celtic|real salt|himalayan salt)\b/i },
    { pts:  4, cat: 'animalWelfare', why: 'Heritage / heirloom breed',   m: /\b(heritage|heirloom|berkshire|wagyu)\b/i },
    { pts:  4, cat: 'traditionalPrep', why: 'Dry-aged / traditionally cured', m: /\bdry[- ]?(aged|cured)\b/i },
    { pts:  3, cat: 'unrefined', why: 'Cold-pressed / unrefined',        m: /\b(cold[- ]pressed|expeller[- ]pressed|unrefined|first press)\b/i },
  ];

  const BONUS_CAP = 15;        // total ceiling on all bonuses
  const TITLE_BONUS_CAP = 8;   // ceiling on claims found only in the marketing title

  // Whole, single-ingredient foods. Used for NOVA 1 detection, never penalised.
  const WHOLE = [
    /^[\w' -]{0,28}\b(beef|bison|lamb|mutton|goat|venison|elk|pork|chicken|turkey|duck)\b/i,
    /^[\w' -]{0,24}\b(salmon|tuna|sardines?|anchov(y|ies)|mackerel|cod|halibut|trout|herring|shrimp|oysters?|mussels?)\b/i,
    /^(organic |pasture[- ]?raised )*(eggs?|egg yolks?|egg whites?)$/i,
    /^[\w' -]{0,24}\b(milk|cream|butter|ghee|yogh?urt|kefir|cheese|cheddar|mozzarella|parmesan)\b/i,
    /^(beef |chicken |pork )?(liver|heart|kidney|bone marrow|tripe|sweetbreads)\b/i,
    /^(organic )?(water|sea salt|salt)$/i,
    /^(organic |raw )*(honey|maple syrup)$/i,
    /^(organic )?(almonds?|walnuts?|pecans?|macadamias?|pistachios?|cashews?|hazelnuts?)$/i,
    /^(organic )?(apples?|bananas?|berries|blueberries|strawberries|oranges?|dates?|figs?|raisins?)$/i,
    /^(organic )?(spinach|kale|broccoli|carrots?|onions?|garlic|tomatoes?|potatoes?|sweet potatoes?)$/i,
    /^(organic )?(rice|quinoa|oats|buckwheat)$/i,
    /^(black |white |cayenne )?pepper$/i,
    /^(cinnamon|turmeric|ginger|paprika|cumin|coriander|oregano|basil|thyme|rosemary|garlic powder|onion powder)$/i,
  ];

  // Culinary ingredients — NOVA 2. Real foods, but extracted/concentrated.
  const CULINARY = /^(extra virgin |virgin |cold[- ]pressed |organic |raw )*(olive oil|avocado oil|coconut oil|butter|ghee|tallow|lard|honey|maple syrup|sea salt|salt|vinegar|apple cider vinegar|cream|sugar)$/i;

  // Signals of NOVA 3 processing — real food, meaningfully transformed.
  const PROCESSED_SIGNAL = /\b(cultured|fermented|smoked|cured|canned|pasteurized|celery (juice )?powder|cheese cultures|rennet|yeast|sourdough|brined|pickled|roasted|dried)\b/i;

  // Dairy processing penalties. Weighted by the 'dairyProcessing' category.
  const DAIRY_PENALTY = [
    { pts: 8, why: 'Ultra-pasteurized dairy', m: /\bultra[- ]?(pasteurized|filtered|high temperature)\b|\buht\b/i },
    { pts: 5, why: 'Homogenized dairy',       m: /\bhomogenized\b/i },
    { pts: 6, why: 'Fat-reduced dairy', m: /\b(non[- ]?fat|fat[- ]?free|skim|low[- ]?fat|reduced fat|1%|2%) (milk|dairy|yogurt|cheese)\b/i },
  ];

  const _exports = AIRmodule('labels', {
    BONUSES, BONUS_CAP, TITLE_BONUS_CAP, WHOLE, CULINARY, PROCESSED_SIGNAL, DAIRY_PENALTY,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
