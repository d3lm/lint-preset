import { stripIndent } from 'common-tags';
import {
  analyzeSource,
  codeFingerprint,
  hasVerdictIssues,
  inspectSource,
  isSuspicious,
  rewrapComment,
  type AnalyzeOptions,
} from '../analyze.js';
import { randomComments } from './helpers/random-comments.js';

const options: AnalyzeOptions = { width: 80, tabWidth: 2, tolerance: 0, avoidSentenceOrphans: true, style: true };

function jsdoc(...lines: string[]): string {
  return `/**\n${lines.map((line) => (line ? ` * ${line}` : ' *')).join('\n')}\n */\n`;
}

function indented(source: string): string {
  return source
    .split('\n')
    .map((line) => (line ? `        ${line}` : line))
    .join('\n');
}

function fix(source: string, overrides: Partial<AnalyzeOptions> = {}): string {
  const lines = source.split('\n');
  const comments = analyzeSource(source, 'file.ts', { ...options, ...overrides });

  for (const comment of comments.toReversed()) {
    lines.splice(comment.startLine - 1, comment.endLine - comment.startLine + 1, ...rewrapComment(comment).split('\n'));
  }

  return lines.join('\n');
}

describe('analyzeSource', () => {
  describe('preferred and maximum widths', () => {
    const source = jsdoc(
      'Splits prose into words, keeping backtick code spans and `{...}` groups (JSDoc types,',
      '`{@link ...}`) intact so that they are never broken across lines.',
    );

    it('keeps a parenthetical together past the preferred width', () => {
      const settings = { width: 80, maxWidth: 120 };
      const fixed = fix(source, settings);

      expect(fixed).toBe(
        jsdoc(
          'Splits prose into words, keeping backtick code spans and `{...}` groups (JSDoc types, `{@link ...}`)',
          'intact so that they are never broken across lines.',
        ),
      );

      expect(
        analyzeSource(fixed, 'file.ts', { ...options, ...settings }).some((comment) => hasVerdictIssues(comment)),
      ).toBe(false);

      expect(fix(fixed, settings)).toBe(fixed);
    });

    it('prefers even lines to lines that are only a little fuller', () => {
      const settings = { width: 100, maxWidth: 120 };

      const uneven = jsdoc(
        'These directives are only read from a whole block comment, like `/* global foo *\\/`',
        'or `/* eslint quotes: 1 *\\/`. Their markers are ordinary words, so they never count as',
        'directives on a single line of a longer comment.',
      );

      const even = jsdoc(
        'These directives are only read from a whole block comment, like `/* global foo *\\/`',
        'or `/* eslint quotes: 1 *\\/`. Their markers are ordinary words, so they never count',
        'as directives on a single line of a longer comment.',
      );

      expect(fix(uneven, settings)).toBe(even);
      expect(fix(even, settings)).toBe(even);
    });

    it('moves a parenthetical down when keeping it on the line would exceed the maximum', () => {
      const fixed = fix(source, { width: 80, maxWidth: 90 });

      expect(fixed).toContain('(JSDoc types, `{@link ...}`)');
      expect(fixed.split('\n').every((line) => line.length <= 90)).toBe(true);
      expect(fix(fixed, { width: 80, maxWidth: 90 })).toBe(fixed);
    });

    it('splits parentheticals that cannot fit on a line of their own', () => {
      const long = jsdoc('Keeps (one two three four five six seven eight nine ten eleven twelve) readable.');
      const settings = { width: 30, maxWidth: 40 };
      const fixed = fix(long, settings);

      expect(fixed.split('\n').every((line) => line.length <= 40)).toBe(true);
      expect(fix(fixed, settings)).toBe(fixed);
    });

    it('handles nested parentheses and parentheses inside code spans', () => {
      const nested = jsdoc('Keeps the result (including nested (small) details and `fn(x)`) near its description.');
      const settings = { width: 50, maxWidth: 90 };
      const fixed = fix(nested, settings);

      expect(fixed).toContain('(including nested (small) details and `fn(x)`)');
      expect(fix(fixed, settings)).toBe(fixed);
    });

    it('caps the separate single-line allowance at the hard maximum', () => {
      const text = jsdoc('This prose is longer than the maximum but shorter than the separate single line allowance.');
      const settings = { width: 40, maxWidth: 60, singleLineWidth: 120 };
      const fixed = fix(text, settings);

      expect(fixed.split('\n').every((line) => line.length <= 60)).toBe(true);

      expect(
        analyzeSource(text, 'file.ts', { ...options, ...settings }).some((comment) => hasVerdictIssues(comment)),
      ).toBe(true);
    });

    it('does not let legacy tolerance exceed an explicit hard maximum', () => {
      const source = jsdoc('x'.repeat(36), 'ok');
      const settings = { width: 30, maxWidth: 40, tolerance: 50 };
      const fixed = fix(source, settings);

      expect(fixed.split('\n').every((line) => line.length <= 40)).toBe(true);
      expect(fix(fixed, settings)).toBe(fixed);
    });

    it('reports an indivisible token above the hard maximum without changing it', () => {
      const text = jsdoc(`See https://example.com/${'a'.repeat(80)} for details.`);
      const settings = { width: 60, maxWidth: 80 };
      const fixed = fix(text, settings);
      const report = analyzeSource(fixed, 'file.ts', { ...options, ...settings });

      expect(fixed).toContain(`https://example.com/${'a'.repeat(80)}`);
      expect(report.some((comment) => hasVerdictIssues(comment))).toBe(true);
    });

    it('keeps feasible parenthetical layouts stable across widths and indentation', () => {
      const text = 'Explains the result (including a few details) and continues with enough words for another line.';

      for (const width of [30, 40, 50, 60, 80]) {
        for (const indent of ['', '  ', '\t']) {
          for (const avoidSentenceOrphans of [true, false]) {
            const settings = { width, maxWidth: width + 20, avoidSentenceOrphans };

            const source = jsdoc(text)
              .split('\n')
              .map((line) => (line ? `${indent}${line}` : line))
              .join('\n');

            const fixed = fix(source, settings);
            const reports = analyzeSource(fixed, 'file.ts', { ...options, ...settings });

            expect(reports.flatMap((comment) => comment.paragraphs.flatMap((paragraph) => paragraph.issues))).toEqual(
              [],
            );

            expect(fix(fixed, settings)).toBe(fixed);
            expect(reports[0].lengths.every((length) => length <= settings.maxWidth)).toBe(true);
          }
        }
      }
    });

    it('balances a longer paragraph instead of accepting lines filled to the hard maximum', () => {
      const source = jsdoc(
        'Every output write refuses symlinks. The flow dir is model-influenced, and a prompt-injected round can plant',
        '`results.jsonl -> ~/.bashrc` where the next unattended run would append. POSIX opens O_NOFOLLOW (a symlink fails with',
        'ELOOP). Windows (where Node leaves O_NOFOLLOW undefined and Bun defines a meaningless value) lstat-refuses first.',
        "Symlinked parent dirs are refused the same way. It applies the same discipline as the report builders' reads.",
      );

      const settings = { width: 100, maxWidth: 120 };
      const before = analyzeSource(source, 'file.ts', { ...options, ...settings });
      const fixed = fix(source, settings);
      const lines = fixed.split('\n').slice(1, -2);
      const fullLines = lines.slice(0, -1).map((line) => line.length);

      expect(before.some((comment) => hasVerdictIssues(comment))).toBe(true);
      expect(lines).toHaveLength(5);
      expect(Math.max(...fullLines) - Math.min(...fullLines)).toBeLessThanOrEqual(8);
      expect(lines.every((line) => line.length <= settings.maxWidth)).toBe(true);
      expect(fixed).toContain('(where Node leaves O_NOFOLLOW undefined and Bun defines a meaningless value)');
      expect(fix(fixed, settings)).toBe(fixed);

      expect(
        analyzeSource(fixed, 'file.ts', { ...options, ...settings }).some((comment) => hasVerdictIssues(comment)),
      ).toBe(false);
    });

    it('keeps parenthetical layouts stable in prose, lists, and tag descriptions', () => {
      const text =
        'Explains the result (including the small details) before continuing with several more useful words.';

      for (const width of [50, 80, 100]) {
        for (const marker of ['', '- ', '@returns ']) {
          const settings = { width, maxWidth: width + 20, style: false };
          const fixed = fix(jsdoc(`${marker}${text}`), settings);
          const reports = analyzeSource(fixed, 'file.ts', { ...options, ...settings });

          expect(reports.flatMap((comment) => comment.paragraphs.flatMap((paragraph) => paragraph.issues))).toEqual([]);
          expect(fix(fixed, settings)).toBe(fixed);
        }
      }
    });

    it('tries a fuller balanced layout before accepting the greedy line count', () => {
      const source = jsdoc(
        'Stated plainly, this is a change detector, not a security boundary. The sha, the path',
        'list and this file all live where the loop agent can write, so an agent that is already',
        'prompt-injected can forge the record or pass --approve-harness itself. What it catches is',
        "the common case (a round's harness edit reaching an unattended run unreviewed), and what",
        'actually bounds an unattended run is the permission allowlist the user grants the runner',
        'command (scope it to this exact command line, not a prefix). Installed dependencies beyond',
        'the lockfile are outside the digest.',
      );

      const settings = { width: 100, maxWidth: 120 };
      const before = analyzeSource(source, 'file.ts', { ...options, ...settings });
      const fixed = fix(source, settings);
      const [after] = analyzeSource(fixed, 'file.ts', { ...options, ...settings });
      const lengths = after.lengths.slice(1, -1);

      expect(before.some((comment) => hasVerdictIssues(comment))).toBe(true);
      expect(lengths).toHaveLength(6);
      expect(lengths.slice(0, -1).every((length) => length >= 100 && length <= 120)).toBe(true);
      expect(after.paragraphs.flatMap((paragraph) => paragraph.issues)).toEqual([]);
      expect(fix(fixed, settings)).toBe(fixed);
    });

    describe('tolerance', () => {
      const issuesOf = (source: string, overrides: Partial<AnalyzeOptions>): string[] => {
        return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
          comment.paragraphs.flatMap((paragraph) =>
            paragraph.issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`),
          ),
        );
      };

      const wrapped = indented(
        jsdoc(
          "`EPERM` means the registration was superseded and `EINTR` means the seat's wait queue was cancelled,",
          'and both mean another context tore the seat down and settled everything, so the pump is done.',
          'Anything else is unexpected. The seat then unregisters itself so parked guests settle with `EIO`',
          'instead of queueing forever behind a dead pump, and the loop exits.',
        ),
      );

      const fewer = indented(
        jsdoc(
          "`EPERM` means the registration was superseded and `EINTR` means the seat's wait queue was",
          'cancelled, and both mean another context tore the seat down and settled everything, so the',
          'pump is done. Anything else is unexpected. The seat then unregisters itself so parked guests',
          'settle with `EIO` instead of queueing forever behind a dead pump, and the loop exits.',
        ),
      );

      it('lets lines pass the width by up to the tolerance when that saves a line', () => {
        const settings = { width: 100, maxWidth: 120, tolerance: 5 };
        const [after] = analyzeSource(fewer, 'file.ts', { ...options, ...settings });

        expect(fix(wrapped, settings)).toBe(fewer);
        expect(after.lengths.slice(1, -1)).toEqual([100, 101, 103, 96]);
        expect(after.paragraphs.flatMap((paragraph) => paragraph.issues)).toEqual([]);
        expect(fix(fewer, settings)).toBe(fewer);
      });

      it('wraps to the width without a tolerance', () => {
        const settings = { width: 100, maxWidth: 120 };
        const fixed = fix(wrapped, settings);

        expect(fixed.split('\n').slice(1, -2)).toHaveLength(5);
        expect(fixed.split('\n').every((line) => line.length <= 100)).toBe(true);
      });

      it('never passes the hard maximum, however large the tolerance', () => {
        const settings = { width: 100, maxWidth: 102, tolerance: 50 };
        const fixed = fix(wrapped, settings);

        expect(fixed.split('\n').every((line) => line.length <= 102)).toBe(true);
        expect(fix(fixed, settings)).toBe(fixed);
      });

      describe('the layout for a wider width', () => {
        const settings = { width: 100, maxWidth: 120, tolerance: 5 };

        // the layout for a width of 105, with lines of 105, 104, 103, and 58 columns
        const wider = jsdoc(
          'Implements the bounded queue and lifecycle machinery shared by `RelayDatagram` and `RelayAnyDatagram`.',
          'It owns the client-to-remote queue and its pump, the backend closed watcher, and the idempotent death',
          'path, so a lifecycle fix lands in both channel kinds at once. Only the per-kind frame validation and',
          'the recv-to-frame mapping stay in the concrete classes.',
        );

        // the layout for the width itself
        const preferred = jsdoc(
          'Implements the bounded queue and lifecycle machinery shared by `RelayDatagram` and',
          '`RelayAnyDatagram`. It owns the client-to-remote queue and its pump, the backend closed watcher,',
          'and the idempotent death path, so a lifecycle fix lands in both channel kinds at once. Only the',
          'per-kind frame validation and the recv-to-frame mapping stay in the concrete classes.',
        );

        it('accepts the layout for a width within the tolerance, and keeps it as it is', () => {
          expect(issuesOf(wider, { ...settings, width: 105, tolerance: 0 })).toEqual([]);
          expect(issuesOf(wider, settings)).toEqual([]);
          expect(fix(wider, settings)).toBe(wider);
        });

        it('accepts it without a hard maximum too', () => {
          const legacy = { width: 100, tolerance: 5 };

          expect(issuesOf(wider, legacy)).toEqual([]);
          expect(fix(wider, legacy)).toBe(wider);
        });

        it('accepts it when its lines happen to stay within the width', () => {
          const within = jsdoc(
            'Records the state of every file with uncommitted changes, to compare it with a later snapshot.',
            'Returns `undefined` outside of a git repository, where only reading every file would show',
            'which ones changed.',
          );

          expect(issuesOf(within, { ...settings, width: 105, tolerance: 0 })).toEqual([]);
          expect(issuesOf(within, settings)).toEqual([]);
          expect(issuesOf(within, { ...settings, tolerance: 0 })).toEqual(['2:unbalanced:verdict']);
        });

        it('reports it when the tolerance is too small, and still wraps to the width itself', () => {
          const small = { ...settings, tolerance: 4 };

          expect(issuesOf(wider, small)).toEqual(['2:unbalanced:verdict']);
          expect(fix(wider, small)).toBe(preferred);
          expect(fix(preferred, settings)).toBe(preferred);
        });

        it('reports it as overflow when the hard maximum is too small, however large the tolerance', () => {
          expect(issuesOf(wider, { width: 100, maxWidth: 102, tolerance: 50 })).toEqual([
            '2:overflow:verdict',
            '3:overflow:verdict',
            '4:overflow:verdict',
          ]);
        });

        it('reports a paragraph that goes past the width with the layout for no width', () => {
          const moved = jsdoc(
            'Implements the bounded queue and lifecycle machinery shared by `RelayDatagram` and `RelayAnyDatagram`.',
            'It owns the client-to-remote queue and its pump, the backend closed watcher, and the idempotent',
            'death path, so a lifecycle fix lands in both channel kinds at once. Only the per-kind frame',
            'validation and the recv-to-frame mapping stay in the concrete classes.',
          );

          expect(issuesOf(moved, settings)).toEqual(['2:unbalanced:verdict']);
          expect(fix(moved, settings)).toBe(preferred);
        });

        it('keeps a hint and its suggestion, since a hint is for the agent to decide', () => {
          const narrow = { width: 82, maxWidth: 102, tolerance: 5 };

          // the layout for a width of 84, whose second line ends with the first two words of a sentence
          const stranded = jsdoc(
            'Sets how many columns prose lines may go past `width` when that saves a line in a',
            'paragraph of three or more lines. It never goes past `maxWidth`. When `maxWidth`',
            'is omitted, it also sets a legacy hard limit of `width + tolerance`.',
          );

          expect(issuesOf(stranded, { ...narrow, width: 84, tolerance: 3 })).toEqual([]);
          expect(issuesOf(stranded, narrow)).toEqual(['3:orphan:hint']);

          expect(fix(stranded, narrow)).toBe(
            jsdoc(
              'Sets how many columns prose lines may go past `width` when that saves a line in a',
              'paragraph of three or more lines. It never goes past `maxWidth`. When `maxWidth` is',
              'omitted, it also sets a legacy hard limit of `width + tolerance`.',
            ),
          );
        });
      });

      describe('lines close to the suggestion', () => {
        const settings = { width: 100, maxWidth: 120, tolerance: 5 };

        const head = [
          'Renders `/proc/meminfo` from the VFS accounting the kernel already keeps, so the file describes',
          'the kernel-managed VFS budget rather than the Wasm allocator or host memory. `MemTotal` is the',
          'fixed VFS capacity, `Shmem` is the accounted tmpfs footprint, `Cached` equals `Shmem` because',
          "tmpfs belongs to Linux's cached total and no separate cache counter exists, and `MemAvailable`",
          'equals `MemFree` because no reclaim path could promise more. Every unmeasured field stays at',
          'zero. The kernel keeps no block-device buffer cache, no LRU or recency accounting, no swap,',
        ];

        // the last two lines have 95 and 99 columns, which is 3 fewer and 3 more than in the suggestion
        const close = jsdoc(
          ...head,
          'and no slab accounting, and pipe, socket, FIFO, and PTY payload bytes must not be mislabeled',
          'as slab. All arithmetic happens in bytes before each printed value floor-divides into kilobytes.',
        );

        const preferred = jsdoc(
          ...head,
          'and no slab accounting, and pipe, socket, FIFO, and PTY payload bytes must not be mislabeled as',
          'slab. All arithmetic happens in bytes before each printed value floor-divides into kilobytes.',
        );

        // the suggestion keeps `(as `warn`)` on one line, with lines of 106, 103, and 57 columns
        const past = [
          'Lists the Unicorn recommended rules natively implemented by Oxlint, grouped by the oxlint category they',
          "belong to. Only the correctness group is enabled by oxlint's defaults (as `warn`). Everything is set",
          'explicitly to `error` to match the recommended config.',
        ];

        it('accepts lines within the tolerance of the suggestion, and keeps them as they are', () => {
          expect(issuesOf(close, settings)).toEqual([]);
          expect(fix(close, settings)).toBe(close);
          expect(issuesOf(close, { ...settings, tolerance: 3 })).toEqual([]);
          expect(fix(preferred, settings)).toBe(preferred);
        });

        it('accepts them without a hard maximum too', () => {
          const legacy = { width: 100, tolerance: 5 };

          expect(issuesOf(close, legacy)).toEqual([]);
          expect(fix(close, legacy)).toBe(close);
        });

        it('reports them when the tolerance is smaller than the difference, and wraps to the suggestion', () => {
          for (const tolerance of [0, 2]) {
            expect(issuesOf(close, { ...settings, tolerance })).toEqual(['8:unbalanced:verdict']);
            expect(fix(close, { ...settings, tolerance })).toBe(preferred);
          }
        });

        it('accepts a line past the width plus the tolerance that the suggestion has too', () => {
          // only `set` moved down, so the first line still has the 106 columns of the suggestion
          const source = jsdoc(
            past[0],
            "belong to. Only the correctness group is enabled by oxlint's defaults (as `warn`). Everything is",
            'set explicitly to `error` to match the recommended config.',
          );

          expect(issuesOf(source, settings)).toEqual([]);
          expect(fix(source, settings)).toBe(source);
        });

        it('reports a longer line that ends past the width plus the tolerance', () => {
          // `they` moved down, which gives the second line 108 columns instead of the 103 of the suggestion
          const source = jsdoc(
            'Lists the Unicorn recommended rules natively implemented by Oxlint, grouped by the oxlint category',
            "they belong to. Only the correctness group is enabled by oxlint's defaults (as `warn`). Everything is set",
            past[2],
          );

          expect(issuesOf(source, settings)).toEqual(['2:unbalanced:verdict']);
          expect(fix(source, settings)).toBe(jsdoc(...past));
        });

        it('still reports a widow', () => {
          // `of` moved up, which leaves `them holds.` on a last line that is 3 columns shorter
          const source = jsdoc(
            'Lists the files whose state differs between two snapshots, including files that only one of',
            'them holds.',
          );

          expect(issuesOf(source, settings)).toEqual(['3:widow:verdict']);

          expect(fix(source, settings)).toBe(
            jsdoc(
              'Lists the files whose state differs between two snapshots, including files that only one',
              'of them holds.',
            ),
          );
        });

        it('still reports a paragraph that has a possible orphan too, so the rewrap moves the word', () => {
          const source = jsdoc(
            'Lists files, directories, `file:line`, or `file:start-end` targets. When',
            'empty, the git scope below applies.',
          );

          expect(issuesOf(source, settings)).toEqual(['2:orphan:hint', '2:unbalanced:verdict']);

          expect(fix(source, settings)).toBe(
            jsdoc(
              'Lists files, directories, `file:line`, or `file:start-end` targets.',
              'When empty, the git scope below applies.',
            ),
          );
        });

        describe('a line that ends inside text that stays on one line', () => {
          const narrow = { width: 60, maxWidth: 80, tolerance: 5 };

          it('still reports a code span that continues on the next line', () => {
            // each line is 5 columns longer or shorter than in the suggestion, which keeps `git init` whole
            const source = jsdoc(
              'Creates the repository that the tests run in, and runs `git',
              'init` in it so that every later command finds',
              'a work tree.',
            );

            expect(issuesOf(source, narrow)).toEqual(['2:unbalanced:verdict']);

            expect(fix(source, narrow)).toBe(
              jsdoc(
                'Creates the repository that the tests run in, and runs',
                '`git init` in it so that every later command finds',
                'a work tree.',
              ),
            );
          });

          it('still reports the head of a JSDoc tag that continues on the next line', () => {
            // each line is 4 columns shorter or longer than in the suggestion, which keeps `a -` on the first line
            const source = jsdoc(
              '@param {Map<string, ReadonlyArray<Handler>>}',
              'a - Describes how each request finds the handler',
              'that serves it.',
            );

            expect(issuesOf(source, narrow)).toEqual(['2:unbalanced:verdict']);

            expect(fix(source, narrow)).toBe(
              jsdoc(
                '@param {Map<string, ReadonlyArray<Handler>>} a -',
                'Describes how each request finds the handler',
                'that serves it.',
              ),
            );
          });
        });
      });
    });
  });

  it('rewraps a JSDoc paragraph where a sentence was appended without reflowing', () => {
    const source = stripIndent`
      /**
       * When creating a module wrap we create the associated \`SourceTextModule\`. This
       * will parse the source code and transform it and collect information about imports and exports.
       */
      export function wrap() {}
    `;

    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(isSuspicious(comment)).toBe(true);
    expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toEqual(['orphan', 'overflow']);

    expect(fix(source)).toBe(stripIndent`
      /**
       * When creating a module wrap we create the associated \`SourceTextModule\`.
       * This will parse the source code and transform it and collect information
       * about imports and exports.
       */
      export function wrap() {}
    `);
  });

  it('accepts a paragraph of three or more lines whose last line is shorter than the even lines before it', () => {
    const source = stripIndent`
      /**
       * A reorderable row of a list node in the row layout. The list re-renders on every hover,
       * selection, and item change, and long lists hold hundreds of rows, so each row is memoized and
       * only renders when its own props change. Motion's Reorder.Item still re-renders and measures
       * itself on every list render, which keeps the reorder and layout animations working.
       */
    `;

    expect(analyzeSource(source, 'file.ts', { ...options, width: 100 }).some((c) => isSuspicious(c))).toBe(false);
  });

  it('keeps the first of two lines full instead of splitting the paragraph evenly', () => {
    const source = stripIndent`
      /**
       * Bottom bar of the list node holding the add button, the selection filter dropdown, the selected
       * item count with the select mode toggle, and the media view controls.
       */
    `;

    expect(analyzeSource(source, 'file.ts', { ...options, width: 100 }).some((c) => isSuspicious(c))).toBe(false);
  });

  it('hints at the start of a sentence at the end of the first of two lines and moves it to the second', () => {
    const source = stripIndent`
      /**
       * Reports every line that a greedy wrap at the given limits would lay out differently. A wrap
       * produced by \`wrapTokens\` with the same arguments never has issues.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 100 });

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`)).toEqual([
      '2:orphan:hint',
    ]);

    const fixed = stripIndent`
      /**
       * Reports every line that a greedy wrap at the given limits would lay out differently.
       * A wrap produced by \`wrapTokens\` with the same arguments never has issues.
       */
    `;

    expect(rewrapComment(comment)).toBe(fixed);
    expect(analyzeSource(fixed, 'file.ts', { ...options, width: 100 }).some((c) => isSuspicious(c))).toBe(false);
  });

  it('still reports the first of two lines as unbalanced when it ends early without ending a sentence', () => {
    const source = stripIndent`
      /**
       * Reports every line that a greedy wrap at the given limits would lay out
       * differently. A wrap produced by \`wrapTokens\` with the same arguments never has issues.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 100 });

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`)).toEqual([
      '2:unbalanced:verdict',
    ]);

    expect(rewrapComment(comment)).toBe(stripIndent`
      /**
       * Reports every line that a greedy wrap at the given limits would lay out differently.
       * A wrap produced by \`wrapTokens\` with the same arguments never has issues.
       */
    `);
  });

  it('keeps the first of two lines full when ending it with a sentence would make the second line longer', () => {
    const source = stripIndent`
      /**
       * Sets how long to wait for the rest of the output after the agent exited.
       * A process that the agent left behind keeps the pipes open for as long as it runs.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 100 });

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`)).toEqual([
      '2:unbalanced:verdict',
    ]);

    const fixed = stripIndent`
      /**
       * Sets how long to wait for the rest of the output after the agent exited. A process that the agent
       * left behind keeps the pipes open for as long as it runs.
       */
    `;

    expect(rewrapComment(comment)).toBe(fixed);
    expect(analyzeSource(fixed, 'file.ts', { ...options, width: 100 }).some((c) => isSuspicious(c))).toBe(false);
  });

  it('never lets the last line stick out past the others', () => {
    const source = stripIndent`
      /**
       * Every output write refuses symlinks: the flow dir is model-influenced, and a prompt-injected round can plant
       * \`results.jsonl -> ~/.bashrc\` where the next unattended run would append. POSIX opens O_NOFOLLOW (a symlink
       * fails with ELOOP). Windows - where Node leaves O_NOFOLLOW undefined and Bun defines a meaningless value -
       * lstat-refuses first. Symlinked parent dirs are refused the same way. Same discipline as the report builders' reads.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 120 });

    expect(hasVerdictIssues(comment)).toBe(true);
    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}`)).toContain('3:unbalanced');

    expect(rewrapComment(comment)).toBe(stripIndent`
      /**
       * Every output write refuses symlinks: the flow dir is model-influenced, and a prompt-injected round can plant
       * \`results.jsonl -> ~/.bashrc\` where the next unattended run would append. POSIX opens O_NOFOLLOW (a symlink fails
       * with ELOOP). Windows - where Node leaves O_NOFOLLOW undefined and Bun defines a meaningless value - lstat-refuses
       * first. Symlinked parent dirs are refused the same way. Same discipline as the report builders' reads.
       */
    `);
  });

  it('never lets the second of two lines stick out past the first', () => {
    const source = stripIndent`
      /**
       * Runs the preset's comment rules on a source, with the options from src/oxlint.ts and
       * src/configs/javascript.ts, so that every comment the eval treats as valid also passes linting.
       */
    `;

    expect(fix(source, { width: 120 })).toBe(stripIndent`
      /**
       * Runs the preset's comment rules on a source, with the options from src/oxlint.ts and src/configs/javascript.ts,
       * so that every comment the eval treats as valid also passes linting.
       */
    `);
  });

  describe('lines that stick out far past the line before them', () => {
    const settings = { width: 100, maxWidth: 120 };

    const even = stripIndent`
      /**
       * Lists the kernel provider operations the external file service calls,
       * which \`BrowserKernel.externalProvider\` provides. Results the service
       * ignores are typed \`void\`.
       */
    `;

    it('takes another line instead of a short first line that the orphan rule leaves before a full second line', () => {
      const stepped = stripIndent`
        /**
         * Lists the kernel provider operations the external file service calls,
         * which \`BrowserKernel.externalProvider\` provides. Results the service ignores are typed \`void\`.
         */
      `;

      const [comment] = analyzeSource(stepped, 'file.ts', { ...options, ...settings });

      expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`)).toEqual([
        '3:unbalanced:verdict',
      ]);

      expect(rewrapComment(comment)).toBe(even);
    });

    it('accepts the even lines as they are', () => {
      expect(analyzeSource(even, 'file.ts', { ...options, ...settings }).some((c) => isSuspicious(c))).toBe(false);
      expect(fix(even, settings)).toBe(even);
    });

    it('keeps the fewest lines when the extra lines would read as code', () => {
      const source = [
        'interface Tables {',
        '  /**',
        '   * `initial`/`maximum` are entry counts (`bigint`, so 64-bit `table64` tables',
        '   * are representable losslessly); `maximum` is `null` for an unbounded table.',
        '   * `elementType` must be a reference type (e.g. a `funcref`/`externref`',
        "   * `{ type: 'Ref', ... }`), and may be a concrete ref to an EXISTING type in",
        "   * this module (`{ type: 'Ref', heap: { type: 'Concrete', typeIndex } }`); a",
        '   * non-reference type — or an index that names no live type — is rejected with',
        '   * a catchable error.',
        '   */',
        '  add(): void;',
        '}',
        '',
      ].join('\n');

      const narrow = { width: 80, maxWidth: 120, style: false };
      const [comment] = analyzeSource(source, 'file.ts', { ...options, ...narrow });

      expect(comment.paragraphs.map((paragraph) => paragraph.reflowable)).toEqual([true]);

      const fixed = fix(source, narrow);

      expect(analyzeSource(fixed, 'file.ts', { ...options, ...narrow }).some((c) => hasVerdictIssues(c))).toBe(false);
      expect(fix(fixed, narrow)).toBe(fixed);
    });
  });

  it('fills the lines before a short last line when few breaks are allowed', () => {
    const source = stripIndent`
      /**
       * Imports and re-exports are grouped together with no blank lines between them,
       * so this rule ignores them entirely, both as a subject and as a neighbor. Declared exports
       * (export const/function/class) still pad like regular code, since they contain real multiline bodies.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 120 });

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}`)).toEqual(['2:unbalanced']);

    const fixed = stripIndent`
      /**
       * Imports and re-exports are grouped together with no blank lines between them, so this rule ignores them entirely,
       * both as a subject and as a neighbor. Declared exports (export const/function/class) still pad like regular code,
       * since they contain real multiline bodies.
       */
    `;

    expect(rewrapComment(comment)).toBe(fixed);
    expect(analyzeSource(fixed, 'file.ts', { ...options, width: 120 }).some((c) => isSuspicious(c))).toBe(false);
  });

  it('never leaves the first word of a clause at the end of a line', () => {
    const source = stripIndent`
      /**
       * Bottom bar of the list node holding the add button, the selection filter dropdown, the
       * selected item count with the select mode toggle, and the media view controls.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 100 });

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}`)).toEqual([
      '2:orphan',
      '2:unbalanced',
    ]);

    expect(fix(source, { width: 100 })).toBe(stripIndent`
      /**
       * Bottom bar of the list node holding the add button, the selection filter dropdown, the selected
       * item count with the select mode toggle, and the media view controls.
       */
    `);
  });

  it('moves an opening parenthesis to the next line', () => {
    const source = stripIndent`
      /**
       * Returns the one observer that every text row shares. Resize observations are delivered after
       * layout but before paint, while a plain state update from outside React only renders after the
       * frame is painted, which would show the stale clamp for one frame whenever the text reflows (the
       * editor replacing its placeholder on mount, a content reset, or a width change).
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 100 });
    const issues = comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}`);

    expect(issues).toContain('4:orphan');

    expect(rewrapComment(comment)).toBe(stripIndent`
      /**
       * Returns the one observer that every text row shares. Resize observations are delivered after
       * layout but before paint, while a plain state update from outside React only renders after the
       * frame is painted, which would show the stale clamp for one frame whenever the text reflows
       * (the editor replacing its placeholder on mount, a content reset, or a width change).
       */
    `);
  });

  it('rewraps lines of very different lengths', () => {
    const source = stripIndent`
      /**
       * Matches a single WebKit frame, which is \`<function>@<location>\`.
       * The function name can be empty and the location is either empty, \`[native code]\`, or a URL or path with a line and column number.
       */
    `;

    expect(fix(source, { width: 120 })).toBe(stripIndent`
      /**
       * Matches a single WebKit frame, which is \`<function>@<location>\`. The function name can be empty and the location is
       * either empty, \`[native code]\`, or a URL or path with a line and column number.
       */
    `);
  });

  it('leaves well-formatted comments alone', () => {
    const source = stripIndent`
      /**
       * Short.
       *
       * A second paragraph that fits.
       */
      // a line comment
    `;

    expect(analyzeSource(source, 'file.ts', options).some((comment) => isSuspicious(comment))).toBe(false);
  });

  describe('line comments', () => {
    const settings = { ...options, width: 40, maxWidth: 60 };

    function issuesOf(source: string, filename = 'file.ts'): string[] {
      return analyzeSource(source, filename, settings).flatMap((comment) =>
        comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
      );
    }

    it('only reports a line comment with a line past the maximum, as a verdict without hints or a suggestion', () => {
      const source = stripIndent`
        function run() {
          // keep the cache warm; it's warm — past the width
          // ---------- Handlers ----------
          return 1;
        }

        // so the first request does not pay for it when it arrives, and this line is far too long
        const a = 1;
      `;

      const comments = analyzeSource(source, 'file.ts', settings);

      expect(comments.map((comment) => [comment.kind, comment.startLine, comment.endLine])).toEqual([['line', 7, 7]]);
      expect(issuesOf(source)).toEqual(['7:overflow']);
      expect(hasVerdictIssues(comments[0])).toBe(true);

      expect(comments[0].paragraphs).toMatchObject([{ reflowable: false, reason: 'line comment', suggestion: null }]);
      expect(rewrapComment(comments[0])).toBe(comments[0].text);
    });

    it('reads consecutive lines with the same indentation as one comment, measured with their own prefixes', () => {
      const long = 'a line that goes on and on until it is well past the maximum';

      const source = [
        '// the first line of a run',
        `// ${long}`,
        '//',
        `//${long}x`,
        `/// ${long}`,
        '  // other indentation',
        '',
        `// ${long}`,
        'const a = 1;',
        '',
      ].join('\n');

      const comments = analyzeSource(source, 'file.ts', settings);

      expect(comments.map((comment) => [comment.startLine, comment.endLine])).toEqual([
        [1, 5],
        [8, 8],
      ]);

      expect(comments[0].paragraphs.map((paragraph) => [paragraph.startLine, paragraph.endLine])).toEqual([
        [1, 2],
        [4, 5],
      ]);

      expect(comments[0].paragraphs[1].issues.map((issue) => [issue.line, issue.length])).toEqual([
        [4, 63],
        [5, 64],
      ]);

      expect(issuesOf(source)).toEqual(['2:overflow', '4:overflow', '5:overflow', '8:overflow']);
    });

    it('never reports code, directives, legal text, layout, ignored comments, or trailing comments', () => {
      const long = 'far too long for the maximum width of a comment line';

      const source = [
        `// eslint-disable-next-line no-console -- ${long}`,
        `// @ts-expect-error ${long}`,
        '/// <reference path="./a/very/long/path/to/some/declarations/file.d.ts" />',
        '',
        `//! Copyright (c) 2024 ${long}`,
        '',
        '// const value = compute(firstArgument, secondArgument, thirdArgument);',
        '',
        `// | option | meaning that is ${long} |`,
        '// | ------ | ------- |',
        '',
        `// comments-ignore: ${long}`,
        '',
        `const a = 1; // ${long}`,
        '',
      ].join('\n');

      expect(analyzeSource(source, 'file.ts', settings)).toEqual([]);
    });

    it('reports an overflow in text that only looks like code or hand layout', () => {
      const source = [
        '// a line that ends with a brace, which may be code but is prose here {',
        '// # a heading that is long enough to be past the maximum width',
        'const a = 1;',
        '',
      ].join('\n');

      expect(issuesOf(source)).toEqual(['1:overflow', '2:overflow']);
    });

    it('measures a line comment against the width and tolerance without a maximum', () => {
      const source = `// ${'word '.repeat(9)}end\n// https://example.com/${'a'.repeat(40)}\nconst a = 1;\n`;

      expect(analyzeSource(source, 'file.ts', { ...options, width: 40, tolerance: 5 })).toMatchObject([
        { kind: 'line', paragraphs: [{ issues: [{ type: 'overflow', line: 1 }] }] },
      ]);
    });
  });

  it('rewraps list items with a hanging indent', () => {
    const source = stripIndent`
      /**
       * Steps:
       *
       * - first step that is long enough to need wrapping across
       *   lines
       * - second
       */
    `;

    expect(fix(source, { width: 40 })).toBe(stripIndent`
      /**
       * Steps:
       *
       * - first step that is long enough to
       *   need wrapping across lines
       * - second
       */
    `);
  });

  it('never rewraps code blocks, tags, directives, or structured text', () => {
    const source = stripIndent`
      /**
       * \`\`\`ts
       * const a = 1;
       * \`\`\`
       *
       *     indented code
       *
       * | a | b |
       * | - | - |
       *
       * name    aligned
       * other   columns
       *
       * ┌──┐
       * └──┘
       *
       * @example someFunction(withMany, argumentsThat, overflowTheWidth)
       */
      // eslint-disable-next-line no-console
      console.log(1);
    `;

    const comments = analyzeSource(source, 'file.ts', { ...options, width: 40 });
    const paragraphs = comments.flatMap((comment) => comment.paragraphs);

    expect(paragraphs.every((paragraph) => paragraph.suggestion === null)).toBe(true);

    expect(paragraphs.map((paragraph) => paragraph.reason)).toEqual([
      'code block',
      'indented',
      'table row',
      'aligned columns',
      'box drawing',
      '@example tag',
    ]);

    expect(comments.some((comment) => hasVerdictIssues(comment))).toBe(false);
  });

  it('rewraps prose JSDoc tags without a continuation indent and keeps types intact', () => {
    const source = stripIndent`
      /**
       * @param {Record<string, number>} counts - How often each key was seen, used to rank the results.
       * @returns the
       *   ranked keys
       */
    `;

    expect(fix(source, { width: 50 })).toBe(stripIndent`
      /**
       * @param {Record<string, number>} counts - How
       * often each key was seen, used to
       * rank the results.
       * @returns the ranked keys
       */
    `);
  });

  it('rewraps prose JSDoc tags whose type or link holds pipes, instead of treating them as a table', () => {
    const source = stripIndent`
      /**
       * @param {string | number | null} value - The value to convert, which
       * is {@link format | formatted} first.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(comment.paragraphs[0].reflowable).toBe(true);

    expect(fix(source)).toBe(stripIndent`
      /**
       * @param {string | number | null} value - The value to convert,
       * which is {@link format | formatted} first.
       */
    `);
  });

  describe('code blocks', () => {
    const narrow = { ...options, width: 30 };

    function issuesOf(source: string, filename = 'file.ts'): string[] {
      return analyzeSource(source, filename, narrow).flatMap((comment) =>
        comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
      );
    }

    it('never measures, checks, or rewraps anything inside a fence', () => {
      const source = stripIndent`
        /**
         * Short.
         *
         * \`\`\`ts
         * const value = compute(first, second, third); // ---- a; b — *c* Note: d
         * \`\`\`
         *
         * ~~~
         * - not a list item, just code that is longer than the width
         * @param notATag
         * ~~~
         */
      `;

      const [comment] = analyzeSource(source, 'file.ts', narrow);
      const codeParagraphs = comment.paragraphs.filter((paragraph) => paragraph.kind === 'code');

      expect(issuesOf(source)).toEqual([]);
      expect(codeParagraphs.map((paragraph) => paragraph.startLine)).toEqual([4, 8]);
      expect(rewrapComment(comment)).toBe(comment.text);
    });

    it('closes a fence only with the same character, at least as often', () => {
      const source = stripIndent`
        /**
         * \`\`\`md
         * ~~~
         * inside the outer fence, so this long line is not measured at all
         * \`\`\`
         * \`\`\`\`md
         * \`\`\`
         * also inside the outer fence, so this long line is not measured
         * \`\`\`\`
         * outside the fences again, so this long line is measured
         */
      `;

      expect(issuesOf(source)).toEqual(['10:overflow']);
    });

    it('does not open a fence on a line that starts with a code span of three backticks', () => {
      const source = stripIndent`
        /**
         * \`\`\`md\`\`\` is the info string of the fence that is described below this line
         *
         * outside of any fence, so this long line of prose is measured as well
         */
      `;

      const [comment] = analyzeSource(source, 'file.ts', narrow);

      expect(comment.paragraphs.map((paragraph) => paragraph.kind)).toEqual(['prose', 'prose']);
      expect(issuesOf(source)).toEqual(['2:overflow', '4:overflow']);
    });

    it('handles fences in list items', () => {
      const source = stripIndent`
        /**
         * - an item with code:
         *   \`\`\`
         *   run(first, second, third);
         *   \`\`\`
         */
      `;

      expect(issuesOf(source)).toEqual([]);
    });

    it('skips fenced code in block comments without a star on every line', () => {
      const source = stripIndent`
        /*
          Short text.
          \`\`\`
          const value = compute(first, second, third); // ---- a; b
          \`\`\`
        */
      `;

      expect(issuesOf(source)).toEqual([]);
    });
  });

  it('skips trailing comments, JSX comments, and ignored comments', () => {
    const source = stripIndent`
      const a = 1; // a trailing comment that is far too long for the width but belongs to code
      const el = <div>{/* a JSX comment that is far too long for the width but is inline */}</div>;
      /* comments-ignore
       * a deliberately
       * short layout
       */
    `;

    expect(analyzeSource(source, 'file.tsx', { ...options, width: 40 })).toEqual([]);
  });

  it('reports overflow in single-line block comments without a suggestion', () => {
    const source = '/** A single-line JSDoc comment that is longer than the width allows. */\n';
    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 40 });

    expect(comment.paragraphs[0]).toMatchObject({ kind: 'other', reflowable: false });
    expect(comment.paragraphs[0].suggestion).toBeNull();
    expect(comment.paragraphs[0].issues).toHaveLength(1);
  });

  it('accounts for indentation', () => {
    const source = '    /**\n     * aaa bbb ccc ddd eee fff\n     */\n';

    expect(fix(source, { width: 22 })).toBe('    /**\n     * aaa bbb ccc\n     * ddd eee fff\n     */\n');
  });

  it('expands tabs in the indentation of every kind of comment', () => {
    const source = '\t\t/* aaa bbb ccc */\n\t\t/**\n\t\t * aaa bbb ccc ddd\n\t\t */\n';
    const [block, jsdoc] = analyzeSource(source, 'file.ts', { ...options, width: 23, tabWidth: 4 });

    expect(block.paragraphs[0].issues).toEqual([{ type: 'overflow', tier: 'verdict', line: 1, length: 25 }]);
    expect(jsdoc.paragraphs[0].issues).toEqual([{ type: 'overflow', tier: 'verdict', line: 3, length: 26 }]);
  });

  it('moves words down so that the last line holds at least three words', () => {
    const source = stripIndent`
      /**
       * Finds prose style violations: semicolons, em-dashes, \`label: explanation\` colons, asterisk emphasis, and section
       * banners.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 120 });

    expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toEqual(['label-colon', 'widow']);

    expect(fix(source, { width: 120 })).toBe(stripIndent`
      /**
       * Finds prose style violations: semicolons, em-dashes, \`label: explanation\` colons, asterisk emphasis,
       * and section banners.
       */
    `);
  });

  it('reports two words on the last line as a widow', () => {
    const source = '/**\n * Finds prose style violations: semicolons and em-dashes, then\n * reports them.\n */\n';
    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 60 });

    expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toContain('widow');

    expect(rewrapComment(comment)).toBe(
      '/**\n * Finds prose style violations: semicolons and em-dashes,\n * then reports them.\n */',
    );
  });

  it('fills the first of two lines', () => {
    const source = stripIndent`
      class Config {
        /**
         * Oxlint exposes typescript-eslint rules under its own \`typescript/\`
         * namespace, so rule ids are prefixed \`typescript/\` rather than
         * \`@typescript-eslint/\`.
         */
        rules = {};
      }
    `;

    expect(fix(source, { width: 120 })).toBe(stripIndent`
      class Config {
        /**
         * Oxlint exposes typescript-eslint rules under its own \`typescript/\` namespace, so rule ids are prefixed
         * \`typescript/\` rather than \`@typescript-eslint/\`.
         */
        rules = {};
      }
    `);
  });

  it('keeps the lines before the last as even as possible, even when one of them could be longer', () => {
    const source = stripIndent`
      /**
       * Lines on stderr interpolate model-influenced bytes (case ids, error text that can echo model output,
       * JSON.parse messages). Strip escape sequences and control characters, as build-report-lite.mjs's
       * eprint does, so a planted OSC/CSI can't retitle the terminal or forge output lines.
       */
    `;

    expect(fix(source, { width: 120 })).toBe(stripIndent`
      /**
       * Lines on stderr interpolate model-influenced bytes (case ids, error text that can echo model output,
       * JSON.parse messages). Strip escape sequences and control characters, as build-report-lite.mjs's eprint
       * does, so a planted OSC/CSI can't retitle the terminal or forge output lines.
       */
    `);
  });

  it('fills the lines before a short last line instead of evening out all lines', () => {
    const source = stripIndent`
      /**
       * Penalizes ending a line with a word that ends in \`'s\`, like the possessive \`user's\`,
       * which reads as one phrase with the word after it. It weighs as much as the punctuation bonus,
       * so that a slightly less balanced break keeps the phrase together.
       */
    `;

    expect(fix(source, { width: 120 })).toBe(stripIndent`
      /**
       * Penalizes ending a line with a word that ends in \`'s\`, like the possessive \`user's\`, which reads as one phrase
       * with the word after it. It weighs as much as the punctuation bonus, so that a slightly less balanced break keeps
       * the phrase together.
       */
    `);
  });

  it('still measures and rewraps a paragraph when a line happens to end with a colon', () => {
    const source = jsdoc(
      'Syntax-only rules that Oxlint ports natively and that used to reach ESLint through presets:',
      'the rules that need no type information.',
    );

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 60 });

    expect(comment.paragraphs[0]).toMatchObject({ kind: 'prose', reflowable: true });
    expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toContain('overflow');
  });

  describe('single-line comments', () => {
    const narrow = { ...options, width: 40, singleLineWidth: 120 };
    const text = 'Side-channel perf fields beyond the built-ins (latency_s etc.).';

    it('keeps a one-paragraph comment on one line past the width when it fits the single-line width', () => {
      const source = jsdoc(text);
      const [comment] = analyzeSource(source, 'file.ts', narrow);

      expect(isSuspicious(comment)).toBe(false);
      expect(fix(source, narrow)).toBe(source);
    });

    it('joins a wrapped one-paragraph comment that fits the single-line width', () => {
      const source = jsdoc('Side-channel perf fields beyond the', 'built-ins (latency_s etc.).');

      expect(analyzeSource(source, 'file.ts', narrow).some((comment) => isSuspicious(comment))).toBe(true);
      expect(fix(source, narrow)).toBe(jsdoc(text));
    });

    it('wraps to the width when the line would exceed the single-line width', () => {
      const long = `${text} ${'More words follow here.'.repeat(3)}`;

      expect(fix(jsdoc(long), { ...narrow, singleLineWidth: 60 })).toBe(fix(jsdoc(long), { ...options, width: 40 }));

      expect(fix(jsdoc(text), { ...narrow, singleLineWidth: 60 })).toBe(
        jsdoc('Side-channel perf fields beyond the', 'built-ins (latency_s etc.).'),
      );
    });

    it('wraps comments with several paragraphs to the width', () => {
      const source = jsdoc(text, '', 'A second paragraph.');

      expect(fix(source, narrow)).toBe(
        jsdoc('Side-channel perf fields beyond the', 'built-ins (latency_s etc.).', '', 'A second paragraph.'),
      );
    });

    it('does not report overflow in a single-line block comment that fits the single-line width', () => {
      const [comment] = analyzeSource(`/** ${text} */\n`, 'file.ts', narrow);

      expect(isSuspicious(comment)).toBe(false);
    });

    describe('tolerance', () => {
      const line =
        'Represents the second phase of a streamed index mount. {@link BrowserKernel.streamIndex} creates it.';

      const wrapped = jsdoc(
        'Represents the second phase of a streamed index mount.',
        '{@link BrowserKernel.streamIndex} creates it.',
      );

      const settings = { width: 100, maxWidth: 120, singleLineWidth: 100, tolerance: 5 };

      it('keeps a one-paragraph comment on one line up to the single-line width plus the tolerance', () => {
        const source = jsdoc(line);
        const [comment] = analyzeSource(source, 'file.ts', { ...options, ...settings });

        expect(comment.lengths[1]).toBe(103);
        expect(comment.paragraphs.flatMap((paragraph) => paragraph.issues)).toEqual([]);
        expect(fix(source, settings)).toBe(source);
        expect(fix(wrapped, settings)).toBe(source);
      });

      it('wraps to the width past the single-line width plus the tolerance', () => {
        expect(fix(jsdoc(line), { ...settings, tolerance: 2 })).toBe(wrapped);
      });

      it('never passes the hard maximum, however large the tolerance', () => {
        expect(fix(jsdoc(line), { ...settings, maxWidth: 102 })).toBe(wrapped);
      });
    });
  });

  it('lets a line overflow slightly when balancing cannot avoid a single word', () => {
    const source = jsdoc('https://example.com/a/very/long/link/that/fills/the/line', 'ok');

    expect(fix(source, { width: 61, tolerance: 3 })).toBe(
      jsdoc('https://example.com/a/very/long/link/that/fills/the/line ok'),
    );

    expect(fix(source, { width: 61, tolerance: 0 })).toBe(source);
  });

  it('measures CRLF files without counting carriage returns', () => {
    const [comment] = analyzeSource('/**\r\n * aaa\r\n * bbb\r\n */\r\n', 'file.ts', options);

    expect(comment.lengths).toEqual([3, 6, 6, 3]);
    expect(rewrapComment(comment)).toBe('/**\n * aaa bbb\n */');
  });

  it('reports location, indent, line lengths, and a suggestion even for well-formatted prose', () => {
    const source = 'function f() {\n  /**\n   * aaa bbb `code`\n   */\n}\n';
    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(comment).toMatchObject({
      kind: 'jsdoc',
      startLine: 2,
      endLine: 4,
      indent: '  ',
      width: 80,
      lengths: [5, 19, 5],
    });

    expect(isSuspicious(comment)).toBe(false);
    expect(comment.paragraphs[0].suggestion).toEqual(['   * aaa bbb `code`']);
  });

  it('handles non-ASCII text before comments', () => {
    const source = `const s = "héllo 🎉";\n${jsdoc('aaa', 'bbb')}`;

    expect(fix(source)).toBe(`const s = "héllo 🎉";\n${jsdoc('aaa bbb')}`);
  });

  it('accepts a greedy wrap whose short last line holds at least three words', () => {
    const source = jsdoc(
      'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor',
      'incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis',
      'nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat',
      'duis aute irure dolor.',
    );

    const issues = analyzeSource(source, 'file.ts', options).flatMap((comment) =>
      comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => issue.type)),
    );

    expect(issues).toEqual([]);
  });

  it('measures overflow on the source line, not on the suggested indentation', () => {
    const source = stripIndent`
      /**
       * @param foo Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eius
       * tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam qu
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}`)).toEqual([]);
  });

  it('continues a list item on an unindented line', () => {
    const source = stripIndent`
      /**
       * - Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor
       * incididunt ut labore.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(comment.paragraphs.map((paragraph) => paragraph.kind)).toEqual(['list']);
  });

  it('keeps directives and legal comments as they are', () => {
    const source = stripIndent`
      /* eslint-disable-next-line no-console -- debugging output */
      import(
        /* webpackChunkName: "foo" */
        './foo'
      );
      /*!
       * Foo v1.0
       * (c) 2020 Bar; MIT License
       */
    `;

    const comments = analyzeSource(source, 'file.ts', options);

    expect(comments.map((comment) => comment.paragraphs[0].reason)).toEqual([
      'directive',
      'directive',
      'legal comment',
    ]);

    expect(comments.some((comment) => isSuspicious(comment))).toBe(false);
  });

  it('keeps license headers and copyright notices as they are', () => {
    const source = stripIndent`
      /**
       * Copyright (c) Example, Inc. and its affiliates.
       *
       * This source code is licensed under the MIT license found in the
       * LICENSE file in the root directory of this source tree.
       */
      /*
       * @license Example v1.0; this line is long enough that it would overflow the width of eighty columns
       */
    `;

    const comments = analyzeSource(source, 'file.ts', options);

    expect(comments.map((comment) => comment.paragraphs.map((paragraph) => paragraph.reason))).toEqual([
      ['legal comment'],
      ['legal comment'],
    ]);

    expect(comments.some((comment) => isSuspicious(comment))).toBe(false);
    expect(fix(source)).toBe(source);
  });

  it('still checks a comment that names a legal marker in a code span', () => {
    const source = jsdoc(
      'A comment is legal when it uses the same markers as bundlers (`/*!`, `@license`, and `@preserve`)',
      'or a notice like `Copyright (c) 2020 Foo`.',
    );

    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(comment.paragraphs.map((paragraph) => paragraph.reason)).toEqual([undefined]);
    expect(hasVerdictIssues(comment)).toBe(true);
  });

  it('still keeps a comment with a bare `@license` as it is, like bundlers do', () => {
    const [comment] = analyzeSource(jsdoc('Keeps comments that use @license as they are.'), 'file.ts', options);

    expect(comment.paragraphs.map((paragraph) => paragraph.reason)).toEqual(['legal comment']);
  });

  it('still checks comments that only mention a license or copyright in prose', () => {
    const source = stripIndent`
      /**
       * Checks the copyright of a file; returns whether it has a license.
       */
    `;

    expect(analyzeSource(source, 'file.ts', options)[0].paragraphs[0].issues.map((issue) => issue.type)).toEqual([
      'semicolon',
    ]);
  });

  it('does not report style issues in commented-out code', () => {
    const source = '/*\nconst x = foo();\nbar();\n*/\n';

    expect(analyzeSource(source, 'file.ts', options).some((comment) => isSuspicious(comment))).toBe(false);
  });

  it('treats commented-out CSS declarations as code, but not prose clauses joined by semicolons', () => {
    for (const source of [jsdoc('display: none;'), jsdoc('color: red; margin: 0;')]) {
      const [comment] = analyzeSource(source, 'file.ts', options);

      expect(comment.paragraphs[0].reason).toBe('code');
      expect(isSuspicious(comment)).toBe(false);
    }

    for (const source of [jsdoc('Ready; set; go.'), jsdoc('Note: this is fine; really.')]) {
      const [comment] = analyzeSource(source, 'file.ts', options);

      expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toContain('semicolon');
    }
  });

  it('does not report overflow in commented-out code, banners in legal comments, or lines held by a long URL', () => {
    const source = stripIndent`
      /*
      const someVeryLongVariableName = computeSomethingExpensive(firstArgument, secondArgument);
      */
      /*! ***************************************************************************
      Copyright (c) Example Corporation.
      ***************************************************************************** */
      /**
       * See https://example.com/a/very/long/link/that/fills/the/line/and/more/stuff/here/and/more for details.
       */
    `;

    expect(analyzeSource(source, 'file.ts', options).some((comment) => isSuspicious(comment))).toBe(false);
  });

  it('keeps the spaces inside code spans', () => {
    const source = jsdoc("Indents with `'  '` by default, and this sentence is long enough to overflow the width.");
    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(rewrapComment(comment)).toContain("`'  '`");
  });

  it('does not treat punctuation inside a code span as the end of a clause', () => {
    const source = jsdoc(
      'Splits the input on every occurrence of the separator, which is `,` characters',
      'by default.',
    );

    const [comment] = analyzeSource(source, 'file.ts', options);

    expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toEqual(['overflow', 'widow']);
  });

  it('is idempotent', () => {
    const source = stripIndent`
      /**
       * One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.
       * Short. Another sentence here
       * - item one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen
       */
    `;

    const once = fix(source, { width: 50 });
    const comments = analyzeSource(once, 'file.ts', { ...options, width: 50 });

    expect(fix(once, { width: 50 })).toBe(once);
    expect(comments.some((comment) => isSuspicious(comment))).toBe(false);
  });

  describe('block-starting words', () => {
    it('never moves a JSDoc tag like `@types/node` to the start of a line', () => {
      const source = stripIndent`
        /**
         * Install the package xxxxxxx from @types/node to get typings.
         */
      `;

      expect(fix(source, { width: 40 })).toBe(stripIndent`
        /**
         * Install the package xxxxxxx
         * from @types/node to get typings.
         */
      `);
    });

    it('never moves a number that ends a sentence to the start of a line, where it would start a list', () => {
      const source = stripIndent`
        /**
         * Bumped the major version to version 2. Then the build broke.
         */
      `;

      const fixed = fix(source, { width: 39 });

      expect(fixed).toBe(stripIndent`
        /**
         * Bumped the major version to
         * version 2. Then the build broke.
         */
      `);

      expect(analyzeSource(fixed, 'file.ts', { ...options, width: 39 })[0].paragraphs.map((p) => p.kind)).toEqual([
        'prose',
      ]);
    });

    it('never moves a dash to the start of a line, where it would start a list', () => {
      expect(fix(jsdoc('Subtracts one from the counter value - 1 when it changes.'), { width: 40 })).toBe(
        jsdoc('Subtracts one from the counter', 'value - 1 when it changes.'),
      );
    });
  });

  describe('nested lists', () => {
    it('keeps nested list items in a list', () => {
      const source = stripIndent`
        /**
         * - outer item
         *   - inner one
         *   - inner two
         */
      `;

      const [comment] = analyzeSource(source, 'file.ts', options);

      expect(isSuspicious(comment)).toBe(false);
      expect(rewrapComment(comment)).toBe(source);
    });

    it('keeps a list in a JSDoc tag description', () => {
      const source = stripIndent`
        /**
         * @param mode - the mode to use
         *   - \`a\` runs fast
         *   1. \`b\` runs slow
         */
      `;

      const [comment] = analyzeSource(source, 'file.ts', options);

      expect(comment.paragraphs.map((paragraph) => paragraph.kind)).toEqual(['tag', 'list', 'list']);
      expect(isSuspicious(comment)).toBe(false);
      expect(rewrapComment(comment)).toBe(source);
    });

    it('wraps a nested item with a hanging indent under its own text', () => {
      const source = stripIndent`
        /**
         * - outer item
         *   - inner item that is long enough to need wrapping onto the next line
         */
      `;

      expect(fix(source, { width: 40 })).toBe(stripIndent`
        /**
         * - outer item
         *   - inner item that is long enough to
         *     need wrapping onto the next line
         */
      `);
    });

    it('keeps an `@example` together across empty lines until the next tag', () => {
      const source = stripIndent`
        /**
         * Runs the check.
         *
         * @example
         * comments check
         *
         * npx comments check --repo --width 100 --tolerance 2 --no-orphans --no-style --json
         *
         * \`\`\`ts
         * @decorated()
         * \`\`\`
         *
         * @returns The exit code, which is not zero when any comment has issues that need a fix.
         */
      `;

      const [comment] = analyzeSource(source, 'file.ts', options);

      expect(comment.paragraphs.map((p) => `${p.kind} ${p.startLine}-${p.endLine} ${p.reason}`)).toEqual([
        'prose 2-2 undefined',
        'tag 4-11 @example tag',
        'tag 13-13 undefined',
      ]);

      expect(comment.paragraphs[1].suggestion).toBeNull();
      expect(comment.paragraphs[1].issues).toEqual([]);

      expect(fix(source)).toContain(
        ' * npx comments check --repo --width 100 --tolerance 2 --no-orphans --no-style --json\n',
      );
    });

    it('keeps indented lines in an `@example` as part of the example', () => {
      const source = stripIndent`
        /**
         * @example
         *   - not a list
         */
      `;

      expect(analyzeSource(source, 'file.ts', options)[0].paragraphs.map((p) => p.kind)).toEqual(['tag']);
    });
  });

  describe('commented-out code', () => {
    function issuesOf(source: string, overrides: Partial<AnalyzeOptions> = {}): string[] {
      return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
        comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
      );
    }

    it('never rewraps or style-checks code that parses, even without a trailing semicolon or brace', () => {
      for (const source of [
        jsdoc('foo(bar)', 'baz()'),
        jsdoc('x = 1; y = 2'),
        jsdoc('return compute(a, b)', 'await flush()'),
        jsdoc('<Button onClick={close} />', '<Footer />'),
        '/**\n * Call it like this.\n *\n * foo(bar);\n * baz(qux)\n */\n',
        '/* if (ready) start() */\n',
      ]) {
        expect(issuesOf(source)).toEqual([]);

        const [comment] = analyzeSource(source, 'file.ts', options);

        expect(rewrapComment(comment)).toBe(comment.text);
      }
    });

    it('still treats prose with parentheses, single words, and labels as prose', () => {
      expect(issuesOf(jsdoc('Keep the cache (and the index) warm', 'so it works.'))).toEqual(['2:underfill']);
      expect(issuesOf(jsdoc('Default: refuse.'))).toEqual(['2:label-colon']);
      expect(issuesOf('/**\n * Returns the value\n * (or null).\n */\n')).toEqual(['2:underfill', '3:widow']);
      expect(issuesOf('/**\n * Optional\n * flag.\n */\n')).toEqual(['2:underfill', '3:widow']);
    });
  });
});

describe('analyzeSource classification', () => {
  function issuesOf(source: string, overrides: Partial<AnalyzeOptions> = {}): string[] {
    return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
      comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
    );
  }

  describe('directives', () => {
    it('keeps a prose line that starts with an ordinary word like `global` or `eslint` in its paragraph', () => {
      for (const word of ['global', 'eslint', 'type:', 'v8', 'c8', 'istanbul', 'jshint']) {
        const source = jsdoc(
          'This clears the cache and every listener that was registered on the',
          `${word} state so tests start clean.`,
        );

        const [comment] = analyzeSource(source, 'file.ts', options);

        expect(comment.paragraphs.map((paragraph) => paragraph.kind)).toEqual(['prose']);
      }

      const source = stripIndent`
        /**
         * The preset configures the rules so that
         * eslint only runs the type-aware ones.
         */
      `;

      expect(analyzeSource(source, 'file.ts', options)[0].paragraphs.map((paragraph) => paragraph.kind)).toEqual([
        'prose',
      ]);

      expect(issuesOf(source)).toEqual(['2:underfill']);
    });

    it('keeps a line that starts with a package name, not a directive, in its paragraph', () => {
      const words = ['eslint-config-prettier', 'eslint-stylistic', 'oxlint-tsgolint', 'stylelint-order', 'deno-types'];

      for (const word of words) {
        const source = jsdoc('Turns off the rules that conflict with', `${word} on edge cases, so we leave them off.`);

        expect(analyzeSource(source, 'file.ts', options)[0].paragraphs.map((paragraph) => paragraph.kind)).toEqual([
          'prose',
        ]);
      }
    });

    it('keeps a line that starts with the exact name of a directive as it is', () => {
      const directives = [
        'eslint-disable-next-line no-console',
        'eslint-enable',
        'oxlint-disable-line',
        '@ts-expect-error the types are wrong',
        'stylelint-disable',
        'deno-lint-ignore-file',
        'webpackChunkName: "foo"',
      ];

      for (const directive of directives) {
        const [comment] = analyzeSource(jsdoc('Some prose before it.', directive), 'file.ts', options);

        expect(comment.paragraphs.map((paragraph) => paragraph.reason)).toEqual([undefined, 'directive']);
      }
    });

    it('still keeps whole-comment directives as they are', () => {
      const source = stripIndent`
        /* global window, document */
        /* eslint quotes: ["error", "double"] */
        /* eslint-env node */
      `;

      const reasons = analyzeSource(source, 'file.ts', options).flatMap((comment) =>
        comment.paragraphs.map((paragraph) => paragraph.reason ?? paragraph.kind),
      );

      expect(reasons).toEqual(['directive', 'directive', 'directive']);
    });
  });

  describe('block comments with text on the opening line', () => {
    it('skips fenced code after the star prefix', () => {
      const source = stripIndent`
        /** Example usage
         * \`\`\`ts
         * for (let i = 0; i < n; i++) run(i); // ---- a — b
         * \`\`\`
         */
      `;

      expect(issuesOf(source)).toEqual([]);
    });

    it('checks the prose after the star prefix like any other comment', () => {
      const source = stripIndent`
        /** Opens the socket.
         * Default: refuse.
         */
      `;

      expect(issuesOf(source)).toEqual(['2:label-colon']);
    });
  });

  it('reports a two-line paragraph that differs from its balanced suggestion as unbalanced', () => {
    const source = stripIndent`
      /**
       * Whether the lines are commented-out code, like \`foo(bar)\` or \`x = 1; y = 2\`. Prose almost never parses
       * as JavaScript, since two words in a row are a syntax error, so this holds for any code that the parser accepts.
       */
    `;

    const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 120 });

    expect(rewrapComment(comment)).not.toBe(comment.text);
    expect(issuesOf(source, { width: 120 })).toEqual(['2:unbalanced']);
  });

  describe('prose that looks like structure', () => {
    it('reports a semicolon at the end of a prose line instead of treating the line as code', () => {
      const source = stripIndent`
        /**
         * This runs first;
         * then the other one runs after it.
         */
      `;

      expect(issuesOf(source)).toContain('2:semicolon');
    });

    it('still treats a line ending with a semicolon as code when it has code around it', () => {
      for (const line of ['const value = compute();', 'run(value);', 'break;', 'items[0] = next;']) {
        const source = `/**\n * Runs it like this.\n * ${line}\n */\n`;

        expect(issuesOf(source)).toEqual([]);
      }
    });

    it('measures prose with two spaces after a sentence instead of treating it as aligned columns', () => {
      const source = stripIndent`
        /**
         * Sentence one.  Sentence two goes on and on and on and on and on and on and on and on and on.
         */
      `;

      const [comment] = analyzeSource(source, 'file.ts', options);

      expect(comment.paragraphs[0].reflowable).toBe(true);
      expect(issuesOf(source)).toEqual(['2:overflow']);
      expect(issuesOf('/**\n * name    aligned\n * other   columns\n */\n')).toEqual([]);
    });

    it('rewraps prose with a stray double space and still shows its hints', () => {
      const source = jsdoc('Retries  the request; gives up on the final attempt and then closes the socket.');
      const [comment] = analyzeSource(source, 'file.ts', { ...options, width: 60 });

      expect(comment.paragraphs[0]).toMatchObject({ kind: 'prose', reflowable: true });
      expect(issuesOf(source, { width: 60 })).toEqual(['2:overflow', '2:semicolon']);
      expect(rewrapComment(comment)).toContain('Retries the request;');
    });

    it('only counts gaps as columns when text continues at the same column on two lines', () => {
      const reasons = (source: string): (string | undefined)[] =>
        analyzeSource(source, 'file.ts', options).flatMap((comment) => comment.paragraphs.map((p) => p.reason));

      expect(reasons(jsdoc('a  b', 'cd  e'))).toEqual([undefined]);
      expect(reasons(jsdoc('a   b', 'cd  e'))).toEqual(['aligned columns']);

      expect(reasons(jsdoc('`a  b` c', 'de  f'))).toEqual([undefined]);
      expect(reasons(jsdoc('`ab` x  c', 'efghij  k'))).toEqual(['aligned columns']);
    });
  });

  describe('text kept as written', () => {
    const narrow = { width: 30 };
    const long = 'and a long line of text that goes past the width';

    function check(source: string): { reason?: string; issues: string[] } {
      const [comment] = analyzeSource(source, 'file.ts', { ...options, ...narrow });
      const [paragraph] = comment.paragraphs;

      expect(rewrapComment(comment)).toBe(comment.text);

      return { reason: paragraph.reason, issues: issuesOf(source, narrow) };
    }

    it('exempts documented layout syntax in the whole paragraph from verdicts, but not from hints', () => {
      expect(check(jsdoc('| a | b |', `| c | ${long}; really |`))).toEqual({
        reason: 'table row',
        issues: ['3:semicolon'],
      });

      expect(check(jsdoc('a | b', '--- | ---', `c | ${long}`)).reason).toBe('table row');
      expect(check(jsdoc('┌──┐', `│ ${long} │`, '└──┘'))).toEqual({ reason: 'box drawing', issues: [] });
      expect(check(jsdoc('name    value', `other   ${long}`)).reason).toBe('aligned columns');
      expect(check(jsdoc('# Heading', long)).reason).toBe('markup');
      expect(check(jsdoc('> quoted', `> ${long}`)).reason).toBe('markup');

      expect(check(jsdoc('********', long, '********'))).toEqual({
        reason: 'repeated characters',
        issues: ['2:banner', '4:banner'],
      });
    });

    it('still measures the width of text that may be laid out by hand', () => {
      expect(check(jsdoc('a --> b', long))).toEqual({ reason: 'arrows or rules', issues: ['3:overflow'] });
      expect(check(jsdoc('a → b', long))).toEqual({ reason: 'arrows or rules', issues: ['3:overflow'] });
      expect(check(jsdoc('a | b | c', long))).toEqual({ reason: 'pipes', issues: ['3:overflow'] });
    });

    it('still measures the width of a paragraph with a line that only looks like code', () => {
      const lines = ['import them from the root', 'Runs it (if any) first;', 'const value = compute();', '} and then'];

      for (const line of lines) {
        const source = jsdoc('Re-exports the helpers', line, long);

        expect(check(source)).toEqual({ reason: 'code-like line', issues: ['4:overflow'] });
      }
    });

    it('shows no style hints in a paragraph with a line that looks like code, since they would point at the code', () => {
      expect(check(jsdoc('Runs it like this; then', 'run(value);'))).toEqual({ reason: 'code-like line', issues: [] });
    });

    it('still measures the width of markup, which a line of prose may also start like', () => {
      for (const line of ['<Promise> that resolves,', '# of attempts,', '> quoted from the spec,']) {
        expect(check(jsdoc('Returns the result in a', line, long))).toEqual({
          reason: 'markup',
          issues: ['4:overflow'],
        });
      }

      expect(check(jsdoc('[a]: https://a.b', long))).toEqual({
        reason: 'markup',
        issues: ['2:label-colon', '3:overflow'],
      });
    });

    it('prefers code that parses over layout syntax, and layout syntax over guesses', () => {
      expect(check(jsdoc("const rule = '────';", 'draw(rule);'))).toEqual({ reason: 'code', issues: [] });
      expect(check(jsdoc('a --> b', '| c | d |', long))).toEqual({ reason: 'table row', issues: [] });
      expect(check(jsdoc('| a | b |', 'if (ready) {', '  run();', '}'))).toEqual({ reason: 'table row', issues: [] });
    });

    it('exempts code tags from verdicts, but measures other tags that are never rewrapped', () => {
      const example = jsdoc('@example', `run(${'argument, '.repeat(6)}last);`);
      const typedef = jsdoc(`@typedef {Object} Options ${long}`);

      expect(issuesOf(example, narrow)).toEqual([]);
      expect(issuesOf(jsdoc('@default', `{ ${'key: 1, '.repeat(6)} }`), narrow)).toEqual([]);
      expect(issuesOf(typedef, narrow)).toEqual(['2:overflow']);
    });

    describe('Markdown hard line breaks', () => {
      it.each([
        ['two spaces', '  '],
        ['more spaces', '    '],
        ['a backslash', '\\'],
        ['a backslash after an escaped one', '\\\\\\'],
      ])('keeps a paragraph with a hard break of %s byte for byte', (_, end) => {
        const source = jsdoc(`First logical line.${end}`, 'Second logical line.');
        const [comment] = analyzeSource(source, 'file.ts', options);

        expect(comment.paragraphs).toMatchObject([{ reflowable: false, reason: 'hard line break', suggestion: null }]);
        expect(issuesOf(source)).toEqual([]);
        expect(rewrapComment(comment)).toBe(comment.text);
        expect(fix(source)).toBe(source);
      });

      it('keeps hard breaks in list items and tag descriptions', () => {
        const list = jsdoc('Steps:', '', '- First step.  ', '  Second line of the step.', '- Next step.');
        const tag = jsdoc('@param name - First line.\\', 'Second line.');

        expect(fix(list)).toBe(list);
        expect(fix(tag)).toBe(tag);
      });

      it('rewraps a line that ends with an escaped backslash, which is a literal backslash', () => {
        const source = jsdoc(String.raw`Ends with a literal backslash \\`, 'and continues here.');

        expect(issuesOf(source)).toEqual(['2:underfill']);
        expect(fix(source)).toBe(jsdoc(String.raw`Ends with a literal backslash \\ and continues here.`));
      });

      it('rewraps a paragraph whose only hard break syntax is on its last line, where it breaks nothing', () => {
        const source = jsdoc('First line that ends', 'early.  ', '', 'Next paragraph.\\');

        expect(issuesOf(source)).toEqual(['2:underfill', '3:widow']);
        expect(fix(source)).toBe(jsdoc('First line that ends early.', '', 'Next paragraph.\\'));
      });

      it('never ends a rewrapped line with a backslash that would read as a hard break', () => {
        const texts = [
          String.raw`Use a backslash \ to escape special characters in the expression.`,
          String.raw`Paths like C:\ or D:\ keep the backslashes that the user typed in them.`,
        ];

        for (const text of texts) {
          for (let width = 10; width <= 60; width += 1) {
            const overrides = { width, style: false };
            const fixed = fix(jsdoc(text), overrides);
            const [comment] = analyzeSource(fixed, 'file.ts', { ...options, ...overrides });

            expect(comment.paragraphs.map((paragraph) => paragraph.reason)).toEqual([undefined]);
            expect(fix(fixed, overrides)).toBe(fixed);
          }
        }
      });

      it('still shows hints and measures the width of a paragraph with a hard break', () => {
        expect(check(jsdoc('Retries the request;  ', long))).toEqual({
          reason: 'hard line break',
          issues: ['2:semicolon', '3:overflow'],
        });
      });
    });
  });
});

describe('analyzeSource false positives', () => {
  function issuesOf(source: string, overrides: Partial<AnalyzeOptions> = {}): string[] {
    return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
      comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
    );
  }

  function styleIssuesOf(source: string): string[] {
    const layout = new Set(['overflow', 'underfill', 'orphan', 'widow', 'unbalanced', 'split-parenthetical']);

    return issuesOf(source).filter((issue) => !layout.has(issue.split(':')[1]));
  }

  function expectUntouched(source: string): void {
    expect(issuesOf(source)).toEqual([]);

    for (const comment of analyzeSource(source, 'file.ts', options)) {
      expect(rewrapComment(comment)).toBe(comment.text);
    }
  }

  describe('lazy continuation lines', () => {
    it('does not report a list item whose continuation lines skip the hanging indent', () => {
      const source = stripIndent`
        /**
         * - The options object that configures how the parser handles comments and
         * their surrounding whitespace when the source file contains lots of nested
         * blocks and other syntax that is hard to read for humans and machines alike
         * so it has to be done really carefully and slowly by everyone.
         */
      `;

      expect(issuesOf(source)).toEqual([]);
    });

    it('does not report a JSDoc tag whose continuation lines skip the indent', () => {
      const source = stripIndent`
        /**
         * @param options - The options object that configures how the parser handles
         * comments and their surrounding whitespace when the source file contains lots
         * of nested blocks and other syntax that is The options object that configures
         * how the parser
         */
      `;

      expect(issuesOf(source)).toEqual([]);
    });
  });

  describe('code spans and types that wrap across lines', () => {
    it('does not report style issues inside a code span that continues on the next line', () => {
      expect(styleIssuesOf(jsdoc('Joins the parts like `a;', 'b` in the output.'))).toEqual([]);
      expect(styleIssuesOf(jsdoc('Accepts `{ width: 80, mode:', 'fast }` as the options.'))).toEqual([]);
      expect(styleIssuesOf(jsdoc('Matches `a — b *c*', 'd` in the output.'))).toEqual([]);
    });

    it('still reports style issues after a code span that continues on the next line', () => {
      expect(styleIssuesOf(jsdoc('Joins the parts like `a;', 'b`; and so on.'))).toEqual(['3:semicolon']);
    });

    it('does not report style issues inside a JSDoc type that continues on the next line', () => {
      const source = stripIndent`
        /**
         * Does something.
         *
         * @param {{ a: string, b: number,
         *   c: boolean }} options - The options.
         */
      `;

      expect(styleIssuesOf(source)).toEqual([]);
    });
  });

  describe('commented-out code', () => {
    it('keeps commented-out object properties as they are', () => {
      expectUntouched(jsdoc('timeout: 5000,', 'retries: 3,'));
      expectUntouched(jsdoc('width: 80'));
      expectUntouched("/**\n * Defaults to these options.\n *\n * name: 'comments',\n * width: [80, 100],\n */\n");
    });

    it('still treats a label with a word or code span after it as prose', () => {
      expect(issuesOf(jsdoc('Default: refuse.'))).toEqual(['2:label-colon']);
      expect(issuesOf(jsdoc('Returns: `null`.'))).toEqual(['2:label-colon']);
    });

    it('treats a word before a code span as prose, not a tagged template', () => {
      expect(issuesOf(jsdoc('calls', '`flush()`'))).toEqual(['2:underfill', '3:widow']);
    });
  });

  describe('structured text', () => {
    it('keeps block quotes as they are', () => {
      expectUntouched(jsdoc('> This is a quoted line from the spec', '> and it continues here'));
      expectUntouched('/**\n * > A quote that is short\n * > and continues here.\n */\n');
    });

    it('keeps one definition per line as it is, but still shows its dashes and colons to the agent', () => {
      const cases: [string, string[]][] = [
        [jsdoc('width - the max width', 'height - the max height'), ['2:dash', '3:dash']],
        ['/**\n * `fast` - skips validation\n * `safe` - validates everything\n */\n', ['2:dash', '3:dash']],
        [jsdoc('fast: skips validation', 'safe: validates everything'), ['2:label-colon', '3:label-colon']],
        [
          jsdoc('Default: refuse the request.', 'Optional: send a retry notification; then stop.'),
          ['2:label-colon', '3:semicolon', '3:label-colon'],
        ],
      ];

      for (const [source, hints] of cases) {
        const [comment] = analyzeSource(source, 'file.ts', options);

        expect(comment.paragraphs.map((paragraph) => paragraph.reason)).toEqual(['definition-like lines']);
        expect(rewrapComment(comment)).toBe(comment.text);
        expect(hasVerdictIssues(comment)).toBe(false);
        expect(issuesOf(source)).toEqual(hints);
      }
    });

    it('still measures the width of definition-like lines, which may be prose', () => {
      const long = 'Optional: send a retry notification and then stop, unless the caller asked to keep going.';

      expect(issuesOf(jsdoc('Default: refuse the request.', long), { width: 60 })).toContain('3:overflow');
    });

    it('still rewraps prose with a single dash or colon in it', () => {
      expect(issuesOf(jsdoc('The width - in columns', 'of the comment.'))).toContain('2:underfill');
    });
  });

  describe('magic comments and directives', () => {
    it('keeps bundler magic comments, annotations, and modelines as they are', () => {
      for (const source of [
        '/* turbopackIgnore: true */\nimport(x);\n',
        '/* @__NO_SIDE_EFFECTS__ */\nfunction f() {}\n',
        '/* #__NO_SIDE_EFFECTS__ */\nfunction f() {}\n',
        '/* vim: set ts=2 sw=2 et: */\n',
        // split, so that the test runner doesn't read it as the environment of this file
        ['/** @', 'jest-environment node */\n'].join(''),
      ]) {
        const [comment] = analyzeSource(source, 'file.ts', options);

        expect(comment.paragraphs.map((paragraph) => paragraph.reason)).toEqual(['directive']);
        expect(isSuspicious(comment)).toBe(false);
      }
    });

    it('does not treat camel or snake case properties as labels', () => {
      expect(issuesOf('/* someBundlerHint: true */\nimport(x);\n')).toEqual([]);
      expect(issuesOf(jsdoc('Set maxRetries: 3 to retry.'))).toEqual([]);
      expect(issuesOf(jsdoc('Set max_retries: 3 to retry.'))).toEqual([]);
      expect(issuesOf(jsdoc('Side effect: the socket closes.'))).toEqual(['2:label-colon']);
    });
  });
});

// the text of a comment line without its prefix, indentation, and list marker
function textLength(line: string): number {
  return line.replace(/^\s*\*\s*(?:(?:[-*+]|\d+[.)])\s+)?/, '').length;
}

describe('rewrap invariants', () => {
  const LAYOUT = new Set(['overflow', 'underfill', 'widow', 'unbalanced', 'orphan', 'split-parenthetical']);

  function layoutIssues(source: string, overrides: Partial<AnalyzeOptions>): string[] {
    return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
      comment.paragraphs
        .filter((paragraph) => paragraph.reflowable)
        .flatMap((paragraph) =>
          paragraph.issues.filter((issue) => LAYOUT.has(issue.type)).map((issue) => `${issue.line}:${issue.type}`),
        ),
    );
  }

  function shapeOf(source: string, overrides: Partial<AnalyzeOptions>): string[] {
    return analyzeSource(source, 'file.ts', { ...options, ...overrides }).flatMap((comment) =>
      comment.paragraphs.map((paragraph) => `${paragraph.kind} ${paragraph.reason}`),
    );
  }

  it('never starts a line with a word that would turn prose into a tag, even when the pair overflows', () => {
    const narrow = { width: 18, tolerance: 1, tabWidth: 2, avoidSentenceOrphans: true, style: false };
    const source = '/**\n * some foo. @types/node\n */\n';
    const fixed = fix(source, narrow);

    expect(fixed).toBe('/**\n * some\n * foo. @types/node\n */\n');
    expect(shapeOf(fixed, narrow)).toEqual(['prose undefined']);
    expect(layoutIssues(fixed, narrow)).toEqual([]);
    expect(fix(fixed, narrow)).toBe(fixed);
  });

  it('keeps a word that starts a block next to a long code span before it', () => {
    const source = `/**\n * Install \`${'x'.repeat(70)}\` @types/node for typings.\n */\n`;
    const fixed = fix(source);

    expect(fixed).toContain(`\`${'x'.repeat(70)}\` @types/node`);
    expect(shapeOf(fixed, {})).toEqual(['prose undefined']);
    expect(layoutIssues(fixed, {})).toEqual([]);
    expect(fix(fixed)).toBe(fixed);
  });

  it('never lays prose out so that it reads as definition-like lines', () => {
    const source = jsdoc('Retries once - then waits. Gives up - and logs the error to the console for later.');

    for (let width = 16; width <= 60; width += 1) {
      const fixed = fix(source, { width });

      expect(shapeOf(fixed, { width }), `width ${width}`).toEqual(['prose undefined']);
      expect(layoutIssues(fixed, { width }), `width ${width}`).toEqual([]);
      expect(fix(fixed, { width }), `width ${width}`).toBe(fixed);
    }
  });

  it('never starts a line with a tool directive', () => {
    const source = jsdoc(
      'Comments that start with eslint-disable turn rules off, so prose must not start a line with one.',
    );

    for (let width = 20; width <= 60; width += 1) {
      const fixed = fix(source, { width });

      expect(fixed).not.toMatch(/^\s*\* eslint-disable/m);
      expect(fix(fixed, { width })).toBe(fixed);
    }
  });

  describe('paragraphs without a rewrap that reads as the same prose', () => {
    const settings = { width: 80, maxWidth: 100 };

    function kept(
      source: string,
      overrides: Partial<AnalyzeOptions> = settings,
    ): { reason?: string; issues: string[] } {
      const [comment] = analyzeSource(source, 'file.ts', { ...options, ...overrides });
      const [paragraph] = comment.paragraphs;

      expect(paragraph).toMatchObject({ reflowable: false, suggestion: null });
      expect(fix(source, overrides)).toBe(source);

      return { reason: paragraph.reason, issues: paragraph.issues.map((issue) => `${issue.line}:${issue.type}`) };
    }

    it('keeps a paragraph that would read as code on a single line, and still shows its hints', () => {
      const source = jsdoc('Returns a > b when the', 'flag is set, or nothing;');

      expect(kept(source)).toEqual({ reason: 'rewrap would read as code', issues: ['3:semicolon'] });
    });

    it('keeps a paragraph whose joined lines would read as text laid out by hand', () => {
      const source = jsdoc('Accepts a | b here', 'and c | d there, which is all that it does today.');

      expect(kept(source)).toEqual({ reason: 'rewrap would read as pipes', issues: [] });
    });

    it('moves a word up a line when the line after it would read as code', () => {
      const narrow = { width: 44, maxWidth: 44 };

      const fixed = fix(
        jsdoc(
          'The loader reads each file below the root and resolves the paths that it finds (relative to the root) first; then it parses them and returns the contents of each file to the caller.',
        ),
        narrow,
      );

      // an even wrap has the line `finds (relative to the root) first;`, which reads as code
      expect(fixed).toBe(
        jsdoc(
          'The loader reads each file below the',
          'root and resolves the paths that it finds',
          '(relative to the root) first; then it',
          'parses them and returns the contents of',
          'each file to the caller.',
        ),
      );

      expect(shapeOf(fixed, narrow)).toEqual(['prose undefined']);
      expect(layoutIssues(fixed, narrow)).toEqual([]);
      expect(fix(fixed, narrow)).toBe(fixed);
    });

    it('keeps a paragraph when the words that have to share a line are too long for one together', () => {
      const narrow = { width: 60, maxWidth: 80 };

      const source = jsdoc(
        'Calls the handler (if any)',
        'and returns;',
        '`someVeryLongFunctionName(withArguments, andMore, andEvenMoreOfThem)`',
        'runs after it.',
      );

      expect(kept(source, narrow)).toEqual({ reason: 'rewrap would read as code', issues: ['3:semicolon'] });
    });

    it('keeps a code span that continues on the next line when it is too long for one line', () => {
      const source = jsdoc(
        'Run `comments agent --runner claude --model haiku --max-agents 6 --batch-size 20',
        '--max-files 10 --timeout 300 --instructions "be brief"` to review every comment.',
      );

      expect(kept(source)).toEqual({ reason: 'unbreakable text across lines', issues: [] });
    });

    it('joins a code span that continues on the next line when it fits on one', () => {
      const source = jsdoc('Run `npm run build --', '--watch` to rebuild on every change that you make.');

      expect(fix(source, settings)).toBe(
        jsdoc('Run `npm run build -- --watch` to rebuild on every change that you make.'),
      );
    });

    it('keeps a link that continues on the next line when it is too long for one line', () => {
      const source = jsdoc(
        'See [the guide to wrapping comments, which also covers lists, tables, and code',
        'blocks](https://example.com/guides/wrapping-comments#lists-tables-and-code-blocks) first.',
      );

      expect(kept(source)).toEqual({ reason: 'unbreakable text across lines', issues: [] });
    });

    it('joins a link that continues on the next line when it fits on one', () => {
      const text = jsdoc('See [the guide to', 'wrapping](https://example.com/guide) for every option.');
      const label = jsdoc('See [the guide to wrapping][the', 'guide] or [the list of', 'options] for more.');

      expect(fix(text, settings)).toBe(
        jsdoc('See [the guide to wrapping](https://example.com/guide) for every option.'),
      );

      expect(fix(label, settings)).toBe(
        jsdoc('See [the guide to wrapping][the guide] or [the list of options] for more.'),
      );
    });

    it('never ends a line inside a link at any width', () => {
      const links = [
        '[the guide to wrapping comments](https://example.com/guide)',
        '[the reference of the config file][reference]',
        '[an array of options]',
      ];

      const source = jsdoc(
        `The options are described in ${links[0]}, and the defaults are listed in ${links[1]} with examples, or in ${links[2]} for each of them.`,
      );

      for (let width = 30; width <= 120; width += 1) {
        const narrow = { width, maxWidth: width + 20 };
        const fixed = fix(source, narrow);

        for (const link of links) {
          expect(
            fixed.split('\n').filter((line) => line.includes(link)),
            `${link} at ${width}\n${fixed}`,
          ).toHaveLength(1);
        }

        expect(fix(fixed, narrow), `width ${width}`).toBe(fixed);
      }
    });

    it('keeps prose whose stray backtick or brace pairs up with one that is lines away', () => {
      const backtick = jsdoc(
        'The `foo option controls the size of the buffer, and when it is not set the',
        'default of 10 applies to every one of the channels. The `bar` option is for',
        'the rest of them.',
      );

      const brace = jsdoc(
        'A line that ends with { opens a block, and the tool treats the lines after it as',
        'code until it finds the line that closes the block again, which starts with }.',
      );

      expect(kept(backtick)).toEqual({ reason: 'unbreakable text across lines', issues: [] });
      expect(kept(brace)).toEqual({ reason: 'unbreakable text across lines', issues: [] });
    });

    it('still measures the width of a paragraph that it keeps', () => {
      const source = jsdoc(
        `The \`foo option controls the size of the buffer, which ${'grows '.repeat(10)}over time. Then`,
        'the default of 10 applies to every one of the channels. The `bar` option is for',
        'the rest of them.',
      );

      expect(kept(source)).toEqual({ reason: 'unbreakable text across lines', issues: ['2:overflow'] });
    });
  });

  /**
   * Returns the lines of a rewrap that exceed the limit and hold more text than any line of their
   * paragraph did before. The comment prefix, indentation, and list marker don't count as text,
   * since a rewrap may change the indentation of a continuation line.
   */
  function addedLongLines(source: string, fixed: string, overrides: Partial<AnalyzeOptions>): string[] {
    const settings = { ...options, ...overrides };
    const limit = settings.maxWidth ?? settings.width + settings.tolerance;

    const paragraphsOf = (text: string): string[][] => {
      const lines = text.split('\n');

      return analyzeSource(text, 'file.ts', settings).flatMap((comment) =>
        comment.paragraphs.map((paragraph) => lines.slice(paragraph.startLine - 1, paragraph.endLine)),
      );
    };

    const before = paragraphsOf(source);

    return paragraphsOf(fixed).flatMap((lines, index) => {
      const longest = Math.max(...before[index].map((line) => textLength(line)));

      return lines.filter((line) => {
        return line.replaceAll('\t', ' '.repeat(settings.tabWidth)).length > limit && textLength(line) > longest;
      });
    });
  }

  it('lays out a paragraph of thousands of words in a fraction of a second', () => {
    const words = Array.from({ length: 4000 }, (_, index) => {
      if (index % 37 === 20) {
        return '(socket';
      }

      if (index % 37 === 23) {
        return 'closes)';
      }

      return index % 11 === 10 ? 'returns.' : ['the', 'request', 'handler', 'a', 'of'][index % 5];
    });

    // six words on each line, which is far from the layout that the tool produces
    const lines = Array.from({ length: Math.ceil(words.length / 6) }, (_, index) => {
      return words.slice(index * 6, index * 6 + 6).join(' ');
    });

    const source = jsdoc(...lines);

    // the layout once took time in proportion to the square of the length, far more than this test may take
    for (const overrides of [{ maxWidth: 120 }, { tolerance: 2 }]) {
      const fixed = fix(source, overrides);

      expect(fixed.split('\n').length).toBeLessThan(lines.length);
      expect(layoutIssues(fixed, overrides)).toEqual([]);
      expect(fix(fixed, overrides)).toBe(fixed);
    }
  }, 5000);

  it('holds for random paragraphs, lists, and tags around structures at any width', { timeout: 30_000 }, () => {
    const { random, between, comment } = randomComments(24_301);

    let checked = 0;

    for (let run = 0; run < 400; run += 1) {
      const source = comment();

      const overrides: Partial<AnalyzeOptions> = {
        width: between(16, 100),
        tolerance: between(0, 2),
        avoidSentenceOrphans: random() < 0.7,
        style: random() < 0.5,
      };

      const fixed = fix(source, overrides);
      const context = `${JSON.stringify(overrides)}\n${source}\n${fixed}`;

      expect(layoutIssues(fixed, overrides), context).toEqual([]);
      expect(fix(fixed, overrides), context).toBe(fixed);
      expect(shapeOf(fixed, overrides), context).toEqual(shapeOf(source, overrides));
      expect(addedLongLines(source, fixed, overrides), context).toEqual([]);

      checked += 1;
    }

    expect(checked).toBe(400);
  });

  it('holds with a hard maximum, and never adds a line that is longer than it', { timeout: 30_000 }, () => {
    // words that read as code at the start or end of a line, and delimiters that pair up across lines
    const { random, between, comment } = randomComments(7919, {
      extra: ['thus;', 'f();', '(one)', 'b)', ')', '{', '}', '`'],
    });

    let checked = 0;

    for (let run = 0; run < 600; run += 1) {
      const source = comment();
      const width = between(16, 100);

      const overrides: Partial<AnalyzeOptions> = {
        width,
        maxWidth: width + between(0, 40),
        tolerance: between(0, 12),
        avoidSentenceOrphans: random() < 0.7,
        style: random() < 0.5,
      };

      const fixed = fix(source, overrides);
      const context = `${JSON.stringify(overrides)}\n${source}\n${fixed}`;

      // a word that is too long for a line on its own stays an overflow
      const issues = layoutIssues(fixed, overrides).filter((issue) => !issue.endsWith(':overflow'));

      expect(issues, context).toEqual([]);
      expect(fix(fixed, overrides), context).toBe(fixed);
      expect(shapeOf(fixed, overrides), context).toEqual(shapeOf(source, overrides));
      expect(addedLongLines(source, fixed, overrides), context).toEqual([]);

      checked += 1;
    }

    expect(checked).toBe(600);
  });

  it(
    'has no verdict for the layout for any width within the tolerance, and keeps it as it is',
    { timeout: 30_000 },
    () => {
      const { random, between, comment } = randomComments(4099, { extra: ['(one)', 'b)'] });

      // a hint may stay, and a word that is too long for a line on its own stays an overflow
      const NO_VERDICT = /:(?:orphan|split-parenthetical|overflow)$/;

      let checked = 0;

      for (let run = 0; run < 400; run += 1) {
        const source = comment();
        const width = between(16, 100);
        const tolerance = between(1, 8);
        const extra = between(1, tolerance);

        const overrides: Partial<AnalyzeOptions> = {
          width,
          ...(random() < 0.6 ? { maxWidth: width + tolerance + between(0, 30) } : {}),
          tolerance,
          avoidSentenceOrphans: random() < 0.7,
          style: false,
        };

        // a paragraph that the wider width keeps as written has the layout for the width itself
        const wider = fix(fix(source, overrides), { ...overrides, width: width + extra, tolerance: tolerance - extra });
        const context = `${JSON.stringify({ ...overrides, extra })}\n${source}\n${wider}`;
        const verdicts = layoutIssues(wider, overrides).filter((issue) => !NO_VERDICT.test(issue));

        expect(verdicts, context).toEqual([]);

        // without a hard maximum, a paragraph with fewer lines than its suggestion has no issue either way
        const kept = analyzeSource(wider, 'file.ts', { ...options, ...overrides }).filter((report) => {
          return overrides.maxWidth !== undefined && !isSuspicious(report);
        });

        for (const report of kept) {
          expect(rewrapComment(report), context).toBe(report.text);
        }

        checked += 1;
      }

      expect(checked).toBe(400);
    },
  );
});

