import type { Linter } from 'eslint';

import { jsRulesOxlint, type JavaScriptRuleOptions } from './javascript.js';

export const tsFileExtensions = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

const tsIgnoreDescriptionFormat = String.raw`^: TS\d+ because .+$`;

export interface TypeScriptRuleOptions extends JavaScriptRuleOptions {
  namingConvention?: {
    variable?: {
      inheritFormat?: boolean;
      format?: string[];
      exceptions?: string[];
    };
    parameter?: {
      inheritFormat?: boolean;
      format?: string[];
      exceptions?: string[];
    };
    typeLike?: {
      inheritFormat?: boolean;
      format?: string[];
      exceptions?: string[];
    };
    memberLike?: {
      inheritFormat?: boolean;
      format?: string[];
      exceptions?: string[];
    };
    function?: {
      inheritFormat?: boolean;
      format?: string[];
      exceptions?: string[];
    };
  };
}

interface NamingConventionFormatOptions {
  inheritFormat?: boolean;
  format?: string[];
}

/**
 * Non type-aware TypeScript rules that run under Oxlint.
 */
export function tsRulesOxlint(options: TypeScriptRuleOptions = {}): Linter.RulesRecord {
  return {
    ...jsRulesOxlint(options),

    /**
     * Oxlint exposes typescript-eslint rules under its own `typescript/`
     * namespace, so rule ids are prefixed `typescript/` rather than
     * `@typescript-eslint/`.
     */
    'typescript/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    'typescript/no-unnecessary-condition': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-empty-function': 'off',
    'typescript/no-explicit-any': 'off',
    'typescript/no-base-to-string': 'off',
    'typescript/no-dynamic-delete': 'off',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'error',
    'typescript/explicit-module-boundary-types': 'off',
    'typescript/ban-ts-comment': [
      'error',
      {
        'ts-expect-error': { descriptionFormat: tsIgnoreDescriptionFormat },
        'ts-ignore': { descriptionFormat: tsIgnoreDescriptionFormat },
        'ts-nocheck': true,
        'ts-check': false,
      },
    ],

    '@stylistic/type-annotation-spacing': 'error',

    // comment handling conflicts with the padding-line heuristics
    '@stylistic/lines-around-comment': 'off',
  };
}

/**
 * TypeScript rules served by ESLint.
 *
 * These are not type-aware in the strict sense, but Oxlint's native
 * `typescript` plugin doesn't implement them today, so we run them under
 * ESLint.
 */
export function tsRulesEslint(options: TypeScriptRuleOptions = {}): Linter.RulesRecord {
  return {
    ...getESLintNamingConventionRule(options.namingConvention),
    '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
    '@typescript-eslint/no-dynamic-delete': 'off',
    '@typescript-eslint/array-type': 'off',
    '@typescript-eslint/require-await': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/prefer-nullish-coalescing': [
      'error',
      {
        ignorePrimitives: true,
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  };
}

/**
 * ESLint-namespaced variant of the naming-convention rule. Keeps the same
 * filter / selector shape as {@link getNamingConventionRule}, only swapping
 * the rule id so it lines up with `@typescript-eslint/eslint-plugin`.
 */
export function getESLintNamingConventionRule(
  extensions?: TypeScriptRuleOptions['namingConvention'],
): Linter.RulesRecord {
  const oxlintRules = getNamingConventionRule(extensions);

  return {
    '@typescript-eslint/naming-convention': oxlintRules['typescript/naming-convention'],
  };
}

export function getNamingConventionRule(extensions?: TypeScriptRuleOptions['namingConvention']): Linter.RulesRecord {
  return {
    'typescript/naming-convention': [
      'error',
      {
        selector: ['variable'],
        format: mergeFormat(['camelCase', 'UPPER_CASE', 'PascalCase'], extensions?.variable),
        leadingUnderscore: 'allowSingleOrDouble',
        trailingUnderscore: 'forbid',
        filter: {
          regex: generateFilterRegex(['__dirname'], extensions?.variable?.exceptions),
          match: false,
        },
      },
      {
        selector: ['function'],
        format: mergeFormat(['camelCase', 'UPPER_CASE', 'PascalCase'], extensions?.function),
        leadingUnderscore: 'allowSingleOrDouble',
        trailingUnderscore: 'forbid',
        filter: {
          regex: generateFilterRegex(['__dirname'], extensions?.function?.exceptions),
          match: false,
        },
      },
      {
        selector: 'parameter',
        format: mergeFormat(['camelCase', 'UPPER_CASE', 'PascalCase'], extensions?.parameter),
        leadingUnderscore: 'allow',
        ...(extensions?.parameter?.exceptions?.length && {
          filter: {
            regex: generateFilterRegex([], extensions.parameter.exceptions),
            match: false,
          },
        }),
      },
      {
        selector: 'typeLike',
        format: mergeFormat(['PascalCase'], extensions?.typeLike),
        ...(extensions?.typeLike?.exceptions?.length && {
          filter: {
            regex: generateFilterRegex([], extensions.typeLike.exceptions),
            match: false,
          },
        }),
      },
      {
        selector: 'memberLike',
        modifiers: ['private'],
        format: mergeFormat(['camelCase', 'PascalCase'], extensions?.memberLike),
        leadingUnderscore: 'require',
        ...(extensions?.memberLike?.exceptions?.length && {
          filter: {
            regex: generateFilterRegex([], extensions.memberLike.exceptions),
            match: false,
          },
        }),
      },
    ],
  };
}

function mergeFormat(defaults: string[], extensions?: NamingConventionFormatOptions) {
  return [...new Set([...((extensions?.inheritFormat ?? true) ? defaults : []), ...(extensions?.format ?? [])])];
}

function generateFilterRegex(defaults: string[], extensions: string[] = []) {
  return `^(${[...defaults, ...extensions].join('|')})$`;
}
