import stylisticPlugin from '@stylistic/eslint-plugin';
import { stripIndent } from 'common-tags';
import { Linter, RuleTester } from 'eslint';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import { jsdocTagLineOptions, jsRulesOxlint, paddingLineEntries } from '../javascript.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

tester.run(
  'javascript padding-line-between-statements config',
  stylisticPlugin.rules['padding-line-between-statements'],
  {
    valid: [
      {
        code: stripIndent`
          const first = 1;
          const second = 2;
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          let first = 1;
          let second = 2;
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          const result = await host.api.readDirectory(path, processPid);

          set((state) => mutate.applyDirectory(state, result));
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          let result = await host.api.readDirectory(path, processPid);

          set((state) => mutate.applyDirectory(state, result));
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          expect(row.stateRevision).toBeGreaterThanOrEqual(lastStateRevision);

          lastStateRevision = row.stateRevision;
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          first = 1;
          second = 2;

          track(first, second);
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          track(first);
          track(second);
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          for (const item of items) {
            if (item.skip) {
              continue;
            }

            if (item.last) {
              track(item);

              break;
            }
          }
        `,
        options: paddingLineEntries,
      },
      {
        code: stripIndent`
          switch (kind) {
            case 'first':
              break;
            case 'second':
              track(kind);

              break;
          }
        `,
        options: paddingLineEntries,
      },
    ],
    invalid: [
      {
        code: stripIndent`
          expect(row.stateRevision).toBeGreaterThanOrEqual(lastStateRevision);
          lastStateRevision = row.stateRevision;
        `,
        output: stripIndent`
          expect(row.stateRevision).toBeGreaterThanOrEqual(lastStateRevision);

          lastStateRevision = row.stateRevision;
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          lingerTimerRef.current = undefined;
          setHoveredIndex(null);
          setTooltipIndex(null);
        `,
        output: stripIndent`
          lingerTimerRef.current = undefined;

          setHoveredIndex(null);
          setTooltipIndex(null);
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          state.count += 1;
          await flush();
        `,
        output: stripIndent`
          state.count += 1;

          await flush();
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          await flush();
          state.count += 1;
        `,
        output: stripIndent`
          await flush();

          state.count += 1;
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          const result = await host.api.readDirectory(path, processPid);
          set((state) => mutate.applyDirectory(state, result));
        `,
        output: stripIndent`
          const result = await host.api.readDirectory(path, processPid);

          set((state) => mutate.applyDirectory(state, result));
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          let result = await host.api.readDirectory(path, processPid);
          set((state) => mutate.applyDirectory(state, result));
        `,
        output: stripIndent`
          let result = await host.api.readDirectory(path, processPid);

          set((state) => mutate.applyDirectory(state, result));
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          for (const item of items) {
            index = item.last;
            continue;
          }
        `,
        output: stripIndent`
          for (const item of items) {
            index = item.last;

            continue;
          }
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
      {
        code: stripIndent`
          switch (kind) {
            case 'first':
              track(kind);
              break;
          }
        `,
        output: stripIndent`
          switch (kind) {
            case 'first':
              track(kind);

              break;
          }
        `,
        options: paddingLineEntries,
        errors: [{ messageId: 'expectedBlankLine' }],
      },
    ],
  },
);

describe('javascript no-return-assign config', () => {
  const linter = new Linter();
  const rules = { 'no-return-assign': jsRulesOxlint()['no-return-assign'] };
  const lint = (code: string) => linter.verify(code, { rules }).map((message) => message.messageId);

  it('allows assigning before returning', () => {
    expect(
      lint(stripIndent`
        function reject(error) {
          this.body = Promise.reject(error);

          return this.body;
        }
      `),
    ).toEqual([]);
  });

  it('forbids parenthesized assignments in return statements', () => {
    expect(lint('function reject(error) { return (this.body = Promise.reject(error)); }')).toEqual([
      'returnAssignment',
    ]);
  });

  it('forbids assignments as arrow function bodies', () => {
    expect(lint('const assign = (value) => (target.value = value);')).toEqual(['arrowAssignment']);
  });
});

const tagLinesRule = jsdocPlugin.rules?.['tag-lines'];

if (!tagLinesRule) {
  throw new Error('eslint-plugin-jsdoc is missing the tag-lines rule');
}

tester.run('javascript jsdoc tag-lines config', tagLinesRule, {
  valid: [
    {
      code: stripIndent`
        class LazyIndexStream {
          /** @internal */
          constructor(inner) {
            this.inner = inner;
          }
        }
      `,
      options: jsdocTagLineOptions,
    },
    {
      code: stripIndent`
        /**
         * Copies a file to a new location.
         *
         * @param source - The file to copy.
         * @param overwrite - Whether an existing file at the destination is replaced, which is off by default
         * so that a typo never destroys data.
         * @param foobar - Some other param.
         *
         * Some text here.
         */
        function copy(source, overwrite, foobar) {
          return [source, overwrite, foobar];
        }
      `,
      options: jsdocTagLineOptions,
    },
    {
      code: stripIndent`
        /**
         * Runs the check.
         *
         * @example
         * check();
         *
         * check({ strict: true });
         * @returns The exit code.
         */
        function check() {
          return 0;
        }
      `,
      options: jsdocTagLineOptions,
    },
  ],
  invalid: [
    {
      code: stripIndent`
        /**
         * @param value
         *
         * @returns value
         */
        function identity(value) {
          return value;
        }
      `,
      output: stripIndent`
        /**
         * @param value
         * @returns value
         */
        function identity(value) {
          return value;
        }
      `,
      options: jsdocTagLineOptions,
      errors: [{ message: 'Expected no lines between tags' }],
    },
    {
      code: stripIndent`
        /**
         * Returns the value.
         * @returns The value.
         */
        function identity(value) {
          return value;
        }
      `,
      output: stripIndent`
        /**
         * Returns the value.
         *
         * @returns The value.
         */
        function identity(value) {
          return value;
        }
      `,
      options: jsdocTagLineOptions,
      errors: [{ message: 'Expected 1 lines after block description' }],
    },
  ],
});
