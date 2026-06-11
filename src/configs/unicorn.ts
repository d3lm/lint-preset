import type { Linter } from 'eslint';

/*
 * Mirror of `eslint-plugin-unicorn`'s recommended config, split by runtime.
 *
 * Oxlint natively implements most unicorn rules, so we enable those under the
 * canonical `unicorn/` prefix (fast, Rust). Rules oxlint hasn't ported run
 * through the original JS plugin, aliased as `unicornx` in `jsPlugins` (see
 * `src/oxlint.ts`), because oxlint's built-in plugin owns the `unicorn/`
 * namespace.
 *
 * `unicorn/prevent-abbreviations` is also not ported; it lives in
 * `javascript.ts` because it takes user-configurable options.
 */

/**
 * Unicorn recommended rules natively implemented by Oxlint, grouped by the
 * oxlint category they belong to. Only the correctness group is enabled by
 * oxlint's defaults (as `warn`); everything is set explicitly to `error` to
 * match the recommended config.
 */
export const unicornRulesOxlint: Linter.RulesRecord = {
  // correctness
  'unicorn/no-await-in-promise-methods': 'error',
  'unicorn/no-empty-file': 'warn',
  'unicorn/no-invalid-fetch-options': 'error',
  'unicorn/no-invalid-remove-event-listener': 'error',
  'unicorn/no-new-array': 'error',
  'unicorn/no-single-promise-in-promise-methods': 'error',
  'unicorn/no-thenable': 'error',
  'unicorn/no-unnecessary-await': 'error',
  'unicorn/no-useless-fallback-in-spread': 'error',
  'unicorn/no-useless-length-check': 'error',
  'unicorn/no-useless-spread': 'error',
  'unicorn/prefer-set-size': 'error',
  'unicorn/prefer-string-starts-ends-with': 'error',

  // perf
  'unicorn/prefer-array-find': 'error',
  'unicorn/prefer-array-flat-map': 'error',
  'unicorn/prefer-set-has': 'error',

  // restriction
  'unicorn/no-abusive-eslint-disable': 'error',
  'unicorn/no-anonymous-default-export': 'error',
  'unicorn/no-array-for-each': 'error',
  'unicorn/no-array-reduce': 'error',
  'unicorn/no-document-cookie': 'error',
  'unicorn/no-magic-array-flat-depth': 'error',
  'unicorn/no-process-exit': 'error',
  'unicorn/no-useless-error-capture-stack-trace': 'error',
  'unicorn/prefer-modern-math-apis': 'error',
  'unicorn/prefer-module': 'error',
  'unicorn/prefer-node-protocol': 'error',
  'unicorn/prefer-number-properties': 'error',

  // suspicious
  'unicorn/consistent-function-scoping': 'error',
  'unicorn/no-accessor-recursion': 'error',
  'unicorn/no-array-reverse': 'error',
  'unicorn/no-array-sort': 'error',
  'unicorn/no-instanceof-builtins': 'error',
  'unicorn/prefer-add-event-listener': 'error',
  'unicorn/require-module-specifiers': 'error',

  // pedantic
  'unicorn/consistent-assert': 'error',
  'unicorn/consistent-empty-array-spread': 'error',
  'unicorn/escape-case': 'error',
  'unicorn/explicit-length-check': 'error',
  'unicorn/new-for-builtins': 'error',
  'unicorn/no-array-callback-reference': 'error',
  'unicorn/no-hex-escape': 'error',
  'unicorn/no-immediate-mutation': 'error',
  'unicorn/no-lonely-if': 'error',
  'unicorn/no-negation-in-equality-check': 'error',
  'unicorn/no-new-buffer': 'error',
  'unicorn/no-object-as-default-parameter': 'error',
  'unicorn/no-static-only-class': 'error',
  'unicorn/no-this-assignment': 'error',
  'unicorn/no-typeof-undefined': 'error',
  'unicorn/no-unnecessary-array-flat-depth': 'error',
  'unicorn/no-unnecessary-array-splice-count': 'error',
  'unicorn/no-unnecessary-slice-end': 'error',
  'unicorn/no-unreadable-iife': 'error',
  'unicorn/no-useless-promise-resolve-reject': 'error',
  'unicorn/no-useless-switch-case': 'error',
  'unicorn/prefer-array-flat': 'error',
  'unicorn/prefer-array-some': 'error',
  'unicorn/prefer-at': 'error',
  'unicorn/prefer-blob-reading-methods': 'error',
  'unicorn/prefer-code-point': 'error',
  'unicorn/prefer-date-now': 'error',
  'unicorn/prefer-dom-node-append': 'error',
  'unicorn/prefer-dom-node-dataset': 'error',
  'unicorn/prefer-dom-node-remove': 'error',
  'unicorn/prefer-event-target': 'error',
  'unicorn/prefer-math-min-max': 'error',
  'unicorn/prefer-math-trunc': 'error',
  'unicorn/prefer-native-coercion-functions': 'error',
  'unicorn/prefer-prototype-methods': 'error',
  'unicorn/prefer-query-selector': 'error',
  'unicorn/prefer-regexp-test': 'error',
  'unicorn/prefer-string-replace-all': 'error',
  'unicorn/prefer-string-slice': 'error',
  'unicorn/prefer-top-level-await': 'error',
  'unicorn/prefer-type-error': 'error',
  'unicorn/require-number-to-fixed-digits-argument': 'error',

  // style
  'unicorn/catch-error-name': ['error', { name: 'error' }],
  'unicorn/consistent-date-clone': 'error',
  'unicorn/consistent-existence-index-check': 'error',
  'unicorn/consistent-template-literal-escape': 'error',
  'unicorn/empty-brace-spaces': 'error',
  'unicorn/error-message': 'error',
  'unicorn/no-array-method-this-argument': 'error',
  'unicorn/no-await-expression-member': 'error',
  'unicorn/no-console-spaces': 'error',
  'unicorn/no-unreadable-array-destructuring': 'error',
  'unicorn/no-useless-collection-argument': 'error',
  'unicorn/no-zero-fractions': 'error',
  'unicorn/numeric-separators-style': 'error',
  'unicorn/prefer-array-index-of': 'error',
  'unicorn/prefer-bigint-literals': 'error',
  'unicorn/prefer-class-fields': 'error',
  'unicorn/prefer-classlist-toggle': 'error',
  'unicorn/prefer-default-parameters': 'error',
  'unicorn/prefer-dom-node-text-content': 'error',
  'unicorn/prefer-global-this': 'error',
  'unicorn/prefer-includes': 'error',
  'unicorn/prefer-keyboard-event-key': 'error',
  'unicorn/prefer-logical-operator-over-ternary': 'error',
  'unicorn/prefer-modern-dom-apis': 'error',
  'unicorn/prefer-negative-index': 'error',
  'unicorn/prefer-object-from-entries': 'error',
  'unicorn/prefer-optional-catch-binding': 'error',
  'unicorn/prefer-reflect-apply': 'error',
  'unicorn/prefer-response-static-json': 'error',
  'unicorn/prefer-spread': 'error',
  'unicorn/prefer-string-raw': 'error',
  'unicorn/prefer-string-trim-start-end': 'error',
  'unicorn/prefer-structured-clone': 'error',
  'unicorn/relative-url-style': 'error',
  'unicorn/require-array-join-separator': 'error',
  'unicorn/require-module-attributes': 'error',
  'unicorn/switch-case-braces': 'error',
  'unicorn/switch-case-break-position': 'error',
  'unicorn/text-encoding-identifier-case': 'error',
  'unicorn/throw-new-error': 'error',
};

