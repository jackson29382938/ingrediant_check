// Reproducible processing-weight ablation on the checked-in corpus, never clinical validation.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../src/engine/score.js');
const corpus = require('../tests/corpus.json');
const revision = require('../src/engine/db/revision.js');
const lines = ['# Scoring sensitivity', '',
  `Generated from revision \`${revision.RULES_REVISION}\` with \`node scripts/scoring-sensitivity.mjs\`.`, '',
  'This compares the current default model with processing weight zero, keeping every other preference unchanged. Ingredient deductions still apply. It measures model sensitivity, not health outcomes, and is not independent calibration.', '',
  '| Label | Default | Processing off | Difference | Readable |', '| --- | --- | --- | --- | --- |'];
for (const entry of corpus.products) {
  const base = engine.score(entry.product), off = engine.score(entry.product, { weights: { processing: 0 } });
  lines.push(`| ${entry.id.replace(/\|/g, '\\|')} | ${base.score} | ${off.score} | ${off.score - base.score} | ${base.readable ? 'yes' : 'no'} |`);
}
lines.push('', 'Processing and ingredient deductions can describe the same additive. Their effects are shown separately in the panel; hard ceilings can mask either effect. No automatic recalibration is inferred from these differences.', '',
  'Independent evaluation still requires packaging-verified labels and reviewer judgments held out from rule development. Public database captures and translated twins retain their separate evidence types in [ACCURACY.md](ACCURACY.md).', '');
fs.writeFileSync(new URL('../docs/SCORING-SENSITIVITY.md', import.meta.url), lines.join('\n'));
console.log(`Wrote sensitivity comparisons for ${corpus.products.length} labels.`);
