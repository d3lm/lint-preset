import type { Linter } from 'eslint';

export interface ReactRuleOptions {
  fastRefresh?: boolean;
  performance?: boolean;
}

export type ReactConfigOptions = boolean | ReactRuleOptions;

interface ResolvedReactRuleOptions {
  fastRefresh: boolean;
  performance: boolean;
}

export const reactFileExtensions = ['**/*.jsx', '**/*.tsx'];

export function resolveReactRuleOptions(options: ReactConfigOptions = false): ResolvedReactRuleOptions {
  if (options === false) {
    return {
      fastRefresh: false,
      performance: false,
    };
  }

  if (options === true) {
    return {
      fastRefresh: true,
      performance: true,
    };
  }

  return {
    fastRefresh: options.fastRefresh ?? true,
    performance: options.performance ?? true,
  };
}

export function reactRulesOxlint(options: ReactConfigOptions = false): Linter.RulesRecord {
  const resolvedOptions = resolveReactRuleOptions(options);

  return {
    'react/jsx-key': 'error',
    'react/jsx-no-duplicate-props': 'error',
    'react/no-children-prop': 'error',
    'react/no-danger-with-children': 'error',
    'react/void-dom-elements-no-children': 'error',
    'react/no-unknown-property': 'error',
    'react/style-prop-object': 'error',
    'react/button-has-type': 'error',
    'react/checked-requires-onchange-or-readonly': 'error',
    'react/forward-ref-uses-ref': 'error',
    'react/jsx-props-no-spread-multi': 'error',
    'react/jsx-no-script-url': 'error',
    'react/jsx-no-target-blank': 'error',
    'react/jsx-no-constructed-context-values': 'error',
    'react/no-unstable-nested-components': 'error',
    'react/no-array-index-key': 'warn',
    'react/no-object-type-as-default-prop': 'warn',
    'react/iframe-missing-sandbox': 'error',
    'react/no-danger': 'warn',

    ...(resolvedOptions.fastRefresh && {
      'react/only-export-components': ['warn', { allowConstantExport: true }],
    }),

    ...(resolvedOptions.performance && {
      'react-perf/jsx-no-new-object-as-prop': 'warn',
      'react-perf/jsx-no-new-array-as-prop': 'warn',
      'react-perf/jsx-no-new-function-as-prop': 'warn',
      'react-perf/jsx-no-jsx-as-prop': 'warn',
    }),
  };
}