/**
 * Unicorn recommended rules that Oxlint hasn't ported. They run inside Oxlint
 * through the original JS plugin under the `unicornx` alias.
 */
export const unicornRulesJsPlugin: Linter.RulesRecord = {
  'unicornx/isolated-functions': 'error',
  'unicornx/no-for-loop': 'error',
  'unicornx/no-named-default': 'error',
  'unicornx/no-unnecessary-polyfills': 'error',
  'unicornx/prefer-export-from': 'error',
  'unicornx/prefer-simple-condition-first': 'error',
  'unicornx/prefer-single-call': 'error',
  'unicornx/prefer-switch': 'error',
  'unicornx/template-indent': 'error',

  /*
   * Native port exists but only in oxlint's nursery category, which can't be
   * enabled from config, so we run the JS original instead.
   */
  'unicornx/no-useless-iterator-to-array': 'error',

  /*
   * Oxlint's port hardcodes uppercase hexadecimal digits, which fights
   * Prettier's lowercase formatting, so we run the JS original with the
   * lowercase option instead.
   */
  'unicornx/number-literal-case': ['error', { hexadecimalValue: 'lowercase' }],
};

/**
 * Unicorn recommended rules that can't run inside Oxlint's JS-plugin host yet
 * because the compat layer is missing ESLint APIs (e.g.
 * `sourceCode.getDisableDirectives`). ESLint picks them up after Oxlint runs.
 */
export const unicornRulesEslint: Linter.RulesRecord = {
  'unicorn/expiring-todo-comments': 'error',
};
