import type { Linter } from 'eslint';
import { ABBREVIATION_REPLACEMENTS, DEFAULT_ABBREVIATION_ALLOW_LIST } from './abbreviations.js';
import { unicornRulesJsPlugin, unicornRulesOxlint } from './unicorn.js';

export const jsFileExtensions = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

export const paddingLineEntries = [
  {
    blankLine: 'always',
    prev: '*',
    next: ['block', 'block-like', 'class', 'const', 'let'],
  },
  {
    blankLine: 'always',
    prev: 'block',
    next: '*',
  },
  {
    blankLine: 'always',
    prev: ['const'],
    next: '*',
  },
  {
    blankLine: 'always',
    prev: ['let'],
    next: '*',
  },
  {
    blankLine: 'any',
    prev: ['const'],
    next: ['const'],
  },
  {
    blankLine: 'any',
    prev: ['let'],
    next: ['let'],
  },
  {
    blankLine: 'always',
    prev: ['let'],
    next: ['const'],
  },
  {
    blankLine: 'always',
    prev: ['const'],
    next: ['let'],
  },
  {
    blankLine: 'always',
    prev: ['singleline-const'],
    next: ['multiline-const'],
  },
  {
    blankLine: 'always',
    prev: ['multiline-const'],
    next: ['singleline-const'],
  },
  {
    blankLine: 'always',
    prev: ['singleline-let'],
    next: ['multiline-let'],
  },
  {
    blankLine: 'always',
    prev: ['multiline-let'],
    next: ['singleline-let'],
  },
  {
    blankLine: 'any',
    prev: ['case', 'block', 'block-like'],
    next: ['case', 'default'],
  },
  {
    blankLine: 'any',
    prev: '*',
    next: 'break',
  },
  {
    blankLine: 'always',
    prev: 'if',
    next: '*',
  },
  /**
   * Imports form a block: padded from anything that isn't an import, but
   * consecutive imports can sit together. The same-type rule comes last so it
   * wins over the surrounding `*` rules.
   */
  {
    blankLine: 'always',
    prev: 'import',
    next: '*',
  },
  {
    blankLine: 'always',
    prev: '*',
    next: 'import',
  },
  {
    blankLine: 'any',
    prev: 'import',
    next: 'import',
  },
  /**
   * Exports form a block: padded from anything that isn't an export, but
   * consecutive exports can sit together. The same-type rule comes last so it
   * wins over the surrounding `*` rules.
   */
  {
    blankLine: 'always',
    prev: 'export',
    next: '*',
  },
  {
    blankLine: 'always',
    prev: '*',
    next: 'export',
  },
  {
    blankLine: 'any',
    prev: 'export',
    next: 'export',
  },
];

export const jsdocTagLineOptions = ['always', { count: 1, startLines: 1, applyToEndTag: false }];

export interface JavaScriptRuleOptions {
  preventAbbreviations?: {
    allowList?: string[];
    inheritAllowList?: boolean;
    replacements?: Record<string, Record<string, boolean> | false>;
    inheritReplacements?: boolean;
  };
}

/**
 * Non type-aware rules that run under Oxlint.
 */
export function jsRulesOxlint(options: JavaScriptRuleOptions = {}): Linter.RulesRecord {
  const { preventAbbreviations: preventAbbreviationsOptions } = options;

  const {
    inheritAllowList = true,
    inheritReplacements = true,
    allowList = [],
    replacements = {},
  } = preventAbbreviationsOptions ?? {};

  return {
    'consistent-return': 'error',
    curly: ['error', 'all'],
    'arrow-body-style': 'off',
    'dot-notation': 'error',
    'no-debugger': 'warn',
    'no-unused-vars': 'off',
    'no-async-promise-executor': 'error',
    'no-case-declarations': 'error',
    'default-case-last': 'error',
    'no-cond-assign': 'error',
    'no-dynamic-delete': 'off',
    'no-unneeded-ternary': 'error',
    'object-shorthand': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],

    '@stylistic/padding-line-between-statements': ['error', ...paddingLineEntries],
    '@stylistic/no-trailing-spaces': 'error',

    /**
     * Indentation is owned by Prettier. Oxlint's @stylistic/indent port
     * diverges from eslint-stylistic on edge cases (e.g., multiline object
     * args inside ternaries), so we leave the rule off.
     */
    '@stylistic/indent': 'off',
    '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
    '@stylistic/multiline-comment-style': ['error', 'starred-block'],
    '@stylistic/spaced-comment': [
      'error',
      'always',
      {
        block: { balanced: true },
      },
    ],
    '@stylistic/brace-style': ['error', '1tbs'],
    '@stylistic/lines-around-comment': [
      'error',
      {
        beforeBlockComment: true,
        beforeLineComment: true,
        allowBlockStart: true,
        allowBlockEnd: false,
        allowObjectStart: true,
        allowObjectEnd: false,
        allowArrayStart: true,
        allowArrayEnd: true,
        allowClassStart: true,
        allowInterfaceStart: true,
        allowInterfaceEnd: true,
        allowEnumStart: true,
        allowEnumEnd: true,
        allowTypeStart: true,
        allowTypeEnd: false,
      },
    ],

    // unicorn recommended, split between native oxlint ports and JS originals
    ...unicornRulesOxlint,
    ...unicornRulesJsPlugin,

    /**
     * Oxlint's built-in `unicorn` / `jsdoc` plugins don't implement these,
     * so we wire the original JS plugins under aliased names (see jsPlugins
     * in `src/oxlint.ts`). Rule IDs use the alias, not the canonical prefix.
     */
    'unicornx/name-replacements': [
      'error',
      {
        replacements: inheritReplacements ? { ...ABBREVIATION_REPLACEMENTS, ...replacements } : replacements,
        allowList: Object.fromEntries(
          (inheritAllowList ? [...DEFAULT_ABBREVIATION_ALLOW_LIST, ...allowList] : allowList).map((name) => [
            name,
            true,
          ]),
        ),
      },
    ],

    'jsdocx/tag-lines': ['error', ...jsdocTagLineOptions],
  };
}

/**
 * Rules that can't run under Oxlint. ESLint-core rules that Oxlint hasn't
 * implemented yet and aren't exposed by any plugin we can alias into oxlint's
 * `jsPlugins` (the `@eslint/js` package only ships configs, not a raw `rules`
 * object). ESLint picks them up after Oxlint runs.
 *
 * Type-aware rules are served separately.
 */
export function jsRulesEslint(_options: JavaScriptRuleOptions = {}): Linter.RulesRecord {
  return {
    'prefer-arrow-callback': 'error',
    'no-useless-assignment': 'error',
  };
}
