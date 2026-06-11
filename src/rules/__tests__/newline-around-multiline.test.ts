import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import rule from '../newline-around-multiline.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run('newline-around-multiline', rule, {
  valid: [
    `const a = 1;\nconst b = 2;`,
    {
      code: stripIndent`
        const a = 1;

        const obj = {
          a: 1,
          b: 2,
        };

        const b = 2;
      `,
    },
    {
      code: stripIndent`
        function foo() {
          const obj = {
            a: 1,
          };

          return obj;
        }
      `,
    },
    {
      code: stripIndent`
        function foo() {
          const a = 1;

          const obj = {
            a: 1,
          };
        }
      `,
    },
    {
      code: stripIndent`
        class Foo {
          a = 1;
          b = 2;
        }
      `,
    },
    {
      code: stripIndent`
        class Foo {
          method() {
            return 1;
          }
        }
      `,
    },
    {
      code: stripIndent`
        class Foo {
          method1() {}

          method2() {}
        }
      `,
    },
    {
      code: stripIndent`
        class Foo {
          a = 1;

          method() {}
        }
      `,
    },
    {
      code: stripIndent`
        switch (x) {
          case 1:
            doThing();
            break;
        }
      `,
    },
    {
      code: stripIndent`
        switch (x) {
          case 1:
            const o = {
              a: 1,
            };

            break;
        }
      `,
    },
    {
      code: stripIndent`
        class Foo {
          static {
            const a = 1;

            const o = {
              a: 1,
            };
          }
        }
      `,
    },
    {
      code: stripIndent`
        import { a } from 'a';
        import {
          b,
          c,
        } from 'b';
        import { d } from 'd';
      `,
    },
    {
      code: stripIndent`
        import {
          a,
          b,
        } from 'a';
        const x = 1;
      `,
    },
    {
      code: stripIndent`
        export { a } from 'a';
        export {
          b,
          c,
        } from 'b';
        export * from 'd';
      `,
    },
    {
      code: stripIndent`
        const a = 1;
        const b = 2;
        export {
          a,
          b,
        };
        const x = 1;
      `,
    },
  ],
  invalid: [
    {
      code: stripIndent`
        const a = 1;
        const obj = {
          a: 1,
          b: 2,
        };
      `,
      output: stripIndent`
        const a = 1;

        const obj = {
          a: 1,
          b: 2,
        };
      `,
      errors: [{ messageId: 'missingBlankBefore' }],
    },
    {
      code: stripIndent`
        const obj = {
          a: 1,
          b: 2,
        };
        const a = 1;
      `,
      output: stripIndent`
        const obj = {
          a: 1,
          b: 2,
        };

        const a = 1;
      `,
      errors: [{ messageId: 'missingBlankAfter' }],
    },
    {
      code: stripIndent`
        const a = 1;
        const obj = {
          a: 1,
        };
        const b = 2;
      `,
      output: stripIndent`
        const a = 1;

        const obj = {
          a: 1,
        };

        const b = 2;
      `,
      errors: [{ messageId: 'missingBlankBefore' }, { messageId: 'missingBlankAfter' }],
    },
    {
      code: stripIndent`
        class Foo {
          method1() {}
          method2() {}
        }
      `,
      output: stripIndent`
        class Foo {
          method1() {}

          method2() {}
        }
      `,
      errors: [{ messageId: 'missingBlankAfter' }, { messageId: 'missingBlankBefore' }],
    },
    {
      code: stripIndent`
        class Foo {
          a = 1;
          method() {}
        }
      `,
      output: stripIndent`
        class Foo {
          a = 1;

          method() {}
        }
      `,
      errors: [{ messageId: 'missingBlankBefore' }],
    },
    {
      code: stripIndent`
        class Foo {
          method() {}
          a = 1;
        }
      `,
      output: stripIndent`
        class Foo {
          method() {}

          a = 1;
        }
      `,
      errors: [{ messageId: 'missingBlankAfter' }],
    },
    {
      code: stripIndent`
        class Foo {
          static {
            x = 1;
          }
          method() {}
        }
      `,
      output: stripIndent`
        class Foo {
          static {
            x = 1;
          }

          method() {}
        }
      `,
      errors: [{ messageId: 'missingBlankAfter' }, { messageId: 'missingBlankBefore' }],
    },
    {
      code: stripIndent`
        switch (x) {
          case 1:
            const o = {
              a: 1,
            };
            break;
        }
      `,
      output: stripIndent`
        switch (x) {
          case 1:
            const o = {
              a: 1,
            };

            break;
        }
      `,
      errors: [{ messageId: 'missingBlankAfter' }],
    },
    {
      code: stripIndent`
        class Foo {
          static {
            const a = 1;
            const o = {
              a: 1,
            };
          }
        }
      `,
      output: stripIndent`
        class Foo {
          static {
            const a = 1;

            const o = {
              a: 1,
            };
          }
        }
      `,
      errors: [{ messageId: 'missingBlankBefore' }],
    },
    {
      code: stripIndent`
        const a = 1;
        export const obj = {
          a: 1,
        };
      `,
      output: stripIndent`
        const a = 1;

        export const obj = {
          a: 1,
        };
      `,
      errors: [{ messageId: 'missingBlankBefore' }],
    },
  ],
});
