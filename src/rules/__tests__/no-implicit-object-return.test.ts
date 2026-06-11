import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import rule from '../no-implicit-object-return.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

tester.run('no-implicit-object-return', rule, {
  valid: [
    // block body with an explicit return is exactly what we want to allow
    'const f = () => { return {}; };',
    'const f = () => { return { a: 1 }; };',

    // non-object concise bodies stay flexible
    'const f = () => foo();',
    'const f = () => 42;',
    'const f = (x) => x;',
    'const f = () => [1, 2, 3];',

    // a block whose first statement opens with `{` is not a concise object body
    'const f = () => { ({ a: 1 }); };',

    // the object literal is nested inside the body, not the body itself
    'const f = (x) => (x ? foo() : { a: 1 });',

    // regular functions can never use a concise body
    'const f = function () { return {}; };',

    // JSX concise returns are a different node (JSXElement / JSXFragment), not objects
    'const App = () => <div />;',
    'const App = () => (<div />);',
    'const App = () => <>{children}</>;',
    stripIndent`
      const App = () => (
        <div>
          <span>hi</span>
        </div>
      );
    `,
  ],
  invalid: [
    {
      code: 'const f = () => ({});',
      output: 'const f = () => { return {}; };',
      errors: [{ messageId: 'implicitObjectReturn' }],
    },
    {
      code: 'const f = () => ({ a: 1 });',
      output: 'const f = () => { return { a: 1 }; };',
      errors: [{ messageId: 'implicitObjectReturn' }],
    },
    {
      code: 'const f = (x) => ({ a: x });',
      output: 'const f = (x) => { return { a: x }; };',
      errors: [{ messageId: 'implicitObjectReturn' }],
    },
    {
      code: 'const f = async () => ({ a: 1 });',
      output: 'const f = async () => { return { a: 1 }; };',
      errors: [{ messageId: 'implicitObjectReturn' }],
    },
    {
      code: stripIndent`
        const f = () => ({
          a: 1,
          b: 2,
        });
      `,
      output: stripIndent`
        const f = () => { return {
          a: 1,
          b: 2,
        }; };
      `,
      errors: [{ messageId: 'implicitObjectReturn' }],
    },
  ],
});
