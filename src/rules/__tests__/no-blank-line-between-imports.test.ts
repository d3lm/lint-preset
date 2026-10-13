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

tester.run('no-blank-line-between-imports (groups)', rule, {
  valid: [
    {
      code: stripIndent`
        // library styles must load before the app styles
        import '@vidstack/react/player/styles/base.css';
        import '@xyflow/react/dist/style.css';

        import * as Tooltip from '@radix-ui/react-tooltip';
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
        import { MotionConfig } from 'motion/react';

        import '../index.css';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
    },
    {
      code: stripIndent`
        import foo from 'foo';

        // app styles
        import './app.css';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
    },
    {
      code: stripIndent`
        import './a.css';

        import './b.svg';
      `,
      options: [{ groups: [String.raw`\.css$`, String.raw`\.svg$`] }],
    },
    {
      // the first matching pattern wins, so CSS modules form their own group
      code: stripIndent`
        import styles from './app.module.css';

        import './app.css';
      `,
      options: [{ groups: [String.raw`\.module\.css$`, String.raw`\.css$`] }],
    },
    {
      code: stripIndent`
        import foo from 'foo';

        // app styles

        import './app.css';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
    },
  ],
  invalid: [
    {
      // a broader pattern listed first swallows the narrower one
      code: stripIndent`
        import styles from './app.module.css';

        import './app.css';
      `,
      output: stripIndent`
        import styles from './app.module.css';
        import './app.css';
      `,
      options: [{ groups: [String.raw`\.css$`, String.raw`\.module\.css$`] }],
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import foo from 'foo';

        import './app.css';
      `,
      output: stripIndent`
        import foo from 'foo';
        import './app.css';
      `,
      options: [{ groups: [] }],
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import './a.css';
        // comment inside a group

        import './b.css';
      `,
      output: stripIndent`
        import './a.css';
        // comment inside a group
        import './b.css';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import './a.css';

        import './b.css';
      `,
      output: stripIndent`
        import './a.css';
        import './b.css';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import './a.css';

        import foo from 'foo';

        import bar from 'bar';
      `,
      output: stripIndent`
        import './a.css';

        import foo from 'foo';
        import bar from 'bar';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
    {
      code: stripIndent`
        import foo from 'foo';

        import './app.css';
      `,
      output: stripIndent`
        import foo from 'foo';
        import './app.css';
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
    {
      code: stripIndent`
        import type { Foo } from 'foo';
        import { bar } from 'bar';

        import type { Theme } from './theme.css';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
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
    {
      code: stripIndent`
        import type { Foo } from 'foo';

        import { bar } from 'bar';
      `,
      output: stripIndent`
        import type { Foo } from 'foo';
        import { bar } from 'bar';
      `,
      options: [{ groups: [String.raw`\.css$`] }],
      errors: [{ messageId: 'blankLineBetweenImports' }],
    },
  ],
});
