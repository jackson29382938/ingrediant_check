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
  ];

  // TRADITIONAL — small penalty. Real food, but concentrated.
  const TRADITIONAL = [
    { m: /^(organic |raw |unfiltered |wildflower |manuka |clover )*honey$/i, pts: 3,  why: 'Honey — concentrated sweetener, light touch' },
    { m: /^(pure |organic )?maple (syrup|sugar)$/i,         pts: 4,  why: 'Maple syrup — concentrated sweetener' },
    { m: /^(blackstrap )?molasses$/i,                       pts: 4,  why: 'Molasses' },
    { m: /^coconut (sugar|nectar|sap)$/i,                   pts: 5,  why: 'Coconut sugar' },
    { m: /^date (sugar|syrup)$/i,                           pts: 4,  why: 'Date sugar' },
    { m: /^sorghum( syrup)?$/i,                             pts: 5,  why: 'Sorghum syrup' },
    { m: /^(fruit juice concentrate|apple juice concentrate|grape juice concentrate)$/i, pts: 8, why: 'Fruit juice concentrate — sugar stripped of its fruit' },
  ];

  // REFINED — full penalty. Position-weighted by the caller.
  const REFINED = [
    { m: /^(organic )?(cane |raw |turbinado |demerara |muscovado )?sugar$/i, pts: 14, why: 'Refined added sugar' },
    { m: /^(evaporated )?cane (juice|sugar|syrup)$/i,   pts: 14, why: 'Cane sugar' },
    { m: /^brown sugar$/i,                              pts: 14, why: 'Brown sugar' },
    { m: /^beet sugar$/i,                               pts: 14, why: 'Beet sugar' },
    { m: /^powdered sugar$/i,                           pts: 14, why: 'Powdered sugar' },
    { m: /^invert sugar( syrup)?$/i,                    pts: 15, why: 'Invert sugar' },
    { m: /^dextrose$/i,                                 pts: 14, why: 'Dextrose' },
    { m: /^glucose( syrup| solids)?$/i,                 pts: 14, why: 'Glucose syrup' },
    { m: /^fructose$/i,                                 pts: 16, why: 'Isolated fructose' },
    { m: /^sucrose$/i,                                  pts: 14, why: 'Sucrose' },
    { m: /^maltose$/i,                                  pts: 14, why: 'Maltose' },
    { m: /^agave( nectar| syrup)?$/i,                   pts: 16, why: 'Agave — among the highest-fructose sweeteners' },
    { m: /^(brown )?rice syrup$/i,                      pts: 14, why: 'Rice syrup' },
    { m: /^tapioca syrup$/i,                            pts: 13, why: 'Tapioca syrup' },
    { m: /^barley malt( syrup| extract)?$/i,            pts: 12, why: 'Barley malt syrup' },
    { m: /^caramel$/i,                                  pts: 10, why: 'Caramel' },
    { m: /^honey (powder|solids)$/i,                    pts: 10, why: 'Honey powder — processed, not raw' },
  ];

  // INDUSTRIAL — hard cap territory.
  const INDUSTRIAL = [
    { m: /\bhigh[- ]fructose corn syrup\b|\bhfcs\b/i, cap: 30, why: 'High-fructose corn syrup' },
    // Do not fire a second generic cap inside "high-fructose corn syrup".
    { m: /(?<!fructose )\bcorn syrup( solids)?\b/i,   cap: 30, why: 'Corn syrup' },
    { m: /\bglucose[- ]fructose( syrup)?\b/i,         cap: 30, why: 'Glucose-fructose syrup' },
  ];

  // ARTIFICIAL — treated as more concerning than sugar by default; adjustable in settings.
  const ARTIFICIAL = [
    { m: /\bsucralose\b|\bsplenda\b/i,          cap: 22, why: 'Sucralose' },
    { m: /\baspartame\b|\bnutrasweet\b/i,       cap: 22, why: 'Aspartame' },
    { m: /\bacesulfame([- ]?k| potassium)?\b|\bace[- ]k\b/i, cap: 22, why: 'Acesulfame potassium' },
    { m: /\bsaccharin\b/i,                      cap: 22, why: 'Saccharin' },
    { m: /\bneotame\b/i,                        cap: 22, why: 'Neotame' },
    { m: /\badvantame\b/i,                      cap: 22, why: 'Advantame' },
    { m: /\bcyclamate\b/i,                      cap: 22, why: 'Cyclamate' },
  ];

  // SUGAR ALCOHOLS & NOVEL — penalised, not capped.
  const ALCOHOLS = [
    { m: /^erythritol$/i,             pts: 12, why: 'Erythritol' },
    { m: /^xylitol$/i,                pts: 10, why: 'Xylitol' },
    { m: /^maltitol( syrup)?$/i,      pts: 12, why: 'Maltitol' },
    { m: /^sorbitol$/i,               pts: 11, why: 'Sorbitol' },
    { m: /^mannitol$/i,               pts: 11, why: 'Mannitol' },
    { m: /^isomalt$/i,                pts: 11, why: 'Isomalt' },
    { m: /^lactitol$/i,               pts: 11, why: 'Lactitol' },
    { m: /^allulose$/i,               pts: 8,  why: 'Allulose' },
    { m: /^(steviol glycosides?|stevia( leaf extract)?|reb[- ]?[am])$/i, pts: 8, why: 'Stevia extract — refined, not the leaf' },
    { m: /^monk fruit( extract| juice concentrate)?$/i, pts: 6, why: 'Monk fruit extract' },
    { m: /^(soluble )?(corn|tapioca|chicory) (fiber|root fiber)$/i, pts: 9, why: 'Isolated fiber syrup' },
    { m: /^inulin$/i,                 pts: 6,  why: 'Isolated inulin' },
    { m: /^polydextrose$/i,           pts: 12, why: 'Polydextrose' },
  ];

  const _exports = AIRmodule('sugars', { FREE, TRADITIONAL, REFINED, INDUSTRIAL, ARTIFICIAL, ALCOHOLS });
  if (typeof module !== 'undefined' && module.exports) module.exports = _exports;

})();
