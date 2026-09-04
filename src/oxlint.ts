import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, type OxlintConfig } from 'oxlint';
import { jsRulesOxlint, type JavaScriptRuleOptions } from './configs/javascript.js';
import { reactRulesOxlint, resolveReactRuleOptions, type ReactConfigOptions } from './configs/react.js';
import { tsRulesOxlint, type TypeScriptRuleOptions } from './configs/typescript.js';

const require = createRequire(import.meta.url);

/**
 * Our own rules bundle ships as a sibling of this file in `dist`. Resolve it
 * relative to this module instead of via the `@d3lm/lint-preset/rules`
 * self-reference, which only resolves once `dist` exists and would break
 * importing this module from an unbuilt checkout (e.g. tests against `src`).
 */
const ownRulesPath = fileURLToPath(new URL('rules.js', import.meta.url));

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
    /**
     * Oxlint resolves `jsPlugins` specifiers from the directory of the
     * consumer's config file, where these packages don't exist when
     * node_modules is isolated: they are peer deps of this preset, so pnpm
     * links them only into this package's own node_modules (pnpm 10 dropped
     * the default `*eslint*`/`*prettier*` public-hoist-pattern that used to
     * mask this). Resolve them from inside this package — the same way
     * `src/eslint.ts` imports its plugins — and hand oxlint absolute paths.
     */
    jsPlugins: [
      { name: '@d3lm', specifier: ownRulesPath },
      { name: '@stylistic', specifier: require.resolve('@stylistic/eslint-plugin') },
      { name: 'prettier', specifier: require.resolve('eslint-plugin-prettier') },
      { name: 'unicornx', specifier: require.resolve('eslint-plugin-unicorn') },
      { name: 'jsdocx', specifier: require.resolve('eslint-plugin-jsdoc') },
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
