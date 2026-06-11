import type { ESLint, Linter } from 'eslint';
import oxlintPlugin from 'eslint-plugin-oxlint';
import unicornPlugin from 'eslint-plugin-unicorn';
import { createRequire } from 'node:module';
import type { OxlintConfig } from 'oxlint';
import tsLint from 'typescript-eslint';
import { jsFileExtensions, jsRulesEslint } from './configs/javascript.js';
import { type ReactConfigOptions, reactFileExtensions } from './configs/react.js';
import { tsFileExtensions, tsRulesEslint, type TypeScriptRuleOptions } from './configs/typescript.js';
import { unicornRulesEslint } from './configs/unicorn.js';

export interface ESlintPresetOptions extends TypeScriptRuleOptions {
  oxlintConfig?: OxlintConfig;
  oxlintConfigPath?: string;
  react?: ReactConfigOptions;
  tsconfigRootDir?: string;
  allowDefaultProject?: string[];
  extraConfigs?: Linter.Config[];
  ignores?: string[];
  extendDefaultIgnores?: boolean;
}

const allFileExtensions = [...jsFileExtensions, ...tsFileExtensions];

const require = createRequire(import.meta.url);

export function eslintConfig(options: ESlintPresetOptions = {}): Linter.Config[] {
  const {
    oxlintConfig,
    oxlintConfigPath,
    react,
    tsconfigRootDir,
    extraConfigs = [],
    allowDefaultProject = ['*.config.ts', '*.config.mts', '*.config.cts', '*.config.js'],
    ignores = [],
    extendDefaultIgnores = true,
    ...ruleOptions
  } = options;

  const typeAwareConfigs: Linter.Config[] = [
    ...(tsLint.configs.strictTypeChecked as Linter.Config[]),
    ...(tsLint.configs.stylisticTypeChecked as Linter.Config[]),
  ].map((config) => {
    return {
      ...config,
      files: config.files && config.files.length > 0 ? config.files : tsFileExtensions,
    };
  });

  const oxlintDisables = oxlintConfig
    ? oxlintPlugin.buildFromOxlintConfig(oxlintConfig as Parameters<typeof oxlintPlugin.buildFromOxlintConfig>[0], {
        typeAware: true,
      })
    : oxlintPlugin.buildFromOxlintConfigFile(oxlintConfigPath ?? '.oxlintrc.json', { typeAware: true });

  return [
    {
      name: '@d3lm/ignores',
      ignores: extendDefaultIgnores ? [...ignores, 'dist/**', 'node_modules/**', 'coverage/**'] : ignores,
    },

    ...typeAwareConfigs,

    {
      name: '@d3lm/project-service',
      files: tsFileExtensions,
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject,
          },
          ...(tsconfigRootDir ? { tsconfigRootDir } : {}),
        },
      },
    },

    ...(react ? reactHooksConfigs() : []),

    {
      name: '@d3lm/eslint-only-rules',
      files: allFileExtensions,
      plugins: {
        unicorn: unicornPlugin as ESLint.Plugin,
      },
      rules: {
        ...jsRulesEslint(ruleOptions),
        ...unicornRulesEslint,
      },
    },

    {
      name: '@d3lm/eslint-only-rules-ts',
      files: tsFileExtensions,
      rules: {
        ...tsRulesEslint(ruleOptions),
      },
    },

    ...extraConfigs,

    // MUST be last to turn off every rule oxlint already owns
    ...oxlintDisables,
  ];
}

interface ReactHooksPlugin {
  configs?: {
    flat?: {
      recommended?: Linter.Config | Linter.Config[];
    };
    recommended?: Linter.Config | Linter.Config[];
  };
}

function reactHooksConfigs(): Linter.Config[] {
  const typedReactHooksPlugin = require('eslint-plugin-react-hooks') as ReactHooksPlugin;

  const recommendedConfig =
    typedReactHooksPlugin.configs?.flat?.recommended ?? typedReactHooksPlugin.configs?.recommended;

  if (!recommendedConfig) {
    throw new Error('eslint-plugin-react-hooks does not expose a recommended config.');
  }

  return normalizeConfigs(recommendedConfig).map((config) => {
    return {
      ...config,
      files: config.files && config.files.length > 0 ? config.files : reactFileExtensions,
    };
  });
}

function normalizeConfigs(configs: Linter.Config | Linter.Config[]): Linter.Config[] {
  return Array.isArray(configs) ? configs : [configs];
}
