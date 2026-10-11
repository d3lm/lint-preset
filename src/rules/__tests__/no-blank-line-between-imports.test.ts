import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';
import rule from '../no-blank-line-between-imports.js';

const tester = new RuleTester();

const tsTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
  },
});

tester.run('no-blank-line-between-imports', rule, {
  valid: [
    {
      code: stripIndent`
        import foo from 'foo';
        import bar from 'bar';
      `,
    },
    {
      code: stripIndent`
        import foo from 'foo';
        import bar from 'bar';

        const a = 1;
      `,
    },
    {
      code: stripIndent`
        // leading comment
        import foo from 'foo';
        // comment between imports
        import bar from 'bar';
      `,
    },
    {
      code: stripIndent`
        import foo from 'foo'; // trailing comment
        import bar from 'bar';
      `,
    },
    {
      code: stripIndent`
        import {
          a,

          b,
        } from 'foo';
        import bar from 'bar';
      `,
    },
    {
      code: stripIndent`
        import foo from 'foo';
        /*
         * block comment

         * with a blank line inside
         */
        import bar from 'bar';
      `,
    },
    {
      // non-import statements between imports are out of scope
      code: stripIndent`
        import foo from 'foo';

        foo();

        import bar from 'bar';
      `,
    },
  ],
  invalid: [
    {
      code: stripIndent`
        import foo from 'foo';

        import bar from 'bar';
      `,
      output: stripIndent`
        import foo from 'foo';
        import bar from 'bar';
      `,
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import foo from 'foo';



        import bar from 'bar';

        import baz from 'baz';
      `,
      output: stripIndent`
        import foo from 'foo';
        import bar from 'bar';
        import baz from 'baz';
      `,
      errors: [{ messageId: 'blankLineBetweenImports' }, { messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import foo from 'foo';

        // comment between imports
        import bar from 'bar';
      `,
      output: stripIndent`
        import foo from 'foo';
        // comment between imports
        import bar from 'bar';
      `,
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import foo from 'foo';
        // comment between imports

        import bar from 'bar';
      `,
      output: stripIndent`
        import foo from 'foo';
        // comment between imports
        import bar from 'bar';
      `,
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import 'side-effect';

        import {
          a,
          b,
        } from 'foo';
      `,
      output: stripIndent`
        import 'side-effect';
        import {
          a,
          b,
        } from 'foo';
      `,
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
  ],
});

tsTester.run('no-blank-line-between-imports (typescript)', rule, {
  valid: [
    {
      code: stripIndent`
        import type { Foo } from 'foo';
        import { bar } from 'bar';
      `,
    },
  ],
  invalid: [
    {
      code: stripIndent`
        import type { Foo } from 'foo';

        import { bar } from 'bar';
      `,
      output: stripIndent`
        import type { Foo } from 'foo';
        import { bar } from 'bar';
      `,
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
  ],
});
