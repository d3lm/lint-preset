import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eslintConfig } from '../../eslint.js';
import { createOxlintConfig } from '../../oxlint.js';
import {
  collectEslintEffectiveRules,
  collectOxlintEffectiveRules,
  combineRulesets,
  type EffectiveRuleset,
} from './helpers/effective-ruleset.js';

/**
 * Pins the combined effective ruleset (Oxlint-enabled rules + rules left
 * active in the resolved ESLint config) against a committed baseline that
 * was captured before rules were migrated from ESLint to Oxlint.
 *
 * Moving a rule between engines must not change this combined map, so the
 * test proves the migration kept behavior identical: same rules, same
 * severities, same options — just served by a different engine.
 *
 * Regenerate the baseline (only when intentionally changing the rule set):
 *
 * ```bash
 * UPDATE_RULESET_BASELINE=1 pnpm vitest run src/configs/__tests__/effective-ruleset.test.ts
 * ```
 */

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../../..');
const baselinePath = path.join(testDirectory, 'fixtures', 'effective-ruleset.json');

interface Baseline {
  oxlintDefaults: {
    plugins: unknown;
    categories: unknown;
    options: unknown;
  };
  ts: EffectiveRuleset;
  js: EffectiveRuleset;
}

async function computeCurrentState(): Promise<Baseline & { duplicates: Record<string, string[]> }> {
  const oxlintConfig = createOxlintConfig();
  const eslintConfigs = eslintConfig({ oxlintConfig: createOxlintConfig(), tsconfigRootDir: repoRoot });

  const duplicates: Record<string, string[]> = {};
  const combined: Record<string, EffectiveRuleset> = {};

  for (const probeFile of ['probe.ts', 'probe.js']) {
    const oxlintRules = collectOxlintEffectiveRules(oxlintConfig, probeFile);
    const eslintRules = await collectEslintEffectiveRules(eslintConfigs, probeFile, repoRoot);
    const result = combineRulesets(oxlintRules, eslintRules);
    const kind = path.extname(probeFile).slice(1);

    combined[kind] = result.rules;
    duplicates[kind] = result.duplicates;
  }

  return {
    oxlintDefaults: {
      plugins: oxlintConfig.plugins ?? null,
      categories: oxlintConfig.categories ?? null,
      options: oxlintConfig.options ?? null,
    },
    ts: combined.ts,
    js: combined.js,
    duplicates,
  };
}

describe('combined effective ruleset', () => {
  it('never enables the same rule in both engines', async () => {
    const { duplicates } = await computeCurrentState();

    expect(duplicates.ts).toEqual([]);
    expect(duplicates.js).toEqual([]);
  });

  it('matches the pre-migration baseline', async () => {
    const { duplicates: _duplicates, ...current } = await computeCurrentState();

    if (process.env.UPDATE_RULESET_BASELINE) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);

      return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Baseline;

    expect(current.oxlintDefaults).toEqual(baseline.oxlintDefaults);
    expect(current.ts).toEqual(baseline.ts);
    expect(current.js).toEqual(baseline.js);
  });
});
