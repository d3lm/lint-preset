import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import rule from '../comment-syntax.js';

const tester = new RuleTester();

tester.run('comment-syntax', rule, {
  valid: [
    `/* This is a valid comment. */`,
    `// this is fine`,
    `// TODO refactor this`,
    `// eslint-disable-next-line`,
    `// see https://example.com/path`,
    `// API response handler`,
    `// @ts-expect-error`,
    `/* */`,
    `/** @internal */`,
    stripIndent`
      /**
       * First paragraph.
       *
       * Second paragraph.
       */
    `,
    stripIndent`
      /**
       * Describes the thing.
       *
       * @param x - The x.
       * @returns The result.
       */
    `,
    stripIndent`
      /**
       * Example:
       *
       * \`\`\`ts
       * const foo = 1
       * \`\`\`
       */
    `,
    `// wait for it...`,
    `// many things, e.g.`,
    {
      code: `// see https://x.com`,
      options: [{ ignoreDirectives: false }],
    },
    {
      code: `/* iPhone support is added. */`,
      options: [{ ignoredWords: ['iPhone'] }],
    },
    {
      code: `// proprietary: here be dragons.`,
      options: [{ ignoredPatterns: ['^proprietary:'] }],
    },
    stripIndent`
      /**
       * Does something.
       *
       * @param x - The x.
       * @param y - The y.
       */
    `,
    stripIndent`
      /**
       * Does something.
       *
       * @param {string} x - The x.
       */
    `,
    stripIndent`
      /**
       * Does something.
       *
       * @param x
       */
    `,
    {
      code: stripIndent`
        /**
         * Does something.
         *
         * @param x The x.
         */
      `,
      options: [{ block: { enforceParamStyle: false } }],
    },
  ],
  invalid: [
    {
      code: '/** This is wrong. */',
      output: '/**\n * This is wrong.\n */',
      errors: [{ messageId: 'blockSingleLineJSDoc' }],
    },
    {
      code: '  /** Indented single-line JSDoc. */',
      output: '  /**\n   * Indented single-line JSDoc.\n   */',
      errors: [{ messageId: 'blockSingleLineJSDoc' }],
    },
    {
      code: `/* this is wrong. */`,
      output: `/* This is wrong. */`,
      errors: [{ messageId: 'blockCapital' }],
    },
    {
      code: `/* This is wrong */`,
      output: `/* This is wrong. */`,
      errors: [{ messageId: 'blockTrailingPunctuation' }],
    },
    {
      code: `// This is wrong`,
      output: `// this is wrong`,
      errors: [{ messageId: 'lineLowercase' }],
    },
    {
      code: `// this is wrong.`,
      output: `// this is wrong`,
      errors: [{ messageId: 'lineTrailingPunctuation' }],
    },
    {
      code: `//this is wrong`,
      output: `// this is wrong`,
      errors: [{ messageId: 'lineLeadingSpace' }],
    },
    {
      code: stripIndent`
        /**
         * bad paragraph.
         */
      `,
      output: stripIndent`
        /**
         * Bad paragraph.
         */
      `,
      errors: [{ messageId: 'blockParagraphCapital' }],
    },
    {
      code: stripIndent`
        /**
         * Missing ending
         */
      `,
      errors: [{ messageId: 'blockParagraphEnding' }],
    },
    {
      code: stripIndent`
        /**
         *Missing space.
         */
      `,
      output: stripIndent`
        /**
         * Missing space.
         */
      `,
      errors: [{ messageId: 'blockLineSpaceAfterStar' }],
    },
    {
      code: stripIndent`
        /**
         * Description line.
         * @param x - Bad spacing.
         */
      `,
      errors: [{ messageId: 'blockJSDocBlankLine' }],
    },
    {
      code: `// This is fine.`,
      output: `// this is fine.`,
      options: [{ line: { forbidTrailingPunctuation: false } }],
      errors: [{ messageId: 'lineLowercase' }],
    },
    {
      code: stripIndent`
        /**
         * Does something.
         *
         * @param x The x.
         */
      `,
      output: stripIndent`
        /**
         * Does something.
         *
         * @param x - The x.
         */
      `,
      errors: [{ messageId: 'paramMissingDash' }],
    },
    {
      code: stripIndent`
        /**
         * Does something.
         *
         * @param x - The x
         */
      `,
      output: stripIndent`
        /**
         * Does something.
         *
         * @param x - The x.
         */
      `,
      errors: [{ messageId: 'paramDescriptionPeriod' }],
    },
    {
      code: stripIndent`
        /**
         * Does something.
         *
         * @param {string} x The x.
         */
      `,
      output: stripIndent`
        /**
         * Does something.
         *
         * @param {string} x - The x.
         */
      `,
      errors: [{ messageId: 'paramMissingDash' }],
    },
    {
      code: stripIndent`
        /**
         * Does something.
         *
         * @param x Foo.
         * @param y Bar
         */
      `,
      output: stripIndent`
        /**
         * Does something.
         *
         * @param x - Foo.
         * @param y - Bar
         */
      `,
      errors: [{ messageId: 'paramMissingDash' }, { messageId: 'paramMissingDash' }],
    },
  ],
});
