// Language evidence and the coverage gate. Run: node --test tests/languages.test.js
//
// Two jobs. First, keep the corpus honest about what it is: every entry says which language it is
// in and whether it was captured live, modelled on a real product, or written to exercise a rule
// (tests/corpus.json `_comment`). docs/ACCURACY.md reports the same table; it must not claim more
// than this file can see.
//
// Second, pin the behaviour on storefronts whose language has no synonym pack (amazon.co.jp). The
// rulebase cannot read those lists, and the coverage gate in src/content/page.js is the only thing
// standing between them and a confident wrong number. Swedish, Polish and Turkish had no pack either
// until 2026-09-26; their twins now score exactly like English (tests/synonyms.test.js). The
// twins below are SYNTHETIC translations of English lists, not captured labels: they prove the gate
// declines, or the words map, not that real labels score well.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../src/engine/db/_module.js');
const engine = require('../src/engine/score.js');
const corpus = require('./corpus.json');

const EVIDENCE = new Set(['live-capture', 'representative', 'synthetic']);
const entries = [...corpus.products, ...corpus.defects];

// The gate every pipeline applies: one definition in the engine, shared by the content scripts.
const GATE = engine.MIN_COVERAGE;
const declined = r => r.parsed > 0 && r.coverage < GATE;

test('every corpus entry declares its language and evidence', () => {
  for (const e of entries) {
    assert.match(String(e.lang), /^(?:[a-z]{2,3}|und)$/, `${e.id}: lang ${JSON.stringify(e.lang)}`);
    assert.ok(EVIDENCE.has(e.evidence), `${e.id}: evidence ${JSON.stringify(e.evidence)}`);
    if (e.evidence === 'live-capture') {
      // A capture that cannot be traced back to a store and an extractor is not evidence.
      assert.match(String(e.store), /^(?:amazon\.[a-z.]+|target\.com)$/, `${e.id}: live-capture needs a store`);
      assert.ok(typeof e.via === 'string' && e.via, `${e.id}: live-capture needs the extractor (via)`);
      assert.match(String(e.captured), /^\d{4}-\d{2}-\d{2}$/, `${e.id}: live-capture needs a date`);
    }
  }
});

test('the documented evidence table matches the corpus', () => {
  // docs/ACCURACY.md states which languages rest on synthetic evidence only. If a live capture is
  // added, this fails until the doc is updated to say so — and not before.
  const counts = new Map();
  for (const e of entries) {
    const k = `${e.lang}:${e.evidence}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ACCURACY.md'), 'utf8');
  for (const [k, n] of counts) {
    const [lang, evidence] = k.split(':');
    const row = new RegExp(`\\|\\s*\`${lang}\`\\s*\\|\\s*${evidence}\\s*\\|\\s*${n}\\s*\\|`);
    assert.match(doc, row, `docs/ACCURACY.md is missing the row | \`${lang}\` | ${evidence} | ${n} |`);
  }
  const nonEnglishLive = entries.filter(e => e.lang !== 'en' && e.lang !== 'und' && e.evidence !== 'synthetic');
  assert.equal(nonEnglishLive.length, 0,
    'a non-English entry now has real evidence: update docs/ACCURACY.md and this assertion together');
});