describe('sources that need care to parse', () => {
  const first = jsdoc('aaa', 'bbb');
  const second = jsdoc('ccc', 'ddd');

  function startLines(source: string, filename = 'file.ts'): number[] {
    return analyzeSource(source, filename, options).map((comment) => comment.startLine);
  }

  describe('a byte order mark', () => {
    it('does not hide a comment on the first line', () => {
      const [comment] = analyzeSource(`\uFEFF${first}export const a = 1;\n`, 'file.ts', options);

      expect(comment).toMatchObject({ startLine: 1, endLine: 4, text: first.trimEnd(), lengths: [3, 6, 6, 3] });
      expect(comment.paragraphs[0].issues.map((issue) => issue.type)).toEqual(['underfill', 'widow']);
    });

    it('does not count as a column of the first line', () => {
      const comment = `/* ${'word '.repeat(15)}*/`;
      const [report] = analyzeSource(`\uFEFF${comment}\n`, 'file.ts', options);

      expect(comment).toHaveLength(80);
      expect(report.lengths).toEqual([80]);
      expect(report.paragraphs[0].issues).toEqual([]);
    });
  });

  describe('a syntax error', () => {
    it('leaves a source without comments, whether the error is before, between, or after them', () => {
      const sources: [string, number][] = [
        [`export const = ;\n${first}${second}`, 1],
        [`${first}export const = ;\n${second}`, 5],
        [`${first}${second}export const = ;\n`, 9],
      ];

      for (const [source, line] of sources) {
        const analysis = inspectSource(source, 'file.ts', options);

        expect(analysis.comments).toEqual([]);
        expect(analysis.syntaxError?.line).toBe(line);
        expect(analysis.syntaxError?.message).not.toBe('');
        expect(analyzeSource(source, 'file.ts', options)).toEqual([]);
      }
    });

    it('does not stop the analysis when the parser recovers from it', () => {
      // a `return` outside of a function is an error in a script, but the parser still reads the whole file
      const source = `${first}return;\n${second}`;

      expect(inspectSource(source, 'file.js', options).syntaxError).toBeUndefined();
      expect(startLines(source, 'file.js')).toEqual([1, 6]);
    });

    it('is not reported for a source without an error', () => {
      expect(inspectSource(`${first}export const a = 1;\n`, 'file.ts', options).syntaxError).toBeUndefined();
      expect(inspectSource('', 'file.ts', options)).toEqual({ comments: [] });
    });
  });

  describe('JSX in a `.js` file', () => {
    const source = `${first}const a = <div>text</div>;\n${second}`;

    it('is read, so that the comments after it are found too', () => {
      expect(startLines(source, 'file.js')).toEqual([1, 6]);
      expect(startLines(source, 'file.jsx')).toEqual([1, 6]);
      expect(startLines(source, 'file.tsx')).toEqual([1, 6]);
    });

    it('stays a syntax error in a `.ts` file', () => {
      expect(inspectSource(source, 'file.ts', options).syntaxError?.line).toBe(5);
    });

    it('has a syntax tree to compare, so that a reworded comment is no code change', () => {
      const reworded = source.replace('aaa', 'aaa and more');
      const changed = source.replace('text', 'other text');

      expect(codeFingerprint(reworded, 'file.js')).toBe(codeFingerprint(source, 'file.js'));
      expect(codeFingerprint(changed, 'file.js')).not.toBe(codeFingerprint(source, 'file.js'));
    });
  });
});

