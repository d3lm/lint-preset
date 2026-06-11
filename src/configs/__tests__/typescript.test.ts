import { getESLintNamingConventionRule } from '../typescript.js';

interface NamingConventionRuleOption {
  selector: string | string[];
  format: string[];
  filter?: {
    regex: string;
    match: boolean;
  };
}

function getNamingConventionOptions(options?: Parameters<typeof getESLintNamingConventionRule>[0]) {
  return getESLintNamingConventionRule(options)['@typescript-eslint/naming-convention'] as [
    'error',
    ...NamingConventionRuleOption[],
  ];
}

describe('typescript naming-convention config', () => {
  it('emits plain format arrays while inheriting defaults', () => {
    const [, variable, fn, parameter, typeLike, memberLike] = getNamingConventionOptions({
      variable: { exceptions: ['MyGlobal'] },
    });

    expect(variable).toMatchObject({
      selector: ['variable'],
      format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
      filter: {
        regex: '^(__dirname|MyGlobal)$',
        match: false,
      },
    });

    expect(fn.format).toEqual(['camelCase', 'UPPER_CASE', 'PascalCase']);
    expect(parameter.format).toEqual(['camelCase', 'UPPER_CASE', 'PascalCase']);
    expect(typeLike.format).toEqual(['PascalCase']);
    expect(memberLike.format).toEqual(['camelCase', 'PascalCase']);
  });

  it('allows selector formats to replace inherited defaults', () => {
    const [, variable] = getNamingConventionOptions({
      variable: {
        inheritFormat: false,
        format: ['snake_case'],
      },
    });

    expect(variable.format).toEqual(['snake_case']);
  });

  it('deduplicates inherited and extended formats', () => {
    const [, variable] = getNamingConventionOptions({
      variable: {
        format: ['camelCase', 'snake_case'],
      },
    });

    expect(variable.format).toEqual(['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']);
  });
});