test('the coverage gate stays where the corpus was calibrated', () => {
  // Lowering the gate makes more products score, and the twins below show what it would score
  // them as. Change it only with evidence from real labels, and update this number on purpose.
  assert.equal(GATE, 0.34);
  // No caller keeps its own copy of the number: the engine owns it, and a content script that
  // redeclares it would drift from the gate the corpus was calibrated against.
  const root = path.join(__dirname, '..', 'src');
  for (const file of ['content/page.js', 'content/retailer.js', 'content/cart.js', 'content/orders.js', 'engine/db/purchase-analytics.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(src, /\b0\.34\b|const MIN_COVERAGE\b/, `${file} carries its own coverage gate; use engine.isReadable`);
  }
  const corpusSrc = fs.readFileSync(path.join(__dirname, 'corpus.test.js'), 'utf8');
  assert.match(corpusSrc, /engine\.MIN_COVERAGE/, 'tests/corpus.test.js must read the engine gate');
});

// English list first, then synthetic translations into storefront languages.
const TWINS = {
  chips: {
    en: 'Potatoes, sunflower oil, salt, flavour enhancer (E621), dextrose',
    sv: 'Potatis, solrosolja, salt, smakförstärkare (E621), dextros',
    pl: 'Ziemniaki, olej słonecznikowy, sól, wzmacniacz smaku (E621), dekstroza',
    tr: 'Patates, ayçiçek yağı, tuz, lezzet arttırıcı (E621), dekstroz',
  },
  bread: {
    en: 'Wheat flour, water, yeast, salt, sugar, soybean oil, calcium propionate',
    sv: 'Vetemjöl, vatten, jäst, salt, socker, sojaolja, kalciumpropionat',
    pl: 'Mąka pszenna, woda, drożdże, sól, cukier, olej sojowy, propionian wapnia',
    tr: 'Buğday unu, su, maya, tuz, şeker, soya yağı, kalsiyum propiyonat',
  },
  chocolate: {
    en: 'Sugar, cocoa butter, whole milk powder, emulsifier (soy lecithin), flavouring',
    sv: 'Socker, kakaosmör, helmjölkspulver, emulgeringsmedel (sojalecitin), arom',
    pl: 'Cukier, masło kakaowe, mleko pełne w proszku, emulgator (lecytyny sojowe), aromat',
    tr: 'Şeker, kakao yağı, tam yağlı süt tozu, emülgatör (soya lesitini), aroma',
  },
  candy: {
    en: 'Sugar, glucose syrup, water, modified starch (E1422), acid (E330), colour (E129), flavouring',
    sv: 'Socker, glukossirap, vatten, modifierad stärkelse (E1422), surhetsreglerande medel (E330), färgämne (E129), arom',
    pl: 'Cukier, syrop glukozowy, woda, skrobia modyfikowana (E1422), regulator kwasowości (E330), barwnik (E129), aromat',
    tr: 'Şeker, glikoz şurubu, su, modifiye nişasta (E1422), asitlik düzenleyici (E330), renklendirici (E129), aroma',
    ja: '砂糖、水あめ、水、加工でん粉、酸味料、着色料(赤40)、香料',
  },
  muesli: {
    en: 'Rolled oats, raisins, hazelnuts, sunflower seeds, apple',
    sv: 'Havregryn, russin, hasselnötter, solrosfrön, äpple',
    pl: 'Płatki owsiane, rodzynki, orzechy laskowe, nasiona słonecznika, jabłko',
  },
};
const score = text => engine.score({ ingredients_text: text }, {});

test('a list in an unsupported language is declined, or scored like its English twin', () => {
  for (const [name, byLang] of Object.entries(TWINS)) {
    const en = score(byLang.en);
    assert.ok(!declined(en), `${name}/en must be readable (coverage ${en.coverage})`);
    for (const [lang, text] of Object.entries(byLang)) {
      if (lang === 'en') continue;
      const r = score(text);
      if (declined(r)) continue;
      // Scored: then it must be the same answer. E-numbers are language-neutral, which is how a
      // Swedish sweet list with three codes clears the gate — and it caps exactly as English does.
      assert.ok(Math.abs(r.score - en.score) <= 15,
        `${name}/${lang} scored ${r.score} at ${Math.round(r.coverage * 100)}% coverage; English twin ${en.score}`);
      assert.equal(r.cap, en.cap, `${name}/${lang} cap`);
    }
  }
});

test('Swedish, Polish and Turkish twins are read and score exactly like English', () => {
  // The Swedish chips were the measured near miss: "solrosolja" matched no oil rule, the list read as
  // 33% recognised, one point under the gate, and it would have scored 46 against the capped 25 of
  // its English twin. With the Swedish and Polish words mapped, every twin clears the gate and gets
  // the English score and cap.
  for (const [name, byLang] of Object.entries(TWINS)) {
    const en = score(byLang.en);
    for (const lang of ['sv', 'pl', 'tr']) {
      if (!byLang[lang]) continue;
      const r = score(byLang[lang]);
      assert.ok(!declined(r), `${name}/${lang} declined at ${r.coverage}`);
      assert.equal(r.score, en.score, `${name}/${lang}`);
      assert.equal(r.cap, en.cap, `${name}/${lang} cap`);
    }
  }
});

test('clean lists in unsupported languages are declined rather than called clean', () => {
  // Nothing on a Japanese list matches a rule, so unrecognised text would otherwise read as a clean
  // list. Declining is the honest answer until a language pack exists.
  assert.ok(declined(score(TWINS.candy.ja)), 'a Japanese list must be declined');
  assert.ok(declined(score('じゃがいも、植物油、食塩')), 'a Japanese list with no code must be declined');
});

test('everyday words from real labels are read in every store language, and notes are not ingredients', () => {
  // Scoring about 650 real Open Food Facts labels (2026-09-26) found real lists declined for words
  // like água, zout, sól, Kohlensäure and "poudres à lever". These lists use those words; each must
  // clear the gate. Label notes (organic footnotes, "sans gluten", "packaged in a protective
  // atmosphere") are set aside rather than read as unrecognised ingredients.
  const lists = {
    pt: 'Água, leite, açúcar, cacau magro em pó, levedantes (hidrogenocarbonato de sódio), sal marinho',
    nl: 'Tarwebloem, suiker, cacaomassa, cacaoboter, melk, zout, rijsmiddel (natriumcarbonaten), vanille',
    pl: 'Mąka pszenna, cukier, sól, dwutlenek węgla, tłuszcz palmowy, ekstrakt z wanilii',
    fr: 'Farine de blé, sucre, noisettes, poudres à lever (carbonates de sodium), ail, basilic, *ingrédients issus de l’agriculture biologique',
    de: 'Wasser, Kohlensäure, Zucker, Zitronensäure, Knoblauch, Basilikum, Speisesalz',
    es: 'Copos de avena, almendras, avellanas, gasificantes (bicarbonato sódico), sal marina, sin gluten',
    it: 'Farina di frumento, cipolla, basilico, anidride carbonica, pomodoro, sale marino',
    sv: 'Tomatpuré, lök, vitlök, havssalt, ättika, kryddextrakt',
    tr: 'Buğday unu, şeker, palm yağı, deniz tuzu, sodyum hidrojen karbonat, karbondioksit',
    en: 'Wheat flour, sugar, palm oil, raising agents (sodium hydrogen carbonate), carbon dioxide, packaged in a protective atmosphere',
  };
  for (const [lang, text] of Object.entries(lists)) {
    const r = score(text);
    assert.ok(!declined(r), `${lang} declined at ${Math.round(r.coverage * 100)}%: ${text}`);
  }
  assert.equal(score('Oats, sans gluten').parsed, 1, 'a note is not an entry');
  assert.equal(score('Oats, packaged in a protective atmosphere').parsed, 1);
  // Bare words that would open the gate for non-food lists stay unread: "sodium" alone matched
  // "sodium laureth sulfate".
  assert.ok(declined(score('Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Glycerin, Parfum, Sodium Chloride, Citric Acid')));
});
