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
 * Type-aware typescript-eslint rules that Oxlint executes natively through
 * tsgolint (`options.typeAware`). They mirror what typescript-eslint's
 * `strictTypeChecked` + `stylisticTypeChecked` presets enabled when these
 * rules still ran under ESLint — same severities, same options — so moving
 * them here changed which engine serves them, not the behavior.
 *
 * Type-aware rules in oxlint's `correctness` category (e.g. `await-thenable`,
 * `unbound-method`) are not listed: they already run via the default
 * category, as `warn`, matching the pre-migration state.
 *
 * `typescript/naming-convention` is one of the two typescript-eslint
 * type-aware rules tsgolint doesn't implement; it stays in ESLint
 * (see {@link tsRulesEslint}).
 */
export const tsTypeAwareRulesOxlint: Linter.RulesRecord = {
  'typescript/no-confusing-void-expression': 'error',
  'typescript/no-deprecated': 'error',
  'typescript/no-floating-promises': 'error',
  'typescript/no-misused-promises': 'error',
  'typescript/no-mixed-enums': 'error',
  'typescript/no-unnecessary-boolean-literal-compare': 'error',
  'typescript/no-unnecessary-condition': 'error',
  'typescript/no-unnecessary-template-expression': 'error',
  'typescript/no-unnecessary-type-arguments': 'error',
  'typescript/no-unnecessary-type-assertion': 'error',
  'typescript/no-unnecessary-type-conversion': 'error',
  'typescript/no-unnecessary-type-parameters': 'error',
  'typescript/no-unsafe-argument': 'error',
  'typescript/no-unsafe-assignment': 'error',
  'typescript/no-unsafe-call': 'error',
  'typescript/no-unsafe-enum-comparison': 'error',
  'typescript/no-unsafe-member-access': 'error',
  'typescript/no-unsafe-return': 'error',
  'typescript/non-nullable-type-assertion-style': 'error',
  'typescript/only-throw-error': 'error',
  'typescript/prefer-find': 'error',
  'typescript/prefer-includes': 'error',
  'typescript/prefer-nullish-coalescing': ['error', { ignorePrimitives: true }],
  'typescript/prefer-optional-chain': 'error',
  'typescript/prefer-promise-reject-errors': 'error',
  'typescript/prefer-reduce-type-parameter': 'error',
  'typescript/prefer-regexp-exec': 'error',
  'typescript/prefer-return-this-type': 'error',
  'typescript/prefer-string-starts-ends-with': 'error',
  'typescript/related-getter-setter-pairs': 'error',
  'typescript/restrict-plus-operands': [
    'error',
    {
      allowAny: false,
      allowBoolean: false,
      allowNullish: false,
      allowNumberAndString: false,
      allowRegExp: false,
    },
  ],
  'typescript/return-await': ['error', 'error-handling-correctness-only'],
  'typescript/use-unknown-in-catch-callback-variable': 'error',
};

/**
 * Syntax-only rules that Oxlint ports natively and that used to reach ESLint
 * through typescript-eslint's presets: the `strictTypeChecked` /
 * `stylisticTypeChecked` rules that don't need type information, plus the
 * ESLint-core rules typescript-eslint's `eslintRecommended` config raises for
 * TypeScript files (hence the `eslint/` prefix and the TS-files-only scope).
 */
export const tsSyntaxRulesOxlint: Linter.RulesRecord = {
  'typescript/adjacent-overload-signatures': 'error',
  'typescript/ban-tslint-comment': 'error',
  'typescript/class-literal-property-style': 'error',
  'typescript/consistent-generic-constructors': 'error',
  'typescript/consistent-indexed-object-style': 'error',
  'typescript/consistent-type-assertions': 'error',
  'typescript/consistent-type-definitions': 'error',
  'typescript/no-array-constructor': 'error',
  'typescript/no-confusing-non-null-assertion': 'error',
  'typescript/no-empty-object-type': 'error',
  'typescript/no-extraneous-class': 'error',
  'typescript/no-inferrable-types': 'error',
  'typescript/no-invalid-void-type': 'error',
  'typescript/no-namespace': 'error',
  'typescript/no-non-null-asserted-nullish-coalescing': 'error',
  'typescript/no-require-imports': 'error',
  'typescript/no-unnecessary-type-constraint': 'error',
  'typescript/no-unsafe-function-type': 'error',
  'typescript/no-useless-constructor': 'error',
  'typescript/prefer-for-of': 'error',
  'typescript/prefer-function-type': 'error',
  'typescript/prefer-literal-enum-member': 'error',
  'typescript/unified-signatures': 'error',

  'eslint/no-var': 'error',
  'eslint/prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: false }],
  'eslint/prefer-rest-params': 'error',
  'eslint/prefer-spread': 'error',
};

/**
 * TypeScript rules that run under Oxlint, including the type-aware set
 * executed through tsgolint.
 */
export function tsRulesOxlint(options: TypeScriptRuleOptions = {}): Linter.RulesRecord {
  return {
    ...jsRulesOxlint(options),

    ...tsTypeAwareRulesOxlint,
    ...tsSyntaxRulesOxlint,

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
 * Only rules Oxlint can't run remain here: `naming-convention` is one of the
 * two typescript-eslint type-aware rules tsgolint doesn't implement, and
 * `explicit-member-accessibility` has no Oxlint port at all.
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
