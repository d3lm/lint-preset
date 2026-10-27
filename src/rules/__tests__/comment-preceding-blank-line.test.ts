import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import { parser as tsParser } from 'typescript-eslint';
import rule from '../comment-preceding-blank-line.js';

const tester = new RuleTester();

const tsTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
  },
});

tester.run('comment-preceding-blank-line', rule, {
  valid: [
    `// first line\nconst a = 1;`,
    {
      code: stripIndent`
        const a = 1;

        // comment
        const b = 2;
      `,
    },
    `const a = 1; // inline`,
    {
      code: stripIndent`
        function foo() {
          // first in block
          return 1;
        }
      `,
    },
    {
      code: stripIndent`
        const result = arr
          .filter(x => x > 0)
          // keep only even
          .filter(x => x % 2 === 0);
      `,
    },
    {
      code: stripIndent`
        const obj = {
          // first in object
          a: 1,
        };
      `,
    },
    {
      code: stripIndent`
        const arr = [
          // first in array
          1,
          2,
        ];
      `,
    },
    {
      code: stripIndent`
        const obj = {
          a: {},
          // foo
          b: {},
        };
      `,
      options: [{ allowInObjects: true }],
    },
    {
      code: stripIndent`
        const arr = [
          1,
          // second
          2,
        ];
      `,
      options: [{ allowInArrays: true }],
    },
    {
      code: stripIndent`
        foo({
          a: 1,
          // mid-object
          b: 2,
        });
      `,
      options: [{ allowInObjects: true }],
    },
    {
      code: stripIndent`
        import foo from 'foo';
        // between imports
        import bar from 'bar';
      `,
    },
    stripIndent`
      /**
       * Some comment.
       */

      /**
       * Some other comment.
       */
    `,
    {
      code: stripIndent`
        function foo() {
          /**
           * Some comment.
           */
          // a line comment may follow a multi-line comment at block start
          return 1;
        }
      `,
    },
    {
      code: stripIndent`
        function foo() {
          /* Single-line block. */
          /**
           * Multi-line block.
           */
          return 1;
        }
      `,
    },
  ],
  invalid: [
    {
      code: stripIndent`
        import foo from 'foo';
        // not between two imports
        const a = foo;
      `,
      output: stripIndent`
        import foo from 'foo';

        // not between two imports
        const a = foo;
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        import {
          a,
          // inside a single import
          b,
        } from 'foo';
      `,
      output: stripIndent`
        import {
          a,

          // inside a single import
          b,
        } from 'foo';
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        const a = 1;
        // this needs a blank line
        const b = 2;
      `,
      output: stripIndent`
        const a = 1;

        // this needs a blank line
        const b = 2;
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        foo.bar().baz();
        // not inside the chain
        const next = 1;
      `,
      output: stripIndent`
        foo.bar().baz();

        // not inside the chain
        const next = 1;
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        arr.map(function () {
        doThing();
        // nested in a callback body, not a chain gap
        doOther();
        });
      `,
      output: stripIndent`
        arr.map(function () {
        doThing();

        // nested in a callback body, not a chain gap
        doOther();
        });
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        const obj = {
          a: {},
          // foo
          b: {},
        };
      `,
      output: stripIndent`
        const obj = {
          a: {},

          // foo
          b: {},
        };
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      // allowInObjects must not relax the rule for arrays
      code: stripIndent`
        const arr = [
          1,
          // second
          2,
        ];
      `,
      options: [{ allowInObjects: true }],
      output: stripIndent`
        const arr = [
          1,

          // second
          2,
        ];
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      // allowInArrays must not relax the rule for objects
      code: stripIndent`
        const obj = {
          a: {},
          // foo
          b: {},
        };
      `,
      options: [{ allowInArrays: true }],
      output: stripIndent`
        const obj = {
          a: {},

          // foo
          b: {},
        };
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        function foo() {
          doThing();
          // mid-block comment keeps its indentation when fixed
          doOther();
        }
      `,
      output: stripIndent`
        function foo() {
          doThing();

          // mid-block comment keeps its indentation when fixed
          doOther();
        }
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      // the comment that opens a file is otherwise exempt
      code: stripIndent`
        /**
         * Some comment.
         */
        /**
         * Some other comment.
         */
      `,
      output: stripIndent`
        /**
         * Some comment.
         */

        /**
         * Some other comment.
         */
      `,
      errors: [{ messageId: 'missingBlankLine', line: 4 }],
    },
    {
      code: stripIndent`
        function foo() {
          /**
           * First.
           */
          /**
           * Second.
           */
          return 1;
        }
      `,
      output: stripIndent`
        function foo() {
          /**
           * First.
           */

          /**
           * Second.
           */
          return 1;
        }
      `,
      errors: [{ messageId: 'missingBlankLine', line: 5 }],
    },
    {
      code: stripIndent`
        const obj = {
          a: 1,
          /**
           * First.
           */
          /**
           * Second.
           */
          b: 2,
        };
      `,
      options: [{ allowInObjects: true }],
      output: stripIndent`
        const obj = {
          a: 1,
          /**
           * First.
           */

          /**
           * Second.
           */
          b: 2,
        };
      `,
      errors: [{ messageId: 'missingBlankLine', line: 6 }],
    },
  ],
});

tsTester.run('comment-preceding-blank-line (typescript)', rule, {
  valid: [
    {
      code: stripIndent`
        interface EditorLayout {
          editorHostRef: RefObject<HTMLDivElement | null>;
          /**
           * Monaco onMount handler factory keyed by tab id
           */
          handleMount(id: string): OnMount;
        }
      `,
      options: [{ allowInInterfaces: true }],
    },
    {
      code: stripIndent`
        type EditorLayout = {
          editorHostRef: RefObject<HTMLDivElement | null>;
          // handler factory keyed by tab id
          handleMount(id: string): OnMount;
        };
      `,
      options: [{ allowInInterfaces: true }],
    },
    {
      code: stripIndent`
        export type MediaInfo =
          // a cropped generation shows its crop, with the details of its generation
          | { kind: 'image-generation'; generation: ImageGeneration; crop?: ImageCrop | null }
          | { kind: 'video-generation'; generation: VideoGeneration }
          | { kind: 'asset'; source: AssetSource; dimensions: AssetDimensions | null };
      `,
    },
    {
      code: stripIndent`
        interface Media {
          kind:
            // leading comment in a property type
            | 'image'
            | 'video';
        }
      `,
    },
    {
      code: stripIndent`
        type Kinds = Array<
          // leading comment in a type argument
          | 'image'
          | 'video'
        >;
      `,
    },
    {
      code: stripIndent`
        type Merged =
          // leading comment in an intersection
          & { a: 1 }
          & { b: 2 };
      `,
    },
    {
      code: stripIndent`
        type MediaInfo =
          | { kind: 'image' }
          // describes the video member
          | { kind: 'video' }
          // describes the asset member
          | { kind: 'asset' };
      `,
      options: [{ allowInUnions: true }],
    },
    {
      code: stripIndent`
        type Merged =
          & { a: 1 }
          // describes the second member
          & { b: 2 };
      `,
      options: [{ allowInUnions: true }],
    },
  ],
  invalid: [
    {
      code: stripIndent`
        type MediaInfo =
          | { kind: 'image' }
          // needs a blank line without the option
          | { kind: 'video' };
      `,
      output: stripIndent`
        type MediaInfo =
          | { kind: 'image' }

          // needs a blank line without the option
          | { kind: 'video' };
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      // allowInInterfaces must not relax the rule for unions
      code: stripIndent`
        type MediaInfo =
          | { kind: 'image' }
          // still needs a blank line
          | { kind: 'video' };
      `,
      options: [{ allowInInterfaces: true }],
      output: stripIndent`
        type MediaInfo =
          | { kind: 'image' }

          // still needs a blank line
          | { kind: 'video' };
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      // allowInUnions must not relax the rule for members inside a union's object type
      code: stripIndent`
        type MediaInfo =
          | {
              kind: 'image';
              // still needs a blank line
              crop: ImageCrop;
            }
          | { kind: 'video' };
      `,
      options: [{ allowInUnions: true }],
      output: stripIndent`
        type MediaInfo =
          | {
              kind: 'image';

              // still needs a blank line
              crop: ImageCrop;
            }
          | { kind: 'video' };
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        interface EditorLayout {
          editorHostRef: RefObject<HTMLDivElement | null>;
          // needs a blank line without the option
          handleMount(id: string): OnMount;
        }
      `,
      output: stripIndent`
        interface EditorLayout {
          editorHostRef: RefObject<HTMLDivElement | null>;

          // needs a blank line without the option
          handleMount(id: string): OnMount;
        }
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      // allowInObjects must not relax the rule for interfaces
      code: stripIndent`
        interface EditorLayout {
          editorHostRef: RefObject<HTMLDivElement | null>;
          // still needs a blank line
          handleMount(id: string): OnMount;
        }
      `,
      options: [{ allowInObjects: true }],
      output: stripIndent`
        interface EditorLayout {
          editorHostRef: RefObject<HTMLDivElement | null>;

          // still needs a blank line
          handleMount(id: string): OnMount;
        }
      `,
      errors: [{ messageId: 'missingBlankLine' }],
    },
    {
      code: stripIndent`
        interface EditorLayout {
          /**
           * First.
           */
          /**
           * Second.
           */
          handleMount(id: string): OnMount;
        }
      `,
      options: [{ allowInInterfaces: true }],
      output: stripIndent`
        interface EditorLayout {
          /**
           * First.
           */

          /**
           * Second.
           */
          handleMount(id: string): OnMount;
        }
      `,
      errors: [{ messageId: 'missingBlankLine', line: 5 }],
    },
  ],
});
