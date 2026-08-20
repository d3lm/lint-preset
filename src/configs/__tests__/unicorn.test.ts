import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import unicornPlugin from 'eslint-plugin-unicorn';
import { unicornRulesJsPlugin } from '../unicorn.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const forOfRule = unicornPlugin.rules?.['no-unreadable-for-of-expression'];

if (!forOfRule) {
  throw new Error('eslint-plugin-unicorn is missing the no-unreadable-for-of-expression rule');
}

describe('unicorn config', () => {
  it('enables no-unreadable-for-of-expression through the unicornx alias', () => {
    expect(unicornRulesJsPlugin['unicornx/no-unreadable-for-of-expression']).toBe('error');
  });
});

tester.run('unicorn no-unreadable-for-of-expression config', forOfRule, {
  valid: [
    'for (const [repo, hoursList] of byRepo.entries()) {}',
    'for (const entry of [...byRepo.entries()]) {}',
    'for (const item of getItems(argument)) {}',
    'for (const item of items.toSorted(compare)) {}',
  ],
  invalid: [
    {
      code: stripIndent`
        for (const [repo, hoursList] of [...byRepo.entries()].toSorted((a, b) => {
          return b[1].length - a[1].length;
        })) {
          printHistogram(repo, hoursList);
        }
      `,
      errors: [{ messageId: 'no-unreadable-for-of-expression' }],
    },
    {
      code: 'for (const item of items.toSorted((a, b) => a - b)) {}',
      errors: [{ messageId: 'no-unreadable-for-of-expression' }],
    },
  ],
});