describe('codeFingerprint', () => {
  it('ignores comment changes but not code changes', () => {
    const before = '/**\n * a b\n */\nconst x = 1;\n';
    const reflowed = '/**\n * a\n * b\n */\nconst x = 1;\n';
    const changed = '/**\n * a b\n */\nconst x = 2;\n';

    expect(codeFingerprint(reflowed, 'file.ts')).toBe(codeFingerprint(before, 'file.ts'));
    expect(codeFingerprint(changed, 'file.ts')).not.toBe(codeFingerprint(before, 'file.ts'));
  });

  it('ignores comments that are reworded, grow by lines, move, or disappear', () => {
    const before = 'const a = 1; /* short */\n/**\n * One line.\n */\nfunction f() {}\n';

    for (const after of [
      'const a = 1; /* a longer note */\n/**\n * One line\n * became two.\n */\nfunction f() {}\n',
      'const a = 1;\n/** One line. */\nfunction f() {} // moved\n',
      'const a = 1;\nfunction f() {}\n',
    ]) {
      expect(codeFingerprint(after, 'file.ts')).toBe(codeFingerprint(before, 'file.ts'));
    }
  });

  it('ignores a JSX comment, but not the JSX text around it', () => {
    const before = 'const e = <div>\n  {/* a */}\n  hello  world\n</div>;\n';
    const reworded = 'const e = <div>\n  {/* a longer\n      comment */}\n  hello  world\n</div>;\n';
    const text = 'const e = <div>\n  {/* a */}\n  hello world\n</div>;\n';

    expect(codeFingerprint(reworded, 'file.tsx')).toBe(codeFingerprint(before, 'file.tsx'));
    expect(codeFingerprint(text, 'file.tsx')).not.toBe(codeFingerprint(before, 'file.tsx'));
  });

  it('tells apart whitespace in literals, templates, and regexes', () => {
    for (const [a, b] of [
      ['const s = "a  b";', 'const s = "a b";'],
      [String.raw`const s = 'a\tb';`, String.raw`const s = 'a\u0009b';`],
      ['const t = `a  ${x}  b`;', 'const t = `a ${x} b`;'],
      ['const r = /a  b/;', 'const r = /a b/;'],
      ['const n = 10n;', 'const n = 0xan;'],
    ]) {
      expect(codeFingerprint(a, 'file.ts')).not.toBe(codeFingerprint(b, 'file.ts'));
    }
  });

  it('tells apart line breaks that decide where a statement ends', () => {
    expect(codeFingerprint('a\n++b', 'file.ts')).not.toBe(codeFingerprint('a ++b', 'file.ts'));
    expect(codeFingerprint('return\nvalue', 'file.ts')).not.toBe(codeFingerprint('return value', 'file.ts'));
  });

  it('ignores whitespace between tokens', () => {
    expect(codeFingerprint('const  x =\n  1;', 'file.ts')).toBe(codeFingerprint('const x = 1;', 'file.ts'));
  });

  it('compares sources that fail to parse by their whole text', () => {
    const broken = codeFingerprint('const a = ;\n/* note */\n', 'file.ts');

    expect(codeFingerprint('const a = ;\n/* note */\n', 'file.ts')).toBe(broken);
    expect(codeFingerprint('const a = ;\n/* a longer note */\n', 'file.ts')).not.toBe(broken);
    expect(codeFingerprint('const b = ;\n/* note */\n', 'file.ts')).not.toBe(broken);
    expect(codeFingerprint('const a = 1;\n/* note */\n', 'file.ts')).not.toBe(broken);
  });
});

