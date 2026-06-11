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
  ],
  invalid: [
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
  ],
  invalid: [
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
  ],
});
