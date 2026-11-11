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
    stripIndent`
      /**
       * Wraps a line with \`the\`
       * code span in the middle of a paragraph.
       */
    `,
    stripIndent`
      /**
       * Prints the rewrap of a comment, for example:
       *
       *   \`comments wrap src/a.ts:42\`
       */
    `,
    stripIndent`
      /**
       * Runs the default command:
       *
       * \`comments check\`
       */
    `,
    stripIndent`
      /**
       * Installs the package:
       *
       *   npm install foo
       *   pnpm add foo
       */
    `,
    stripIndent`
      /**
       * Parses the source.
       *
       * @param options - The options object that configures how the parser handles
       * comments and their surrounding whitespace.
       * @returns The parsed program.
       */
    `,
    stripIndent`
      /**
       * Parses the source.
       *
       * @returns The parsed program, with comments and their surrounding whitespace
       * attached to the nodes
       * @throws When the source has a syntax error.
       */
    `,
    stripIndent`
      /**
       * Copies a file to a new location.
       *
       * @param source - The file to copy.
       * @param overwrite - Whether an existing file at the destination is replaced, which is off by default
       * so that a typo never destroys data.
       * @param foobar - Some other param.
       *
       *   Some indented text here.
       */
    `,
    stripIndent`
      /**
       * Picks the mode.
       *
       * @param mode - The mode to use:
       *   - \`a\` runs fast and has a description that wraps
       *     onto another line
       *   1. \`b\` runs slow.
       */
    `,
    stripIndent`
      /**
       * Runs the check.
       *
       * @example
       *   check({ strict: true });
       * @defaultValue
       *   { strict: false }
       */
    `,
    {
      code: stripIndent`
        /**
         * Does something.
         *
         * @returns The result that wraps
         *   onto another line.
         */
      `,
      options: [{ block: { forbidTagIndent: false } }],
    },
    stripIndent`
      /**
       * A shortcut modifier.
       *
       * - Some list item
       * - Another list item
       */
    `,
    stripIndent`
      /**
       * A shortcut modifier.
       *
       *  - Some list item
       *  - Another list item
       */
    `,
    stripIndent`
      /**
       * Steps:
       *
       * 1. First step
       * 2. Second step that wraps onto
       *    another line without punctuation
       */
    `,
    stripIndent`
      /**
       * Whether to ignore key events when focus is in an input, textarea, or contenteditable element.
       *
       * @default true
       */
    `,
    stripIndent`
      /**
       * Does something.
       *
       * @returns The result that wraps
       * onto another line without punctuation
       */
    `,
    `// wait for it...`,
    `// many things, e.g.`,
    `// I think this is fine`,
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
    {
      code: stripIndent`
        /*
         * Hi.
         */
      `,
      options: [{ block: { requireJSDocOpening: false } }],
    },
    `#!/usr/bin/env node\nconsole.log('hi');`,
    `#!/usr/bin/env -S node --enable-source-maps\nconsole.log('hi');`,
    `// ${'a'.repeat(117)}`,
    `// see https://example.com/${'a'.repeat(120)}`,
    `// @ts-expect-error ${'a'.repeat(120)}`,
    {
      code: `// ${'a'.repeat(150)}`,
      options: [{ line: { maxLength: 200 } }],
    },
    `/* A ${'a'.repeat(150)}. */`,
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
      code: '/** See https://example.com for details. */',
      output: '/**\n * See https://example.com for details.\n */',
      errors: [{ messageId: 'blockSingleLineJSDoc' }],
    },
    {
      code: '/** proprietary: here be dragons. */',
      output: '/**\n * proprietary: here be dragons.\n */',
      options: [{ ignoredPatterns: ['proprietary:'] }],
      errors: [{ messageId: 'blockSingleLineJSDoc' }],
    },
    {
      code: 'const x = 1; /** Trailing JSDoc. */',
      errors: [{ messageId: 'blockSingleLineJSDoc' }],
    },
    {
      code: `/* this is wrong. */`,
      output: `/* This is wrong. */`,
      errors: [{ messageId: 'blockCapital' }],
    },
    {
      code: stripIndent`
        /*
         * Hi.
         */
      `,
      output: stripIndent`
        /**
         * Hi.
         */
      `,
      errors: [{ messageId: 'blockJSDocOpening' }],
    },
    {
      code: '/* First line has text.\n   More text. */',
      output: '/** First line has text.\n   More text. */',
      errors: [{ messageId: 'blockJSDocOpening' }],
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
      code: `// A too-old Node.js still gets a working TUI when Bun is around`,
      output: `// a too-old Node.js still gets a working TUI when Bun is around`,
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
         * Ends with a code span like \`the\`
         */
      `,
      errors: [{ messageId: 'blockParagraphEnding' }],
    },
    {
      code: stripIndent`
        /**
         * Falls back to the default value when nothing is passed, which is
         * \`undefined\`
         */
      `,
      errors: [{ messageId: 'blockParagraphEnding' }],
    },
    {
      code: `/* Ends with a code span like \`the\` */`,
      output: `/* Ends with a code span like \`the\`. */`,
      errors: [{ messageId: 'blockTrailingPunctuation' }],
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
         * @param options - The options object that configures how the parser handles
         * comments and their surrounding whitespace
         * @returns The result.
         */
      `,
      output: stripIndent`
        /**
         * Does something.
         *
         * @param options - The options object that configures how the parser handles
         * comments and their surrounding whitespace.
         * @returns The result.
         */
      `,
      errors: [{ messageId: 'paramDescriptionPeriod' }],
    },
    {
      code: stripIndent`
        /**
         * Does something.
         * @param x - The x, which continues
         * on the next line.
         * @returns The result.
         */
      `,
      errors: [{ messageId: 'blockJSDocBlankLine' }],
    },
    {
      code: stripIndent`
        /**
         * Copies a file to a new location.
         *
         * @param source - The file to copy.
         * @param overwrite - Whether an existing file at the destination is replaced, which is off by default
         *   so that a typo never destroys data.
         * @returns Whether the file was copied, which is false when the destination exists and
         *    \`overwrite\` is off, or when the source
         *  is missing.
         */
      `,
      output: stripIndent`
        /**
         * Copies a file to a new location.
         *
         * @param source - The file to copy.
         * @param overwrite - Whether an existing file at the destination is replaced, which is off by default
         * so that a typo never destroys data.
         * @returns Whether the file was copied, which is false when the destination exists and
         * \`overwrite\` is off, or when the source
         * is missing.
         */
      `,
      errors: [
        { messageId: 'tagContinuationIndent' },
        { messageId: 'tagContinuationIndent' },
        { messageId: 'tagContinuationIndent' },
      ],
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
    {
      code: `// ${'a'.repeat(118)}`,
      errors: [{ messageId: 'lineMaxLength', data: { maxLength: '120' } }],
    },
    {
      code: `const x = 1; // ${'a'.repeat(110)}`,
      errors: [{ messageId: 'lineMaxLength' }],
    },
    {
      code: `// TODO ${'a'.repeat(120)}`,
      errors: [{ messageId: 'lineMaxLength' }],
    },
    {
      code: `// ${'a'.repeat(80)}`,
      options: [{ line: { maxLength: 80 } }],
      errors: [{ messageId: 'lineMaxLength', data: { maxLength: '80' } }],
    },
  ],
});
