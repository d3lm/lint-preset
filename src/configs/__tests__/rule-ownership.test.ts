import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import type { OxlintConfig } from 'oxlint';
import { eslintConfig } from '../../eslint.js';
import { createOxlintConfig } from '../../oxlint.js';
import { tsSyntaxRulesOxlint, tsTypeAwareRulesOxlint } from '../typescript.js';
import { normalizeRuleName } from './helpers/effective-ruleset.js';

/**
 * Runtime proof that the ESLint → Oxlint rule migration works end to end:
 * every migrated rule fires under Oxlint on a fixture that violates it, and
 * none of them are reported by ESLint anymore (no gaps, no double-reporting).
 */

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../../..');
const fixtureDirectory = path.join(testDirectory, 'fixtures', 'violations');
const fixtureFiles = ['type-aware.ts', 'syntax.ts'];

const require = createRequire(import.meta.url);
const oxlintBin = path.join(path.dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');

const migratedRules = [...Object.keys(tsTypeAwareRulesOxlint), ...Object.keys(tsSyntaxRulesOxlint)];

/**
 * Rule namespaces served by JS plugins wired through Oxlint's `jsPlugins`.
 * The fixture run only exercises native (Rust/tsgolint) rules, so these are
 * stripped to avoid resolving plugin specifiers meant for consumer projects.
 */
const jsPluginPrefixes = ['@d3lm/', '@stylistic/', 'prettier/', 'unicornx/', 'jsdocx/'];

function stripJsPluginRules(rules: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(rules ?? {}).filter(([name]) => {
      return !jsPluginPrefixes.some((prefix) => name.startsWith(prefix));
    }),
  );
}

function nativeOnlyOxlintConfig(): Record<string, unknown> {
  const { jsPlugins: _jsPlugins, rules, overrides, ...rest } = createOxlintConfig();

  return {
    ...rest,
    rules: stripJsPluginRules(rules as Record<string, unknown>),
    overrides: (overrides ?? []).map((override) => {
      return {
        ...override,
        rules: stripJsPluginRules(override.rules as Record<string, unknown>),
      };
    }),
  };
}

/**
 * Maps an Oxlint config rule id to the scoped codes it may use in JSON
 * output, e.g. `typescript/no-unsafe-call` reports as
 * `typescript-eslint(no-unsafe-call)`. typescript-eslint rules that merely
 * extend an ESLint-core rule (e.g. `no-useless-constructor`) share oxlint's
 * core implementation and report under the `eslint` scope instead.
 */
function toOxlintDiagnosticCodes(rule: string): string[] {
  const [prefix, name] = rule.split('/');

  return prefix === 'typescript' ? [`typescript-eslint(${name})`, `eslint(${name})`] : [`eslint(${name})`];
}

interface OxlintDiagnostic {
  code: string;
  severity: string;
  filename: string;
}

function runOxlintOnFixtures(config: OxlintConfig | Record<string, unknown>): OxlintDiagnostic[] {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-preset-ownership-'));
  const configPath = path.join(temporaryDirectory, 'oxlintrc.json');

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = spawnSync(process.execPath, [oxlintBin, '-c', configPath, '--format', 'json', fixtureDirectory], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (result.error) {
      throw result.error;
    }

    if (!result.stdout) {
      throw new Error(`oxlint produced no output. stderr: ${result.stderr}`);
    }

    const parsed = JSON.parse(result.stdout) as { diagnostics: OxlintDiagnostic[] };

    return parsed.diagnostics;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

describe('rule ownership on violation fixtures', () => {
  it('oxlint natively reports every migrated rule as an error', { timeout: 120_000 }, () => {
    const diagnostics = runOxlintOnFixtures(nativeOnlyOxlintConfig());

    const reportedCodes = new Set(
      diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code),
    );

    const missing = migratedRules.filter((rule) => {
      return !toOxlintDiagnosticCodes(rule).some((code) => reportedCodes.has(code));
    });

    expect(missing).toEqual([]);
  });

  it('eslint no longer reports any migrated rule', { timeout: 120_000 }, async () => {
    const eslint = new ESLint({
      cwd: fixtureDirectory,
      overrideConfigFile: true,
      overrideConfig: eslintConfig({
        oxlintConfig: createOxlintConfig(),
        tsconfigRootDir: fixtureDirectory,
      }),
    });

    const results = await eslint.lintFiles(fixtureFiles);
    const messages = results.flatMap((result) => result.messages);

    // a parse or config failure would make the absence check below vacuous
    expect(messages.filter((message) => message.fatal)).toEqual([]);

    /**
     * Positive control: the fixtures are clean for ESLint-owned rules, so
     * prove the ESLint run is live by feeding it a violation of a rule it
     * still owns and asserting it reports.
     */
    const controlResults = await eslint.lintText('export const mapped = [1].map(function (n) {\n  return n;\n});\n', {
      filePath: path.join(fixtureDirectory, fixtureFiles[0]),
    });

    const controlRules = new Set(controlResults.flatMap((result) => result.messages.map((message) => message.ruleId)));

    expect(controlRules).toContain('prefer-arrow-callback');

    const reportedRules = new Set(messages.map((message) => message.ruleId));
    const migratedEslintNames = migratedRules.map((rule) => normalizeRuleName(rule));
    const stillReported = migratedEslintNames.filter((rule) => reportedRules.has(rule));

    expect(stillReported).toEqual([]);
  });
});
