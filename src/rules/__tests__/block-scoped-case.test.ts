import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import rule from '../block-scoped-case.js';

const tester = new RuleTester();

tester.run('block-scoped-case', rule, {
  valid: [
    {
      code: stripIndent`
        switch (x) {
          case 1: {
            break;
          }
        }
      `,
    },
    {
      code: stripIndent`
        switch (x) {
          case 1:
          case 2: {
            break;
          }
        }
      `,
    },
    {
      code: stripIndent`
        switch (x) {
          default: {
            break;
          }
        }
      `,
    },
  ],
  invalid: [
    {
      code: stripIndent`
        switch (x) {
          case 1:
            console.log(1);
            break;
        }
      `,
      output: stripIndent`
        switch (x) {
          case 1: {
            console.log(1);
            break;
          }
        }
      `,
      errors: [{ messageId: 'missingBlock' }],
    },
    {
      code: stripIndent`
        switch (x) {
          default:
            console.log('default');
            break;
        }
      `,
      output: stripIndent`
        switch (x) {
          default: {
            console.log('default');
            break;
          }
        }
      `,
      errors: [{ messageId: 'missingBlock' }],
    },
    {
      // entire body on the colon line must be preserved (not wiped to an empty block)
      code: stripIndent`
        switch (x) {
          case 1: console.log(1); break;
        }
      `,
      output: stripIndent`
        switch (x) {
          case 1: {
            console.log(1); break;
          }
        }
      `,
      errors: [{ messageId: 'missingBlock' }],
    },
    {
      // first statement shares the colon line; following statements must be kept
      code: stripIndent`
        switch (x) {
          case 1: console.log(1);
            break;
        }
      `,
      output: stripIndent`
        switch (x) {
          case 1: {
            console.log(1);
            break;
          }
        }
      `,
      errors: [{ messageId: 'missingBlock' }],
    },
    {
      // nested indentation inside the body is preserved
      code: stripIndent`
        switch (x) {
          case 1:
            foo({
              a: 1,
            });
            break;
        }
      `,
      output: stripIndent`
        switch (x) {
          case 1: {
            foo({
              a: 1,
            });
            break;
          }
        }
      `,
      errors: [{ messageId: 'missingBlock' }],
    },
  ],
});
