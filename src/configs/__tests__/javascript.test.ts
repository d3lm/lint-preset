import stylisticPlugin from '@stylistic/eslint-plugin';
import { stripIndent } from 'common-tags';
import { RuleTester } from 'eslint';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import { jsdocTagLineOptions, paddingLineEntries } from '../javascript.js';

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
    ],
  },
);

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
  ],
  invalid: [
    {
      code: stripIndent`
        /**
         * @param value
         * @returns value
         */
        function identity(value) {
          return value;
        }
      `,
      output: stripIndent`
        /**
         * @param value
         *
         * @returns value
         */
        function identity(value) {
          return value;
        }
      `,
      options: jsdocTagLineOptions,
      errors: [{ message: 'Expected 1 line between tags but found 0' }],
    },
  ],
});