describe('issue tiers', () => {
  function commentOf(source: string, overrides: Partial<AnalyzeOptions> = {}) {
    const [comment] = analyzeSource(source, 'file.ts', { ...options, ...overrides });

    return comment;
  }

  it('treats heuristic issues as hints, which make a comment suspicious but are no verdict', () => {
    const hints: Record<string, [string, number?]> = {
      orphan: [jsdoc('Please ask Acme Inc. support', 'for more details.'), 31],
      'em-dash': [jsdoc('Opens the socket — then closes it.')],
      banner: [jsdoc('----- Handlers -----')],
      semicolon: [jsdoc('Opens the socket; closes it later.')],
      'label-colon': [jsdoc('Opens the socket. Default: refuse.')],
      emphasis: [jsdoc('Opens the *real* socket.')],
      dash: [jsdoc('Opens the socket -- then closes it.')],
    };

    for (const [type, [source, width]] of Object.entries(hints)) {
      const comment = commentOf(source, width ? { width } : {});

      expect(comment.paragraphs.flatMap((paragraph) => paragraph.issues)).toEqual([
        expect.objectContaining({ type, tier: 'hint' }),
      ]);

      expect(isSuspicious(comment)).toBe(true);
      expect(hasVerdictIssues(comment)).toBe(false);
    }
  });

  it('treats measured layout issues as verdicts', () => {
    const verdicts = {
      overflow: jsdoc(`${'word '.repeat(20).trim()}.`),
      underfill: '/**\n * aaa\n * bbb\n */\n',
      widow: '/**\n * Optional\n * flag.\n */\n',
    };

    for (const [type, source] of Object.entries(verdicts)) {
      const comment = commentOf(source);

      expect(comment.paragraphs.flatMap((paragraph) => paragraph.issues)).toContainEqual(
        expect.objectContaining({ type, tier: 'verdict' }),
      );

      expect(hasVerdictIssues(comment)).toBe(true);
    }
  });

  it('has a verdict when a comment has hints and a verdict', () => {
    const comment = commentOf(jsdoc(`Opens the socket; closes it — later ${'word '.repeat(10).trim()}.`));

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.type}:${issue.tier}`)).toEqual([
      'overflow:verdict',
      'semicolon:hint',
      'em-dash:hint',
    ]);

    expect(hasVerdictIssues(comment)).toBe(true);
  });

  it('only hints at line ends that may strand a sentence, since an abbreviation or name can end the line instead', () => {
    const sources: [string, number][] = [
      [jsdoc('Please read item No. 3', 'for more details.'), 25],
      [jsdoc('Contact Doe, John', 'for more details.'), 20],
    ];

    for (const [source, width] of sources) {
      const comment = commentOf(source, { width });

      expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`)).toEqual([
        '2:orphan:hint',
      ]);
    }
  });

  describe('a line that may end with the start of a sentence and also ends early', () => {
    const issuesOf = (source: string, overrides: Partial<AnalyzeOptions> = {}): string[] => {
      const [paragraph] = commentOf(source, overrides).paragraphs;

      return paragraph.issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`);
    };

    it('reports both, so the short line fails a check even when the hint is a false positive', () => {
      const source = jsdoc('Please read item No. 3', 'for more details.');
      const comment = commentOf(source);

      expect(issuesOf(source)).toEqual(['2:orphan:hint', '2:underfill:verdict']);
      expect(hasVerdictIssues(comment)).toBe(true);
      expect(rewrapComment(comment)).toBe(jsdoc('Please read item No. 3 for more details.').trimEnd());
    });

    it('reports the same verdict as for the line without its last word', () => {
      const rest = [
        'attempt waits twice as long as the one before it, and the last error is thrown when',
        'all of them fail.',
      ];

      // the second line is longer than the width, which the maximum allows
      const wide = { maxWidth: 120 };
      const withOrphan = jsdoc('Retries the request up to three times. Each', ...rest);
      const without = jsdoc('Retries the request up to three times.', `Each ${rest[0]}`, rest[1]);

      expect(issuesOf(withOrphan, wide)).toEqual(['2:orphan:hint', '2:underfill:verdict']);
      expect(issuesOf(without, wide)).toEqual(['2:underfill:verdict']);
      expect(rewrapComment(commentOf(withOrphan, wide))).toBe(rewrapComment(commentOf(without, wide)));
    });

    it('only hints when no more words fit on the line', () => {
      expect(issuesOf(jsdoc('Please read item No. 3', 'for more details.'), { width: 25 })).toEqual(['2:orphan:hint']);
    });

    const wide = { width: 100, maxWidth: 120, tolerance: 5 };

    it('reports a paragraph as unbalanced when more than the possible orphan sets it apart from the suggestion', () => {
      const source = jsdoc(
        'Caps a single UDP payload. IPv4 bounds a datagram at 65535 bytes, and',
        'the 20-byte IP header plus the 8-byte UDP header leave 65507 bytes of payload.',
      );

      expect(issuesOf(source, wide)).toEqual(['2:orphan:hint', '2:unbalanced:verdict']);

      expect(rewrapComment(commentOf(source, wide))).toBe(
        jsdoc(
          'Caps a single UDP payload. IPv4 bounds a datagram at 65535 bytes, and the 20-byte IP header plus',
          'the 8-byte UDP header leave 65507 bytes of payload.',
        ).trimEnd(),
      );
    });

    it('only hints when the possible orphan is all that sets a paragraph apart from the suggestion', () => {
      const source = jsdoc(
        "Check a path's accessibility relative to a dirfd like faccessat(2). FaccessatFlags.AT_EACCESS",
        'checks against the effective ids instead of the real ids, and AtFlags.AT_SYMLINK_NOFOLLOW checks',
        'the symlink itself.',
      );

      expect(issuesOf(source, wide)).toEqual(['2:orphan:hint']);
    });
  });

  describe('a line that ends with the first two words of a sentence', () => {
    const wide = { width: 100, maxWidth: 120, tolerance: 5 };

    const stranded = jsdoc(
      'Owns the open scaffolding shared by TCP, connected UDP, and unconnected UDP opens. It allocates',
      'the channel id, parks a deferred in `pendingMap`, wires the abort listener, sends the frame',
      '`buildFrame` produces, and unwinds the map entry when that send fails. The ordering is load',
      'bearing. Every settlement path runs `settle` before the map entry changes so a racing abort',
      'observes `settled` and backs off, and a cancelled open still sends a best-effort RST so the',
      'relay releases the half-open channel.',
    );

    const broken = jsdoc(
      'Owns the open scaffolding shared by TCP, connected UDP, and unconnected UDP opens.',
      'It allocates the channel id, parks a deferred in `pendingMap`, wires the abort listener,',
      'sends the frame `buildFrame` produces, and unwinds the map entry when that send fails.',
      'The ordering is load bearing. Every settlement path runs `settle` before the map entry',
      'changes so a racing abort observes `settled` and backs off, and a cancelled open still',
      'sends a best-effort RST so the relay releases the half-open channel.',
    );

    it('rewraps to break after the sentence when the lines are only a little less even', () => {
      expect(rewrapComment(commentOf(stranded, wide))).toBe(broken.trimEnd());
      expect(isSuspicious(commentOf(broken, wide))).toBe(false);
      expect(fix(broken, wide)).toBe(broken);
    });

    it('only hints, since a heuristic decides where a sentence ends', () => {
      const comment = commentOf(stranded, wide);

      expect(comment.paragraphs[0].issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`)).toEqual([
        '2:orphan:hint',
      ]);

      expect(hasVerdictIssues(comment)).toBe(false);
    });
  });

  describe('a line that ends inside a parenthetical that the suggestion keeps whole', () => {
    const wide = { width: 100, maxWidth: 120, tolerance: 5 };

    const head =
      'The backend is a deliberate SSRF surface. The destination policy (private-range denial, port denylists,';

    const issuesOf = (source: string, overrides: Partial<AnalyzeOptions> = wide): string[] => {
      const [paragraph] = commentOf(source, overrides).paragraphs;

      return paragraph.issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`);
    };

    it('only hints when the split is all that sets the paragraph apart from the suggestion', () => {
      const source = jsdoc(head, 'auth) belongs here or in the relay behind it, never in the kernel.');
      const comment = commentOf(source, wide);

      expect(issuesOf(source)).toEqual(['2:split-parenthetical:hint']);
      expect(hasVerdictIssues(comment)).toBe(false);

      expect(rewrapComment(comment)).toBe(
        jsdoc(
          'The backend is a deliberate SSRF surface. The destination policy (private-range denial, port denylists, auth)',
          'belongs here or in the relay behind it, never in the kernel.',
        ).trimEnd(),
      );
    });

    it('only hints when the lines after the split match the rewrap of the rest', () => {
      const source = jsdoc(
        head,
        'auth) belongs here or in the relay behind it, never in the kernel. It also covers every relay',
        'that forwards traffic for a guest, so a relay can never reach a private address on its own.',
      );

      expect(issuesOf(source)).toEqual(['2:split-parenthetical:hint']);
    });

    it('reports a paragraph as unbalanced when more than the split sets it apart from the suggestion', () => {
      const source = jsdoc(
        head,
        'auth) belongs here or in the relay behind it, never in the kernel. It also covers',
        'every relay that forwards traffic for a guest, so a relay can never reach a private address on its own.',
      );

      expect(issuesOf(source)).toEqual(['2:unbalanced:verdict']);
    });

    it('only applies with a maximum, since parentheticals only stay together within one', () => {
      const source = jsdoc(
        'Splits prose into words, keeping backtick code spans and `{...}` groups (JSDoc types,',
        '`{@link ...}`) intact so that they are never broken across lines.',
      );

      expect(issuesOf(source, { width: 80, maxWidth: 120 })).toEqual(['2:split-parenthetical:hint']);
      expect(issuesOf(source, { width: 80 })).toEqual(['2:overflow:verdict']);
    });
  });

  describe('a line that ends inside a link, a code span, or a `{...}` group', () => {
    const issuesOf = (source: string, overrides: Partial<AnalyzeOptions> = {}): string[] => {
      const [paragraph] = commentOf(source, overrides).paragraphs;

      return paragraph.issues.map((issue) => `${issue.line}:${issue.type}:${issue.tier}`);
    };

    it('is a verdict, since the rewrap keeps each of them on one line', () => {
      const wide = { width: 100, maxWidth: 120 };

      // the lines are as even as they get when a line may end inside a link
      const source = jsdoc(
        'Reads the options from the config file, which [the guide to wrapping',
        'comments](https://example.com/guide) describes with an example for each of them.',
      );

      expect(issuesOf(source, wide)).toEqual(['2:unbalanced:verdict']);

      expect(rewrapComment(commentOf(source, wide))).toBe(
        jsdoc(
          'Reads the options from the config file,',
          'which [the guide to wrapping comments](https://example.com/guide)',
          'describes with an example for each of them.',
        ).trimEnd(),
      );
    });

    it('is a verdict without a maximum too, where a paragraph with fewer lines than its rewrap has no other issue', () => {
      const narrow = { width: 30 };

      const sources = [
        [
          jsdoc('See [the docs on the', 'layout](a) for more of it.'),
          jsdoc('See', '[the docs on the layout](a)', 'for more of it.'),
        ],
        [
          jsdoc('Run `the build with the', 'flag` to see more of it.'),
          jsdoc('Run', '`the build with the flag`', 'to see more of it.'),
        ],
        [
          jsdoc('See {@link Layout the docs', 'on} for more of it.'),
          jsdoc('See', '{@link Layout the docs on}', 'for more of it.'),
        ],
      ];

      for (const [source, rewrapped] of sources) {
        expect(issuesOf(source, narrow), source).toEqual(['2:unbalanced:verdict']);
        expect(fix(source, narrow), source).toBe(rewrapped);
        expect(issuesOf(rewrapped, narrow), source).toEqual([]);
      }
    });
  });

  it('only hints at em-dashes, since they may be quoted', () => {
    const comment = commentOf(jsdoc('Emits "Network — unavailable" on failure.'));

    expect(comment.paragraphs[0].issues.map((issue) => `${issue.type}:${issue.tier}`)).toEqual(['em-dash:hint']);
  });

  it('keeps the layout of a box drawn with banner-like borders and reports no layout issues', () => {
    const source = jsdoc('**********', '* server *', '**********');
    const comment = commentOf(source);

    expect(
      comment.paragraphs.flatMap((paragraph) => paragraph.issues.map((issue) => `${issue.line}:${issue.type}`)),
    ).toEqual(['2:banner', '4:banner']);

    expect(hasVerdictIssues(comment)).toBe(false);
    expect(rewrapComment(comment)).toBe(source.trimEnd());
  });
});
