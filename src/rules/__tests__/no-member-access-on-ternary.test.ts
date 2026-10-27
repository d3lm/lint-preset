import { RuleTester } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';
import rule from '../no-member-access-on-ternary.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: tsParser,
  },
});

tester.run('no-member-access-on-ternary', rule, {
  valid: [
    // the ternary is named first, then used
    'const ledger = applied ? acked : refused; ledger.push(message);',

    // a ternary passed as an argument or returned as a value is fine
    'ledger.push(applied ? acked : refused);',
    'const f = () => (applied ? acked : refused);',
    'function f() { return applied ? acked : refused; }',

    // member access inside a branch belongs to the branch, not the ternary
    'const x = applied ? acked.push(message) : refused.push(message);',
    'const x = runs === 1 ? label.singular.toLowerCase() : label.plural;',

    // member access in the condition is fine
    'const x = list.length > 0 ? first : second;',

    // calling the ternary itself is not member access
    '(applied ? accept : reject)(message);',

    // other parenthesized receivers are out of scope
    '(a || b).push(message);',
    '(a ?? b).push(message);',
    '(await load()).push(message);',
  ],
  invalid: [
    {
      code: '(applied ? acked : refused).push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '(runs === 1 ? label.singular : label.plural).toLowerCase();',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: 'const size = (applied ? acked : refused).length;',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: 'const value = (applied ? acked : refused)[key];',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '(applied ? acked : refused)?.push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '(applied ? acked : refused).items.push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: 'const f = () => (applied ? acked : refused).length;',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '(applied ? acked : refused)!.push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '((applied ? acked : refused) as string[]).push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '((applied ? acked : refused) satisfies string[]).push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
    {
      code: '(a ? b : c ? d : e).push(message);',
      errors: [{ messageId: 'memberAccessOnTernary' }],
    },
  ],
});
