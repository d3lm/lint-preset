import { defineConfig, type OxlintConfig } from 'oxlint';
import { jsRulesOxlint, type JavaScriptRuleOptions } from './configs/javascript.js';
import { reactRulesOxlint, resolveReactRuleOptions, type ReactConfigOptions } from './configs/react.js';
import { tsRulesOxlint, type TypeScriptRuleOptions } from './configs/typescript.js';

interface CreateConfigOptions {
  jsRulesOxlint?: JavaScriptRuleOptions;
  react?: ReactConfigOptions;
  tsRulesOxlint?: TypeScriptRuleOptions;
}

export const createOxlintConfig = (options?: CreateConfigOptions): OxlintConfig => {
  const reactOptions = resolveReactRuleOptions(options?.react);

  const reactPlugins = [
    'eslint',
    'typescript',
    'unicorn',
    'oxc',
    'react',
    ...(reactOptions.performance ? ['react-perf'] : []),
  ] as NonNullable<OxlintConfig['plugins']>;

  return defineConfig({
    ...(options?.react && {
      plugins: reactPlugins,
    }),
    jsPlugins: [
      { name: '@d3lm', specifier: '@d3lm/lint-preset/rules' },
      { name: '@stylistic', specifier: '@stylistic/eslint-plugin' },
      { name: 'prettier', specifier: 'eslint-plugin-prettier' },
      { name: 'unicornx', specifier: 'eslint-plugin-unicorn' },
      { name: 'jsdocx', specifier: 'eslint-plugin-jsdoc' },
    ],
    options: { typeAware: true },
    ignorePatterns: ['dist', 'node_modules', 'coverage'],
    rules: {
      ...jsRulesOxlint(options?.jsRulesOxlint),

      '@d3lm/newline-around-multiline': 'error',
      '@d3lm/block-scoped-case': 'error',
      '@d3lm/comment-syntax': 'error',
      '@d3lm/comment-preceding-blank-line': [
        'error',
        { allowInObjects: true, allowInArrays: true, allowInInterfaces: true },
      ],
      '@d3lm/no-implicit-object-return': 'error',

      'prettier/prettier': ['error', {}],

      ...(options?.react && reactRulesOxlint(options.react)),
    },
    overrides: [
      {
        files: ['**/*.{ts,tsx,mts,cts}'],
        rules: tsRulesOxlint(options?.tsRulesOxlint),
      },
    ],
  });
};

export const oxlintConfig = createOxlintConfig();
