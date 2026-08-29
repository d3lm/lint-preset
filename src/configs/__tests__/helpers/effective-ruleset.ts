import { ESLint, type Linter } from 'eslint';
import type { OxlintConfig } from 'oxlint';

/**
 * Utilities to compute the *combined* effective ruleset of the dual-lint
 * setup: every rule enabled in the Oxlint config plus every rule left active
 * in the resolved ESLint config, keyed by the canonical ESLint rule name.
 *
 * Moving a rule between engines must not change this combined map — that is
 * the invariant the effective-ruleset test pins against a committed baseline.
 *
 * Note: rules enabled implicitly through Oxlint's default categories/plugins
 * are not part of the map. The baseline therefore also records the config's
 * `plugins`, `categories`, and `options` so changes to those defaults fail
 * the test too.
 */

export type NormalizedRuleConfig = [severity: 'error' | 'warn', ...options: unknown[]];

export type EffectiveRuleset = Record<string, NormalizedRuleConfig>;

/**
 * Oxlint namespaces that alias an ESLint plugin. `eslint/` maps to the
 * un-prefixed core namespace. `unicornx`/`jsdocx` are the JS-plugin aliases
 * wired through Oxlint's `jsPlugins` (see `src/oxlint.ts`).
 */
const OXLINT_PREFIX_TO_ESLINT: Record<string, string | null> = {
  typescript: '@typescript-eslint',
  unicornx: 'unicorn',
  jsdocx: 'jsdoc',
  eslint: null,
};

export function normalizeRuleName(rule: string): string {
  const slashIndex = rule.indexOf('/');

  if (slashIndex === -1) {
    return rule;
  }

  const prefix = rule.slice(0, slashIndex);

  if (!(prefix in OXLINT_PREFIX_TO_ESLINT)) {
    return rule;
  }

  const mapped = OXLINT_PREFIX_TO_ESLINT[prefix];
  const bareName = rule.slice(slashIndex + 1);

  return mapped === null ? bareName : `${mapped}/${bareName}`;
}

function normalizeSeverity(severity: unknown): 'error' | 'warn' | 'off' {
  if (severity === 2 || severity === 'error') {
    return 'error';
  }

  if (severity === 1 || severity === 'warn') {
    return 'warn';
  }

  return 'off';
}

export function normalizeRuleConfig(value: unknown): NormalizedRuleConfig | undefined {
  const entries: unknown[] = Array.isArray(value) ? value : [value];
  const severity = normalizeSeverity(entries[0]);

  if (severity === 'off') {
    return undefined;
  }

  return [severity, ...entries.slice(1)];
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^}]+)\}/.exec(pattern);

  if (!match) {
    return [pattern];
  }

  return match[1].split(',').flatMap((alternative) => {
    return expandBraces(pattern.replace(match[0], alternative));
  });
}

/**
 * Minimal glob matcher covering the patterns used in this preset's overrides
 * (`**` + `*` + `{a,b}` braces). Not a general-purpose implementation.
 */
export function globMatches(pattern: string, filePath: string): boolean {
  return expandBraces(pattern).some((expanded) => {
    const source = expanded
      .split('**/')
      .map((segment) => {
        return segment.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`).replaceAll('*', '[^/]*');
      })
      .join('(?:.*/)?');

    return new RegExp(`^${source}$`).test(filePath);
  });
}

/**
 * Rules explicitly enabled in the Oxlint config for a given probe file,
 * flattening matching overrides on top of the top-level rules.
 */
export function collectOxlintEffectiveRules(config: OxlintConfig, probeFile: string): EffectiveRuleset {
  const result: EffectiveRuleset = {};

  const apply = (rules: Record<string, unknown> | undefined) => {
    const entries = Object.entries(rules ?? {});

    for (const [rule, value] of entries) {
      const name = normalizeRuleName(rule);
      const normalized = normalizeRuleConfig(value);

      if (normalized === undefined) {
        delete result[name];
      } else {
        result[name] = normalized;
      }
    }
  };

  apply(config.rules as Record<string, unknown> | undefined);

  const overrides = config.overrides ?? [];

  for (const override of overrides) {
    if (override.files.some((pattern) => globMatches(pattern, probeFile))) {
      apply(override.rules as Record<string, unknown> | undefined);
    }
  }

  return result;
}

/**
 * Rules left active in the fully resolved ESLint config for a probe file.
 */
export async function collectEslintEffectiveRules(
  configs: Linter.Config[],
  probeFile: string,
  cwd: string,
): Promise<EffectiveRuleset> {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: configs,
  });

  const resolved = (await eslint.calculateConfigForFile(`${cwd}/${probeFile}`)) as {
    rules?: Record<string, unknown>;
  };

  const result: EffectiveRuleset = {};
  const entries = Object.entries(resolved.rules ?? {});

  for (const [rule, value] of entries) {
    const normalized = normalizeRuleConfig(value);

    if (normalized !== undefined) {
      result[rule] = normalized;
    }
  }

  return result;
}

export interface CombinedRuleset {
  rules: EffectiveRuleset;

  /**
   * Rules active in both engines at once. Must stay empty, otherwise the
   * same rule is reported twice.
   */
  duplicates: string[];
}

export function combineRulesets(oxlintRules: EffectiveRuleset, eslintRules: EffectiveRuleset): CombinedRuleset {
  const duplicates = Object.keys(oxlintRules).filter((rule) => rule in eslintRules);

  return {
    rules: { ...oxlintRules, ...eslintRules },
    duplicates,
  };
}
